"""Runner de migraciones para el linaje operacional (Fase 6, capitulo 10.4).

Replica las garantias del runner TypeScript (scripts/migrate.ts, Fase 1.3)
que aplican a este linaje: confirmacion de destino, checksum, advisory lock,
transaccion sobre una sola conexion, validacion de numeracion, --dry-run.
No reimplementa --target ni la reconciliacion de renombrados porque este
linaje todavia no los necesita (una sola migracion, sin colisiones).

Todas las tablas y el propio registro de este runner viven en el schema
`operational`, nunca en `public` — es la separacion de linajes del
capitulo 10.5: el schema comercial lo migra scripts/migrate.ts (repo Next),
este runner solo toca `operational.*`.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
ADVISORY_LOCK_KEY = (
    1836345459  # scripts/migrate.ts usa 1836345458; +1 para no compartir el lock entre linajes.
)
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def leer_sql(archivo: Path) -> str:
    return archivo.read_text(encoding="utf-8").replace("\r\n", "\n")


def checksum_de(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def archivos_de_migracion() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def validar_numeracion(archivos: list[Path]) -> None:
    numeros: dict[str, list[str]] = {}
    for archivo in archivos:
        prefijo = archivo.name.split("_", 1)[0]
        if not prefijo.isdigit():
            raise SystemExit(f"Migracion sin prefijo numerico: {archivo.name}")
        numeros.setdefault(prefijo, []).append(archivo.name)
    colisiones = {n: lista for n, lista in numeros.items() if len(lista) > 1}
    if colisiones:
        detalle = "\n".join(f"  {n}: {', '.join(ml)}" for n, ml in colisiones.items())
        raise SystemExit(f"Colision de numero de migracion:\n{detalle}")


def avisar_reversiones_faltantes(archivos: list[Path]) -> None:
    sin_nota = [a for a in archivos if "-- rollback:" not in leer_sql(a).lower()]
    if sin_nota:
        print(f"[AVISO] {len(sin_nota)} migracion(es) sin nota '-- rollback:'.", file=sys.stderr)
        for a in sin_nota:
            print(f"        {a.name}", file=sys.stderr)


def describir_destino(dsn: str) -> tuple[str, str, bool]:
    partes = urlsplit(dsn)
    host = partes.hostname or ""
    puerto = partes.port or 5432
    base = (partes.path or "").lstrip("/") or "(sin nombre)"
    usuario = partes.username or "(sin usuario)"
    etiqueta = f"{usuario}@{host}:{puerto}/{base}"
    return etiqueta, host, host in LOCAL_HOSTS


async def aplicar(dsn: str, dry_run: bool, allow_remote: bool) -> None:
    etiqueta, host, es_local = describir_destino(dsn)
    print(f"Destino: {etiqueta} (schema operational)")
    print(f"Modo:    {'dry-run (no escribe)' if dry_run else 'aplicar'}")

    if not es_local and not allow_remote and not dry_run:
        raise SystemExit(
            f"El destino '{host}' no es local y no se paso --allow-remote.\n"
            "Confirma que esa es la base correcta y vuelve a ejecutar con --allow-remote,\n"
            "o usa --dry-run para ver que se aplicaria sin escribir nada."
        )

    archivos = archivos_de_migracion()
    validar_numeracion(archivos)
    avisar_reversiones_faltantes(archivos)

    conn = await asyncpg.connect(dsn)
    lock_tomado = False
    try:
        await conn.execute("SELECT pg_advisory_lock($1)", ADVISORY_LOCK_KEY)
        lock_tomado = True

        if dry_run:
            existe_schema = await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'operational')"
            )
            ya_aplicadas: set[str] = set()
            if existe_schema:
                existe_tabla = await conn.fetchval(
                    "SELECT to_regclass('operational.schema_migrations') IS NOT NULL"
                )
                if existe_tabla:
                    filas = await conn.fetch("SELECT filename FROM operational.schema_migrations")
                    ya_aplicadas = {f["filename"] for f in filas}
            pendientes = [a for a in archivos if a.name not in ya_aplicadas]
            if not pendientes:
                print(
                    f"[DRY-RUN] Nada pendiente. {len(ya_aplicadas)} migracion(es) ya aplicada(s)."
                )
            else:
                print(f"[DRY-RUN] {len(pendientes)} migracion(es) se aplicarian, en este orden:")
                for a in pendientes:
                    print(f"  {a.name}  {checksum_de(leer_sql(a))[:12]}")
            return

        await conn.execute("CREATE SCHEMA IF NOT EXISTS operational")
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS operational.schema_migrations (
              filename    TEXT PRIMARY KEY,
              checksum    TEXT NOT NULL,
              applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )

        filas = await conn.fetch("SELECT filename, checksum FROM operational.schema_migrations")
        aplicadas = {f["filename"]: f["checksum"] for f in filas}

        divergentes = []
        for archivo in archivos:
            if archivo.name not in aplicadas:
                continue
            actual = checksum_de(leer_sql(archivo))
            if aplicadas[archivo.name] != actual:
                divergentes.append(archivo.name)
        if divergentes:
            raise SystemExit(
                "El contenido de una migracion ya aplicada cambio: "
                f"{', '.join(divergentes)}. No se aplica nada mas."
            )

        nuevas = 0
        for archivo in archivos:
            if archivo.name in aplicadas:
                continue
            sql = leer_sql(archivo)
            print(f"Aplicando {archivo.name}...")
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO operational.schema_migrations (filename, checksum) VALUES ($1, $2)",
                    archivo.name,
                    checksum_de(sql),
                )
            nuevas += 1
        print(f"[PASS] {nuevas} migracion(es) nueva(s) aplicada(s), {len(aplicadas)} ya estaban.")
    finally:
        if lock_tomado:
            try:
                await conn.execute("SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_KEY)
            except Exception:
                pass
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dsn", required=True, help="DATABASE_URL de destino (nunca se imprime completo)."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-remote", action="store_true")
    args = parser.parse_args()

    import asyncio

    asyncio.run(aplicar(args.dsn, args.dry_run, args.allow_remote))


if __name__ == "__main__":
    main()
