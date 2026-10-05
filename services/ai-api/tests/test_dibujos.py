"""Los dibujos propios de la vista previa, de Python, contra los vectores de oro de TypeScript.

Los vectores de ``contracts/domain/v1/golden/dibujos/vectores-dibujos.json`` los genera el **otro** repo
(``clasificador-decoraciones/scripts/migracion/vectores-dibujos.ts``) con el módulo original: 783 dibujos,
394 distintos, 262 119 piezas de SVG (69 son la densidad de la pared, el techo y el centro de mesa, y en
``media`` empatan con su caso sin densidad). Son un oráculo congelado: no se regeneran para que una prueba
pase. Si una falla, o el puerto se desvió, o el módulo original cambió a propósito y el oráculo se vuelve a generar
**allá** y se trae entero, con el commit explicando qué cambió.

**Aquí el dibujo es el oráculo, y es lo único que hay.** ``dibujar_pared``, ``dibujar_circulo``,
``dibujar_techo``, ``dibujar_centro``, ``dibujar_arco_perlado`` y ``con_numero`` no devuelven globos, ni
conteos, ni medidas: devuelven ``{svg, ancho, alto}`` y nada más, porque estas cuatro estructuras no tienen
diseñador y sus dibujos son esquemáticos a propósito («No calculan cantidades: la medida es la típica de cada
estructura»). Nada de lo que se mide aquí entra en el conteo, en el precio ni en el ``plan_hash``.

Qué se compara de cada caso:

- ``ancho`` y ``alto`` del lienzo, exactos.
- el **sha256 del SVG** y su longitud, exactos: es lo que el cliente aprueba;
- las **piezas por etiqueta** (``<ellipse`` 412, ``<circle`` 3, ``<path`` 2…), exactas. Es lo que dice primero
  *qué* cambió de forma cuando el sha no cuadra, en vez de dejar un «los shas difieren» a secas;
- el **SVG entero** en siete casos, para poder ver la diferencia y no solo saber que la hay;
- en los 19 casos detallados, **todos los números del dibujo en orden**, que dicen *qué coordenada* se movió.

Y una prueba que no es de un caso sino de todos: **cada forma y cada patrón que se puede elegir cambia el
dibujo**. Es la regla por la que este módulo existe (David, 2026-09-27: elegir «Pared de globos → En rombos»
no cambiaba nada en pantalla). Se recalcula qué casos comparten dibujo y se compara con la agrupación
congelada del oráculo: si aparece un empate nuevo, una forma o un patrón dejó de pintar.

Los empates que el oráculo ya trae son alias y están explicados allá: ``forma=None`` resuelve a una forma
concreta (``"organica"``, ``"organico"``, ``"helio"``) y a lo mismo que una forma desconocida, ``patron=None``
resuelve a «mezclado» con más de un color y a «liso» con uno solo, «arcoíris» y «por zonas» comparten rama, y
los patrones que piden una rejilla (``ajedrez``, ``mural``) pintan liso donde el dibujo no la tiene.

**Sobre la tolerancia.** La geometría continua se compara con una tolerancia absoluta de ``TOL`` porque V8 y
CPython no dan el mismo último dígito en ``Math.pow`` (ver ``app/motores/mate.py``): está medido, no supuesto
—≤9,5e-08 m en una columna orgánica, hasta 1,5e-06 m en una pieza grande después de la relajación iterativa
del arco—. En estos dibujos **no hay relajación**: cada globo se coloca de una vez, ``pow`` solo entra en el
perfil de los racimos (``sin(πq) ** 0,55``), en los lóbulos del corazón del mural (``x ** 2``) y en el corazón
del centro de mesa (``sin(u) ** 3``), y el SVG redondea a **décimas de píxel** (el ``f`` de este módulo, no el
de centésimas del motor orgánico), unas 10 000 veces más grueso que esa deriva. Por eso el sha256 del SVG se
exige **exacto en los 783 casos**, sin excepciones ni márgenes, y la tolerancia solo cubre los números ya
redondeados de los casos detallados, donde de hecho coinciden al bit.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

import pytest

from app.arco.tipos import INFLADO_PULG
from app.motores.js import _numero, _redondear
from app.referencias.dibujos import (
    DatosDibujo,
    Dibujo,
    con_numero,
    dibujar_arco_perlado,
    dibujar_centro,
    dibujar_circulo,
    dibujar_pared,
    dibujar_techo,
)

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "dibujos"
    / "vectores-dibujos.json"
)

_ORACULO: Mapping[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
VECTORES: list[Mapping[str, Any]] = _ORACULO["vectores"]

#: Tolerancia de la geometría continua, en metros. Medida, no elegida al azar: la deriva entre V8 y CPython en
#: ``Math.pow`` llegó a 9,5e-08 m en el peor de los 18 864 globos de la columna orgánica y a 1,5e-06 m en una
#: pieza grande del arco orgánico, donde la relajación es iterativa y la amplifica. 1e-6 m deja margen sobre lo
#: primero y cubre lo segundo. Aquí se aplica a números que ya están en **píxeles** y redondeados a décimas,
#: así que es una tolerancia holgadísima que en la práctica nunca se usa: coinciden al bit. Lo que decide el
#: dibujo —y lo que el cliente aprueba— es el sha256 del SVG, que se compara exacto en los 783 casos.
TOL = 1e-6


def r9(valor: float) -> float:
    """El mismo redondeo con el que se escribieron los vectores: ``Math.round(v * 1e9) / 1e9``.

    Usa el ``Math.round`` de JavaScript, no el ``round`` de Python: el de Python manda el medio al par
    (``round(0.5) == 0``) y eso cambiaría el noveno decimal.
    """
    return float(_redondear(valor * 1e9)) / 1e9


def sha(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _claves_int(crudo: Mapping[str, Any]) -> dict[int, Any]:
    """Un diccionario del oráculo con las claves de tamaño como enteros, que es como las indexa el dibujo."""
    return {int(k): v for k, v in crudo.items()}


def _lista_json(numeros: list[float]) -> str:
    """``JSON.stringify`` de un arreglo de números: sin espacios y escritos como los escribe JavaScript."""
    return "[" + ",".join(_numero(v) for v in numeros) + "]"


def _piezas(svg: str) -> dict[str, int]:
    """Las piezas del dibujo por etiqueta, igual que las cuenta el generador."""
    cuenta: dict[str, int] = {}
    for tag in re.findall(r"<([a-zA-Z]+)", svg):
        cuenta[tag] = cuenta.get(tag, 0) + 1
    return cuenta


def _sin_color(svg: str) -> str:
    """El SVG sin colores ni identificadores, para que al sacar los números no entren los de un ``#1d4ed8``.

    Son las tres sustituciones del generador, en el mismo orden: lo que se compara es la lista que sale de
    ellas, así que si una se escribe distinta aquí la prueba lo dice en el primer caso.
    """
    sin = re.sub(r' id="[^"]*"', "", svg)
    sin = re.sub(r"url\(#[^)]*\)", "url()", sin)
    return re.sub(r"#[0-9a-fA-F]{3,6}\b", "#", sin)


def _numeros(svg: str) -> list[float]:
    """Todos los números del dibujo, en orden: con ellos se ve qué coordenada se movió."""
    return [r9(float(m)) for m in re.findall(r"-?\d+(?:\.\d+)?(?:e[-+]?\d+)?", _sin_color(svg))]


_FICHAS: dict[str, DatosDibujo] = {}


def _ficha(nombre: str) -> DatosDibujo:
    """Una de las fichas de prueba del oráculo, con las claves de la mezcla como enteros."""
    guardada = _FICHAS.get(nombre)
    if guardada is None:
        cruda = next((f for f in _ORACULO["fichas"] if f["id"] == nombre), None)
        assert cruda is not None, f"el oráculo no trae la ficha «{nombre}»"
        datos = cruda["datos"]
        guardada = cast(
            DatosDibujo,
            {
                "colores": [dict(c) for c in datos["colores"]],
                "mezcla": _claves_int(datos["mezcla"]),
                "dominante": datos["dominante"],
                "redondos": datos["redondos"],
            },
        )
        _FICHAS[nombre] = guardada
    return guardada


_POR_NOMBRE: dict[str, Mapping[str, Any]] = {str(v["nombre"]): v for v in VECTORES}
_CALCULADO: dict[str, Dibujo] = {}


def _calcular(vector: Mapping[str, Any]) -> Dibujo:
    """El dibujo de un caso, memorizado por nombre.

    Los casos de ``con_numero`` parten del dibujo de otro caso (``fuente``), así que se calcula ese primero:
    el rótulo se mide sobre un dibujo de verdad, no sobre un recorte inventado.
    """
    nombre = str(vector["nombre"])
    hecho = _CALCULADO.get(nombre)
    if hecho is not None:
        return hecho
    estructura = str(vector["estructura"])
    datos = _ficha(str(vector["ficha"]))
    if "densidad" in vector:
        # Bloque D del oráculo: la misma ficha con la densidad de la pieza (``GLOBOS_POR_AREA``).
        datos = cast(DatosDibujo, {**datos, "densidad": vector["densidad"]})
    forma = vector["forma"]
    patron = vector["patron"]
    if estructura == "pared":
        hecho = dibujar_pared(forma, patron, datos)
    elif estructura == "circulo":
        hecho = dibujar_circulo(forma, patron, datos)
    elif estructura == "techo":
        hecho = dibujar_techo(forma, patron, datos)
    elif estructura == "centro":
        hecho = dibujar_centro(forma, patron, datos)
    elif estructura == "perlado":
        hecho = dibujar_arco_perlado(patron, datos)
    elif estructura == "numero":
        fuente = vector.get("fuente")
        interior = (
            _calcular(_POR_NOMBRE[str(fuente)])["svg"]
            if fuente is not None
            else str(vector.get("entrada", ""))
        )
        w = vector["w"]
        h = vector["h"]
        hecho = {"svg": con_numero(interior, w, h, datos["colores"]), "ancho": w, "alto": h}
    else:
        raise AssertionError(f"el oráculo trae una estructura que no se sabe dibujar: {estructura}")
    _CALCULADO[nombre] = hecho
    return hecho


# ---------------------------------------------------------------------------
# Lo que entra a los dibujos
# ---------------------------------------------------------------------------


def test_diametro_inflado_de_cada_tamano() -> None:
    """De aquí sale el radio de cada globo del dibujo: si cambia, cambian los 783 dibujos."""
    assert _claves_int(_ORACULO["infladoPulg"]) == {
        t: INFLADO_PULG[t] for t in _claves_int(_ORACULO["infladoPulg"])
    }


def test_el_barrido_cubre_el_catalogo() -> None:
    """Todo lo que el cliente puede elegir en la ficha se dibuja en algún caso.

    Es la mitad formal de la regla «cada forma y cada patrón que se puede elegir cambia el dibujo»: primero
    hay que **probarlos todos**. El catálogo sale de ``variantes.ts`` y los conjuntos barridos de los ``switch``
    de ``dibujos.ts``, que no son el mismo conjunto: la pared ofrece cinco patrones y el centro de mesa
    ninguno, pero las cuatro funciones comparten el mismo pintor y lo aceptan todo.

    En el perlado ``tomaForma`` es falso: ``dibujar_arco_perlado`` no recibe forma —la forma ya **es**
    «perlado»— así que de su catálogo solo le aplican los patrones.
    """
    probados = _ORACULO["probados"]
    vistas: dict[str, set[str | None]] = {}
    vistos: dict[str, set[str | None]] = {}
    for v in VECTORES:
        estructura = str(v["estructura"])
        vistas.setdefault(estructura, set()).add(v["forma"])
        vistos.setdefault(estructura, set()).add(v["patron"])

    for estructura, cat in _ORACULO["catalogo"].items():
        patrones = probados["patronesPerla" if estructura == "perlado" else "patronesPintor"]
        assert set(cat["patrones"]) <= set(patrones), estructura
        assert set(patrones) <= vistos[estructura], estructura
        if cat["tomaForma"]:
            assert set(cat["formas"]) <= set(probados["formas"][estructura]), estructura
            assert set(probados["formas"][estructura]) <= vistas[estructura], estructura


# ---------------------------------------------------------------------------
# Un dibujo completo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_dibujo(vector: Mapping[str, Any]) -> None:
    """El lienzo, las piezas y el sha256 del SVG de un caso, y sus números cuando va detallado."""
    hecho = _calcular(vector)
    assert hecho["ancho"] == vector["ancho"]
    assert hecho["alto"] == vector["alto"]

    # Las piezas primero: cuando el sha no cuadra, esto dice si cambió la forma del dibujo o solo un número.
    piezas = _piezas(hecho["svg"])
    assert piezas == dict(vector["piezas"])
    assert sum(piezas.values()) == vector["cuantasPiezas"]

    numeros = _numeros(hecho["svg"])
    assert len(numeros) == vector["cuantosNumeros"]
    assert sha(_lista_json(numeros)) == vector["numerosSha"]
    if "numeros" in vector:
        esperados = list(vector["numeros"])
        for i, (obtenido, quiere) in enumerate(zip(numeros, esperados, strict=True)):
            assert abs(obtenido - quiere) <= TOL, (
                f"numeros[{i}]: {obtenido!r} contra {quiere!r},"
                f" diferencia {abs(obtenido - quiere):.3e} (tolerancia {TOL:.0e})"
            )

    # El dibujo: es lo que el cliente aprueba, y aquí no hay tolerancia ninguna.
    assert len(hecho["svg"]) == vector["svgLargo"]
    assert sha(hecho["svg"]) == vector["svgSha"]
    if "svg" in vector:
        assert hecho["svg"] == vector["svg"]


def test_cada_forma_y_cada_patron_cambia_el_dibujo() -> None:
    """La regla por la que este módulo existe, medida sobre los 783 dibujos.

    Se agrupan los casos de cada estructura por el sha256 de su dibujo y se compara la agrupación con la que
    trae el oráculo. Los grupos que ya están son alias explicados (``forma=None`` resolviendo a una forma
    concreta, ``patron=None`` a «mezclado» o a «liso», «arcoíris» y «por zonas» compartiendo rama, y los
    patrones que piden una rejilla pintando liso donde no la hay). Un grupo nuevo, o uno que crece, significa
    que una forma o un patrón dejó de cambiar el dibujo: exactamente el defecto del 2026-09-27.
    """
    por_sha: dict[tuple[str, str], list[str]] = {}
    for v in VECTORES:
        hecho = _calcular(v)
        por_sha.setdefault((str(v["estructura"]), sha(hecho["svg"])), []).append(str(v["nombre"]))
    obtenidos = sorted(
        (estructura, tuple(nombres))
        for (estructura, _s), nombres in por_sha.items()
        if len(nombres) > 1
    )
    esperados = sorted(
        (str(g["estructura"]), tuple(str(n) for n in g["nombres"])) for g in _ORACULO["grupos"]
    )
    assert obtenidos == esperados

    # Y cuántos dibujos distintos salen por estructura, que es la misma cuenta mirada al revés.
    distintos: dict[str, set[str]] = {}
    casos: dict[str, int] = {}
    for v in VECTORES:
        estructura = str(v["estructura"])
        distintos.setdefault(estructura, set()).add(sha(_calcular(v)["svg"]))
        casos[estructura] = casos.get(estructura, 0) + 1
    assert {e: {"casos": casos[e], "dibujos": len(s)} for e, s in distintos.items()} == {
        e: dict(d) for e, d in _ORACULO["distintos"].items()
    }
