"""GitHub REST API calls using a user OAuth access token."""
import base64
import re
from urllib.parse import quote

import requests

GITHUB_API = "https://api.github.com"

# Prefix for the single GitHub label that mirrors a task's FlowDesk board status.
# Namespaced so we can find and replace our own label without touching the user's.
FLOWDESK_LABEL_PREFIX = "flowdesk: "

# GitHub owner/repo segment rules (defense against path injection in URL builders).
_GITHUB_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,98}[a-zA-Z0-9])?$")
_BRANCH_NAME_RE = re.compile(r"^[a-zA-Z0-9._/-]+$")


class GitHubPathValidationError(ValueError):
    """Raised when owner, repo, or branch segments are unsafe for URL interpolation."""


class GitHubApiError(Exception):
    """GitHub REST API failure with an HTTP status suitable for FlowDesk clients."""

    def __init__(self, http_status: int, detail: str):
        self.http_status = http_status
        self.detail = detail
        super().__init__(detail)


def _github_error_detail(response: requests.Response, fallback: str) -> str:
    """Extract a human-readable message from a GitHub error payload."""
    try:
        payload = response.json()
        if not isinstance(payload, dict):
            return fallback
        parts: list[str] = []
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            parts.append(message.strip())
        errors = payload.get("errors")
        if isinstance(errors, list):
            for err in errors:
                if not isinstance(err, dict):
                    continue
                err_msg = err.get("message") or err.get("code")
                if isinstance(err_msg, str) and err_msg.strip():
                    parts.append(err_msg.strip())
        if not parts:
            return fallback
        if parts[0].lower() == "validation failed" and len(parts) > 1:
            return " — ".join(parts[1:])
        return " — ".join(dict.fromkeys(parts))
    except Exception:
        return fallback


def _response_detail(response: requests.Response, fallback: str) -> str:
    return _github_error_detail(response, fallback)


def raise_for_response(response: requests.Response, *, action: str = "GitHub API request") -> None:
    """Raise GitHubApiError when a GitHub response is not successful."""
    if response.ok:
        return
    status = response.status_code
    if status == 401:
        raise GitHubApiError(
            401,
            "GitHub access token expired or revoked — reconnect in App Center",
        )
    if status == 403:
        raise GitHubApiError(
            403,
            "GitHub token does not have permission for this repository — reconnect or check repo access",
        )
    if status == 404:
        raise GitHubApiError(404, "Repository or resource not found on GitHub")
    if status == 422:
        raise GitHubApiError(
            422,
            _response_detail(response, "GitHub rejected the request — check repository settings"),
        )
    if status == 409:
        detail = _response_detail(response, "")
        if "empty" in detail.lower():
            raise GitHubApiError(
                422,
                "This GitHub repository has no commits yet. Add an initial commit on GitHub first.",
            )
        raise GitHubApiError(
            409,
            detail or f"{action} conflicted on GitHub — try again in a moment",
        )
    raise GitHubApiError(502, f"{action} failed (GitHub {status})")


def verify_token(token: str) -> bool:
    """Return True when the token is accepted by GitHub (cheap /user probe)."""
    if not token:
        return False
    try:
        r = requests.get(f"{GITHUB_API}/user", headers=_headers(token), timeout=8)
        return r.status_code == 200
    except requests.RequestException:
        return False


def validate_github_segment(name: str, *, label: str = "segment") -> str:
    """Validate a single GitHub owner/repo path segment."""
    if not name or name != name.strip():
        raise GitHubPathValidationError(f"Invalid GitHub {label}")
    if "/" in name or "\\" in name or ".." in name or "%" in name:
        raise GitHubPathValidationError(f"Invalid GitHub {label}")
    if not _GITHUB_SEGMENT_RE.fullmatch(name):
        raise GitHubPathValidationError(f"Invalid GitHub {label}")
    return name


