"""Generate catalog document embeddings in Python, outside the request path."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import cast

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.catalog_embeddings import (  # noqa: E402
    DEFAULT_EMBEDDING_DIMENSIONS,
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingProvider,
    EmbeddingSettings,
    GeminiEmbeddingProvider,
    embed_with_retry,
    source_hash,
    validate_embedding_batch,
    vector_literal,
)


LEASE_DURATION_SECONDS = 6 * 60 * 60
LEASE_REFRESH_SECONDS = 30


PENDING_SQL = """
SELECT
  p.product_id,
  p.search_text,
  p.embedding_source_hash
FROM catalog_products AS p
LEFT JOIN catalog_embeddings AS e ON e.product_id = p.product_id
WHERE e.product_id IS NULL
   OR e.embedding_source_hash IS DISTINCT FROM p.embedding_source_hash
   OR e.model IS DISTINCT FROM $1
   OR e.embedding_dimensions IS DISTINCT FROM $2
   OR e.embedding_task_type IS DISTINCT FROM $3
   OR vector_dims(e.embedding) IS DISTINCT FROM $2
ORDER BY p.product_id
"""

UPSERT_SQL = """
WITH current_product AS (
  SELECT product_id
  FROM catalog_products
  WHERE product_id = $1 AND embedding_source_hash = $3
  FOR UPDATE
)
INSERT INTO catalog_embeddings (
  product_id,
  embedding,
  embedding_source_hash,
  model,
  embedding_dimensions,
  embedding_task_type
)
SELECT $1, $2::vector, $3, $4, $5, $6
WHERE EXISTS (SELECT 1 FROM current_product)
ON CONFLICT (product_id) DO UPDATE SET
  embedding = EXCLUDED.embedding,
  embedding_source_hash = EXCLUDED.embedding_source_hash,
  model = EXCLUDED.model,
  embedding_dimensions = EXCLUDED.embedding_dimensions,
  embedding_task_type = EXCLUDED.embedding_task_type,
  created_at = now()
  RETURNING product_id
