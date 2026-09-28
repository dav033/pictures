"""El conteo de la foto al confirmar un plan (ADR-0031, E2).

Reglas puras de ``app/conteo_foto.py`` y la resolución entera con catálogos
falsos (sin proveedores): bouquets, kits y piezas geométricas.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import cast

import pytest
from pydantic import ValidationError

from app.conteo_foto import (
    ALTURA_REFERENCIA_M,
    Cuenta,
    Opcion,
    clase_de_diametro,
    cuenta_usable,
    elegir_opcion,
    medidas_desde_referencia,
    mezcla_de_la_foto,
    reescalar_lectura_armado,
    total_kit_con_armado,
    total_kit_sin_armado,
)
from app.plan import _MIXES, resolve_plan
from tests.test_plan_armado import _bouquet, _plan as _plan_bouquet, _resolve as _resolver_bouquet
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


def _globos(lectura: Mapping[str, object]) -> int:
    unidades = {"suelto": 1, "pareja": 2, "trio": 3, "cuarteto": 4, "quinteto": 5, "sexteto": 6}
    total = 0
    for nivel in cast(list[dict[str, object]], lectura["niveles"]):
        colores = cast(list[str], nivel["colores"])
        total += len(colores) if nivel["unidad"] == "suelto" else unidades[str(nivel["unidad"])]
    return total


def test_reescalar_conserva_unidades_y_colores_y_deja_el_sobrante_suelto() -> None:
    lectura = {
        "referencia_element_id": "REF_01_E01",
        "variante": "base_aire",
        "niveles": [
            {"unidad": "cuarteto", "colores": ["blanco", "blanco", "rosado", "rosado"]},
            {"unidad": "trio", "colores": ["rosado", "blanco", "rosado"]},
        ],
        "remate": {"clase": "metalizado", "color": "dorado"},
        "confianza": 0.9,
    }
    nueva = reescalar_lectura_armado(lectura, 29)
    assert nueva is not None and _globos(nueva) == 29
    niveles = cast(list[dict[str, object]], nueva["niveles"])
    cuartetos = [n for n in niveles if n["unidad"] == "cuarteto"]
    trios = [n for n in niveles if n["unidad"] == "trio"]
    sueltos = [n for n in niveles if n["unidad"] == "suelto"]
    assert all(n["colores"] == ["blanco", "blanco", "rosado", "rosado"] for n in cuartetos)
    assert all(n["colores"] == ["rosado", "blanco", "rosado"] for n in trios)
    # 4:3 → 29 globos: 4 cuartetos (16) y 4 tríos (12); sobra 1, que va suelto.
    assert (len(cuartetos), len(trios)) == (4, 4)
    assert [n["colores"] for n in sueltos] == [["blanco"]]
    # Remate, variante y confianza no cambian.
    assert {k: nueva[k] for k in ("remate", "variante", "confianza")} == {
        k: lectura[k] for k in ("remate", "variante", "confianza")
    }


def test_reescalar_empata_a_favor_del_primer_nivel_y_entiende_cantidad() -> None:
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
    niveles = cast(list[dict[str, object]], nueva["niveles"])
    # 16 → 20: 2,5 cuartetos cada uno; el cuarteto de sobra va a la base.
    assert [n["colores"] for n in niveles].count(["a", "b", "a", "b"]) == 3
    assert [n["colores"] for n in niveles].count(["c", "c", "c", "c"]) == 2
    assert all("cantidad" not in n for n in niveles), "cada copia cuenta como una unidad"
    assert reescalar_lectura_armado({"niveles": []}, 10) is None
    assert reescalar_lectura_armado({"niveles": [{"unidad": "trio", "colores": []}]}, 10) is None


# --- Geométricas: mezcla, escala, elección -------------------------------------------


def test_clases_de_tamano_del_conteo() -> None:
    assert [clase_de_diametro(d) for d in (5, 9, 11, 12, 16, 18, 24, 36)] == [
        "chico",
        "chico",
        "mediano",
        "mediano",
        "grande",
        "grande",
        "grande",
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


def test_una_pista_fuera_de_contrato_se_rechaza() -> None:
    with pytest.raises(ValidationError):
        _peticion_geometrica(
            {"estructuras": [], "plan_version": "1.0"},
            pistas_conteo=[_conteo(por_tamano=[{"clase": "enorme", "proporcion": 1}])],
        )


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
    assert any("equivalentes a la foto (no medidos)" in s for s in _supuestos(resolved))
    # Fuera de ±35 % no hay ajuste: nada cambia.
    lejos = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=200)],
    )
    assert _estructura(lejos)["medidas"] == {"largo_m": 2.5}
    assert _conteos(lejos)[0]["decision"] == "sin_ajuste_posible"


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
    assert [c["estructura_id"] for c in _conteos(resolved)] == ["EST_02_GUIRNALDA"]


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