def validate_branch_name(branch: str) -> str:
    """Validate a git ref branch name before interpolating into API URLs."""
    if not branch or branch != branch.strip():
        raise GitHubPathValidationError("Invalid branch name")
    if branch.startswith("/") or branch.endswith("/") or "//" in branch:
        raise GitHubPathValidationError("Invalid branch name")
    if ".." in branch or "\\" in branch or "@" in branch or ":" in branch or "%" in branch:
        raise GitHubPathValidationError("Invalid branch name")
    if not _BRANCH_NAME_RE.fullmatch(branch):
        raise GitHubPathValidationError("Invalid branch name")
    return branch


def _encode_branch_path(branch: str) -> str:
    """URL-encode a branch name for GitHub REST path segments (slashes → %2F)."""
    return quote(validate_branch_name(branch), safe="")


def _encode_git_heads_ref(branch: str) -> str:
    """Encode ``heads/{branch}`` for ``/git/ref/`` and ``/git/refs/`` endpoints."""
    return quote(f"heads/{validate_branch_name(branch)}", safe="")


def parse_repo_full_name(repo_full_name: str) -> tuple[str, str]:
    """Split and validate owner/repo from a full name like 'octocat/Hello-World'."""
    if not repo_full_name or repo_full_name.count("/") != 1:
        raise GitHubPathValidationError("Repository name must be in owner/repo format")
    owner, repo = repo_full_name.split("/", 1)
    return validate_github_segment(owner, label="owner"), validate_github_segment(repo, label="repo")


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


def get_authenticated_user(token: str) -> dict:
    r = requests.get(f"{GITHUB_API}/user", headers=_headers(token), timeout=10)
    raise_for_response(r, action="GitHub authentication")
    return r.json()


def list_accessible_repos(token: str) -> list[dict]:
    """Return all repos the token has access to (personal + org), up to 300."""
    repos: list[dict] = []
    page = 1
    while len(repos) < 300:
        r = requests.get(
            f"{GITHUB_API}/user/repos",
            headers=_headers(token),
            params={"per_page": 100, "page": page, "sort": "pushed"},
            timeout=15,
        )
        raise_for_response(r, action="List GitHub repositories")
        batch = r.json()
        if not batch:
            break
        repos.extend(batch)
        page += 1
        if len(batch) < 100:
            break
    return repos


def revoke_token(client_id: str, client_secret: str, token: str) -> None:
    """Revoke a single OAuth token; the app authorization (grant) stays. Best-effort."""
    try:
        requests.delete(
            f"{GITHUB_API}/applications/{client_id}/token",
            auth=(client_id, client_secret),
            json={"access_token": token},
            timeout=10,
        )
    except requests.RequestException:
        pass


def revoke_authorization(client_id: str, client_secret: str, token: str) -> None:
    """Revoke the whole app authorization (grant + all the user's tokens for this app).

    After this, the user's next connect re-shows GitHub's consent screen — which is
    where they can request access to an organization's repos. Best-effort.
    """
    try:
        requests.delete(
            f"{GITHUB_API}/applications/{client_id}/grant",
            auth=(client_id, client_secret),
            json={"access_token": token},
            timeout=10,
        )
    except requests.RequestException:
        pass


def get_repo(token: str, owner: str, repo: str) -> dict:
    owner = validate_github_segment(owner, label="owner")
    repo = validate_github_segment(repo, label="repo")
    r = requests.get(f"{GITHUB_API}/repos/{owner}/{repo}", headers=_headers(token), timeout=10)
    raise_for_response(r, action="Get repository")
    return r.json()


