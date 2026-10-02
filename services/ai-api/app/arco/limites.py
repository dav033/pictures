"""Reglas para que un arco siempre parezca un arco.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/limites.ts``. Todas las combinaciones se validan
aquí: la interfaz limita cada control según los demás y ``sanear`` corrige cualquier estado imposible (por
ejemplo, uno que llega desde un enlace antiguo).
"""

from __future__ import annotations

import copy

from app.arco.color import normalizar_color
from app.arco.tipos import (
    INFLADO_PULG,
    MAX_SECUENCIA_ARCO,
    TAMANOS_GLOBO,
    CapaArco,
    Config,
    Globo,
    SeccionArco,
)
from app.motores.js import _coma, _maximo, _minimo, _piso, _redondear, _techo

PULGADA_M = 0.0254

ANCHO_MIN = 0.8
ANCHO_MAX = 10.0
ALTO_MIN = 0.8
ALTO_MAX = 6.0

#: Grosor de la banda respecto al ancho del arco: más que esto tapa la abertura y ya no se lee como arco.
RAZON_GROSOR_MAX = 0.36

#: Alto respecto al ancho: por debajo el arco es una tortilla; por encima, una torre.
_RAZON_ALTO_ARCO_ALTO_MIN = 0.45
_RAZON_ALTO_MAX = 2.0

#: Máximo de globos a lo ancho de la banda (por diseño de la interfaz y de la estructura).
_N_MAX = 8

#: El arcoíris admite más globos a lo ancho (varios por banda), siempre en múltiplos de sus bandas.
_N_MAX_ARCOIRIS = 16


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


def _arriba(valor: float) -> float:
    """Redondea hacia arriba a 0,1 m."""
    return float(_techo(valor * 10 - 1e-9)) / 10


def _abajo(valor: float) -> float:
    return float(_piso(valor * 10 + 1e-9)) / 10


def paso_m(gl: Globo, nominal: int | None = None) -> float:
    """Separación entre columnas de globos (m) para un tamaño de globo."""
    tamano = gl["nominal"] if nominal is None else nominal
    return float((INFLADO_PULG[tamano] * gl["inflado"] * PULGADA_M) / gl["tamano"])


def ancho_minimo(gl: Globo, n: float, nominal: int | None = None) -> float:
    """Ancho mínimo (m) del arco para que quepan ``n`` globos a lo ancho con ese tamaño."""
    return float(_maximo(ANCHO_MIN, _arriba((n * paso_m(gl, nominal)) / RAZON_GROSOR_MAX)))


def bandas(cfg: Config, nominal: int | None = None) -> int:
    """Bandas de color que el arco debe mostrar: solo el arcoíris, una por color. 0 en los demás patrones."""
    if cfg["patron"] != "arcoiris":
        return 0
    caben = _piso((RAZON_GROSOR_MAX * ANCHO_MAX) / paso_m(cfg["globo"], nominal))
    return int(_maximo(2, _minimo(_minimo(len(cfg["colores"]["arcoiris"]), caben), _N_MAX)))


def ancho_minimo_de(cfg: Config, nominal: int | None = None) -> float:
    """Ancho mínimo (m) con el patrón actual: 2 globos a lo ancho, o una banda por color en el arcoíris."""
    return ancho_minimo(cfg["globo"], _maximo(2, bandas(cfg, nominal)), nominal)


def limites(cfg: Config) -> dict[str, float]:
    """Rango permitido de cada control con el estado actual."""
    g = cfg["geometria"]
    gl = cfg["globo"]
    carriles = bandas(cfg)
    tope = _N_MAX_ARCOIRIS if carriles > 0 else _N_MAX
    n_tope = _maximo(2, _minimo(tope, _piso((RAZON_GROSOR_MAX * g["anchoM"]) / paso_m(gl))))

    n_paso = carriles if carriles > 0 else 1
    n_min = _maximo(2, carriles)
    n_max = _maximo(n_min, _piso(n_tope / carriles) * carriles) if carriles > 0 else n_tope

    alto_min = ALTO_MIN
    if g["forma"] == "alto":
        alto_min = _maximo(ALTO_MIN, _arriba(_RAZON_ALTO_ARCO_ALTO_MIN * g["anchoM"]))
    if g["forma"] == "herradura":
        alto_min = _maximo(ALTO_MIN, _arriba(g["anchoM"] / 2 + _maximo(0.25, 0.08 * g["anchoM"])))
    alto_max = _maximo(alto_min, _abajo(_minimo(ALTO_MAX, _RAZON_ALTO_MAX * g["anchoM"])))

    return {
        "anchoMin": ancho_minimo_de(cfg),
        "anchoMax": ANCHO_MAX,
        "altoMin": alto_min,
        "altoMax": alto_max,
        "nMin": n_min,
        "nMax": n_max,
        "nPaso": n_paso,
    }


