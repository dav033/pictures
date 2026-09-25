"""Edición del plan en Python (ADR-0028 §9).

Dos bloques. El primero porta, caso por caso, lo que hacía `aplicarEdicion` en
`src/lib/plan/aplicar-edicion.ts` (agregar, reemplazar, quitar, repartir,
mezcla), con su redondeo: cada participación a seis decimales como
`Number(x.toFixed(6))` y la última cerrando hasta 1. El segundo cubre las
reglas de patrón del §9.

Expectativas a mano. La columna de referencia es la de `test_plan_patron.py`:
clásica (solo R-12), media, 1.8 m, T = 39 globos, en cuartetos round(39 / 4) =
10 filas y 40 globos. La espiral [0, 1, 0, 2] da 20/10/10 → 0.5, 0.25, 0.25.
"""

from __future__ import annotations

import copy
import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from typing import cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

import app.plan_edicion as plan_edicion
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError, patron_resuelto_de_estructura
from app.plan_edicion import (
    AVISO_PATRON_AGREGAR,
    AVISO_PATRON_QUITAR,
    AVISO_PATRON_SIN_PRESET,
    AVISO_PATRON_SUGERIDO,
    AVISO_PATRON_UN_COLOR,
    Edicion,
    LineasBaseEstructura,
    PlanEditado,
    color_de_edicion,
    editar_plan,
    normalizar_participaciones,
)

SECRET = "e" * 32
COLUMNA = "EST_01_COLUMNA"
ARCO = "EST_02_ARCO"
KIT = "EST_03_KIT"
PARED = "EST_04_PARED"
ESPIRAL = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
}
_EDICION = TypeAdapter(Edicion)


def _material(color: str, parte: float, indice: int = 1, **extra: object) -> dict[str, object]:
    return {
        "product_id": f"prod-{color}",
        "variant_id": f"var-{color}-12",
        "color": color,
        "participacion": parte,
        "rol_material": "principal" if indice == 0 else "secundario",
        **extra,
    }


def _materiales(colores: Sequence[str], partes: Sequence[float]) -> list[dict[str, object]]:
    return [
        _material(color, parte, indice)
        for indice, (color, parte) in enumerate(zip(colores, partes, strict=True))
    ]


def _columna(
    colores: Sequence[str] = ("blanco", "negro", "azul"),
    partes: Sequence[float] = (0.5, 0.3, 0.2),
    **extra: object,
) -> dict[str, object]:
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "rol_escena": "focal",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 1.8},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": _materiales(colores, partes),
        "porque": "Columna de prueba.",
        **extra,
    }


def _arco(
    colores: Sequence[str] = ("rojo",), partes: Sequence[float] = (1,), **extra: object
) -> dict[str, object]:
    return {
        "estructura_id": ARCO,
        "nombre": "Arco",
        "tipo": "arco",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3, "alto_m": 2.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": _materiales(colores, partes),
        "porque": "Arco de prueba.",
        **extra,
    }


def _kit() -> dict[str, object]:
    return {
        "estructura_id": KIT,
        "nombre": "Kit de mesa",
        "tipo": "kit",
        "rol_escena": "acento",
        "ubicacion": "sobre_mesa_principal",
        "medidas": {},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": "prod-globo",
                "variant_id": "var-globo-rosado",
                "color": "rosado",
                "acabado": "perlado",
                "participacion": 0.6,
                "rol_material": "principal",
            },
            {
                "product_id": "prod-cinta",
                "variant_id": "var-cinta-dorada",
                "color": "dorado",
                "participacion": 0.4,
                "rol_material": "acento",
            },
        ],
        "unidades_declaradas": 12,
        "porque": "Kit de prueba.",
    }


