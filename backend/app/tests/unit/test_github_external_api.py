"""Unit tests — GitHub REST API client (mocked HTTP)."""
from unittest.mock import MagicMock, patch

import pytest
import requests

from app.services import github_api_service as gh


@pytest.mark.unit
def test_raise_for_response_maps_401():
    response = MagicMock(ok=False, status_code=401)
    with pytest.raises(gh.GitHubApiError) as exc:
        gh.raise_for_response(response)
    assert exc.value.http_status == 401
    assert "reconnect" in exc.value.detail.lower()


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_verify_token(mock_get):
    mock_get.return_value = MagicMock(status_code=200)
    assert gh.verify_token("token") is True
    mock_get.return_value = MagicMock(status_code=401)
    assert gh.verify_token("bad") is False


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_get_authenticated_user(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"login": "octocat", "id": 1})
    result = gh.get_authenticated_user("token")
    assert result["login"] == "octocat"
    assert "/user" in mock_get.call_args[0][0]


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_list_accessible_repos_pagination(mock_get):
    page1 = [{"id": i, "full_name": f"org/r{i}"} for i in range(100)]
    page2 = [{"id": 100, "full_name": "org/r100"}]
    mock_get.side_effect = [
        MagicMock(ok=True, json=lambda p=page1: p),
        MagicMock(ok=True, json=lambda p=page2: p),
    ]
    repos = gh.list_accessible_repos("token")
    assert len(repos) == 101


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_get_repo(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"id": 42, "default_branch": "main"})
    repo = gh.get_repo("token", "acme", "app")
    assert repo["id"] == 42


@pytest.mark.unit
@patch("app.services.github_api_service.requests.post")
def test_create_webhook_success(mock_post):
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"id": 999})
    hook_id = gh.create_webhook("token", "acme", "app", "https://hook", "secret")
    assert hook_id == 999


@pytest.mark.unit
@patch("app.services.github_api_service.requests.post")
def test_create_webhook_http_error_returns_none(mock_post):
    response = MagicMock(ok=False)
    response.raise_for_status.side_effect = requests.HTTPError()
    mock_post.return_value = response
    assert gh.create_webhook("token", "acme", "app", "https://hook", "secret") is None


@pytest.mark.unit
@patch("app.services.github_api_service.requests.post")
def test_create_issue(mock_post):
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"number": 7, "html_url": "https://gh/7"})
    issue = gh.create_issue("token", "acme", "app", "Title", "Body")
    assert issue["number"] == 7


@pytest.mark.unit
@patch("app.services.github_api_service.requests.patch")
def test_update_issue_state(mock_patch):
    mock_patch.return_value = MagicMock(ok=True)
    gh.update_issue_state("token", "acme", "app", 7, "closed")
    mock_patch.assert_called_once()


@pytest.mark.unit
@patch("app.services.github_api_service.requests.delete")
def test_delete_webhook_swallows_errors(mock_delete):
    mock_delete.side_effect = RuntimeError("network")
    gh.delete_webhook("token", "acme", "app", 1)


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_get_issue(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"number": 3, "state": "closed"})
    issue = gh.get_issue("token", "acme", "app", 3)
    assert issue["state"] == "closed"
    assert "/issues/3" in mock_get.call_args[0][0]


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_get_branch_sha(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"commit": {"sha": "abc123"}})
    assert gh.get_branch_sha("token", "acme", "app", "main") == "abc123"
    assert mock_get.call_args[0][0].endswith("/branches/main")


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_get_branch_sha_encodes_slashes_in_branch_name(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"commit": {"sha": "abc123"}})
    gh.get_branch_sha("token", "acme", "app", "user/task-1")
    assert "/branches/user%2Ftask-1" in mock_get.call_args[0][0]


@pytest.mark.unit
@patch("app.services.github_api_service.requests.post")
@patch("app.services.github_api_service._resolve_base_branch_sha")
@patch("app.services.github_api_service.branch_exists", return_value=False)
def test_create_branch(mock_exists, mock_resolve, mock_post):
    mock_resolve.return_value = ("main", "deadbeef")
    mock_post.return_value = MagicMock(ok=True)
    url = gh.create_branch("token", "acme", "app", "feature/x", "main")
    assert url == "https://github.com/acme/app/tree/feature/x"


