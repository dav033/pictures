"""El motor de arco de Python contra los vectores de oro del motor de TypeScript.

Los vectores de ``contracts/domain/v1/golden/arco/vectores-arco.json`` los genera el **otro** repo
(``clasificador-decoraciones/scripts/migracion/vectores-arco.ts``) con el motor original. Son un oráculo
congelado: no se regeneran para que una prueba pase. Si una falla, o el puerto se desvió, o el motor original
cambió a propósito y el oráculo se vuelve a generar **allá** y se trae entero, con el commit explicando qué
cambió.

Lo que se comprueba es todo lo que el motor decide: el saneado y sus avisos, los límites, las posiciones y el
color de cada globo, el conteo, la compra, las secuencias por capa y —a diferencia de la columna— **el SVG**,
por su sha256. El arco se migró con su dibujo porque lo que el cliente aprueba es cómo se ve.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from app.arco.limites import ancho_minimo_de, bandas, limites, paso_m, sanear, tamanos_que_caben
from app.arco.medidas import calcular_compra, calcular_medidas, grosor_por_tamano
from app.arco.motor import carril_de, generar, secuencias_del_patron
from app.arco.patrones import PATRONES, normalizar_config
from app.arco.secciones import permutar, reordenar_secciones
from app.arco.tipos import PATRON_IDS, Config
from app.motores.js import _redondear

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "arco"
    / "vectores-arco.json"
)

_ORACULO: Mapping[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
VECTORES: list[Mapping[str, Any]] = _ORACULO["vectores"]
POR_NOMBRE = {v["nombre"]: v for v in VECTORES}

def r9(valor: float) -> float:
    """El mismo redondeo con el que se escribieron los vectores: dos lenguajes no dan el mismo último bit.

    Usa el ``Math.round`` de JavaScript, no el ``round`` de Python: el de Python manda el medio al par
    (``round(0.5) == 0``) y aquí eso cambiaba el noveno decimal de uno de cada cien globos.
    """
    return _redondear(valor * 1e9) / 1e9


def sha(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _resuelto(vector: Mapping[str, Any]) -> tuple[Config, list[str]]:
    """El mismo camino que recorre el original: normalizar lo que llega y después sanear."""
    return sanear(normalizar_config(vector["entrada"]))


# ---------------------------------------------------------------------------
# El catálogo de patrones
# ---------------------------------------------------------------------------


def test_los_catorce_patrones_existen() -> None:
    assert list(PATRON_IDS) == [p["id"] for p in _ORACULO["patrones"]]


@pytest.mark.parametrize("esperado", _ORACULO["patrones"], ids=lambda p: str(p["id"]))
def test_ficha_de_cada_patron(esperado: Mapping[str, Any]) -> None:
    """Nombre, descripción, colores, roles, lista y controles: lo que la interfaz y la IA ven del patrón."""
    patron = PATRONES[esperado["id"]]
    assert patron.nombre == esperado["nombre"]
    assert patron.descripcion == esperado["descripcion"]
    assert patron.colores == esperado["colores"]
    assert patron.roles == esperado["roles"]
    assert patron.lista == esperado["lista"]
    controles = [
        {
            "clave": c["clave"],
            "etiqueta": c["etiqueta"],
            "min": c["min"],
            "max": c["max"],
            "paso": c["paso"],
            "def": c["def_"],
            **({"interruptor": True} if c.get("interruptor") else {}),
            **({"seleccion": c["seleccion"]} if c.get("seleccion") else {}),
            **({"ayuda": c["ayuda"]} if c.get("ayuda") else {}),
        }
        for c in patron.controles
    ]
    assert controles == list(esperado["controles"])


# ---------------------------------------------------------------------------
# Funciones puras
# ---------------------------------------------------------------------------


def test_carril_de() -> None:
    for caso in _ORACULO["carriles"]:
        assert carril_de(caso["c"], caso["n"]) == caso["carril"], caso


def test_permutar() -> None:
    for caso in _ORACULO["permutaciones"]:
        assert permutar(caso["lista"], caso["desde"], caso["hacia"]) == caso["salida"], caso


def test_reordenar_secciones() -> None:
    for caso in _ORACULO["reordenes"]:
        assert reordenar_secciones(caso["previas"], caso["contenidos"], caso["desde"], caso["hacia"]) == caso["salida"], caso


# ---------------------------------------------------------------------------
# Un vector completo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_saneado_y_limites(vector: Mapping[str, Any]) -> None:
    """El diseño corregido, lo que se avisó y los rangos que la interfaz ofrece."""
    cfg, cambios = _resuelto(vector)
    assert cfg == vector["config"]
    assert cambios == vector["cambios"]
    assert limites(cfg) == vector["limites"]
    assert tamanos_que_caben(cfg) == vector["tamanosQueCaben"]
    assert bandas(cfg) == vector["bandas"]
    assert r9(ancho_minimo_de(cfg)) == vector["anchoMinimo"]
    assert r9(paso_m(cfg["globo"])) == vector["paso"]
    assert [{k: r9(v) if isinstance(v, float) else v for k, v in g.items()} for g in grosor_por_tamano(cfg)] == [
        dict(g) for g in vector["grosorPorTamano"]
    ]


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_resultado(vector: Mapping[str, Any]) -> None:
    """Globo por globo, el conteo, la compra y el sha256 del SVG."""
    cfg, _ = _resuelto(vector)
    res = generar(cfg, datos=True)
    esperado = vector["resultado"]

    assert res.filas == esperado["filas"]
    assert res.columnas == esperado["columnas"]
    assert r9(res.piso) == esperado["piso"]
    assert r9(res.anchoM) == esperado["anchoM"]
    assert r9(res.altoM) == esperado["altoM"]
    assert r9(res.grosorM) == esperado["grosorM"]
    assert r9(res.largoM) == esperado["largoM"]
    assert r9(res.diametroM) == esperado["diametroM"]
    assert r9(res.escala) == esperado["escala"]
    assert res.avisos == esperado["avisos"]
    assert res.secciones == esperado["secciones"]
    assert res.conteo == [dict(c) for c in esperado["conteo"]]
    assert len(res.globos) == esperado["cuantosGlobos"]

    globos = [
        {
            "x": r9(b.x),
            "y": r9(b.y),
            "rx": r9(b.rx),
            "ry": r9(b.ry),
            "rot": b.rot,
            "color": b.color,
            "base": b.base,
            "prof": r9(b.prof),
            "z": r9(b.z),
            "fila": b.fila,
            "filaEsp": b.filaEsp,
            "carril": b.carril,
            "banda": b.banda,
            "elemento": b.elemento,
        }
        for b in res.globos
    ]
    if "globos" in esperado:
        assert globos == [dict(g) for g in esperado["globos"]]
    assert sha(_como_json(globos)) == esperado["globosSha"]

    # El dibujo: es lo que el cliente aprueba, así que se compara entero.
    assert len(res.svg) == esperado["svgLargo"]
    assert sha(res.svg) == esperado["svgSha"]
    if "svg" in vector:
        from app.arco.motor import svg_documento

        assert svg_documento(res.svg) == vector["svg"]
    assert sha(generar(cfg).svg) == vector["svgSinDatosSha"]

    medidas = {k: r9(v) for k, v in calcular_medidas(res).items()}
    assert medidas == dict(vector["medidas"])

    compra = calcular_compra(res, cfg["real"]["desperdicio"])
    assert compra["lineas"] == [dict(linea) for linea in vector["compra"]["lineas"]]
    assert compra["total"] == vector["compra"]["total"]

    secuencias, exactas = secuencias_del_patron(cfg)
    assert secuencias == [list(s) for s in vector["secuencias"]]
    assert exactas == list(vector["secuenciasExactas"])


def _como_json(valor: Any) -> str:
    """``JSON.stringify`` de los globos: sin espacios y con los números como los escribe JavaScript."""
    from app.motores.js import _numero

    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, (int, float)):
        return _numero(float(valor))
    if isinstance(valor, str):
        return json.dumps(valor, ensure_ascii=False)
    if isinstance(valor, list):
        return "[" + ",".join(_como_json(v) for v in valor) + "]"
    if isinstance(valor, dict):
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{_como_json(v)}" for k, v in valor.items()) + "}"
    if valor is None:
        return "null"
    raise TypeError(f"no se sabe escribir {type(valor)!r} como JSON de JavaScript")
