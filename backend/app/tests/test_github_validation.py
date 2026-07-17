"""Unit tests for GitHub path validation."""
import uuid

import pytest
from pydantic import ValidationError

from app.schemas.github import RepositoryConnect
from app.services.github_api_service import (
    GitHubPathValidationError,
    parse_repo_full_name,
    validate_branch_name,
)


def test_parse_repo_full_name_accepts_valid_names():
    owner, repo = parse_repo_full_name("octocat/Hello-World")
    assert owner == "octocat"
    assert repo == "Hello-World"


@pytest.mark.parametrize(
    "value",
    [
        "owner/repo/extra",
        "owner",
        "owner/../evil",
        "owner%2frepo",
        "/repo",
        "owner/",
    ],
)
def test_parse_repo_full_name_rejects_unsafe_values(value: str):
    with pytest.raises(GitHubPathValidationError):
        parse_repo_full_name(value)


@pytest.mark.parametrize(
    "branch",
    ["feature/foo", "release-1.0", "bugfix_123"],
)
def test_validate_branch_name_accepts_safe_names(branch: str):
    assert validate_branch_name(branch) == branch


@pytest.mark.parametrize(
    "branch",
    ["../main", "@evil", "bad branch", "a//b", "%2e%2e"],
)
def test_validate_branch_name_rejects_unsafe_names(branch: str):
    with pytest.raises(GitHubPathValidationError):
        validate_branch_name(branch)


def test_repository_connect_rejects_unsafe_default_branch():
    with pytest.raises(ValidationError):
        RepositoryConnect(
            installation_id=uuid.uuid4(),
            repo_id=1,
            repo_full_name="octocat/Hello-World",
            default_branch="../main",
        )