def _plan(*estructuras: dict[str, object]) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "28282828-2828-4282-8282-282828282828",
        "concepto": {"titulo": "Prueba", "descripcion": "Edición.", "paleta": ["blanco"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": list(estructuras),
        "supuestos": [],
        "referencia_omitida": [],
    }


def _lineas(
    estructura_id: str, *lineas: tuple[str, str, str | None]
) -> list[LineasBaseEstructura]:
    return [
        LineasBaseEstructura.model_validate(
            {
                "estructura_id": estructura_id,
                "lineas": [
                    {"product_id": producto, "variant_id": variante, "color": color}
                    for producto, variante, color in lineas
                ],
            }
        )
    ]


def _linea(color: str) -> tuple[str, str, str]:
    return (f"prod-{color}", f"var-{color}-12", color)


def _editar(
    plan: Mapping[str, object],
    edicion: Mapping[str, object],
    lineas: Sequence[LineasBaseEstructura] = (),
    colores: Sequence[str] = (),
    *,
    completar_patrones: bool = False,
) -> PlanEditado:
    return editar_plan(
        plan,
        _EDICION.validate_python(edicion),
        lineas,
        colores,
        completar_patrones=completar_patrones,
    )


def _estructura(plan: Mapping[str, object], estructura_id: str) -> dict[str, object]:
    return next(
        estructura
        for estructura in cast(list[dict[str, object]], plan["estructuras"])
        if estructura["estructura_id"] == estructura_id
    )


def _partes(plan: Mapping[str, object], estructura_id: str) -> list[float]:
    materiales = cast(list[dict[str, object]], _estructura(plan, estructura_id)["materiales"])
    return [cast(float, material["participacion"]) for material in materiales]


def _rechazo(
    plan: Mapping[str, object],
    edicion: Mapping[str, object],
    lineas: Sequence[LineasBaseEstructura] = (),
) -> tuple[str, int, dict[str, object] | None]:
    with pytest.raises(PlanResolutionError) as raised:
        _editar(plan, edicion, lineas)
    return raised.value.code, raised.value.status_code, raised.value.details


def _con_patron(
    estructura: dict[str, object], patron: Mapping[str, object], partes: Sequence[float]
) -> dict[str, object]:
    """La estructura como sale de una resolución: con patrón y participacion ya sincronizada."""
    materiales = cast(list[dict[str, object]], estructura["materiales"])
    return {
        **estructura,
        "patron_color": copy.deepcopy(dict(patron)),
        "materiales": [
            {**material, "participacion": parte}
            for material, parte in zip(materiales, partes, strict=True)
        ],
    }


# --- Participaciones ---------------------------------------------------------------


def test_normalizar_redondea_a_seis_decimales_y_el_ultimo_cierra() -> None:
    # 0.3 / 0.8999999999999999 = 0.33333333333333337 → 0.333333 (dos veces) y el
    # último 1 - 0.666666 = 0.333334.
    tercios = normalizar_participaciones([{"participacion": 0.3}] * 3)
    mitades = normalizar_participaciones([{"participacion": 0.6}] * 2)

    assert [m["participacion"] for m in tercios] == [0.333333, 0.333333, 0.333334]
    assert [m["participacion"] for m in mitades] == [0.5, 0.5]


def test_normalizar_redondea_las_mitades_hacia_arriba_como_to_fixed() -> None:
    # 0.0078125 es exacto en binario: toFixed(6) da 0.007813 (round() de Python
    # daría 0.007812, al par). El último cierra: 1 - 0.007813 = 0.992187.
    partes = normalizar_participaciones([{"participacion": 0.0078125}, {"participacion": 0.9921875}])

    assert [m["participacion"] for m in partes] == [0.007813, 0.992187]


def test_el_ultimo_nunca_baja_de_una_millonesima() -> None:
    # 1 / 1.000000001 redondea a 1.0 y al último le queda 0: se queda en 0.000001.
    partes = normalizar_participaciones([{"participacion": 1.0}, {"participacion": 1e-9}])

    assert [m["participacion"] for m in partes] == [1.0, 0.000001]


def test_normalizar_sin_participacion_es_un_error_400() -> None:
    with pytest.raises(PlanResolutionError) as raised:
        normalizar_participaciones([{"participacion": 0.0}, {"participacion": 0.0}])

    assert (raised.value.code, raised.value.status_code) == ("sin_participacion", 400)


# --- repartir y mezcla -------------------------------------------------------------


def test_repartir_solo_cambia_las_participaciones() -> None:
    plan = _plan(_columna(), _arco())

    resultado = _editar(
        plan, {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.3, 0.3, 0.3]}
    )

    antes = _estructura(plan, COLUMNA)
    despues = _estructura(resultado.plan, COLUMNA)
    assert _partes(resultado.plan, COLUMNA) == [0.333333, 0.333333, 0.333334]
    assert {**despues, "materiales": antes["materiales"]} == antes
    assert _estructura(resultado.plan, ARCO) == _arco()
    assert resultado.avisos == ()


def test_repartir_con_otra_cantidad_de_colores_no_corresponde() -> None:
    # La tarjeta armó el deslizador con otra versión del plan: una pieza, un color.
    assert _rechazo(
        _plan(_arco()), {"accion": "repartir", "estructura_id": ARCO, "participaciones": [0.5, 0.5]}
    )[:2] == ("reparto_no_corresponde", 409)


@pytest.mark.parametrize(
    "participaciones",
    [[0.97, 0.03], [0.5], [1.0, 0.5], [0.2] * 7, ["0.5", "0.5"]],
)
def test_repartir_valida_cada_participacion_en_la_frontera(participaciones: list[object]) -> None:
    # Debajo del 5 % quitar el color es lo honesto; nunca coerción de texto.
    with pytest.raises(ValidationError):
        _EDICION.validate_python(
            {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": participaciones}
        )


def test_mezcla_solo_cambia_la_mezcla_de_la_pieza() -> None:
    plan = _plan(_arco(), _columna())

    resultado = _editar(plan, {"accion": "mezcla", "estructura_id": ARCO, "mezcla": "solo_grandes"})

    assert _estructura(resultado.plan, ARCO) == {**_arco(), "mezcla": "solo_grandes"}
    assert _estructura(resultado.plan, COLUMNA) == _columna()


@pytest.mark.parametrize(
    "edicion",
    [
        {"accion": "repartir", "estructura_id": "EST_09_OTRA", "participaciones": [0.5, 0.5]},
        {"accion": "mezcla", "estructura_id": "EST_09_OTRA", "mezcla": "clasica"},
        {"accion": "quitar", "estructura_id": "EST_09_OTRA", "objetivo_variant_id": "var-rojo-12"},
        {"accion": "patron", "estructura_id": "EST_09_OTRA", "patron_color": None},
        {
            "accion": "agregar",
            "estructura_id": "EST_09_OTRA",
            "variante": {"product_id": "prod-azul", "variant_id": "var-azul-12"},
        },
    ],
)
def test_una_estructura_que_no_existe_es_404(edicion: dict[str, object]) -> None:
    assert _rechazo(_plan(_arco()), edicion)[:2] == ("estructura_no_encontrada", 404)


# --- agregar -----------------------------------------------------------------------


def test_agregar_con_la_participacion_por_defecto() -> None:
    # 1 → normalizada 1 × 0.8 = 0.8 y el color nuevo 0.2 (1 - 0.8 redondea a 0.2).
    resultado = _editar(
        _plan(_arco()),
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "variante": {"product_id": "prod-azul", "variant_id": "var-azul-12"},
        },
        colores=["azul"],
    )

    assert _estructura(resultado.plan, ARCO)["materiales"] == [
        {**_material("rojo", 0.8, 0)},
        {
            "product_id": "prod-azul",
            "variant_id": "var-azul-12",
            "color": "azul",
            "participacion": 0.2,
            "rol_material": "acento",
        },
    ]


def test_agregar_escala_los_demas_y_redondea() -> None:
    # 0.5, 0.3, 0.2 × 0.75 = 0.375, 0.22499999999999998, 0.15000000000000002 y
    # 0.25: redondeados 0.375, 0.225, 0.15 y el último 1 - 0.75 = 0.25.
    resultado = _editar(
        _plan(_columna()),
        {
            "accion": "agregar",
            "estructura_id": COLUMNA,
            "participacion": 0.25,
            "variante": {
                "product_id": "prod-rojo",
                "variant_id": "var-rojo-12",
                "color": "rojo",
                "acabado": "mate",
            },
        },
        colores=["rojo"],
    )

    materiales = cast(list[dict[str, object]], _estructura(resultado.plan, COLUMNA)["materiales"])
    assert [m["participacion"] for m in materiales] == [0.375, 0.225, 0.15, 0.25]
    assert materiales[-1] == {
        "product_id": "prod-rojo",
        "variant_id": "var-rojo-12",
        "color": "rojo",
        "acabado": "mate",
        "participacion": 0.25,
        "rol_material": "acento",
    }


