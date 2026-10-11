"""Genera los vectores de «el mismo globo» (D-038) con el código REAL de Python.

``mismo_globo`` (``services/ai-api/app/presentaciones.py``) decide qué otros paquetes de la tienda son del mismo globo que
una variante, sobre lo que ``_candidate`` (``services/ai-api/app/plan.py``) saca de cada fila del catálogo: texto sin
espacios, diámetro negativo = ninguno y colores reales de la variante (sin tildes, sin repetir, con las reglas del título
«gris» y «vino»). El lado TypeScript (``src/lib/globos3d/motor/crosswalk-mismo-globo.ts``) copia esa regla para leer las
presentaciones de la base; este archivo deja el resultado de Python congelado en
``contracts/domain/v1/golden/mismo-globo/vectores.json`` y ``scripts/test/test-mismo-globo.ts`` exige el mismo grupo.

Sin dependencias de terceros: de ``plan.py`` solo se extraen las funciones puras que hacen falta (``ast``), así que corre
con el Python del sistema, sin el entorno del servicio.

    python scripts/motor/generar-vectores-mismo-globo.py            # reescribe los vectores
    python scripts/motor/generar-vectores-mismo-globo.py --verificar  # falla si los vectores ya no son los de Python
"""

from __future__ import annotations

import ast
import json
import re
import sys
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parents[2]
SERVICIO = RAIZ / "services" / "ai-api"
DESTINO = RAIZ / "contracts" / "domain" / "v1" / "golden" / "mismo-globo" / "vectores.json"
sys.path.insert(0, str(SERVICIO))

from app.colores_titulo import WINE_TITLE as _WINE_TITLE  # noqa: E402
from app.numeros import entero as _integer  # noqa: E402
from app.numeros import numero as _number  # noqa: E402
from app.presentaciones import mismo_globo  # noqa: E402

SNAPSHOT = "snapshot-vectores"
NOMBRES_DE_PLAN = {
    "MAX_SAFE_INTEGER",
    "Candidate",
    "_text",
    "_price",
    "_normalize",
    "_json_value",
    "_strings",
    "_valid_image",
    "_GREY_TITLE",
    "_SILVER_TITLE",
    "_product_colors",
    "_variant_real_colors",
    "_candidate",
}


def _de_plan() -> dict[str, object]:
    """Las definiciones puras de ``plan.py`` que usa ``_candidate``, tal como están escritas allí."""
    fuente = (SERVICIO / "app" / "plan.py").read_text(encoding="utf-8")
    elegidas: list[ast.stmt] = []
    for nodo in ast.parse(fuente).body:
        if isinstance(nodo, (ast.FunctionDef, ast.ClassDef)) and nodo.name in NOMBRES_DE_PLAN:
            elegidas.append(nodo)
        elif isinstance(nodo, ast.Assign) and any(
            isinstance(destino, ast.Name) and destino.id in NOMBRES_DE_PLAN for destino in nodo.targets
        ):
            elegidas.append(nodo)
    encontrados = {
        getattr(nodo, "name", None) or next(d.id for d in nodo.targets if isinstance(d, ast.Name))  # type: ignore[attr-defined]
        for nodo in elegidas
    }
    faltan = NOMBRES_DE_PLAN - encontrados
    if faltan:
        raise SystemExit(f"plan.py ya no define: {sorted(faltan)}")
    espacio: dict[str, object] = {
        "__name__": "plan_extraido",
        "dataclass": dataclass,
        "re": re,
        "unicodedata": unicodedata,
        "json": json,
        "urlparse": urlparse,
        "Mapping": Mapping,
        "Sequence": Sequence,
        "Decimal": Decimal,
        "InvalidOperation": InvalidOperation,
        "ROUND_HALF_UP": ROUND_HALF_UP,
        "_WINE_TITLE": _WINE_TITLE,
        "_integer": _integer,
        "_number": _number,
    }
    modulo = ast.Module(body=elegidas, type_ignores=[])
    exec(compile(ast.fix_missing_locations(modulo), "plan.py (extraído)", "exec", flags=0, dont_inherit=True), espacio)
    return espacio


_PLAN = _de_plan()
_candidate = _PLAN["_candidate"]


