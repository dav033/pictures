"""Reglas para que una columna orgánica siempre parezca una columna.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columnaorg/limites.ts``.

``limites`` da el rango vivo de cada control (cada uno depende de los demás) y ``sanear`` corrige cualquier estado
imposible, por ejemplo el que llega desde un enlace antiguo. Los redondeos van a **5 cm** (``*20``), como los de
la guirnalda: es el paso que ofrece la interfaz.
"""

from __future__ import annotations

from typing import Any, cast

from app.arco.color import normalizar_color
from app.columnaorg.espina import crear_espina_columna
from app.columnaorg.tipos import ConfigCol, config_inicial
from app.motores.js import _coma, _es_finito, _maximo, _minimo, _numero, _piso, _redondear, _techo
from app.organico.espina import Espina
from app.organico.limites import tamanos_permitidos
from app.organico.motor import MAX_GLOBOS, estimar_globos_en
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO, ColorOrg, diametro_m

ALTO_MIN = 0.8
ALTO_TOPE = 4.5
GROSOR_MIN = 0.35
GROSOR_TOPE = 1.6
#: Una columna no puede ser más baja que esto respecto a su grosor mayor (más bajo es un montículo).
_RAZON_ALTO_MIN = 0.85
#: El grosor mayor no puede pasar del alto dividido entre esto.
_RAZON_GROSOR_ALTO = 0.85
#: Ni más alta que esto (se vuelve un palo inestable).
_RAZON_ALTO_MAX = 10
#: La punta no puede ser mucho más delgada que la base, ni mucho más gruesa.
_RAZON_PUNTA_MIN = 0.35
_RAZON_PUNTA_MAX = 1.6


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


def _arriba(valor: float) -> float:
    """Al múltiplo de 5 cm de arriba."""
    return float(_techo(valor * 20 - 1e-9)) / 20


def _abajo(valor: float) -> float:
    """Al múltiplo de 5 cm de abajo."""
    return float(_piso(valor * 20 + 1e-9)) / 20


def limites(cfg: ConfigCol) -> dict[str, Any]:
    """Rango permitido de cada control con el estado actual."""
    f = cfg["forma"]
    v = cfg["volumen"]
    g_max = _maximo(v["grosorPatasM"], v["grosorCimaM"])
    corona_permitida: dict[int, bool] = {}
    for t in TAMANOS_GLOBO:
        d = diametro_m(t, cfg["tamanos"]["inflado"])
        corona_permitida[t] = (
            d >= 0.8 * v["grosorCimaM"] - 1e-9 and d <= 2.2 * v["grosorCimaM"] + 1e-9
        )
    return {
        "altoMin": _maximo(ALTO_MIN, _arriba(_RAZON_ALTO_MIN * g_max)),
        "altoMax": _maximo(ALTO_MIN, _abajo(_minimo(ALTO_TOPE, _RAZON_ALTO_MAX * g_max))),
        "grosorBaseMin": GROSOR_MIN,
        "grosorBaseMax": _minimo(GROSOR_TOPE, _abajo(f["altoM"] / _RAZON_GROSOR_ALTO)),
        "grosorPuntaMin": _maximo(GROSOR_MIN, _arriba(_RAZON_PUNTA_MIN * v["grosorPatasM"])),
        "grosorPuntaMax": _minimo(
            _minimo(GROSOR_TOPE, _abajo(_RAZON_PUNTA_MAX * v["grosorPatasM"])),
            _abajo(f["altoM"] / _RAZON_GROSOR_ALTO),
        ),
        "inclinacionMax": _minimo(1, _abajo(0.3 * f["altoM"])),
        "serpenteoMax": _minimo(0.6, _abajo(0.2 * f["altoM"])),
        # Qué tamaños sirven como globo grande de la punta.
        "coronaPermitida": corona_permitida,
    }


def _espina_media(cfg: ConfigCol) -> Espina:
    """La línea guía con las ocho fases a 0,5: la que usa el estimador, sin azar."""
    return crear_espina_columna(cast(dict[str, Any], cfg), [0.5] * 8)


