"""Phase 6 — OAuth token vault encrypt/decrypt at rest."""
import pytest

from app.services import token_vault


@pytest.mark.coverage
def test_token_vault_seal_reveal_roundtrip():
    plain = "ya29.access-token-value"
    sealed = token_vault.seal(plain)
    assert sealed != plain
    assert sealed.startswith("enc:v1:")
    assert token_vault.reveal(sealed) == plain


@pytest.mark.coverage
def test_token_vault_reveal_legacy_plaintext():
    assert token_vault.reveal("legacy-plain-token") == "legacy-plain-token"


@pytest.mark.coverage
def test_token_vault_reveal_invalid_ciphertext_returns_none():
    assert token_vault.reveal("enc:v1:not-valid-fernet") is None


@pytest.mark.coverage
def test_token_vault_handles_empty():
    assert token_vault.seal(None) is None
    assert token_vault.reveal(None) is None


@pytest.mark.coverage
def test_token_vault_seal_already_sealed():
    sealed = "enc:v1:already-sealed"
    assert token_vault.seal(sealed) is sealed