def fila(variant_id: str, **cambios: object) -> dict[str, object]:
    """Una fila del catálogo con la forma que lee ``_candidate``: un globo redondo R12 dorado de un producto, a la venta."""
    base: dict[str, object] = {
        "product_id": "prod-1",
        "variant_id": variant_id,
        "sku": None,
        "sku_original": None,
        "source_snapshot_id": SNAPSHOT,
        "source_variant_id": None,
        "inventory_quantity": None,
        "unidades_inferidas": None,
        "producto_titulo": "Globo Látex Sempertex",
        "variante_titulo": None,
        "precio": 10000,
        "unidades_paq": 12,
        "disponible": True,
        "producto_disponible": True,
        "codigo_tamano": "R12",
        "forma": "redondo",
        "diam_pulg": 12,
        "colores_producto": ["dorado"],
        "colores_variante": [],
        "acabados_producto": [],
        "descripcion": None,
        "imagen": None,
        "currency": "COP",
    }
    return {**base, **cambios}


CASOS: list[dict[str, object]] = [
    {
        "caso": "x12-sin-color-y-x50-dorado",
        "que": "La variante ×12 sin colores propios (NULL) y la ×50 etiquetada «dorado» del mismo producto son el mismo globo: sin colores propios valen los del producto.",
        "pedida": "a12",
        "filas": [
            fila("a12", unidades_paq=12, colores_variante=None),
            fila("b50", unidades_paq=50, precio=36000, colores_variante=["dorado"]),
        ],
    },
    {
        "caso": "colores-con-tildes-mayusculas-y-repetidos",
        "que": "Los colores se comparan sin tildes, en minúscula y sin repetir.",
        "pedida": "a",
        "filas": [
            fila("a", colores_variante=["Azúl", "AZUL", "azul"], colores_producto=["azul"]),
            fila("b", unidades_paq=50, colores_variante=["azul"], colores_producto=["azul"]),
        ],
    },
    {
        "caso": "colores-en-json-de-texto",
        "que": "Una lista de colores que llega como JSON de texto se lee igual que un arreglo.",
        "pedida": "a",
        "filas": [
            fila("a", colores_variante='["Dorado"]'),
            fila("b", unidades_paq=50, colores_variante=["dorado"]),
        ],
    },
    {
        "caso": "colores-en-otro-orden-no-son-el-mismo",
        "que": "El orden de los colores cuenta (la comparación es de tuplas): rojo+azul y azul+rojo son globos distintos.",
        "pedida": "a",
        "filas": [
            fila("a", colores_variante=["rojo", "azul"]),
            fila("b", unidades_paq=50, colores_variante=["azul", "rojo"]),
            fila("c", unidades_paq=80, colores_variante=["rojo", "azul"]),
        ],
    },
    {
        "caso": "color-distinto-no-agrupa",
        "que": "Un producto que vende colores distintos como variantes de la misma talla: cada color es su globo.",
        "pedida": "a",
        "filas": [
            fila("a", colores_variante=["rojo"], colores_producto=["rojo", "azul"]),
            fila("b", unidades_paq=50, colores_variante=["rojo"], colores_producto=["rojo", "azul"]),
            fila("c", colores_variante=["azul"], colores_producto=["rojo", "azul"]),
        ],
    },
    {
        "caso": "titulo-gris-reemplaza-plateado",
        "que": "Un producto cuyo título dice «gris» (y no «plata») cambia «plateado» por «gris»: el catálogo archiva el gris como plateado.",
        "pedida": "a",
        "filas": [
            fila("a", producto_titulo="Globo Fashion Gris", colores_variante=["plateado"], colores_producto=["plateado"]),
            fila("b", producto_titulo="Globo Fashion Gris", unidades_paq=50, colores_variante=["gris"], colores_producto=["plateado"]),
            fila("c", producto_titulo="Globo Fashion Gris", unidades_paq=80, colores_variante=[], colores_producto=["plateado"]),
        ],
    },
    {
        "caso": "titulo-gris-y-plata-no-cambia",
        "que": "Si el título también dice «plata», la regla del gris no aplica: «plateado» y «gris» son colores distintos.",
        "pedida": "a",
        "filas": [
            fila("a", producto_titulo="Globo Gris Plata", colores_variante=["plateado"], colores_producto=["plateado"]),
            fila("b", producto_titulo="Globo Gris Plata", unidades_paq=50, colores_variante=["gris"], colores_producto=["plateado"]),
            fila("c", producto_titulo="Globo Gris Plata", unidades_paq=80, colores_variante=["plateado"], colores_producto=["plateado"]),
        ],
    },
    {
        "caso": "titulo-vino-reemplaza-rojo",
        "que": "Un producto cuyo título nombra un tono de vino cambia «rojo» por «burdeos».",
        "pedida": "a",
        "filas": [
            fila("a", producto_titulo="Globo Metal Vinotinto", colores_variante=["rojo"], colores_producto=["rojo"]),
            fila("b", producto_titulo="Globo Metal Vinotinto", unidades_paq=50, colores_variante=["burdeos"], colores_producto=["rojo"]),
            fila("c", producto_titulo="Globo Metal Vinotinto", unidades_paq=80, colores_variante=[], colores_producto=["rojo"]),
        ],
    },
    {
        "caso": "diametro-negativo-es-ninguno",
        "que": "Un diámetro negativo es «sin diámetro»: coincide con NULL y no con un diámetro real.",
        "pedida": "a",
        "filas": [
            fila("a", diam_pulg=-1, codigo_tamano=None),
            fila("b", unidades_paq=50, diam_pulg=None, codigo_tamano=None),
            fila("c", unidades_paq=80, diam_pulg=12, codigo_tamano=None),
        ],
    },
    {
        "caso": "texto-con-espacios-y-vacio",
        "que": "El código de talla y la forma se recortan, y un texto vacío es ninguno.",
        "pedida": "a",
        "filas": [
            fila("a", codigo_tamano=" R12 ", forma=" redondo"),
            fila("b", unidades_paq=50, codigo_tamano="R12", forma="redondo "),
            fila("c", unidades_paq=80, codigo_tamano="R12 ", forma=""),
            fila("d", unidades_paq=3, codigo_tamano="", forma="redondo"),
        ],
    },
    {
        "caso": "talla-parecida-no-agrupa",
        "que": "La talla es su código, no solo el diámetro: LOL 6 y LOL 660 miden lo mismo y no son el mismo globo.",
        "pedida": "a",
        "filas": [
            fila("a", codigo_tamano="6", diam_pulg=6),
            fila("b", unidades_paq=50, codigo_tamano="6", diam_pulg=6),
            fila("c", codigo_tamano="660", diam_pulg=6),
        ],
    },
    {
        "caso": "forma-distinta-no-agrupa",
        "que": "La forma cuenta.",
        "pedida": "a",
        "filas": [
            fila("a", forma="redondo"),
            fila("b", unidades_paq=50, forma="corazon"),
            fila("c", unidades_paq=80, forma="redondo"),
        ],
    },
    {
        "caso": "otro-producto-no-agrupa",
        "que": "Mismo diámetro, talla, forma y color de OTRO producto no es el mismo globo.",
        "pedida": "a",
        "filas": [
            fila("a"),
            fila("b", unidades_paq=50, product_id="prod-2"),
            fila("c", unidades_paq=80),
        ],
    },
    {
        "caso": "paquete-no-vendible-no-cuenta",
        "que": "Un paquete que la tienda no vende (agotado, sin precio o sin unidades) no es una presentación.",
        "pedida": "a",
        "filas": [
            fila("a"),
            fila("b", unidades_paq=50, disponible=False),
            fila("c", unidades_paq=80, precio=0),
            fila("d", unidades_paq=0),
            fila("e", unidades_paq=3, precio=4000),
        ],
    },
]


