"""Medidas físicas derivadas de cajas de referencia, sin servicios externos."""

from typing import cast

import pytest

from app.plan import _complete_measures, _ids_medidas_fijas_en_conteo, _medir_desde_cajas
from tests.test_conteo_foto import (
    _estructura,
    _guirnalda,
    _plan_geometrico,
    _receta_del_motor,
    _resolver_geometrico,
    _supuestos,
)


def _pista(
    referencia: str, caja: dict[str, float], *, source: str = "foto-1", aspect: float = 1.0
) -> dict[str, object]:
    return {
        "referencia_element_id": referencia,
        "source_image_id": source,
        "caja": caja,
        "aspect_ratio": aspect,
        "confianza": 0.9,
    }


def test_una_escala_isotropica_reescala_medidas_y_armado_organico() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "arco",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"ancho_m": 3.0, "alto_m": 2.4},
            },
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "c",
                "medidas": {"alto_m": 1.8},
                "armado_columna_organica": {
                    "forma": {"altoM": 1.8, "inclinacionM": 0.5},
                    "volumen": {"grosorPatasM": 0.6, "grosorCimaM": 0.45},
                },
            },
        ],
    }
    pistas = [
        _pista("a", {"x": 0.05, "y": 0.05, "width": 0.45, "height": 0.9}),
        _pista("c", {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.6}),
    ]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    arco, columna = resultado["estructuras"]
    assert columna["medidas"]["alto_m"] == 1.6
    assert columna["armado_columna_organica"]["forma"]["altoM"] == 1.6
    assert columna["armado_columna_organica"]["volumen"]["grosorPatasM"] == 0.53
    assert "ancho_m" not in columna["medidas"]
    assert arco["medidas"] == {"ancho_m": 1.2, "alto_m": 2.4}
    assert any("Derivé el grosor" in aviso for aviso in avisos)


def test_medida_cliente_por_pieza_es_ancla_sin_bandera_de_conteo() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "arco",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"ancho_m": 3.0},
            },
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "c",
                "medidas": {"alto_m": 1.8},
            },
        ],
    }
    pistas = [
        _pista("a", {"x": 0.1, "y": 0.05, "width": 0.45, "height": 0.8}),
        _pista("c", {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.6}),
    ]

    resultado, _ = _medir_desde_cajas(
        plan, pistas, medidas_del_cliente=False, medidas_cliente_de=["arco"]
    )

    arco, columna = resultado["estructuras"]
    assert arco["medidas"]["ancho_m"] == 3.0
    assert columna["medidas"]["alto_m"] == 4.0


def test_conteo_no_mueve_escala_de_piezas_con_caja_sin_bandera() -> None:
    plan = {
        "estructuras": [
            {
                "estructura_id": "semiarco",
                "tipo": "semiarco",
                "referencia_element_id": "ref-a",
                "medidas": {"alto_m": 2.2},
            },
            {
                "estructura_id": "columna",
                "referencia_element_id": "ref-b",
                "medidas": {"alto_m": 1.8},
            },
            {"estructura_id": "sin-referencia", "medidas": {"alto_m": 1.8}},
        ]
    }
    # Una caja entera y confiable: la escala de la foto se ancla en el semiarco.
    pistas = [_pista("ref-a", {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.7})]

    assert _ids_medidas_fijas_en_conteo(plan, pistas, [], medidas_del_cliente=False) == {"semiarco"}


def test_la_pieza_que_sale_de_la_escala_de_su_foto_tambien_queda_fija() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "semiarco",
                "tipo": "semiarco",
                "referencia_element_id": "s",
                "medidas": {"alto_m": 2.2},
            },
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "c",
                "medidas": {},
            },
        ],
    }
    pistas = [
        _pista("s", {"x": 0.05, "y": 0.1, "width": 0.35, "height": 0.7}),
        _pista("c", {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.6}),
    ]

    assert _ids_medidas_fijas_en_conteo(plan, pistas, [], medidas_del_cliente=False) == {
        "semiarco",
        "columna",
    }