def create_webhook(token: str, owner: str, repo: str, webhook_url: str, secret: str) -> int | None:
    """Create a webhook on the repo. Returns the hook ID, or None if creation fails."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    payload = {
        "name": "web",
        "active": True,
        "events": ["push", "pull_request", "issues", "sub_issues", "issue_comment"],
        "config": {"url": webhook_url, "content_type": "json", "secret": secret, "insecure_ssl": "0"},
    }
    try:
        r = requests.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/hooks",
            headers=_headers(token),
            json=payload,
            timeout=10,
        )
        r.raise_for_status()
        return r.json().get("id")
    except requests.HTTPError:
        return None


def create_issue(token: str, owner: str, repo: str, title: str, body: str) -> dict:
    """Create a GitHub issue and return the full issue object (includes number and html_url)."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues",
        headers=_headers(token),
        json={"title": title, "body": body},
        timeout=10,
    )
    raise_for_response(r, action="Create GitHub issue")
    return r.json()


FLOWDESK_WEBHOOK_EVENTS = ("push", "pull_request", "issues", "sub_issues", "issue_comment")


def add_sub_issue(
    token: str,
    owner: str,
    repo: str,
    parent_issue_number: int,
    sub_issue_id: int,
    *,
    replace_parent: bool = False,
) -> None:
    """Link an existing issue as a sub-issue under a parent issue."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    payload: dict[str, int | bool] = {"sub_issue_id": int(sub_issue_id)}
    if replace_parent:
        payload["replace_parent"] = True
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(parent_issue_number)}/sub_issues",
        headers=_headers(token),
        json=payload,
        timeout=10,
    )
    raise_for_response(r, action="Add GitHub sub-issue")


def list_sub_issues(
    token: str,
    owner: str,
    repo: str,
    issue_number: int,
    *,
    limit: int = 100,
) -> list[dict]:
    """Return sub-issues for a parent GitHub issue."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/sub_issues",
        headers=_headers(token),
        params={"per_page": min(max(limit, 1), 100)},
        timeout=10,
    )
    raise_for_response(r, action="List GitHub sub-issues")
    payload = r.json()
    if isinstance(payload, list):
        return payload
    return []


def update_webhook_events(
    token: str,
    owner: str,
    repo: str,
    hook_id: int,
    *,
    events: tuple[str, ...] | None = None,
) -> None:
    """Ensure a repo webhook listens for the FlowDesk event set."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.patch(
        f"{GITHUB_API}/repos/{owner}/{repo}/hooks/{int(hook_id)}",
        headers=_headers(token),
        json={"events": list(events or FLOWDESK_WEBHOOK_EVENTS), "active": True},
        timeout=10,
    )
    r.raise_for_status()


def ensure_flowdesk_webhook_events(
    token: str,
    owner: str,
    repo: str,
    hook_id: int,
) -> None:
    """Patch an existing webhook when it is missing newer events such as sub_issues."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    try:
        r = requests.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/hooks/{int(hook_id)}",
            headers=_headers(token),
            timeout=10,
        )
        if not r.ok:
            return
        current = set(r.json().get("events") or [])
        if set(FLOWDESK_WEBHOOK_EVENTS).issubset(current):
            return
        update_webhook_events(token, owner, repo, hook_id)
    except Exception:
        pass


def create_issue_comment(token: str, owner: str, repo: str, issue_number: int, body: str) -> dict:
    """Add a comment to an existing issue and return the GitHub comment object."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/comments",
        headers=_headers(token),
        json={"body": body},
        timeout=10,
    )
    raise_for_response(r, action="Post GitHub issue comment")
    return r.json()


def list_issue_comments(
    token: str,
    owner: str,
    repo: str,
    issue_number: int,
    *,
    limit: int = 100,
) -> list[dict]:
    """Return comments on a GitHub issue."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/comments",
        headers=_headers(token),
        params={"per_page": min(max(limit, 1), 100)},
        timeout=10,
    )
    raise_for_response(r, action="List GitHub issue comments")
    payload = r.json()
    if isinstance(payload, list):
        return payload
    return []


def update_issue_state(token: str, owner: str, repo: str, issue_number: int, state: str) -> None:
    """Open or close a GitHub issue by number."""
    patch_issue(token, owner, repo, issue_number, state=state)


