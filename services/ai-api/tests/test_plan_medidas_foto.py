"""Medidas físicas derivadas de cajas de referencia, sin servicios externos."""

from app.plan import _ids_medidas_fijas_en_conteo, _medir_desde_cajas


def _pista(referencia: str, caja: dict[str, float], *, source: str = "foto-1", aspect: float = 1.0) -> dict[str, object]:
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
            {"estructura_id": "arco", "tipo": "arco", "referencia_element_id": "a", "medidas": {"ancho_m": 3.0, "alto_m": 2.4}},
            {"estructura_id": "columna", "tipo": "columna", "referencia_element_id": "c", "medidas": {"alto_m": 1.8}, "armado_columna_organica": {"forma": {"altoM": 1.8, "inclinacionM": 0.5}, "volumen": {"grosorPatasM": 0.6, "grosorCimaM": 0.45}}},
        ],
    }
    pistas = [_pista("a", {"x": 0.05, "y": 0.05, "width": 0.45, "height": 0.9}), _pista("c", {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.6})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    arco, columna = resultado["estructuras"]
    assert columna["medidas"]["alto_m"] == 1.6
    assert columna["armado_columna_organica"]["forma"]["altoM"] == 1.6
    assert columna["armado_columna_organica"]["volumen"]["grosorPatasM"] == 0.6
    assert "ancho_m" not in columna["medidas"]
    assert arco["medidas"] == {"ancho_m": 1.2, "alto_m": 2.4}
    assert any("Conservé el grosor" in aviso for aviso in avisos)


def test_medida_cliente_por_pieza_es_ancla_sin_bandera_de_conteo() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "arco", "tipo": "arco", "referencia_element_id": "a", "medidas": {"ancho_m": 3.0}},
        {"estructura_id": "columna", "tipo": "columna", "referencia_element_id": "c", "medidas": {"alto_m": 1.8}},
    ]}
    pistas = [_pista("a", {"x": 0.1, "y": 0.05, "width": 0.45, "height": 0.8}), _pista("c", {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.6})]

    resultado, _ = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False, medidas_cliente_de=["arco"])

    arco, columna = resultado["estructuras"]
    assert arco["medidas"]["ancho_m"] == 3.0
    assert columna["medidas"]["alto_m"] == 4.0


def test_conteo_no_mueve_escala_de_piezas_con_caja_sin_bandera() -> None:
    plan = {"estructuras": [
        {"estructura_id": "semiarco", "tipo": "semiarco", "referencia_element_id": "ref-a", "medidas": {"alto_m": 2.2}},
        {"estructura_id": "columna", "referencia_element_id": "ref-b", "medidas": {"alto_m": 1.8}},
        {"estructura_id": "sin-referencia", "medidas": {"alto_m": 1.8}},
    ]}
    pistas = [{"referencia_element_id": "ref-a", "source_image_id": "foto-1"}]

    assert _ids_medidas_fijas_en_conteo(plan, pistas, [], medidas_del_cliente=False) == {"semiarco"}


def test_cada_foto_calcula_su_escala_sin_heredar_la_de_otra() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "ancla-foto-1", "tipo": "arco", "referencia_element_id": "a", "medidas": {"alto_m": 2.4}},
        {"estructura_id": "pieza-foto-2", "tipo": "columna", "referencia_element_id": "c", "medidas": {}},
    ]}
    pistas = [
        _pista("a", {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.6}, source="foto-1"),
        _pista("c", {"x": 0.5, "y": 0.2, "width": 0.2, "height": 0.6}, source="foto-2"),
    ]

    resultado, _ = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"]["alto_m"] == 2.4
    assert resultado["estructuras"][1]["medidas"]["alto_m"] == 2.2