def test_s1_una_pista_que_no_ancla_no_fija_medidas() -> None:
    """Comparador 130, S1: la pista sola no fija nada; solo la caja que de verdad se usó.

    La foto de ejemplo 01: dos columnas sin medidas, una con la caja cortada por arriba y la otra entera,
    pero sin ninguna pieza que dé escala (una columna no escala la foto). Ninguna medida es del cliente ni de
    la foto, así que el conteo tiene que poder moverlas.
    """
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "izquierda",
                "tipo": "columna",
                "referencia_element_id": "e03",
                "medidas": {},
            },
            {
                "estructura_id": "derecha",
                "tipo": "columna",
                "referencia_element_id": "e04",
                "medidas": {},
            },
            {
                "estructura_id": "dudosa",
                "tipo": "arco",
                "referencia_element_id": "e05",
                "medidas": {"alto_m": 2.4},
            },
        ],
    }
    pistas = [
        _pista("e03", {"x": 0.018, "y": 0.0, "width": 0.35, "height": 0.885}, aspect=1.5),
        _pista("e04", {"x": 0.55, "y": 0.05, "width": 0.3, "height": 0.85}, aspect=1.5),
        {**_pista("e05", {"x": 0.3, "y": 0.1, "width": 0.3, "height": 0.5}), "confianza": 0.3},
    ]

    assert _ids_medidas_fijas_en_conteo(plan, pistas, [], medidas_del_cliente=False) == set()
    # La medida que dio el cliente sigue fija aunque su caja no ancle.
    assert _ids_medidas_fijas_en_conteo(plan, pistas, ["izquierda"], medidas_del_cliente=False) == {
        "izquierda"
    }


def test_cada_foto_calcula_su_escala_sin_heredar_la_de_otra() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "ancla-foto-1",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"alto_m": 2.4},
            },
            {
                "estructura_id": "pieza-foto-2",
                "tipo": "columna",
                "referencia_element_id": "c",
                "medidas": {},
            },
        ],
    }
    pistas = [
        _pista("a", {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.6}, source="foto-1"),
        _pista("c", {"x": 0.5, "y": 0.2, "width": 0.2, "height": 0.6}, source="foto-2"),
    ]

    resultado, _ = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"]["alto_m"] == 2.4
    assert resultado["estructuras"][1]["medidas"] == {}


def test_semiarco_estandar_escala_columna_isotropicamente_y_deriva_grosor() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "semiarco",
                "tipo": "semiarco",
                "referencia_element_id": "s",
                "medidas": {"alto_m": 2.2},
            },
            {
                "estructura_id": "columna",
                "tipo": "columna_organica",
                "referencia_element_id": "c",
                "medidas": {"alto_m": 1.8},
                "armado_columna_organica": {
                    "forma": {"altoM": 1.8},
                    "volumen": {"grosorPatasM": 1.1, "grosorCimaM": 0.55},
                },
            },
        ],
    }
    pistas = [
        _pista("s", {"x": 0.05, "y": 0.1, "width": 0.35, "height": 0.7}),
        _pista("c", {"x": 0.6, "y": 0.2, "width": 0.23, "height": 0.43}),
    ]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    columna = resultado["estructuras"][1]
    assert columna["medidas"]["alto_m"] == 1.35
    assert columna["armado_columna_organica"]["forma"]["altoM"] == 1.35
    assert columna["armado_columna_organica"]["volumen"]["grosorPatasM"] == 0.72
    assert "ancho_m" not in columna["medidas"]
    assert any("Derivé el grosor de columna" in aviso for aviso in avisos)


