"""Lo que las pruebas con fotos reales del 2026-10-05 encontraron en la lectura y en la guía de escena.

- Los tamaños de una columna clásica coronada con un globo gigante: el lector contaba la corona y las
  columnas en espiral salían «chicos con pocos grandes», que es la mezcla orgánica fina.
- El tono de la guía: el material dice la familia («azul») y el producto que se compra el tono («Fashion
  Azul Rey»); la guía dibujaba el celeste 040 de la familia.
"""

from __future__ import annotations

import pytest

from app.amaterasu.patron_referencia import ElementoReferencia, validar_pistas
from app.color_catalogo import referencia_de, referencia_del_titulo
from app.guia_escena import hex_del_material

COLUMNA = [ElementoReferencia(element_id="REF_01_E01", tipo="columna")]


def _tamanos(modo: str, remate: dict[str, object] | None, confianza: float = 0.92) -> str | None:
    pista: dict[str, object] = {
        "element_id": "REF_01_E01",
        "modo": modo,
        "colores": ["azul", "dorado"],
        "confianza": confianza,
        "tamanos": "chicos_con_pocos_grandes",
    }
    if remate is not None:
        pista["remate"] = remate
    [validada] = validar_pistas({"pistas": [pista]}, COLUMNA)
    tamanos = validada.get("tamanos")
    return tamanos if isinstance(tamanos, str) else None


@pytest.mark.parametrize("modo", ["espiral", "anillos", "bloques"])
def test_una_columna_de_anillos_coronada_con_un_globo_es_de_un_solo_tamano(modo: str) -> None:
    """El globo grande es la corona, que se lee y se arma aparte: el cuerpo es de un tamaño."""
    assert _tamanos(modo, {"tipo": "globo", "color": "azul"}) == "un_solo_tamano"


def test_sin_corona_o_con_un_patron_organico_la_lectura_se_queda() -> None:
    assert _tamanos("espiral", None) == "chicos_con_pocos_grandes"
    assert _tamanos("espiral", {"tipo": "racimo"}) == "chicos_con_pocos_grandes"
    # Una columna orgánica también puede llevar un globo encima: sus tamaños siguen siendo mezclados.
    assert _tamanos("aleatorio", {"tipo": "globo"}) == "chicos_con_pocos_grandes"


def test_un_patron_dicho_sin_confianza_no_corrige_los_tamanos() -> None:
    assert _tamanos("espiral", {"tipo": "globo"}, confianza=0.3) == "chicos_con_pocos_grandes"


@pytest.mark.parametrize(
    ("titulo", "codigo"),
    [
        ("B2b Globo Latex Redondo Fashion Azul Rey · R-12 / PAQUETE X 12", "041"),
        ("B2b Globo Latex Redondo Fashion Azul Naval - R-9 / PAQUETE X 20", "044"),
        ("B2b Globo Latex Redondo Fashion Palo de Rosa R-12", "010"),
    ],
)
def test_el_titulo_del_producto_dice_el_tono(titulo: str, codigo: str) -> None:
    referencia = referencia_del_titulo(titulo, None)
    assert referencia is not None and referencia["codigo"] == codigo


def test_el_acabado_sigue_eligiendo_la_familia_del_tono() -> None:
    reflex = referencia_del_titulo("Globo Latex Redondo Reflex Dorado R-12", "reflex")
    assert reflex == referencia_de("dorado", "reflex")


def test_un_titulo_sin_tono_o_con_dos_no_elige() -> None:
    assert referencia_del_titulo("Kit Globos Rosado y Dorado", None) is None
    assert referencia_del_titulo("Globo Burbuja 24", None) is None
    assert referencia_del_titulo(None, None) is None


def test_la_guia_pinta_el_tono_del_producto_que_se_compra() -> None:
    lineas = [{"product_id": "P-REY", "titulo": "B2b Globo Latex Redondo Fashion Azul Rey R-12"}]
    rey = hex_del_material({"color": "azul", "product_id": "P-REY"}, lineas)
    assert rey == str(referencia_de("azul rey", None)["hexGlobo"]).lower()  # type: ignore[index]
    # Sin la línea del producto, la familia, como antes.
    assert hex_del_material({"color": "azul", "product_id": "OTRO"}, lineas) == hex_del_material(
        {"color": "azul"}
    )