def test_agregar_una_variante_de_varios_colores_conserva_lo_pedido_sin_canonizar() -> None:
    # Antes "azul rey" se canonizaba aquí; ahora lo canoniza Next al resolver.
    resultado = _editar(
        _plan(_arco()),
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "participacion": 0.2,
            "variante": {"product_id": "prod-azul", "variant_id": "var-azul-12", "color": "azul rey"},
        },
        colores=["azul", "turquesa"],
    )

    materiales = cast(list[dict[str, object]], _estructura(resultado.plan, ARCO)["materiales"])
    assert materiales[-1]["color"] == "azul rey"


@pytest.mark.parametrize(
    ("pedido", "colores", "esperado"),
    [
        ("rosado", ["azul"], "azul"),  # nunca el color de la tarjeta si la variante es de otro
        ("azul rey", ["azul"], "azul"),  # texto libre: gana el único color real
        ("Azul", ["azul"], "Azul"),  # el mismo color: se conserva lo pedido
        ("  Azúl ", ["azul"], "Azúl"),  # recortado, y sin tildes para comparar
        (None, ["azul"], "azul"),
        ("azul rey", ["azul", "turquesa"], "azul rey"),
        (None, ["azul", "turquesa"], None),
        ("   ", [], None),
    ],
)
def test_color_de_edicion(pedido: str | None, colores: list[str], esperado: str | None) -> None:
    assert color_de_edicion(pedido, colores) == esperado


def test_un_septimo_color_deja_el_plan_fuera_del_contrato() -> None:
    colores = ("blanco", "negro", "azul", "rojo", "verde", "dorado")
    plan = _plan(_arco(colores, [1 / 6] * 6))

    assert _rechazo(
        plan,
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "variante": {"product_id": "prod-lila", "variant_id": "var-lila-12"},
        },
    )[:2] == ("invalid_plan", 422)


def test_un_plan_que_no_cumple_el_contrato_es_invalid_plan() -> None:
    assert _rechazo(
        {**_plan(_arco()), "estructuras": []},
        {"accion": "mezcla", "estructura_id": ARCO, "mezcla": "clasica"},
    )[:2] == ("invalid_plan", 422)


# --- reemplazar ----------------------------------------------------------------------


def _reemplazo(estructura_id: str, objetivo: str, variante: Mapping[str, object]) -> dict[str, object]:
    return {
        "accion": "reemplazar",
        "estructura_id": estructura_id,
        "objetivo_variant_id": objetivo,
        "variante": dict(variante),
    }


def test_reemplazar_en_una_pieza_geometrica_va_a_variant_overrides() -> None:
    resultado = _editar(
        _plan(_arco()),
        _reemplazo(ARCO, "var-rojo-12", {"product_id": "prod-azul", "variant_id": "var-azul-12"}),
        _lineas(ARCO, _linea("rojo")),
        ["azul"],
    )

    estructura = _estructura(resultado.plan, ARCO)
    assert estructura["variant_overrides"] == [
        {
            "objetivo_variant_id": "var-rojo-12",
            "product_id": "prod-azul",
            "variant_id": "var-azul-12",
            "color": "azul",
        }
    ]
    assert estructura["materiales"] == _arco()["materiales"]


def test_reemplazar_otra_vez_encadena_al_objetivo_original() -> None:
    # La línea visible ya es la azul de un reemplazo anterior; su material no está
    # en `materiales` y no hace falta: la cadena vuelve a la variante original.
    previos = [
        {"objetivo_variant_id": "var-rojo-12", "product_id": "prod-azul", "variant_id": "var-azul-12", "color": "azul"},
        {"objetivo_variant_id": "var-blanco-12", "product_id": "prod-crema", "variant_id": "var-crema-12"},
    ]
    plan = _plan(_arco(("rojo", "blanco"), (0.5, 0.5), variant_overrides=previos))

    resultado = _editar(
        plan,
        _reemplazo(ARCO, "var-azul-12", {"product_id": "prod-verde", "variant_id": "var-verde-12"}),
        _lineas(ARCO, _linea("azul"), _linea("crema")),
        ["verde", "menta"],
    )

    assert _estructura(resultado.plan, ARCO)["variant_overrides"] == [
        {"objetivo_variant_id": "var-blanco-12", "product_id": "prod-crema", "variant_id": "var-crema-12"},
        {"objetivo_variant_id": "var-rojo-12", "product_id": "prod-verde", "variant_id": "var-verde-12"},
    ]


def test_reemplazar_la_misma_linea_original_sustituye_su_override() -> None:
    previos = [
        {"objetivo_variant_id": "var-rojo-12", "product_id": "prod-azul", "variant_id": "var-azul-12"},
    ]
    plan = _plan(_arco(variant_overrides=previos))

    resultado = _editar(
        plan,
        _reemplazo(ARCO, "var-rojo-12", {"product_id": "prod-verde", "variant_id": "var-verde-12", "color": "verde"}),
        _lineas(ARCO, _linea("rojo")),
        [],
    )

    assert _estructura(resultado.plan, ARCO)["variant_overrides"] == [
        {"objetivo_variant_id": "var-rojo-12", "product_id": "prod-verde", "variant_id": "var-verde-12", "color": "verde"},
    ]


@pytest.mark.parametrize(
    "lineas",
    [
        _lineas(ARCO, _linea("blanco")),  # la variante objetivo no está entre las líneas
        _lineas(COLUMNA, _linea("rojo")),  # las líneas son de otra pieza
        [],
    ],
)
def test_una_variante_objetivo_que_no_esta_en_la_pieza_es_404(
    lineas: list[LineasBaseEstructura],
) -> None:
    edicion = _reemplazo(ARCO, "var-rojo-12", {"product_id": "prod-azul", "variant_id": "var-azul-12"})

    assert _rechazo(_plan(_arco()), edicion, lineas)[:2] == ("variante_objetivo_no_encontrada", 404)


