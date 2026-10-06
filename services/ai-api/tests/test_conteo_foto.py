"""El conteo de la foto al confirmar un plan (ADR-0031, E2).

Reglas puras de ``app/conteo_foto.py`` y la resolución entera con catálogos
falsos (sin proveedores): bouquets, kits y piezas geométricas.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from typing import cast

import pytest
from pydantic import ValidationError

from app.conteo_foto import (
    ALTURA_REFERENCIA_M,
    MAX_MEDIDA_M,
    Cuenta,
    Opcion,
    PuertoPlan,
    aplicar,
    clase_de_diametro,
    clases_desde_por_tamano,
    cuenta_usable,
    eje_libre,
    elegir_opcion,
    medidas_desde_referencia,
    mezcla_de_la_foto,
    reescalar_lectura_armado,
    total_kit_con_armado,
    total_kit_sin_armado,
)
from app.armado_bouquet import EstructuraBouquet, total_leido
from app.plan import _MIXES, resolve_plan
from app.supuestos import MAX_LARGO_SUPUESTO
from tests.test_plan_armado import (
    ROWS,
    ROWS_CON_R18,
    _bouquet,
    _bouquet_dos_tamanos,
    _pista_dos_tamanos,
    _row,
)
from tests.test_plan_armado import _plan as _plan_bouquet
from tests.test_plan_armado import _resolve as _resolver_bouquet
from tests.test_plan_patron import (
    ESPIRAL,
    FakePlanStore as CatalogoGeometrico,
    _request as _peticion_geometrica,
    _row_tamano,
)


def _conteo(**cambios: object) -> dict[str, object]:
    return {
        "referencia_element_id": "REF_01_E01",
        "globos_visibles": 20,
        "exacto": False,
        "estimado_total": None,
        "racimos": None,
        "globos_por_racimo": None,
        "por_tamano": [],
        "largo_relativo": None,
        "alto_relativo": None,
        "confianza": 0.8,
        **cambios,
    }


# --- La cuenta usable ------------------------------------------------------------


def test_la_cuenta_usable_sigue_el_orden_exacta_estimado_racimos() -> None:
    assert cuenta_usable(_conteo(globos_visibles=6, exacto=True)) == Cuenta(6, True)
    assert cuenta_usable(_conteo(estimado_total=90)) == Cuenta(90, False)
    assert cuenta_usable(_conteo(racimos=20, globos_por_racimo=4)) == Cuenta(80, False)
    # Los visibles de una cuenta no exacta dejan fuera los ocultos: no bastan.
    assert cuenta_usable(_conteo()) is None
    assert cuenta_usable(_conteo(estimado_total=90, confianza=0.49)) is None


def test_kit_con_armado_el_conteo_da_la_cantidad() -> None:
    # Dentro de ±15 % (mínimo 2) se queda el armado.
    assert total_kit_con_armado(Cuenta(30, False), 27) == 27
    assert total_kit_con_armado(Cuenta(5, True), 6) == 6
    # Fuera: la cuenta exacta manda, hacia arriba o hacia abajo.
    assert total_kit_con_armado(Cuenta(5, True), 11) == 5
    assert total_kit_con_armado(Cuenta(32, True), 11) == 32
    # Un estimado sube la cifra (un bouquet apilado nunca es exacto), nunca la baja.
    assert total_kit_con_armado(Cuenta(32, False), 11) == 32
    assert total_kit_con_armado(Cuenta(8, False), 20) == 20


def test_kit_sin_armado() -> None:
    assert total_kit_sin_armado(Cuenta(6, True), 15) == 6
    assert total_kit_sin_armado(Cuenta(40, False), 15) == 40
    assert total_kit_sin_armado(Cuenta(16, False), 15) == 15, "dentro de la tolerancia"
    assert total_kit_sin_armado(Cuenta(8, False), 15) == 15, "un estimado no baja"


# --- Reescalar la lectura del armado ------------------------------------------------


def test_reescalar_ajusta_la_cantidad_de_cada_nivel_y_deja_el_sobrante_suelto() -> None:
    lectura = {
        "referencia_element_id": "REF_01_E01",
        "variante": "base_aire",
        "niveles": [
            {"unidad": "cuarteto", "colores": ["blanco", "blanco", "rosado", "rosado"]},
            {"unidad": "trio", "colores": ["rosado", "blanco", "rosado"], "clase_tamano": "grande"},
        ],
        "remate": {"clase": "metalizado", "color": "dorado"},
        "confianza": 0.9,
    }
    nueva = reescalar_lectura_armado(lectura, 29)
    assert nueva is not None
    # El dueño de la cuenta de la lectura dice 29 látex más el remate.
    assert total_leido(nueva) == 30
    # 4:3 → 29 globos: 4 cuartetos (16) y 4 tríos (12); sobra 1, que va suelto.
    assert nueva["niveles"] == [
        {"unidad": "cuarteto", "colores": ["blanco", "blanco", "rosado", "rosado"], "cantidad": 4},
        {
            "unidad": "trio",
            "colores": ["rosado", "blanco", "rosado"],
            "clase_tamano": "grande",
            "cantidad": 4,
        },
        {"unidad": "suelto", "colores": ["blanco"], "cantidad": 1},
    ]
    # Remate, variante y confianza no cambian.
    assert {k: nueva[k] for k in ("remate", "variante", "confianza")} == {
        k: lectura[k] for k in ("remate", "variante", "confianza")
    }


def test_reescalar_empata_a_favor_de_la_base_y_parte_en_tramos_el_tope() -> None:
    lectura = {
        "variante": "base_aire",
        "niveles": [
            {"unidad": "cuarteto", "colores": ["a", "b", "a", "b"], "cantidad": 2},
            {"unidad": "cuarteto", "colores": ["c", "c", "c", "c"], "cantidad": 2},
        ],
        "confianza": 0.9,
    }
    nueva = reescalar_lectura_armado(lectura, 20)
    assert nueva is not None
    # 16 → 20: 2,5 cuartetos cada uno; el cuarteto de sobra va a la base (el primero).
    assert [n["cantidad"] for n in cast(list[dict[str, object]], nueva["niveles"])] == [3, 2]
    grande = reescalar_lectura_armado(lectura, 200)
    assert grande is not None
    # 25 cuartetos por nivel: tramos de a lo sumo 24 unidades, que el armado junta hasta el tope.
    assert [n["cantidad"] for n in cast(list[dict[str, object]], grande["niveles"])] == [
        24,
        1,
        24,
        1,
    ]
    assert total_leido(grande) == 200
    assert reescalar_lectura_armado({"niveles": []}, 10) is None
    assert reescalar_lectura_armado({"niveles": [{"unidad": "trio", "colores": []}]}, 10) is None


def test_la_clase_de_tamano_sale_del_reparto_del_conteo_solo_donde_falta() -> None:
    lectura = {
        "niveles": [
            {
                "unidad": "cuarteto",
                "colores": ["blanco", "rosado", "blanco", "rosado"],
                "cantidad": 3,
            },
            {"unidad": "suelto", "colores": ["blanco"], "cantidad": 4},
            {"unidad": "suelto", "colores": ["dorado"], "clase_tamano": "chico"},
        ],
    }
    reparto = [{"clase": "mediano", "proporcion": 0.75}, {"clase": "grande", "proporcion": 0.25}]
    con_clases = clases_desde_por_tamano(lectura, reparto)
    assert [
        n.get("clase_tamano") for n in cast(list[dict[str, object]], con_clases["niveles"])
    ] == [
        "mediano",
        "grande",
        "chico",
    ]
    assert clases_desde_por_tamano(lectura, []) == lectura


# --- Geométricas: mezcla, escala, elección -------------------------------------------


def test_clases_de_tamano_del_conteo() -> None:
    # Una sola escala con el armado del bouquet (revisión 1/11): 24" es gigante.
    assert [clase_de_diametro(d) for d in (5, 9, 11, 12, 16, 18, 24, 36)] == [
        "chico",
        "chico",
        "mediano",
        "mediano",
        "grande",
        "grande",
        "gigante",
        "gigante",
    ]


def test_la_mezcla_solo_cambia_si_la_foto_la_contradice_claramente() -> None:
    solo_doce = [{"clase": "mediano", "proporcion": 1.0}]
    assert mezcla_de_la_foto(solo_doce, _MIXES, "organica_gruesa") == "clasica"
    parecida = [
        {"clase": "chico", "proporcion": 0.3},
        {"clase": "mediano", "proporcion": 0.6},
        {"clase": "grande", "proporcion": 0.1},
    ]
    assert mezcla_de_la_foto(parecida, _MIXES, "organica_fina") is None
    assert mezcla_de_la_foto([], _MIXES, "organica_fina") is None
    grandes = [{"clase": "grande", "proporcion": 1.0}]
    assert mezcla_de_la_foto(grandes, _MIXES, "clasica") == "solo_grandes"


def test_la_escala_de_la_foto_da_el_centro_de_la_ventana() -> None:
    lectura = _conteo(
        largo_relativo={"referencia": "persona", "veces": 2},
        alto_relativo={"referencia": "puerta", "veces": 1.2},
    )
    assert medidas_desde_referencia("guirnalda", {"largo_m": 2.5}, lectura) == {
        "largo_m": 2 * ALTURA_REFERENCIA_M["persona"]
    }
    assert medidas_desde_referencia("arco", {"ancho_m": 3, "alto_m": 2.4}, lectura) == {
        "ancho_m": 3.4,
        "alto_m": 2.4,
    }
    assert medidas_desde_referencia("columna", {"alto_m": 1.8}, _conteo()) is None


def test_elegir_prefiere_no_mover_medidas_ni_densidad() -> None:
    opciones = [
        Opcion("lujosa", "clasica", {"largo_m": 2.5}, 60, 1.0),
        Opcion("media", "clasica", {"largo_m": 3.1}, 59, 1.24),
        Opcion("sencilla", "clasica", {"largo_m": 2.5}, 37, 1.0),
    ]
    assert elegir_opcion(60, "media", opciones) == opciones[0]
    assert elegir_opcion(200, "media", opciones) is None


# --- Resolución: bouquets y kits ---------------------------------------------------------

LECTURA_ARMADO = {
    "referencia_element_id": "REF_01_E01",
    "variante": "helio_apilado",
    "niveles": [
        {"unidad": "cuarteto", "colores": ["blanco", "rosado", "blanco", "rosado"]},
        {"unidad": "cuarteto", "colores": ["blanco", "rosado", "blanco", "rosado"]},
    ],
    "remate": {"clase": "metalizado", "color": "dorado"},
    "confianza": 0.9,
}


def _estructura(resolved: Mapping[str, object]) -> dict[str, object]:
    plan = cast(dict[str, object], resolved["plan"])
    return cast(list[dict[str, object]], plan["estructuras"])[0]


def _supuestos(resolved: Mapping[str, object]) -> list[str]:
    return cast(list[str], cast(dict[str, object], resolved["plan"])["supuestos"])


def _conteos(resolved: Mapping[str, object]) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], resolved["conteos_referencia"])


@pytest.mark.anyio
async def test_sin_la_bandera_la_resolucion_es_la_de_siempre() -> None:
    base = await _resolver_bouquet(_plan_bouquet(_bouquet()))
    con_pistas = await _resolver_bouquet(
        _plan_bouquet(_bouquet()), pistas_conteo=[_conteo(estimado_total=30)]
    )
    assert con_pistas["plan_hash"] == base["plan_hash"]
    assert "conteos_referencia" not in con_pistas


@pytest.mark.anyio
async def test_un_bouquet_grande_sube_desde_el_armado_que_subcuenta() -> None:
    # SEGUIMIENTO-bouquets.md §14: la lectura del armado ve 2 cuartetos y el remate
    # (9 globos); el conteo estima 30. El conteo da la cantidad; el armado, la distribución.
    resolved = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=7)),
        completar_armados=True,
        pistas_armado=[LECTURA_ARMADO],
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=24, estimado_total=30)],
    )
    estructura = _estructura(resolved)
    assert estructura["unidades_declaradas"] == 30
    armado = cast(dict[str, object], estructura["armado_bouquet"])
    assert (armado["origen"], armado["variante"], armado["remate"]) == (
        "referencia",
        "helio_apilado",
        [2],
    )
    niveles = cast(list[dict[str, object]], armado["niveles"])
    assert niveles[0] == {
        "rol": "capa",
        "unidad": "cuarteto",
        "cantidad": 7,
        "posiciones": [0, 1, 0, 1],
    }
    lineas = {
        str(linea["variant_id"]): cast(int, linea["unidades"])
        for linea in cast(
            list[dict[str, object]],
            cast(list[dict[str, object]], resolved["estructuras"])[0]["lineas"],
        )
    }
    assert sum(lineas.values()) == 30 and lineas["var-foil-dorado"] == 1
    # Un solo supuesto legible, sin el aviso duplicado del armado.
    cantidad = [s for s in _supuestos(resolved) if "Bouquet de globos" in s]
    assert cantidad == [
        "Bouquet de globos: la foto muestra unos 30 globos; el armado leído tenía 9: la cantidad "
        "quedó en 30 (el plan decía 7)."
    ]
    [conteo] = _conteos(resolved)
    assert (
        conteo["decision"],
        conteo["globos_foto"],
        conteo["globos_antes"],
        conteo["globos_despues"],
    ) == (
        "ajustado",
        30,
        7,
        30,
    )
    # El plan firmado es punto fijo: resolverlo otra vez sin la foto da el mismo hash.
    segunda = await _resolver_bouquet(cast(dict[str, object], resolved["plan"]))
    assert segunda["plan_hash"] == resolved["plan_hash"]
    assert "conteos_referencia" not in segunda


@pytest.mark.anyio
async def test_un_estimado_no_baja_el_armado_y_una_cuenta_exacta_si() -> None:
    estimado = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=7)),
        completar_armados=True,
        pistas_armado=[LECTURA_ARMADO],
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=4)],
    )
    assert _estructura(estimado)["unidades_declaradas"] == 9, "manda el armado leído"
    assert _conteos(estimado)[0]["decision"] == "sin_aplicar"
    exacto = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=7)),
        completar_armados=True,
        pistas_armado=[LECTURA_ARMADO],
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=5, exacto=True)],
    )
    # 5 = un cuarteto y el remate.
    assert _estructura(exacto)["unidades_declaradas"] == 5
    assert _conteos(exacto)[0]["decision"] == "ajustado"


@pytest.mark.anyio
async def test_sin_lectura_del_armado_la_cuenta_decide_sola() -> None:
    exacta = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=15)),
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=6, exacto=True)],
    )
    assert _estructura(exacta)["unidades_declaradas"] == 6
    assert any("la foto muestra 6 globos por pieza" in s for s in _supuestos(exacta))
    estimado = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=7, repeticiones=2)),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=12)],
    )
    # Por pieza: 7 / 2 ≈ 4 → 12, por dos repeticiones.
    assert _estructura(estimado)["unidades_declaradas"] == 24
    kit = _bouquet(nombre="Racimo de globos", unidades_declaradas=7)
    kit.pop("estructura_oficial")
    racimo = await _resolver_bouquet(
        _plan_bouquet(kit),
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=9, exacto=True)],
    )
    assert _estructura(racimo)["unidades_declaradas"] == 9


@pytest.mark.anyio
async def test_un_kit_con_armado_propio_no_se_toca() -> None:
    primera = await _resolver_bouquet(_plan_bouquet(_bouquet()), completar_armados=True)
    segunda = await _resolver_bouquet(
        cast(dict[str, object], primera["plan"]),
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=5, exacto=True)],
    )
    assert _estructura(segunda)["unidades_declaradas"] == 7
    assert _conteos(segunda)[0]["decision"] == "sin_aplicar"


@pytest.mark.anyio
async def test_una_lectura_poco_confiable_no_cambia_nada() -> None:
    base = await _resolver_bouquet(_plan_bouquet(_bouquet()))
    resolved = await _resolver_bouquet(
        _plan_bouquet(_bouquet()),
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=30, exacto=True, confianza=0.3)],
    )
    assert _estructura(resolved) == _estructura(base)
    assert [(c["decision"], c["globos_foto"]) for c in _conteos(resolved)] == [
        ("no_confiable", None)
    ]


@pytest.mark.anyio
async def test_sin_cuenta_usable_el_reparto_por_tamano_de_la_foto_sigue_valiendo() -> None:
    """La foto puede enseñar los TAMAÑOS aunque no se puedan contar los globos.

    Hasta el 2026-09-30 el despachador se rendía antes de mirar `por_tamano`: si
    la cuenta no era usable, la lectura entera se tiraba y la mezcla se quedaba
    con la de la tabla. En la pared "Mr & Mrs" eso hizo que el plan comprara 10
    globos de 24" (un cuarto del ancho de la pieza) que la foto no tiene, porque
    `organica_fina` lleva un 2 % de R-24.

    Son dos datos independientes: sin cuenta no se toca la cantidad, pero el
    reparto por tamaño sí se aplica.
    """
    base = await _resolver_geometrico(_plan_geometrico(_guirnalda()))
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        # Sin cuenta usable: ni exacta, ni estimado, ni racimos. Pero el reparto
        # por tamaño dice claramente que esto son globos de 12", sin gigantes.
        pistas_conteo=[
            _conteo(
                globos_visibles=0,
                exacto=False,
                estimado_total=None,
                racimos=None,
                por_tamano=[{"clase": "mediano", "proporcion": 1.0}],
                confianza=0.8,
            )
        ],
    )

    assert _conteos(resolved)[0]["globos_foto"] is None, "sin cuenta, la cantidad no se toca"
    assert _estructura(resolved)["mezcla"] != _estructura(base)["mezcla"], (
        "el reparto por tamaño de la foto sí cambia la mezcla"
    )
    assert _estructura(resolved)["mezcla"] == "clasica", "la foto dice un solo tamaño mediano"


def test_una_pista_fuera_de_contrato_se_rechaza() -> None:
    with pytest.raises(ValidationError):
        _peticion_geometrica(
            {"estructuras": [], "plan_version": "1.0"},
            pistas_conteo=[_conteo(por_tamano=[{"clase": "enorme", "proporcion": 1}])],
        )


# --- El bouquet del 11 (SEGUIMIENTO-bouquets.md §14) con la lectura v2 ---------------

ROWS_NUMEROS = [
    *ROWS,
    _row(
        "num3-dorado",
        "B2b Globo Metalizado Numero 3 Dorado",
        "34 IN",
        forma=None,
        diam=None,
        codigo="34 IN",
    ),
    _row(
        "num5-dorado",
        "B2b Globo Metalizado Numero 5 Dorado",
        "34 IN",
        forma=None,
        diam=None,
        codigo="34 IN",
    ),
]


def _bouquet_con_numeros() -> dict[str, object]:
    base = _bouquet(unidades_declaradas=11)
    materiales = cast(list[dict[str, object]], base["materiales"])
    numeros = [
        {
            "product_id": f"prod-num{digito}-dorado",
            "variant_id": f"var-num{digito}-dorado",
            "color": "dorado",
            "participacion": 0.1,
            "rol_material": "secundario",
        }
        for digito in (3, 5)
    ]
    partes = (0.35, 0.35, 0.1)
    return {
        **base,
        "materiales": [
            *({**m, "participacion": parte} for m, parte in zip(materiales, partes, strict=True)),
            *numeros,
        ],
    }


def _lectura_once(**nivel: object) -> dict[str, object]:
    cuarteto = {"unidad": "cuarteto", "colores": ["blanco", "rosado", "blanco", "rosado"], **nivel}
    return {
        "referencia_element_id": "REF_01_E01",
        "variante": "base_aire",
        "niveles": [cuarteto, dict(cuarteto)],
        "remate": {"clase": "metalizado", "color": "dorado"},
        "numeros": [
            {"digito": "3", "clase_tamano": "grande"},
            {"digito": "5", "clase_tamano": "grande"},
        ],
        "disposicion": "centro",
        "confianza": 0.85,
    }


@pytest.mark.anyio
async def test_el_bouquet_del_11_con_conteo_sube_a_unos_35_por_cantidad() -> None:
    # Lectura v1: dos cuartetos sin cantidad (8) + corona + 3 y 5 = 11. El conteo estima 35.
    resolved = await _resolver_bouquet(
        _plan_bouquet(_bouquet_con_numeros()),
        ROWS_NUMEROS,
        completar_armados=True,
        pistas_armado=[_lectura_once()],
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=26, estimado_total=35)],
    )
    estructura = _estructura(resolved)
    assert estructura["unidades_declaradas"] == 35
    armado = cast(dict[str, object], estructura["armado_bouquet"])
    # 32 látex: los dos niveles leídos pasan de 1 a 4 cuartetos (posiciones intactas).
    assert armado["niveles"] == [
        {"rol": "base", "unidad": "cuarteto", "cantidad": 8, "posiciones": [0, 1, 0, 1]}
    ]
    assert cast(dict[str, object], armado["numero"])["digitos"] == [3, 4]
    lineas = {
        str(linea["variant_id"]): cast(int, linea["unidades"])
        for linea in cast(
            list[dict[str, object]],
            cast(list[dict[str, object]], resolved["estructuras"])[0]["lineas"],
        )
    }
    assert lineas == {
        "var-r12-blanco": 16,
        "var-r12-rosado": 16,
        "var-foil-dorado": 1,
        "var-num3-dorado": 1,
        "var-num5-dorado": 1,
    }
    assert [s for s in _supuestos(resolved) if "Bouquet de globos" in s] == [
        "Bouquet de globos: la foto muestra unos 35 globos; el armado leído tenía 11: la cantidad "
        "quedó en 35 (el plan decía 11)."
    ]


@pytest.mark.anyio
async def test_la_lectura_con_cantidad_coincide_con_el_conteo_y_se_queda_el_armado() -> None:
    # Lectura v2: 4 cuartetos por nivel (32) + corona + 3 y 5 = 35; el conteo estima 36.
    resolved = await _resolver_bouquet(
        _plan_bouquet(_bouquet_con_numeros()),
        ROWS_NUMEROS,
        completar_armados=True,
        pistas_armado=[_lectura_once(cantidad=4)],
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=26, estimado_total=36)],
    )
    assert _estructura(resolved)["unidades_declaradas"] == 35
    [conteo] = _conteos(resolved)
    assert (conteo["decision"], conteo["globos_despues"], conteo["cambios"]) == ("coincide", 35, [])
    # El único ajuste de cantidad es el del armado leído (ADR-0030), sin supuesto del conteo.
    assert not any("el armado leído tenía" in s for s in _supuestos(resolved))


@pytest.mark.anyio
async def test_los_tamanos_salen_del_reparto_del_conteo_si_la_lectura_no_los_dice() -> None:
    reparto = [{"clase": "mediano", "proporcion": 0.75}, {"clase": "grande", "proporcion": 0.25}]
    resolved = await _resolver_bouquet(
        _plan_bouquet(_bouquet_dos_tamanos()),
        ROWS_CON_R18,
        completar_armados=True,
        pistas_armado=[_pista_dos_tamanos()],
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=17, exacto=True, por_tamano=reparto)],
    )
    lineas = sorted(
        (str(linea["variant_id"]), cast(int, linea["unidades"]))
        for linea in cast(
            list[dict[str, object]],
            cast(list[dict[str, object]], resolved["estructuras"])[0]["lineas"],
        )
    )
    # Sin el reparto (prueba de test_plan_armado) el blanco de 18" se quitaba: 10 blancos de 12".
    assert lineas == [
        ("var-foil-dorado", 1),
        ("var-r12-blanco", 6),
        ("var-r12-rosado", 6),
        ("var-r18-blanco", 4),
    ]
    assert not any("se quitó" in s for s in _supuestos(resolved))


@pytest.mark.anyio
async def test_el_bouquet_de_5_sigue_dando_5() -> None:
    pista = {
        "referencia_element_id": "REF_01_E01",
        "variante": "helio_escalonado",
        "niveles": [
            {"unidad": "suelto", "colores": ["blanco", "blanco"]},
            {"unidad": "suelto", "colores": ["rosado", "rosado"]},
        ],
        "remate": {"clase": "metalizado", "color": "dorado"},
        "confianza": 0.9,
    }
    sin_conteo = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=15)),
        completar_armados=True,
        pistas_armado=[pista],
    )
    con_conteo = await _resolver_bouquet(
        _plan_bouquet(_bouquet(unidades_declaradas=15)),
        completar_armados=True,
        pistas_armado=[pista],
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=5, exacto=True)],
    )
    assert _estructura(sin_conteo)["unidades_declaradas"] == 5
    assert _estructura(con_conteo)["unidades_declaradas"] == 5
    assert _conteos(con_conteo)[0]["decision"] == "coincide"


# --- Resolución: piezas geométricas -----------------------------------------------------

FILAS = [
    _row_tamano(color, pulgadas) for color in ("blanco", "negro") for pulgadas in (5, 9, 12, 18, 24)
]


def _guirnalda(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": "EST_01_GUIRNALDA",
        "nombre": "Guirnalda",
        "tipo": "guirnalda",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"largo_m": 2.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "referencia_element_id": "REF_01_E01",
        "materiales": [
            {
                "product_id": "prod-blanco",
                "color": "blanco",
                "participacion": 0.5,
                "rol_material": "principal",
            },
            {
                "product_id": "prod-negro",
                "color": "negro",
                "participacion": 0.5,
                "rol_material": "secundario",
            },
        ],
        "porque": "Guirnalda de prueba.",
        **extra,
    }


def _plan_geometrico(
    *estructuras: dict[str, object], fuente: str = "supuesto"
) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "31313131-3131-4313-8313-313131313131",
        "concepto": {"titulo": "Prueba", "descripcion": "Conteo.", "paleta": ["blanco", "negro"]},
        "espacio": {"tipo": "salon", "fuente": fuente},
        "estructuras": list(estructuras),
        "supuestos": [],
        "referencia_omitida": [],
    }


async def _resolver_geometrico(
    plan: Mapping[str, object], filas: Sequence[dict[str, object]] = FILAS, **extra: object
) -> dict[str, object]:
    variantes: dict[str, list[str]] = {}
    for fila in filas:
        variantes.setdefault(str(fila["product_id"]), []).append(str(fila["variant_id"]))
    request = _peticion_geometrica(
        plan,
        allowlist=[{"product_id": p, "variant_ids": ids} for p, ids in variantes.items()],
        **extra,
    )
    result = await resolve_plan(request, CatalogoGeometrico(filas))
    return cast(dict[str, object], result["plan_resuelto"])


@pytest.mark.anyio
async def test_primero_la_densidad_con_el_largo_fijo() -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=60)],
    )
    estructura = _estructura(resolved)
    assert (estructura["densidad"], estructura["medidas"]) == ("lujosa", {"largo_m": 2.5})
    [conteo] = _conteos(resolved)
    assert (conteo["globos_antes"], conteo["globos_despues"]) == (48, 60)
    assert conteo["cambios"] == [{"campo": "densidad", "antes": "media", "despues": "lujosa"}]
    assert (
        "Guirnalda: la foto muestra unos 60 globos y el plan tenía 48; densidad media → lujosa: "
        "quedó en 60." in _supuestos(resolved)
    )
    assert not [
        a for a in cast(list[str], resolved["advertencias"]) if a.startswith("puerta_fisica:")
    ]


@pytest.mark.anyio
async def test_el_largo_se_mueve_solo_si_la_densidad_no_alcanza_y_se_dice_equivalente() -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=75)],
    )
    estructura = _estructura(resolved)
    largo = cast(dict[str, float], estructura["medidas"])["largo_m"]
    assert estructura["densidad"] == "lujosa" and 2.5 < largo <= 2.5 * 1.35
    # Una sola medida: en singular (2026-09-28).
    assert any("m equivalente a la foto (no medido)" in s for s in _supuestos(resolved))
    assert "dentro de ±35 %" in cast(str, _conteos(resolved)[0]["motivo"])


# --- Enmienda 2026-09-28: sin medidas del cliente, la cantidad decide el eje libre ------

#: La lectura real de la foto del caso (guirnalda orgánica en pared, 2026-09-28).
LECTURA_DEL_CASO = _conteo(
    globos_visibles=54,
    exacto=False,
    estimado_total=75,
    por_tamano=[{"clase": "chico", "proporcion": 0.4}, {"clase": "mediano", "proporcion": 0.6}],
    confianza=0.85,
)


def test_solo_la_guirnalda_y_la_columna_tienen_un_solo_eje_libre() -> None:
    assert eje_libre("guirnalda", {"largo_m": 0.5}) == "largo_m"
    assert eje_libre("guirnalda", {"ancho_m": 2.0}) == "ancho_m"
    assert eje_libre("columna", {"alto_m": 1.8, "ancho_m": 0.4}) == "alto_m"
    for tipo, medidas in (
        ("arco", {"ancho_m": 3.0, "alto_m": 2.4}),
        ("semiarco", {"ancho_m": 1.2, "alto_m": 2.2}),
        ("pared", {"ancho_m": 2.4, "alto_m": 2.4}),
        ("centro_mesa", {"ancho_m": 0.4, "alto_m": 0.5}),
        ("guirnalda", {}),
    ):
        assert eje_libre(tipo, medidas) is None, tipo


@pytest.mark.anyio
async def test_un_largo_que_el_cliente_no_dio_no_deja_la_guirnalda_en_una_fraccion_de_la_foto() -> (
    None
):
    # El caso: el chat declaró 0,5 m sin que el cliente diera medidas y la foto
    # tiene unos 75 globos; ±35 % de 0,5 m no llega. La cantidad decide el largo,
    # con la densidad y la mezcla que el plan eligió.
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(medidas={"largo_m": 0.5})),
        completar_conteos=True,
        pistas_conteo=[LECTURA_DEL_CASO],
    )
    estructura = _estructura(resolved)
    [conteo] = _conteos(resolved)
    largo = cast(dict[str, float], estructura["medidas"])["largo_m"]
    assert conteo["decision"] == "ajustado"
    assert (estructura["densidad"], estructura["mezcla"]) == ("media", "organica_fina")
    assert largo > 0.5 * 1.35
    assert conteo["cambios"] == [{"campo": "largo_m", "antes": 0.5, "despues": largo}]
    unidades = cast(list[dict[str, object]], resolved["estructuras"])[0]["total_unidades"]
    assert conteo["globos_despues"] == unidades
    assert abs(cast(int, unidades) - 75) <= 0.15 * 75, "dentro de la tolerancia del conteo"
    assert "la cantidad de la foto decide el eje" in cast(str, conteo["motivo"])
    [supuesto] = [s for s in _supuestos(resolved) if s.startswith("Guirnalda: la foto")]
    assert "largo 0,5 → " in supuesto and "m equivalente a la foto (no medido)" in supuesto
    assert len(supuesto) <= MAX_LARGO_SUPUESTO
    assert not [
        a for a in cast(list[str], resolved["advertencias"]) if a.startswith("puerta_fisica:")
    ]
    # Es el largo que da el conteo: un centímetro menos queda más lejos de la foto.
    menos = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(medidas={"largo_m": round(largo - 0.01, 2)}))
    )
    total_menos = cast(list[dict[str, object]], menos["estructuras"])[0]["total_unidades"]
    assert abs(cast(int, total_menos) - 75) >= abs(cast(int, unidades) - 75)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("fuente", "extra"),
    [("cliente", {}), ("supuesto", {"medidas_del_cliente": True})],
)
async def test_con_medidas_del_cliente_el_conteo_no_toca_ni_un_largo_chico(
    fuente: str, extra: dict[str, object]
) -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(medidas={"largo_m": 0.5}), fuente=fuente),
        completar_conteos=True,
        pistas_conteo=[LECTURA_DEL_CASO],
        **extra,
    )
    assert _estructura(resolved)["medidas"] == {"largo_m": 0.5}
    [conteo] = _conteos(resolved)
    assert conteo["decision"] == "sin_ajuste_posible"
    assert "medidas fijas" in cast(str, conteo["motivo"])


@pytest.mark.anyio
async def test_una_columna_sin_medidas_del_cliente_toma_el_alto_de_la_foto() -> None:
    columna = {
        **_guirnalda(),
        "estructura_id": "EST_01_COLUMNA",
        "nombre": "Columna",
        "tipo": "columna",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 0.6},
    }
    resolved = await _resolver_geometrico(
        _plan_geometrico(columna),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=60)],
    )
    [conteo] = _conteos(resolved)
    alto = cast(dict[str, float], _estructura(resolved)["medidas"])["alto_m"]
    assert conteo["decision"] == "ajustado" and alto > 0.6 * 1.35
    assert abs(cast(int, conteo["globos_despues"]) - 60) <= 0.15 * 60
    assert any("alto 0,6 → " in s for s in _supuestos(resolved))


@pytest.mark.anyio
async def test_un_arco_tiene_dos_medidas_y_se_queda_en_la_ventana() -> None:
    arco = {
        **_guirnalda(),
        "estructura_id": "EST_01_ARCO",
        "nombre": "Arco",
        "tipo": "arco",
        "ubicacion": "arco_central",
        "medidas": {"ancho_m": 1.0, "alto_m": 0.8},
    }
    resolved = await _resolver_geometrico(
        _plan_geometrico(arco),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=300)],
    )
    assert _estructura(resolved)["medidas"] == {"ancho_m": 1.0, "alto_m": 0.8}
    [conteo] = _conteos(resolved)
    assert conteo["decision"] == "sin_ajuste_posible"
    assert "±35 %" in cast(str, conteo["motivo"])


def _puerto_lineal(por_metro: Mapping[str, float], largo_maximo: float) -> PuertoPlan:
    """Un plan de mentira: globos por metro según la densidad y una puerta por largo."""

    def largo(estructura: Mapping[str, object]) -> float:
        return float(cast(Mapping[str, float], estructura["medidas"])["largo_m"])

    def sin_kits(_estructura: Mapping[str, object]) -> EstructuraBouquet:
        raise AssertionError("no hay kits en esta prueba")

    return PuertoPlan(
        contar=lambda e: math.ceil(por_metro[str(e["densidad"])] * largo(e)),
        dentro_de_puerta=lambda e, _total: largo(e) <= largo_maximo,
        mezcla_cubierta=lambda _e, _mezcla: True,
        contexto_kit=sin_kits,
        sincronizar_patron=lambda e: dict(e),
        mezclas=_MIXES,
        tamanos_obligatorios=False,
    )


def _plan_lineal() -> dict[str, object]:
    return {
        "espacio": {"tipo": "salon", "fuente": "supuesto"},
        "estructuras": [
            {
                "estructura_id": "EST_01_GUIRNALDA",
                "nombre": "Guirnalda",
                "tipo": "guirnalda",
                "densidad": "media",
                "mezcla": "organica_fina",
                "medidas": {"largo_m": 0.5},
                "referencia_element_id": "REF_01_E01",
            }
        ],
        "supuestos": [],
    }


def test_la_cantidad_decide_el_largo_dentro_de_la_puerta_fisica_y_del_tope() -> None:
    por_metro = {"sencilla": 16.0, "media": 20.0, "lujosa": 25.0}

    def aplicar_con(globos: int, puerto: PuertoPlan) -> tuple[dict[str, object], dict[str, object]]:
        plan_, _lecturas, [conteo] = aplicar(
            _plan_lineal(),
            [_conteo(estimado_total=globos)],
            [],
            usar_armados=False,
            solo=None,
            puerto=puerto,
        )
        return cast(list[dict[str, object]], plan_["estructuras"])[0], conteo

    # Dentro de la puerta: la densidad del plan y el largo que da la cuenta.
    estructura, conteo = aplicar_con(50, _puerto_lineal(por_metro, 3.0))
    assert (conteo["decision"], conteo["globos_despues"]) == ("ajustado", 50)
    largo = cast(dict[str, float], estructura["medidas"])["largo_m"]
    assert estructura["densidad"] == "media" and largo == pytest.approx(2.5, abs=0.05)
    # Fuera de la puerta con todas las densidades: nada cambia.
    estructura, conteo = aplicar_con(100, _puerto_lineal(por_metro, 3.0))
    assert conteo["decision"] == "sin_ajuste_posible"
    assert estructura["medidas"] == {"largo_m": 0.5}
    assert "puerta física" in cast(str, conteo["motivo"])
    # Más allá de MAX_MEDIDA_M tampoco.
    estructura, conteo = aplicar_con(
        150, _puerto_lineal({"sencilla": 1.0, "media": 1.0, "lujosa": 1.0}, 1000.0)
    )
    assert conteo["decision"] == "sin_ajuste_posible"
    assert 150 > MAX_MEDIDA_M and estructura["medidas"] == {"largo_m": 0.5}


@pytest.mark.anyio
async def test_con_medidas_del_cliente_solo_cambia_la_densidad() -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(), fuente="cliente"),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=75)],
    )
    assert _estructura(resolved)["medidas"] == {"largo_m": 2.5}
    assert _conteos(resolved)[0]["decision"] == "sin_ajuste_posible"


@pytest.mark.anyio
async def test_la_escala_de_la_foto_centra_la_ventana_del_largo() -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[
            _conteo(estimado_total=100, largo_relativo={"referencia": "persona", "veces": 2.4})
        ],
    )
    largo = cast(dict[str, float], _estructura(resolved)["medidas"])["largo_m"]
    assert largo == pytest.approx(2.4 * ALTURA_REFERENCIA_M["persona"], abs=0.02)


@pytest.mark.anyio
async def test_la_mezcla_cambia_cuando_la_foto_la_contradice_y_el_catalogo_la_cubre() -> None:
    solo_doce = [{"clase": "mediano", "proporcion": 1.0}]
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=50, por_tamano=solo_doce)],
    )
    assert _estructura(resolved)["mezcla"] == "clasica"
    # Sin globos de 12" ni vecinos que los sustituyan (9", 18"), la mezcla de la foto
    # no se cubre con el catálogo: no se toca.
    sin_doce = [f for f in FILAS if f["diam_pulg"] in (5, 24)]
    sin_cobertura = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        sin_doce,
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=50, por_tamano=solo_doce)],
    )
    assert _estructura(sin_cobertura)["mezcla"] == "organica_fina"
    # Tras una edición (completar_conteos_de) la mezcla es la que eligió el decorador.
    editado = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=50, por_tamano=solo_doce)],
        completar_conteos_de=["EST_01_GUIRNALDA"],
    )
    assert _estructura(editado)["mezcla"] == "organica_fina"


@pytest.mark.anyio
async def test_la_mezcla_que_dijo_la_lectura_de_tamanos_no_la_mueve_el_conteo() -> None:
    """Dos lecturas de tamaños, un dueño: la de ``pistas_tamanos`` (la que arma el motor).

    El reparto del conteo también cuenta el globo que corona una columna; en las pruebas del 2026-10-05
    unas columnas que la lectura de tamaños dejó en ``clasica`` salían ``organica_fina`` con un armado
    de anillos.
    """
    solo_doce = [{"clase": "mediano", "proporcion": 1.0}]
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=50, por_tamano=solo_doce)],
        pistas_tamanos=[
            {
                "referencia_element_id": "REF_01_E01",
                "tamanos": "chicos_con_pocos_grandes",
                "confianza": 0.9,
            }
        ],
    )
    assert _estructura(resolved)["mezcla"] == "organica_fina"


@pytest.mark.anyio
async def test_f7_3_el_racimo_compra_la_mezcla_de_tamanos_leida() -> None:
    """El kit conserva sus unidades declaradas, pero resuelve compras por cada talla del mix de foto."""
    racimo = {
        "estructura_id": "EST_01_RACIMO",
        "nombre": "Racimo de pared",
        "tipo": "kit",
        "estructura_oficial": "racimo_pared",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 0.8, "alto_m": 1.1},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {"product_id": "prod-blanco", "color": "blanco", "participacion": 1.0, "rol_material": "principal"}
        ],
        "unidades_declaradas": 40,
        "porque": "Racimo orgánico fijado a la pared.",
        "referencia_element_id": "REF_01_E01",
    }
    filas = [_row_tamano("blanco", pulgadas) for pulgadas in (5, 9, 12, 18, 24)]
    resolved = await _resolver_geometrico(
        _plan_geometrico(racimo, fuente="foto"),
        filas,
        pistas_tamanos=[
            {
                "referencia_element_id": "REF_01_E01",
                "tamanos": "grandes_con_pocos_chicos",
                "confianza": 0.9,
            }
        ],
    )

    assert _estructura(resolved)["mezcla"] == "organica_gruesa"
    lineas = cast(list[dict[str, object]], resolved["estructuras"][0]["lineas"])
    assert {linea["tamano_codigo"] for linea in lineas} == {"R-9", "R-12", "R-18", "R-24"}
    assert sum(int(linea["unidades"]) for linea in lineas) == 40


@pytest.mark.anyio
async def test_solo_la_pieza_pedida_tras_una_edicion() -> None:
    otra = _guirnalda(estructura_id="EST_02_GUIRNALDA", nombre="Otra guirnalda")
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(), otra),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=60)],
        completar_conteos_de=["EST_02_GUIRNALDA"],
    )
    estructuras = cast(
        list[dict[str, object]], cast(dict[str, object], resolved["plan"])["estructuras"]
    )
    assert [e["densidad"] for e in estructuras] == ["media", "lujosa"]
    # La otra pieza conserva su lectura para una edición posterior, sin ajustarse.
    assert [(c["estructura_id"], c["decision"]) for c in _conteos(resolved)] == [
        ("EST_01_GUIRNALDA", "sin_aplicar"),
        ("EST_02_GUIRNALDA", "ajustado"),
    ]
    # Sin pieza pedida (una edición que no es de mezcla) nada se ajusta y las lecturas siguen.
    ninguna = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(), otra),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=60)],
        completar_conteos_de=[],
    )
    base = await _resolver_geometrico(_plan_geometrico(_guirnalda(), otra))
    assert ninguna["plan_hash"] == base["plan_hash"]
    assert {c["decision"] for c in _conteos(ninguna)} == {"sin_aplicar"}


@pytest.mark.anyio
async def test_una_pieza_con_patron_se_resincroniza_y_es_punto_fijo() -> None:
    columna = {
        **_guirnalda(),
        "estructura_id": "EST_01_COLUMNA",
        "nombre": "Columna",
        "tipo": "columna",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 1.8},
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": "prod-blanco",
                "color": "blanco",
                "participacion": 0.5,
                "rol_material": "principal",
            },
            {
                "product_id": "prod-negro",
                "color": "negro",
                "participacion": 0.25,
                "rol_material": "secundario",
            },
            {
                "product_id": "prod-negro",
                "color": "negro",
                "participacion": 0.25,
                "rol_material": "secundario",
            },
        ],
        "patron_color": ESPIRAL,
    }
    base = await _resolver_geometrico(_plan_geometrico(columna))
    antes = cast(list[dict[str, object]], base["estructuras"])[0]["total_unidades"]
    resolved = await _resolver_geometrico(
        _plan_geometrico(columna),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=round(cast(int, antes) * 1.3))],
    )
    assert _estructura(resolved)["densidad"] == "lujosa"
    segunda = await _resolver_geometrico(cast(dict[str, object], resolved["plan"]))
    assert segunda["plan_hash"] == resolved["plan_hash"]


@pytest.mark.anyio
async def test_conteos_referencia_queda_fuera_del_hash() -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=60)],
    )
    snapshot = {
        "catalog_snapshot_id": "products_catalog:patrones",
        "estructuras": resolved["estructuras"],
        "compras": resolved["compras"],
        "total_cop": cast(dict[str, object], resolved["totales"])["total_cop"],
    }
    canonical = json.dumps(
        {"plan": resolved["plan"], "snapshot": snapshot},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    assert resolved["plan_hash"] == hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    segunda = await _resolver_geometrico(cast(dict[str, object], resolved["plan"]))
    assert segunda["plan_hash"] == resolved["plan_hash"]


def _como_javascript(valor: object) -> object:
    """Lo que devuelve JSON.parse en JavaScript: 2.0 llega como 2."""
    if isinstance(valor, float) and valor.is_integer():
        return int(valor)
    if isinstance(valor, dict):
        return {clave: _como_javascript(v) for clave, v in valor.items()}
    if isinstance(valor, list):
        return [_como_javascript(v) for v in valor]
    return valor


@pytest.mark.anyio
async def test_el_hash_sobrevive_al_viaje_por_javascript() -> None:
    """CASE-008 de images-judge (2026-10-05): «Plan hash does not match» al generar.

    El conteo de la foto pasa las medidas a float (`ancho_m: 2.0`); JavaScript devuelve el plan con `2`, y el
    plan re-resuelto al generar firmaba «2» donde el confirmado firmó «2.0». El hash firma ahora los números
    como los escribe JSON en los dos lados.
    """
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda(medidas={"largo_m": 3, "ancho_m": 2})),
        completar_conteos=True,
        pistas_conteo=[_conteo(globos_visibles=120, estimado_total=250)],
    )
    plan = cast(dict[str, object], resolved["plan"])
    medidas = cast(dict[str, object], cast(list[dict[str, object]], plan["estructuras"])[0]["medidas"])
    assert any(isinstance(v, float) and v.is_integer() for v in medidas.values()), medidas
    segunda = await _resolver_geometrico(cast(dict[str, object], _como_javascript(plan)))
    assert segunda["plan_hash"] == resolved["plan_hash"]