@pytest.mark.unit
@patch("app.services.github_api_service.get_branch_sha")
def test_create_branch_when_branch_already_exists(mock_sha):
    mock_sha.return_value = "abc123"
    url = gh.create_branch("token", "acme", "app", "feature/x", "main")
    assert url == "https://github.com/acme/app/tree/feature/x"
    assert mock_sha.call_count == 1


@pytest.mark.unit
@patch("app.services.github_api_service.requests.put")
@patch("app.services.github_api_service._resolve_base_branch_sha")
@patch("app.services.github_api_service.branch_exists", return_value=False)
@patch("app.services.github_api_service.requests.post")
def test_create_branch_initializes_empty_repo(mock_post, mock_exists, mock_resolve, mock_put):
    mock_resolve.side_effect = [
        gh.GitHubApiError(422, "This GitHub repository has no commits yet."),
        ("main", "deadbeef"),
    ]
    mock_put.return_value = MagicMock(ok=True, json=lambda: {})
    mock_post.return_value = MagicMock(ok=True)
    url = gh.create_branch("token", "acme", "app", "feature/x", "main")
    assert url == "https://github.com/acme/app/tree/feature/x"
    mock_put.assert_called_once()


@pytest.mark.unit
@patch("app.services.github_api_service.create_pull_request")
@patch("app.services.github_api_service.commits_ahead", return_value=1)
@patch("app.services.github_api_service.find_open_pull_request", return_value=None)
@patch("app.services.github_api_service.branch_exists", return_value=True)
def test_open_pull_request_for_branch(mock_exists, mock_find, mock_ahead, mock_create):
    mock_create.return_value = {"number": 5, "html_url": "https://github.com/acme/app/pull/5"}
    pr = gh.open_pull_request_for_branch(
        "token", "acme", "app", title="Fix", head="feature/x", base="main", body="body"
    )
    assert pr["number"] == 5


@pytest.mark.unit
@patch("app.services.github_api_service.create_pull_request")
@patch("app.services.github_api_service.create_branch_tip_commit")
@patch("app.services.github_api_service.find_open_pull_request", return_value=None)
@patch("app.services.github_api_service.commits_ahead", return_value=0)
@patch("app.services.github_api_service.branch_exists", return_value=True)
def test_open_pull_request_seeds_commit_when_branch_matches_base(
    mock_exists, mock_ahead, mock_find, mock_seed, mock_create,
):
    mock_create.return_value = {"number": 5, "html_url": "https://github.com/acme/app/pull/5"}
    pr = gh.open_pull_request_for_branch(
        "token", "acme", "app", title="Fix", head="feature/x", base="main",
        commit_message="FlowDesk: TASK-1",
    )
    assert pr["number"] == 5
    mock_seed.assert_called_once_with("token", "acme", "app", "feature/x", "FlowDesk: TASK-1")
    mock_create.assert_called_once()


@pytest.mark.unit
def test_github_error_detail_prefers_specific_validation_errors():
    response = MagicMock()
    response.json.return_value = {
        "message": "Validation Failed",
        "errors": [{"message": "No commits between main and feature-x"}],
    }
    detail = gh._github_error_detail(response, "fallback")
    assert detail == "No commits between main and feature-x"


@pytest.mark.unit
@patch("app.services.github_api_service.requests.post")
def test_create_pull_request(mock_post):
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"number": 3, "html_url": "https://gh/pr/3"})
    pr = gh.create_pull_request("token", "acme", "app", "Fix", "feature/x", "main", "Body")
    assert pr["number"] == 3


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_search_code(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"items": [{"name": "main.py"}]})
    items = gh.search_code("token", "class Foo")
    assert items[0]["name"] == "main.py"