def test_columna_que_toca_techo_conserva_medida_motor_y_avisa() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "columna",
                "tipo": "columna_organica",
                "referencia_element_id": "c",
                "medidas": {},
                "armado_columna_organica": {
                    "forma": {"altoM": 2.2},
                    "volumen": {"grosorPatasM": 1.1, "grosorCimaM": 0.55},
                },
            },
        ],
    }
    pistas = [_pista("c", {"x": 0.62, "y": 0.0, "width": 0.3, "height": 1.0})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    columna = resultado["estructuras"][0]
    assert columna["medidas"]["alto_m"] == 2.2
    assert columna["armado_columna_organica"]["forma"]["altoM"] == 2.2
    assert any("borde superior" in aviso for aviso in avisos)


def test_escala_separa_imagenes_y_actualiza_armados_clasicos() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "arco",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"ancho_m": 2.0, "alto_m": 2.0},
                "armado_arco": {"geometria": {"anchoM": 2.0, "altoM": 2.0}},
            },
            {
                "estructura_id": "arco_organico",
                "tipo": "arco_organico",
                "referencia_element_id": "ao",
                "medidas": {"ancho_m": 2.0, "alto_m": 2.0},
                "armado_arco_organico": {"forma": {"anchoM": 2.0, "altoM": 2.0}},
            },
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "c",
                "medidas": {"alto_m": 1.8},
                "armado_columna": {"cuerpo": {"alto_m": 1.8}},
            },
            {
                "estructura_id": "pared",
                "tipo": "pared",
                "referencia_element_id": "p",
                "medidas": {"ancho_m": 2.4, "alto_m": 2.4},
            },
            {
                "estructura_id": "guirnalda",
                "tipo": "guirnalda",
                "referencia_element_id": "g",
                "medidas": {"largo_m": 2.5},
            },
        ],
    }
    pistas = [
        _pista("a", {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}),
        _pista("ao", {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.4}),
        _pista("c", {"x": 0.65, "y": 0.2, "width": 0.2, "height": 0.6}),
        _pista("p", {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}, source="foto-2"),
        _pista("g", {"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.1}),
    ]

    resultado, _ = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    arco, arco_organico, columna, pared, guirnalda = resultado["estructuras"]
    assert arco["armado_arco"]["geometria"] == {
        "anchoM": arco["medidas"]["ancho_m"],
        "altoM": arco["medidas"]["alto_m"],
    }
    assert arco_organico["armado_arco_organico"]["forma"] == {
        "anchoM": arco_organico["medidas"]["ancho_m"],
        "altoM": arco_organico["medidas"]["alto_m"],
    }
    assert columna["armado_columna"]["cuerpo"]["alto_m"] == columna["medidas"]["alto_m"]
    assert pared["medidas"] == {"ancho_m": 2.4, "alto_m": 2.4}
    assert guirnalda["medidas"] == {"largo_m": 2.5}


def test_caja_cortada_por_cualquier_borde_no_ancla_ni_deriva() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "c",
                "medidas": {"alto_m": 1.8},
            },
        ],
    }
    pistas = [_pista("c", {"x": 0.0, "y": 0.5, "width": 0.3, "height": 0.5})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"alto_m": 1.8}
    assert avisos and "izquierdo" in avisos[0] and "inferior" in avisos[0]


def test_caja_cortada_conserva_medida_del_armado_motor() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "columna",
                "tipo": "columna_organica",
                "referencia_element_id": "c",
                "medidas": {},
                "armado_columna_organica": {"forma": {"altoM": 1.8}},
            },
        ],
    }
    pistas = [_pista("c", {"x": 0.0, "y": 0.2, "width": 0.3, "height": 0.6})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"alto_m": 1.8}
    assert avisos and "borde izquierdo" in avisos[0]


def test_caja_cortada_toma_medidas_del_armado_y_no_de_la_caja() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "semiarco",
                "tipo": "semiarco",
                "referencia_element_id": "a",
                "medidas": {"ancho_m": 1.8, "alto_m": 2.2},
                "armado_arco_organico": {"forma": {"anchoM": 2.584, "altoM": 2.2}},
            },
        ],
    }
    pistas = [_pista("a", {"x": 0.2, "y": 0.2, "width": 0.8, "height": 0.6})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"ancho_m": 2.584, "alto_m": 2.2}
    assert avisos and "borde derecho" in avisos[0]