def test_reemplazar_en_una_pieza_sin_geometria_cambia_el_material() -> None:
    resultado = _editar(
        _plan(_kit()),
        _reemplazo(KIT, "var-globo-rosado", {"product_id": "prod-globo", "variant_id": "var-globo-azul", "color": "azul"}),
        _lineas(KIT, ("prod-globo", "var-globo-rosado", "rosado")),
        ["azul"],
    )

    materiales = cast(list[dict[str, object]], _estructura(resultado.plan, KIT)["materiales"])
    # Conserva participación, rol y acabado; cambia producto, variante y color.
    assert materiales[0] == {
        "product_id": "prod-globo",
        "variant_id": "var-globo-azul",
        "color": "azul",
        "acabado": "perlado",
        "participacion": 0.6,
        "rol_material": "principal",
    }
    assert materiales[1] == _kit()["materiales"][1]  # type: ignore[index]


def test_reemplazar_sin_color_nuevo_conserva_el_anterior_y_el_acabado_pedido_gana() -> None:
    # Por producto y color normalizado: la línea trae otra variante y "ROSÁDO ".
    resultado = _editar(
        _plan(_kit()),
        _reemplazo(KIT, "var-otra", {"product_id": "prod-globo", "variant_id": "var-globo-mix", "acabado": "mate"}),
        _lineas(KIT, ("prod-globo", "var-otra", "ROSÁDO ")),
        ["rosado", "lila"],
    )

    materiales = cast(list[dict[str, object]], _estructura(resultado.plan, KIT)["materiales"])
    assert (materiales[0]["variant_id"], materiales[0]["color"], materiales[0]["acabado"]) == (
        "var-globo-mix",
        "rosado",
        "mate",
    )


def test_una_linea_que_no_sale_de_ningun_material_no_es_editable() -> None:
    edicion = _reemplazo(KIT, "var-ajena", {"product_id": "prod-globo", "variant_id": "var-globo-azul"})

    assert _rechazo(_plan(_kit()), edicion, _lineas(KIT, ("prod-otro", "var-ajena", "rosado")))[
        :2
    ] == ("material_no_editable", 409)


# --- quitar --------------------------------------------------------------------------


def _quitar(estructura_id: str, objetivo: str) -> dict[str, object]:
    return {"accion": "quitar", "estructura_id": estructura_id, "objetivo_variant_id": objetivo}


def test_quitar_renormaliza_los_que_quedan() -> None:
    # Quedan 0.5 y 0.2: 0.5 / 0.7 = 0.7142857142857143 → 0.714286 y 1 - 0.714286 → 0.285714.
    resultado = _editar(
        _plan(_columna()), _quitar(COLUMNA, "var-negro-12"), _lineas(COLUMNA, _linea("negro"))
    )

    materiales = cast(list[dict[str, object]], _estructura(resultado.plan, COLUMNA)["materiales"])
    assert [(m["color"], m["participacion"]) for m in materiales] == [
        ("blanco", 0.714286),
        ("azul", 0.285714),
    ]


def test_quitar_en_una_pieza_geometrica_toca_materiales_y_no_los_overrides() -> None:
    override = {"objetivo_variant_id": "var-rojo-12", "product_id": "prod-azul", "variant_id": "var-azul-12"}
    plan = _plan(_arco(("rojo", "blanco"), (0.7, 0.3), variant_overrides=[override]))

    resultado = _editar(plan, _quitar(ARCO, "var-blanco-12"), _lineas(ARCO, _linea("blanco")))

    estructura = _estructura(resultado.plan, ARCO)
    assert _partes(resultado.plan, ARCO) == [1.0]
    assert estructura["variant_overrides"] == [override]


def test_no_se_quita_el_unico_material() -> None:
    assert _rechazo(_plan(_arco()), _quitar(ARCO, "var-rojo-12"), _lineas(ARCO, _linea("rojo")))[
        :2
    ] == ("unico_material", 400)


@pytest.mark.parametrize(
    "edicion",
    [
        {"accion": "quitar", "estructura_id": ARCO},
        {"accion": "reemplazar", "estructura_id": ARCO, "objetivo_variant_id": "var-rojo-12"},
        {"accion": "agregar", "estructura_id": ARCO},
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "participacion": 0.9,
            "variante": {"product_id": "p", "variant_id": "v"},
        },
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "participacion": "0.2",
            "variante": {"product_id": "p", "variant_id": "v"},
        },
        {"accion": "quitar", "estructura_id": ARCO, "objetivo_variant_id": "v", "extra": 1},
        {"accion": "teñir", "estructura_id": ARCO},
        {"accion": "patron", "estructura_id": ARCO},
    ],
)
def test_la_edicion_se_valida_en_la_frontera(edicion: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        _EDICION.validate_python(edicion)


# --- patron ----------------------------------------------------------------------------


def test_fijar_un_patron_sincroniza_la_participacion() -> None:
    plan = _plan(_columna(partes=(0.4, 0.3, 0.3)), _arco())

    resultado = _editar(plan, {"accion": "patron", "estructura_id": COLUMNA, "patron_color": ESPIRAL})

    assert _estructura(resultado.plan, COLUMNA)["patron_color"] == ESPIRAL
    assert _partes(resultado.plan, COLUMNA) == [0.5, 0.25, 0.25]
    assert _estructura(resultado.plan, ARCO) == _arco()
    assert resultado.avisos == ()


def test_quitar_el_patron_conserva_las_participaciones() -> None:
    plan = _plan(_con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25)))

    resultado = _editar(plan, {"accion": "patron", "estructura_id": COLUMNA, "patron_color": None})

    assert "patron_color" not in _estructura(resultado.plan, COLUMNA)
    assert _partes(resultado.plan, COLUMNA) == [0.5, 0.25, 0.25]


