"""Outbound webhook management — org admin only.

Endpoints receive signed JSON POSTs when subscribed events happen anywhere in
the organization. The signing secret is shown once at creation/rotation.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.rate_limit import limiter, trusted_client_ip
from app.db.session import get_db
from app.models.user import User
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.schemas.common import Message, Page
from app.schemas.webhook import (
    VALID_DELIVERY_STATUSES,
    WebhookDeliveryOut,
    WebhookEndpointCreate,
    WebhookEndpointCreatedOut,
    WebhookEndpointOut,
    WebhookEndpointUpdate,
    WebhookTestOut,
)
from app.services import webhook_service
from app.services.audit_service import audit
from app.services.permission_service import PermissionService
from app.services.webhook_service import WebhookUrlError

router = APIRouter(prefix="/organizations/{org_id}/webhooks", tags=["webhooks"])


def _endpoint_or_404(
    db: Session, org_id: uuid.UUID, endpoint_id: uuid.UUID
) -> WebhookEndpoint:
    endpoint = webhook_service.get_org_endpoint_or_none(db, org_id, endpoint_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    return endpoint


def _delivery_or_404(
    db: Session, endpoint_id: uuid.UUID, delivery_id: uuid.UUID
) -> WebhookDelivery:
    delivery = db.get(WebhookDelivery, delivery_id)
    if delivery is None or delivery.endpoint_id != endpoint_id:
        raise HTTPException(status_code=404, detail="Webhook delivery not found")
    return delivery


@router.get("", response_model=list[WebhookEndpointOut])
def list_webhooks(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    endpoints = db.scalars(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.organization_id == org_id)
        .order_by(WebhookEndpoint.created_at.desc())
    ).all()
    return [WebhookEndpointOut.model_validate(e) for e in endpoints]


@router.post("", response_model=WebhookEndpointCreatedOut, status_code=201)
@limiter.limit("20/minute")
def create_webhook(
    request: Request,
    org_id: uuid.UUID,
    body: WebhookEndpointCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    try:
        raw_secret, endpoint = webhook_service.create_endpoint(
            db,
            organization_id=org_id,
            created_by=user.id,
            url=body.url,
            events=body.events,
            description=body.description,
        )
    except (WebhookUrlError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit(
        db,
        "webhook.endpoint.created",
        organization_id=org_id,
        actor_id=user.id,
        target_type="webhook_endpoint",
        target_id=endpoint.id,
        data={"url": endpoint.url, "events": endpoint.events},
        ip_address=trusted_client_ip(request),
    )
    db.commit()
    db.refresh(endpoint)
    base = WebhookEndpointOut.model_validate(endpoint).model_dump()
    return WebhookEndpointCreatedOut(**base, secret=raw_secret)


@router.get("/{endpoint_id}", response_model=WebhookEndpointOut)
def get_webhook(
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    return WebhookEndpointOut.model_validate(_endpoint_or_404(db, org_id, endpoint_id))


@router.patch("/{endpoint_id}", response_model=WebhookEndpointOut)
def update_webhook(
    request: Request,
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    body: WebhookEndpointUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    endpoint = _endpoint_or_404(db, org_id, endpoint_id)
    changed: list[str] = []
    was_inactive = not endpoint.is_active

    if body.url is not None:
        try:
            webhook_service.validate_webhook_url(body.url)
        except WebhookUrlError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        endpoint.url = body.url.strip()
        changed.append("url")
    if body.events is not None:
        endpoint.events = body.events
        changed.append("events")
    if body.description is not None:
        endpoint.description = body.description.strip() or None
        changed.append("description")
    if body.is_active is not None:
        if body.is_active and was_inactive:
            webhook_service.enable_endpoint(db, endpoint)
            audit(
                db,
                "webhook.endpoint.enabled",
                organization_id=org_id,
                actor_id=perms.user.id,
                target_type="webhook_endpoint",
                target_id=endpoint.id,
                data={},
                ip_address=trusted_client_ip(request),
            )
        elif not body.is_active and endpoint.is_active:
            webhook_service.disable_endpoint_manual(db, endpoint)
            changed.append("is_active")
        elif body.is_active != endpoint.is_active:
            endpoint.is_active = body.is_active
            changed.append("is_active")

    if changed:
        audit(
            db,
            "webhook.endpoint.updated",
            organization_id=org_id,
            actor_id=perms.user.id,
            target_type="webhook_endpoint",
            target_id=endpoint.id,
            data={"fields": changed},
            ip_address=trusted_client_ip(request),
        )

    db.commit()
    db.refresh(endpoint)
    return WebhookEndpointOut.model_validate(endpoint)


@router.delete("/{endpoint_id}", response_model=Message)
def delete_webhook(
    request: Request,
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    endpoint = _endpoint_or_404(db, org_id, endpoint_id)
    audit(
        db,
        "webhook.endpoint.deleted",
        organization_id=org_id,
        actor_id=perms.user.id,
        target_type="webhook_endpoint",
        target_id=endpoint.id,
        data={"url": endpoint.url},
        ip_address=trusted_client_ip(request),
    )
    db.delete(endpoint)
    db.commit()
    return Message(detail="Webhook endpoint deleted")


@router.post("/{endpoint_id}/rotate-secret", response_model=WebhookEndpointCreatedOut)
@limiter.limit("20/minute")
def rotate_webhook_secret(
    request: Request,
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    endpoint = _endpoint_or_404(db, org_id, endpoint_id)
    raw_secret = webhook_service.rotate_secret(db, endpoint)
    audit(
        db,
        "webhook.endpoint.secret_rotated",
        organization_id=org_id,
        actor_id=perms.user.id,
        target_type="webhook_endpoint",
        target_id=endpoint.id,
        data={},
        ip_address=trusted_client_ip(request),
    )
    db.commit()
    db.refresh(endpoint)
    base = WebhookEndpointOut.model_validate(endpoint).model_dump()
    return WebhookEndpointCreatedOut(**base, secret=raw_secret)


@router.post("/{endpoint_id}/test", response_model=WebhookTestOut)
@limiter.limit("20/minute")
def test_webhook(
    request: Request,
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    endpoint = _endpoint_or_404(db, org_id, endpoint_id)
    try:
        webhook_service.validate_webhook_url(endpoint.url)
    except WebhookUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = webhook_service.send_test_ping(db, endpoint)
    return WebhookTestOut(**result)


@router.get("/{endpoint_id}/deliveries", response_model=Page[WebhookDeliveryOut])
def list_webhook_deliveries(
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = Query(None, description="Filter by delivery status"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    _endpoint_or_404(db, org_id, endpoint_id)
    if status is not None and status not in VALID_DELIVERY_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: {', '.join(VALID_DELIVERY_STATUSES)}",
        )
    filters = [WebhookDelivery.endpoint_id == endpoint_id]
    if status is not None:
        filters.append(WebhookDelivery.status == status)
    total = db.scalar(select(func.count(WebhookDelivery.id)).where(*filters)) or 0
    rows = db.scalars(
        select(WebhookDelivery)
        .where(*filters)
        .order_by(WebhookDelivery.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return Page(
        items=[WebhookDeliveryOut.model_validate(d) for d in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{endpoint_id}/deliveries/{delivery_id}",
    response_model=WebhookDeliveryOut,
)
def get_webhook_delivery(
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    delivery_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    _endpoint_or_404(db, org_id, endpoint_id)
    delivery = _delivery_or_404(db, endpoint_id, delivery_id)
    return WebhookDeliveryOut.model_validate(delivery)


@router.post(
    "/{endpoint_id}/deliveries/{delivery_id}/redeliver",
    response_model=WebhookDeliveryOut,
    status_code=201,
)
@limiter.limit("20/minute")
def redeliver_webhook(
    request: Request,
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    delivery_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    endpoint = _endpoint_or_404(db, org_id, endpoint_id)
    source = _delivery_or_404(db, endpoint_id, delivery_id)
    try:
        delivery = webhook_service.redeliver_delivery(db, endpoint, source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit(
        db,
        "webhook.delivery.redelivered",
        organization_id=org_id,
        actor_id=perms.user.id,
        target_type="webhook_delivery",
        target_id=delivery.id,
        data={"redelivered_from_id": str(source.id), "event_type": source.event_type},
        ip_address=trusted_client_ip(request),
    )
    db.commit()
    db.refresh(delivery)
    webhook_service.enqueue_delivery_task(endpoint.id, delivery.id)
    return WebhookDeliveryOut.model_validate(delivery)
