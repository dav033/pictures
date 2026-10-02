"""Reglas para que una guirnalda siempre parezca una guirnalda.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/guirnalda/limites.ts``.

Una tira mucho más larga que gruesa, casi horizontal, que no sube ni forma arco. ``limites`` da el rango vivo
de cada control (cada uno depende de los demás) y ``sanear`` corrige cualquier estado imposible, por ejemplo
el que llega desde un enlace antiguo.

Los redondeos van a **5 cm** (``*20``), no a décimas como los del arco: es el paso que ofrece la interfaz de
la guirnalda.
"""

from __future__ import annotations

from typing import Any, cast

from app.arco.color import normalizar_color
from app.guirnalda.espina import altura_guirnalda, crear_espina_guirnalda
from app.guirnalda.tipos import ConfigGuir, FormaGuir, config_inicial
from app.motores.js import _coma, _es_finito, _maximo, _minimo, _numero, _piso, _redondear, _techo
from app.organico.espina import Espina
from app.organico.limites import tamanos_permitidos
from app.organico.motor import MAX_GLOBOS, estimar_globos_en
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO, ColorOrg

LARGO_MIN = 0.8
LARGO_MAX = 10
GROSOR_MIN = 0.3
GROSOR_TOPE = 1.4
ALTURA_TOPE = 4.5

#: El largo tiene que ser al menos esto por el grosor mayor: si no, es un montículo y no una guirnalda.
_RAZON_LARGO_GROSOR = 2.4


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


def _arriba(valor: float) -> float:
    """Al múltiplo de 5 cm de arriba."""
    return float(_techo(valor * 20 - 1e-9)) / 20


def _abajo(valor: float) -> float:
    """Al múltiplo de 5 cm de abajo."""
    return float(_piso(valor * 20 + 1e-9)) / 20


def _desviacion(f: FormaGuir) -> tuple[float, float]:
    """Cuánto se aleja la línea de su altura inicial, como (mínimo, máximo) en metros.

    Se muestrea con la altura a 0 y la fase a 0,5 (no a 0): la fase fija es la que usa el estimador, así que
    los límites y la estimación hablan de la misma línea.
    """
    mn = 0.0
    mx = 0.0
    sin_altura = cast(FormaGuir, {**f, "alturaM": 0})
    for i in range(201):
        d = altura_guirnalda(cast(dict[str, Any], sin_altura), i / 200, 0.5)
        mn = _minimo(mn, d)
        mx = _maximo(mx, d)
    return mn, mx


def limites(cfg: ConfigGuir) -> dict[str, float]:
    """Rango permitido de cada control con el estado actual."""
    f = cfg["forma"]
    v = cfg["volumen"]
    g_max = _maximo(v["grosorPatasM"], v["grosorCimaM"])
    d_min, d_max = _desviacion(f)
    grosor_tope = _minimo(GROSOR_TOPE, _abajo(f["largoM"] / _RAZON_LARGO_GROSOR))
    return {
        "largoMin": _maximo(LARGO_MIN, _arriba(_RAZON_LARGO_GROSOR * g_max)),
        "largoMax": LARGO_MAX,
        "grosorExtremosMin": GROSOR_MIN,
        "grosorExtremosMax": _maximo(GROSOR_MIN, grosor_tope),
        "grosorCentroMin": GROSOR_MIN,
        "grosorCentroMax": _maximo(GROSOR_MIN, grosor_tope),
        # La altura mínima deja media banda sobre el piso en el punto más bajo de la línea.
        "alturaMin": _maximo(0.1, _arriba(0.5 * g_max - d_min)),
        "alturaMax": _maximo(0.5, _abajo(ALTURA_TOPE - d_max)),
        "pendienteMax": _abajo(0.25 * f["largoM"]),
        "ondaMax": _minimo(0.6, _abajo((0.18 * f["largoM"]) / _maximo(1, f["ondas"]))),
        "colgadoMax": _minimo(1.2, _abajo((0.3 * f["largoM"]) / _maximo(1, f["festones"]))),
        "festonesMax": _maximo(1, _minimo(4, _piso(f["largoM"] / 0.9))),
    }


