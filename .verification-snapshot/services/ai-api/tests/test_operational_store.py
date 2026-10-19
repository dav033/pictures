from app.operational_store import InMemoryOperationalStore, StoredHttpResponse


HASH_A = "a" * 64
HASH_B = "b" * 64
REQUEST_ID = "00000000-0000-4000-8000-000000000001"
CORRELATION_ID = "00000000-0000-4000-8000-000000000002"


def _claim(store: InMemoryOperationalStore, *, key: str = "same", body: str = HASH_A):
    return store.claim(
        scope="ai.echo",
        idempotency_key=key,
        body_sha256=body,
        request_id=REQUEST_ID,
        correlation_id=CORRELATION_ID,
    )


def test_operational_store_covers_new_in_flight_conflict_replay_and_ttl() -> None:
    now = [100.0]
    store = InMemoryOperationalStore(
        idempotency_ttl_seconds=10,
        max_idempotency_ttl_seconds=10,
        nonce_ttl_seconds=5,
        max_nonce_ttl_seconds=5,
        clock=lambda: now[0],
    )

    assert _claim(store).kind == "new"
    assert _claim(store).kind == "in_flight"
    assert _claim(store, body=HASH_B).kind == "conflict"
    store.complete(
        scope="ai.echo",
        idempotency_key="same",
        body_sha256=HASH_A,
        response=StoredHttpResponse({"ok": True}, 200),
    )
    replay = _claim(store)
    assert replay.kind == "replay"
    assert replay.response == StoredHttpResponse({"ok": True}, 200)

    now[0] = 111.0
    assert _claim(store).kind == "new"


def test_operational_store_nonce_is_one_use_until_ttl() -> None:
    now = [100.0]
    store = InMemoryOperationalStore(
        nonce_ttl_seconds=5,
        max_nonce_ttl_seconds=5,
        clock=lambda: now[0],
    )
    nonce = "00000000-0000-0000-0000-000000000003"

    assert store.consume_nonce("ai-api", nonce).kind == "accepted"
    assert store.consume_nonce("ai-api", nonce).kind == "replay"
    now[0] = 106.0
    assert store.consume_nonce("ai-api", nonce).kind == "accepted"