def tamanos_que_caben(cfg: Config) -> dict[str, bool]:
    """Tamaños de globo que caben en el ancho actual (con el mínimo que pida el patrón)."""
    return {str(t): ancho_minimo_de(cfg, t) <= cfg["geometria"]["anchoM"] + 1e-9 for t in TAMANOS_GLOBO}


def sanear(entrada: Config) -> tuple[Config, list[str]]:
    """El mismo diseño corregido para que sea viable, y qué se cambió (en español, para mostrar).

    Orden de las correcciones: ancho dentro de su rango; ancho suficiente para el grosor (primero se reducen
    los globos a lo ancho, y solo si aun así no cabe, se sube el ancho); bandas del arcoíris; alto según la
    forma.
    """
    cfg: Config = copy.deepcopy(entrada)
    g = cfg["geometria"]
    gl = cfg["globo"]
    cambios: list[str] = []

    g["anchoM"] = _acotar(g["anchoM"], ANCHO_MIN, ANCHO_MAX)
    g["globosAncho"] = int(_redondear(_acotar(g["globosAncho"], 2, _N_MAX_ARCOIRIS)))

    # Ancho suficiente para la banda: con globos grandes (o muchas bandas de color) hace falta un arco más ancho.
    carriles = bandas(cfg)
    necesario = ancho_minimo_de(cfg)
    if g["anchoM"] < necesario - 1e-9:
        cambios.append(
            f"Un arcoíris de {carriles} bandas con globos R{gl['nominal']} necesita al menos "
            f"{_coma(necesario, 1)} m de ancho: se subió el ancho."
            if carriles > 0
            else f"Con globos R{gl['nominal']} el arco necesita al menos {_coma(necesario, 1)} m de ancho: "
            "se subió el ancho y quedaron 2 globos a lo ancho."
        )
        g["anchoM"] = _minimo(ANCHO_MAX, necesario)
        g["globosAncho"] = int(_maximo(2, carriles))

    # Globos a lo ancho dentro de lo que la banda permite.
    lim = limites(cfg)
    if g["globosAncho"] > lim["nMax"]:
        cambios.append(
            f"El máximo son {_entero(lim['nMax'])} globos a lo ancho: se redujeron."
            if lim["nMax"] == _N_MAX and carriles == 0
            else f"Con globos R{gl['nominal']} en {_coma(g['anchoM'], 1)} m caben como máximo "
            f"{_entero(lim['nMax'])} a lo ancho: se redujeron para que la banda no tape la abertura."
        )
        g["globosAncho"] = int(lim["nMax"])
    elif g["globosAncho"] < lim["nMin"]:
        cambios.append(f"El arcoíris necesita una banda por color: se subieron a {_entero(lim['nMin'])} los globos a lo ancho.")
        g["globosAncho"] = int(lim["nMin"])

    # Arcoíris: todas las bandas del mismo ancho, así que los globos a lo ancho son un múltiplo de las bandas.
    if carriles > 0 and g["globosAncho"] % carriles != 0:
        m = _minimo(lim["nMax"] / carriles, _maximo(1, _redondear(g["globosAncho"] / carriles)))
        g["globosAncho"] = int(m * carriles)
        cambios.append(
            f"En el arcoíris todas las bandas miden lo mismo: los globos a lo ancho pasaron a "
            f"{g['globosAncho']} ({_entero(m)} por banda)."
        )

    # Alto según la forma (el semicírculo lo deduce del ancho).
    if g["forma"] != "semi":
        lim2 = limites(cfg)
        alto = _acotar(g["altoM"], lim2["altoMin"], lim2["altoMax"])
        if abs(alto - g["altoM"]) > 1e-6:
            cambios.append(f"El alto se ajustó a {_coma(alto, 1)} m: fuera de ese rango el arco deja de parecer un arco.")
            g["altoM"] = alto

    # Capas: una por globo a lo ancho. Las personalizadas conservan su lugar; las que sobran se quitan.
    capas: list[CapaArco] = []
    for j in range(g["globosAncho"]):
        k = cfg["capas"][j] if j < len(cfg["capas"]) else None
        if not k or not isinstance(k.get("colores"), list) or len(k["colores"]) == 0:
            capas.append(None)
        else:
            capas.append({"colores": [normalizar_color(h, "#9ca3af") for h in k["colores"][:MAX_SECUENCIA_ARCO]]})
    cfg["capas"] = capas

    # Secciones por altura: hasta 40, cada una sin personalizar o con un color por capa a lo ancho.
    secciones: list[SeccionArco] = []
    for k2 in cfg["secciones"][:40]:
        if not k2 or not isinstance(k2.get("colores"), list) or len(k2["colores"]) == 0:
            secciones.append(None)
        else:
            secciones.append({"colores": [normalizar_color(h, "#9ca3af") for h in k2["colores"][:16]]})
    cfg["secciones"] = secciones

    return cfg, cambios


def _entero(valor: float) -> str:
    """Un número que en el original es entero, escrito sin el ``.0`` de Python."""
    return str(int(valor)) if float(valor).is_integer() else repr(float(valor))
