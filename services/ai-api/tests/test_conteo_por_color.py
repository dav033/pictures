"""Conteo por color: lo que el plan declara, lo que se compra y lo que se dice (2026-10-05).

Un arco clásico declarado 70/20/10 tenía tres respuestas por color: ``participacion`` reescrita a
0,5/0,25/0,25 desde la rejilla de un preset, 44/22/22 en ``patrones_color`` y 30/29/29 en las líneas
que se compran, que son las del motor. Y un color declarado podía quedarse sin un solo globo sin que
nadie lo dijera (un centro de mesa de 0,4 m a 75/20/5 compraba 6/2/0). Lo que fija este archivo:

- el reparto entero de una pieza contada por la fórmula no deja sin globo a un color declarado
  mientras haya uno para cada color, y no cambia el de las piezas que ya se lo daban;
- una pieza que cuenta su motor no recibe patrón sugerido ni ``participacion`` reescrita, y si trae
  un patrón, ``patrones_color`` publica el conteo del motor;
- ``advertencias`` dice ``reparto_distinto``, ``color_sin_globos`` y ``patron_sin_aplicar``, y nada
  de eso entra en ``plan_hash``.

Las cuentas esperadas van a mano en el comentario de cada caso; los planes usan el catálogo de
``guirnalda_datos`` (rosado, blanco y dorado en cinco diámetros).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

import pytest

import app.plan as plan_module
from app.patron_color import AVISO_CONTEO_DEL_ARMADO
from app.plan import (
    _apportion_margins,
    _fill_margins,
    _hamilton,
    _size_totals,
    sugerir_patron_para_estructura,
)
from tests.guirnalda_datos import guirnalda, material, plan, resolver

ARCO = "EST_01_ARCO"
CENTRO = "EST_01_CENTRO"
COLUMNA = "EST_01_COLUMNA"


def _arco(**extra: object) -> dict[str, object]:
    """Un arco clásico de 3 × 2,4 m: lo cuenta la receta del motor aunque no traiga armado."""
    return {
        "estructura_id": ARCO,
        "nombre": "Arco principal",
        "tipo": "arco",
        "estructura_oficial": "arco",
        "rol_escena": "focal",
        "ubicacion": "arco_central",
        "medidas": {"ancho_m": 3, "alto_m": 2.4},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            material("blanco", 0.7, principal=True),
            material("dorado", 0.2),
            material("rosado", 0.1),
        ],
        "porque": "Arco de prueba.",
        **extra,
    }


def _centro(
    partes: Sequence[tuple[str, float]], medida: float = 0.4, mezcla: str = "organica_fina"
) -> dict[str, object]:
    """Un centro de mesa: sin motor, lo cuenta la fórmula y lo reparte ``participacion``."""
    return {
        "estructura_id": CENTRO,
        "nombre": "Centro de mesa",
        "tipo": "centro_mesa",
        "estructura_oficial": "centro_mesa",
        "rol_escena": "acento",
        "ubicacion": "sobre_mesa_principal",
        "medidas": {"ancho_m": medida, "alto_m": medida},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": mezcla,
        "materiales": [
            material(color, parte, principal=indice == 0)
            for indice, (color, parte) in enumerate(partes)
        ],
        "porque": "Centro de prueba.",
    }


def _columna() -> dict[str, object]:
    """Una columna clásica sin armado: la cuenta la fórmula, así que su patrón es el que se compra."""
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "estructura_oficial": "columna",
        "rol_escena": "soporte",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 2.0},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            material("blanco", 0.7, principal=True),
            material("dorado", 0.2),
            material("rosado", 0.1),
        ],
        "porque": "Columna de prueba.",
    }


def _estructura(resuelto: Mapping[str, object], indice: int = 0) -> dict[str, object]:
    return cast(list[dict[str, object]], cast(dict[str, object], resuelto["plan"])["estructuras"])[
        indice
    ]


def _participaciones(resuelto: Mapping[str, object]) -> list[float]:
    return [
        cast(float, item["participacion"])
        for item in cast(list[dict[str, object]], _estructura(resuelto)["materiales"])
    ]


def _por_color(resuelto: Mapping[str, object]) -> dict[str, int]:
    estructura = cast(list[dict[str, object]], resuelto["estructuras"])[0]
    cuenta: dict[str, int] = {}
    for linea in cast(list[dict[str, object]], estructura["lineas"]):
        color = cast(str, linea["color"])
        cuenta[color] = cuenta.get(color, 0) + cast(int, linea["unidades"])
    return cuenta


def _avisos(resuelto: Mapping[str, object], codigo: str) -> list[str]:
    return [
        aviso
        for aviso in cast(list[str], resuelto["advertencias"])
        if aviso.startswith(f"{codigo}:")
    ]


# --- El reparto entero de la fórmula -----------------------------------------------------------


def test_un_color_declarado_no_se_queda_sin_globos() -> None:
    # 8 globos a 75/20/5: el mayor resto da 6/1,6/0,4 -> 6/2/0 y el dorado no se compraba.
    # Con un globo para cada color se reservan 3 y los 5 que quedan van por mayor resto:
    # 3,75/1/0,25 -> 3/1/0 + el resto mayor (0,75) -> 4/1/0, más la reserva -> 5/2/1.
    matriz = _apportion_margins(8, ((12, 1.0),), [0.75, 0.2, 0.05])
    assert matriz == [[5, 2, 1]]
    # Con dos tamaños cierran los dos márgenes: 4 y 4 globos por tamaño, 5/2/1 por color.
    dos_tamanos = _apportion_margins(8, ((5, 0.5), (12, 0.5)), [0.75, 0.2, 0.05])
    assert [sum(fila) for fila in dos_tamanos] == [4, 4]
    assert [sum(fila[columna] for fila in dos_tamanos) for columna in range(3)] == [5, 2, 1]


@pytest.mark.parametrize(
    ("total", "proporciones", "partes"),
    [
        (100, ((12, 1.0),), (0.7, 0.2, 0.1)),
        (10, ((12, 0.5), (18, 0.5)), (0.7, 0.3)),
        (119, ((5, 0.21), (9, 0.18), (12, 0.54), (18, 0.05), (24, 0.02)), (0.7, 0.2, 0.1)),
        (8, ((12, 1.0),), (0.6, 0.3, 0.1)),
    ],
)
def test_el_reparto_que_ya_compraba_cada_color_no_cambia(
    total: int, proporciones: tuple[tuple[int, float], ...], partes: tuple[float, ...]
) -> None:
    """La regla vieja, a la letra: mayor resto por ``participacion`` y el mismo llenado de la matriz.

    Con 8 globos a 60/30/10 el mayor resto ya da 5/2/1: nada que reservar y nada se mueve. Solo
    cambian (y cambian su ``plan_hash``) los planes que dejaban un color en cero. Las cuotas se
    renormalizan como siempre: 0,7 + 0,2 + 0,1 no suma 1 en coma flotante.
    """
    cuotas = [parte / sum(partes) for parte in partes]
    antes = _fill_margins(
        total,
        proporciones,
        _size_totals(total, proporciones),
        _hamilton(total, [total * cuota for cuota in cuotas], [0.0 for _cuota in cuotas]),
        cuotas,
    )
    assert _apportion_margins(total, proporciones, list(partes)) == antes


def test_con_menos_globos_que_colores_no_se_inventa_un_globo() -> None:
    # 2 globos a 50/30/20: 1/0,6/0,4 -> 1/1/0. Con menos globos que colores no hay reserva posible.
    assert _apportion_margins(2, ((18, 1.0),), [0.5, 0.3, 0.2]) == [[1, 1, 0]]


@pytest.mark.anyio
async def test_el_centro_de_mesa_compra_el_color_que_declara_y_lo_dice() -> None:
    resuelto = await resolver(plan(_centro([("rosado", 0.75), ("blanco", 0.2), ("dorado", 0.05)])))

    assert _por_color(resuelto) == {"rosado": 5, "blanco": 2, "dorado": 1}
    assert not _avisos(resuelto, "color_sin_globos")
    # 5/2/1 de 8 es 62,5/25/12,5: el rosado queda 12,5 puntos por debajo de lo declarado, pero con 8
    # globos un globo vale 12,5 puntos y es la reserva de uno por color la que lo fuerza: es redondeo, no
    # un reparto distinto, y no se avisa (``_color_warnings``, umbral de 10 globos por pieza).
    assert not _avisos(resuelto, "reparto_distinto")


@pytest.mark.anyio
async def test_un_reparto_distinto_se_avisa_desde_diez_globos_por_pieza() -> None:
    # El mismo centro a 1 m ya lleva globos de sobra para el reparto: si lo que se compra se separa más de
    # 10 puntos de lo declarado, se dice. A 0,4 m (8 globos) es redondeo y no.
    pequeno = await resolver(plan(_centro([("rosado", 0.75), ("blanco", 0.2), ("dorado", 0.05)])))
    assert not _avisos(pequeno, "reparto_distinto")
    arco = await resolver(plan(_arco()))
    [aviso] = _avisos(arco, "reparto_distinto")
    assert aviso.startswith(f"reparto_distinto:{ARCO}: Arco principal: el plan declara blanco 70 %")


@pytest.mark.anyio
async def test_un_color_que_no_cabe_se_dice_con_su_nombre() -> None:
    # 0,15 m solo de grandes son 2 globos por pieza para tres colores: el dorado se queda sin globo.
    resuelto = await resolver(
        plan(
            _centro(
                [("rosado", 0.5), ("blanco", 0.3), ("dorado", 0.2)],
                medida=0.15,
                mezcla="solo_grandes",
            )
        )
    )

    assert "dorado" not in _por_color(resuelto)
    assert _avisos(resuelto, "color_sin_globos") == [
        f"color_sin_globos:{CENTRO}:dorado: Centro de mesa: el dorado que declara el plan se queda"
        " sin globos y no se compra: la pieza lleva 2 globos y no alcanza uno para cada uno de sus 3"
        " colores."
    ]


@pytest.mark.anyio
async def test_un_reparto_que_sigue_lo_declarado_no_avisa() -> None:
    # Arco orgánico sin armado: lo cuenta la fórmula y lo reparte ``participacion`` (83/24/12 de 119).
    resuelto = await resolver(plan(_arco(mezcla="organica_fina")))

    assert _por_color(resuelto) == {"blanco": 83, "dorado": 24, "rosado": 12}
    assert not _avisos(resuelto, "reparto_distinto")
    assert not _avisos(resuelto, "color_sin_globos")


# --- Las piezas que cuenta el motor ------------------------------------------------------------


@pytest.mark.anyio
async def test_el_arco_del_motor_no_recibe_patron_ni_participacion_de_rejilla() -> None:
    sin_completar = await resolver(plan(_arco()))
    completado = await resolver(plan(_arco()), completar_patrones=True)

    # Lo que se compra lo coloca el motor, con patrón o sin él: 30/29/29 de 88.
    assert _por_color(completado) == {"blanco": 30, "dorado": 29, "rosado": 29}
    assert "patron_color" not in _estructura(completado)
    assert "patrones_color" not in completado
    assert _participaciones(completado) == [0.7, 0.2, 0.1]
    # Completar los patrones no le cambia nada a una pieza del motor: es el mismo plan firmado.
    assert completado["plan_hash"] == sin_completar["plan_hash"]
    # 30/29/29 de 88 son 34/33/33: el blanco queda 36 puntos por debajo de su 70 %.
    assert _avisos(completado, "reparto_distinto") == [
        f"reparto_distinto:{ARCO}: Arco principal: el plan declara blanco 70 %, dorado 20 % y"
        " rosado 10 %; lo que se compra es blanco 34 %, dorado 33 % y rosado 33 % (30, 29 y 29"
        " globos)."
    ]


@pytest.mark.anyio
async def test_la_guirnalda_organica_del_motor_tampoco_recibe_patron() -> None:
    completada = await resolver(plan(guirnalda()), completar_patrones=True)

    assert "patron_color" not in _estructura(completada)
    assert "patrones_color" not in completada
    assert _participaciones(completada) == [0.6, 0.4]
    assert "armados_guirnalda_organica" in completada, "la cuenta su receta del motor"


@pytest.mark.anyio
async def test_una_pieza_sin_motor_sigue_recibiendo_su_preset() -> None:
    completada = await resolver(plan(_columna()), completar_patrones=True)

    patron = cast(dict[str, object], _estructura(completada)["patron_color"])
    assert patron["origen"] == "sugerido"
    # Su rejilla es lo que se compra, así que el plan la declara: la espiral [0, 1, 0, 2] es 2/1/1.
    assert _participaciones(completada) == [0.5, 0.25, 0.25]
    assert not _avisos(completada, "reparto_distinto")


@pytest.mark.anyio
async def test_un_patron_en_una_pieza_del_motor_publica_el_conteo_del_motor() -> None:
    espiral = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
    }
    resuelto = await resolver(plan(_arco(patron_color=espiral)))

    # El patrón es la pista del motor del arco; su rejilla (2/1/1 por racimo) no reescribe nada.
    assert _participaciones(resuelto) == [0.7, 0.2, 0.1]
    lineas = _por_color(resuelto)
    [publicado] = cast(list[dict[str, object]], resuelto["patrones_color"])
    conteo = {
        cast(str, fila["color"]): cast(int, fila["unidades_total"])
        for fila in cast(list[dict[str, object]], publicado["conteo"])
    }
    assert conteo == lineas, "la gráfica cuenta lo que se compra"
    assert publicado["globos_por_instancia"] == sum(lineas.values())
    assert AVISO_CONTEO_DEL_ARMADO in cast(list[str], publicado["avisos"])
    # El croquis pone un globo por globo comprado, con los colores del motor (no los de la rejilla).
    colores = [
        cast(str, fila["color"]) for fila in cast(list[dict[str, object]], publicado["conteo"])
    ]
    croquis: dict[str, int] = {}
    for posicion in cast(list[dict[str, object]], publicado.get("posiciones") or []):
        color = colores[cast(int, posicion["material"])]
        croquis[color] = croquis.get(color, 0) + 1
    assert croquis == lineas
    # Y resolver lo que se firmó vuelve a dar lo mismo: punto fijo.
    otra_vez = await resolver(cast(dict[str, object], resuelto["plan"]))
    assert otra_vez["plan_hash"] == resuelto["plan_hash"]
    assert otra_vez["advertencias"] == resuelto["advertencias"]


def test_una_edicion_no_le_pone_preset_a_una_pieza_del_motor() -> None:
    assert sugerir_patron_para_estructura(plan(_arco()), ARCO) is None
    assert sugerir_patron_para_estructura(plan(_columna()), COLUMNA) is not None


# --- Lo que se dice y lo que se firma ----------------------------------------------------------


@pytest.mark.anyio
async def test_un_preset_que_no_cabe_ya_no_cae_en_silencio() -> None:
    centro = _centro([("rosado", 0.75), ("blanco", 0.2), ("dorado", 0.05)])
    completado = await resolver(plan(centro), completar_patrones=True)
    sin_completar = await resolver(plan(centro))

    # El confeti de 8 globos a 75/20/5 deja al dorado sin celda: la pieza va sin patrón, y se dice.
    assert "patron_color" not in _estructura(completado)
    [aviso] = _avisos(completado, "patron_sin_aplicar")
    assert aviso.startswith(f"patron_sin_aplicar:{CENTRO}: Centro de mesa: ")
    assert "dorado" in aviso
    # Sin pedir patrones no hay nada que caiga.
    assert not _avisos(sin_completar, "patron_sin_aplicar")


@pytest.mark.anyio
async def test_las_advertencias_de_color_no_entran_en_el_plan_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    con_avisos = await resolver(plan(_arco()))
    monkeypatch.setattr(plan_module, "_color_warnings", lambda *_args, **_kwargs: [])
    sin_avisos = await resolver(plan(_arco()))

    assert _avisos(con_avisos, "reparto_distinto") and not _avisos(sin_avisos, "reparto_distinto")
    assert con_avisos["plan_hash"] == sin_avisos["plan_hash"]
    assert con_avisos["compras"] == sin_avisos["compras"]
