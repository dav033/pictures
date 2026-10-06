"""Medidas físicas derivadas de cajas de referencia, sin servicios externos."""

from app.plan import _medir_desde_cajas


def _plan() -> dict[str, object]:
    return {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "semiarco",
                "tipo": "semiarco",
                "referencia_element_id": "arco",
                "medidas": {"ancho_m": 1.4, "alto_m": 2.2},
            },
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "col",
                "medidas": {"ancho_m": 1.04, "alto_m": 1.8},
                "armado_columna_organica": {
                    "forma": {"altoM": 1.8},
                    "volumen": {"grosorPatasM": 1.04, "grosorCimaM": 0.74},
                },
            },
        ],
    }


def _pistas() -> list[dict[str, object]]:
    return [
        {
            "referencia_element_id": "arco",
            "caja": {"x": 0.0, "y": 0.03, "width": 0.62, "height": 0.97},
            "aspect_ratio": 1.0,
            "confianza": 0.95,
        },
        {
            "referencia_element_id": "col",
            "caja": {"x": 0.63, "y": 0.33, "width": 0.32, "height": 0.60},
            "aspect_ratio": 1.0,
            "confianza": 0.9,
        },
    ]


def test_escala_medidas_de_pieza_mayor_y_deriva_columna_organica() -> None:
    plan, avisos = _medir_desde_cajas(_plan(), _pistas(), medidas_del_cliente=False)

    arco, columna = plan["estructuras"]
    assert arco["medidas"] == {"ancho_m": 1.4, "alto_m": 2.2}
    assert columna["medidas"] == {"ancho_m": 0.72, "alto_m": 1.36}
    assert columna["armado_columna_organica"]["forma"]["altoM"] == 1.36
    assert columna["armado_columna_organica"]["volumen"]["grosorPatasM"] == 0.72
    assert columna["armado_columna_organica"]["volumen"]["grosorCimaM"] == 0.51
    assert not avisos
    assert any("1.04 × 1.8 m" in supuesto for supuesto in plan["supuestos"])


def test_medida_del_cliente_prevalece_sobre_la_caja() -> None:
    plan, avisos = _medir_desde_cajas(_plan(), _pistas(), medidas_del_cliente=True)

    assert plan["estructuras"][0]["medidas"] == {"ancho_m": 1.4, "alto_m": 2.2}
    assert plan["estructuras"][1]["medidas"] == {"ancho_m": 1.04, "alto_m": 1.8}
    assert avisos == []


def test_caja_cortada_por_arriba_falla_de_forma_visible_y_no_ancla() -> None:
    plan = {
        "supuestos": [],
        "estructuras": [
            {
                "estructura_id": "columna",
                "tipo": "columna",
                "referencia_element_id": "col",
                "medidas": {"alto_m": 1.8},
            }
        ],
    }
    pistas = [
        {
            "referencia_element_id": "col",
            "caja": {"x": 0.4, "y": 0.0, "width": 0.2, "height": 1.0},
            "aspect_ratio": 1.0,
            "confianza": 0.9,
        }
    ]

    resuelto, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resuelto["estructuras"][0]["medidas"] == {"alto_m": 1.8}
    assert avisos and "corte superior" in avisos[0]
