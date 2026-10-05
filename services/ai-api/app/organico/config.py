"""Lectura de un diseño de arco orgánico que llega de fuera (enlace, almacenamiento). Nunca lanza.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/config.ts``.

La guirnalda no pasa por aquí: tiene su propio ``normalizar_config`` en ``app.guirnalda.limites``, con sus
campos de forma. Lo que sí comparten es la regla: lo que falte se completa con el valor por defecto, lo
imposible se corrige y al final se sanea.
"""

from __future__ import annotations

from typing import Any, cast

from app.arco.color import normalizar_color
from app.motores.js import _es_finito, _maximo, _minimo, _redondear
from app.organico.limites import sanear
from app.organico.tipos import (
    ACABADOS,
    REPARTOS,
    TAMANOS_GLOBO,
    ColorOrg,
    ConfigOrg,
    config_inicial,
)


def _num(valor: object, respaldo: float) -> float:
    """``Number.isFinite``: un ``NaN``, un infinito o algo que no es número caen al respaldo."""
    return float(cast(float, valor)) if _es_finito(valor) else respaldo


def _obj(valor: object) -> dict[str, Any]:
    return valor if isinstance(valor, dict) else {}


def _peso_mezcla(crudo: dict[Any, Any], t: int, respaldo: float) -> float:
    """El peso de un tamaño en la mezcla que llega de fuera.

    En JavaScript ``mezcla[12]`` encuentra la clave ``"12"`` porque el objeto solo tiene claves de texto; un
    diccionario de Python no, y un diseño que llega por el enlace (JSON) las trae así. Dentro del motor las
    claves son los enteros de ``TAMANOS_GLOBO``, así que aquí se aceptan las dos formas.
    """
    if t in crudo:
        return _num(crudo[t], respaldo)
    return _num(crudo.get(str(t)), respaldo)


def normalizar_config(entrada: object) -> ConfigOrg:
    """Convierte cualquier cosa en un diseño de arco orgánico válido."""
    return normalizar_config_con_cambios(entrada)[0]


