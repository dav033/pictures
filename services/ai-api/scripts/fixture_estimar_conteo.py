"""Respuestas reales de ``estimar_conteo_globos`` (ADR-0038) para las pruebas de Next.

Llama ``estimar_conteo`` (sin red, sin catálogo y sin escribir nada) con las mismas preguntas que hace el
chat y escribe ``scripts/fixtures/estimar-conteo/respuestas.json``, que lee
``scripts/test/test-estimar-conteo-globos.ts``. Así TypeScript valida su frontera contra lo que Python
devuelve de verdad —el total vigente, la nota de una pieza con motor, la sugerencia— en vez de contra un
objeto escrito a mano que se desincroniza en silencio.

El armado del candidato con motor sale de la misma acción ``armar`` que usa el chat, con los mismos datos que
``fixture_armado_estructura_ia.py``: así el armado que la prueba de Next guarda en el estado del turno es el
que Python contó aquí.

Por defecto es vista previa: muestra un resumen de cada respuesta y no escribe nada. ``--escribir`` reemplaza
la fixture, y hacerlo es deliberado: cuando el motor o la fórmula cambien, se regenera a propósito y el commit
dice por qué. **Nunca** para que pase una prueba de TypeScript.

    uv run --directory services/ai-api python scripts/fixture_estimar_conteo.py
    uv run --directory services/ai-api python scripts/fixture_estimar_conteo.py --escribir
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, cast

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_DIR.parents[1]
FIXTURE = REPO_ROOT / "scripts" / "fixtures" / "estimar-conteo" / "respuestas.json"

if str(SERVICE_DIR) not in sys.path:  # pragma: no cover - entrada de CLI
    sys.path.insert(0, str(SERVICE_DIR))

from app.estimar_conteo import EstimarConteoRequest, estimar_conteo  # noqa: E402
from app.omoikane.armado_estructura import (  # noqa: E402
    ArmadoEstructuraRequest,
    resolver_armado_estructura,
)

COMENTARIO = (
    "Salidas reales de app/estimar_conteo.py (sin red, sin catálogo y sin escribir nada): una estimación "
    "con la fórmula hacia un objetivo, una con un arco que trae armado del motor (el de armar_arco de "
    "scripts/fixtures/armado-estructura-ia) y una sin objetivo. Generado con "
    "services/ai-api/scripts/fixture_estimar_conteo.py --escribir; regenerar solo a propósito cuando el "
    "motor o la fórmula cambien, nunca para que pase una prueba de TypeScript."
)

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000f1",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.estimar_conteo"],
    "body_sha256": "0" * 64,
}

CONTEXTO_ARMADO: dict[str, object] = {**CONTEXTO, "scopes": ["omoikane.armado_estructura"]}


def _armado_arco() -> dict[str, Any]:
    """El mismo ``armar_arco`` de ``fixture_armado_estructura_ia.py``."""
    peticion = ArmadoEstructuraRequest(
        context=cast(Any, CONTEXTO_ARMADO),
        schema_version="omoikane-armado-estructura.v1",
        accion="armar",
        estructura_id="EST_01_ARCO",
        pieza=cast(Any, {"tipo": "arco", "colores": 2, "ancho_m": 3.2, "alto_m": 2.3}),
        patron="chevron",
        materiales=[0, 1],
        opciones={"ancho": 3},
    )
    return cast(dict[str, Any], resolver_armado_estructura(peticion)["armado"])


def _candidato(
    etiqueta: str, tipo: str, medidas: dict[str, float], **extra: object
) -> dict[str, object]:
    return {
        "etiqueta": etiqueta,
        "tipo": tipo,
        "medidas": medidas,
        "densidad": "media",
        "mezcla": "organica_fina",
        **extra,
    }


def _preguntas() -> dict[str, dict[str, object]]:
    return {
        "formula": {
            "candidatos": [
                _candidato("arco 3,2 m", "arco", {"ancho_m": 3.2, "alto_m": 2.3}),
                _candidato("guirnalda 2,5 m", "guirnalda", {"largo_m": 2.5}),
            ],
            "objetivo": {"conteo": 60, "exacto": False},
        },
        "motor": {
            "candidatos": [
                _candidato(
                    "arco con motor",
                    "arco",
                    {"ancho_m": 3.2, "alto_m": 2.3},
                    armado_arco=_armado_arco(),
                ),
                _candidato("arco con formula", "arco", {"ancho_m": 3.2, "alto_m": 2.3}),
            ],
            "objetivo": {"conteo": 70, "exacto": False},
        },
        "sin_objetivo": {
            "candidatos": [_candidato("columna 1,6 m", "columna", {"alto_m": 1.6})],
        },
    }


def _respuestas() -> dict[str, Any]:
    salida: dict[str, Any] = {"_comentario": COMENTARIO}
    for nombre, pregunta in _preguntas().items():
        peticion = EstimarConteoRequest.model_validate(
            {"context": CONTEXTO, "schema_version": "estimar-conteo.v1", **pregunta}
        )
        salida[nombre] = {"pregunta": pregunta, "respuesta": estimar_conteo(peticion)}
    return salida


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--escribir", action="store_true", help="reemplaza la fixture")
    args = parser.parse_args(argv)
    respuestas = _respuestas()
    for nombre, entrada in respuestas.items():
        if nombre.startswith("_"):
            continue
        respuesta = cast(dict[str, Any], entrada["respuesta"])
        for candidato in cast(list[dict[str, Any]], respuesta["candidatos"]):
            sugerencia = candidato["sugerencia"]
            print(
                f"{nombre}: {candidato['etiqueta']} -> {candidato['total_vigente']} "
                f"({candidato['fuente']})"
                + ("" if sugerencia is None else f", sugerencia {sugerencia['estado']}")
            )
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