def estimar_globos(cfg: ConfigCol) -> float:
    """Cantidad de globos que pide el diseño, sin acomodarlos."""
    return float(estimar_globos_en(cast(dict[str, Any], cfg), _espina_media(cfg)))


def _mezcla_canonica(crudo: dict[Any, Any]) -> dict[int, float]:
    """La mezcla con los tamaños como enteros, que es como los guarda el motor.

    ``sanear`` también se llama sobre una entrada **sin normalizar** (es donde se ven los avisos que lee el
    cliente), y una que llega por el enlace trae las claves como texto, porque en JSON no hay otras.
    """
    return {int(k): v for k, v in crudo.items()}


def sanear(entrada: ConfigCol) -> tuple[ConfigCol, list[str]]:
    """El mismo diseño corregido para que sea viable, y qué se cambió (en español, para mostrar).

    Orden: la línea y el volumen sueltos; alto y grosores (en un orden que converge: primero un alto posible, luego
    los grosores según el alto); tamaños que caben; cantidad total de globos; globo grande de la punta; colores.
    """
    cfg: ConfigCol = {
        **entrada,
        "forma": dict(entrada["forma"]),
        "volumen": dict(entrada["volumen"]),
        "tamanos": {**entrada["tamanos"], "mezcla": _mezcla_canonica(entrada["tamanos"]["mezcla"])},
        "colores": {**entrada["colores"], "lista": [dict(c) for c in entrada["colores"]["lista"]]},
        "adornos": dict(entrada["adornos"]),
        "corona": dict(entrada["corona"]),
    }
    f = cfg["forma"]
    v = cfg["volumen"]
    t = cfg["tamanos"]
    cambios: list[str] = []

    f["ondulacion"] = _acotar(f["ondulacion"], 0, 1)
    f["carga"] = 0
    f["espejo"] = False
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

    # Alto y grosores, en un orden que converge: primero un alto posible, luego los grosores según el alto.
    f["altoM"] = _acotar(f["altoM"], ALTO_MIN, ALTO_TOPE)
    g_base = _acotar(
        v["grosorPatasM"],
        GROSOR_MIN,
        _maximo(GROSOR_MIN, _minimo(GROSOR_TOPE, _abajo(f["altoM"] / _RAZON_GROSOR_ALTO))),
    )
    if abs(g_base - v["grosorPatasM"]) > 1e-6:
        cambios.append(
            f"Con {_coma(f['altoM'])} m de alto la base no puede pasar de {_coma(g_base)} m:"
            " se ajustó para que siga pareciendo una columna."
        )
    v["grosorPatasM"] = g_base
    punta_min = _maximo(GROSOR_MIN, _RAZON_PUNTA_MIN * g_base)
    punta_max = _maximo(
        punta_min,
        _minimo(_minimo(GROSOR_TOPE, _RAZON_PUNTA_MAX * g_base), f["altoM"] / _RAZON_GROSOR_ALTO),
    )
    g_punta = _acotar(v["grosorCimaM"], punta_min, punta_max)
    if abs(g_punta - v["grosorCimaM"]) > 1e-6:
        cambios.append(
            f"El grosor de la punta se ajustó a {_coma(g_punta)} m: no puede ser muy distinto al de la base."
        )
    v["grosorCimaM"] = g_punta
    lim = limites(cfg)
    alto = _acotar(f["altoM"], lim["altoMin"], _maximo(lim["altoMin"], lim["altoMax"]))
    if abs(alto - f["altoM"]) > 1e-6:
        cambios.append(
            f"El alto se ajustó a {_coma(alto)} m: con ese grosor, fuera de"
            f" {_coma(lim['altoMin'])}–{_coma(lim['altoMax'])} m deja de parecer una columna."
        )
    f["altoM"] = alto
    lim = limites(cfg)
    f["inclinacionM"] = _acotar(f["inclinacionM"], -lim["inclinacionMax"], lim["inclinacionMax"])
    f["serpenteoM"] = _acotar(f["serpenteoM"], 0, lim["serpenteoMax"])

    # Tamaños de globo que no caben en el grosor: se quitan de la mezcla.
    permitidos = tamanos_permitidos(cast(dict[str, Any], cfg))
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

    # Cantidad total de globos: se baja el relleno de 2 en 2 % hasta que caben.
    # La línea guía no depende del relleno, así que se construye una vez y no treinta y una.
    esp = _espina_media(cfg)
    pasos = 0
    while (
        estimar_globos_en(cast(dict[str, Any], cfg), esp) > MAX_GLOBOS
        and v["relleno"] > 0.4
        and pasos < 30
    ):
        v["relleno"] = _redondear((v["relleno"] - 0.02) * 100) / 100
        pasos += 1
    if pasos > 0:
        cambios.append(
            f"Con ese tamaño y grosor harían falta más de {MAX_GLOBOS} globos:"
            f" se bajó el relleno a {_numero(_redondear(v['relleno'] * 100))} %."
        )

    # Globo grande sobre la punta: tiene que guardar proporción con el grosor de la punta.
    lim = limites(cfg)
    c = cfg["corona"]
    if c["tamano"] not in TAMANOS_GLOBO:
        c["tamano"] = 24
    c["color"] = normalizar_color(c["color"], "#efe4d0")
    if c["activa"] and not lim["coronaPermitida"][c["tamano"]]:
        mejor: int | None = None
        dif = float("inf")
        for k in TAMANOS_GLOBO:
            if not lim["coronaPermitida"][k]:
                continue
            error = abs(diametro_m(k, t["inflado"]) / v["grosorCimaM"] - 1.4)
            if error < dif:
                dif = error
                mejor = k
        if mejor is not None:
            cambios.append(
                f"Un globo de R{c['tamano']} no guarda proporción con una punta de {_coma(v['grosorCimaM'])} m:"
                f" se cambió a R{mejor}."
            )
            c["tamano"] = mejor
        else:
            c["activa"] = False
            cambios.append(
                "Ningún globo queda bien sobre una punta tan delgada: se quitó el globo grande de arriba."
            )

    # Colores: entre 1 y 8, con proporción válida.
    cfg["colores"]["lista"] = [
        {**k, "peso": _redondear(_acotar(k["peso"], 1, 100))} for k in cfg["colores"]["lista"][:8]
    ]
    if not cfg["colores"]["lista"]:
        cfg["colores"]["lista"] = [{"hex": "#9fb59a", "peso": 50, "acabado": "mate", "rol": "base"}]
    cfg["colores"]["mezcla"] = _acotar(cfg["colores"]["mezcla"], 0, 1)

    cfg["real"]["desperdicio"] = _acotar(cfg["real"]["desperdicio"], 0, 0.3)
    cfg["real"]["precio"] = _maximo(0, cfg["real"]["precio"])
    cfg["aspecto"]["semilla"] = _minimo(99999, _maximo(1, _redondear(cfg["aspecto"]["semilla"])))
    return cfg, cambios


