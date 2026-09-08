"""Verifica el aislamiento de permisos del linaje operacional (Fase 6,
capitulo 10.4): el rol del servicio Python debe poder leer/escribir
operational.* y NO debe poder leer una tabla comercial en public.*.

Es un test de integracion real contra Postgres, no un mock: la garantia que
verifica (GRANT/REVOKE a nivel de servidor) no es simulable con un fake. Se
salta automaticamente si TEST_DATABASE_URL no esta configurada -- nunca
corre contra Neon ni contra ninguna base remota salvo que quien ejecute el
test la apunte ahi explicitamente.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import cast
from urllib.parse import urlsplit

import asyncpg
import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def run(coroutine: object) -> object:
    return asyncio.run(cast("asyncio.Future[object]", coroutine))


async def _verificar_aislamiento() -> None:
    assert TEST_DATABASE_URL is not None
    admin = await asyncpg.connect(TEST_DATABASE_URL)
    rol = f"test_operational_role_{uuid.uuid4().hex[:8]}"
    password = uuid.uuid4().hex
    try:
        # Simula una tabla comercial cualquiera en public, con datos.
        await admin.execute(
            "CREATE TABLE IF NOT EXISTS public.catalog_products_test_fixture (id SERIAL PRIMARY KEY, nombre TEXT)"
        )
        await admin.execute(
            "INSERT INTO public.catalog_products_test_fixture (nombre) VALUES ('no deberia ser legible')"
        )
        await admin.execute("CREATE SCHEMA IF NOT EXISTS operational")
        await admin.execute(
            "CREATE TABLE IF NOT EXISTS operational.operational_idempotency_test_fixture (id SERIAL PRIMARY KEY)"
        )

        database_name = urlsplit(cast(str, TEST_DATABASE_URL)).path.lstrip("/")
        # DDL no admite placeholders parametrizados; rol y password son
        # valores generados aqui mismo (uuid4), no entrada externa.
        await admin.execute(f"CREATE ROLE \"{rol}\" LOGIN PASSWORD '{password}'")
        await admin.execute(f'GRANT CONNECT ON DATABASE "{database_name}" TO "{rol}"')
        await admin.execute(f'GRANT USAGE ON SCHEMA operational TO "{rol}"')
        await admin.execute(
            f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA operational TO "{rol}"'
        )
        await admin.execute(
            f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA operational TO "{rol}"'
        )
        await admin.execute(f'ALTER ROLE "{rol}" SET search_path = operational, public')
        # Sin GRANT ninguno sobre public: el default de Postgres es denegar.

        dsn_partes = cast(str, TEST_DATABASE_URL).split("@", 1)
        host_y_resto = dsn_partes[1] if len(dsn_partes) > 1 else dsn_partes[0]
        dsn_restringido = f"postgresql://{rol}:{password}@{host_y_resto}"

        conexion_restringida = await asyncpg.connect(dsn_restringido)
        try:
            # Positivo: puede leer/escribir su propio schema, sin calificarlo
            # (search_path resuelve a operational primero).
            await conexion_restringida.execute(
                "INSERT INTO operational_idempotency_test_fixture DEFAULT VALUES"
            )
            filas = await conexion_restringida.fetch(
                "SELECT * FROM operational_idempotency_test_fixture"
            )
            assert len(filas) == 1

            # Negativo: no puede leer una tabla comercial de public.
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await conexion_restringida.fetch(
                    "SELECT * FROM public.catalog_products_test_fixture"
                )
        finally:
            await conexion_restringida.close()
    finally:
        await admin.execute("DROP TABLE IF EXISTS public.catalog_products_test_fixture")
        await admin.execute("DROP TABLE IF EXISTS operational.operational_idempotency_test_fixture")
        # El GRANT ON ALL TABLES IN SCHEMA alcanzo tambien a las tablas reales
        # del linaje (schema_migrations, operational_idempotency,
        # operational_request_nonces) -- DROP ROLE exige revocar antes.
        await admin.execute(f'DROP OWNED BY "{rol}"')
        await admin.execute(f'DROP ROLE IF EXISTS "{rol}"')
        await admin.close()


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL no configurada; test de integracion real omitido",
)
def test_rol_operacional_no_puede_leer_tabla_comercial() -> None:
    run(_verificar_aislamiento())
