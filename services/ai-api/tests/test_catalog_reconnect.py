"""Catalog reads survive a connection the server already closed (E2E 2026-09-14, D8).

Neon closes idle connections and suspends compute after about five minutes;
the next request failed with "Connection terminated unexpectedly". Catalog
statements are single reads, so each one is retried once on a fresh connection.
No database: fake pools simulate the failure.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager

import asyncpg
import pytest

from app.catalog import (
    POOL_MAX_INACTIVE_CONNECTION_LIFETIME_SECONDS,
    CatalogStore,
    is_terminated_connection,
)


class FakeConnection:
    def __init__(self, failure: Exception | None) -> None:
        self.failure = failure
        self.calls = 0

    async def fetch(self, query: str, *args: object) -> Sequence[Mapping[str, object]]:
        self.calls += 1
        if self.failure is not None:
            raise self.failure
        return [{"product_id": "p1", "variant_id": "v1"}]

    async def fetchval(self, query: str, *args: object) -> object:
        self.calls += 1
        if self.failure is not None:
            raise self.failure
        return args[0]


class FakePool:
    def __init__(self, *connections: FakeConnection) -> None:
        self.connections = list(connections)
        self.acquired: list[FakeConnection] = []
        self.released: list[FakeConnection] = []

    @asynccontextmanager
    async def _acquire(self) -> AsyncIterator[FakeConnection]:
        connection = self.connections.pop(0)
        self.acquired.append(connection)
        try:
            yield connection
        finally:
            self.released.append(connection)

    def acquire(self) -> AbstractAsyncContextManager[FakeConnection]:
        return self._acquire()

    async def close(self) -> None:
        return None


def test_terminated_connection_errors_are_recognized() -> None:
    assert is_terminated_connection(asyncpg.exceptions.ConnectionDoesNotExistError("closed"))
    assert is_terminated_connection(asyncpg.exceptions.InterfaceError("connection is closed"))
    assert is_terminated_connection(ConnectionResetError())
    assert not is_terminated_connection(
        asyncpg.exceptions.InterfaceError("another operation is in progress")
    )
    assert not is_terminated_connection(asyncpg.exceptions.UndefinedTableError("missing"))
    assert not is_terminated_connection(TimeoutError())


def test_idle_connections_close_before_the_neon_cut() -> None:
    assert 0 < POOL_MAX_INACTIVE_CONNECTION_LIFETIME_SECONDS < 300


@pytest.mark.anyio
async def test_a_read_on_a_terminated_connection_is_retried_once() -> None:
    broken = FakeConnection(asyncpg.exceptions.ConnectionDoesNotExistError("connection closed"))
    fresh = FakeConnection(None)
    pool = FakePool(broken, fresh)
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)  # type: ignore[arg-type]

    assert await store.published_snapshot("snap-1") == "snap-1"
    assert broken.calls == 1 and fresh.calls == 1
    assert pool.released == [fresh, broken], "both connections go back to the pool"


@pytest.mark.anyio
async def test_the_retry_is_bounded_and_other_errors_surface() -> None:
    failure = asyncpg.exceptions.ConnectionDoesNotExistError("connection closed")
    pool = FakePool(FakeConnection(failure), FakeConnection(failure))
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)  # type: ignore[arg-type]
    with pytest.raises(asyncpg.exceptions.ConnectionDoesNotExistError):
        await store.fetch_plan_rows("snap-1", ["p1"], ["v1"])
    assert [connection.calls for connection in pool.acquired] == [1, 1]

    missing = FakeConnection(asyncpg.exceptions.UndefinedTableError("catalog_variants"))
    other = FakePool(missing, FakeConnection(None))
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=other)  # type: ignore[arg-type]
    with pytest.raises(asyncpg.exceptions.UndefinedTableError):
        await store.fetch_plan_rows("snap-1", ["p1"], ["v1"])
    assert len(other.acquired) == 1, "a non-connection error is not retried"