def test_tope_avisa_y_columna_organica_respeta_limite_del_motor() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "columna",
                "tipo": "columna_organica",
                "referencia_element_id": "c",
                "medidas": {},
                "armado_columna_organica": {
                    "forma": {"altoM": 1.0},
                    "volumen": {"grosorPatasM": 1.4, "grosorCimaM": 0.6},
                },
            },
            {
                "estructura_id": "arco",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"alto_m": 2.2},
            },
        ],
    }
    pistas = [
        _pista("c", {"x": 0.2, "y": 0.5, "width": 0.2, "height": 0.1}),
        _pista("a", {"x": 0.5, "y": 0.05, "width": 0.3, "height": 0.9}),
    ]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    columna = resultado["estructuras"][0]
    assert columna["medidas"]["alto_m"] >= 0.8
    volumen = columna["armado_columna_organica"]["volumen"]
    assert volumen["grosorPatasM"] <= columna["medidas"]["alto_m"] / 0.85
    assert volumen["grosorCimaM"] >= max(0.35, volumen["grosorPatasM"] * 0.35)
    assert any("excedía límites" in aviso for aviso in avisos)


def test_ancho_del_cliente_prevalece_al_sincronizar_columna_organica() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "columna",
                "tipo": "columna_organica",
                "referencia_element_id": "c",
                "medidas": {"ancho_m": 0.8, "alto_m": 1.8},
                "armado_columna_organica": {
                    "forma": {"altoM": 1.8},
                    "volumen": {"grosorPatasM": 0.44, "grosorCimaM": 0.45},
                },
            },
        ],
    }
    pistas = [_pista("c", {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.6}, aspect=2.0)]

    resultado, _ = _medir_desde_cajas(
        plan, pistas, medidas_del_cliente=False, medidas_cliente_de=["columna"]
    )

    columna = resultado["estructuras"][0]
    assert columna["medidas"] == {"ancho_m": 0.8, "alto_m": 1.8}
    assert columna["armado_columna_organica"]["volumen"]["grosorPatasM"] == 0.8


def test_sin_proporcion_no_usa_caja_como_ancla_ni_deriva_ancho() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "arco",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"ancho_m": 1.7, "alto_m": 2.2},
            },
        ],
    }
    pista = _pista("a", {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.5}, aspect=2.0)
    pista.pop("aspect_ratio")

    resultado, avisos = _medir_desde_cajas(plan, [pista], medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"ancho_m": 1.7, "alto_m": 2.2}
    assert any("no usé su caja como ancla" in aviso for aviso in avisos)


def test_pared_organica_oficial_se_mide_como_pared() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "arco",
                "tipo": "arco",
                "referencia_element_id": "a",
                "medidas": {"alto_m": 2.0},
            },
            {
                "estructura_id": "pared",
                "tipo": "pared_organica",
                "referencia_element_id": "p",
                "medidas": {"ancho_m": 2.4, "alto_m": 2.4},
            },
        ],
    }
    pistas = [
        _pista("a", {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.8}),
        _pista("p", {"x": 0.5, "y": 0.2, "width": 0.3, "height": 0.5}),
    ]

    resultado, _ = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][1]["medidas"] == {"ancho_m": 0.75, "alto_m": 1.25}


# --- Comparador 130, S3: el supuesto dice solo la medida que se asumió ---------------------------
#
# «Arco orgánico de unos 3 metros…»: el plan declara el ancho y no el alto. Hasta el 2026-10-07 bastaba que
# faltara una medida para escribir el supuesto de siempre con las dos, y el cliente leía «Usé medidas
# estándar para arco (3 m × 2,4 m) porque no me diste el tamaño» en las dos vistas.


