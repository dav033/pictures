"""Regresiones de la revisión adversaria de feat/guirnaldas (conteo de la foto, ADR-0031).

Cada prueba lleva el id del hallazgo (scratchpad/revision/hallazgos.json) y
falla contra el código anterior al arreglo.
"""

from __future__ import annotations


from typing import cast

import pytest

from tests.test_conteo_foto import (
    _conteo,
    _conteos,
    _estructura,
    _guirnalda,
    _plan_geometrico,
    _resolver_geometrico,
    _supuestos,
)

MAX_LARGO_SUPUESTO = 240
MAX_SUPUESTOS = 30


def _arco(nombre: str) -> dict[str, object]:
    return {
        **_guirnalda(estructura_id="EST_01_ARCO", nombre=nombre),
        "tipo": "arco",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3, "alto_m": 2.4},
    }


# --- 3 = 9 = 31: el supuesto del conteo cabe en el contrato ------------------------------


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("nombre", "estimado", "por_tamano"),
    [
        # Densidad y las dos medidas con un nombre corriente (antes: invalid_plan 422).
        ("Arco orgánico de entrada principal del salón", 190, []),
        # Mezcla, densidad y medidas con el nombre más corto.
        ("Arco", 70, [{"clase": "mediano", "proporcion": 1.0}]),
        ("Arco", 210, [{"clase": "mediano", "proporcion": 1.0}]),
        # El nombre más largo que admite el contrato.
        ("A" * 160, 190, []),
    ],
)
async def test_31_el_supuesto_del_conteo_no_pasa_de_240_caracteres(
    nombre: str, estimado: int, por_tamano: list[dict[str, object]]
) -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_arco(nombre)),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=estimado, por_tamano=por_tamano)],
    )
    [conteo] = _conteos(resolved)
    assert conteo["decision"] == "ajustado"
    supuestos = _supuestos(resolved)
    assert supuestos and all(len(s) <= MAX_LARGO_SUPUESTO for s in supuestos), supuestos
    # La cifra y el ajuste sobreviven al recorte.
    assert any("la foto muestra" in s and "quedó en" in s for s in supuestos), supuestos


@pytest.mark.anyio
async def test_31_el_conteo_no_pasa_del_tope_de_30_supuestos() -> None:
    plan = _plan_geometrico(_guirnalda())
    plan["supuestos"] = [f"supuesto previo {n}" for n in range(MAX_SUPUESTOS)]
    resolved = await _resolver_geometrico(
        plan, completar_conteos=True, pistas_conteo=[_conteo(estimado_total=60)]
    )
    assert _estructura(resolved)["densidad"] == "lujosa"
    assert len(_supuestos(resolved)) == MAX_SUPUESTOS
    # El detalle sigue en conteos_referencia, fuera del hash.
    assert _conteos(resolved)[0]["decision"] == "ajustado"


def test_31_el_aviso_de_patron_degradado_de_la_guirnalda_cabe() -> None:
    from app.supuestos import agregar_supuesto, supuesto

    texto = supuesto(
        "G" * 160,
        "el patrón por racimos no cabe en lo que se compra; queda el patrón sugerido y el"
        " armado de sus racimos.",
    )
    assert len(texto) <= MAX_LARGO_SUPUESTO and texto.endswith("racimos.")
    lista = [f"s{n}" for n in range(MAX_SUPUESTOS)]
    assert agregar_supuesto(lista, texto) is False and len(lista) == MAX_SUPUESTOS


# --- 10: racimos × globos por racimo no pasa del tope del contrato --------------------


@pytest.mark.anyio
async def test_10_racimos_por_encima_del_tope_no_rompen_la_confirmacion() -> None:
    from app.conteo_foto import cuenta_usable

    enorme = _conteo(racimos=1600, globos_por_racimo=8)
    assert cuenta_usable(enorme) is None, "12800 pasa del tope de 10000 globos del contrato"
    resolved = await _resolver_geometrico(
        _plan_geometrico(_guirnalda()), completar_conteos=True, pistas_conteo=[enorme]
    )
    [conteo] = _conteos(resolved)
    assert (conteo["decision"], conteo["globos_foto"]) == ("no_confiable", None)


def test_10_la_lectura_descarta_racimos_incoherentes_con_el_tope() -> None:
    from app.amaterasu.conteo_referencia import validar_lecturas

    [lectura] = validar_lecturas(
        {
            "lecturas": [
                {
                    "element_id": "E1",
                    "globos_visibles": 900,
                    "exacto": False,
                    "estimado_total": 12000,
                    "racimos": 1600,
                    "globos_por_racimo": 8,
                    "por_tamano": [],
                    "confianza": 0.8,
                }
            ]
        },
        ["E1"],
    ) or [{}]
    assert (lectura["estimado_total"], lectura["racimos"], lectura["globos_por_racimo"]) == (
        None,
        None,
        None,
    )


