"""Respuestas reales de las herramientas de armado del agente (ADR-0034 §5) para las pruebas de Next.

Llama ``resolver_armado_estructura`` (sin red y sin catálogo) con las mismas acciones que hace el chat y
escribe ``scripts/fixtures/armado-estructura-ia/respuestas.json``, que lee
``scripts/test/test-armado-estructura-ia.ts``. Así TypeScript valida su frontera contra lo que Python
devuelve de verdad —los catorce patrones con sus mandos, un armado resuelto con su conteo, la receta del
motor— en vez de contra un objeto escrito a mano que se desincroniza en silencio.

Por defecto es vista previa: muestra un resumen de cada respuesta y no escribe nada. ``--escribir`` reemplaza
la fixture, y hacerlo es deliberado: cuando el motor añada un patrón o cambie un rango, se regenera a
propósito y el commit dice por qué. **Nunca** para que pase una prueba de TypeScript.

    uv run --directory services/ai-api python scripts/fixture_armado_estructura_ia.py
    uv run --directory services/ai-api python scripts/fixture_armado_estructura_ia.py --escribir
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, cast

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_DIR.parents[1]
FIXTURE = REPO_ROOT / "scripts" / "fixtures" / "armado-estructura-ia" / "respuestas.json"

if str(SERVICE_DIR) not in sys.path:  # pragma: no cover - entrada de CLI
    sys.path.insert(0, str(SERVICE_DIR))

from app.armado_estructura import (  # noqa: E402
    ArmadoEstructuraRequest,
    resolver_armado_estructura,
)

COMENTARIO = (
    "Salidas reales de app/omoikane/armado_estructura.py (sin red y sin catálogo): el catálogo que el "
    "motor publica para el arco y para la columna, un armado resuelto de cada tipo y lo que la acción "
    "`completar` decide para un plan con un arco de dos colores, una columna de uno y una guirnalda "
    "orgánica de dos (el segundo cromado). Generado con "
    "services/ai-api/scripts/fixture_armado_estructura_ia.py --escribir; regenerar solo a propósito "
    "cuando el motor cambie, nunca para que pase una prueba de TypeScript."
)

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000f0",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["omoikane.armado_estructura"],
    "body_sha256": "0" * 64,
}


def _estructura(
    estructura_id: str, tipo: str, colores: int, acabados: tuple[str | None, ...] = ()
) -> dict[str, object]:
    return {
        "estructura_id": estructura_id,
        "nombre": "Pieza",
        "tipo": tipo,
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3.2, "alto_m": 2.3, "largo_m": 4.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": f"prod-{indice}",
                "participacion": round(1 / colores, 4),
                "rol_material": "principal" if indice == 0 else "secundario",
                **(
                    {"acabado": acabados[indice]}
                    if indice < len(acabados) and acabados[indice] is not None
                    else {}
                ),
            }
            for indice in range(colores)
        ],
        "porque": "Prueba.",
    }


PLAN: dict[str, object] = {
    "plan_version": "1.0",
    "plan_id": "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
    "concepto": {"titulo": "Prueba", "descripcion": "Prueba.", "paleta": ["rosado"]},
    "espacio": {"tipo": "salon", "fuente": "cliente"},
    "estructuras": [
        _estructura("EST_01_ARCO", "arco", 2),
        _estructura("EST_02_COLUMNA", "columna", 1),
        _estructura("EST_03_GUIRNALDA", "guirnalda", 2, (None, "cromado")),
    ],
}

ACCIONES: dict[str, dict[str, object]] = {
    "catalogo_arco": {"accion": "catalogo", "tipo": "arco"},
    "catalogo_columna": {"accion": "catalogo", "tipo": "columna"},
    "armar_arco": {
        "accion": "armar",
        "estructura_id": "EST_01_ARCO",
        "pieza": {"tipo": "arco", "colores": 2, "ancho_m": 3.2, "alto_m": 2.3},
        "patron": "chevron",
        "materiales": [0, 1],
        "opciones": {"ancho": 3},
    },
    "armar_columna": {
        "accion": "armar",
        "estructura_id": "EST_02_COLUMNA",
        "pieza": {"tipo": "columna", "colores": 2, "alto_m": 2.0},
        "patron": "espiral",
        "materiales": [0, 1],
        "remate": {"tipo": "estrella", "foil_m": 0.8},
    },
    "catalogo_guirnalda": {"accion": "catalogo", "tipo": "guirnalda"},
    "armar_guirnalda": {
        "accion": "armar",
        "estructura_id": "EST_03_GUIRNALDA",
        "pieza": {
            "tipo": "guirnalda",
            "colores": 2,
            "largo_m": 4.5,
            "pesos": [0.6, 0.4],
            "acabados": [None, "cromado"],
        },
        "paleta": [{"material": 0}, {"material": 1, "rol": "acento"}],
        "reparto": "racimos",
        "tamanos": [
            {"tamano": 5, "peso": 30},
            {"tamano": 12, "peso": 50},
            {"tamano": 18, "peso": 20},
        ],
    },
    "completar_receta": {"accion": "completar", "plan": PLAN},
}


def _respuestas() -> dict[str, Any]:
    salida: dict[str, Any] = {"_comentario": COMENTARIO}
    for nombre, operacion in ACCIONES.items():
        peticion = ArmadoEstructuraRequest(
            context=cast(Any, CONTEXTO),
            schema_version="omoikane-armado-estructura.v1",
            **cast(Any, operacion),
        )
        salida[nombre] = resolver_armado_estructura(peticion)
    return salida


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--escribir", action="store_true", help="reemplaza la fixture")
    args = parser.parse_args(argv)
    respuestas = _respuestas()
    for nombre, respuesta in respuestas.items():
        if nombre.startswith("_"):
            continue
        cuerpo = cast(dict[str, Any], respuesta)
        if cuerpo["accion"] == "catalogo":
            # La guirnalda no tiene patrones: lo que publica son acabados y repartos.
            opciones = cast(dict[str, Any], cuerpo["opciones"])
            clave = "patrones" if "patrones" in opciones else "acabados"
            print(f"{nombre}: {len(cast(list[object], opciones[clave]))} {clave}")
        elif cuerpo["accion"] == "armar":
            armado = cast(dict[str, Any], cuerpo["armado"])
            como = armado.get("patron") or cast(dict[str, Any], armado["colores"])["reparto"]
            print(f"{nombre}: {como} -> {cuerpo['resumen']['total_globos']} globos")
        else:
            print(f"{nombre}: {[(a['estructura_id'], a['origen']) for a in cuerpo['armados']]}")
    if not args.escribir:
        print("\nVista previa; nada escrito. Usa --escribir para reemplazar la fixture.")
        return 0
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(
        json.dumps(respuestas, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\nEscrito {FIXTURE}")
    return 0


if __name__ == "__main__":  # pragma: no cover - entrada de CLI
    raise SystemExit(main())