def _num(valor: object, respaldo: float) -> float:
    """``Number.isFinite``: un ``NaN``, un infinito o algo que no es número caen al respaldo."""
    return float(cast(float, valor)) if _es_finito(valor) else respaldo


def _obj(valor: object) -> dict[str, Any]:
    return valor if isinstance(valor, dict) else {}


def _peso_mezcla(crudo: dict[Any, Any], t: int, respaldo: float) -> float:
    """El peso de un tamaño en la mezcla que llega de fuera (la clave puede ser el entero o su texto)."""
    if t in crudo:
        return _num(crudo[t], respaldo)
    return _num(crudo.get(str(t)), respaldo)


def _bool(valor: object, respaldo: bool) -> bool:
    return valor if isinstance(valor, bool) else respaldo


def normalizar_config(entrada: object) -> ConfigCol:
    """Convierte cualquier cosa que llegue de fuera (enlace, almacenamiento) en un diseño válido. Nunca lanza."""
    return normalizar_config_con_cambios(entrada)[0]


def normalizar_config_con_cambios(entrada: object) -> tuple[ConfigCol, list[str]]:
    """Lo mismo, **y lo que hubo que corregir** para que la columna fuera posible."""
    base = config_inicial()
    e = _obj(entrada)
    f = _obj(e.get("forma"))
    vo = _obj(e.get("volumen"))
    ta = _obj(e.get("tamanos"))
    mezcla = _obj(ta.get("mezcla"))
    co = _obj(e.get("colores"))
    ad = _obj(e.get("adornos"))
    asp = _obj(e.get("aspecto"))
    re = _obj(e.get("real"))
    cr = _obj(e.get("corona"))

    lista: list[ColorOrg]
    if isinstance(co.get("lista"), list):
        lista = []
        for i, c in enumerate(co["lista"][:8]):
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

    tamano_corona = next(
        (t for t in TAMANOS_GLOBO if t == cr.get("tamano")), base["corona"]["tamano"]
    )
    cfg: ConfigCol = {
        "forma": {
            "altoM": _num(f.get("altoM"), base["forma"]["altoM"]),
            "inclinacionM": _num(f.get("inclinacionM"), base["forma"]["inclinacionM"]),
            "serpenteoM": _num(f.get("serpenteoM"), base["forma"]["serpenteoM"]),
            "ondulacion": _num(f.get("ondulacion"), base["forma"]["ondulacion"]),
            "carga": 0,
            "espejo": False,
            "suelo": _bool(f.get("suelo"), base["forma"]["suelo"]),
            "persona": _bool(f.get("persona"), base["forma"]["persona"]),
        },
        "volumen": {
            "grosorPatasM": _num(vo.get("grosorPatasM"), base["volumen"]["grosorPatasM"]),
            "grosorCimaM": _num(vo.get("grosorCimaM"), base["volumen"]["grosorCimaM"]),
            "irregularidad": _num(vo.get("irregularidad"), base["volumen"]["irregularidad"]),
            "relleno": _num(vo.get("relleno"), base["volumen"]["relleno"]),
            "racimo": _num(vo.get("racimo"), base["volumen"]["racimo"]),
            "salientes": _num(vo.get("salientes"), base["volumen"]["salientes"]),
        },
        "tamanos": {
            "mezcla": {
                t: _peso_mezcla(mezcla, t, base["tamanos"]["mezcla"][t]) for t in TAMANOS_GLOBO
            },
            "grandesAbajo": _num(ta.get("grandesAbajo"), base["tamanos"]["grandesAbajo"]),
            "inflado": _num(ta.get("inflado"), base["tamanos"]["inflado"]),
            "variacion": _num(ta.get("variacion"), base["tamanos"]["variacion"]),
        },
        "colores": {
            "lista": lista if lista else base["colores"]["lista"],
            "reparto": co["reparto"]
            if any(r["valor"] == co.get("reparto") for r in REPARTOS)
            else base["colores"]["reparto"],
            "mezcla": _num(co.get("mezcla"), base["colores"]["mezcla"]),
        },
        "adornos": {
            "follaje": _num(ad.get("follaje"), base["adornos"]["follaje"]),
            "flores": _num(ad.get("flores"), base["adornos"]["flores"]),
        },
        "aspecto": {
            "brillo": _num(asp.get("brillo"), base["aspecto"]["brillo"]),
            "sombra": _num(asp.get("sombra"), base["aspecto"]["sombra"]),
            "contorno": _num(asp.get("contorno"), base["aspecto"]["contorno"]),
            "profundidad": _num(asp.get("profundidad"), base["aspecto"]["profundidad"]),
            "semilla": _num(asp.get("semilla"), base["aspecto"]["semilla"]),
        },
        "real": {
            "desperdicio": _num(re.get("desperdicio"), base["real"]["desperdicio"]),
            "precio": _num(re.get("precio"), base["real"]["precio"]),
        },
        "corona": {
            "activa": _bool(cr.get("activa"), base["corona"]["activa"]),
            "tamano": tamano_corona,
            "color": normalizar_color(cr.get("color"), base["corona"]["color"]),
        },
    }
    # Solo se escribe encendida: un diseño sin la opción sigue siendo, campo por campo, el de siempre.
    if co.get("cuotas") is True:
        cfg["colores"]["cuotas"] = True
    return sanear(cfg)
