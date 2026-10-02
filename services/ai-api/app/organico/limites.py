"""Reglas para que un arco orgánico siempre parezca un arco.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/limites.ts``.

De aquí la guirnalda usa **solo** ``tamanos_permitidos``: qué tamaños de globo caben en el grosor elegido.
Lo demás (``limites`` y ``sanear``) es del arco, que tiene sus propias proporciones; la guirnalda las suyas en
``app.guirnalda.limites``.

Los redondeos van a **décimas** (``*10``), no a 5 cm como los de la guirnalda: no se unifican porque cada
estructura ofrece su propio paso en la interfaz.
"""

from __future__ import annotations

from typing import Any

from app.motores.js import _coma, _es_finito, _maximo, _minimo, _numero, _piso, _redondear, _techo
from app.organico.motor import MAX_GLOBOS, estimar_globos
from app.organico.tipos import TAMANOS_GLOBO, ConfigOrg, diametro_m

ANCHO_MIN = 1.5
ANCHO_MAX = 10
ALTO_MAX = 6
GROSOR_MIN = 0.35
GROSOR_TOPE = 1.6

#: Grosor respecto al ancho: más que esto tapa la abertura y ya no se lee como arco.
_RAZON_GROSOR_MAX = 0.36
_RAZON_ALTO_MIN = 0.4
_RAZON_ALTO_MAX = 1.8

#: Un tamaño solo entra si mide, como mucho, esta fracción del grosor mayor (los grandes pueden igualarlo).
_RAZON_TAMANO = 1


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


def _arriba(valor: float) -> float:
    return float(_techo(valor * 10 - 1e-9)) / 10


def _abajo(valor: float) -> float:
    return float(_piso(valor * 10 + 1e-9)) / 10


def limites(cfg: ConfigOrg) -> dict[str, float]:
    """Rango permitido de cada control del arco con el estado actual."""
    f = cfg["forma"]
    v = cfg["volumen"]
    grosor_max = _minimo(GROSOR_TOPE, _abajo(_RAZON_GROSOR_MAX * f["anchoM"]))
    alto_min = _maximo(
        _maximo(1, _arriba(_RAZON_ALTO_MIN * f["anchoM"])), _arriba(v["grosorCimaM"] / 2 + 0.7)
    )
    alto_max = _maximo(alto_min, _abajo(_minimo(ALTO_MAX, _RAZON_ALTO_MAX * f["anchoM"])))
    return {
        "anchoMin": ANCHO_MIN,
        "anchoMax": ANCHO_MAX,
        "altoMin": alto_min,
        "altoMax": alto_max,
        "grosorPatasMin": GROSOR_MIN,
        "grosorPatasMax": grosor_max,
        "grosorCimaMin": _maximo(GROSOR_MIN, _arriba(v["grosorPatasM"] * 0.5)),
        "grosorCimaMax": _minimo(grosor_max, _abajo(v["grosorPatasM"] * 1.6)),
    }


def tamanos_permitidos(cfg: dict[str, Any]) -> dict[int, bool]:
    """Qué tamaños de globo caben con el grosor actual.

    El grosor que manda es el **mayor** de los dos: en una guirnalda, el del centro si es más gordo que el de
    los extremos. El ``1e-9`` deja pasar el tamaño que mide exactamente el grosor.
    """
    g = _maximo(cfg["volumen"]["grosorPatasM"], cfg["volumen"]["grosorCimaM"])
    return {
        t: diametro_m(t, cfg["tamanos"]["inflado"]) <= _RAZON_TAMANO * g + 1e-9
        for t in TAMANOS_GLOBO
    }


def grosor_para_tamano(t: int, inflado: float) -> float:
    """Grosor mínimo (m) de la banda para que entre un tamaño de globo."""
    return _arriba(diametro_m(t, inflado) / _RAZON_TAMANO)