def test_quitar_un_patron_que_no_hay_no_cambia_nada() -> None:
    plan = _plan(_columna())

    resultado = _editar(plan, {"accion": "patron", "estructura_id": COLUMNA, "patron_color": None})

    assert resultado.plan == plan


def test_un_patron_que_deja_un_color_sin_uso_es_patron_invalido() -> None:
    sin_azul = {**ESPIRAL, "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"}}

    code, status, details = _rechazo(
        _plan(_columna()), {"accion": "patron", "estructura_id": COLUMNA, "patron_color": sin_azul}
    )

    assert (code, status) == ("patron_invalido", 422)
    assert details is not None
    assert (details["estructura_id"], details["motivo"]) == (COLUMNA, "material_sin_uso")
    assert "azul (3)" in str(details["mensaje"])


def test_un_patron_fuera_del_contrato_es_invalid_plan() -> None:
    vacio = {**ESPIRAL, "base": {"modo": "espiral", "racimo": [], "trazo": "espiral"}}

    assert _rechazo(
        _plan(_columna()), {"accion": "patron", "estructura_id": COLUMNA, "patron_color": vacio}
    )[:2] == ("invalid_plan", 422)


def test_una_pieza_sin_geometria_no_lleva_patron() -> None:
    patron = {**ESPIRAL, "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"}}

    code, status, details = _rechazo(
        _plan(_kit()), {"accion": "patron", "estructura_id": KIT, "patron_color": patron}
    )

    assert (code, status) == ("patron_invalido", 422)
    assert details is not None and details["motivo"] == "tipo_sin_patron"


# --- repartir con patrón ----------------------------------------------------------------


def test_repartir_una_pieza_con_patron_que_no_es_confeti_es_patron_activo() -> None:
    plan = _plan(_con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25)))

    assert _rechazo(
        plan, {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.4, 0.3, 0.3]}
    )[:2] == ("patron_activo", 409)


def test_repartir_un_confeti_reescribe_los_pesos_y_conserva_la_semilla() -> None:
    confeti = {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {
            "modo": "aleatorio",
            "pesos": [{"material": 0, "peso": 40}, {"material": 1, "peso": 30}, {"material": 2, "peso": 30}],
            "semilla": 12345,
        },
    }
    plan = _plan(_con_patron(_columna(), confeti, (0.4, 0.3, 0.3)))

    resultado = _editar(
        plan, {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.6, 0.25, 0.15]}
    )

    # Pesos 60/25/15 sobre 40 celdas: 24, 10 y 6 globos → 0.6, 0.25, 0.15.
    assert _estructura(resultado.plan, COLUMNA)["patron_color"] == {
        **confeti,
        "base": {
            "modo": "aleatorio",
            "pesos": [{"material": 0, "peso": 60}, {"material": 1, "peso": 25}, {"material": 2, "peso": 15}],
            "semilla": 12345,
        },
    }
    assert _partes(resultado.plan, COLUMNA) == [0.6, 0.25, 0.15]


def _confeti(
    pesos: Sequence[tuple[int, int]], semilla: int = 7, **capas: object
) -> dict[str, object]:
    return {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {
            "modo": "aleatorio",
            "pesos": [{"material": material, "peso": peso} for material, peso in pesos],
            "semilla": semilla,
        },
        **capas,
    }


@pytest.mark.parametrize(
    "capas",
    [
        # El azul en filas enteras alternas: 20 de los 40 globos, pida lo que pida el reparto.
        {"acentos": [{"material": 2, "cada": 2, "desde": 1}]},
        {"pintados": [{"fila": 0, "material": 2}, {"fila": 9, "columna": 3, "material": 1}]},
    ],
)
def test_repartir_un_confeti_con_acentos_o_pintados_los_integra_y_avisa(
    capas: dict[str, object],
) -> None:
    # Con capas encima los pesos no son el reparto (el acento fija un mínimo de
    # azul): el deslizador dice "así se reparte este confeti", así que las capas
    # se integran al confeti y el reparto sale tal cual se pidió.
    confeti = _confeti([(2, 10), (0, 50), (1, 40)], **capas)
    plan = _plan(_con_patron(_columna(), confeti, (0.275, 0.175, 0.55)))

    resultado = _editar(
        plan, {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.4, 0.3, 0.3]}
    )

    patron = cast(dict[str, object], _estructura(resultado.plan, COLUMNA)["patron_color"])
    assert "acentos" not in patron and "pintados" not in patron
    assert patron["base"] == {
        "modo": "aleatorio",
        "pesos": [{"material": 0, "peso": 40}, {"material": 1, "peso": 30}, {"material": 2, "peso": 30}],
        "semilla": 7,
    }
    # 40 celdas de un solo tamaño por 40/30/30: 16, 12 y 12 globos, justo lo pedido.
    assert _partes(resultado.plan, COLUMNA) == [0.4, 0.3, 0.3]
    assert resultado.avisos == (
        "Los acentos y los globos pintados a mano se integraron al confeti para respetar"
        " el reparto que elegiste.",
    )


# --- agregar con patrón -------------------------------------------------------------------


def _agregar(estructura_id: str, color: str, participacion: float | None = None) -> dict[str, object]:
    return {
        "accion": "agregar",
        "estructura_id": estructura_id,
        "variante": {"product_id": f"prod-{color}", "variant_id": f"var-{color}-12"},
        **({} if participacion is None else {"participacion": participacion}),
    }