def test_s3_solo_se_dice_asumida_la_medida_que_faltaba() -> None:
    plan = {
        "espacio": {"tipo": "salon", "fuente": "supuesto"},
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "arco",
                "nombre": "Arco orgánico de bienvenida",
                "tipo": "arco",
                "medidas": {"ancho_m": 3},
            },
            {"estructura_id": "semiarco", "nombre": "Semiarco", "tipo": "semiarco", "medidas": {}},
            {
                "estructura_id": "columna",
                "nombre": "Columna",
                "tipo": "columna",
                "medidas": {"alto_m": 2.0},
            },
        ],
    }

    resultado = _complete_measures(plan)

    assert [e["medidas"] for e in resultado["estructuras"]] == [
        {"ancho_m": 3, "alto_m": 2.4},
        {"ancho_m": 1.2, "alto_m": 2.2},
        {"alto_m": 2.0},
    ]
    assert resultado["supuestos"] == [
        "Arco orgánico de bienvenida: usé un alto estándar de 2,4 m; el ancho de 3 m es el que pediste.",
        # Sin ninguna medida, el supuesto de siempre: Next lo pone en palabras del cliente (supuestoCliente).
        "medidas asumidas para semiarco: 1.2 m × 2.2 m — no nos diste el tamaño del espacio",
    ]


def _arco_de_3_metros() -> dict[str, object]:
    return {
        **_guirnalda(),
        "estructura_id": "EST_01_ARCO",
        "nombre": "Arco orgánico",
        "tipo": "arco",
        "estructura_oficial": "arco_asimetrico",
        "ubicacion": "arco_central",
        "medidas": {"ancho_m": 3},
    }


@pytest.mark.anyio
@pytest.mark.parametrize("con_receta", [False, True], ids=["sin_receta", "receta_del_motor"])
async def test_s3_un_arco_de_3_metros_no_dice_que_no_diste_el_tamano(con_receta: bool) -> None:
    arco = _arco_de_3_metros()
    if con_receta:
        # ARMADO_ARCO_COLUMNA_V1: el arco llega con la receta que Next pidió a `completar`.
        arco = {**arco, **_receta_del_motor(arco)}
        assert "armado_arco_organico" in arco or "armado_arco" in arco

    resolved = await _resolver_geometrico(_plan_geometrico(arco))

    assert _estructura(resolved)["medidas"] == {"ancho_m": 3, "alto_m": 2.4}
    medidas = [s for s in _supuestos(resolved) if "estándar" in s or "medidas asumidas" in s]
    assert medidas == [
        "Arco orgánico: usé un alto estándar de 2,4 m; el ancho de 3 m es el que pediste."
    ]
    assert not any("no nos diste" in s for s in _supuestos(resolved))


@pytest.mark.anyio
async def test_s3_la_medida_que_escribio_la_foto_no_se_dice_pedida() -> None:
    # La foto escala el arco desde el semiarco (alto del cliente), pero sin proporción de la imagen no le
    # deriva el ancho: el alto sale de la foto y el ancho es el estándar.
    semiarco = {
        **_guirnalda(),
        "estructura_id": "EST_01_SEMIARCO",
        "nombre": "Semiarco",
        "tipo": "semiarco",
        "medidas": {"alto_m": 2.2},
    }
    arco = {
        **_arco_de_3_metros(),
        "estructura_id": "EST_02_ARCO",
        "nombre": "Arco",
        "medidas": {},
        "referencia_element_id": "REF_01_E02",
    }
    sin_proporcion = _pista("REF_01_E02", {"x": 0.5, "y": 0.2, "width": 0.3, "height": 0.5})
    sin_proporcion.pop("aspect_ratio")

    resolved = await _resolver_geometrico(
        _plan_geometrico(semiarco, arco),
        pistas_geometria=[
            _pista("REF_01_E01", {"x": 0.05, "y": 0.1, "width": 0.35, "height": 0.7}),
            sin_proporcion,
        ],
        medidas_cliente_de=["EST_01_SEMIARCO"],
    )

    plan = cast(dict[str, object], resolved["plan"])
    alto = cast(list[dict[str, dict[str, float]]], plan["estructuras"])[1]["medidas"]["alto_m"]
    assert alto != 2.4, "el alto lo escribió la escala de la foto"
    del_arco = [s for s in _supuestos(resolved) if s.startswith("Arco:")]
    assert del_arco == [
        f"Arco: usé un ancho estándar de 3 m; el alto de {f'{alto:.2f}'.rstrip('0').rstrip('.').replace('.', ',')} m sale de la foto."
    ]
    assert not any("no nos diste" in s for s in _supuestos(resolved))