def _esperado(caso: dict[str, object]) -> list[str]:
    candidatos = [c for c in (_candidate(f, SNAPSHOT) for f in caso["filas"]) if c is not None]  # type: ignore[operator, union-attr]
    referencia = next(c for c in candidatos if c.variant_id == caso["pedida"])
    return sorted(c.variant_id for c in candidatos if mismo_globo(referencia, c))


def generar() -> str:
    vectores = [{**caso, "esperado": _esperado(caso)} for caso in CASOS]
    return json.dumps({"regla": "mismo_globo (services/ai-api/app/presentaciones.py) sobre _candidate (services/ai-api/app/plan.py)", "vectores": vectores}, indent=1, ensure_ascii=False) + "\n"


def main() -> int:
    texto = generar()
    if "--verificar" in sys.argv:
        if not DESTINO.exists() or DESTINO.read_text(encoding="utf-8") != texto:
            print(f"{DESTINO.relative_to(RAIZ)} ya no es lo que dice Python: regénéralo con este script", file=sys.stderr)
            return 1
        print(f"{len(CASOS)} vectores al día")
        return 0
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    with DESTINO.open("w", encoding="utf-8", newline="\n") as salida:
        salida.write(texto)
    print(f"escritos {len(CASOS)} vectores en {DESTINO.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