@pytest.mark.unit
@pytest.mark.parametrize(
    "status,expected_fragment",
    [
        (403, "permission"),
        (404, "not found"),
        (422, "rejected"),
        (503, "failed"),
    ],
)
def test_raise_for_response_maps_status_codes(status, expected_fragment):
    response = MagicMock(ok=False, status_code=status)
    if status == 422:
        response.json.return_value = {"message": "GitHub rejected the request — check repository settings"}
    with pytest.raises(gh.GitHubApiError) as exc:
        gh.raise_for_response(response)
    assert exc.value.http_status == (502 if status == 503 else status)
    assert expected_fragment in exc.value.detail.lower()


@pytest.mark.unit
def test_verify_token_empty_and_network_error():
    assert gh.verify_token("") is False
    with patch("app.services.github_api_service.requests.get", side_effect=requests.RequestException("timeout")):
        assert gh.verify_token("token") is False


@pytest.mark.unit
def test_github_error_detail_fallbacks():
    response = MagicMock()
    response.json.side_effect = ValueError("bad json")
    assert gh._github_error_detail(response, "fallback") == "fallback"

    response.json.side_effect = None
    response.json.return_value = []
    assert gh._github_error_detail(response, "fallback") == "fallback"

    response.json.return_value = {"message": "Validation Failed", "errors": [{"code": "custom"}]}
    assert gh._github_error_detail(response, "fallback") == "custom"


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_commits_ahead_same_branch_returns_zero(mock_get):
    assert gh.commits_ahead("token", "acme", "app", "main", "main") == 0
    mock_get.assert_not_called()


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_commits_ahead_missing_compare_returns_zero(mock_get):
    mock_get.return_value = MagicMock(ok=False, status_code=404)
    assert gh.commits_ahead("token", "acme", "app", "main", "feature/x") == 0


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_commits_ahead_returns_ahead_by(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"ahead_by": 3})
    assert gh.commits_ahead("token", "acme", "app", "main", "feature/x") == 3


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_find_open_pull_request(mock_get):
    mock_get.return_value = MagicMock(ok=True, json=lambda: [{"number": 9, "html_url": "https://gh/9"}])
    pr = gh.find_open_pull_request("token", "acme", "app", "feature/x", "main")
    assert pr["number"] == 9

    mock_get.return_value = MagicMock(ok=True, json=lambda: [])
    assert gh.find_open_pull_request("token", "acme", "app", "feature/x", "main") is None


@pytest.mark.unit
@patch("app.services.github_api_service.get_branch_sha", return_value="abc")
def test_branch_exists_true(mock_sha):
    assert gh.branch_exists("token", "acme", "app", "main") is True


@pytest.mark.unit
@patch("app.services.github_api_service.get_branch_sha", side_effect=gh.GitHubApiError(404, "missing"))
def test_branch_exists_false_on_404(mock_sha):
    assert gh.branch_exists("token", "acme", "app", "missing") is False


@pytest.mark.unit
@patch("app.services.github_api_service.get_branch_sha", side_effect=gh.GitHubApiError(403, "forbidden"))
def test_branch_exists_reraises_non_404(mock_sha):
    with pytest.raises(gh.GitHubApiError) as exc:
        gh.branch_exists("token", "acme", "app", "main")
    assert exc.value.http_status == 403


@pytest.mark.unit
@patch("app.services.github_api_service.requests.patch")
@patch("app.services.github_api_service.requests.post")
@patch("app.services.github_api_service.requests.get")
@patch("app.services.github_api_service.get_branch_sha", return_value="head-sha")
def test_create_branch_tip_commit(mock_sha, mock_get, mock_post, mock_patch):
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"tree": {"sha": "tree-sha"}})
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"sha": "new-sha"})
    mock_patch.return_value = MagicMock(ok=True)

    sha = gh.create_branch_tip_commit("token", "acme", "app", "feature/x", "FlowDesk: TASK-1")

    assert sha == "new-sha"
    mock_post.assert_called_once()
    assert mock_post.call_args.kwargs["json"]["message"] == "FlowDesk: TASK-1"
    mock_patch.assert_called_once()
    assert "/git/refs/heads%2Ffeature%2Fx" in mock_patch.call_args[0][0]