def test_agregar_a_una_espiral_entra_como_acento() -> None:
    plan = _plan(_con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo"), colores=["rojo"])

    # El rojo toma la posición 0 de las filas 2, 4, 6, 8 y 10 (cinco racimos):
    # blanco 20 - 5 = 15, negro 10, azul 10, rojo 5 de 40.
    assert _estructura(resultado.plan, COLUMNA)["patron_color"] == {
        **ESPIRAL,
        "acentos": [{"material": 3, "cada": 2, "desde": 2, "posiciones": [0]}],
    }
    assert _partes(resultado.plan, COLUMNA) == [0.375, 0.25, 0.25, 0.125]
    assert resultado.avisos == ()


def test_agregar_a_un_confeti_suma_su_peso() -> None:
    confeti = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {
            "modo": "aleatorio",
            "pesos": [{"material": 0, "peso": 50}, {"material": 1, "peso": 30}, {"material": 2, "peso": 20}],
            "semilla": 7,
        },
    }
    plan = _plan(_con_patron(_columna(), confeti, (0.5, 0.3, 0.2)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo"), colores=["rojo"])

    # Los pesos 50/30/20 se escalan a 80 (40/24/16) y el rojo entra con 20.
    # Sobre 40 celdas: 16, 9.6, 6.4, 8 → 16, 9, 6, 8 y el globo que falta al
    # mayor resto (9.6): 16/10/6/8 → 0.4, 0.25, 0.15, 0.2.
    base = cast(dict[str, object], cast(dict[str, object], _estructura(resultado.plan, COLUMNA)["patron_color"])["base"])
    assert base == {
        "modo": "aleatorio",
        "pesos": [
            {"material": 0, "peso": 40},
            {"material": 1, "peso": 24},
            {"material": 2, "peso": 16},
            {"material": 3, "peso": 20},
        ],
        "semilla": 7,
    }
    assert _partes(resultado.plan, COLUMNA) == [0.4, 0.25, 0.15, 0.2]


def test_agregar_a_un_confeti_conserva_la_proporcion_de_sus_pesos() -> None:
    # Pesos 1/1/1 (40 celdas: 14/13/13 → 0.35, 0.325, 0.325). Salen de los
    # pesos, no de esas participaciones: 1/3 × 75 = 25 cada uno y el rojo 25,
    # así que los tres siguen iguales. Sobre 40 celdas, 10 de cada color.
    plan = _plan(_con_patron(_columna(), _confeti([(0, 1), (1, 1), (2, 1)]), (0.35, 0.325, 0.325)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo", 0.25), colores=["rojo"])

    patron = cast(dict[str, object], _estructura(resultado.plan, COLUMNA)["patron_color"])
    assert patron["base"] == {
        "modo": "aleatorio",
        "pesos": [{"material": material, "peso": 25} for material in range(4)],
        "semilla": 7,
    }
    assert _partes(resultado.plan, COLUMNA) == [0.25, 0.25, 0.25, 0.25]


def test_agregar_a_un_confeti_con_acento_no_cuenta_dos_veces_el_acento() -> None:
    # Filas 1, 3, 5, 7 y 9 enteras de azul (20 de 40 globos) sobre un confeti
    # 10/50/40. Su participación sincronizada (0.275, 0.175, 0.55) ya cuenta ese
    # acento; sacar los pesos de ella lo aplicaba dos veces (pesos 44/22/14/20,
    # el azul al 75 % y el negro del 17,5 % al 5 %).
    acento = {"material": 2, "cada": 2, "desde": 1}
    confeti = _confeti([(2, 10), (0, 50), (1, 40)], acentos=[acento])
    plan = _plan(_con_patron(_columna(), confeti, (0.275, 0.175, 0.55)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo"), colores=["rojo"])

    # Los pesos se escalan a 80 (8/40/32) y el rojo entra con 20; el acento no cambia.
    patron = cast(dict[str, object], _estructura(resultado.plan, COLUMNA)["patron_color"])
    assert patron == _confeti([(2, 8), (0, 40), (1, 32), (3, 20)], acentos=[acento])
    assert resultado.avisos == ()
    # La base reparte 40 celdas en 3 azules, 16 blancos, 13 negros y 8 rojos
    # (3.2, 16, 12.8, 8 por mayor resto) y el acento pisa la mitad: el azul es
    # sus 20 globos de acento más, a lo sumo, sus 3 de la base; el rojo, a lo
    # sumo sus 8.
    blanco, negro, azul, rojo = _partes(resultado.plan, COLUMNA)
    assert 20 / 40 <= azul <= 23 / 40
    assert 0 < rojo <= 8 / 40
    assert blanco > 0 and negro > 0


def _pared(patron: Mapping[str, object]) -> dict[str, object]:
    return _con_patron(
        {
            "estructura_id": PARED,
            "nombre": "Pared",
            "tipo": "pared",
            "rol_escena": "soporte",
            "ubicacion": "fondo_pared",
            "medidas": {"ancho_m": 2.4, "alto_m": 2.4},
            "repeticiones": 1,
            "densidad": "media",
            "mezcla": "clasica",
            "materiales": _materiales(("blanco", "negro"), (0.5, 0.5)),
            "porque": "Pared de prueba.",
        },
        patron,
        (0.5, 0.5),
    )


def test_agregar_a_una_pared_entra_como_fila_de_acento() -> None:
    anillos = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "anillos", "secuencia": [0, 1], "largo": 1},
    }
    plan = _plan(_pared(anillos))

    resultado = _editar(plan, _agregar(PARED, "rojo"), colores=["rojo"])

    patron = cast(dict[str, object], _estructura(resultado.plan, PARED)["patron_color"])
    assert patron == {**anillos, "acentos": [{"material": 2, "cada": 3, "desde": 2}]}
    # En la rejilla que arma el núcleo, las filas 2, 5, 8… son rojas enteras; el
    # resto alterna blanco y negro.
    resuelto = patron_resuelto_de_estructura(resultado.plan, PARED, patron)
    celdas = cast(list[list[int]], resuelto["celdas"])
    assert len(celdas) >= 5
    for fila, posiciones in enumerate(celdas):
        esperado = 2 if fila % 3 == 1 else fila % 2
        assert set(posiciones) == {esperado}, fila


def test_agregar_sin_cupo_de_acentos_rehace_el_preset() -> None:
    # Cuatro acentos del blanco en la posición 0, donde el racimo ya es blanco:
    # el conteo sigue 20/10/10.
    lleno = {
        **ESPIRAL,
        "acentos": [
            {"material": 0, "cada": cada, "desde": 1, "posiciones": [0]} for cada in (2, 3, 4, 5)
        ],
    }
    plan = _plan(_con_patron(_columna(), lleno, (0.5, 0.25, 0.25)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo"), colores=["rojo"])

    # 0.4, 0.2, 0.2, 0.2: cuatro colores, una posición cada uno, del de más
    # participación al de menos (empates por posición): [0, 1, 2, 3], 10 de cada.
    assert _estructura(resultado.plan, COLUMNA)["patron_color"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 2, 3], "trazo": "espiral"},
    }
    assert _partes(resultado.plan, COLUMNA) == [0.25, 0.25, 0.25, 0.25]
    assert resultado.avisos == (AVISO_PATRON_AGREGAR,)


def test_agregar_un_acento_que_borra_otro_color_rehace_el_preset() -> None:
    # Blanco en todo el racimo y el negro solo como acento (posición 0 de las
    # filas pares): 35/5 → 0.875, 0.125. El acento del rojo cae justo encima y
    # el negro quedaría sin globos.
    patron = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "espiral", "racimo": [0, 0, 0, 0], "trazo": "espiral"},
        "acentos": [{"material": 1, "cada": 2, "desde": 2, "posiciones": [0]}],
    }
    plan = _plan(_con_patron(_columna(("blanco", "negro"), (0.5, 0.5)), patron, (0.875, 0.125)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo"), colores=["rojo"])

    # 0.7, 0.1, 0.2: 4p - 1 = 1.8 → la posición que sobra al blanco; luego el rojo
    # (más participación que el negro), el blanco y el negro: [0, 2, 0, 1] → 20/10/10.
    assert _estructura(resultado.plan, COLUMNA)["patron_color"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 2, 0, 1], "trazo": "espiral"},
    }
    assert _partes(resultado.plan, COLUMNA) == [0.5, 0.25, 0.25]
    assert resultado.avisos == (AVISO_PATRON_AGREGAR,)


def test_agregar_a_un_confeti_sin_cupo_de_pesos_rehace_el_preset() -> None:
    confeti = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {
            "modo": "aleatorio",
            "pesos": [{"material": indice // 2, "peso": 20 if indice < 2 else 15} for indice in range(6)],
            "semilla": 3,
        },
    }
    plan = _plan(_con_patron(_columna(partes=(0.4, 0.3, 0.3)), confeti, (0.4, 0.3, 0.3)))

    resultado = _editar(plan, _agregar(COLUMNA, "rojo"), colores=["rojo"])

    # 0.32, 0.24, 0.24, 0.2: una posición por color, [0, 1, 2, 3].
    patron = cast(dict[str, object], _estructura(resultado.plan, COLUMNA)["patron_color"])
    assert patron["base"] == {"modo": "espiral", "racimo": [0, 1, 2, 3], "trazo": "espiral"}
    assert resultado.avisos == (AVISO_PATRON_AGREGAR,)


def test_un_segundo_color_trae_el_preset_solo_con_la_bandera() -> None:
    plan = _plan(_columna(("blanco",), (1,)))

    con = _editar(plan, _agregar(COLUMNA, "negro"), colores=["negro"], completar_patrones=True)
    sin = _editar(plan, _agregar(COLUMNA, "negro"), colores=["negro"])

    # 0.8 / 0.2: 4p - 1 = 2.2 → las dos posiciones que sobran al blanco: [0, 1, 0, 0].
    assert _estructura(con.plan, COLUMNA)["patron_color"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 0], "trazo": "espiral"},
    }
    assert _partes(con.plan, COLUMNA) == [0.75, 0.25]
    assert con.avisos == (AVISO_PATRON_SUGERIDO,)
    assert "patron_color" not in _estructura(sin.plan, COLUMNA)
    assert _partes(sin.plan, COLUMNA) == [0.8, 0.2]
    assert sin.avisos == ()


def test_un_tercer_color_sin_patron_no_trae_preset() -> None:
    resultado = _editar(
        _plan(_columna(("blanco", "negro"), (0.5, 0.5))),
        _agregar(COLUMNA, "azul"),
        colores=["azul"],
        completar_patrones=True,
    )

    assert "patron_color" not in _estructura(resultado.plan, COLUMNA)


# --- quitar con patrón --------------------------------------------------------------------


def test_quitar_un_color_rehace_el_preset() -> None:
    plan = _plan(_con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25)))

    resultado = _editar(plan, _quitar(COLUMNA, "var-azul-12"), _lineas(COLUMNA, _linea("azul")))

    # 0.5 / 0.75 → 0.666667 y 0.333333: 4p - 1 reparte 2 posiciones, las dos al
    # blanco (1.67 contra 0.33) → [0, 1, 0, 0], 30/10.
    assert _estructura(resultado.plan, COLUMNA)["patron_color"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 0], "trazo": "espiral"},
    }
    assert _partes(resultado.plan, COLUMNA) == [0.75, 0.25]
    assert resultado.avisos == (AVISO_PATRON_QUITAR,)