# --- 34: tras editar la mezcla no queda el supuesto viejo del conteo ---------------------


@pytest.mark.anyio
async def test_34_editar_la_mezcla_reemplaza_el_supuesto_del_conteo() -> None:
    import copy

    from app.plan_edicion import EdicionMezcla, editar_plan
    from tests.guirnalda_datos import GUIRNALDA, estructura_del_plan, guirnalda, plan, resolver

    base = plan(guirnalda(referencia_element_id="REF_01_E01", nombre="Guirnalda del fondo"))
    base["espacio"] = {"tipo": "salon", "fuente": "supuesto"}
    base["supuestos"] = ["un supuesto del modelo que no es del conteo"]
    pistas = [_conteo(estimado_total=50, por_tamano=[{"clase": "mediano", "proporcion": 1.0}])]
    primera = await resolver(base, completar_conteos=True, pistas_conteo=pistas)
    assert estructura_del_plan(primera)["mezcla"] == "clasica"
    editado = editar_plan(
        cast(dict[str, object], primera["plan"]),
        EdicionMezcla.model_validate(
            {"accion": "mezcla", "estructura_id": GUIRNALDA, "mezcla": "organica_gruesa"}
        ),
    )
    segunda = await resolver(
        copy.deepcopy(editado.plan),
        completar_conteos=True,
        pistas_conteo=pistas,
        completar_conteos_de=[GUIRNALDA],
    )
    assert estructura_del_plan(segunda)["mezcla"] == "organica_gruesa"
    supuestos = cast(list[str], cast(dict[str, object], segunda["plan"])["supuestos"])
    del_conteo = [s for s in supuestos if s.startswith("Guirnalda del fondo: la foto muestra")]
    # Uno solo, el de la re-resolución: el de la confirmación nombraba la mezcla clásica.
    assert len(del_conteo) == 1 and "clásica" not in del_conteo[0], supuestos
    assert "un supuesto del modelo que no es del conteo" in supuestos


# --- 2: el conteo respeta las densidades de cada estructura oficial ------------------------


def _oficial(oficial: str, densidad: str) -> dict[str, object]:
    from tests.guirnalda_datos import arco

    comun = {
        "estructura_oficial": oficial,
        "densidad": densidad,
        "referencia_element_id": "REF_01_E02",
    }
    if oficial.startswith("pared"):
        return arco(
            **comun,
            tipo="pared",
            estructura_id="EST_02_PARED",
            nombre="Pared",
            ubicacion="fondo_pared",
            medidas={"ancho_m": 2.4, "alto_m": 2.4},
        )
    if oficial.startswith("columna"):
        return arco(
            **comun,
            tipo="columna",
            estructura_id="EST_02_COLUMNA",
            nombre="Columna",
            ubicacion="entrada",
            medidas={"alto_m": 2.0},
        )
    return arco(**comun)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("oficial", "densidad", "factor", "fuente", "admitidas"),
    [
        ("arco_no_denso", "sencilla", 1.4, "cliente", {"sencilla"}),
        ("arco_no_denso", "sencilla", 1.4, "supuesto", {"sencilla"}),
        ("columna_no_densa", "sencilla", 1.4, "cliente", {"sencilla"}),
        ("pared_no_densa", "sencilla", 1.5, "cliente", {"sencilla"}),
        ("pared_densa", "media", 0.55, "cliente", {"media", "lujosa"}),
    ],
)
async def test_2_el_conteo_no_elige_una_densidad_que_la_estructura_oficial_no_admite(
    oficial: str, densidad: str, factor: float, fuente: str, admitidas: set[str]
) -> None:
    from tests.guirnalda_datos import estructura_del_plan, lineas, plan, resolver

    base_plan = plan(_oficial(oficial, densidad))
    base_plan["espacio"] = {"tipo": "salon", "fuente": fuente}
    base = await resolver(base_plan)
    antes = sum(cast(int, linea["unidades"]) for linea in lineas(base))
    pista = {**_conteo(estimado_total=round(antes * factor)), "referencia_element_id": "REF_01_E02"}
    resolved = await resolver(base_plan, completar_conteos=True, pistas_conteo=[pista])
    assert estructura_del_plan(resolved)["densidad"] in admitidas
    [conteo] = _conteos(resolved)
    assert conteo["decision"] in ("ajustado", "sin_ajuste_posible")