@pytest.mark.unit
@patch("app.services.github_api_service.find_open_pull_request")
@patch("app.services.github_api_service.requests.post")
def test_create_pull_request_reuses_existing_open_pr(mock_post, mock_find):
    mock_post.return_value = MagicMock(
        ok=False,
        status_code=422,
        json=lambda: {"message": "Validation Failed", "errors": [{"message": "A pull request already exists"}]},
    )
    mock_find.return_value = {"number": 4, "html_url": "https://gh/4"}
    pr = gh.create_pull_request("token", "acme", "app", "Title", "feature/x", "main")
    assert pr["number"] == 4


@pytest.mark.unit
@patch("app.services.github_api_service.requests.post")
def test_create_pull_request_no_commits_between_raises(mock_post):
    mock_post.return_value = MagicMock(
        ok=False,
        status_code=422,
        json=lambda: {
            "message": "Validation Failed",
            "errors": [{"message": "No commits between main and feature-x"}],
        },
    )
    with pytest.raises(gh.GitHubApiError) as exc:
        gh.create_pull_request("token", "acme", "app", "Title", "feature/x", "main")
    assert exc.value.http_status == 422
    assert "no new commits" in exc.value.detail.lower()


@pytest.mark.unit
@patch("app.services.github_api_service._resolve_base_branch_sha", return_value=("main", "deadbeef"))
@patch("app.services.github_api_service.branch_exists", return_value=False)
@patch("app.services.github_api_service.requests.post")
def test_create_branch_handles_github_already_exists(mock_exists, mock_post, mock_resolve):
    mock_post.return_value = MagicMock(
        ok=False,
        status_code=422,
        json=lambda: {"message": "Validation Failed", "errors": [{"message": "Reference already exists"}]},
    )
    url = gh.create_branch("token", "acme", "app", "feature/x", "main")
    assert url == "https://github.com/acme/app/tree/feature/x"


@pytest.mark.unit
@patch("app.services.github_api_service.get_repo", return_value={"default_branch": "develop"})
@patch("app.services.github_api_service.get_branch_sha")
def test_resolve_base_branch_sha_uses_live_default(mock_sha, mock_repo):
    mock_sha.side_effect = [gh.GitHubApiError(404, "missing"), "develop-sha"]
    branch, sha = gh._resolve_base_branch_sha("token", "acme", "app", "main")
    assert branch == "develop"
    assert sha == "develop-sha"


@pytest.mark.unit
@patch("app.services.github_api_service.get_repo", side_effect=gh.GitHubApiError(403, "forbidden"))
@patch("app.services.github_api_service.get_branch_sha", side_effect=gh.GitHubApiError(404, "missing"))
def test_resolve_base_branch_sha_empty_repo_message(mock_sha, mock_repo):
    with pytest.raises(gh.GitHubApiError) as exc:
        gh._resolve_base_branch_sha("token", "acme", "app", "main")
    assert exc.value.http_status == 422
    assert "no commits" in exc.value.detail.lower()


@pytest.mark.unit
@patch("app.services.github_api_service.create_branch")
@patch("app.services.github_api_service.find_open_pull_request", return_value={"number": 2})
@patch("app.services.github_api_service.branch_exists", return_value=False)
def test_open_pull_request_creates_branch_and_reuses_existing_pr(mock_exists, mock_find, mock_create):
    pr = gh.open_pull_request_for_branch(
        "token", "acme", "app", title="Fix", head="feature/x", base="main",
    )
    assert pr["number"] == 2
    mock_create.assert_called_once_with("token", "acme", "app", "feature/x", "main")


@pytest.mark.unit
def test_open_pull_request_rejects_head_same_as_base():
    with pytest.raises(gh.GitHubApiError) as exc:
        gh.open_pull_request_for_branch(
            "token", "acme", "app", title="Fix", head="main", base="main",
        )
    assert exc.value.http_status == 422
    assert "same as base" in exc.value.detail.lower()