def test_quitar_hasta_un_color_quita_el_patron() -> None:
    espiral = {**ESPIRAL, "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"}}
    plan = _plan(_con_patron(_columna(("blanco", "negro"), (0.5, 0.5)), espiral, (0.5, 0.5)))

    resultado = _editar(plan, _quitar(COLUMNA, "var-negro-12"), _lineas(COLUMNA, _linea("negro")))

    assert "patron_color" not in _estructura(resultado.plan, COLUMNA)
    assert _partes(resultado.plan, COLUMNA) == [1.0]
    assert resultado.avisos == (AVISO_PATRON_UN_COLOR,)


def test_sin_preset_posible_el_patron_se_quita(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(plan_edicion, "sugerir_patron_para_estructura", lambda plan, estructura_id: None)
    plan = _plan(_con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25)))

    resultado = _editar(plan, _quitar(COLUMNA, "var-azul-12"), _lineas(COLUMNA, _linea("azul")))

    assert "patron_color" not in _estructura(resultado.plan, COLUMNA)
    assert _partes(resultado.plan, COLUMNA) == [0.666667, 0.333333]
    assert resultado.avisos == (AVISO_PATRON_SIN_PRESET,)


# --- el resto de ediciones con patrón -------------------------------------------------------


def test_reemplazar_en_una_pieza_con_patron_no_toca_el_patron() -> None:
    estructura = _con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25))

    resultado = _editar(
        _plan(estructura),
        _reemplazo(COLUMNA, "var-negro-12", {"product_id": "prod-gris", "variant_id": "var-gris-12"}),
        _lineas(COLUMNA, _linea("negro")),
        ["gris"],
    )

    editada = _estructura(resultado.plan, COLUMNA)
    assert editada["patron_color"] == ESPIRAL
    assert editada["materiales"] == estructura["materiales"]
    assert editada["variant_overrides"] == [
        {"objetivo_variant_id": "var-negro-12", "product_id": "prod-gris", "variant_id": "var-gris-12", "color": "gris"}
    ]


