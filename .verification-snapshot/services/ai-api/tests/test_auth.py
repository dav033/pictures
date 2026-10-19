import hashlib
import hmac

import pytest

from app.auth import (
    CONTRACT_VERSION,
    InMemoryNonceStore,
    canonical_signature_input,
    sha256_body,
    sign_request,
    verify_request,
)


SECRET = "s" * 32
TIMESTAMP = 1_700_000_000
NONCE = "123e4567-e89b-12d3-a456-426614174000"
METHOD = "post"
PATH = "/internal/ai/run"
BODY = '{"prompt":"hola"}'
BODY_SHA256 = hashlib.sha256(BODY.encode()).hexdigest()


def test_signature_matches_typescript_canonicalization() -> None:
    scopes = ["ai:run", "catalog.read"]
    canonical = f"{TIMESTAMP}.{NONCE}.POST.{PATH}.{BODY_SHA256}.ai:run,catalog.read"
    expected = hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()

    signature = sign_request(
        secret=SECRET,
        method=METHOD,
        path=PATH,
        body_sha256=BODY_SHA256,
        scopes=scopes,
        timestamp=TIMESTAMP,
        nonce=NONCE,
    )

    assert signature == {
        "schema_version": CONTRACT_VERSION,
        "timestamp": TIMESTAMP,
        "nonce": NONCE,
        "signature": expected,
        "scopes": scopes,
    }
    assert (
        canonical_signature_input(
            timestamp=TIMESTAMP,
            nonce=NONCE,
            method=METHOD,
            path=PATH,
            body_sha256=BODY_SHA256,
            scopes=scopes,
        )
        == canonical
    )


def test_body_hash_timestamp_and_scopes_are_verified() -> None:
    signature = sign_request(
        secret=SECRET,
        method="POST",
        path=PATH,
        body_sha256=sha256_body(BODY),
        scopes=["ai:run", "catalog.read"],
        timestamp=TIMESTAMP,
        nonce=NONCE,
    )

    assert verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP + 300,
        required_scopes=["ai:run"],
    )
    assert not verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=sha256_body("cuerpo distinto"),
        now_seconds=TIMESTAMP,
        required_scopes=["ai:run"],
    )
    assert not verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP + 301,
        required_scopes=["ai:run"],
    )
    assert not verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP,
        required_scopes=["admin"],
    )


def test_invalid_secret_and_scopes_fail_closed() -> None:
    with pytest.raises(ValueError, match="INTERNAL_AUTH_SECRET_TOO_SHORT"):
        sign_request(
            secret="short",
            method="POST",
            path=PATH,
            body_sha256=BODY_SHA256,
            timestamp=TIMESTAMP,
            nonce=NONCE,
        )

    signature = sign_request(
        secret=SECRET,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        timestamp=TIMESTAMP,
        nonce=NONCE,
    )
    malformed = {**signature, "scopes": ["not valid"]}
    assert not verify_request(
        secret=SECRET,
        signature=malformed,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP,
    )
    assert not verify_request(
        secret="short",
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP,
    )


def test_nonce_store_rejects_duplicate_and_replay_until_ttl_expires() -> None:
    store = InMemoryNonceStore(ttl_seconds=10)
    signature = sign_request(
        secret=SECRET,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        timestamp=TIMESTAMP,
        nonce=NONCE,
    )

    assert verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP,
        nonce_store=store,
    )
    assert not verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP,
        nonce_store=store,
    )
    assert verify_request(
        secret=SECRET,
        signature=signature,
        method="POST",
        path=PATH,
        body_sha256=BODY_SHA256,
        now_seconds=TIMESTAMP + 11,
        nonce_store=store,
    )