def patch_issue(
    token: str,
    owner: str,
    repo: str,
    issue_number: int,
    *,
    title: str | None = None,
    state: str | None = None,
    body: str | None = None,
) -> None:
    """Patch a GitHub issue title, body, and/or open/closed state."""
    payload: dict[str, str] = {}
    if title is not None:
        payload["title"] = title
    if state is not None:
        payload["state"] = state
        if state == "open":
            payload["state_reason"] = "reopened"
    if body is not None:
        payload["body"] = body
    if not payload:
        return
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.patch(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{issue_number}",
        headers=_headers(token),
        json=payload,
        timeout=10,
    )
    raise_for_response(r, action="Update GitHub issue")


def get_issue(token: str, owner: str, repo: str, issue_number: int) -> dict:
    """Fetch a single GitHub issue (open or closed)."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}",
        headers=_headers(token),
        timeout=10,
    )
    raise_for_response(r, action="Get GitHub issue")
    return r.json()


def get_issue_parent_number(
    token: str, owner: str, repo: str, issue_number: int
) -> int | None:
    """Return the parent issue number when ``issue_number`` is a GitHub sub-issue."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/parent",
        headers=_headers(token),
        timeout=10,
    )
    if r.status_code == 404:
        return None
    raise_for_response(r, action="Get GitHub issue parent")
    data = r.json()
    number = data.get("number")
    return int(number) if number is not None else None


def list_open_issues(
    token: str,
    owner: str,
    repo: str,
    *,
    limit: int = 100,
    sort: str = "updated",
    direction: str = "desc",
) -> list[dict]:
    """Return up to ``limit`` open issues.

    Default sort is ``updated`` descending so polling picks up newly created issues.
    GitHub's issues endpoint also returns pull requests (they carry a
    ``pull_request`` key); the caller is responsible for filtering those out.
    """
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    out: list[dict] = []
    page = 1
    while len(out) < limit:
        r = requests.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/issues",
            headers=_headers(token),
            params={
                "state": "open",
                "per_page": min(100, limit),
                "page": page,
                "sort": sort,
                "direction": direction,
            },
            timeout=15,
        )
        raise_for_response(r, action="List GitHub issues")
        batch = r.json()
        if not batch:
            break
        out.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return out[:limit]


# ---------------------------------------------------------------------------
# Issue status mirror (FlowDesk board status → GitHub issue state + label)
# ---------------------------------------------------------------------------

