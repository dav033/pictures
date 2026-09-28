"""Planes reales de Python para las pruebas del armado de guirnalda en los prompts (ADR-0032, E5).

Resuelve con ``resolve_plan`` (sin red ni catálogo real) una serie de planes
con guirnaldas sobre el catálogo de prueba de ``tests/guirnalda_datos.py`` y
escribe ``scripts/fixtures/armado-guirnalda-prompt/planes.json``, que lee
``scripts/test/test-armado-guirnalda-prompt.ts``. Así TypeScript prueba sus
prompts contra las frases que Python escribe de verdad.

Por defecto es vista previa: resuelve y muestra cada plan con su armado y sus
frases, sin escribir nada. ``--escribir`` reemplaza la fixture; hacerlo solo a
propósito, cuando cambian las frases de Python, nunca para que pase una prueba
de TypeScript. Los planes ``*-sin-armado`` deben salir iguales siempre: si
cambian, cambió la resolución sin armado.

    uv run --directory services/ai-api python scripts/fixture_armado_guirnalda_prompt.py
    uv run --directory services/ai-api python scripts/fixture_armado_guirnalda_prompt.py --escribir
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import cast

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_DIR.parents[1]
FIXTURE = REPO_ROOT / "scripts" / "fixtures" / "armado-guirnalda-prompt" / "planes.json"

COMENTARIO = (
    "Salidas reales de Python (resolve_plan, sin red) con el catálogo de prueba de "
    "services/ai-api/tests/guirnalda_datos.py: látex rosado, blanco y dorado en 5, 9, 12, 18 y "
    "24 pulgadas; una guirnalda de 2,5 m media organica_fina (rosado 0,6, blanco 0,4) y un arco "
    "dorado. Los planes '*-sin-armado' se resolvieron con el código anterior a E5 (27528f2) y "
    "salen idénticos con E5. Los demás llevan armado_guirnalda (receta con "
    "completar_armados_guirnalda o armado del decorador) y, donde se nombra, patrón completado "
    "con completar_patrones. Generado con services/ai-api/scripts/"
    "fixture_armado_guirnalda_prompt.py --escribir; regenerar solo a propósito, nunca para que "
    "pase una prueba de TypeScript."
)

Casos = dict[str, tuple[dict[str, object], dict[str, object]]]


def _armado(**extra: object) -> dict[str, object]:
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": {"material": 0, "proporcion": 0.2},
        "remates": [],
        **extra,
    }


def casos() -> Casos:
    """Nombre -> (plan, campos extra de la petición), en el orden de la fixture."""
    from tests.guirnalda_datos import arco, guirnalda, material, plan

    tres = [
        material("rosado", 0.5, principal=True),
        material("blanco", 0.3),
        material("dorado", 0.2),
    ]
    confirmar: dict[str, object] = {"completar_armados_guirnalda": True}
    return {
        # Sin armado: la instantánea de los prompts de antes sale de estos planes.
        "pared-sin-armado": (plan(guirnalda(), arco()), {}),
        "piso-sin-armado": (plan(guirnalda(ubicacion="piso_frontal"), arco()), {}),
        "mesa-sin-armado": (plan(guirnalda(ubicacion="sobre_mesa_principal"), arco()), {}),
        "clasica-patron-sin-armado": (
            plan(guirnalda(mezcla="clasica"), arco()),
            {"completar_patrones": True},
        ),
        "repetida-sin-armado": (plan(guirnalda(repeticiones=2), arco()), {}),
        # La receta al confirmar: soporte por ubicación, recta, relleno y remates.
        "pared": (plan(guirnalda(), arco()), confirmar),
        "piso": (plan(guirnalda(ubicacion="piso_frontal"), arco()), confirmar),
        "mesa": (plan(guirnalda(ubicacion="sobre_mesa_principal"), arco()), confirmar),
        # Armados del decorador.
        "colgada": (
            plan(
                guirnalda(
                    armado_guirnalda=_armado(
                        soporte="colgada",
                        forma="arco_caido",
                        caida_m=0.4,
                        puntos_de_anclaje=3,
                        racimo={"unidad": "trio", "tamano_pulg_base": 12},
                    )
                ),
                arco(),
            ),
            {},
        ),
        "mesa-decorador": (
            plan(guirnalda(armado_guirnalda=_armado(soporte="mesa", forma="ondulada")), arco()),
            {},
        ),
        "sobre-arco": (
            plan(
                guirnalda(
                    armado_guirnalda=_armado(
                        soporte="sobre_estructura", estructura_id="EST_02_ARCO", forma="curva"
                    )
                ),
                arco(),
            ),
            {},
        ),
        # Armado del decorador y patrón completado después: el preset va por racimo.
        "pared-patron-por-racimo": (
            plan(guirnalda(armado_guirnalda=_armado()), arco()),
            {"completar_patrones": True},
        ),
        "pared-tres-colores-trio": (
            plan(
                guirnalda(
                    materiales=tres,
                    armado_guirnalda=_armado(racimo={"unidad": "trio", "tamano_pulg_base": 12}),
                    densidad="sencilla",
                ),
                arco(),
            ),
            {"completar_patrones": True},
        ),
        # U invertida colgada de dos puntos con anillos en espejo desde el centro.
        "u-invertida-espejo": (
            plan(
                guirnalda(
                    armado_guirnalda=_armado(
                        soporte="colgada", forma="u_invertida", caida_m=0.6, puntos_de_anclaje=2
                    ),
                    patron_color={
                        "version": "patron-color.v1",
                        "origen": "decorador",
                        "globos_por_racimo": 4,
                        "base": {"modo": "anillos", "secuencia": [0, 1], "largo": 2},
                        "simetria": "espejo",
                    },
                ),
                arco(),
            ),
            {},
        ),
        "repetida": (plan(guirnalda(repeticiones=2), arco()), confirmar),
        # Revisión (hallazgo 17): clásica, la receta no lleva relleno ni remates.
        "clasica-sin-relleno": (plan(guirnalda(mezcla="clasica"), arco()), confirmar),
        # Revisión (hallazgo 15): un par de columnas y dos guirnaldas abrazadas a ellas.
        "sobre-columnas-repetidas": (
            plan(
                guirnalda(
                    repeticiones=2,
                    ubicacion="lateral_izquierdo",
                    armado_guirnalda=_armado(
                        soporte="sobre_estructura", estructura_id="EST_02_COLUMNA", forma="curva"
                    ),
                ),
                arco(
                    estructura_id="EST_02_COLUMNA",
                    nombre="Columna",
                    tipo="columna",
                    estructura_oficial="columna",
                    ubicacion="lateral_izquierdo",
                    medidas={"alto_m": 2.0},
                    repeticiones=2,
                    rol_escena="soporte",
                ),
            ),
            {},
        ),
    }


async def resolver_casos() -> dict[str, object]:
    from app.plan import resolve_plan
    from tests.guirnalda_datos import FakePlanStore, request

    planes: dict[str, object] = {}
    for nombre, (plan_, extra) in casos().items():
        resultado = await resolve_plan(request(plan_, **extra), FakePlanStore())
        planes[nombre] = {
            "plan_resuelto": resultado["plan_resuelto"],
            "material_estimate": resultado["material_estimate"],
        }
    return planes


def _resumen(planes: Mapping[str, object]) -> None:
    for nombre, datos in planes.items():
        resuelto = cast(Mapping[str, object], cast(Mapping[str, object], datos)["plan_resuelto"])
        armados = cast(list[Mapping[str, object]], resuelto.get("armados_guirnalda", []))
        print(nombre)
        for armado in armados:
            forma = cast(Mapping[str, object], armado["armado"])
            print(
                f"  {forma['soporte']} {forma['forma']}: {len(cast(list[object], armado['racimos']))} racimos"
            )
            print(f"  LoRA: {armado['prompt_lora']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--escribir", action="store_true", help=f"reemplaza {FIXTURE}")
    args = parser.parse_args(argv)
    sys.path.insert(0, str(SERVICE_DIR))
    planes = asyncio.run(resolver_casos())
    _resumen(planes)
    if not args.escribir:
        print(f"\nVista previa: {len(planes)} planes; nada escrito (usa --escribir).")
        return 0
    contenido = {"_comentario": COMENTARIO, "planes": planes}
    FIXTURE.write_text(
        json.dumps(contenido, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"\n{len(planes)} planes -> {FIXTURE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
