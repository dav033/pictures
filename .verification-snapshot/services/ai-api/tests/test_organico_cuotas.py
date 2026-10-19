"""La opción ``colores.cuotas`` del motor orgánico contra los vectores de oro del motor de TypeScript.

Decisión que la motiva: **el plan decide cuántos globos de cada color; el motor decide dónde va cada uno.** Sin la
opción, los pesos de los colores son una tendencia y el reparto se desvía: con 70/20/10 declarado, el motor
coloca —y el plan compra— alrededor de 48/29/22 al azar (la penalización por vecino del mismo color aplana los
pesos) y en racimos un color no pasa de la mitad de los racimos (nunca repite el del racimo anterior). Con la
opción, antes de colorear se fija cuántos globos lleva cada color —el mayor resto sobre los globos que hay que
colorear, con los acentos en su propio presupuesto— y el reparto solo decide el sitio. No tocarse con un vecino
del mismo color pasa a ser una preferencia que nunca rompe una cuota.

Los vectores de ``contracts/domain/v1/golden/organico/vectores-organico-cuotas.json`` los genera el **otro**
repo (``clasificador-decoraciones/scripts/migracion/vectores-organico-cuotas.ts``) con el motor original: 164
diseños sobre las cuatro estructuras que comparten el motor —arco, medio arco, guirnalda y columna con su globo
de remate—, dos semillas, los tres repartos y paletas de 2 a 4 colores con pesos sesgados, con y sin acentos. Son
un oráculo congelado: no se regeneran para que una prueba pase. Si una falla, o el puerto se desvió, o el motor
original cambió a propósito y el oráculo se vuelve a generar **allá** y se trae entero.

Sin la opción el motor no cambia: los oráculos de ``test_organico.py``, ``test_guirnalda.py``,
``test_columnaorg.py``, ``test_bouquet*`` y ``test_dibujos.py`` siguen siendo los mismos byte a byte (se regeneraron
con el cambio puesto y salieron idénticos salvo la hora de ``generado``). Aquí se mide solo lo nuevo, y además lo
de siempre con estas paletas sesgadas (``sinCuotas``), para que el desvío que corrige la opción quede escrito.

Lo que se compara exacto es todo lo discreto: el diseño normalizado, el conteo por color y por tamaño, **el
color de cada globo en el orden en que se dibuja** (``indices``, que dice dónde se desvió y no solo que se
desvió), su sha, la compra y el sha256 del SVG. La geometría no se mira aquí: la opción no la toca —se comprueba—
y ya la miden, con su tolerancia, las pruebas de cada estructura.

La disposición no depende de los colores: los casos con la misma estructura y semilla la comparten
(``disposicion``) y aquí se calcula una sola vez, que es lo que hace que la prueba entera tarde segundos y no
minutos.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from app.columnaorg.limites import normalizar_config as normalizar_columna
from app.columnaorg.motor import LIENZO_COL, disposicion_col, pintar_col
from app.guirnalda.limites import normalizar_config as normalizar_guirnalda
from app.guirnalda.motor import LIENZO_GUIR, disposicion_guir, pintar_guir
from app.motores.js import _numero, _redondear, crear_rng
from app.organico.config import normalizar_config as normalizar_arco
from app.organico.dibujo import svg_documento
from app.organico.medidas import calcular_compra
from app.organico.motor import (
    LIENZO,
    Disposicion,
    ResultadoOrg,
    crear_disposicion,
    cuotas_por_peso,
    pintar,
)

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "organico"
    / "vectores-organico-cuotas.json"
)

_ORACULO: Mapping[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
VECTORES: list[Mapping[str, Any]] = _ORACULO["vectores"]


def sha(texto: str) -> str:
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def _claves_int(crudo: Mapping[str, Any]) -> dict[int, Any]:
    """Un diccionario del oráculo con las claves de tamaño como enteros, que es como las guarda el motor."""
    return {int(k): v for k, v in crudo.items()}


def _orden_js(crudo: Mapping[Any, Any]) -> list[tuple[Any, Any]]:
    """Las claves en el orden en que las recorre JavaScript: primero los índices, en orden numérico."""
    indices = [k for k in crudo if str(k).isdigit()]
    resto = [k for k in crudo if not str(k).isdigit()]
    return [(k, crudo[k]) for k in sorted(indices, key=lambda k: int(str(k)))] + [
        (k, crudo[k]) for k in resto
    ]


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


@dataclass(frozen=True)
class _Motor:
    """Los tres pasos que recorre el sistema con cada estructura, y cómo se titula y enmarca su dibujo."""

    normalizar: Callable[[object], Any]
    disponer: Callable[[Any], Disposicion]
    pintar: Callable[[Any, Disposicion], ResultadoOrg]
    titulo: str
    lienzo: tuple[float, float]


def _pintar_arco(cfg: Any, disp: Disposicion) -> ResultadoOrg:
    return pintar(dict(cfg), disp)


_ARCO = _Motor(
    normalizar_arco, crear_disposicion, _pintar_arco, "Arco orgánico de globos", (LIENZO, LIENZO)
)
_MOTORES: dict[str, _Motor] = {
    "arco": _ARCO,
    "medio-arco": _ARCO,
    "guirnalda": _Motor(
        normalizar_guirnalda,
        disposicion_guir,
        pintar_guir,
        "Guirnalda de globos",
        (LIENZO_GUIR["w"], LIENZO_GUIR["h"]),
    ),
    "columna": _Motor(
        normalizar_columna,
        disposicion_col,
        pintar_col,
        "Columna orgánica de globos",
        (LIENZO_COL["w"], LIENZO_COL["h"]),
    ),
}


@dataclass
class Calculado:
    """Todo lo que el motor produce para un vector, con la opción y sin ella, calculado una sola vez."""

    cfg: dict[str, Any]
    disp: Disposicion
    con: ResultadoOrg
    sin: ResultadoOrg


_DISPOSICIONES: dict[str, tuple[Disposicion, str]] = {}
_CALCULADO: dict[str, Calculado] = {}


def _sin_colores(cfg: Mapping[str, Any]) -> str:
    """El diseño sin sus colores: lo único de lo que depende la disposición."""
    return _como_json({**cfg, "colores": None})


def _calcular(vector: Mapping[str, Any]) -> Calculado:
    """El mismo camino que recorre el generador: la puerta, la disposición (compartida) y dos pintados."""
    nombre = str(vector["nombre"])
    hecho = _CALCULADO.get(nombre)
    if hecho is None:
        motor = _MOTORES[str(vector["estructura"])]
        cfg = dict(motor.normalizar(vector["entrada"]))
        clave = str(vector["disposicion"])
        if clave not in _DISPOSICIONES:
            _DISPOSICIONES[clave] = (motor.disponer(cfg), _sin_colores(cfg))
        disp, sin_colores = _DISPOSICIONES[clave]
        # Si alguna vez la disposición dependiera de los colores, compartirla sería un error: que lo diga.
        assert _sin_colores(cfg) == sin_colores, f"{nombre}: el diseño cambió fuera de los colores"
        apagada = {**cfg, "colores": {k: v for k, v in cfg["colores"].items() if k != "cuotas"}}
        hecho = Calculado(
            cfg=cfg, disp=disp, con=motor.pintar(cfg, disp), sin=motor.pintar(apagada, disp)
        )
        _CALCULADO[nombre] = hecho
    return hecho


def _por_color(res: ResultadoOrg, cuantos: int) -> list[int]:
    """Globos de cada color de la paleta; el de remate de la columna (``indice`` -1) no es de ninguno."""
    salida = [0] * cuantos
    for g in res.globos:
        if g.indice >= 0:
            salida[g.indice] += 1
    return salida


def _discretos(res: ResultadoOrg) -> list[dict[str, Any]]:
    return [
        {
            "capa": b.capa,
            "nominal": b.nominal,
            "color": b.color,
            "acabado": b.acabado,
            "indice": b.indice,
        }
        for b in res.globos
    ]


def _objetivo(lista: list[Mapping[str, Any]], n: int) -> list[int]:
    """Lo que tiene que salir con cuotas, calculado aquí por su cuenta, igual que en el generador.

    Los acentos se llevan su presupuesto de siempre (``round(n · pesoAcentos / pesoTotal)``), repartido entre
    ellos por el mayor resto, y los colores base se reparten el resto, también por el mayor resto.
    """
    todos = list(range(len(lista)))
    base_idx = [i for i in todos if lista[i]["rol"] != "acento"]
    base = base_idx if base_idx else todos
    acentos = [i for i in todos if lista[i]["rol"] == "acento"] if base_idx else []
    salida = [0] * len(lista)
    libres = n
    if acentos:
        peso_ac = 0.0
        for i in acentos:
            peso_ac += lista[i]["peso"]
        peso_base = 0.0
        for i in base:
            peso_base += lista[i]["peso"]
        cuota = int(_redondear((n * peso_ac) / (peso_ac + peso_base)))
        for k, q in enumerate(cuotas_por_peso([lista[i]["peso"] for i in acentos], cuota)):
            salida[acentos[k]] = q
        libres -= cuota
    for k, q in enumerate(cuotas_por_peso([lista[i]["peso"] for i in base], libres)):
        salida[base[k]] = q
    return salida


def _ids(v: Mapping[str, Any]) -> str:
    return str(v["nombre"])


# ---------------------------------------------------------------------------
# El oráculo y el mayor resto
# ---------------------------------------------------------------------------


def test_procedencia_del_oraculo() -> None:
    """De qué commit sale, si el árbol estaba limpio y con qué ``pow`` corrió Node (PLAN-calidad-imagen §S3).

    El ``pow`` es el de V8 por defecto, el mismo con que se generaron todos los oráculos de motor del repo y el que
    reproduce ``app/motores/mate.py``. Con ``--no-use-std-math-pow`` diez de los 218 vectores de la columna
    orgánica salen distintos: mezclar los dos en un mismo puerto no tendría arreglo.
    """
    assert _ORACULO["version"] == "organico-cuotas-vectores.v1"
    commit = _ORACULO["fuente_commit"]
    assert isinstance(commit, str) and len(commit) == 40 and int(commit, 16) >= 0
    assert isinstance(_ORACULO["fuente_sucia"], bool)
    assert _ORACULO["pow"] == "V8 por defecto (--use-std-math-pow)"
    assert len(VECTORES) == 164
    assert {v["estructura"] for v in VECTORES} == {"arco", "medio-arco", "guirnalda", "columna"}


def test_oraculo_limpio() -> None:
    """PLAN-calidad-imagen §S3: el oráculo sale de un commit del clasificador, no de un árbol con cambios sin commitear."""
    assert _ORACULO["fuente_sucia"] is False


def test_cuotas_por_peso_reparte_por_el_mayor_resto() -> None:
    """Los casos a mano del original (``scripts/organico/pruebas.ts``), con los mismos números."""
    assert cuotas_por_peso([70, 20, 10], 100) == [70, 20, 10]
    # 4,9 / 1,4 / 0,7 → pisos 4 / 1 / 0 y faltan dos: van al resto 0,9 y al 0,7.
    assert cuotas_por_peso([70, 20, 10], 7) == [5, 1, 1]
    assert cuotas_por_peso([7.0, 2.0, 1.0], 7) == [5, 1, 1]
    # Un resto empatado lo gana el color que va antes.
    assert cuotas_por_peso([1, 1, 1], 2) == [1, 1, 0]
    assert cuotas_por_peso([3, 1], 2) == [2, 0]
    # Sin peso, por igual; un peso negativo cuenta como cero; con n = 0 no le toca a nadie.
    assert cuotas_por_peso([0, 0], 3) == [2, 1]
    assert cuotas_por_peso([-3, 1], 4) == [0, 4]
    assert cuotas_por_peso([5, 5], 0) == [0, 0]
    assert cuotas_por_peso([], 5) == []


def test_cuotas_por_peso_suman_n_y_quedan_a_menos_de_un_globo() -> None:
    rnd = crear_rng(20261005)
    for _ in range(3000):
        k = 1 + int(rnd() * 8)
        pesos = [float(1 + _redondear(rnd() * 99)) for _ in range(k)]
        n = int(rnd() * 901)
        cuotas = cuotas_por_peso(pesos, n)
        total = sum(pesos)
        assert sum(cuotas) == n, (pesos, n)
        for i, q in enumerate(cuotas):
            assert q >= 0
            assert abs(q - n * pesos[i] / total) < 1, (pesos, n, cuotas)


@pytest.mark.parametrize("vector", VECTORES, ids=_ids)
def test_el_objetivo_sale_igual_en_los_dos_lenguajes(vector: Mapping[str, Any]) -> None:
    """El mayor resto de aquí, sobre los mismos pesos y globos, da el ``objetivo`` que escribió el original."""
    lista = vector["config"]["colores"]["lista"]
    assert _objetivo(lista, vector["resumenDisposicion"]["cuantos"]) == list(vector["objetivo"])


# ---------------------------------------------------------------------------
# Un vector completo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("vector", VECTORES, ids=_ids)
def test_normalizado_y_disposicion(vector: Mapping[str, Any]) -> None:
    """El diseño que el sistema usa —con ``cuotas: true`` dentro— y dónde quedó cada globo antes de pintarlo."""
    hecho = _calcular(vector)
    esperado = dict(vector["config"])
    esperado["tamanos"] = {
        **esperado["tamanos"],
        "mezcla": _claves_int(esperado["tamanos"]["mezcla"]),
    }
    assert hecho.cfg == esperado
    assert hecho.cfg["colores"]["cuotas"] is True
    assert {
        "capas": hecho.disp.capas,
        "sueltos": hecho.disp.sueltos,
        "cuantos": len(hecho.disp.bs),
    } == dict(vector["resumenDisposicion"])


@pytest.mark.parametrize("vector", VECTORES, ids=_ids)
def test_con_cuotas_cada_color_lleva_su_cuota(vector: Mapping[str, Any]) -> None:
    """Lo que se pidió: el conteo por color es exactamente el objetivo, en los tres repartos."""
    hecho = _calcular(vector)
    por_color = _por_color(hecho.con, len(hecho.cfg["colores"]["lista"]))
    assert por_color == list(vector["objetivo"])
    assert por_color == list(vector["conCuotas"]["porColor"])


@pytest.mark.parametrize("vector", VECTORES, ids=_ids)
def test_con_cuotas_resultado(vector: Mapping[str, Any]) -> None:
    """Dónde fue cada color, globo por globo, el conteo, la compra y el dibujo."""
    hecho = _calcular(vector)
    res = hecho.con
    esperado = vector["conCuotas"]

    assert len(res.globos) == esperado["cuantosGlobos"]
    # El color de cada globo en el orden en que se dibuja: si falla, la primera posición distinta dice dónde.
    assert [g.indice for g in res.globos] == list(esperado["indices"])
    assert sha(_como_json(_discretos(res))) == esperado["discretosSha"]
    assert res.conteo == [dict(c) for c in esperado["conteo"]]
    assert res.porTamano == _claves_int(esperado["porTamano"])

    compra = calcular_compra(res, hecho.cfg)
    quiere = esperado["compra"]
    assert [
        {**f, "porTamano": {int(k): v for k, v in f["porTamano"].items()}} for f in compra["filas"]
    ] == [{**dict(f), "porTamano": _claves_int(f["porTamano"])} for f in quiere["filas"]]
    assert compra["total"] == quiere["total"]

    assert len(res.svg) == esperado["svgLargo"]
    assert sha(res.svg) == esperado["svgSha"]
    if "svg" in vector:
        motor = _MOTORES[str(vector["estructura"])]
        assert svg_documento(res.svg, motor.titulo, *motor.lienzo) == vector["svg"]


@pytest.mark.parametrize("vector", VECTORES, ids=_ids)
def test_sin_cuotas_sigue_igual(vector: Mapping[str, Any]) -> None:
    """La misma paleta con la opción apagada: el reparto de siempre, con su desvío, exacto al original."""
    hecho = _calcular(vector)
    esperado = vector["sinCuotas"]
    assert _por_color(hecho.sin, len(hecho.cfg["colores"]["lista"])) == list(esperado["porColor"])
    assert sha(_como_json(_discretos(hecho.sin))) == esperado["discretosSha"]
    assert calcular_compra(hecho.sin, hecho.cfg)["total"] == esperado["compraTotal"]


@pytest.mark.parametrize("vector", VECTORES, ids=_ids)
def test_cuotas_solo_recolorea(vector: Mapping[str, Any]) -> None:
    """Con la opción o sin ella, los mismos globos en el mismo sitio y del mismo tamaño: solo cambia el color."""
    hecho = _calcular(vector)
    assert len(hecho.con.globos) == len(hecho.sin.globos)
    for i, (g, h) in enumerate(zip(hecho.con.globos, hecho.sin.globos, strict=True)):
        assert (g.x, g.y, g.r, g.capa, g.nominal) == (h.x, h.y, h.r, h.capa, h.nominal), (
            f"globo {i}"
        )
    assert hecho.con.porTamano == hecho.sin.porTamano


# ---------------------------------------------------------------------------
# La puerta
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("estructura", ["arco", "guirnalda", "columna"])
def test_la_puerta_solo_deja_pasar_cuotas_true(estructura: str) -> None:
    """``cuotas`` solo se enciende con ``true``; cualquier otro valor, o ninguno, deja el diseño de siempre."""
    motor = _MOTORES[estructura]
    lista = [{"hex": "#1d4ed8", "peso": 70, "acabado": "mate", "rol": "base"}]
    encendida = motor.normalizar({"colores": {"lista": lista, "cuotas": True}})
    assert encendida["colores"]["cuotas"] is True
    for raro in (1, "si", "true", None, {}, False):
        cfg = motor.normalizar({"colores": {"lista": lista, "cuotas": raro}})
        assert "cuotas" not in cfg["colores"], raro
    assert "cuotas" not in motor.normalizar({"colores": {"lista": lista}})["colores"]