def ensure_label(token: str, owner: str, repo: str, name: str, color: str = "ededed",
                 description: str = "") -> None:
    """Create the label (or update its colour if it already exists). Best-effort."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    color = (color or "ededed").lstrip("#") or "ededed"
    try:
        r = requests.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/labels",
            headers=_headers(token),
            json={"name": name, "color": color, "description": description},
            timeout=10,
        )
        if r.status_code == 422:  # already exists — keep its colour in sync
            requests.patch(
                f"{GITHUB_API}/repos/{owner}/{repo}/labels/{quote(name, safe='')}",
                headers=_headers(token),
                json={"new_name": name, "color": color},
                timeout=10,
            )
        else:
            r.raise_for_status()
    except requests.RequestException:
        pass


def list_issue_labels(token: str, owner: str, repo: str, issue_number: int) -> list[str]:
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/labels",
        headers=_headers(token), timeout=10,
    )
    r.raise_for_status()
    return [lbl.get("name", "") for lbl in r.json()]


def add_issue_labels(token: str, owner: str, repo: str, issue_number: int, labels: list[str]) -> None:
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/labels",
        headers=_headers(token), json={"labels": labels}, timeout=10,
    )
    r.raise_for_status()


def remove_issue_label(token: str, owner: str, repo: str, issue_number: int, name: str) -> None:
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.delete(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{int(issue_number)}/labels/{quote(name, safe='')}",
        headers=_headers(token), timeout=10,
    )
    if r.status_code not in (200, 404):
        r.raise_for_status()


def sync_issue_status(
    token: str, owner: str, repo: str, issue_number: int, *,
    state: str, label_name: str | None = None, label_color: str | None = None,
    mirror_state: bool = True,
) -> None:
    """Mirror a task's board status onto its linked GitHub issue (best-effort).

    GitHub issues are binary (open/closed), so the intermediate FlowDesk statuses
    ("In Progress", "In Review", …) are represented by a single namespaced label
    (``flowdesk: <status>``) that replaces any previously-set FlowDesk label.
    Every step swallows its own errors so a partial GitHub outage never breaks the
    task update.
    """
    if mirror_state:
        try:
            update_issue_state(token, owner, repo, issue_number, state)
        except Exception:
            pass
    if not label_name:
        return
    try:
        ensure_label(token, owner, repo, label_name, label_color or "ededed",
                     description="FlowDesk task status")
        try:
            current = list_issue_labels(token, owner, repo, issue_number)
        except Exception:
            current = []
        for existing in current:
            if existing.startswith(FLOWDESK_LABEL_PREFIX) and existing != label_name:
                try:
                    remove_issue_label(token, owner, repo, issue_number, existing)
                except Exception:
                    pass
        if label_name not in current:
            add_issue_labels(token, owner, repo, issue_number, [label_name])
    except Exception:
        pass


def delete_webhook(token: str, owner: str, repo: str, hook_id: int) -> None:
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    try:
        requests.delete(
            f"{GITHUB_API}/repos/{owner}/{repo}/hooks/{hook_id}",
            headers=_headers(token),
            timeout=10,
        )
    except Exception:
        pass


def branch_tree_url(owner: str, repo: str, branch: str) -> str:
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    branch = validate_branch_name(branch)
    return f"https://github.com/{owner}/{repo}/tree/{branch}"


def _resolve_base_branch_sha(token: str, owner: str, repo: str, base_branch: str) -> tuple[str, str]:
    """Return ``(resolved_base_branch, tip_sha)``, refreshing the default branch from GitHub when needed."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    candidates = [base_branch.strip() or "main"]
    try:
        live_default = (get_repo(token, owner, repo).get("default_branch") or "").strip()
        if live_default and live_default not in candidates:
            candidates.append(live_default)
    except GitHubApiError:
        pass
    if "main" not in candidates:
        candidates.append("main")

    last_error: GitHubApiError | None = None
    for candidate in candidates:
        try:
            branch = validate_branch_name(candidate)
        except GitHubPathValidationError as exc:
            last_error = GitHubApiError(422, str(exc))
            continue
        try:
            return branch, get_branch_sha(token, owner, repo, branch)
        except GitHubApiError as exc:
            last_error = exc
            if exc.http_status == 404:
                continue
            if exc.http_status == 409:
                continue
            if exc.http_status == 422 and "no commits" in exc.detail.lower():
                continue
            raise
    if last_error and last_error.http_status == 404:
        raise GitHubApiError(
            422,
            "This GitHub repository has no commits yet, or the default branch could not be found. "
            "Add an initial commit on GitHub first.",
        ) from last_error
    if last_error:
        raise last_error
    raise GitHubApiError(422, "Could not resolve the repository base branch on GitHub")


