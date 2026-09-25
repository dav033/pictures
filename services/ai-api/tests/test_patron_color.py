"""Patrón de color por estructura (ADR-0028 §2–§8), sin catálogo ni resolutor.

Cada expectativa está calculada a mano desde la especificación del ADR y la
cuenta va en el comentario del caso; ninguna sale de ejecutar el módulo. Las
rejillas son pequeñas a propósito (3–6 filas) para que la cuenta se pueda
repasar a mano.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping, Sequence
from dataclasses import replace

import pytest

from app.patron_color import (
    EstructuraPatron,
    MaterialPatron,
    PatronColorInvalido,
    conteo_por_instancia,
    material_de_color,
    modos_admitidos,
    para_validar,
    participaciones,
    patron_desde_pista,
    patron_resuelto,
    sugerir_patron,
    sugerir_patron_modo,
    validar_y_expandir,
)

COLORES = ("blanco", "negro", "azul")


def _estructura(
    *,
    tipo: str = "columna",
    total: int = 16,
    colores: Sequence[str | None] = COLORES,
    partes: Sequence[float] | None = None,
    acabados: Sequence[str | None] | None = None,
    un_tamano: bool = True,
    ancho: float | None = None,
    alto: float | None = None,
    repeticiones: int = 1,
    estructura_id: str = "EST_01_COLUMNA",
) -> EstructuraPatron:
    partes = partes or [1 / len(colores)] * len(colores)
    acabados = acabados or [None] * len(colores)
    return EstructuraPatron(
        estructura_id=estructura_id,
        tipo=tipo,
        total=total,
        un_tamano=un_tamano,
        ancho_m=ancho,
        alto_m=alto,
        repeticiones=repeticiones,
        materiales=tuple(
            MaterialPatron(color=color, acabado=acabado, participacion=parte)
            for color, acabado, parte in zip(colores, acabados, partes, strict=True)
        ),
    )


def _patron(base: Mapping[str, object], **extra: object) -> dict[str, object]:
    return {"version": "patron-color.v1", "origen": "decorador", "base": dict(base), **extra}


def _celdas(estructura: EstructuraPatron, patron: Mapping[str, object]) -> list[list[int]]:
    return [list(fila) for fila in validar_y_expandir(estructura, patron).celdas]


def _conteo(estructura: EstructuraPatron, patron: Mapping[str, object]) -> list[int]:
    return list(conteo_por_instancia(estructura, validar_y_expandir(estructura, patron)).unidades)


def _motivo(estructura: EstructuraPatron, patron: Mapping[str, object]) -> PatronColorInvalido:
    with pytest.raises(PatronColorInvalido) as error:
        validar_y_expandir(estructura, patron)
    return error.value


ESPIRAL = {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"}
# Pared de 3 filas × 4 columnas: T = 12, 4 m × 3 m -> columnas = round(sqrt(12·4/3)) = 4,
# filas = round(12 / 4) = 3.
PARED_3X4 = {"tipo": "pared", "total": 12, "ancho": 4.0, "alto": 3.0}


# --- Geometría (§2) ------------------------------------------------------------


@pytest.mark.parametrize(
    ("total", "filas"),
    [(39, 10), (38, 10), (37, 9), (1, 1), (0, 1)],
    # 39/4 = 9.75 -> 10; 38/4 = 9.5 -> 10 (mitad hacia arriba); 37/4 = 9.25 -> 9;
    # 1/4 -> 0 -> mínimo 1; sin globos también queda una fila.
)
def test_racimos_redondean_t_entre_k_a_filas_completas(total: int, filas: int) -> None:
    expansion = validar_y_expandir(_estructura(total=total), _patron(ESPIRAL))

    assert (expansion.geometria, expansion.filas, expansion.columnas) == ("racimos", filas, 4)


def test_globos_por_racimo_decide_k_en_los_demas_modos() -> None:
    # k = 3 -> filas = round(10 / 3 = 3.33) = 3.
    patron = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, globos_por_racimo=3)

    expansion = validar_y_expandir(_estructura(total=10), patron)

    assert (expansion.filas, expansion.columnas) == (3, 3)


@pytest.mark.parametrize(
    ("total", "ancho", "alto", "filas", "columnas"),
    [
        # sqrt(175 · 2 / 1.5) = 15.28 -> 15 columnas; 175 / 15 = 11.67 -> 12 filas.
        (175, 2.0, 1.5, 12, 15),
        # Sin alto la pared se toma cuadrada: sqrt(84) = 9.17 -> 9; 84 / 9 = 9.33 -> 9.
        (84, 2.0, None, 9, 9),
        # Nunca menos de 2 columnas: sqrt(1) = 1 -> 2; 1 / 2 = 0.5 -> 1 fila.
        (1, 1.0, 1.0, 1, 2),
    ],
)
def test_pared_es_rejilla_proporcional_a_sus_medidas(
    total: int, ancho: float, alto: float | None, filas: int, columnas: int
) -> None:
    estructura = _estructura(tipo="pared", total=total, ancho=ancho, alto=alto, colores=COLORES[:2])
    patron = _patron({"modo": "damero", "secuencia": [0, 1], "tamano": 1}, globos_por_racimo=8)

    expansion = validar_y_expandir(estructura, patron)

    assert (expansion.geometria, expansion.filas, expansion.columnas) == (
        "rejilla",
        filas,
        columnas,
    )


# --- Modos (§3) ----------------------------------------------------------------


def test_espiral_repite_el_racimo_en_cada_fila_y_el_trazo_no_cambia_el_conteo() -> None:
    estructura = _estructura(total=16)
    for trazo in ("espiral", "zigzag", "recto"):
        patron = _patron({**ESPIRAL, "trazo": trazo})
        assert _celdas(estructura, patron) == [[0, 1, 0, 2]] * 4
        assert _conteo(estructura, patron) == [8, 4, 4]


def test_anillos_cambian_de_color_cada_largo_racimos() -> None:
    estructura = _estructura(total=20)  # 5 filas

    uno = _celdas(estructura, _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}))
    dos = _celdas(estructura, _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 2}))

    assert uno == [[0] * 4, [1] * 4, [2] * 4, [0] * 4, [1] * 4]
    # r // 2 = 0, 0, 1, 1, 2.
    assert dos == [[0] * 4, [0] * 4, [1] * 4, [1] * 4, [2] * 4]


def test_anillos_transversales_de_una_pared_van_por_columna() -> None:
    estructura = _estructura(**PARED_3X4, colores=COLORES[:2])
    patron = _patron({"modo": "anillos", "secuencia": [0, 1], "largo": 1}, direccion="transversal")

    assert _celdas(estructura, patron) == [[0, 1, 0, 1]] * 3


def test_bloques_reparten_las_filas_por_mayor_resto() -> None:
    estructura = _estructura(total=20)  # 5 filas
    # 5 · (1, 1, 2) / 4 = 1.25, 1.25, 2.5 -> 1, 1, 2 y la fila que falta va al
    # mayor resto (0.5, el tercero): 1, 1, 3.
    tres = _patron(
        {
            "modo": "bloques",
            "bloques": [
                {"material": 0, "peso": 1},
                {"material": 1, "peso": 1},
                {"material": 2, "peso": 2},
            ],
        }
    )
    # 2.5 y 2.5 empatan: gana el primero -> 3, 2.
    dos = _patron(
        {"modo": "bloques", "bloques": [{"material": 0, "peso": 1}, {"material": 1, "peso": 1}]}
    )

    assert [fila[0] for fila in _celdas(estructura, tres)] == [0, 1, 2, 2, 2]
    assert [fila[0] for fila in _celdas(_estructura(total=20, colores=COLORES[:2]), dos)] == [
        0,
        0,
        0,
        1,
        1,
    ]


def test_degradado_escalonado_asigna_una_parada_por_franja() -> None:
    # t · m = (2i + 1) · 3 / 8 = 0.375, 1.125, 1.875, 2.625 -> paradas 0, 1, 1, 2.
    patron = _patron({"modo": "degradado", "paradas": [0, 1, 2], "transicion": "escalonada"})

    assert [fila[0] for fila in _celdas(_estructura(total=16), patron)] == [0, 1, 1, 2]


def test_degradado_suave_mezcla_los_dos_tonos_en_cada_fila() -> None:
    # Dos paradas, L = 4, n = 4: x = f = (2i + 1) / 8 y u = round_half_up(4 f)
    # = round(0.5, 1.5, 2.5, 3.5) = 1, 2, 3, 4 globos del tono final, repartidos
    # donde floor((c + 1) u / 4) > floor(c u / 4).
    estructura = _estructura(total=16, colores=COLORES[:2])
    patron = _patron({"modo": "degradado", "paradas": [0, 1], "transicion": "suave"})

    assert _celdas(estructura, patron) == [
        [0, 0, 0, 1],
        [0, 1, 0, 1],
        [0, 1, 1, 1],
        [1, 1, 1, 1],
    ]
    assert _conteo(estructura, patron) == [6, 10]


def test_degradado_diagonal_de_pared_escalonado_y_suave() -> None:
    estructura = _estructura(**PARED_3X4, colores=COLORES[:2])
    # N = (2r + 1) · 4 + (2c + 1) · 3 y t = N / 48.
    # Escalonada: parada floor(2N / 48). Fila 0: N = 7, 13, 19, 25 -> 0, 0, 0, 1.
    escalonada = _patron(
        {"modo": "degradado", "paradas": [0, 1], "transicion": "escalonada"}, direccion="diagonal"
    )
    # Suave: tono 1 si 16N > (2h + 1) · 48, es decir N > 3 (2h + 1), con
    # h = (3r + 5c) mod 8. Fila 0: h = 0, 5, 2, 7 -> 7 > 3, 13 > 33, 19 > 15, 25 > 45.
    suave = _patron(
        {"modo": "degradado", "paradas": [0, 1], "transicion": "suave"}, direccion="diagonal"
    )

    assert _celdas(estructura, escalonada) == [[0, 0, 0, 1], [0, 0, 1, 1], [0, 1, 1, 1]]
    assert _celdas(estructura, suave) == [[1, 0, 1, 0], [0, 1, 0, 1], [0, 1, 1, 1]]


def test_confeti_cuenta_por_pesos_y_coloca_por_sha256() -> None:
    estructura = _estructura(total=10)  # round(10 / 4 = 2.5) = 3 filas -> 12 celdas
    patron = _patron(
        {
            "modo": "aleatorio",
            "semilla": 7,
            "pesos": [
                {"material": 0, "peso": 5},
                {"material": 1, "peso": 3},
                {"material": 2, "peso": 2},
            ],
        }
    )
    # 12 · (5, 3, 2) / 10 = 6, 3.6, 2.4 -> 6, 3, 2 y la que falta al mayor resto (0.6).
    assert _conteo(estructura, patron) == [6, 4, 2]

    orden = sorted(
        ((fila, posicion) for fila in range(3) for posicion in range(4)),
        key=lambda celda: hashlib.sha256(f"7:{celda[0]}:{celda[1]}".encode()).hexdigest(),
    )
    celdas = _celdas(estructura, patron)
    assert [celdas[fila][posicion] for fila, posicion in orden] == [0] * 6 + [1] * 4 + [2] * 2
    # Determinista: la misma semilla da la misma rejilla; otra la mueve sin
    # cambiar el conteo.
    assert _celdas(estructura, patron) == celdas
    otra = _patron({**patron["base"], "semilla": 8})
    assert _conteo(estructura, otra) == [6, 4, 2]


def test_flor_pone_fondo_petalos_y_un_globo_extra_en_el_centro() -> None:
    # Separación 1 -> periodo 4: q = 0 fondo, 1 pétalo, 2 pétalo + centro, 3 pétalo.
    estructura = _estructura(total=24)  # 6 filas
    patron = _patron({"modo": "flor", "fondo": 0, "petalo": 1, "centro": 2, "separacion": 1})

    expansion = validar_y_expandir(estructura, patron)
    conteo = conteo_por_instancia(estructura, expansion)

    assert [fila[0] for fila in expansion.celdas] == [0, 1, 1, 1, 0, 1]
    assert expansion.extras == ((2, 2),)
    # Un tamaño: el total es la rejilla más el centro, 24 + 1.
    assert (conteo.total, list(conteo.unidades)) == (25, [8, 16, 1])


def test_damero_de_dos_y_tres_colores() -> None:
    estructura = _estructura(**PARED_3X4)
    dos = _patron({"modo": "damero", "secuencia": [0, 1], "tamano": 1})
    tres = _patron({"modo": "damero", "secuencia": [0, 1, 2], "tamano": 1})
    cuadros = _patron({"modo": "damero", "secuencia": [0, 1], "tamano": 2})
    solo_dos = _estructura(**PARED_3X4, colores=COLORES[:2])

    assert _celdas(solo_dos, dos) == [[0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1]]
    # (r + c) mod 3: bandas diagonales, 4 globos de cada color.
    assert _celdas(estructura, tres) == [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2]]
    assert _conteo(estructura, tres) == [4, 4, 4]
    # Cuadros de 2 × 2: (r // 2 + c // 2) mod 2.
    assert _celdas(solo_dos, cuadros) == [[0, 0, 1, 1], [0, 0, 1, 1], [1, 1, 0, 0]]


def test_espejo_evalua_base_y_acentos_desde_cada_pie_del_arco() -> None:
    arco = _estructura(tipo="arco", total=20, estructura_id="EST_01_ARCO")  # 5 filas
    # r' = min(r, 4 - r) = 0, 1, 2, 1, 0 y L' = ceil(5 / 2) = 3. Bloques 1:1 en 3
    # líneas: 1.5 y 1.5 -> 2 y 1 -> línea 0, 0, 1.
    bloques = _patron(
        {"modo": "bloques", "bloques": [{"material": 0, "peso": 1}, {"material": 1, "peso": 1}]},
        simetria="espejo",
        acentos=[{"material": 2, "cada": 2, "desde": 1, "posiciones": [0]}],
    )

    celdas = _celdas(arco, bloques)

    assert [fila[1] for fila in celdas] == [0, 0, 1, 0, 0]
    # El acento cae donde r' + 1 es 1, 3, 5...: r' = 0 y 2 -> filas 0, 2 y 4.
    assert [fila[0] for fila in celdas] == [2, 0, 2, 0, 2]


def test_espejo_no_se_aplica_al_confeti() -> None:
    arco = _estructura(tipo="arco", total=20, colores=COLORES[:2], estructura_id="EST_01_ARCO")
    pesos = [{"material": 0, "peso": 1}, {"material": 1, "peso": 1}]
    sin_espejo = _patron({"modo": "aleatorio", "pesos": pesos, "semilla": 3})
    con_espejo = _patron({"modo": "aleatorio", "pesos": pesos, "semilla": 3}, simetria="espejo")

    assert _celdas(arco, con_espejo) == _celdas(arco, sin_espejo)


# --- Capas: acentos y pintados --------------------------------------------------


def test_acentos_cada_n_racimos_en_sus_posiciones() -> None:
    estructura = _estructura(total=24, colores=("blanco", "negro", "dorado"))  # 6 filas
    # Filas con r + 1 >= 2 y (r + 1 - 2) mod 3 = 0 -> r + 1 = 2, 5 -> filas 1 y 4.
    patron = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        acentos=[{"material": 2, "cada": 3, "desde": 2, "posiciones": [0]}],
    )

    celdas = _celdas(estructura, patron)

    assert [fila[0] for fila in celdas] == [0, 2, 0, 0, 2, 0]
    assert _conteo(estructura, patron) == [10, 12, 2]


def test_acento_sin_posiciones_pinta_el_racimo_y_las_de_mas_se_avisan() -> None:
    estructura = _estructura(total=16, colores=("blanco", "negro", "dorado"))  # 4 filas
    completo = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        acentos=[{"material": 2, "cada": 2, "desde": 2}],
    )
    fuera = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        acentos=[{"material": 2, "cada": 2, "desde": 1, "posiciones": [1, 5]}],
    )

    assert _celdas(estructura, completo) == [[0, 1, 0, 1], [2] * 4, [0, 1, 0, 1], [2] * 4]
    expansion = validar_y_expandir(estructura, fuera)
    assert [list(fila) for fila in expansion.celdas] == [
        [0, 2, 0, 1],
        [0, 1, 0, 1],
        [0, 2, 0, 1],
        [0, 1, 0, 1],
    ]
    # La posición 5 (la 6.ª) no existe en un cuarteto.
    assert expansion.avisos == (
        "El acento 1 pide la posición 6 y cada cuarteto tiene 4 globos: se ignoró.",
    )


def test_pintados_van_despues_de_los_acentos_y_avisan_los_que_sobran() -> None:
    estructura = _estructura(total=16, colores=("blanco", "negro", "dorado"))
    patron = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        acentos=[{"material": 2, "cada": 2, "desde": 2, "posiciones": [1]}],
        pintados=[
            {"fila": 0, "material": 2},
            {"fila": 1, "columna": 1, "material": 0},
            {"fila": 3, "columna": 3, "material": 2},
            {"fila": 9, "material": 1},
            {"fila": 0, "columna": 7, "material": 1},
        ],
    )

    expansion = validar_y_expandir(estructura, patron)

    # Acento en las filas 1 y 3, posición 1; el pintado de la fila 1 lo pisa.
    assert [list(fila) for fila in expansion.celdas] == [
        [2, 2, 2, 2],
        [0, 0, 0, 1],
        [0, 1, 0, 1],
        [0, 2, 0, 2],
    ]
    assert expansion.avisos == ("2 pintados quedaron fuera de la estructura",)


# --- Reglas cruzadas (§4) ---------------------------------------------------------


@pytest.mark.parametrize(
    ("estructura", "patron", "motivo"),
    [
        (_estructura(tipo="kit"), _patron(ESPIRAL), "tipo_sin_patron"),
        (_estructura(colores=("blanco",)), _patron(ESPIRAL), "un_solo_material"),
        (
            _estructura(),
            _patron({"modo": "espiral", "racimo": [0, 1, 0, 3], "trazo": "espiral"}),
            "material_fuera_de_rango",
        ),
        (
            _estructura(),
            _patron(ESPIRAL, acentos=[{"material": 5, "cada": 2, "desde": 1}]),
            "material_fuera_de_rango",
        ),
        (
            _estructura(),
            _patron({"modo": "damero", "secuencia": [0, 1], "tamano": 1}),
            "modo_no_permitido",
        ),
        (_estructura(**PARED_3X4), _patron(ESPIRAL), "modo_no_permitido"),
        (
            _estructura(tipo="centro_mesa"),
            _patron({"modo": "flor", "fondo": 0, "petalo": 1, "centro": 2, "separacion": 1}),
            "modo_no_permitido",
        ),
        (
            _estructura(),
            _patron(
                {"modo": "espiral", "racimo": [0, 1, 2], "trazo": "espiral"}, globos_por_racimo=4
            ),
            "racimo_incompleto",
        ),
        (
            _estructura(),
            _patron(
                {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, direccion="transversal"
            ),
            "direccion_no_permitida",
        ),
        (
            _estructura(**PARED_3X4),
            _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, direccion="diagonal"),
            "direccion_no_permitida",
        ),
        (_estructura(), _patron(ESPIRAL, simetria="espejo"), "simetria_no_permitida"),
        (
            _estructura(total=4040),  # k = 8 -> 505 filas × 8 = 4040 celdas
            _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, globos_por_racimo=8),
            "rejilla_demasiado_grande",
        ),
        (
            _estructura(**{**PARED_3X4, "total": 4100}),
            _patron({"modo": "damero", "secuencia": [0, 1, 2], "tamano": 1}),
            "rejilla_demasiado_grande",
        ),
    ],
)
def test_reglas_cruzadas_rechazan_con_su_motivo(
    estructura: EstructuraPatron, patron: dict[str, object], motivo: str
) -> None:
    error = _motivo(estructura, patron)

    assert error.motivo == motivo
    assert error.mensaje


def test_material_sin_uso_nombra_el_color_con_su_numero() -> None:
    patron = _patron({"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"})

    error = _motivo(_estructura(), patron)

    assert error.motivo == "material_sin_uso"
    assert "azul (3)" in error.mensaje


def test_un_acento_puede_ser_el_unico_uso_de_un_color() -> None:
    patron = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        acentos=[{"material": 2, "cada": 4, "desde": 4, "posiciones": [2]}],
    )

    assert _conteo(_estructura(total=16), patron) == [7, 8, 1]


# --- Conteo (§5) -------------------------------------------------------------------


def test_varios_tamanos_conservan_t_y_reparten_por_la_rejilla() -> None:
    # T = 19 -> 5 filas, M = 20, celdas 10/5/5. 19 · (10, 5, 5) / 20 = 9.5, 4.75,
    # 4.75 -> 9, 4, 4 y las dos que faltan a los restos 0.75: 9, 5, 5.
    estructura = _estructura(total=19, un_tamano=False)

    conteo = conteo_por_instancia(estructura, validar_y_expandir(estructura, _patron(ESPIRAL)))

    assert (conteo.total, list(conteo.unidades)) == (19, [9, 5, 5])
    assert participaciones(conteo) == [0.5, 0.25, 0.25]


# Columna de varios tamaños con T = 6: round(6 / 4 = 1.5) = 2 filas, M = 8 posiciones.
# Tres globos pintados dejan celdas 5/1/1/1.
POCOS_GLOBOS = _patron(
    {"modo": "espiral", "racimo": [0, 0, 0, 0], "trazo": "espiral"},
    pintados=[
        {"fila": 0, "columna": 1, "material": 1},
        {"fila": 0, "columna": 2, "material": 2},
        {"fila": 0, "columna": 3, "material": 3},
    ],
)
CUATRO_COLORES = ("blanco", "negro", "azul", "rojo")


def test_varios_tamanos_dan_al_menos_un_globo_a_cada_color_de_la_grafica() -> None:
    # 6 · (5, 1, 1, 1) / 8 = 3.75, 0.75, 0.75, 0.75 -> 3, 0, 0, 0 y las tres que
    # faltan a los restos empatados por posición: 4, 1, 1, 0. El rojo está en la
    # gráfica y es una compra: toma un globo del blanco, que tiene más -> 3, 1, 1, 1.
    estructura = _estructura(total=6, colores=CUATRO_COLORES, un_tamano=False)

    conteo = conteo_por_instancia(estructura, validar_y_expandir(estructura, POCOS_GLOBOS))

    assert (conteo.total, list(conteo.unidades)) == (6, [3, 1, 1, 1])
    # La participación declara lo que se compra: 3/6, 1/6, 1/6 y el resto.
    assert participaciones(conteo) == [0.5, 0.166667, 0.166667, 0.166666]


def test_varios_tamanos_con_menos_globos_que_colores_es_material_sin_uso() -> None:
    # T = 3 -> 1 fila de 4: una celda por color, pero solo 3 globos que comprar.
    estructura = _estructura(total=3, colores=CUATRO_COLORES, un_tamano=False)
    patron = _patron({"modo": "espiral", "racimo": [0, 1, 2, 3], "trazo": "espiral"})

    error = _motivo(estructura, patron)

    assert error.motivo == "material_sin_uso"
    assert "rojo (4)" in error.mensaje


def test_varios_tamanos_avisan_que_la_grafica_y_el_conteo_no_suman_igual() -> None:
    estructura = _estructura(total=6, colores=CUATRO_COLORES, un_tamano=False)

    resuelto = patron_resuelto(estructura, POCOS_GLOBOS, aplicado=True)

    assert resuelto["globos_por_instancia"] == 6
    assert [c["unidades_por_instancia"] for c in resuelto["conteo"]] == [3, 1, 1, 1]
    assert resuelto["avisos"] == [
        "La gráfica tiene 8 posiciones y la mezcla de varios tamaños da 6 globos por pieza:"
        " el conteo por color reparte esos 6 en la proporción de la gráfica, con al menos uno"
        " por color."
    ]


def test_participaciones_redondean_a_seis_y_el_ultimo_absorbe() -> None:
    patron = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1})
    estructura = _estructura(total=12)  # 3 filas, una por color

    conteo = conteo_por_instancia(estructura, validar_y_expandir(estructura, patron))

    assert participaciones(conteo) == [0.333333, 0.333333, 0.333334]


def test_patron_resuelto_multiplica_por_repeticiones_y_avisa_el_total() -> None:
    estructura = _estructura(total=39, repeticiones=2, acabados=(None, "perlado", None))

    resuelto = patron_resuelto(estructura, _patron(ESPIRAL), aplicado=True)

    assert resuelto["globos_por_instancia"] == 40
    assert resuelto["conteo"] == [
        {
            "material": 0,
            "color": "blanco",
            "acabado": None,
            "unidades_por_instancia": 20,
            "unidades_total": 40,
        },
        {
            "material": 1,
            "color": "negro",
            "acabado": "perlado",
            "unidades_por_instancia": 10,
            "unidades_total": 20,
        },
        {
            "material": 2,
            "color": "azul",
            "acabado": None,
            "unidades_por_instancia": 10,
            "unidades_total": 20,
        },
    ]
    assert resuelto["pasos"] == [{"desde": 1, "hasta": 10, "celdas": [0, 1, 0, 2], "extras": []}]
    assert resuelto["avisos"] == [
        "Con cuartetos completos cada pieza lleva 40 globos; las medidas daban 39."
    ]


def test_pasos_agrupan_filas_identicas_contando_los_extras() -> None:
    estructura = _estructura(total=24)
    patron = _patron({"modo": "flor", "fondo": 0, "petalo": 1, "centro": 2, "separacion": 1})

    pasos = patron_resuelto(estructura, patron, aplicado=True)["pasos"]

    # Las filas 2, 3 y 4 son de pétalos, pero la 3 lleva el centro: tres tramos.
    assert pasos == [
        {"desde": 1, "hasta": 1, "celdas": [0] * 4, "extras": []},
        {"desde": 2, "hasta": 2, "celdas": [1] * 4, "extras": []},
        {"desde": 3, "hasta": 3, "celdas": [1] * 4, "extras": [2]},
        {"desde": 4, "hasta": 4, "celdas": [1] * 4, "extras": []},
        {"desde": 5, "hasta": 5, "celdas": [0] * 4, "extras": []},
        {"desde": 6, "hasta": 6, "celdas": [1] * 4, "extras": []},
    ]


def test_pasos_de_anillos_largos_juntan_las_filas_iguales() -> None:
    estructura = _estructura(total=20)
    patron = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 2})

    pasos = patron_resuelto(estructura, patron, aplicado=True)["pasos"]

    assert [(paso["desde"], paso["hasta"], paso["celdas"]) for paso in pasos] == [
        (1, 2, [0] * 4),
        (3, 4, [1] * 4),
        (5, 5, [2] * 4),
    ]


# --- Presets (§6) -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("partes", "racimo"),
    [
        # 4p - 1 = 1, 0.2, -0.2 -> sobra 1 posición, al primero: {A:2, B:1, C:1}.
        ((0.5, 0.3, 0.2), [0, 1, 0, 2]),
        ((0.5, 0.5), [0, 1, 0, 1]),  # {A:2, B:2}
        ((0.25, 0.25, 0.25, 0.25), [0, 1, 2, 3]),  # {A, B, C, D}
        # 4p - 1 = 1.8, 0.2; sobran 2 -> 1.8 y 0.2 -> 1, 0 y la otra al 0.8: {A:3, B:1}.
        ((0.7, 0.3), [0, 1, 0, 0]),
        # 4p - 1 = 1.4, 0.6; sobran 2 -> 1, 0 y la otra al mayor resto 0.6: {A:2, B:2}.
        ((0.6, 0.4), [0, 1, 0, 1]),
    ],
)
def test_preset_de_racimos_de_un_tamano_es_una_espiral_intercalada(
    partes: tuple[float, ...], racimo: list[int]
) -> None:
    colores = ("rosado", "blanco", "dorado", "negro")[: len(partes)]
    estructura = _estructura(total=39, colores=colores, partes=partes)

    patron = sugerir_patron(estructura)

    assert patron == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": racimo, "trazo": "espiral"},
    }


def _semilla(estructura_id: str) -> int:
    return int(hashlib.sha256(estructura_id.encode("utf-8")).hexdigest()[:8], 16) % 2147483647


@pytest.mark.parametrize(
    "estructura",
    [
        _estructura(total=40, partes=(0.6, 0.3, 0.1), un_tamano=False),  # mezcla orgánica
        _estructura(**{**PARED_3X4, "total": 40}, partes=(0.6, 0.3, 0.1)),
        _estructura(tipo="centro_mesa", total=40, partes=(0.6, 0.3, 0.1)),
    ],
)
def test_preset_del_resto_es_confeti_por_participacion(estructura: EstructuraPatron) -> None:
    patron = sugerir_patron(estructura)

    assert patron["base"] == {
        "modo": "aleatorio",
        "pesos": [
            {"material": 0, "peso": 60},
            {"material": 1, "peso": 30},
            {"material": 2, "peso": 10},
        ],
        "semilla": _semilla(estructura.estructura_id),
    }


def test_preset_con_cinco_colores_es_confeti_y_ningun_peso_baja_de_uno() -> None:
    # 200 celdas: con peso 1 de 101 el quinto color aún recibe 2 globos.
    estructura = _estructura(
        total=200,
        colores=("rosado", "blanco", "dorado", "negro", "azul"),
        partes=(0.496, 0.3, 0.1, 0.1, 0.004),
    )

    patron = sugerir_patron(estructura)

    # 0.004 · 100 = 0.4 -> 0 -> nunca menos de 1.
    assert [peso["peso"] for peso in patron["base"]["pesos"]] == [50, 30, 10, 10, 1]


def test_sin_preset_para_una_pieza_sin_patron() -> None:
    with pytest.raises(PatronColorInvalido) as error:
        sugerir_patron(_estructura(tipo="kit"))

    assert error.value.motivo == "tipo_sin_patron"


# --- Pistas de la foto (§7) ------------------------------------------------------


def _pista(
    modo: str, colores: Sequence[str], confianza: float = 0.9, **extra: object
) -> dict[str, object]:
    return {
        "referencia_element_id": "ref-1",
        "modo": modo,
        "colores": list(colores),
        "confianza": confianza,
        **extra,
    }


def test_pista_con_colores_exactos_arma_el_patron_de_la_foto() -> None:
    patron = patron_desde_pista(
        _estructura(), _pista("espiral", ["Blanco", "negro", "blanco", "AZUL"])
    )

    assert patron == {
        "version": "patron-color.v1",
        "origen": "referencia",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
    }


def test_pista_por_tono_cercano_y_material_sobrante_como_acento() -> None:
    # crema -> beige: ΔE = 9.65 (blanco queda a 15.3). Sobra blanco: acento.
    estructura = _estructura(colores=("blanco", "beige", "negro"))

    patron = patron_desde_pista(estructura, _pista("anillos", ["crema", "negro"]))

    assert patron == {
        "version": "patron-color.v1",
        "origen": "referencia",
        "base": {"modo": "anillos", "secuencia": [1, 2], "largo": 1},
        "acentos": [{"material": 0, "cada": 3, "desde": 2, "posiciones": [0]}],
    }


def test_delta_e_de_la_pista_corta_en_25() -> None:
    # rosado -> lila: ΔE = sqrt(4.07² + 7.67² + 22.42²) = 24.04, entra.
    assert material_de_color(_estructura(colores=("lila", "blanco")).materiales, "rosado") == 0
    # verde queda lejos de rojo y de azul: la pista se descarta.
    lejos = _estructura(colores=("rojo", "azul"))
    assert material_de_color(lejos.materiales, "verde") is None
    assert patron_desde_pista(lejos, _pista("anillos", ["verde", "rojo"])) is None


@pytest.mark.parametrize(
    "pista",
    [
        _pista("espiral", ["blanco", "negro", "azul"], confianza=0.4),  # poca confianza
        _pista("flor", ["blanco", "negro"]),  # una flor necesita tres colores
        _pista(
            "degradado", ["blanco", "negro", "azul", "blanco", "negro", "azul", "blanco"]
        ),  # > 6 paradas
        _pista("damero", ["blanco", "negro", "azul"]),  # damero solo en pared
    ],
)
def test_pistas_que_no_sirven_caen_al_preset(pista: dict[str, object]) -> None:
    assert patron_desde_pista(_estructura(), pista) is None


def test_pista_con_racimo_propio_repite_los_colores_hasta_k() -> None:
    patron = patron_desde_pista(
        _estructura(total=15, colores=COLORES[:2]),
        _pista("espiral", ["negro", "blanco"], globos_por_racimo=3),
    )

    assert patron is not None
    assert patron["globos_por_racimo"] == 3
    assert patron["base"] == {"modo": "espiral", "racimo": [1, 0, 1], "trazo": "espiral"}


def test_pista_de_confeti_reparte_todos_los_colores_sin_acentos() -> None:
    # La foto nombró blanco y negro; el azul de la pieza entra como peso del
    # confeti (por su participación), nunca como acento: un acento encima de un
    # confeti bloqueaba su deslizador de colores.
    estructura = _estructura(partes=(0.6, 0.3, 0.1))

    patron = patron_desde_pista(estructura, _pista("aleatorio", ["blanco", "negro"]))

    assert patron == {
        "version": "patron-color.v1",
        "origen": "referencia",
        "base": {
            "modo": "aleatorio",
            "pesos": [
                {"material": 0, "peso": 60},
                {"material": 1, "peso": 30},
                {"material": 2, "peso": 10},
            ],
            "semilla": _semilla(estructura.estructura_id),
        },
    }


def test_pista_de_flor_con_cuatro_colores_deja_el_cuarto_como_acento() -> None:
    # La flor usa los tres primeros; el cuarto color nombrado no queda sin uso.
    estructura = _estructura(total=48, colores=("blanco", "rosado", "amarillo", "verde"))

    patron = patron_desde_pista(
        estructura, _pista("flor", ["blanco", "rosado", "amarillo", "verde"])
    )

    assert patron is not None
    assert patron["acentos"] == [{"material": 3, "cada": 3, "desde": 2, "posiciones": [0]}]


def test_pista_con_mas_de_cuatro_colores_sin_usar_se_descarta() -> None:
    estructura = _estructura(colores=("blanco", "negro", "azul", "rojo", "verde", "dorado"))

    assert patron_desde_pista(estructura, _pista("anillos", ["blanco"])) is None


# --- Textos (§8) -------------------------------------------------------------------


def _textos(estructura: EstructuraPatron, patron: Mapping[str, object]) -> dict[str, object]:
    return patron_resuelto(estructura, patron, aplicado=True)


def test_espiral_nombra_los_colores_en_ingles_en_el_orden_del_patron() -> None:
    estructura = _estructura(colores=("azul", "blanco", "dorado"), acabados=(None, "perlado", None))
    patron = _patron({"modo": "espiral", "racimo": [1, 0, 1, 2], "trazo": "espiral"})

    textos = _textos(estructura, patron)

    assert textos["nombre"] == "Espiral"
    # El LoRA nombra solo el color: el acabado ya va en su frase de materiales.
    assert textos["prompt_lora"] == (
        "wrapped in a spiral of white, blue and gold stripes winding from base to top"
    )
    assert "(pearl white, blue, pearl white, gold around each cluster)" in str(
        textos["prompt_gemini"]
    )
    assert "one eighth of a turn" in str(textos["prompt_gemini"])
    assert "blanco (2)" in str(textos["descripcion"])
    assert any("1/8 de vuelta" in paso for paso in textos["instrucciones"])


@pytest.mark.parametrize(
    ("estructura", "patron", "nombre", "lora"),
    [
        (
            _estructura(),
            _patron({**ESPIRAL, "trazo": "zigzag"}),
            "Zig-zag",
            "with zigzag chevron stripes of white, black and blue running from base to top",
        ),
        (
            _estructura(),
            _patron({**ESPIRAL, "trazo": "recto"}),
            "Franjas rectas",
            "composed of straight stripes of white, black and blue balloons running from base to top",
        ),
        (
            _estructura(total=12),
            _patron({"modo": "anillos", "secuencia": [2, 0, 1], "largo": 1}),
            "Anillos",
            "built with stacked bands of blue, white and black repeating from base to top",
        ),
        (
            _estructura(tipo="arco", total=20, estructura_id="EST_01_ARCO"),
            _patron(
                {
                    "modo": "bloques",
                    "bloques": [
                        {"material": 1, "peso": 1},
                        {"material": 0, "peso": 1},
                        {"material": 2, "peso": 1},
                    ],
                }
            ),
            "Bloques",
            "color-blocked in sections of black, then white, then blue from the left base over the top to the right base",
        ),
        (
            _estructura(total=12),
            _patron({"modo": "degradado", "paradas": [0, 1, 2], "transicion": "suave"}),
            "Degradé",
            "in an ombre gradient from white through black to blue from base to top",
        ),
        (
            _estructura(total=12),
            _patron({"modo": "degradado", "paradas": [0, 1, 2], "transicion": "escalonada"}),
            "Degradé",
            "in stepped ombre bands from white through black to blue from base to top",
        ),
        (
            _estructura(total=24),
            _patron({"modo": "flor", "fondo": 0, "petalo": 1, "centro": 2, "separacion": 1}),
            "Flores",
            "with daisy flowers of black petals and a blue center set between white clusters",
        ),
        (
            _estructura(**PARED_3X4, colores=COLORES[:2]),
            _patron({"modo": "damero", "secuencia": [0, 1], "tamano": 1}),
            "Damero",
            "in a checkerboard of white and black",
        ),
        (
            _estructura(**PARED_3X4),
            _patron({"modo": "damero", "secuencia": [0, 1, 2], "tamano": 1}),
            "Diagonal",
            "with diagonal rainbow bands of white, black and blue",
        ),
    ],
)
def test_cada_modo_tiene_su_nombre_y_su_fragmento_lora(
    estructura: EstructuraPatron, patron: dict[str, object], nombre: str, lora: str
) -> None:
    textos = _textos(estructura, patron)

    assert textos["nombre"] == nombre
    assert textos["prompt_lora"] == lora
    assert str(textos["prompt_gemini"]).startswith("COLOR PATTERN — ")
    # El caption LoRA no lleva números ni negaciones y es ASCII (ADR-0028 §8).
    assert not re.search(r"\d|\b(?:no|not|without|never)\b", lora)
    assert lora.isascii()


def test_confeti_deja_las_frases_del_prompt_vacias() -> None:
    patron = _patron(
        {
            "modo": "aleatorio",
            "semilla": 1,
            "pesos": [
                {"material": 0, "peso": 1},
                {"material": 1, "peso": 1},
                {"material": 2, "peso": 1},
            ],
        }
    )

    textos = _textos(_estructura(), patron)

    assert (textos["nombre"], textos["prompt_gemini"], textos["prompt_lora"]) == ("Confeti", "", "")


def test_acentos_y_pintados_se_suman_a_las_frases() -> None:
    estructura = _estructura(total=24, colores=("blanco", "negro", "dorado"))
    patron = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        acentos=[{"material": 2, "cada": 3, "desde": 2, "posiciones": [0]}],
        pintados=[{"fila": 0, "columna": 1, "material": 2}],
    )

    textos = _textos(estructura, patron)

    assert textos["prompt_lora"] == (
        "wrapped in a spiral of white and black stripes winding from base to top,"
        " with evenly spaced gold accent clusters"
    )
    gemini = str(textos["prompt_gemini"])
    assert "Every 3rd cluster (starting at cluster 2) carries gold." in gemini
    assert gemini.endswith("follow the per-cluster color map exactly.")
    assert (
        "Acento: cada 3 cuartetos, empezando en el cuarteto 2, lleva dorado (3) en la posición 1."
        in textos["instrucciones"]
    )


def test_mas_de_cuatro_colores_no_se_nombran_uno_a_uno() -> None:
    colores = ("blanco", "negro", "azul", "rojo", "verde")
    patron = _patron({"modo": "anillos", "secuencia": [0, 1, 2, 3, 4], "largo": 1})

    textos = _textos(_estructura(total=20, colores=colores), patron)

    assert "a repeating sequence of 5 colors" in str(textos["prompt_gemini"])
    assert (
        textos["prompt_lora"] == "built with stacked bands of multicolor repeating from base to top"
    )


@pytest.mark.parametrize(
    ("total", "filas", "porcentajes", "orden"),
    [
        # 5 filas: L' = 3 → bloques 2, 1 → filas 0 0 1 0 0. La fila de la clave es una
        # sola: el negro ocupa 1 de 5 filas (20 %), no 1 de 3, y desde cada pie van
        # 2 cuartetos de blanco (2 + 2 + 1 = 5 cuartetos, 4 globos negros).
        (
            20,
            [0, 0, 1, 0, 0],
            ("~80 %", "~20 %"),
            "Arma los bloques en orden, desde cada pie hasta la clave: 2 cuartetos de blanco (1);"
            " en la clave, 1 cuarteto de negro (2).",
        ),
        # 7 filas: L' = 4 → 2, 2 → 0 0 1 1 1 0 0: 4/7 ≈ 57 %, 3/7 ≈ 43 %; desde cada pie
        # 2 de blanco y 1 de negro, y el negro de la clave aparte (2·3 + 1 = 7).
        (
            28,
            [0, 0, 1, 1, 1, 0, 0],
            ("~57 %", "~43 %"),
            "Arma los bloques en orden, desde cada pie hasta la clave: 2 cuartetos de blanco (1),"
            " luego 1 cuarteto de negro (2); en la clave, 1 cuarteto de negro (2).",
        ),
        # 4 filas (par): no hay fila central compartida; 2 · 1 de cada color.
        (
            16,
            [0, 1, 1, 0],
            ("~50 %", "~50 %"),
            "Arma los bloques en orden, desde cada pie hasta la clave: 1 cuarteto de blanco (1),"
            " luego 1 cuarteto de negro (2).",
        ),
    ],
)
def test_bloques_en_espejo_cuentan_una_sola_vez_la_fila_de_la_clave(
    total: int, filas: list[int], porcentajes: tuple[str, str], orden: str
) -> None:
    arco = _estructura(tipo="arco", total=total, colores=COLORES[:2], estructura_id="EST_01_ARCO")
    patron = _patron(
        {"modo": "bloques", "bloques": [{"material": 0, "peso": 1}, {"material": 1, "peso": 1}]},
        simetria="espejo",
    )

    textos = _textos(arco, patron)

    assert [fila[0] for fila in _celdas(arco, patron)] == filas
    blanco, negro = porcentajes
    assert str(textos["descripcion"]).endswith(f"blanco (1) {blanco}, negro (2) {negro}.")
    gemini_blanco, gemini_negro = (p.replace(" ", "") for p in porcentajes)
    assert f"white ({gemini_blanco}), black ({gemini_negro})" in str(textos["prompt_gemini"])
    assert orden in textos["instrucciones"]


def test_bloques_en_espejo_con_la_clave_de_otro_color() -> None:
    # Arco de 20 (5 filas), tres bloques iguales: L' = 3 → 1, 1, 1 → filas 0 1 2 1 0.
    # El azul es solo la clave: 1 de 5 filas.
    arco = _estructura(tipo="arco", total=20, estructura_id="EST_01_ARCO")
    patron = _patron(
        {"modo": "bloques", "bloques": [{"material": i, "peso": 1} for i in range(3)]},
        simetria="espejo",
    )

    textos = _textos(arco, patron)

    assert str(textos["descripcion"]).endswith("blanco (1) ~40 %, negro (2) ~40 %, azul (3) ~20 %.")
    assert (
        "Arma los bloques en orden, desde cada pie hasta la clave: 1 cuarteto de blanco (1),"
        " luego 1 cuarteto de negro (2); en la clave, 1 cuarteto de azul (3)."
    ) in textos["instrucciones"]


@pytest.mark.parametrize(
    ("k", "unidad"),
    [
        (2, "pareja"),
        (3, "trío"),
        (4, "cuarteto"),
        (5, "quinteto"),
        (6, "sexteto"),
        (7, "racimo de 7"),
    ],
)
def test_las_unidades_de_armado_se_nombran_por_k(k: int, unidad: str) -> None:
    patron = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, globos_por_racimo=k)

    textos = _textos(_estructura(total=3 * k), patron)

    assert str(textos["descripcion"]).startswith(f"Cada {unidad} va de un solo color")


def test_instrucciones_siguen_el_curso_para_racimos_y_para_pared() -> None:
    racimos = _textos(_estructura(), _patron(ESPIRAL))["instrucciones"]
    pared = _textos(
        _estructura(**PARED_3X4, colores=COLORES[:2]),
        _patron({"modo": "damero", "secuencia": [0, 1], "tamano": 1}),
    )["instrucciones"]

    assert (
        racimos[0] == "Infla cada globo con el calibrador para que todos queden del mismo tamaño."
    )
    assert "une dos parejas para formar cada cuarteto" in racimos[1]
    assert any("fila por fila, de arriba abajo" in paso for paso in pared)


def test_color_desconocido_por_prefijo_y_sin_color() -> None:
    estructura = _estructura(colores=("azul rey", None, "terracota"))

    textos = _textos(estructura, _patron(ESPIRAL))

    # "azul rey" se nombra por su color base; lo que la tabla no conoce, y la
    # falta de color, son "catalog color": nunca la palabra en español.
    assert textos["prompt_lora"] == (
        "wrapped in a spiral of blue and catalog color stripes winding from base to top"
    )
    assert "(blue, catalog color, blue, catalog color around each cluster)" in str(
        textos["prompt_gemini"]
    )


def test_el_lora_nombra_el_color_sin_el_acabado_y_gemini_con_el() -> None:
    # El compilador LoRA pone prompt_lora detrás de su frase de materiales, que ya
    # dice los acabados con su propio vocabulario ("glossy", "fashion", "clear").
    estructura = _estructura(
        colores=("dorado", "blanco", "rosado"), acabados=("reflex", "fashion", "transparente")
    )

    textos = _textos(estructura, _patron(ESPIRAL))

    assert textos["prompt_lora"] == (
        "wrapped in a spiral of gold, white and pink stripes winding from base to top"
    )
    assert (
        "(high-shine chrome gold, matte white, high-shine chrome gold, translucent pink around"
        " each cluster)" in str(textos["prompt_gemini"])
    )


# Dorado cromado y dorado mate: el candado monocromo de Gemini.
DORADOS = (
    MaterialPatron(color="dorado", acabado="cromado", participacion=0.5),
    MaterialPatron(color="dorado", acabado="mate", participacion=0.5),
)
CON_BLANCO = (*DORADOS, MaterialPatron(color="blanco", acabado=None, participacion=0.5))


@pytest.mark.parametrize(
    ("estructura", "patron", "lora"),
    [
        (
            replace(_estructura(), materiales=CON_BLANCO),
            _patron(ESPIRAL),
            "wrapped in a spiral of gold and white stripes winding from base to top",
        ),
        # 3 filas de 4: los dos dorados entran en cada fila del degradé.
        (
            replace(_estructura(total=12), materiales=DORADOS),
            _patron({"modo": "degradado", "paradas": [0, 1], "transicion": "suave"}),
            "in an ombre gradient of gold from base to top",
        ),
        (
            replace(
                _estructura(tipo="arco", total=20, estructura_id="EST_01_ARCO"),
                materiales=CON_BLANCO,
            ),
            _patron(
                {
                    "modo": "bloques",
                    "bloques": [
                        {"material": 0, "peso": 1},
                        {"material": 1, "peso": 1},
                        {"material": 2, "peso": 1},
                    ],
                }
            ),
            "color-blocked in sections of gold, then white from the left base over the top to the right base",
        ),
        # El acento blanco ocupa las filas 1 y 3; la 2 queda en damero de los dos dorados.
        (
            replace(_estructura(**PARED_3X4), materiales=CON_BLANCO),
            _patron(
                {"modo": "damero", "secuencia": [0, 1], "tamano": 1},
                acentos=[{"material": 2, "cada": 2, "desde": 1}],
            ),
            "in a checkerboard of gold, with evenly spaced white accent clusters",
        ),
    ],
)
def test_dos_acabados_del_mismo_color_son_un_solo_nombre_en_el_lora(
    estructura: EstructuraPatron, patron: dict[str, object], lora: str
) -> None:
    assert _textos(estructura, patron)["prompt_lora"] == lora


# --- Estilos que ofrece el editor y su punto de partida ------------------------------

_LINEAL = ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"]


def test_modos_admitidos_de_una_columna_sin_espejo_ni_direcciones() -> None:
    assert modos_admitidos(_estructura()) == [
        {"modo": modo, "direcciones": ["longitudinal"], "espejo": False} for modo in _LINEAL
    ]


def test_modos_admitidos_de_un_arco_llevan_espejo_menos_el_confeti() -> None:
    admitidos = modos_admitidos(_estructura(tipo="arco"))

    assert [(item["modo"], item["espejo"]) for item in admitidos] == [
        (modo, modo != "aleatorio") for modo in _LINEAL
    ]


def test_modos_admitidos_de_una_pared_con_sus_direcciones() -> None:
    assert modos_admitidos(_estructura(**PARED_3X4)) == [
        {"modo": "anillos", "direcciones": ["longitudinal", "transversal"], "espejo": False},
        {"modo": "bloques", "direcciones": ["longitudinal", "transversal"], "espejo": False},
        {
            "modo": "degradado",
            "direcciones": ["longitudinal", "transversal", "diagonal"],
            "espejo": False,
        },
        {"modo": "aleatorio", "direcciones": ["longitudinal"], "espejo": False},
        {"modo": "damero", "direcciones": ["longitudinal"], "espejo": False},
    ]


def test_sin_modos_para_una_pieza_sin_patron() -> None:
    assert modos_admitidos(_estructura(tipo="kit")) == []
    assert modos_admitidos(_estructura(colores=("blanco",))) == []


def test_punto_de_partida_de_cada_estilo_sigue_la_participacion() -> None:
    # 40 globos = 10 cuartetos; el negro manda (0.5), luego azul (0.3), luego blanco (0.2).
    estructura = _estructura(total=40, partes=(0.2, 0.5, 0.3))

    assert sugerir_patron_modo(estructura, "anillos").patron["base"] == {
        "modo": "anillos",
        "secuencia": [1, 2, 0],
        "largo": 1,
    }
    assert sugerir_patron_modo(estructura, "bloques").patron["base"] == {
        "modo": "bloques",
        "bloques": [
            {"material": 1, "peso": 50},
            {"material": 2, "peso": 30},
            {"material": 0, "peso": 20},
        ],
    }
    assert sugerir_patron_modo(estructura, "degradado").patron["base"] == {
        "modo": "degradado",
        "paradas": [0, 1, 2],
        "transicion": "suave",
    }
    assert sugerir_patron_modo(estructura, "flor").patron["base"] == {
        "modo": "flor",
        "fondo": 1,
        "petalo": 2,
        "centro": 0,
        "separacion": 3,
    }
    assert sugerir_patron_modo(estructura, "espiral").patron["origen"] == "sugerido"


def test_flor_de_dos_colores_lleva_el_centro_del_fondo() -> None:
    patron = sugerir_patron_modo(
        _estructura(total=40, colores=("blanco", "rosado"), partes=(0.6, 0.4)), "flor"
    ).patron

    assert patron["base"] == {"modo": "flor", "fondo": 0, "petalo": 1, "centro": 0, "separacion": 3}
    assert "acentos" not in patron


def test_flor_de_cuatro_colores_deja_el_menor_como_acento() -> None:
    estructura = _estructura(
        total=48, colores=("blanco", "rosado", "amarillo", "verde"), partes=(0.4, 0.3, 0.2, 0.1)
    )

    patron = sugerir_patron_modo(estructura, "flor").patron

    assert patron["acentos"] == [{"material": 3, "cada": 3, "desde": 2, "posiciones": [0]}]


def test_espiral_de_cinco_colores_va_en_quintetos() -> None:
    patron = sugerir_patron_modo(
        _estructura(total=40, colores=("blanco", "negro", "azul", "rojo", "dorado")), "espiral"
    ).patron

    assert patron["globos_por_racimo"] == 5
    assert patron["base"] == {"modo": "espiral", "racimo": [0, 1, 2, 3, 4], "trazo": "espiral"}


def test_damero_de_pared_con_los_colores_de_mayor_a_menor() -> None:
    estructura = _estructura(**{**PARED_3X4, "total": 40}, partes=(0.2, 0.5, 0.3))

    assert sugerir_patron_modo(estructura, "damero").patron["base"] == {
        "modo": "damero",
        "secuencia": [1, 2, 0],
        "tamano": 1,
    }


def test_estilo_que_la_pieza_no_admite() -> None:
    with pytest.raises(PatronColorInvalido) as error:
        sugerir_patron_modo(_estructura(), "damero")

    assert error.value.motivo == "modo_no_permitido"


# --- Cambiar de estilo conserva lo que el decorador ya ajustó (``desde``) -------------

# 0.5 / 0.3 / 0.2: el orden por participación es [0, 1, 2] y los pesos 50 / 30 / 20.
PARTES_532 = (0.5, 0.3, 0.2)


def test_de_espiral_en_trio_a_anillos_conserva_el_trio_el_espejo_y_el_acento() -> None:
    # Arco de 18 globos en tríos: 6 filas × 3. Con espejo las filas se leen
    # 0, 1, 2, 2, 1, 0; anillos [0, 1, 2] de a una fila → 0, 1, 2, 2, 1, 0.
    # Acento azul (2) cada 2 desde 1 en la posición 1: filas con índice
    # reflejado par (0 y 2) → filas 0, 5 (quedan 0 · 2 · 0) y 2, 3 (ya azules).
    estructura = _estructura(tipo="arco", total=18, partes=PARTES_532)
    acento = {"material": 2, "cada": 2, "desde": 1, "posiciones": [1]}
    desde = _patron(
        {"modo": "espiral", "racimo": [0, 1, 2], "trazo": "espiral"},
        globos_por_racimo=3,
        simetria="espejo",
        acentos=[acento],
    )

    partida = sugerir_patron_modo(estructura, "anillos", desde)

    assert partida.patron == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "globos_por_racimo": 3,
        "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
        "simetria": "espejo",
        "acentos": [acento],
    }
    assert partida.avisos == ()
    assert _celdas(estructura, partida.patron) == [
        [0, 2, 0],
        [1, 1, 1],
        [2, 2, 2],
        [2, 2, 2],
        [1, 1, 1],
        [0, 2, 0],
    ]
    # Blanco 2 + 2, negro 3 + 3, azul 1 + 3 + 3 + 1.
    assert _conteo(estructura, partida.patron) == [4, 6, 8]


def test_a_espiral_el_racimo_toma_el_tamano_del_borrador() -> None:
    desde = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, globos_por_racimo=3)

    # Tres colores en tríos: 3·p − 1 = 0.5, −0.1, −0.4 → no sobra ninguna posición: [0, 1, 2].
    tres = sugerir_patron_modo(_estructura(total=18, partes=PARTES_532), "espiral", desde)
    # Cuatro colores en tríos: van los tres principales y el cuarto como acento
    # (cada 3 desde 2 en la posición 0, como un color que la base no usa).
    cuatro = sugerir_patron_modo(
        _estructura(
            total=30, colores=("blanco", "negro", "azul", "rojo"), partes=(0.4, 0.3, 0.2, 0.1)
        ),
        "espiral",
        desde,
    )

    assert tres.patron["globos_por_racimo"] == 3
    assert tres.patron["base"] == {"modo": "espiral", "racimo": [0, 1, 2], "trazo": "espiral"}
    assert (cuatro.patron["base"], cuatro.patron["acentos"]) == (
        {"modo": "espiral", "racimo": [0, 1, 2], "trazo": "espiral"},
        [{"material": 3, "cada": 3, "desde": 2, "posiciones": [0]}],
    )
    assert tres.avisos == cuatro.avisos == ()


def test_la_direccion_de_la_pared_pasa_si_el_estilo_nuevo_la_ofrece() -> None:
    estructura = _estructura(**PARED_3X4, partes=PARTES_532)
    de_lado = _patron(
        {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, direccion="transversal"
    )
    diagonal = _patron(
        {"modo": "degradado", "paradas": [0, 1, 2], "transicion": "suave"}, direccion="diagonal"
    )

    bloques = sugerir_patron_modo(estructura, "bloques", de_lado)
    anillos = sugerir_patron_modo(estructura, "anillos", diagonal)

    # Bloques de lado a lado sobre 4 columnas: 4 · (50, 30, 20) % = 2, 1.2, 0.8
    # → 2, 1, 1 por mayor resto; cada fila es 0 · 0 · 1 · 2.
    assert bloques.patron["direccion"] == "transversal"
    assert _celdas(estructura, bloques.patron) == [[0, 0, 1, 2]] * 3
    # Los anillos no van en diagonal: la dirección no pasa y no hay nada que avisar.
    assert "direccion" not in anillos.patron
    assert (bloques.avisos, anillos.avisos) == ((), ())


def test_el_espejo_no_pasa_a_un_confeti_que_no_lo_lleva() -> None:
    desde = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, simetria="espejo")

    partida = sugerir_patron_modo(
        _estructura(tipo="arco", total=16, partes=PARTES_532), "aleatorio", desde
    )

    assert "simetria" not in partida.patron
    assert partida.avisos == ()


def test_lo_que_el_estilo_ofrece_pero_no_se_arma_se_quita_con_aviso() -> None:
    # Flores en racimos de 8 con 30 globos: round(3.75) = 4 filas y el primer
    # centro va en la fila 5 → el azul (centro) sin globos. En cuartetos:
    # round(7.5) = 8 filas y sí. El acento en la posición 8 no cabe en un cuarteto.
    columna = _estructura(total=30, partes=PARTES_532)
    racimos_de_8 = _patron(
        {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
        globos_por_racimo=8,
        acentos=[{"material": 1, "cada": 2, "desde": 1, "posiciones": [7]}],
    )
    # Bloques en espejo sobre 4 filas: ceil(4 / 2) = 2 líneas → 1, 1, 0: el azul
    # sin globos. Sin espejo: 4 líneas → 2, 1, 1.
    arco = _estructura(tipo="arco", total=16, partes=PARTES_532)
    en_espejo = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, simetria="espejo")
    # Un acento blanco en todas las posiciones de las filas 2 y 5 (cada 3 desde 2)
    # tapa las dos filas negras de unos anillos 0, 1, 2, 0, 1, 2.
    tapa_negro = _patron(
        {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
        acentos=[{"material": 0, "cada": 3, "desde": 2}],
    )

    flores = sugerir_patron_modo(columna, "flor", racimos_de_8)
    bloques = sugerir_patron_modo(arco, "bloques", en_espejo)
    anillos = sugerir_patron_modo(_estructura(total=24, partes=PARTES_532), "anillos", tapa_negro)

    assert flores.patron == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "flor", "fondo": 0, "petalo": 1, "centro": 2, "separacion": 3},
    }
    assert flores.avisos == (
        "El estilo «flores» no se arma en racimos de 8 en esta pieza: queda en cuartetos.",
        "El acento de negro (2) no cabe en el estilo «flores»: se quitó.",
    )
    assert "simetria" not in bloques.patron
    assert bloques.avisos == (
        "El estilo «bloques» no se arma en espejo en esta pieza: queda sin espejo.",
    )
    assert "acentos" not in anillos.patron
    assert anillos.avisos == ("El acento de blanco (1) no cabe en el estilo «anillos»: se quitó.",)


def test_sin_borrador_el_punto_de_partida_no_cambia() -> None:
    estructura = _estructura(total=40, partes=(0.2, 0.5, 0.3))

    for modo in ("espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"):
        assert sugerir_patron_modo(estructura, modo, None) == sugerir_patron_modo(estructura, modo)
    assert sugerir_patron_modo(estructura, "anillos").avisos == ()


# --- Validación del patrón resuelto (plan-resuelto.v1) --------------------------------


def _errores_de_contrato(patron: Mapping[str, object]) -> list[str]:
    from jsonschema import Draft7Validator

    from app.generated_models import contract_schema

    esquema = contract_schema("PlanResuelto")["properties"]["patrones_color"]["items"]
    return [error.message for error in Draft7Validator(esquema).iter_errors(patron)]


def test_para_validar_da_el_mismo_veredicto_con_una_celda_por_valor() -> None:
    # Una pared de confeti: miles de celdas con tres valores. La copia para
    # validar deja cada fila con sus valores distintos y conserva el resto.
    pared = _estructura(tipo="pared", total=600, ancho=6.0, alto=3.0)
    patron = _patron(
        {
            "modo": "aleatorio",
            "semilla": 7,
            "pesos": [
                {"material": 0, "peso": 5},
                {"material": 1, "peso": 3},
                {"material": 2, "peso": 2},
            ],
        }
    )
    resuelto = patron_resuelto(pared, patron, aplicado=True)

    copia = para_validar(resuelto)

    celdas = resuelto["celdas"]
    # T = 600 en 6 × 3 m: round(sqrt(600 · 2)) = 35 columnas y round(600 / 35) = 17 filas.
    assert isinstance(celdas, list) and (len(celdas), len(celdas[0])) == (17, 35)
    assert [sorted(set(fila)) for fila in copia["celdas"]] == [sorted(set(fila)) for fila in celdas]
    assert all(len(fila) <= 3 for fila in copia["celdas"])
    assert len(copia["pasos"]) == len(resuelto["pasos"])
    assert {k: v for k, v in copia.items() if k not in ("celdas", "pasos")} == {
        k: v for k, v in resuelto.items() if k not in ("celdas", "pasos")
    }
    assert _errores_de_contrato(copia) == _errores_de_contrato(resuelto) == []


@pytest.mark.parametrize("malo", [-1, True, 1.5, "2", None])
def test_para_validar_no_deja_pasar_una_celda_fuera_del_contrato(malo: object) -> None:
    resuelto = patron_resuelto(_estructura(), _patron(ESPIRAL), aplicado=True)
    celdas = [list(fila) for fila in resuelto["celdas"]]
    celdas[2][1] = malo
    pasos = [dict(paso) for paso in resuelto["pasos"]]
    pasos[0]["celdas"] = [*pasos[0]["celdas"], malo]
    for roto in ({**resuelto, "celdas": celdas}, {**resuelto, "pasos": pasos}):
        assert _errores_de_contrato(roto)
        assert _errores_de_contrato(para_validar(roto))
