"""GitHub REST API calls using a user OAuth access token."""
import requests

GITHUB_API = "https://api.github.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


def get_authenticated_user(token: str) -> dict:
    r = requests.get(f"{GITHUB_API}/user", headers=_headers(token), timeout=10)
    r.raise_for_status()
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
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        repos.extend(batch)
        page += 1
        if len(batch) < 100:
            break
    return repos


def get_repo(token: str, owner: str, repo: str) -> dict:
    r = requests.get(f"{GITHUB_API}/repos/{owner}/{repo}", headers=_headers(token), timeout=10)
    r.raise_for_status()
    return r.json()


def create_webhook(token: str, owner: str, repo: str, webhook_url: str, secret: str) -> int | None:
    """Create a webhook on the repo. Returns the hook ID, or None if creation fails."""
    payload = {
        "name": "web",
        "active": True,
        "events": ["push", "pull_request", "issues"],
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
    r = requests.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues",
        headers=_headers(token),
        json={"title": title, "body": body},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def delete_webhook(token: str, owner: str, repo: str, hook_id: int) -> None:
    try:
        requests.delete(
            f"{GITHUB_API}/repos/{owner}/{repo}/hooks/{hook_id}",
            headers=_headers(token),
            timeout=10,
        )
    except Exception:
        pass
