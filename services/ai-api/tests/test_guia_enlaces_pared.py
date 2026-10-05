"""Los globos link de la pared en malla llegan a la guía de escena.

El dibujo ``malla-links`` pinta los enlaces como elipses y solo los nodos como globos, así que la captura de
``con_globos`` se quedaba con los nodos de R-5 y la guía mostraba una rejilla de puntos sueltos en vez de una
pared. Ahora cada enlace llega como una hilera de discos solapados, en el color del globo inflado de su material,
y el SVG que ve la UI no cambia.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any, cast

import pytest

from app.color_catalogo import referencia_de
from app.dibujo_estructura import dibujo_de, globos_de
from app.guia_escena import pieza_de_guia
from app.referencias.dibujos import (
    DatosDibujo,
    con_globos,
    dibujar_centro,
    dibujar_circulo,
    dibujar_pared,
    dibujar_techo,
)
from tests.guirnalda_datos import material

MEZCLA_REAL: tuple[dict[str, object], ...] = (
    {"diam_pulg": 12, "forma": "redondo", "unidades": 80, "pct": 61.54},
    {"diam_pulg": 5, "forma": "redondo", "unidades": 50, "pct": 38.46},
)

DATOS: DatosDibujo = {
    "colores": [
        {"hex": "#d4af37", "acabado": "cromado", "peso": 2},
        {"hex": "#ffffff", "acabado": "mate", "peso": 1},
    ],
    "mezcla": {5: 50, 9: 0, 12: 80, 18: 0, 24: 0, 36: 0},
    "dominante": 12,
    "redondos": 130,
}

#: Un globo link del SVG: la elipse rellena con el degradado ``vpl…`` del dibujo (las demás son sombras y
#: brillos del motor orgánico).
_ELIPSE = re.compile(r'<ellipse [^>]*fill="url\(#vpl')


def _pared(forma: str | None) -> dict[str, object]:
    pieza: dict[str, object] = {
        "estructura_id": "EST_PARED",
        "nombre": "Pared",
        "tipo": "pared",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 2.4, "alto_m": 2.2},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("rosado", 0.5, principal=True), material("blanco", 0.5)],
        "porque": "Pieza de prueba.",
        "estructura_oficial": "pared_no_densa",
    }
    if forma is not None:
        pieza["forma"] = forma
    return pieza


def _sha(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _hex_inflado(color: str) -> str:
    referencia = referencia_de(color, None)
    assert referencia is not None
    return str(referencia["hexGlobo"]).lower()


def test_la_malla_captura_los_enlaces_ademas_de_los_nodos() -> None:
    dibujo, globos = con_globos(lambda: dibujar_pared("malla-links", None, DATOS))
    enlaces = len(_ELIPSE.findall(dibujo["svg"]))
    nodos = [g for g in globos if g.nominal == 5]
    discos = [g for g in globos if g.nominal == 0]

    assert enlaces > 0
    assert nodos, "los nodos de R-5 siguen llegando"
    # Varios discos por enlace, y ninguno suelto.
    assert len(discos) % enlaces == 0
    assert len(discos) // enlaces >= 2
    # Los enlaces van detrás de los nodos, como en el dibujo.
    assert all(d.capa < n.capa for d in discos for n in nodos[:1])
    assert globos.index(discos[0]) < globos.index(nodos[0])


def test_los_discos_de_un_enlace_se_solapan_y_cubren_su_elipse() -> None:
    dibujo, globos = con_globos(lambda: dibujar_pared("malla-links", None, DATOS))
    discos = [g for g in globos if g.nominal == 0]
    lado = 0.3 * 2**0.5  # la retícula es de 0,3 m y cada enlace es una diagonal
    hilera = discos[: len(discos) // len(_ELIPSE.findall(dibujo["svg"]))]
    for a, b in zip(hilera, hilera[1:], strict=False):
        assert ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5 < a.r + b.r
    extremo = max(((d.x - hilera[0].x) ** 2 + (d.y - hilera[0].y) ** 2) ** 0.5 for d in hilera)
    assert extremo + 2 * hilera[0].r == pytest.approx(lado * 0.94, rel=1e-6)
    assert hilera[0].r == pytest.approx(lado * 0.15, rel=1e-6)


@pytest.mark.parametrize("forma", ["malla-links", "cuadriculada", "rombos", "organica"])
def test_la_captura_no_cambia_el_svg_de_la_pared(forma: str) -> None:
    sin_captura = dibujar_pared(forma, "mezclado", DATOS)
    con_captura, _globos = con_globos(lambda: dibujar_pared(forma, "mezclado", DATOS))
    assert _sha(con_captura["svg"]) == _sha(sin_captura["svg"])


def test_solo_la_malla_suma_discos_de_enlace() -> None:
    for dibujo in (
        lambda: dibujar_pared("cuadriculada", None, DATOS),
        lambda: dibujar_circulo("organico", None, DATOS),
        lambda: dibujar_circulo("clasico", None, DATOS),
        lambda: dibujar_techo("malla", None, DATOS),
        lambda: dibujar_techo("helio", None, DATOS),
        lambda: dibujar_centro("varillas", None, DATOS),
        lambda: dibujar_centro("burbuja", None, DATOS),
    ):
        _svg, globos = con_globos(dibujo)
        assert globos
        assert all(g.nominal != 0 for g in globos)


def test_la_guia_de_la_pared_en_malla_lleva_los_enlaces_en_su_color_inflado() -> None:
    estructura = _pared("malla-links")
    pieza = cast(dict[str, Any], pieza_de_guia(estructura, MEZCLA_REAL))
    capturados = globos_de(estructura, MEZCLA_REAL)
    dibujo = dibujo_de(estructura, MEZCLA_REAL)
    assert capturados is not None and dibujo is not None

    discos = cast(list[Mapping[str, Any]], pieza["discos"])
    assert len(discos) == len(capturados)
    de_enlace = sum(1 for g in capturados if g.nominal == 0)
    assert de_enlace >= 2 * len(_ELIPSE.findall(dibujo["svg"]))
    # La guía ordena por capa: primero los enlaces (detrás), luego los nodos.
    enlaces = discos[:de_enlace]
    inflados = {_hex_inflado("rosado"), _hex_inflado("blanco")}
    assert {d["hex"] for d in enlaces} <= inflados
    # El rosado se dibuja con una tinta que no es su globo inflado (en el blanco coinciden).
    rosado = referencia_de("rosado", None)
    assert rosado is not None
    assert str(rosado["hexTinta"]).lower() != _hex_inflado("rosado")
    assert str(rosado["hexTinta"]).lower() not in {d["hex"] for d in discos}
    assert _hex_inflado("rosado") in {d["hex"] for d in enlaces}
    # La malla se lee como pared: los enlaces ocupan más superficie que los nodos.
    area_enlaces = sum(float(d["r_m"]) ** 2 for d in enlaces)
    area_nodos = sum(float(d["r_m"]) ** 2 for d in discos[de_enlace:])
    assert area_enlaces > area_nodos


def test_sin_forma_la_pared_no_densa_sigue_sin_enlaces() -> None:
    capturados = globos_de(_pared(None), MEZCLA_REAL)
    assert capturados is not None and capturados
    assert all(g.nominal != 0 for g in capturados)
