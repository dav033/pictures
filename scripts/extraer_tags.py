"""Extrae todos los tags individuales de shopify_producto, sin duplicados."""

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "demo.sqlite"
SALIDA_PATH = Path(__file__).resolve().parent / "tags_unicos.txt"
SALIDA_DUPLICADOS_PATH = Path(__file__).resolve().parent / "tags_duplicados_por_case.txt"


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("SELECT tags FROM shopify_producto")

    tags_unicos: set[str] = set()
    for (tags_json,) in cur.fetchall():
        if not tags_json:
            continue
        for tag in json.loads(tags_json):
            tags_unicos.add(tag.strip())

    con.close()

    with open(SALIDA_PATH, "w", encoding="utf-8") as f:
        for tag in sorted(tags_unicos):
            f.write(tag + "\n")
        f.write(f"\nTotal tags únicos: {len(tags_unicos)}\n")

    print(f"Escrito en {SALIDA_PATH} — {len(tags_unicos)} tags únicos.")

    # Agrupa por forma normalizada (mayúsculas) para detectar duplicados
    # que solo difieren en mayúsculas/minúsculas (ej. "VIRGEN" vs "virgen").
    grupos: dict[str, list[str]] = {}
    for tag in tags_unicos:
        grupos.setdefault(tag.upper(), []).append(tag)

    duplicados = {clave: variantes for clave, variantes in grupos.items() if len(variantes) > 1}

    with open(SALIDA_DUPLICADOS_PATH, "w", encoding="utf-8") as f:
        for clave in sorted(duplicados):
            variantes = sorted(duplicados[clave])
            f.write(f"{clave} <- {', '.join(variantes)}\n")
        f.write(f"\nTotal grupos con duplicados por case: {len(duplicados)}\n")
        f.write(f"Total tags únicos normalizados (mayúsculas): {len(grupos)}\n")

    print(
        f"Escrito en {SALIDA_DUPLICADOS_PATH} — {len(duplicados)} grupos duplicados "
        f"por case, {len(grupos)} tags únicos normalizados."
    )


if __name__ == "__main__":
    main()
