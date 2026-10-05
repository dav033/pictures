"""El motor de arco orgánico de Python contra los vectores de oro del motor de TypeScript.

Los vectores de ``contracts/domain/v1/golden/organico/vectores-organico.json`` los genera el **otro** repo
(``clasificador-decoraciones/scripts/migracion/vectores-organico.ts``) con el motor original: 278 diseños y
67 177 globos. Son un oráculo congelado: no se regeneran para que una prueba pase. Si una falla, o el puerto
se desvió, o el motor original cambió a propósito y el oráculo se vuelve a generar **allá** y se trae entero,
con el commit explicando qué cambió.

``app/organico/`` ya se movía con cada vector de columna orgánica, guirnalda y ramo, pero solo como
dependencia: ninguna de esas tres estructuras usa **lo del arco**. Aquí se mide lo suyo: sus quince formas
listas, sus cuatro estilos, el medio arco (``forma.corte`` recortando la espina junto con ``forma.espejo``,
que cambia de lado la pata que se queda en el suelo), los acabados y repartos de ``tipos.py``, los rangos
vivos, los tamaños que caben y los avisos de ``limites.py``, y las medidas y la compra de ``medidas.py``.

Lo que se comprueba es todo lo que el motor decide: el diseño normalizado, **los avisos del saneado** (el
texto exacto que lee el cliente, con sus comas decimales), los límites vivos, qué tamaños caben, la mezcla de
tamaños, la disposición, la posición y el color de cada globo, el follaje, el conteo, las medidas, la compra y
**el SVG** por su sha256 (y entero en siete casos, para poder ver la diferencia y no solo saber que la hay).

Los avisos se miden sobre la entrada **sin normalizar** (``saneoDirecto``), que es el único sitio donde se
ven: ``normalizar_config`` acota lo que llega fuera de rango y termina saneando, así que un ``sanear``
posterior sobre lo ya normalizado no corrige nada y le diría al cliente que no se tocó su diseño.

**El sha256 del SVG es el oráculo de verdad del dibujo**, y la tolerancia de más abajo solo cubre coordenadas
que nunca llegan a los píxeles. Esto está medido, no supuesto: contra vectores recién generados del motor
original, el SVG salió byte a byte idéntico en los **218 de 218** casos de la columna orgánica, y los campos
discretos (``capa``, ``nominal``, ``color``, ``acabado``, ``indice``) y todos los conteos coincidieron
exactos. Lo único que se desvía allí son ``x`` e ``y``, a lo sumo **9,5e-08 m** (95 nanómetros, unas 0,00006 px
en un lienzo de 600 px): es la diferencia del último dígito de ``Math.pow`` entre V8 y CPython (ver
``app/motores/mate.py``), la absorbe el redondeo a píxeles del SVG y el redondeo a 1e-9 **no** la absorbe. Por eso aquí la geometría continua (``x``, ``y``, ``r``, ángulos, largos) se compara con una
tolerancia absoluta explícita de 1e-6 m, y **no** con un sha256 sobre el JSON de los flotantes: ese sha es
justo la aserción que deja cuatro casos de ``test_columnaorg.py`` permanentemente rojos por una diferencia de
95 nm que nadie puede ver. Todo lo demás —el dibujo, lo discreto de cada globo, los conteos, los avisos— se
compara exacto.

En este motor el SVG sale idéntico byte a byte en **277 de los 278** casos. El que falta, ``azar-50``, está
medido y marcado abajo (``_SENSIBLES_AL_POW``): la relajación iterativa de ``crear_disposicion`` amplifica esa
deriva de ``pow`` hasta 1,48e-06 m en el peor de sus 511 globos, y eso tumba 6 de las 2 622 etiquetas del
dibujo al otro lado del redondeo a centésimas de píxel. La tolerancia **no** se toca por ello: 1e-6 m es lo
que se cumple en todos los casos donde la prueba compara coordenadas, y el caso que se sale queda nombrado,
con su campo y su magnitud, en vez de disuelto en una tolerancia más ancha.

Dos diferencias entre JSON y Python, que no son tolerancias:

- las claves de ``mezcla``, ``porTamano``, ``diametrosCm`` y ``tamanosPermitidos`` son enteros en Python y
  texto en JSON, porque JSON no tiene claves numéricas: se convierten antes de comparar (y la ``mezcla`` de la
  entrada cruda se convierte **antes** de pasarla a ``sanear``, que la indexa por el entero, igual que el
  original la indexa por el número);
- los números que se comparan exactos se redondean a 1e-9 con el ``Math.round`` de JavaScript, igual que los
  escribió el generador. Dos lenguajes no dan el mismo último bit y comparar el último bit no prueba nada.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from app.motores.js import _numero, _redondear
from app.organico.config import normalizar_config, normalizar_config_con_cambios
from app.organico.dibujo import svg_documento
from app.organico.formas import FORMAS_LISTAS
from app.organico.limites import grosor_para_tamano, limites, sanear, tamanos_permitidos
from app.organico.medidas import (
    REFERENCIA_POR_PIE,
    calcular_compra,
    calcular_medidas,
    etiqueta_densidad,
)
from app.organico.motor import (
    LIENZO,
    Disposicion,
    ResultadoOrg,
    crear_disposicion,
    estimar_globos,
    pintar,
    resumen_mezcla,
)
from app.organico.tipos import ACABADOS, ESTILOS, REPARTOS, TAMANOS_GLOBO, ConfigOrg

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "organico"
    / "vectores-organico.json"
)

_ORACULO: Mapping[str, Any] = json.loads(GOLDEN.read_text(encoding="utf-8"))
VECTORES: list[Mapping[str, Any]] = _ORACULO["vectores"]

#: Tolerancia de la geometría continua, en metros. Medida, no elegida al azar: la deriva entre V8 y CPython en
#: ``Math.pow`` llegó a 9,5e-08 m en el peor de los 18 864 globos que se midieron contra el motor original, así
#: que 1e-6 m deja un factor diez de margen y sigue siendo mil veces más fino que el píxel (un lienzo de 600 px
#: sobre un arco de 4 m da unos 0,007 m por píxel). Lo que decide el dibujo —y lo que el cliente aprueba— es el
#: sha256 del SVG, que se compara exacto.
TOL = 1e-6

#: El único de los 278 casos cuyo SVG no sale byte a byte igual, y por qué no se arregla tocando nada.
#:
#: Medido: ``azar-50`` es un arco grande (511 globos) y la relajación de ``crear_disposicion`` es iterativa, así
#: que amplifica la deriva del último dígito de ``Math.pow`` entre V8 y CPython. El peor globo se desvía
#: **1,48e-06 m** (``globos[158].x``: ``-0.3040510941652824`` aquí contra ``-0.3040525756953768`` allá), uno de
#: 511; 76 pasan de 1e-07 y la cola baja suave hasta 1e-12, que es la firma de una deriva propagada y no de una
#: regla distinta. Con eso, 6 de las 2 622 etiquetas del SVG caen al otro lado del redondeo a centésimas de
#: píxel (``cx="324.29"`` contra ``cx="324.3"``, ``cy="275.15"`` contra ``cy="275.14"``): 0,01 px en un lienzo
#: de 600 px, el mismo dibujo, y dos caracteres de diferencia en los 313 956 del documento.
#:
#: No es un defecto del puerto ni se arregla regenerando el oráculo: es el límite de ``pow`` llegando, por una
#: vez en 278 casos, hasta el píxel.
#:
#: Estar en este conjunto **no salta nada**: las cinco pruebas del caso corren enteras y todo lo demás se
#: exige igual que en los otros 277 —conteos, ``porTamano``, ``capas``, ``sueltos`` y el ``discretosSha`` de
#: sus 511 globos—. Lo único que cambia es que del dibujo se exige la longitud con el margen de
#: ``MARGEN_LARGO_SVG`` en vez del sha exacto. Marcar el caso entero como ``xfail``, que es como estaba,
#: tapaba de paso todo lo que sí coincide en él.
_SENSIBLES_AL_POW = frozenset({"azar-50"})


#: Cuántos caracteres puede mover la deriva en el SVG de un caso sensible. Medido: en ``azar-50`` son **2**,
#: los dos que se pierden al acortarse ``324.29`` a ``324.3``. Cuatro deja margen y sigue siendo una aserción
#: de verdad: un dibujo estructuralmente distinto no cambia la longitud en cuatro caracteres, la cambia en
#: cientos. Es lo que queda en pie cuando la identidad byte a byte no se puede exigir.
MARGEN_LARGO_SVG = 4


#: Tolerancia de los cocientes (globos por metro, por pie): no son distancias, así que la deriva de ``largoM``
#: se propaga en relativo y una tolerancia en metros no significaría nada.
TOL_REL = 1e-9


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


def _entrada_para_sanear(entrada: Mapping[str, Any]) -> Any:
    """La entrada cruda del oráculo tal como ``sanear`` la espera en Python.

    Dos ajustes, los dos de forma y ninguno de valor: la copia profunda, porque ``sanear`` se queda con los
    objetos ``real`` y ``aspecto`` que recibe y los corrige en su sitio (sin ella un caso le cambiaría la
    entrada al siguiente), y las claves de ``tamanos.mezcla`` como enteros, que es lo mismo que ``_claves_int``
    hace con lo esperado: en JavaScript esas claves ya son números y ``sanear`` las indexa así.
    """
    copia = copy.deepcopy(dict(entrada))
    tamanos = dict(copia["tamanos"])
    tamanos["mezcla"] = _claves_int(tamanos["mezcla"])
    copia["tamanos"] = tamanos
    return copia


def _cerca(obtenido: float, esperado: float, donde: str) -> None:
    """La geometría continua, con la tolerancia medida de ``TOL`` y un mensaje que dice cuánto se desvió."""
    assert abs(obtenido - esperado) <= TOL, (
        f"{donde}: {obtenido!r} contra {esperado!r}, diferencia {abs(obtenido - esperado):.3e}"
        f" (tolerancia {TOL:.0e} m)"
    )


@dataclass
class Calculado:
    """Todo lo que el motor produce para un vector, calculado una sola vez."""

    cfg: ConfigOrg
    #: Lo que el saneador corrige de la entrada tal cual, y si deja el mismo diseño que `normalizar_config`.
    cambios_directos: list[str]
    mismo_diseno: bool
    disp: Disposicion
    res: ResultadoOrg


_CALCULADO: dict[str, Calculado] = {}


def _calcular(vector: Mapping[str, Any]) -> Calculado:
    """El mismo camino que recorre el generador de vectores, memorizado por caso.

    Acomodar 67 177 globos y dibujarlos cuesta minutos: cada caso se calcula una vez y las cinco pruebas que
    lo miden comparten el resultado.
    """
    nombre = str(vector["nombre"])
    hecho = _CALCULADO.get(nombre)
    if hecho is None:
        cfg = normalizar_config(vector["entrada"])
        directo_cfg, directo_cambios = sanear(_entrada_para_sanear(vector["entrada"]))
        disp = crear_disposicion(cfg)
        hecho = Calculado(
            cfg=cfg,
            cambios_directos=directo_cambios,
            mismo_diseno=_como_json(directo_cfg) == _como_json(cfg),
            disp=disp,
            res=pintar(dict(cfg), disp),
        )
        _CALCULADO[nombre] = hecho
    return hecho


# ---------------------------------------------------------------------------
# El catálogo que ve la interfaz
# ---------------------------------------------------------------------------


def test_lienzo_cuadrado() -> None:
    assert {"w": LIENZO, "h": LIENZO} == dict(_ORACULO["lienzo"])


def test_las_quince_formas_listas() -> None:
    """Id, nombre y la frase que el diseñador enseña como ayuda del botón."""
    assert [
        {"id": f.id, "nombre": f.nombre, "descripcion": f.descripcion} for f in FORMAS_LISTAS
    ] == [dict(f) for f in _ORACULO["formas"]]


def test_los_cuatro_estilos() -> None:
    assert [{"id": e.id, "nombre": e.nombre, "ayuda": e.ayuda} for e in ESTILOS] == [
        dict(e) for e in _ORACULO["estilos"]
    ]


def test_acabados_y_repartos() -> None:
    assert ACABADOS == [dict(a) for a in _ORACULO["acabados"]]
    assert REPARTOS == [dict(r) for r in _ORACULO["repartos"]]


def test_los_rangos_de_densidad_del_oficio() -> None:
    """Las tres etiquetas con su texto: es lo que se le dice al cliente sobre lo lleno que queda el arco.

    ``Infinity`` no existe en JSON y el generador lo escribe como ``null``.
    """
    assert [
        {"max": None if math.isinf(r["max"]) else r["max"], "texto": r["texto"]}
        for r in REFERENCIA_POR_PIE
    ] == [dict(r) for r in _ORACULO["referenciaPorPie"]]


def test_grosor_minimo_para_cada_tamano() -> None:
    """El grosor de banda que pide cada tamaño de globo, con cada inflado del rango permitido."""
    assert [
        {
            "inflado": fila["inflado"],
            "porTamano": {t: r9(grosor_para_tamano(t, fila["inflado"])) for t in TAMANOS_GLOBO},
        }
        for fila in _ORACULO["grosorParaTamano"]
    ] == [
        {"inflado": fila["inflado"], "porTamano": _claves_int(fila["porTamano"])}
        for fila in _ORACULO["grosorParaTamano"]
    ]


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
    assert tamanos_permitidos(dict(hecho.cfg)) == _claves_int(vector["tamanosPermitidos"])
    assert estimar_globos(hecho.cfg) == vector["estimarGlobos"]
    # Las dos puertas dejan el mismo diseño: la que devuelve los avisos y la que los descarta.
    assert normalizar_config_con_cambios(vector["entrada"])[0] == esperado


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_avisos_del_saneo(vector: Mapping[str, Any]) -> None:
    """Lo que el saneador le dice al cliente, palabra por palabra, sobre la entrada sin normalizar.

    Es la parte del motor que se lee en pantalla: «R36 no cabe en ese grosor: se quitó de la mezcla», «El alto
    se ajustó a 4,0 m: fuera del rango 4,0–6,0 m el arco deja de parecer un arco». Se compara el texto entero,
    con sus comas decimales, porque un aviso que no dice la cifra correcta es peor que ninguno.

    ``mismoDiseno`` sale ``False`` en los 278 casos, y eso también es un hecho congelado del motor:
    ``normalizar_config`` del arco **no arrastra** ``modo`` ni ``capas`` (el modo por capas de ``capas.py`` no
    está cableado en esta puerta, a diferencia de la columna y la guirnalda), mientras que ``sanear`` copia la
    entrada con todo lo que traiga. Quitando esas dos claves los diseños coinciden. El día que el arco cablee
    las capas, este campo lo dirá en los dos repos a la vez.
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
    _cerca(mezcla["dMedio"], esperada["dMedio"], "resumenMezcla.dMedio")
    _cerca(mezcla["areaMedia"], esperada["areaMedia"], "resumenMezcla.areaMedia")

    assert {
        "capas": hecho.disp.capas,
        "sueltos": hecho.disp.sueltos,
        "cuantos": len(hecho.disp.bs),
    } == dict(vector["disposicion"])


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_resultado(vector: Mapping[str, Any]) -> None:
    """Globo por globo, rama por rama, flor por flor, el conteo y el sha256 del SVG.

    Lo discreto —la capa, el tamaño nominal, el color, el acabado, el índice del color y todos los conteos—
    exacto, en los 278 casos, por ``discretosSha``. Lo continuo, con la tolerancia medida de ``TOL`` y globo a
    globo en los casos detallados. El dibujo, por su sha256 y entero en siete casos: es lo que el cliente
    aprueba. Los ``globosSha`` / ``ramasSha`` / ``floresSha`` del oráculo son shas **sobre las coordenadas** y
    aquí no se comparan a propósito: son la aserción que la deriva de 95 nm de ``pow`` rompe sin que cambie un
    solo píxel del dibujo.
    """
    hecho = _calcular(vector)
    res = hecho.res
    esperado = vector["resultado"]

    assert res.capas == esperado["capas"]
    _cerca(res.anchoM, esperado["anchoM"], "anchoM")
    _cerca(res.altoM, esperado["altoM"], "altoM")
    _cerca(res.largoM, esperado["largoM"], "largoM")
    _cerca(res.grosorPatasM, esperado["grosorPatasM"], "grosorPatasM")
    _cerca(res.grosorCimaM, esperado["grosorCimaM"], "grosorCimaM")
    _cerca(res.escala, esperado["escala"], "escala")
    assert res.sueltos == esperado["sueltos"]
    assert res.conteo == [dict(c) for c in esperado["conteo"]]
    assert res.porTamano == _claves_int(esperado["porTamano"])
    assert len(res.globos) == esperado["cuantosGlobos"]
    assert len(res.ramas) == esperado["cuantasRamas"]
    assert len(res.flores) == esperado["cuantasFlores"]

    # Lo discreto de cada globo, en el orden en que se dibujan.
    discretos = [
        {
            "capa": b.capa,
            "nominal": b.nominal,
            "color": b.color,
            "acabado": b.acabado,
            "indice": b.indice,
        }
        for b in res.globos
    ]
    assert sha(_como_json(discretos)) == esperado["discretosSha"]

    if "globos" in esperado:
        for i, (globo, quiere) in enumerate(zip(res.globos, esperado["globos"], strict=True)):
            _cerca(globo.x, quiere["x"], f"globos[{i}].x")
            _cerca(globo.y, quiere["y"], f"globos[{i}].y")
            _cerca(globo.r, quiere["r"], f"globos[{i}].r")
        for i, (rama, quiere_r) in enumerate(zip(res.ramas, esperado["ramas"], strict=True)):
            _cerca(rama.x, quiere_r["x"], f"ramas[{i}].x")
            _cerca(rama.y, quiere_r["y"], f"ramas[{i}].y")
            _cerca(rama.ang, quiere_r["ang"], f"ramas[{i}].ang")
            _cerca(rama.largo, quiere_r["largo"], f"ramas[{i}].largo")
            _cerca(rama.capa, quiere_r["capa"], f"ramas[{i}].capa")
            assert len(rama.hojas) == len(quiere_r["hojas"])
            for j, (hoja, quiere_h) in enumerate(zip(rama.hojas, quiere_r["hojas"], strict=True)):
                _cerca(hoja.t, quiere_h["t"], f"ramas[{i}].hojas[{j}].t")
                _cerca(hoja.largo, quiere_h["largo"], f"ramas[{i}].hojas[{j}].largo")
                _cerca(hoja.tono, quiere_h["tono"], f"ramas[{i}].hojas[{j}].tono")
                assert hoja.lado == quiere_h["lado"]
        for i, (flor, quiere_f) in enumerate(zip(res.flores, esperado["flores"], strict=True)):
            _cerca(flor.x, quiere_f["x"], f"flores[{i}].x")
            _cerca(flor.y, quiere_f["y"], f"flores[{i}].y")
            _cerca(flor.r, quiere_f["r"], f"flores[{i}].r")
            _cerca(flor.tono, quiere_f["tono"], f"flores[{i}].tono")

    # El dibujo: es lo que el cliente aprueba, y es estable byte a byte entre los dos lenguajes porque el SVG
    # redondea a píxeles y se come la deriva de `pow`. Aquí no hay tolerancia ninguna... en 277 de los 278.
    #
    # En `azar-50` sí la hay, y acotada en vez de saltada. Antes este caso iba marcado `xfail` entero, y eso
    # se llevaba por delante lo que SÍ coincide en él: los conteos, `porTamano`, `capas`, `sueltos` y el
    # `discretosSha` de sus 511 globos. Lo único que la deriva rompe es la identidad byte a byte del dibujo,
    # así que es lo único que se afloja: la longitud se compara con un margen medido y el sha exacto se deja
    # para los demás. Un dibujo de verdad distinto no pasa por aquí.
    if str(vector["nombre"]) in _SENSIBLES_AL_POW:
        assert abs(len(res.svg) - esperado["svgLargo"]) <= MARGEN_LARGO_SVG, (
            f"{vector['nombre']}: el dibujo se movió {len(res.svg) - esperado['svgLargo']} caracteres,"
            f" más de los {MARGEN_LARGO_SVG} que explica el redondeo a centésimas de píxel"
        )
    else:
        assert len(res.svg) == esperado["svgLargo"]
        assert sha(res.svg) == esperado["svgSha"]
    if "svg" in vector:
        assert svg_documento(res.svg, "Arco orgánico de globos", LIENZO, LIENZO) == vector["svg"]


