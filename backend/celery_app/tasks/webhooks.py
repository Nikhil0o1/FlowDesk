"""Outbound webhook delivery task."""
import logging

from celery_app.app import app

logger = logging.getLogger(__name__)


@app.task(
    bind=True,
    name="flowdesk.deliver_webhook",
    max_retries=5,
    retry_backoff=True,       # 1s, 2s, 4s, 8s, ... between attempts
    retry_backoff_max=600,    # cap at 10 minutes
    retry_jitter=True,
    acks_late=True,
)
def deliver_webhook(self, endpoint_id: str, delivery_id: str) -> None:
    """POST one signed webhook payload; retry on transient failures.

    attempt = retries + 1 (1..6). The service marks status=retrying and raises
    RetryableDeliveryError only when more attempts remain; exhausted failures
    do not raise and therefore do not inflate failure_count via retries.
    """
    import uuid

    from app.db.session import SessionLocal
    from app.services.webhook_service import RetryableDeliveryError, perform_delivery

    db = SessionLocal()
    try:
        perform_delivery(
            db,
            uuid.UUID(endpoint_id),
            uuid.UUID(delivery_id),
            attempt=self.request.retries + 1,
        )
    except RetryableDeliveryError as exc:
        logger.info(
            "Webhook delivery %s attempt %s failed (%s) — will retry",
            delivery_id,
            self.request.retries + 1,
            exc,
        )
        raise self.retry(exc=exc)
    finally:
        db.close()