def _initialize_empty_repo(token: str, owner: str, repo: str, branch: str) -> str:
    """Create a minimal README commit so branch operations work on an empty repository."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    branch = validate_branch_name((branch or "main").strip() or "main")
    content = base64.b64encode(b"# README\n\nInitialized by FlowDesk.\n").decode("ascii")
    r = requests.put(
        f"{GITHUB_API}/repos/{owner}/{repo}/contents/README.md",
        headers=_headers(token),
        json={
            "message": "Initialize repository (FlowDesk)",
            "content": content,
            "branch": branch,
        },
        timeout=20,
    )
    raise_for_response(r, action="Initialize repository")
    return branch


def _ensure_repo_ready_for_branches(token: str, owner: str, repo: str, base_branch: str) -> None:
    """No-op when the repo has commits; otherwise seed an initial README on the default branch."""
    try:
        _resolve_base_branch_sha(token, owner, repo, base_branch)
    except GitHubApiError as exc:
        if exc.http_status != 422 or "no commits" not in exc.detail.lower():
            raise
    else:
        return
    branch = (base_branch or "main").strip() or "main"
    try:
        branch = validate_branch_name(branch)
    except GitHubPathValidationError:
        branch = "main"
    _initialize_empty_repo(token, owner, repo, branch)


def commits_ahead(token: str, owner: str, repo: str, base: str, head: str) -> int:
    """How many commits ``head`` is ahead of ``base`` (0 when they point at the same commit)."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    base = validate_branch_name(base)
    head = validate_branch_name(head)
    if base == head:
        return 0
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/compare/{quote(base, safe='')}...{quote(head, safe='')}",
        headers=_headers(token),
        timeout=10,
    )
    if r.status_code == 404:
        return 0
    raise_for_response(r, action="Compare branches")
    return int(r.json().get("ahead_by") or 0)


def find_open_pull_request(
    token: str, owner: str, repo: str, head: str, base: str
) -> dict | None:
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    head = validate_branch_name(head)
    base = validate_branch_name(base)
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
        headers=_headers(token),
        params={"head": f"{owner}:{head}", "base": base, "state": "open"},
        timeout=10,
    )
    raise_for_response(r, action="List pull requests")
    items = r.json()
    return items[0] if items else None


def get_branch_sha(token: str, owner: str, repo: str, branch: str) -> str:
    """Return the commit SHA at the tip of a branch."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    branch = validate_branch_name(branch)
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/branches/{_encode_branch_path(branch)}",
        headers=_headers(token), timeout=10,
    )
    raise_for_response(r, action="Get branch")
    commit = r.json().get("commit") or {}
    sha = commit.get("sha")
    if not sha:
        raise GitHubApiError(502, "GitHub branch response did not include a commit SHA")
    return sha


def branch_exists(token: str, owner: str, repo: str, branch: str) -> bool:
    try:
        get_branch_sha(token, owner, repo, branch)
        return True
    except GitHubApiError as exc:
        if exc.http_status == 404:
            return False
        if exc.http_status == 422 and "no commits" in exc.detail.lower():
            return False
        raise


def create_branch(token: str, owner: str, repo: str, new_branch: str, base_branch: str) -> str:
    """Create a new branch off base_branch. Returns the branch's web URL.

    Idempotent: if ``new_branch`` already exists, returns its URL without error.
    """
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    new_branch = validate_branch_name(new_branch)
    if branch_exists(token, owner, repo, new_branch):
        return branch_tree_url(owner, repo, new_branch)
    _ensure_repo_ready_for_branches(token, owner, repo, base_branch)
    base_branch, sha = _resolve_base_branch_sha(token, owner, repo, base_branch)
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/refs",
        headers=_headers(token),
        json={"ref": f"refs/heads/{new_branch}", "sha": sha},
        timeout=10,
    )
    detail = _github_error_detail(r, "").lower()
    if r.status_code == 422 and "already exists" in detail:
        return branch_tree_url(owner, repo, new_branch)
    raise_for_response(r, action="Create branch")
    return branch_tree_url(owner, repo, new_branch)


def create_branch_tip_commit(token: str, owner: str, repo: str, branch: str, message: str) -> str:
    """Add a commit on ``branch`` (same tree as tip) so GitHub allows opening a pull request."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    branch = validate_branch_name(branch)
    head_sha = get_branch_sha(token, owner, repo, branch)
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/commits/{head_sha}",
        headers=_headers(token),
        timeout=10,
    )
    raise_for_response(r, action="Get commit")
    tree_sha = r.json()["tree"]["sha"]
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/commits",
        headers=_headers(token),
        json={"message": message, "tree": tree_sha, "parents": [head_sha]},
        timeout=10,
    )
    raise_for_response(r, action="Create commit")
    new_sha = r.json()["sha"]
    r = requests.patch(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/refs/{_encode_git_heads_ref(branch)}",
        headers=_headers(token),
        json={"sha": new_sha},
        timeout=10,
    )
    raise_for_response(r, action="Update branch")
    return new_sha