def sanear(entrada: ConfigOrg) -> tuple[ConfigOrg, list[str]]:
    """El mismo diseño de arco corregido para que sea viable, y qué se cambió (en español, para mostrar).

    Orden: ancho; grosores; alto; tamaños que caben; cantidad total de globos.
    """
    cfg: ConfigOrg = dict(entrada)
    cfg["forma"] = dict(entrada["forma"])
    cfg["volumen"] = dict(entrada["volumen"])
    cfg["tamanos"] = {**entrada["tamanos"], "mezcla": dict(entrada["tamanos"]["mezcla"])}
    cfg["colores"] = {**entrada["colores"], "lista": [dict(c) for c in entrada["colores"]["lista"]]}
    f = cfg["forma"]
    v = cfg["volumen"]
    t = cfg["tamanos"]
    cambios: list[str] = []

    f["anchoM"] = _acotar(f["anchoM"], ANCHO_MIN, ANCHO_MAX)
    f["cima"] = _acotar(f["cima"], 0.3, 0.7)
    f["curva"] = _acotar(f["curva"], 1.7, 3.4)
    f["ondulacion"] = _acotar(f["ondulacion"], 0, 1)
    f["carga"] = _acotar(f["carga"], -1, 1)
    f["corte"] = _acotar(f["corte"], 0.55, 1)

    v["irregularidad"] = _acotar(v["irregularidad"], 0, 0.8)
    v["relleno"] = _acotar(v["relleno"], 0.4, 0.95)
    v["racimo"] = _redondear(_acotar(v["racimo"], 2, 6))
    v["salientes"] = _acotar(v["salientes"], 0, 1)
    t["grandesAbajo"] = _acotar(t["grandesAbajo"], 0, 1)
    t["inflado"] = _acotar(t["inflado"], 0.8, 1.1)
    t["variacion"] = _acotar(t["variacion"], 0, 0.25)
    cfg["adornos"] = {
        "follaje": _acotar(cfg["adornos"]["follaje"], 0, 3),
        "flores": _acotar(cfg["adornos"]["flores"], 0, 3),
    }

    # Grosores: dentro del ancho, y la cima ni muy delgada ni muy gorda respecto a las patas.
    tope = _minimo(GROSOR_TOPE, _abajo(_RAZON_GROSOR_MAX * f["anchoM"]))
    patas = _acotar(v["grosorPatasM"], GROSOR_MIN, tope)
    if abs(patas - v["grosorPatasM"]) > 1e-6:
        cambios.append(
            f"En {_coma(f['anchoM'], 1)} m de ancho el grosor no puede pasar de {_coma(tope, 2)} m:"
            " se ajustó para que la banda no tape la abertura."
        )
    v["grosorPatasM"] = patas
    cima_min = _maximo(GROSOR_MIN, patas * 0.5)
    cima_max = _minimo(tope, patas * 1.6)
    cima = _acotar(v["grosorCimaM"], _minimo(cima_min, cima_max), _maximo(cima_min, cima_max))
    if abs(cima - v["grosorCimaM"]) > 1e-6:
        cambios.append(
            f"El grosor de la cima se ajustó a {_coma(cima, 2)} m: no puede ser muy distinto al de las patas."
        )
    v["grosorCimaM"] = cima

    # Alto según el ancho y el grosor.
    lim = limites(cfg)
    alto = _acotar(f["altoM"], lim["altoMin"], lim["altoMax"])
    if abs(alto - f["altoM"]) > 1e-6:
        cambios.append(
            f"El alto se ajustó a {_coma(alto, 1)} m: fuera del rango {_coma(lim['altoMin'], 1)}–"
            f"{_coma(lim['altoMax'], 1)} m el arco deja de parecer un arco."
        )
    f["altoM"] = alto

    # Tamaños de globo que no caben en el grosor: se quitan de la mezcla.
    permitidos = tamanos_permitidos(cfg)
    quitados: list[str] = []
    for k in TAMANOS_GLOBO:
        t["mezcla"][k] = _acotar(t["mezcla"][k] if _es_finito(t["mezcla"][k]) else 0, 0, 100)
        if not permitidos[k] and t["mezcla"][k] > 0:
            quitados.append(f"R{k}")
            t["mezcla"][k] = 0
    if quitados:
        cambios.append(
            f"{', '.join(quitados)} {'no caben' if len(quitados) > 1 else 'no cabe'} en ese grosor:"
            " se quitó de la mezcla."
        )
    if all(t["mezcla"][k] == 0 for k in TAMANOS_GLOBO):
        t["mezcla"][12] = 100
        cambios.append("La mezcla no puede quedar vacía: se puso R12.")

    # Cantidad total de globos.
    pasos = 0
    while estimar_globos(cfg) > MAX_GLOBOS and v["relleno"] > 0.4 and pasos < 30:
        v["relleno"] = _redondear((v["relleno"] - 0.02) * 100) / 100
        pasos += 1
    if pasos > 0:
        cambios.append(
            f"Con ese tamaño y grosor harían falta más de {MAX_GLOBOS} globos:"
            f" se bajó el relleno a {_numero(_redondear(v['relleno'] * 100))} %."
        )

    # Colores: entre 1 y 8, con proporción válida.
    cfg["colores"]["lista"] = [
        {**c, "peso": _redondear(_acotar(c["peso"], 1, 100))} for c in cfg["colores"]["lista"][:8]
    ]
    if not cfg["colores"]["lista"]:
        cfg["colores"]["lista"] = [{"hex": "#9fb59a", "peso": 50, "acabado": "mate", "rol": "base"}]
    cfg["colores"]["mezcla"] = _acotar(cfg["colores"]["mezcla"], 0, 1)

    return cfg, cambios