def test_escala_separa_imagenes_y_actualiza_armados_clasicos() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "arco", "tipo": "arco", "referencia_element_id": "a", "medidas": {"ancho_m": 2.0, "alto_m": 2.0}, "armado_arco": {"geometria": {"anchoM": 2.0, "altoM": 2.0}}},
        {"estructura_id": "arco_organico", "tipo": "arco_organico", "referencia_element_id": "ao", "medidas": {"ancho_m": 2.0, "alto_m": 2.0}, "armado_arco_organico": {"forma": {"anchoM": 2.0, "altoM": 2.0}}},
        {"estructura_id": "columna", "tipo": "columna", "referencia_element_id": "c", "medidas": {"alto_m": 1.8}, "armado_columna": {"cuerpo": {"alto_m": 1.8}}},
        {"estructura_id": "pared", "tipo": "pared", "referencia_element_id": "p", "medidas": {"ancho_m": 2.4, "alto_m": 2.4}},
        {"estructura_id": "guirnalda", "tipo": "guirnalda", "referencia_element_id": "g", "medidas": {"largo_m": 2.5}},
    ]}
    pistas = [
        _pista("a", {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}),
        _pista("ao", {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.4}),
        _pista("c", {"x": 0.65, "y": 0.2, "width": 0.2, "height": 0.6}),
        _pista("p", {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}, source="foto-2"),
        _pista("g", {"x": 0.2, "y": 0.2, "width": 0.5, "height": 0.1}),
    ]

    resultado, _ = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    arco, arco_organico, columna, pared, guirnalda = resultado["estructuras"]
    assert arco["armado_arco"]["geometria"] == {"anchoM": arco["medidas"]["ancho_m"], "altoM": arco["medidas"]["alto_m"]}
    assert arco_organico["armado_arco_organico"]["forma"] == {"anchoM": arco_organico["medidas"]["ancho_m"], "altoM": arco_organico["medidas"]["alto_m"]}
    assert columna["armado_columna"]["cuerpo"]["alto_m"] == columna["medidas"]["alto_m"]
    assert pared["medidas"] == {"ancho_m": 2.4, "alto_m": 2.4}
    assert guirnalda["medidas"] == {"largo_m": 2.5}


def test_caja_cortada_por_cualquier_borde_no_ancla_ni_deriva() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "columna", "tipo": "columna", "referencia_element_id": "c", "medidas": {"alto_m": 1.8}},
    ]}
    pistas = [_pista("c", {"x": 0.0, "y": 0.5, "width": 0.3, "height": 0.5})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"alto_m": 1.8}
    assert avisos and "izquierdo" in avisos[0] and "inferior" in avisos[0]


def test_caja_cortada_conserva_medida_del_armado_motor() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "columna", "tipo": "columna_organica", "referencia_element_id": "c", "medidas": {}, "armado_columna_organica": {"forma": {"altoM": 1.8}}},
    ]}
    pistas = [_pista("c", {"x": 0.0, "y": 0.2, "width": 0.3, "height": 0.6})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"alto_m": 1.8}
    assert avisos and "borde izquierdo" in avisos[0]


def test_caja_cortada_toma_medidas_del_armado_y_no_de_la_caja() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "semiarco", "tipo": "semiarco", "referencia_element_id": "a", "medidas": {"ancho_m": 1.8, "alto_m": 2.2}, "armado_arco_organico": {"forma": {"anchoM": 2.584, "altoM": 2.2}}},
    ]}
    pistas = [_pista("a", {"x": 0.2, "y": 0.2, "width": 0.8, "height": 0.6})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    assert resultado["estructuras"][0]["medidas"] == {"ancho_m": 2.584, "alto_m": 2.2}
    assert avisos and "borde derecho" in avisos[0]


def test_tope_avisa_y_columna_organica_respeta_limite_del_motor() -> None:
    plan = {"supuestos": [], "estructuras": [
        {"estructura_id": "columna", "tipo": "columna_organica", "referencia_element_id": "c", "medidas": {}, "armado_columna_organica": {"forma": {"altoM": 1.0}, "volumen": {"grosorPatasM": 1.4, "grosorCimaM": 0.6}}},
        {"estructura_id": "arco", "tipo": "arco", "referencia_element_id": "a", "medidas": {"alto_m": 2.2}},
    ]}
    pistas = [_pista("c", {"x": 0.2, "y": 0.5, "width": 0.2, "height": 0.1}), _pista("a", {"x": 0.5, "y": 0.05, "width": 0.3, "height": 0.9})]

    resultado, avisos = _medir_desde_cajas(plan, pistas, medidas_del_cliente=False)

    columna = resultado["estructuras"][0]
    assert columna["medidas"]["alto_m"] >= 0.8
    volumen = columna["armado_columna_organica"]["volumen"]
    assert volumen["grosorPatasM"] <= columna["medidas"]["alto_m"] / 0.85
    assert volumen["grosorCimaM"] >= max(0.35, volumen["grosorPatasM"] * 0.35)
    assert any("excedía límites" in aviso for aviso in avisos)