"""

INVALID_SOURCE_SQL = """
SELECT search_text, embedding_source_hash
FROM catalog_products
"""

TELEMETRY_SQL = """
INSERT INTO ai_call_log (
  flujo, capacidad, proveedor, modelo, superficie, intento, ms, resultado
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
"""


@dataclass(frozen=True, slots=True)
class ProductToEmbed:
    product_id: str
    search_text: str
    embedding_source_hash: str


@dataclass(slots=True)
class Summary:
    selected: int = 0
    succeeded: int = 0
    stale: int = 0
    failed: int = 0
    invalid: int = 0


class Checkpoint:
    """Atomic, secret-free progress file for restarting an interrupted run."""

    def __init__(self, path: Path, settings: EmbeddingSettings) -> None:
        self.path = path
        self.config = {
            "model": settings.model,
            "dimensions": settings.dimensions,
            "task_type": settings.task_type,
        }
        self.items: dict[str, dict[str, object]] = {}
        self._lock = asyncio.Lock()
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, TypeError, json.JSONDecodeError):
            raise RuntimeError("EMBEDDING_CHECKPOINT_INVALID") from None
        if not isinstance(payload, dict):
            raise RuntimeError("EMBEDDING_CHECKPOINT_INVALID")
        if payload.get("version") != 1 or payload.get("config") != self.config:
            raise RuntimeError("EMBEDDING_CHECKPOINT_CONFIG_MISMATCH")
        items = payload.get("items", {})
        if not isinstance(items, dict) or not all(
            isinstance(key, str) and isinstance(item, dict) for key, item in items.items()
        ):
            raise RuntimeError("EMBEDDING_CHECKPOINT_INVALID")
        self.items = cast(dict[str, dict[str, object]], items)

    async def record(
        self,
        product: ProductToEmbed,
        *,
        status: str,
        attempts: int = 0,
        error: str | None = None,
    ) -> None:
        async with self._lock:
            self.items[product.product_id] = {
                "source_hash": product.embedding_source_hash,
                "status": status,
                "attempts": attempts,
                "error": error[:500] if error else None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            await asyncio.to_thread(self._write)

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "config": self.config,
            "items": self.items,
        }
        fd, temporary = tempfile.mkstemp(
            prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=True, sort_keys=True, indent=2)
                handle.write("\n")
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def _positive_int(value: str, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"{name} debe ser entero") from error
    if parsed < 1:
        raise argparse.ArgumentTypeError(f"{name} debe ser >= 1")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="selecciona sin llamar Gemini ni escribir"
    )
    parser.add_argument("--limit", type=lambda value: _positive_int(value, "--limit"))
    parser.add_argument(
        "--batch-size",
        type=lambda value: _positive_int(value, "--batch-size"),
        default=int(os.getenv("RAG_EMBED_BATCH_SIZE", "8")),
    )
    parser.add_argument(
        "--concurrency",
        type=lambda value: _positive_int(value, "--concurrency"),
        default=int(os.getenv("RAG_EMBED_CONCURRENCY", "2")),
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path(
            os.getenv("RAG_EMBED_CHECKPOINT", "data/staging/rag-embedding-checkpoint.json")
        ),
    )
    return parser.parse_args()


def settings_from_env() -> EmbeddingSettings:
    return EmbeddingSettings(
        model=os.getenv("GEMINI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
        dimensions=int(os.getenv("GEMINI_EMBEDDING_DIMENSIONS", str(DEFAULT_EMBEDDING_DIMENSIONS))),
    )


def rows_to_products(rows: list[asyncpg.Record]) -> tuple[list[ProductToEmbed], int]:
    products: list[ProductToEmbed] = []
    invalid = 0
    for row in rows:
        text = row["search_text"]
        expected_hash = row["embedding_source_hash"]
        if not isinstance(text, str) or not text.strip() or not isinstance(expected_hash, str):
            invalid += 1
            continue
        if source_hash(text) != expected_hash:
            invalid += 1
            continue
        products.append(ProductToEmbed(str(row["product_id"]), text, expected_hash))
    return products, invalid


async def select_pending(
    pool: asyncpg.Pool[asyncpg.Record], settings: EmbeddingSettings, limit: int | None
) -> list[asyncpg.Record]:
    query = PENDING_SQL if limit is None else f"{PENDING_SQL} LIMIT {int(limit)}"
    return list(await pool.fetch(query, settings.model, settings.dimensions, settings.task_type))


async def count_invalid_sources(pool: asyncpg.Pool[asyncpg.Record]) -> int:
    rows = await pool.fetch(INVALID_SOURCE_SQL)
    return sum(
        not isinstance(row["search_text"], str)
        or not row["search_text"].strip()
        or not isinstance(row["embedding_source_hash"], str)
        or source_hash(row["search_text"]) != row["embedding_source_hash"]
        for row in rows
    )


async def record_telemetry(
    pool: asyncpg.Pool[asyncpg.Record],
    settings: EmbeddingSettings,
    *,
    attempt: int,
    elapsed_ms: int,
    result: str,
) -> None:
    try:
        await pool.execute(
            TELEMETRY_SQL,
            "indexacion_catalogo",
            "embedding_documento",
            "gemini",
            settings.model,
            "script:rag-embed",
            attempt,
            max(0, elapsed_ms),
            result,
        )
    except Exception as error:
        # Telemetry must not turn a successfully persisted embedding into a
        # failed job, but the operator needs to know the log was unavailable.
        print(f"[WARN] no se pudo registrar ai_call_log: {type(error).__name__}")


async def persist_embedding(
    pool: asyncpg.Pool[asyncpg.Record],
    product: ProductToEmbed,
    values: tuple[float, ...],
    settings: EmbeddingSettings,
) -> bool:
    row = await pool.fetchrow(
        UPSERT_SQL,
        product.product_id,
        vector_literal(values),
        product.embedding_source_hash,
        settings.model,
        settings.dimensions,
        settings.task_type,
    )
    return row is not None


class EmbeddingJobLease:
    """Pooler-safe lease preventing concurrent paid embedding jobs."""

    def __init__(self, pool: asyncpg.Pool[asyncpg.Record]) -> None:
        self.pool = pool
        self.owner_id = str(uuid.uuid4())
        self.acquired = False
        self.lost = asyncio.Event()
        self.refresh_task: asyncio.Task[None] | None = None

    async def acquire(self) -> None:
        row = await self.pool.fetchrow(
            """
            INSERT INTO catalog_embedding_job_lock
              (lock_name, owner_id, acquired_at, expires_at)
            VALUES ('catalog', $1::uuid, CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP + ($2::double precision * INTERVAL '1 second'))
            ON CONFLICT (lock_name) DO UPDATE SET
              owner_id = EXCLUDED.owner_id,
              acquired_at = EXCLUDED.acquired_at,
              expires_at = EXCLUDED.expires_at
            WHERE catalog_embedding_job_lock.expires_at <= CURRENT_TIMESTAMP
            RETURNING owner_id
            """,
            self.owner_id,
            LEASE_DURATION_SECONDS,
        )
        if row is None:
            raise RuntimeError("EMBEDDING_JOB_ALREADY_RUNNING")
        self.acquired = True
        self.refresh_task = asyncio.create_task(self._refresh())

    async def _refresh(self) -> None:
        try:
            while True:
                await asyncio.sleep(LEASE_REFRESH_SECONDS)
                for attempt in range(3):
                    try:
                        refreshed = await self.pool.fetchval(
                            """
                            UPDATE catalog_embedding_job_lock
                            SET expires_at = CURRENT_TIMESTAMP +
                                ($2::double precision * INTERVAL '1 second')
                            WHERE lock_name = 'catalog' AND owner_id = $1::uuid
                            RETURNING owner_id
                            """,
                            self.owner_id,
                            LEASE_DURATION_SECONDS,
                        )
                        if refreshed is None:
                            self.lost.set()
                            print("[WARN] se perdio el lease del job de embeddings")
                            return
                        break
                    except Exception as error:
                        if attempt == 2:
                            self.lost.set()
                            print(
                                "[WARN] no se pudo renovar el lease; "
                                f"se abortara el job: {type(error).__name__}"
                            )
                            return
                        await asyncio.sleep(2**attempt)
        except asyncio.CancelledError:
            raise

    async def ensure_held(self) -> None:
        if self.lost.is_set():
            raise RuntimeError("EMBEDDING_JOB_LEASE_LOST")

    async def release(self) -> None:
        if not self.acquired:
            return
        if self.refresh_task is not None:
            self.refresh_task.cancel()
            try:
                await self.refresh_task
            except asyncio.CancelledError:
                pass
        await self.pool.execute(
            "DELETE FROM catalog_embedding_job_lock WHERE lock_name = 'catalog' AND owner_id = $1::uuid",
            self.owner_id,
        )


async def process_batch(
    pool: asyncpg.Pool[asyncpg.Record],
    lease: EmbeddingJobLease,
    provider: EmbeddingProvider,
    checkpoint: Checkpoint,
    products: list[ProductToEmbed],
    settings: EmbeddingSettings,
    summary: Summary,
) -> None:
    attempts: list[int] = []

    async def on_attempt(attempt: int, result: str, elapsed_ms: int) -> None:
        await record_telemetry(
            pool,
            settings,
            attempt=attempt,
            elapsed_ms=elapsed_ms,
            result=result,
        )

    try:
        await lease.ensure_held()
        raw_embeddings = await embed_with_retry(
            provider,
            [product.search_text for product in products],
            settings,
            attempts,
            on_attempt,
        )
        embeddings = validate_embedding_batch(raw_embeddings, len(products), settings.dimensions)
    except Exception as error:
        summary.failed += len(products)
        for product in products:
            await checkpoint.record(
                product,
                status="failed",
                attempts=attempts[0] if attempts else 1,
                error=type(error).__name__,
            )
        return

    provider_attempts = attempts[0] if attempts else 1
    for product, values in zip(products, embeddings, strict=True):
        try:
            await lease.ensure_held()
            if await persist_embedding(pool, product, values, settings):
                summary.succeeded += 1
                await checkpoint.record(product, status="succeeded", attempts=provider_attempts)
            else:
                summary.stale += 1
                await checkpoint.record(product, status="stale", attempts=provider_attempts)
        except Exception as error:
            summary.failed += 1
            await checkpoint.record(
                product, status="failed", attempts=1, error=type(error).__name__
            )


async def run(args: argparse.Namespace) -> int:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL_REQUIRED")
    settings = settings_from_env()
    pool = await asyncpg.create_pool(
        dsn,
        min_size=1,
        max_size=max(2, args.concurrency + 1),
        command_timeout=60,
        statement_cache_size=0,
    )
    lease = EmbeddingJobLease(pool)
    try:
        if not args.dry_run:
            await lease.acquire()
        try:
            invalid_sources = await count_invalid_sources(pool)
            rows = await select_pending(pool, settings, args.limit)
            products, invalid_selected = rows_to_products(rows)
            invalid = invalid_sources + invalid_selected
            summary = Summary(selected=len(rows), invalid=invalid)
            print(
                f"Pendientes: {summary.selected}; validos: {len(products)}; invalidos: {summary.invalid}"
            )
            print(
                f"Modelo: {settings.model}; dimensiones: {settings.dimensions}; "
                f"task: {settings.task_type}"
            )
            if args.dry_run:
                print("[DRY-RUN] no se llamo Gemini ni se escribio PostgreSQL.")
                return 0 if invalid == 0 else 1
            if invalid:
                print("[FAIL] hay productos con search_text/hash inconsistente.")
                return 1

            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY_REQUIRED")
            provider = GeminiEmbeddingProvider(api_key)
            checkpoint = Checkpoint(args.checkpoint, settings)
            batches = [
                products[index : index + args.batch_size]
                for index in range(0, len(products), args.batch_size)
            ]
            semaphore = asyncio.Semaphore(args.concurrency)

            async def bounded(batch: list[ProductToEmbed]) -> None:
                async with semaphore:
                    await process_batch(pool, lease, provider, checkpoint, batch, settings, summary)

            await asyncio.gather(*(bounded(batch) for batch in batches))
            await lease.ensure_held()
            print(
                f"Resultado: ok={summary.succeeded} stale={summary.stale} "
                f"failed={summary.failed} invalid={summary.invalid}"
            )
            return 0 if summary.failed == 0 and summary.invalid == 0 and summary.stale == 0 else 1
        finally:
            await lease.release()
    finally:
        await pool.close()


def main() -> None:
    try:
        raise SystemExit(asyncio.run(run(parse_args())))
    except KeyboardInterrupt:
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