@pytest.mark.unit
@patch("app.services.github_api_service.create_pull_request")
@patch("app.services.github_api_service.create_branch_tip_commit")
@patch("app.services.github_api_service.find_open_pull_request", return_value=None)
@patch("app.services.github_api_service.commits_ahead", return_value=0)
@patch("app.services.github_api_service.branch_exists", return_value=True)
def test_open_pull_request_default_seed_message(
    mock_exists, mock_ahead, mock_find, mock_seed, mock_create,
):
    mock_create.return_value = {"number": 1, "html_url": "https://gh/1"}
    gh.open_pull_request_for_branch(
        "token", "acme", "app", title="Fix", head="feature/x", base="main",
    )
    mock_seed.assert_called_once_with("token", "acme", "app", "feature/x", "FlowDesk: prepare branch feature/x")


@pytest.mark.unit
@patch("app.services.github_api_service.requests.get")
def test_list_open_issues_paginates(mock_get):
    page1 = [{"number": i} for i in range(100)]
    page2 = [{"number": 100}]
    mock_get.side_effect = [
        MagicMock(ok=True, json=lambda p=page1: p),
        MagicMock(ok=True, json=lambda p=page2: p),
    ]
    issues = gh.list_open_issues("token", "acme", "app", limit=101)
    assert len(issues) == 101
    assert mock_get.call_count == 2


@pytest.mark.unit
@patch("app.services.github_api_service.requests.patch")
@patch("app.services.github_api_service.requests.post")
def test_ensure_label_updates_existing_on_422(mock_post, mock_patch):
    mock_post.return_value = MagicMock(status_code=422)
    gh.ensure_label("token", "acme", "app", "flowdesk: Done", "0f0")
    mock_patch.assert_called_once()


@pytest.mark.unit
@patch("app.services.github_api_service.add_issue_labels")
@patch("app.services.github_api_service.remove_issue_label")
@patch("app.services.github_api_service.list_issue_labels", return_value=["flowdesk: Old"])
@patch("app.services.github_api_service.ensure_label")
@patch("app.services.github_api_service.update_issue_state")
def test_sync_issue_status_replaces_stale_label(
    mock_state, mock_ensure, mock_list, mock_remove, mock_add,
):
    gh.sync_issue_status(
        "token", "acme", "app", 7,
        state="open", label_name="flowdesk: In Progress", label_color="00f",
    )
    mock_state.assert_called_once()
    mock_remove.assert_called_once()
    mock_add.assert_called_once()


@pytest.mark.unit
@patch("app.services.github_api_service.requests.patch")
def test_patch_issue_updates_title_and_body(mock_patch):
    mock_patch.return_value = MagicMock(ok=True)
    gh.patch_issue("token", "acme", "app", 3, title="T", body="B")
    mock_patch.assert_called_once()
    payload = mock_patch.call_args.kwargs["json"]
    assert payload["title"] == "T"
    assert payload["body"] == "B"


@pytest.mark.unit
@patch("app.services.github_api_service.requests.put")
def test_merge_pull_request(mock_put):
    mock_put.return_value = MagicMock(ok=True, json=lambda: {"merged": True, "sha": "abc"})
    result = gh.merge_pull_request("token", "acme", "app", 5)
    assert result["merged"] is True
    mock_put.assert_called_once()


@pytest.mark.unit
@patch("app.services.github_api_service.requests.patch")
def test_close_pull_request(mock_patch):
    mock_patch.return_value = MagicMock(ok=True, json=lambda: {"number": 5, "state": "closed"})
    result = gh.close_pull_request("token", "acme", "app", 5)
    assert result["state"] == "closed"


@pytest.mark.unit
@patch("app.services.github_api_service.update_issue_state", side_effect=RuntimeError("gh"))
@patch("app.services.github_api_service.ensure_label")
def test_sync_issue_status_swallows_state_errors(mock_ensure, mock_state):
    gh.sync_issue_status("token", "acme", "app", 1, state="closed", label_name=None)
    mock_state.assert_called_once()