def _espina_media(cfg: ConfigGuir) -> Espina:
    """La línea guía con las ocho fases a 0,5: la que usa el estimador, sin azar."""
    return crear_espina_guirnalda(cast(dict[str, Any], cfg), [0.5] * 8)


def estimar_globos(cfg: ConfigGuir) -> float:
    """Cantidad de globos que pide el diseño, sin acomodarlos."""
    return float(estimar_globos_en(cast(dict[str, Any], cfg), _espina_media(cfg)))


def sanear(entrada: ConfigGuir) -> tuple[ConfigGuir, list[str]]:
    """El mismo diseño corregido para que sea viable, y qué se cambió (en español, para mostrar).

    Orden: la línea y el volumen sueltos; largo y grosores; festones, colgado, onda y pendiente; altura;
    tamaños que caben; cantidad total de globos; colores. Los límites se recalculan tres veces porque cada
    bloque cambia el rango del siguiente: bajar los festones ensancha el colgado permitido, y el colgado y la
    onda mueven la altura mínima.
    """
    cfg: ConfigGuir = {
        **entrada,
        "forma": dict(entrada["forma"]),
        "volumen": dict(entrada["volumen"]),
        "tamanos": {**entrada["tamanos"], "mezcla": _mezcla_canonica(entrada["tamanos"]["mezcla"])},
        "colores": {**entrada["colores"], "lista": [dict(c) for c in entrada["colores"]["lista"]]},
        "adornos": dict(entrada["adornos"]),
    }
    f = cfg["forma"]
    v = cfg["volumen"]
    t = cfg["tamanos"]
    cambios: list[str] = []

    # Una guirnalda nunca se voltea: el espejo es del arco y aquí rompería las normales.
    f["espejo"] = False
    f["carga"] = _acotar(f["carga"], -1, 1)
    f["ondas"] = _acotar(_redondear(f["ondas"] * 2) / 2, 0.5, 4)
    f["festones"] = _redondear(_acotar(f["festones"], 1, 4))
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

    # Largo y grosores: una tira mucho más larga que gruesa.
    f["largoM"] = _acotar(f["largoM"], LARGO_MIN, LARGO_MAX)
    tope = _minimo(GROSOR_TOPE, _abajo(f["largoM"] / _RAZON_LARGO_GROSOR))
    ext = _acotar(v["grosorPatasM"], GROSOR_MIN, _maximo(GROSOR_MIN, tope))
    cen = _acotar(v["grosorCimaM"], GROSOR_MIN, _maximo(GROSOR_MIN, tope))
    if abs(ext - v["grosorPatasM"]) > 1e-6 or abs(cen - v["grosorCimaM"]) > 1e-6:
        cambios.append(
            f"Con {_coma(f['largoM'], 1)} m de largo el grosor no puede pasar de {_coma(tope)} m:"
            " una guirnalda es mucho más larga que gruesa."
        )
    v["grosorPatasM"] = ext
    v["grosorCimaM"] = cen

    # Festones, colgado, onda y pendiente: que siga siendo una tira casi horizontal.
    lim = limites(cfg)
    f["festones"] = _minimo(f["festones"], lim["festonesMax"])
    lim = limites(cfg)
    f["colgadoM"] = _acotar(f["colgadoM"], 0, lim["colgadoMax"])
    f["ondaM"] = _acotar(f["ondaM"], 0, lim["ondaMax"])
    f["pendienteM"] = _acotar(f["pendienteM"], -lim["pendienteMax"], lim["pendienteMax"])
    lim = limites(cfg)
    altura = _acotar(f["alturaM"], lim["alturaMin"], _maximo(lim["alturaMin"], lim["alturaMax"]))
    if abs(altura - f["alturaM"]) > 1e-6:
        cambios.append(
            f"La altura se ajustó a {_coma(altura)} m para que la guirnalda no se hunda en el piso ni pase de"
            f" {_coma(ALTURA_TOPE, 1)} m."
        )
    f["alturaM"] = altura

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
    while estimar_globos_en(cast(dict[str, Any], cfg), esp) > MAX_GLOBOS and v["relleno"] > 0.4 and pasos < 30:
        v["relleno"] = _redondear((v["relleno"] - 0.02) * 100) / 100
        pasos += 1
    if pasos > 0:
        cambios.append(
            f"Con ese largo y grosor harían falta más de {MAX_GLOBOS} globos:"
            f" se bajó el relleno a {_numero(_redondear(v['relleno'] * 100))} %."
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


def _mezcla_canonica(crudo: dict[Any, Any]) -> dict[int, float]:
    """La mezcla con los tamaños como enteros, que es como los guarda el motor.

    ``sanear`` también se llama sobre una entrada **sin normalizar** (es donde se ven los avisos que lee el
    cliente), y una que llega por el enlace trae las claves como texto, porque en JSON no hay otras. En
    JavaScript da igual —``mezcla[12]`` encuentra ``"12"``—, en Python no.
    """
    return {int(k): v for k, v in crudo.items()}


def _peso_mezcla(crudo: dict[Any, Any], t: int, respaldo: float) -> float:
    """El peso de un tamaño en la mezcla que llega de fuera.

    En JavaScript ``mezcla[12]`` encuentra la clave ``"12"`` porque el objeto solo tiene claves de texto; un
    diccionario de Python no, y un diseño que llega por el enlace (JSON) las trae así. Dentro del motor las
    claves son los enteros de ``TAMANOS_GLOBO``, así que aquí se aceptan las dos formas.
    """
    if t in crudo:
        return _num(crudo[t], respaldo)
    return _num(crudo.get(str(t)), respaldo)


def _bool(valor: object, respaldo: bool) -> bool:
    return valor if isinstance(valor, bool) else respaldo


def normalizar_config(entrada: object) -> ConfigGuir:
    """Convierte cualquier cosa que llegue de fuera (enlace, almacenamiento) en un diseño válido. Nunca lanza."""
    return normalizar_config_con_cambios(entrada)[0]


def normalizar_config_con_cambios(entrada: object) -> tuple[ConfigGuir, list[str]]:
    """Lo mismo, **y lo que hubo que corregir** para que la guirnalda fuera posible.

    Existe porque el saneado es la última línea de ``normalizar_config`` y sus avisos se perdían ahí dentro:
    quien llamaba después a ``sanear`` sobre el resultado ya normalizado recibía una lista vacía —el diseño ya
    estaba corregido— y le decía al cliente que no se había tocado nada. Una guirnalda a la que se le quitó el
    R24 de la mezcla porque no cabe en ese grosor tiene que decirlo.
    """
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
                    "acabado": o["acabado"] if any(a["valor"] == o.get("acabado") for a in ACABADOS) else "mate",
                    "rol": "acento" if o.get("rol") == "acento" else "base",
                }
            )
    else:
        lista = base["colores"]["lista"]

    cfg: ConfigGuir = {
        "forma": {
            "largoM": _num(f.get("largoM"), base["forma"]["largoM"]),
            "alturaM": _num(f.get("alturaM"), base["forma"]["alturaM"]),
            "pendienteM": _num(f.get("pendienteM"), base["forma"]["pendienteM"]),
            "ondaM": _num(f.get("ondaM"), base["forma"]["ondaM"]),
            "ondas": _num(f.get("ondas"), base["forma"]["ondas"]),
            "colgadoM": _num(f.get("colgadoM"), base["forma"]["colgadoM"]),
            "festones": _num(f.get("festones"), base["forma"]["festones"]),
            "carga": _num(f.get("carga"), base["forma"]["carga"]),
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
            "mezcla": {t: _peso_mezcla(mezcla, t, base["tamanos"]["mezcla"][t]) for t in TAMANOS_GLOBO},
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
    }
    return sanear(cfg)