def create_pull_request(token: str, owner: str, repo: str, title: str, head: str,
                        base: str, body: str = "") -> dict:
    """Open a pull request and return the full PR object (number, html_url)."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    head = validate_branch_name(head)
    base = validate_branch_name(base)
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
        headers=_headers(token),
        json={"title": title, "head": head, "base": base, "body": body},
        timeout=10,
    )
    if r.status_code == 422:
        detail = _github_error_detail(r, "").lower()
        if "already exists" in detail:
            existing = find_open_pull_request(token, owner, repo, head, base)
            if existing:
                return existing
        if "no commits between" in detail:
            raise GitHubApiError(
                422,
                f"Branch '{head}' has no new commits yet. Push changes to GitHub, then create the pull request.",
            )
    raise_for_response(r, action="Create pull request")
    return r.json()


def get_pull_request(token: str, owner: str, repo: str, pull_number: int) -> dict:
    """Fetch a single pull request by number."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{int(pull_number)}",
        headers=_headers(token),
        timeout=10,
    )
    raise_for_response(r, action="Get pull request")
    return r.json()


def merge_pull_request(token: str, owner: str, repo: str, pull_number: int) -> dict:
    """Merge an open pull request (merge commit)."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.put(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{int(pull_number)}/merge",
        headers=_headers(token),
        json={"merge_method": "merge"},
        timeout=15,
    )
    raise_for_response(r, action="Merge pull request")
    return r.json()


def close_pull_request(token: str, owner: str, repo: str, pull_number: int) -> dict:
    """Close a pull request without merging."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.patch(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{int(pull_number)}",
        headers=_headers(token),
        json={"state": "closed"},
        timeout=10,
    )
    raise_for_response(r, action="Close pull request")
    return r.json()


def list_pull_requests(
    token: str, owner: str, repo: str, *, state: str = "open", limit: int = 30
) -> list[dict]:
    """List pull requests for a repository."""
    owner, repo = parse_repo_full_name(f"{owner}/{repo}")
    r = requests.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
        headers=_headers(token),
        params={"state": state, "per_page": min(100, limit), "sort": "updated", "direction": "desc"},
        timeout=15,
    )
    raise_for_response(r, action="List pull requests")
    return r.json()[:limit]


def open_pull_request_for_branch(
    token: str,
    owner: str,
    repo: str,
    *,
    title: str,
    head: str,
    base: str,
    body: str = "",
    commit_message: str | None = None,
) -> dict:
    """Ensure the head branch exists and open a PR, reusing an existing open PR when present."""
    head = validate_branch_name(head.strip())
    base = validate_branch_name(base.strip())
    if head == base:
        raise GitHubApiError(422, f"Head branch cannot be the same as base ({base})")

    if not branch_exists(token, owner, repo, head):
        create_branch(token, owner, repo, head, base)

    existing = find_open_pull_request(token, owner, repo, head, base)
    if existing:
        return existing

    if commits_ahead(token, owner, repo, base, head) == 0:
        seed_message = (commit_message or f"FlowDesk: prepare branch {head}").strip()
        create_branch_tip_commit(token, owner, repo, head, seed_message)

    return create_pull_request(token, owner, repo, title=title, head=head, base=base, body=body)


def search_code(token: str, query: str, limit: int = 30) -> list[dict]:
    """Connected search: code search across repos the token can access."""
    r = requests.get(
        f"{GITHUB_API}/search/code",
        headers=_headers(token),
        params={"q": query, "per_page": min(limit, 50)},
        timeout=15,
    )
    r.raise_for_status()
    return r.json().get("items", [])
