"""Reglas del armado de guirnaldas por partes (ADR-0032), sin resolver un plan.

La guirnalda de prueba compra por instancia lo que da una guirnalda de 2,5 m,
``media``, ``organica_fina`` en rosado y blanco (48 globos):

| tamaño | rosado | blanco |
|---|---:|---:|
| 5"  | 6  | 4  |
| 9"  | 5  | 4  |
| 12" | 16 | 10 |
| 18" | 1  | 1  |
| 24" | 1  | 0  |
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

import pytest

from app.armado_guirnalda import (
    SOPORTES_CON_CAIDA,
    ArmadoInvalido,
    EstructuraGuirnalda,
    GloboGuirnalda,
    OtraEstructura,
    armado_resuelto,
    geometria_de_lectura,
    opciones_admitidas,
    sugerir_armado,
    validar,
)
from app.patron_color import MaterialPatron

COLORES = ("rosado", "blanco", "dorado")
ORGANICA_FINA = [
    (0, 5, 6),
    (1, 5, 4),
    (0, 9, 5),
    (1, 9, 4),
    (0, 12, 16),
    (1, 12, 10),
    (0, 18, 1),
    (1, 18, 1),
    (0, 24, 1),
]
CLASICA = [(0, 12, 26), (1, 12, 22)]


def _estructura(
    globos: Sequence[tuple[int, float, int]] = ORGANICA_FINA,
    *,
    ubicacion: str = "fondo_pared",
    densidad: str = "media",
    mezcla: str = "organica_fina",
    repeticiones: int = 1,
    largo: float = 2.5,
    cuerda: float | None = None,
    otras: Sequence[OtraEstructura] = (),
    filas: tuple[tuple[int, ...], ...] | None = None,
    es_guirnalda: bool = True,
) -> EstructuraGuirnalda:
    return EstructuraGuirnalda(
        estructura_id="EST_01_GUIRNALDA",
        nombre="Guirnalda",
        es_guirnalda=es_guirnalda,
        ubicacion=ubicacion,
        densidad=densidad,
        mezcla=mezcla,
        repeticiones=repeticiones,
        largo_m=largo,
        largo_cuerda_m=cuerda if cuerda is not None else largo,
        materiales=tuple(MaterialPatron(color, None, 0.5) for color in COLORES[:2]),
        globos=tuple(
            GloboGuirnalda(
                material=material,
                tamano_pulg=float(tamano),
                por_instancia=cantidad,
                color=COLORES[material],
                acabado=None,
            )
            for material, tamano, cantidad in globos
        ),
        otras=tuple(otras),
        filas_patron=filas,
    )


def _armado(**extra: object) -> dict[str, object]:
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": None,
        "remates": [],
        **extra,
    }


def _motivo(estructura: EstructuraGuirnalda, armado: Mapping[str, object]) -> str:
    with pytest.raises(ArmadoInvalido) as error:
        validar(estructura, armado)
    return error.value.motivo


def _usados_por_codigo(resuelto: Mapping[str, object]) -> dict[int, int]:
    usados: dict[int, int] = {}
    for racimo in cast(list[dict[str, object]], resuelto["racimos"]):
        for codigo in cast(list[int], racimo["codigos"]):
            usados[codigo] = usados.get(codigo, 0) + 1
    relleno = cast(dict[str, object] | None, resuelto["relleno"])
    pares = [
        *(cast(list[dict[str, int]], relleno["codigos"]) if relleno else []),
        *cast(list[dict[str, int]], resuelto["remates"]),
        *cast(list[dict[str, int]], resuelto["sueltos"]),
    ]
    for par in pares:
        usados[par["codigo"]] = usados.get(par["codigo"], 0) + par["cantidad"]
    return usados


# --- Receta ------------------------------------------------------------------------------


def test_la_receta_es_cuarteto_de_12_con_relleno_de_5_y_remates_repartidos() -> None:
    armado = sugerir_armado(_estructura())
    assert armado == {
        "version": "armado-guirnalda.v1",
        "origen": "sugerido",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        # Los 10 globos de 5" de la compra: 10 / 48, con el color que más lleva.
        "relleno": {"material": 0, "proporcion": 0.2083},
        "remates": [
            {"material": 0, "posicion": "cada_n"},
            {"material": 1, "posicion": "cada_n"},
        ],
    }


@pytest.mark.parametrize(
    ("ubicacion", "soporte"),
    [
        ("fondo_pared", "pared"),
        ("piso_frontal", "piso"),
        ("recorrido_suelo", "piso"),
        ("sobre_mesa_principal", "mesa"),
        ("lateral_izquierdo", "pared"),
    ],
)
def test_el_soporte_de_la_receta_sale_de_la_ubicacion(ubicacion: str, soporte: str) -> None:
    armado = sugerir_armado(_estructura(ubicacion=ubicacion))
    assert armado is not None and armado["soporte"] == soporte


@pytest.mark.parametrize(
    ("densidad", "unidad"), [("sencilla", "trio"), ("media", "cuarteto"), ("lujosa", "quinteto")]
)
def test_la_unidad_de_la_receta_sale_de_la_densidad(densidad: str, unidad: str) -> None:
    armado = sugerir_armado(_estructura(densidad=densidad))
    assert armado is not None
    assert cast(dict[str, object], armado["racimo"])["unidad"] == unidad


def test_sin_mezcla_organica_no_hay_relleno_ni_remates() -> None:
    armado = sugerir_armado(_estructura(CLASICA, mezcla="clasica"))
    assert armado is not None and armado["relleno"] is None and armado["remates"] == []
    gruesa = [(0, 9, 12), (0, 12, 22), (0, 18, 9), (0, 24, 5)]
    armado = sugerir_armado(_estructura(gruesa, mezcla="organica_gruesa"))
    assert armado is not None and armado["relleno"] is None, 'sin globos de 5" no hay relleno'
    assert armado["remates"] == [{"material": 0, "posicion": "cada_n"}]


def test_sin_globos_de_9_a_12_no_hay_receta() -> None:
    assert sugerir_armado(_estructura([(0, 18, 8), (1, 24, 6)], mezcla="solo_grandes")) is None
    assert sugerir_armado(_estructura(es_guirnalda=False)) is None


def test_con_patron_la_unidad_es_la_del_patron() -> None:
    filas = tuple((0, 1, 0, 1) for _ in range(12))
    armado = sugerir_armado(
        _estructura(CLASICA, mezcla="clasica", densidad="sencilla", filas=filas)
    )
    assert armado is not None
    assert cast(dict[str, object], armado["racimo"])["unidad"] == "cuarteto"
    parejas = tuple((0, 1) for _ in range(24))
    assert sugerir_armado(_estructura(CLASICA, mezcla="clasica", filas=parejas)) is None


# --- Reglas cruzadas -----------------------------------------------------------------------

ARCO = OtraEstructura("EST_02_ARCO", "arco", "Arco")
OTRA_GUIRNALDA = OtraEstructura("EST_03_GUIRNALDA", "guirnalda", "Otra guirnalda")


@pytest.mark.parametrize(
    ("armado", "motivo"),
    [
        (_armado(soporte="sobre_estructura"), "anfitriona_faltante"),
        (
            _armado(soporte="sobre_estructura", estructura_id="EST_09_NADA"),
            "anfitriona_inexistente",
        ),
        (
            _armado(soporte="sobre_estructura", estructura_id="EST_01_GUIRNALDA"),
            "anfitriona_inexistente",
        ),
        (
            _armado(soporte="sobre_estructura", estructura_id="EST_03_GUIRNALDA"),
            "anfitriona_es_guirnalda",
        ),
        (_armado(estructura_id="EST_02_ARCO"), "anfitriona_sin_sobre_estructura"),
        (_armado(soporte="colgada"), "colgada_sin_anclajes"),
        (_armado(caida_m=0.4), "caida_sin_forma_colgante"),
        (_armado(soporte="piso", forma="arco_caido"), "forma_no_admitida"),
        (_armado(soporte="mesa", forma="u_invertida"), "forma_no_admitida"),
        (_armado(relleno={"material": 5, "proporcion": 0.2}), "material_fuera_de_rango"),
        (_armado(remates=[{"material": 7, "posicion": "centro"}]), "material_fuera_de_rango"),
        (_armado(relleno={"material": 0, "proporcion": 0.5}), "relleno_mayor_que_la_mezcla"),
        (_armado(relleno={"material": 0, "proporcion": 0.0}), "relleno_vacio"),
        (
            _armado(
                remates=[
                    {"material": 1, "posicion": "extremo_izq"},
                    {"material": 1, "posicion": "extremo_der"},
                ]
            ),
            "remate_sin_globo_grande",
        ),
        (_armado(racimo={"unidad": "quinteto", "tamano_pulg_base": 11}, extra=1), "forma_invalida"),
    ],
)
def test_reglas_cruzadas(armado: Mapping[str, object], motivo: str) -> None:
    assert _motivo(_estructura(otras=(ARCO, OTRA_GUIRNALDA)), armado) == motivo


def test_la_anfitriona_existe_y_no_es_guirnalda() -> None:
    validar(
        _estructura(otras=(ARCO,)), _armado(soporte="sobre_estructura", estructura_id="EST_02_ARCO")
    )


def test_colgada_con_anclajes_y_caida_vale() -> None:
    validar(
        _estructura(),
        _armado(soporte="colgada", forma="arco_caido", caida_m=0.4, puntos_de_anclaje=2),
    )


def test_relleno_y_remates_exigen_globos_de_su_tamano() -> None:
    clasica = _estructura(CLASICA, mezcla="clasica")
    assert (
        _motivo(clasica, _armado(relleno={"material": 0, "proporcion": 0.1}))
        == "relleno_sin_globos_chicos"
    )
    assert (
        _motivo(clasica, _armado(remates=[{"material": 0, "posicion": "centro"}]))
        == "remate_sin_globo_grande"
    )
    assert (
        _motivo(clasica, _armado(racimo={"unidad": "cuarteto", "tamano_pulg_base": 9}))
        == "racimo_sin_globos_base"
    )


def test_el_racimo_debe_ser_el_del_patron() -> None:
    filas = tuple((0, 1, 0, 1) for _ in range(12))
    estructura = _estructura(CLASICA, mezcla="clasica", filas=filas)
    assert (
        _motivo(estructura, _armado(racimo={"unidad": "trio", "tamano_pulg_base": 12}))
        == "racimo_distinto_del_patron"
    )


def test_solo_una_guirnalda_se_arma() -> None:
    assert _motivo(_estructura(es_guirnalda=False), _armado()) == "no_es_guirnalda"


# --- Resuelto ------------------------------------------------------------------------------


def test_el_armado_usa_exactamente_cada_globo_comprado() -> None:
    estructura = _estructura(repeticiones=2)
    resuelto = armado_resuelto(estructura, cast(dict[str, object], sugerir_armado(estructura)))
    leyenda = cast(list[dict[str, object]], resuelto["leyenda"])
    por_codigo = {cast(int, e["codigo"]): cast(int, e["unidades_por_instancia"]) for e in leyenda}
    assert _usados_por_codigo(resuelto) == por_codigo
    assert sum(por_codigo.values()) == resuelto["globos_por_instancia"] == 48
    assert all(e["unidades_total"] == 2 * cast(int, e["unidades_por_instancia"]) for e in leyenda)
    # 48 - 10 de relleno - 3 grandes = 35 → 8 cuartetos y 3 sueltos.
    racimos = cast(list[dict[str, object]], resuelto["racimos"])
    assert [r["numero"] for r in racimos] == list(range(1, 9))
    assert all(len(cast(list[int], r["codigos"])) == 4 for r in racimos)
    assert cast(dict[str, object], resuelto["relleno"])["total"] == 10
    assert sum(s["cantidad"] for s in cast(list[dict[str, int]], resuelto["sueltos"])) == 3
    assert any("Sobran 3 globos" in aviso for aviso in cast(list[str], resuelto["avisos"]))


def test_la_leyenda_tiene_un_codigo_por_material_y_tamano() -> None:
    estructura = _estructura()
    resuelto = armado_resuelto(estructura, _armado())
    leyenda = cast(list[dict[str, object]], resuelto["leyenda"])
    assert [(e["codigo"], e["material"], e["tamano_pulg"]) for e in leyenda] == [
        (1, 0, 5.0),
        (2, 0, 9.0),
        (3, 0, 12.0),
        (4, 0, 18.0),
        (5, 0, 24.0),
        (6, 1, 5.0),
        (7, 1, 9.0),
        (8, 1, 12.0),
        (9, 1, 18.0),
    ]
    assert leyenda[2]["descripcion"] == '12" rosado'


def test_los_remates_van_donde_dice_su_posicion() -> None:
    armado = _armado(
        remates=[
            {"material": 0, "posicion": "extremo_izq"},
            {"material": 1, "posicion": "extremo_der"},
            {"material": 0, "posicion": "cada_n"},
        ]
    )
    resuelto = armado_resuelto(_estructura(), armado)
    remates = cast(list[dict[str, object]], resuelto["remates"])
    racimos = len(cast(list[object], resuelto["racimos"]))
    assert [(r["posicion"], r["codigo"], r["racimos"]) for r in remates] == [
        ("extremo_izq", 5, [1]),  # el más grande primero: 24" rosado
        ("extremo_der", 9, [racimos]),
        ("cada_n", 4, [(racimos // 2) + 1]),  # el 18" rosado que queda, al medio
    ]


def test_el_patron_decide_el_color_de_cada_racimo() -> None:
    filas = tuple((0, 1, 0, 1) if fila % 2 == 0 else (1, 1, 1, 0) for fila in range(12))
    # La compra sigue a la rejilla (participacion sincronizada): 18 rosados y 30 blancos.
    estructura = _estructura([(0, 12, 18), (1, 12, 30)], mezcla="clasica", filas=filas)
    resuelto = armado_resuelto(estructura, _armado())
    codigos = [
        cast(list[int], r["codigos"]) for r in cast(list[dict[str, object]], resuelto["racimos"])
    ]
    # Código 1 = rosado 12", código 2 = blanco 12"; racimo i = fila i de la rejilla.
    assert codigos == [[c + 1 for c in fila] for fila in filas]
    assert resuelto["sueltos"] == [] and resuelto["avisos"] == []


@pytest.mark.parametrize(
    ("armado", "insumos"),
    [
        (_armado(), {"tira": 3.0, "ganchos": 6, "tijeras": 1, "bomba": 1}),
        (
            _armado(soporte="colgada", forma="arco_caido", caida_m=0.4, puntos_de_anclaje=3),
            {"tira": 3.0, "cuerda": 7.0, "ganchos": 3, "tijeras": 1, "bomba": 1},
        ),
        (_armado(soporte="piso"), {"tira": 3.0, "pesa": 3, "tijeras": 1, "bomba": 1}),
        (_armado(soporte="mesa"), {"tira": 3.0, "pegante": 2, "tijeras": 1, "bomba": 1}),
        (
            _armado(soporte="sobre_estructura", estructura_id="EST_02_ARCO"),
            {"tira": 3.0, "amarres": 6, "tijeras": 1, "bomba": 1},
        ),
    ],
)
def test_los_insumos_dependen_del_soporte(
    armado: Mapping[str, object], insumos: Mapping[str, float]
) -> None:
    # Clásica: sin relleno, remates ni sueltos (48 = 12 cuartetos), así que sin pegante salvo en mesa.
    resuelto = armado_resuelto(_estructura(CLASICA, mezcla="clasica", otras=(ARCO,)), armado)
    lista = cast(list[dict[str, object]], resuelto["insumos"])
    assert {i["insumo"]: i["cantidad"] for i in lista} == insumos
    assert all(isinstance(i["estimado"], bool) for i in lista)


def test_la_duracion_es_estimada_y_en_cuartos_de_hora() -> None:
    duracion = cast(
        dict[str, object],
        armado_resuelto(_estructura(repeticiones=3), _armado())["duracion_estimada"],
    )
    assert duracion["estimado"] is True
    minimo, maximo = cast(float, duracion["horas_min"]), cast(float, duracion["horas_max"])
    assert 0 < minimo <= maximo and (minimo * 4).is_integer() and (maximo * 4).is_integer()


def test_las_frases_del_prompt() -> None:
    estructura = _estructura(otras=(ARCO,))
    resuelto = armado_resuelto(estructura, cast(dict[str, object], sugerir_armado(estructura)))
    gemini, lora = str(resuelto["prompt_gemini"]), str(resuelto["prompt_lora"])
    assert gemini.startswith("GARLAND ASSEMBLY — an organic balloon garland mounted flat")
    assert "8 four-balloon clusters" in gemini and "filler balloons" in gemini
    assert lora.isascii() and not any(c.isdigit() for c in lora)
    # E5: un modificador que el caption pone detrás de "an organic balloon garland"
    # y sus materiales; nombrar otra guirnalda duplicaba el sustantivo. Los
    # colores de los racimos ya van en la cláusula; los del relleno y los
    # remates dicen cuál es chico y cuál grande.
    assert lora == (
        "mounted flat against the wall in clusters of four with small pink and white filler"
        " balloons and large pink and white accent balloons"
    )
    assert "garland" not in lora
    colgada = armado_resuelto(
        estructura,
        _armado(soporte="colgada", forma="arco_caido", caida_m=0.4, puntos_de_anclaje=3),
    )
    assert "2 swags about 0.4 m deep" in str(colgada["prompt_gemini"])
    assert (
        colgada["prompt_lora"]
        == "draped across three anchor points dipping in swags in clusters of four"
    )
    abrazada = armado_resuelto(
        estructura, _armado(soporte="sobre_estructura", estructura_id="EST_02_ARCO")
    )
    assert abrazada["prompt_lora"] == "wrapped around the balloon arch in clusters of four"
    assert abrazada["nombre"] == "Guirnalda sobre Arco"


@pytest.mark.parametrize(
    ("armado", "soporte_lora"),
    [
        (_armado(), "mounted flat against the wall in clusters of four"),
        (
            _armado(soporte="colgada", forma="u_invertida", caida_m=0.6, puntos_de_anclaje=2),
            "draped between two anchor points shaped as an inverted U in clusters of four",
        ),
        (
            _armado(soporte="colgada", forma="recta", puntos_de_anclaje=6),
            "draped across six anchor points in clusters of four",
        ),
        (_armado(soporte="piso"), "resting on the floor along the front in clusters of four"),
        (
            _armado(soporte="mesa", forma="ondulada"),
            "running along the table edge in a soft wave in clusters of four",
        ),
        (
            _armado(forma="curva"),
            "mounted flat against the wall in a gentle curve in clusters of four",
        ),
        (
            _armado(soporte="sobre_estructura", estructura_id="EST_02_ARCO", forma="ondulada"),
            "wrapped around the balloon arch in clusters of four",
        ),
    ],
)
def test_la_frase_lora_lleva_soporte_y_forma(
    armado: Mapping[str, object], soporte_lora: str
) -> None:
    # Clásica: sin relleno ni remates, la frase es solo soporte, forma y unidad.
    resuelto = armado_resuelto(_estructura(CLASICA, mezcla="clasica", otras=(ARCO,)), armado)
    lora = str(resuelto["prompt_lora"])
    assert lora == soporte_lora
    assert lora.isascii() and not any(c.isdigit() for c in lora)


def test_una_forma_que_cuelga_sin_caida_avisa() -> None:
    resuelto = armado_resuelto(_estructura(), _armado(forma="u_invertida"))
    assert any("Sin caída" in aviso for aviso in cast(list[str], resuelto["avisos"]))


# --- Punto de entrada para la lectura de la foto (E4) ---------------------------------------


def test_una_lectura_confiable_manda_sobre_la_receta() -> None:
    lectura = {
        "soporte": "colgada",
        "forma": "arco_caido",
        "puntos_de_anclaje": 2,
        "unidad_racimo": "trio",
        "relleno": {"color": "blanco", "proporcion": 0.15},
        "remates": [{"color": "rosado", "posicion": "extremo_izq"}],
        "confianza": 0.8,
    }
    armado = sugerir_armado(_estructura(), lectura)
    assert armado is not None
    assert (armado["origen"], armado["soporte"], armado["forma"]) == (
        "referencia",
        "colgada",
        "arco_caido",
    )
    assert armado["relleno"] == {"material": 1, "proporcion": 0.15}
    assert armado["remates"] == [{"material": 0, "posicion": "extremo_izq"}]
    assert cast(dict[str, object], armado["racimo"])["unidad"] == "trio"


def test_una_lectura_dudosa_cae_en_la_receta() -> None:
    receta = sugerir_armado(_estructura())
    dudosa = {"soporte": "piso", "confianza": 0.3}
    assert sugerir_armado(_estructura(), dudosa) == receta


def _lectura(**extra: object) -> dict[str, object]:
    return {
        "soporte": "pared",
        "forma": "recta",
        "racimos_visibles": 9,
        "colores_por_racimo": ["rosado", "blanco"],
        "relleno": None,
        "remates": [],
        "confianza": 0.9,
        **extra,
    }


def test_sin_caida_leida_no_hay_caida_y_una_forma_que_cuelga_necesita_de_donde() -> None:
    en_piso = sugerir_armado(_estructura(), _lectura(soporte="piso", forma="arco_caido"))
    assert en_piso is not None
    assert (en_piso["origen"], en_piso["soporte"], en_piso["forma"]) == (
        "referencia",
        "piso",
        "recta",
    )
    colgada = sugerir_armado(_estructura(), _lectura(soporte="colgada", forma="u_invertida"))
    assert colgada is not None and colgada["puntos_de_anclaje"] == 2, "colgada cuelga de dos"
    assert "caida_m" not in colgada, "sin caida_relativa no se inventa una caída"


def test_la_anfitriona_se_busca_por_el_elemento_de_la_foto() -> None:
    arco = OtraEstructura("EST_02_ARCO", "arco", "Arco", referencia_element_id="REF_01_E02")
    estructura = _estructura(otras=(arco,))
    sobre = sugerir_armado(
        estructura, _lectura(soporte="sobre_estructura", anfitriona_element_id="REF_01_E02")
    )
    assert sobre is not None
    assert (sobre["soporte"], sobre["estructura_id"]) == ("sobre_estructura", "EST_02_ARCO")
    sin_anfitriona = sugerir_armado(
        estructura, _lectura(soporte="sobre_estructura", anfitriona_element_id="REF_01_E09")
    )
    assert sin_anfitriona is not None and sin_anfitriona["soporte"] == "pared"
    assert "estructura_id" not in sin_anfitriona


def test_lo_que_no_se_compra_de_la_lectura_cae_en_la_receta_sin_perder_la_forma() -> None:
    receta = cast(dict[str, object], sugerir_armado(_estructura()))
    lectura = _lectura(
        soporte="mesa",
        unidad_racimo="trio",
        relleno={"color": "blanco", "proporcion": 0.5},  # más globos chicos de los que se compran
        remates=[{"clase": "metalizado", "color": "dorado", "posicion": "centro"}],
    )
    armado = sugerir_armado(_estructura(), lectura)
    assert armado is not None
    assert (armado["origen"], armado["soporte"]) == ("referencia", "mesa")
    assert cast(dict[str, object], armado["racimo"])["unidad"] == "trio"
    assert (armado["relleno"], armado["remates"]) == (receta["relleno"], receta["remates"])
    sin_relleno = sugerir_armado(_estructura(), _lectura())
    assert sin_relleno is not None and sin_relleno["relleno"] is None
    assert sin_relleno["remates"] == [], (
        "la foto no muestra remates: los grandes van en los racimos"
    )


def test_opciones_que_admite_la_pieza() -> None:
    opciones = opciones_admitidas(_estructura(otras=(ARCO, OTRA_GUIRNALDA)))
    assert opciones == {
        "soportes": ["pared", "colgada", "piso", "mesa", "sobre_estructura"],
        "anfitrionas": ["EST_02_ARCO"],
        "unidades": ["trio", "cuarteto", "quinteto"],
        "tamanos_base": [9, 11, 12],
        "materiales_relleno": [0, 1],
        "materiales_remate": [0, 1],
    }
    sin_anfitriona = opciones_admitidas(_estructura(CLASICA, mezcla="clasica"))
    assert sin_anfitriona["soportes"] == ["pared", "colgada", "piso", "mesa"]
    assert sin_anfitriona["materiales_relleno"] == [] and sin_anfitriona["materiales_remate"] == []


# --- Caída y desnivel de la foto (ADR-0032, decisión 26) -------------------------------------


def test_los_soportes_con_caida_salen_de_la_tabla_del_contrato() -> None:
    # Dueño: estructuras-oficiales.ts (soportesConCaida), exportado en x-geometria.
    assert SOPORTES_CON_CAIDA == frozenset({"pared", "colgada"})


@pytest.mark.parametrize(
    ("lectura", "geometria"),
    [
        # La foto del usuario: en la pared, alta a la izquierda y cae hacia la derecha.
        (
            _lectura(forma="curva", caida_relativa=0.0, desnivel_relativo=-0.25),
            {"forma": "curva", "desnivel_m": -0.63},
        ),
        # Una recta o una curva que cae cuelga en arco, con su caída en metros.
        (
            _lectura(forma="recta", caida_relativa=0.12, desnivel_relativo=None),
            {"forma": "arco_caido", "caida_m": 0.3},
        ),
        (
            _lectura(forma="curva", caida_relativa=0.1, desnivel_relativo=0.2),
            {"forma": "arco_caido", "caida_m": 0.25, "desnivel_m": 0.5},
        ),
        # Una U invertida o un arco caído llevan la caída tal cual.
        (
            _lectura(soporte="colgada", forma="u_invertida", caida_relativa=0.4),
            {"forma": "u_invertida", "caida_m": 1.0},
        ),
        # Una ondulada no cae (su onda no es una caída), pero sí puede ir desnivelada.
        (_lectura(forma="ondulada", caida_relativa=0.3), {}),
        (
            _lectura(forma="ondulada", caida_relativa=0.3, desnivel_relativo=-0.1),
            {"forma": "ondulada", "desnivel_m": -0.25},
        ),
        # Por debajo de 0,05 la guirnalda se lee recta y nivelada.
        (_lectura(forma="curva", caida_relativa=0.04, desnivel_relativo=-0.049), {}),
        # Sin medidas (null o ausentes), sin nada que medir.
        (_lectura(caida_relativa=None, desnivel_relativo=None), {}),
        (_lectura(), {}),
        # En el piso, sobre la mesa o sobre otra pieza los extremos van a su altura.
        (_lectura(soporte="piso", caida_relativa=0.2, desnivel_relativo=-0.3), {}),
        (_lectura(soporte="mesa", desnivel_relativo=-0.3), {}),
        (_lectura(soporte="sobre_estructura", desnivel_relativo=-0.3), {}),
        # Una lectura dudosa no decide nada.
        (_lectura(confianza=0.49, desnivel_relativo=-0.3), {}),
    ],
)
def test_la_geometria_de_la_lectura_en_metros(
    lectura: Mapping[str, object], geometria: Mapping[str, object]
) -> None:
    assert geometria_de_lectura(lectura, 2.5) == geometria


def test_la_geometria_nunca_pasa_del_contrato() -> None:
    larga = geometria_de_lectura(
        _lectura(
            soporte="colgada", forma="u_invertida", caida_relativa=0.6, desnivel_relativo=-0.6
        ),
        12.0,
    )
    assert larga == {"forma": "u_invertida", "caida_m": 5.0, "desnivel_m": -5.0}
    assert geometria_de_lectura(_lectura(desnivel_relativo=-0.3), 0.0) == {}


def test_la_lectura_con_caida_y_desnivel_llega_al_armado() -> None:
    estructura = _estructura()
    leida = sugerir_armado(estructura, _lectura(forma="curva", desnivel_relativo=-0.25))
    assert leida is not None
    assert (leida["origen"], leida["soporte"], leida["forma"], leida["desnivel_m"]) == (
        "referencia",
        "pared",
        "curva",
        -0.63,
    )
    assert "caida_m" not in leida
    caida = sugerir_armado(
        estructura,
        _lectura(soporte="colgada", forma="recta", caida_relativa=0.16, desnivel_relativo=-0.2),
    )
    assert caida is not None
    assert (caida["soporte"], caida["forma"], caida["caida_m"], caida["desnivel_m"]) == (
        "colgada",
        "arco_caido",
        0.4,
        -0.5,
    )
    assert caida["puntos_de_anclaje"] == 2, "colgada sin anclajes visibles cuelga de dos"
    # Sin las medidas nuevas, byte a byte lo de antes.
    assert sugerir_armado(estructura, _lectura(forma="curva")) == sugerir_armado(
        estructura, _lectura(forma="curva", caida_relativa=None, desnivel_relativo=None)
    )


def test_el_desnivel_solo_en_pared_o_colgada() -> None:
    estructura = _estructura(otras=(ARCO,))
    validar(estructura, _armado(desnivel_m=-0.4))
    validar(estructura, _armado(forma="ondulada", desnivel_m=0.3))
    validar(
        estructura,
        _armado(
            soporte="colgada",
            forma="u_invertida",
            caida_m=0.8,
            desnivel_m=-0.2,
            puntos_de_anclaje=2,
        ),
    )
    for armado in (
        _armado(soporte="piso", desnivel_m=-0.4),
        _armado(soporte="mesa", desnivel_m=0.2),
        _armado(soporte="sobre_estructura", estructura_id="EST_02_ARCO", desnivel_m=-0.3),
    ):
        assert _motivo(estructura, armado) == "desnivel_sin_soporte"
    assert _motivo(estructura, _armado(desnivel_m=-5.5)) == "forma_invalida", "tope del contrato"


def test_el_desnivel_en_la_hoja_y_en_la_frase_de_gemini() -> None:
    estructura = _estructura()
    nivelada = armado_resuelto(estructura, _armado())
    cae = armado_resuelto(estructura, _armado(desnivel_m=-0.4))
    pasos = cast(list[str], cae["pasos"])
    assert pasos[-1] == (
        "Fija la guirnalda a la pared de izquierda a derecha con ganchos o pegante,"
        " con el extremo derecho 0,4 m más bajo que el izquierdo."
    )
    frase = "Its right end hangs about 0.4 m lower than its left end, so the garland slopes down toward the right."
    assert str(cae["prompt_gemini"]) == f"{nivelada['prompt_gemini']} {frase}"
    assert cae["prompt_lora"] == nivelada["prompt_lora"], "el LoRA no aprendió el desnivel"
    sube = armado_resuelto(
        estructura,
        _armado(
            soporte="colgada", forma="arco_caido", caida_m=0.3, desnivel_m=0.25, puntos_de_anclaje=2
        ),
    )
    assert cast(list[str], sube["pasos"])[-1] == (
        "Cuélgala de sus 2 puntos de anclaje con la cuerda, con una caída de 0,3 m"
        " y el extremo derecho 0,25 m más alto que el izquierdo."
    )
    assert str(sube["prompt_gemini"]).endswith(
        "Its left end hangs about 0.25 m lower than its right end, so the garland slopes down"
        " toward the left."
    )
