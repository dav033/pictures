"""El motor de guirnalda de Python contra los vectores de oro del motor de TypeScript.

Los vectores de ``contracts/domain/v1/golden/guirnalda/vectores-guirnalda.json`` los genera el **otro** repo
(``clasificador-decoraciones/scripts/migracion/vectores-guirnalda.ts``) con el motor original: 199 diseños y
25 694 globos. Son un oráculo congelado: no se regeneran para que una prueba pase. Si una falla, o el puerto
se desvió, o el motor original cambió a propósito y el oráculo se vuelve a generar **allá** y se trae entero,
con el commit explicando qué cambió.

Lo que se comprueba es todo lo que el motor decide: el diseño normalizado, **los avisos del saneado** (el
texto exacto que lee el cliente, con sus comas decimales), los límites vivos, la mezcla de tamaños, la
disposición, la posición y el color de cada globo, el follaje, el conteo, las medidas, la compra y **el SVG**
por su sha256 (y entero en cinco casos, para poder ver la diferencia y no solo saber que la hay).

Los avisos se miden sobre la entrada **sin normalizar** (``saneoDirecto``), que es el único sitio donde se
ven: ``normalizar_config`` acota lo que llega fuera de rango y termina saneando, así que un ``sanear``
posterior sobre lo ya normalizado no corrige nada y le diría al cliente que no se tocó su diseño.

Dos diferencias entre JSON y Python, que no son tolerancias:

- las claves de ``mezcla``, ``porTamano`` y ``diametrosCm`` son enteros en Python y texto en JSON, porque JSON
  no tiene claves numéricas: se convierten las esperadas antes de comparar;
- los números se comparan redondeados a 1e-9 con el ``Math.round`` de JavaScript, igual que los escribió el
  generador. Dos lenguajes no dan el mismo último bit y comparar el último bit no prueba nada.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from app.guirnalda.formas import ESTILOS_GUIR, FORMAS_GUIRNALDA
from app.guirnalda.limites import (
    estimar_globos,
    limites,
    normalizar_config,
    normalizar_config_con_cambios,
    sanear,
)
from app.guirnalda.motor import LIENZO_GUIR, disposicion_guir, pintar_guir, pintar_miniatura
from app.guirnalda.tipos import ConfigGuir
from app.motores.js import _numero, _redondear
from app.organico.dibujo import svg_documento
from app.organico.medidas import calcular_compra, calcular_medidas, etiqueta_densidad
from app.organico.motor import Disposicion, ResultadoOrg, resumen_mezcla
from app.organico.tipos import ACABADOS, REPARTOS

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "guirnalda"
    / "vectores-guirnalda.json"
)

_ORACULO: Mapping[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
VECTORES: list[Mapping[str, Any]] = _ORACULO["vectores"]


def r9(valor: float) -> float:
    """El mismo redondeo con el que se escribieron los vectores: ``Math.round(v * 1e9) / 1e9``.

    Usa el ``Math.round`` de JavaScript, no el ``round`` de Python: el de Python manda el medio al par
    (``round(0.5) == 0``) y eso cambia el noveno decimal de uno de cada cien globos.
    """
    return float(_redondear(valor * 1e9)) / 1e9


def sha(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _claves_int(crudo: Mapping[str, Any]) -> dict[int, Any]:
    """Un diccionario del oráculo con las claves de tamaño como enteros, que es como las guarda el motor."""
    return {int(k): v for k, v in crudo.items()}


def _como_json(valor: Any) -> str:
    """``JSON.stringify``: sin espacios y con los números como los escribe JavaScript."""
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return str(_numero(float(valor)))
    if isinstance(valor, str):
        return json.dumps(valor, ensure_ascii=False)
    if isinstance(valor, list):
        return "[" + ",".join(_como_json(v) for v in valor) + "]"
    if isinstance(valor, dict):
        pares = ",".join(
            f"{json.dumps(str(k), ensure_ascii=False)}:{_como_json(v)}" for k, v in _orden_js(valor)
        )
        return "{" + pares + "}"
    if valor is None:
        return "null"
    raise TypeError(f"no se sabe escribir {type(valor)!r} como JSON de JavaScript")


def _orden_js(crudo: Mapping[Any, Any]) -> list[tuple[Any, Any]]:
    """Las claves en el orden en que las recorre JavaScript.

    Un objeto de JavaScript pone primero las claves que son índices (``"5"``, ``"12"``) en orden numérico
    ascendente y después el resto, en el orden en que se insertaron. Solo cambia algo en ``mezcla``,
    ``porTamano`` y ``diametrosCm``, que en Python llevan el tamaño entero por clave, pero sin esto el texto
    que se compara con un sha256 no sería el que escribió ``JSON.stringify``.
    """
    indices = [k for k in crudo if str(k).isdigit()]
    resto = [k for k in crudo if not str(k).isdigit()]
    return [(k, crudo[k]) for k in sorted(indices, key=lambda k: int(str(k)))] + [
        (k, crudo[k]) for k in resto
    ]


@dataclass
class Calculado:
    """Todo lo que el motor produce para un vector, calculado una sola vez."""

    cfg: ConfigGuir
    #: Lo que el saneador corrige de la entrada tal cual, y si deja el mismo diseño que `normalizar_config`.
    cambios_directos: list[str]
    mismo_diseno: bool
    disp: Disposicion
    res: ResultadoOrg
    mini: ResultadoOrg


_CALCULADO: dict[str, Calculado] = {}


def _calcular(vector: Mapping[str, Any]) -> Calculado:
    """El mismo camino que recorre el generador de vectores, memorizado por caso.

    Acomodar 25 694 globos y dibujarlos dos veces cuesta minutos: cada caso se calcula una vez y las cuatro
    pruebas que lo mide comparten el resultado.
    """
    nombre = str(vector["nombre"])
    hecho = _CALCULADO.get(nombre)
    if hecho is None:
        cfg = normalizar_config(vector["entrada"])
        # `sanear` se queda con los objetos `real` y `aspecto` que recibe y los corrige en su sitio, igual que
        # el original; la copia evita que un caso le cambie la entrada al siguiente.
        directo_cfg, directo_cambios = sanear(copy.deepcopy(vector["entrada"]))
        disp = disposicion_guir(cfg)
        hecho = Calculado(
            cfg=cfg,
            cambios_directos=directo_cambios,
            mismo_diseno=_como_json(directo_cfg) == _como_json(cfg),
            disp=disp,
            res=pintar_guir(cfg, disp),
            mini=pintar_miniatura(cfg, disp),
        )
        _CALCULADO[nombre] = hecho
    return hecho


# ---------------------------------------------------------------------------
# El catálogo que ve la interfaz
# ---------------------------------------------------------------------------


def test_lienzo_horizontal() -> None:
    assert LIENZO_GUIR == dict(_ORACULO["lienzo"])


def test_las_once_formas_listas() -> None:
    assert [{"id": f.id, "nombre": f.nombre} for f in FORMAS_GUIRNALDA] == [
        dict(f) for f in _ORACULO["formas"]
    ]


def test_los_cuatro_estilos() -> None:
    assert [{"id": e.id, "nombre": e.nombre, "ayuda": e.ayuda} for e in ESTILOS_GUIR] == [
        dict(e) for e in _ORACULO["estilos"]
    ]


def test_acabados_y_repartos() -> None:
    assert ACABADOS == [dict(a) for a in _ORACULO["acabados"]]
    assert REPARTOS == [dict(r) for r in _ORACULO["repartos"]]


# ---------------------------------------------------------------------------
# Un vector completo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_normalizado_y_limites(vector: Mapping[str, Any]) -> None:
    """El diseño que el sistema usa, los rangos vivos de cada control y la estimación de globos."""
    hecho = _calcular(vector)
    esperado = dict(vector["config"])
    esperado["tamanos"] = {
        **esperado["tamanos"],
        "mezcla": _claves_int(esperado["tamanos"]["mezcla"]),
    }
    assert hecho.cfg == esperado
    assert limites(hecho.cfg) == dict(vector["limites"])
    assert estimar_globos(hecho.cfg) == vector["estimarGlobos"]
    # Las dos puertas dejan el mismo diseño: la que devuelve los avisos y la que los descarta.
    assert normalizar_config_con_cambios(vector["entrada"])[0] == esperado


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_avisos_del_saneo(vector: Mapping[str, Any]) -> None:
    """Lo que el saneador le dice al cliente, palabra por palabra, sobre la entrada sin normalizar.

    Es la parte del motor que se lee en pantalla: «R24 no cabe en ese grosor: se quitó de la mezcla», «La
    altura se ajustó a 0,45 m…». Se compara el texto entero, con sus comas decimales, porque un aviso que no
    dice la cifra correcta es peor que ninguno. ``mismoDiseno`` mide lo otro que hace la puerta pública:
    acotar lo que llega fuera de rango antes de sanear, que en 90 de los 199 casos cambia el resultado.
    """
    hecho = _calcular(vector)
    esperado = vector["saneoDirecto"]
    assert hecho.cambios_directos == list(esperado["cambios"])
    assert hecho.mismo_diseno == esperado["mismoDiseno"]


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_mezcla_y_disposicion(vector: Mapping[str, Any]) -> None:
    """La mezcla de tamaños normalizada y dónde quedó cada globo antes de pintarlo."""
    hecho = _calcular(vector)
    mezcla = resumen_mezcla(dict(hecho.cfg))
    esperada = vector["resumenMezcla"]
    assert sorted(mezcla) == sorted(esperada)
    assert mezcla["usados"] == list(esperada["usados"])
    assert mezcla["total"] == esperada["total"]
    assert r9(mezcla["dMedio"]) == esperada["dMedio"]
    assert r9(mezcla["areaMedia"]) == esperada["areaMedia"]

    assert {
        "capas": hecho.disp.capas,
        "sueltos": hecho.disp.sueltos,
        "cuantos": len(hecho.disp.bs),
    } == dict(vector["disposicion"])


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_resultado(vector: Mapping[str, Any]) -> None:
    """Globo por globo, rama por rama, flor por flor, el conteo y el sha256 del SVG."""
    hecho = _calcular(vector)
    res = hecho.res
    esperado = vector["resultado"]

    assert res.capas == esperado["capas"]
    assert r9(res.anchoM) == esperado["anchoM"]
    assert r9(res.altoM) == esperado["altoM"]
    assert r9(res.largoM) == esperado["largoM"]
    assert r9(res.grosorPatasM) == esperado["grosorPatasM"]
    assert r9(res.grosorCimaM) == esperado["grosorCimaM"]
    assert r9(res.escala) == esperado["escala"]
    assert res.sueltos == esperado["sueltos"]
    assert res.conteo == [dict(c) for c in esperado["conteo"]]
    assert res.porTamano == _claves_int(esperado["porTamano"])
    assert len(res.globos) == esperado["cuantosGlobos"]
    assert len(res.ramas) == esperado["cuantasRamas"]
    assert len(res.flores) == esperado["cuantasFlores"]

    globos = [
        {
            "x": r9(b.x),
            "y": r9(b.y),
            "r": r9(b.r),
            "capa": b.capa,
            "nominal": b.nominal,
            "color": b.color,
            "acabado": b.acabado,
            "indice": b.indice,
        }
        for b in res.globos
    ]
    ramas = [
        {
            "x": r9(r.x),
            "y": r9(r.y),
            "ang": r9(r.ang),
            "largo": r9(r.largo),
            "capa": r9(r.capa),
            "hojas": [
                {"t": r9(h.t), "lado": h.lado, "largo": r9(h.largo), "tono": r9(h.tono)}
                for h in r.hojas
            ],
        }
        for r in res.ramas
    ]
    flores = [{"x": r9(f.x), "y": r9(f.y), "r": r9(f.r), "tono": r9(f.tono)} for f in res.flores]

    if "globos" in esperado:
        assert globos == [dict(g) for g in esperado["globos"]]
        assert ramas == [_rama_esperada(r) for r in esperado["ramas"]]
        assert flores == [dict(f) for f in esperado["flores"]]
    assert sha(_como_json(globos)) == esperado["globosSha"]
    assert sha(_como_json(ramas)) == esperado["ramasSha"]
    assert sha(_como_json(flores)) == esperado["floresSha"]

    # El dibujo: es lo que el cliente aprueba, así que se compara entero.
    assert len(res.svg) == esperado["svgLargo"]
    assert sha(res.svg) == esperado["svgSha"]
    if "svg" in vector:
        assert (
            svg_documento(res.svg, "Guirnalda de globos", LIENZO_GUIR["w"], LIENZO_GUIR["h"])
            == vector["svg"]
        )
    assert sha(hecho.mini.svg) == vector["miniaturaSha"]


def _rama_esperada(rama: Mapping[str, Any]) -> dict[str, Any]:
    return {**rama, "hojas": [dict(h) for h in rama["hojas"]]}


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_medidas_densidad_y_compra(vector: Mapping[str, Any]) -> None:
    """Lo que se le enseña al cliente y lo que se le pide al proveedor."""
    hecho = _calcular(vector)
    medidas = calcular_medidas(hecho.res, dict(hecho.cfg))
    esperadas = vector["medidas"]
    assert r9(medidas["anchoM"]) == esperadas["anchoM"]
    assert r9(medidas["altoM"]) == esperadas["altoM"]
    assert r9(medidas["largoM"]) == esperadas["largoM"]
    assert r9(medidas["grosorPatasCm"]) == esperadas["grosorPatasCm"]
    assert r9(medidas["grosorCimaCm"]) == esperadas["grosorCimaCm"]
    assert r9(medidas["globosPorMetro"]) == esperadas["globosPorMetro"]
    assert r9(medidas["globosPorPie"]) == esperadas["globosPorPie"]
    assert medidas["capas"] == esperadas["capas"]
    assert {t: r9(v) for t, v in medidas["diametrosCm"].items()} == _claves_int(
        esperadas["diametrosCm"]
    )

    assert etiqueta_densidad(medidas["globosPorPie"]) == vector["densidad"]

    compra = calcular_compra(hecho.res, dict(hecho.cfg))
    esperada = vector["compra"]
    assert [
        {**f, "porTamano": {int(k): v for k, v in f["porTamano"].items()}} for f in compra["filas"]
    ] == [{**dict(f), "porTamano": _claves_int(f["porTamano"])} for f in esperada["filas"]]
    assert compra["tamanos"] == list(esperada["tamanos"])
    assert compra["total"] == esperada["total"]
    assert compra["ramas"] == esperada["ramas"]
    assert compra["flores"] == esperada["flores"]
    # `calcular_compra` no devuelve ningún `costo`, igual que el original: el generador lo pide y escribe el
    # `NaN` que sale de ahí como `null`. Se comprueba para que el día que se calcule de verdad, esto avise.