def test_cambiar_la_mezcla_de_una_pieza_con_patron_lo_conserva() -> None:
    plan = _plan(_con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25)))

    resultado = _editar(plan, {"accion": "mezcla", "estructura_id": COLUMNA, "mezcla": "solo_grandes"})

    editada = _estructura(resultado.plan, COLUMNA)
    partes = _partes(resultado.plan, COLUMNA)
    assert (editada["mezcla"], editada["patron_color"]) == ("solo_grandes", ESPIRAL)
    # Con varios tamaños el total no cambia y se reparte 2:1:1 por la gráfica.
    assert abs(sum(partes) - 1) < 1e-9
    assert partes[1] == partes[2] and partes[0] > partes[1]


def test_editar_una_pieza_no_toca_el_patron_de_otra() -> None:
    columna = _con_patron(_columna(), ESPIRAL, (0.5, 0.25, 0.25))

    resultado = _editar(_plan(columna, _arco()), _agregar(ARCO, "blanco"), colores=["blanco"])

    assert _estructura(resultado.plan, COLUMNA) == columna


# --- Frontera HTTP ------------------------------------------------------------------------


def _firmado(
    path: str, scope: str, operation: Mapping[str, object], nonce: str
) -> tuple[bytes, dict[str, str]]:
    context = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-4000-8000-000000000928",
        "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 5000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": [scope],
    }
    body = json.dumps({"context": context, **operation}, separators=(",", ":"), ensure_ascii=False).encode()
    timestamp = int(time.time())
    return body, {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=path,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[scope],
            body=body,
        ),
    }


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = "plan.edit"
) -> tuple[int, dict[str, object]]:
    body, headers = _firmado("/internal/v1/plan/edit", scope, operation, nonce)
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post("/internal/v1/plan/edit", content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def _operacion(
    plan: Mapping[str, object],
    edicion: Mapping[str, object],
    lineas: Sequence[Mapping[str, object]] = (),
    colores: Sequence[str] = (),
) -> dict[str, object]:
    return {
        "schema_version": "plan-edit.v1",
        "plan": plan,
        "lineas_base": list(lineas),
        "edicion": edicion,
        "colores_variante": list(colores),
        "completar_patrones": False,
    }


def test_el_endpoint_edita_y_responde_plan_edit_result() -> None:
    operacion = _operacion(
        _plan(_columna()),
        {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.3, 0.3, 0.3]},
    )

    status, body = _post(operacion, "00000000-0000-4000-8000-000000000a01")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert (payload["operation_schema_version"], payload["avisos"]) == ("plan-edit-result.v1", [])
    assert _partes(cast(dict[str, object], payload["plan"]), COLUMNA) == [0.333333, 0.333333, 0.333334]


def test_el_endpoint_traduce_los_errores_de_dominio() -> None:
    lineas = [{"estructura_id": ARCO, "lineas": [{"product_id": "prod-rojo", "variant_id": "var-rojo-12", "color": "rojo"}]}]
    unico = _operacion(_plan(_arco()), _quitar(ARCO, "var-rojo-12"), lineas)
    sin_azul = _operacion(
        _plan(_columna()),
        {
            "accion": "patron",
            "estructura_id": COLUMNA,
            "patron_color": {**ESPIRAL, "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"}},
        },
    )

    status_unico, body_unico = _post(unico, "00000000-0000-4000-8000-000000000a02")
    status_patron, body_patron = _post(sin_azul, "00000000-0000-4000-8000-000000000a03")

    assert (status_unico, cast(dict[str, object], body_unico["detail"])["code"]) == (400, "unico_material")
    detail = cast(dict[str, object], body_patron["detail"])
    assert status_patron == 422
    assert (detail["code"], detail["estructura_id"], detail["motivo"]) == (
        "patron_invalido",
        COLUMNA,
        "material_sin_uso",
    )
    assert "azul (3)" in str(detail["mensaje"])


def test_el_endpoint_exige_su_scope_y_un_cuerpo_valido() -> None:
    operacion = _operacion(_plan(_columna()), {"accion": "mezcla", "estructura_id": COLUMNA, "mezcla": "clasica"})
    sin_variante = _operacion(_plan(_arco()), {"accion": "agregar", "estructura_id": ARCO})

    status_scope, body_scope = _post(operacion, "00000000-0000-4000-8000-000000000a04", scope="plan.resolve")
    status_cuerpo, body_cuerpo = _post(sin_variante, "00000000-0000-4000-8000-000000000a05")

    assert (status_scope, cast(dict[str, object], body_scope["detail"])["code"]) == (403, "insufficient_scope")
    assert (status_cuerpo, cast(dict[str, object], body_cuerpo["detail"])["code"]) == (422, "invalid_request")


def test_el_endpoint_edita_fuera_del_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    # Expandir patrones y validar contra el contrato es CPU puro: en el event
    # loop bloqueaba a todo ai-api (chat, imagen, nonce). Va al hilo del plan.
    import threading

    import app.main as main

    hilos: list[str] = []
    editar = main.ejecutar_edicion

    def espia(peticion: plan_edicion.PlanEditRequest) -> dict[str, object]:
        hilos.append(threading.current_thread().name)
        return editar(peticion)

    monkeypatch.setattr(main, "ejecutar_edicion", espia)
    operacion = _operacion(
        _plan(_columna()),
        {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.3, 0.3, 0.3]},
    )

    status, _body = _post(operacion, "00000000-0000-4000-8000-000000000a06")

    assert status == 200
    assert len(hilos) == 1 and hilos[0].startswith("plan-cpu")