def normalizar_config_con_cambios(entrada: object) -> tuple[ConfigOrg, list[str]]:
    """Lo mismo, **y lo que hubo que corregir** para que el arco fuera posible.

    Existe por lo mismo que sus gemelas de ``app.guirnalda.limites`` y ``app.columnaorg.limites``: el saneado
    es la última línea de ``normalizar_config`` y sus avisos se perdían ahí dentro, así que quien llamaba
    después a ``sanear`` sobre el resultado ya normalizado recibía una lista vacía —el diseño ya estaba
    corregido— y le decía al cliente que no se había tocado nada. Un arco al que se le quitó el R24 de la
    mezcla porque no cabe en ese grosor, o cuyo alto se ajustó, tiene que decirlo.

    No cambia el comportamiento de ``normalizar_config``: el original (``src/lib/organico/config.ts``) no
    tiene esta función porque allá el diseñador sanea en la interfaz.
    """
    base = config_inicial()
    e = _obj(entrada)
    forma = _obj(e.get("forma"))
    volumen = _obj(e.get("volumen"))
    tamanos = _obj(e.get("tamanos"))
    mezcla = _obj(tamanos.get("mezcla"))
    colores = _obj(e.get("colores"))
    adornos = _obj(e.get("adornos"))
    aspecto = _obj(e.get("aspecto"))
    real = _obj(e.get("real"))

    lista: list[ColorOrg]
    if isinstance(colores.get("lista"), list):
        lista = []
        for i, c in enumerate(colores["lista"][:8]):
            o = _obj(c)
            respaldo = base["colores"]["lista"][i % len(base["colores"]["lista"])]
            lista.append(
                {
                    "hex": normalizar_color(o.get("hex"), respaldo["hex"]),
                    "peso": _num(o.get("peso"), 20),
                    "acabado": o["acabado"]
                    if any(a["valor"] == o.get("acabado") for a in ACABADOS)
                    else "mate",
                    "rol": "acento" if o.get("rol") == "acento" else "base",
                }
            )
    else:
        lista = base["colores"]["lista"]

    cfg: ConfigOrg = {
        "forma": {
            "anchoM": _num(forma.get("anchoM"), base["forma"]["anchoM"]),
            "altoM": _num(forma.get("altoM"), base["forma"]["altoM"]),
            "cima": _num(forma.get("cima"), base["forma"]["cima"]),
            "curva": _num(forma.get("curva"), base["forma"]["curva"]),
            "ondulacion": _num(forma.get("ondulacion"), base["forma"]["ondulacion"]),
            "carga": _num(forma.get("carga"), base["forma"]["carga"]),
            "corte": _num(forma.get("corte"), base["forma"]["corte"]),
            "espejo": forma["espejo"]
            if isinstance(forma.get("espejo"), bool)
            else base["forma"]["espejo"],
            "suelo": forma["suelo"]
            if isinstance(forma.get("suelo"), bool)
            else base["forma"]["suelo"],
        },
        "volumen": {
            "grosorPatasM": _num(volumen.get("grosorPatasM"), base["volumen"]["grosorPatasM"]),
            "grosorCimaM": _num(volumen.get("grosorCimaM"), base["volumen"]["grosorCimaM"]),
            "irregularidad": _num(volumen.get("irregularidad"), base["volumen"]["irregularidad"]),
            "relleno": _num(volumen.get("relleno"), base["volumen"]["relleno"]),
            "racimo": _num(volumen.get("racimo"), base["volumen"]["racimo"]),
            "salientes": _num(volumen.get("salientes"), base["volumen"]["salientes"]),
        },
        "tamanos": {
            "mezcla": {
                t: _peso_mezcla(mezcla, t, base["tamanos"]["mezcla"][t]) for t in TAMANOS_GLOBO
            },
            "grandesAbajo": _num(tamanos.get("grandesAbajo"), base["tamanos"]["grandesAbajo"]),
            "inflado": _num(tamanos.get("inflado"), base["tamanos"]["inflado"]),
            "variacion": _num(tamanos.get("variacion"), base["tamanos"]["variacion"]),
        },
        "colores": {
            "lista": lista if lista else base["colores"]["lista"],
            "reparto": colores["reparto"]
            if any(r["valor"] == colores.get("reparto") for r in REPARTOS)
            else base["colores"]["reparto"],
            "mezcla": _num(colores.get("mezcla"), base["colores"]["mezcla"]),
        },
        "adornos": {
            "follaje": _num(adornos.get("follaje"), base["adornos"]["follaje"]),
            "flores": _num(adornos.get("flores"), base["adornos"]["flores"]),
        },
        "aspecto": {
            "brillo": _num(aspecto.get("brillo"), base["aspecto"]["brillo"]),
            "sombra": _num(aspecto.get("sombra"), base["aspecto"]["sombra"]),
            "contorno": _num(aspecto.get("contorno"), base["aspecto"]["contorno"]),
            "profundidad": _num(aspecto.get("profundidad"), base["aspecto"]["profundidad"]),
            "semilla": _minimo(
                99999,
                _maximo(1, _redondear(_num(aspecto.get("semilla"), base["aspecto"]["semilla"]))),
            ),
        },
        "real": {
            "desperdicio": _minimo(
                0.3, _maximo(0, _num(real.get("desperdicio"), base["real"]["desperdicio"]))
            ),
            "precio": _maximo(0, _num(real.get("precio"), base["real"]["precio"])),
        },
    }
    # Solo se escribe encendida: un diseño sin la opción sigue siendo, campo por campo, el de siempre.
    if colores.get("cuotas") is True:
        cfg["colores"]["cuotas"] = True
    saneado, cambios = sanear(cfg)
    return saneado, list(cambios)
