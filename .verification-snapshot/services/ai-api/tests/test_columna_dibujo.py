"""El **dibujo** de la columna contra los vectores de oro del motor de TypeScript.

Los vectores de ``contracts/domain/v1/golden/columna/vectores-columna-dibujo.json`` los genera el **otro**
repo (``clasificador-decoraciones/scripts/migracion/vectores-columna-dibujo.ts``) con el motor original. Son
un oráculo congelado: no se regeneran para que una prueba pase. Si una falla, o el puerto se desvió (se
arregla aquí) o el criterio cambió allá (se cambia allá, se vuelven a generar y se trae el archivo entero).

Van aparte de ``vectores-columna.json`` a propósito: ese archivo está congelado y lo usan las 740 pruebas de
``test_armado_columna.py``, que no tienen por qué volver a correr porque el dibujo cambie de sitio.

Qué se compara, por los 60 casos:

- la **escala** del dibujo normal y la del simple, que es lo que decide el tamaño de todo lo demás;
- el sha256 y el largo del SVG normal y del simple, que es la huella exacta del dibujo;
- en los casos que lo traen, el **documento SVG entero**, carácter por carácter: ahí se ve en qué número
  se desvió el formateo cuando un sha no cuadra.

El dibujo depende de dos cosas que no fallan solas, solo desvían: el orden en que se consume el azar (ya lo
cubren las 740) y **cómo se escribe un número dentro del SVG**, que resuelve ``_numero``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from app.armado_columna import PATRON_IDS, opciones_iniciales
from app.columna.motor import LIENZO_H, LIENZO_W, generar, svg_documento
from app.columna.tipos import CapaColumna, Columna, Config, Globo, Real, Remate

# `_redondear` es del puente entre lenguajes, no de la puerta: se toma de donde vive.
from app.motores.js import _redondear

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "columna"
    / "vectores-columna-dibujo.json"
)

_ORACULO: Mapping[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
VECTORES: list[Mapping[str, Any]] = _ORACULO["vectores"]
#: Hay nombres repetidos en el oráculo, así que el id de cada caso lleva su posición.
IDS = [f"{i:02d}-{v['nombre']}" for i, v in enumerate(VECTORES)]


def r9(valor: float) -> float:
    """El mismo redondeo con el que se escribieron los vectores: dos lenguajes no dan el mismo último bit.

    Usa el ``Math.round`` de JavaScript, no el ``round`` de Python, que manda el medio al par.
    """
    return _redondear(valor * 1e9) / 1e9


def sha(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _config(crudo: Mapping[str, Any]) -> Config:
    """El diseño del vector, tal cual: ya viene normalizado y saneado, así que no se vuelve a sanear.

    Los colores canónicos (``sx:041``) **se dejan sin resolver**, porque es ``generar`` quien los resuelve,
    igual que en el original.
    """
    col = crudo["columna"]
    glo = crudo["globo"]
    rem = crudo["remate"]
    real = crudo["real"]
    opciones = opciones_iniciales()
    for pid in PATRON_IDS:
        for clave, valor in crudo["opciones"].get(pid, {}).items():
            opciones[pid][clave] = valor
    return Config(
        modo=crudo["modo"],
        capas=[CapaColumna(tamano=k["tamano"], colores=list(k["colores"])) for k in crudo["capas"]],
        patron=crudo["patron"],
        columna=Columna(
            alto_m=col["altoM"],
            globos_capa=col["globosCapa"],
            abajo=col["abajo"],
            arriba=col["arriba"],
            escalonado=col["escalonado"],
            base=col["base"],
            persona=col["persona"],
        ),
        globo=Globo(
            inflado=glo["inflado"],
            tamano=glo["tamano"],
            compresion=glo["compresion"],
            variacion_tam=glo["variacionTam"],
            variacion_tono=glo["variacionTono"],
            desorden=glo["desorden"],
            brillo=glo["brillo"],
            sombra=glo["sombra"],
            contorno=glo["contorno"],
            profundidad=glo["profundidad"],
            semilla=glo["semilla"],
        ),
        remate=Remate(
            tipo=rem["tipo"],
            tamano=rem["tamano"],
            cantidad=rem["cantidad"],
            foil_m=rem["foilM"],
            color=rem["color"],
        ),
        real=Real(
            desperdicio=real["desperdicio"], precio=real["precio"], cantidad=real["cantidad"]
        ),
        colores=list(crudo["colores"]),
        opciones=opciones,
    )


def _primera_diferencia(obtenido: str, esperado: str) -> str:
    """Dónde divergen dos SVG y qué hay alrededor: casi siempre es el formateo de un número."""
    comun = min(len(obtenido), len(esperado))
    corte = next((i for i in range(comun) if obtenido[i] != esperado[i]), comun)
    desde = max(0, corte - 90)
    return (
        f"difieren en el carácter {corte} de {len(esperado)}\n"
        f"  obtenido: ...{obtenido[desde : corte + 60]!r}\n"
        f"  esperado: ...{esperado[desde : corte + 60]!r}"
    )


# ---------------------------------------------------------------------------
# El oráculo
# ---------------------------------------------------------------------------


def test_el_oraculo_cubre_los_cinco_remates() -> None:
    """Los cuatro remates que dibujan algo tienen que estar: cada uno es una rama distinta de `_dibujar`.

    El generador los nombraba con `r.tipo` cuando la lista los nombra en `valor`, así que los cinco casos se
    llamaban «remate-undefined», el saneado les devolvía el remate por defecto y el racimo, la estrella y el
    corazón se quedaban sin un solo vector. Esta prueba existe para que no vuelva a pasar inadvertido.
    """
    assert _ORACULO["version"] == "columna-dibujo-vectores.v1"
    assert len(VECTORES) == 67
    tipos = {str(v["config"]["remate"]["tipo"]) for v in VECTORES}
    assert tipos == {"ninguno", "globo", "racimo", "estrella", "corazon"}


def test_el_lienzo_es_el_del_motor() -> None:
    assert _ORACULO["lienzo"] == {"w": LIENZO_W, "h": LIENZO_H}


def test_hay_casos_con_el_svg_entero() -> None:
    """Los casos que traen el documento completo son con los que se depura una diferencia de sha."""
    con_svg = [v["nombre"] for v in VECTORES if "svg" in v]
    assert con_svg == [
        "inicial",
        "remate-racimo-5",
        "remate-estrella",
        "remate-corazon",
        "canonico-cristal",
    ]


# ---------------------------------------------------------------------------
# Un vector completo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("vector", VECTORES, ids=IDS)
def test_escala(vector: Mapping[str, Any]) -> None:
    """La escala del dibujo normal y la del simple: de ella sale el tamaño de todo lo que se pinta."""
    cfg = _config(vector["config"])
    assert r9(generar(cfg).escala) == vector["escala"]
    assert r9(generar(cfg, True).escala) == vector["escalaSimple"]


@pytest.mark.parametrize("vector", VECTORES, ids=IDS)
def test_svg(vector: Mapping[str, Any]) -> None:
    """El SVG normal y el simple, por su largo y su sha256; y entero en los casos que lo traen."""
    cfg = _config(vector["config"])

    res = generar(cfg)
    if "svg" in vector:
        documento = svg_documento(res.svg)
        assert documento == vector["svg"], _primera_diferencia(documento, vector["svg"])
    assert len(res.svg) == vector["svgLargo"]
    assert sha(res.svg) == vector["svgSha"]

    simple = generar(cfg, True)
    assert len(simple.svg) == vector["svgSimpleLargo"]
    assert sha(simple.svg) == vector["svgSimpleSha"]