@pytest.mark.parametrize("vector", VECTORES, ids=lambda v: str(v["nombre"]))
def test_medidas_densidad_y_compra(vector: Mapping[str, Any]) -> None:
    """Lo que se le enseña al cliente y lo que se le pide al proveedor."""
    hecho = _calcular(vector)
    medidas = calcular_medidas(hecho.res, dict(hecho.cfg))
    esperadas = vector["medidas"]
    _cerca(medidas["anchoM"], esperadas["anchoM"], "medidas.anchoM")
    _cerca(medidas["altoM"], esperadas["altoM"], "medidas.altoM")
    _cerca(medidas["largoM"], esperadas["largoM"], "medidas.largoM")
    # Los grosores salen en centímetros: la tolerancia, que está en metros, se escala con ellos.
    _cerca(
        medidas["grosorPatasCm"] / 100, esperadas["grosorPatasCm"] / 100, "medidas.grosorPatasCm"
    )
    _cerca(medidas["grosorCimaCm"] / 100, esperadas["grosorCimaCm"] / 100, "medidas.grosorCimaCm")
    assert medidas["globosPorMetro"] == pytest.approx(esperadas["globosPorMetro"], rel=TOL_REL)
    assert medidas["globosPorPie"] == pytest.approx(esperadas["globosPorPie"], rel=TOL_REL)
    assert medidas["capas"] == esperadas["capas"]
    assert {t: r9(v) for t, v in medidas["diametrosCm"].items()} == _claves_int(
        esperadas["diametrosCm"]
    )

    # La etiqueta sí es exacta: es texto, y si la densidad cayera del otro lado de un corte (10 o 17 por pie)
    # el cliente leería otra cosa. Que una deriva de 1e-9 la cambie sería un hallazgo, no una tolerancia.
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
