"""Reglas para que un bouquet siempre parezca un bouquet: un ramillete apretado de pocos globos, no una hilera.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/limites.ts``.

``limites`` da el rango vivo de cada control (cada uno depende de los demás) y ``sanear`` corrige cualquier
estado imposible, por ejemplo el que llega desde un enlace antiguo.

**``sanear`` comparte ``aspecto`` y ``real`` con su entrada**, igual que el original: la copia de arriba solo
alcanza a ``tamanos``, ``colores``, ``especiales``, ``forma``, ``cinta`` y ``peso``, así que escribir
``aspecto.semilla`` toca también el objeto que llegó. Se replica tal cual; está anotado como defecto del repo
dueño.
"""

from __future__ import annotations

from typing import Any, TypedDict, cast

from app.arco.color import normalizar_color
from app.bouquet.motor import MAX_POR_NIVEL, crear_disposicion
from app.bouquet.tipos import (
    ESPECIALES,
    TAMANOS_ESPECIAL,
    ConfigRamo,
    Especial,
    config_inicial,
)
from app.motores.js import (
    _coma,
    _es_finito,
    _maximo,
    _minimo,
    _numero,
    _redondear,
    _techo,
)
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO, ColorOrg

__all__ = [
    "ALTURA_TOPE",
    "ALTURA_TOPE_SUELO",
    "ANCHO_MAX",
    "ANCHO_MAX_SUELO",
    "CINTA_MAX",
    "CINTA_MAX_SUELO",
    "CINTA_MIN",
    "CINTA_MIN_SUELO",
    "MAX_ESPECIALES",
    "MAX_GLOBOS",
    "MAX_LATEX",
    "LimitesRamo",
    "altura_total",
    "config_inicial",
    "limites",
    "normalizar_config",
    "sanear",
    "topes",
    "total_globos",
]

MAX_LATEX = 28
MAX_GLOBOS = 28
#: Ancho máximo de un ramo (m): más que esto ya no se sostiene en una sola mano ni cabe en una puerta.
ANCHO_MAX = 2.6
MAX_ESPECIALES = 6
#: Altura máxima del ramo (m): el techo de una sala alta.
ALTURA_TOPE = 4.5
CINTA_MIN = 0.3
CINTA_MAX = 3

#: A ras del suelo el ramo es una masa de globos grandes: puede ser más ancho, pero no pasa de un montón de 3 m.
ANCHO_MAX_SUELO = 3
ALTURA_TOPE_SUELO = 3
CINTA_MIN_SUELO = 0.1
CINTA_MAX_SUELO = 1


class Topes(TypedDict):
    ancho: float
    alto: float
    cintaMin: float
    cintaMax: float


def topes(modo: str) -> Topes:
    """Topes de ancho, alto y cinta del modo (m)."""
    if modo == "suelo":
        return {
            "ancho": ANCHO_MAX_SUELO,
            "alto": ALTURA_TOPE_SUELO,
            "cintaMin": CINTA_MIN_SUELO,
            "cintaMax": CINTA_MAX_SUELO,
        }
    return {"ancho": ANCHO_MAX, "alto": ALTURA_TOPE, "cintaMin": CINTA_MIN, "cintaMax": CINTA_MAX}


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


class LimitesRamo(TypedDict):
    latexMax: float
    nivelesMin: float
    nivelesMax: float
    cintaMax: float


def total_globos(cfg: ConfigRamo) -> float:
    """Globos del ramo: los de látex más la cantidad de cada especial."""
    suma = 0.0
    for e in cfg["especiales"]:
        suma += e["cantidad"]
    return float(cfg["latex"] + suma)


class _Tamano(TypedDict):
    ancho: float
    alto: float


def _tamano_de(cfg: ConfigRamo) -> _Tamano:
    """Ancho y alto (m) que ocupan los globos del ramo, sin contar las colas de cinta."""
    items = crear_disposicion(cfg).items
    if not items:
        return {"ancho": 0, "alto": 0}
    derecha = max(it.x + it.ancho / 2 for it in items)
    izquierda = min(it.x - it.ancho / 2 for it in items)
    return {
        "ancho": derecha - izquierda,
        "alto": max(it.y + it.alto / 2 for it in items),
    }


def altura_total(cfg: ConfigRamo) -> float:
    """Altura del ramo (m): el borde de arriba del globo más alto."""
    items = crear_disposicion(cfg).items
    return max(it.y + it.alto / 2 for it in items) if items else 0


def limites(cfg: ConfigRamo) -> LimitesRamo:
    """Rango permitido de cada control con el estado actual."""
    n = total_globos(cfg)
    especiales = 0.0
    for e in cfg["especiales"]:
        especiales += e["cantidad"]
    t = topes(cfg["forma"]["modo"])
    return {
        "latexMax": _maximo(0, _minimo(MAX_LATEX, MAX_GLOBOS - especiales)),
        "nivelesMin": _maximo(1, _techo(n / MAX_POR_NIVEL)),
        "nivelesMax": _maximo(1, _minimo(4, _techo(n / 1.5))),
        "cintaMax": _maximo(
            t["cintaMin"],
            _minimo(t["cintaMax"], cfg["forma"]["cintaM"] + t["alto"] - altura_total(cfg)),
        ),
    }


def _mas_cercano(tipo: str, cm: float) -> float:
    """El tamaño del catálogo de ese tipo de especial más próximo al pedido."""
    opciones = TAMANOS_ESPECIAL[tipo]
    mejor = opciones[0]
    for t in opciones:
        if abs(t["cm"] - cm) < abs(mejor["cm"] - cm):
            mejor = t
    return float(mejor["cm"])


def _mezcla_canonica(crudo: dict[Any, Any]) -> dict[int, float]:
    """La mezcla con los tamaños como enteros, que es como los guarda el motor.

    ``sanear`` también se llama sobre una entrada **sin normalizar** (es donde se ven los avisos que lee el
    cliente), y una que llega por el enlace trae las claves como texto, porque en JSON no hay otras.
    """
    return {int(k): v for k, v in crudo.items()}


def sanear(entrada: ConfigRamo) -> tuple[ConfigRamo, list[str]]:
    """El mismo ramo corregido para que sea viable, y qué se cambió (en español, para mostrar)."""
    cfg: ConfigRamo = {
        **entrada,
        "tamanos": {
            **entrada["tamanos"],
            "mezcla": _mezcla_canonica(entrada["tamanos"]["mezcla"]),
        },
        "colores": {
            **entrada["colores"],
            "lista": [dict(c) for c in entrada["colores"]["lista"]],
        },
        "especiales": [dict(e) for e in entrada["especiales"][:MAX_ESPECIALES]],
        "forma": dict(entrada["forma"]),
        "cinta": dict(entrada["cinta"]),
        "peso": dict(entrada["peso"]),
    }
    cambios: list[str] = []
    f = cfg["forma"]
    t = cfg["tamanos"]

    t["inflado"] = _acotar(t["inflado"], 0.8, 1.1)
    t["variacion"] = _acotar(t["variacion"], 0, 0.15)
    t["grandesAbajo"] = 0.5
    for k in TAMANOS_GLOBO:
        crudo = t["mezcla"].get(k, 0)
        t["mezcla"][k] = _acotar(crudo if _es_finito(crudo) else 0, 0, 100)
    if all(t["mezcla"][k] == 0 for k in TAMANOS_GLOBO):
        t["mezcla"][12] = 100
        cambios.append("La mezcla de tamaños no puede quedar vacía: se puso R12.")

    # Especiales: tamaños que existen, cantidades y datos válidos.
    saneados: list[Especial] = []
    for e in cfg["especiales"]:
        tipo = e["tipo"] if any(x["valor"] == e["tipo"] for x in ESPECIALES) else "estrella"
        saneados.append(
            {
                "tipo": tipo,
                "cantidad": _redondear(_acotar(e["cantidad"], 0, 6)),
                "cm": _mas_cercano(tipo, e["cm"]),
                "color": normalizar_color(e["color"], "#d4af37"),
                "numero": _redondear(_acotar(e["numero"], 0, 9)),
                "contenido": e["contenido"]
                if e["contenido"] in ("vacio", "confeti", "plumas")
                else "vacio",
            }
        )
    cfg["especiales"] = saneados

    # Cantidad de globos: un ramo, no una hilera ni una pared.
    cfg["latex"] = _redondear(_acotar(cfg["latex"], 0, MAX_LATEX))
    total = total_globos(cfg)
    if total > MAX_GLOBOS:
        sobra = total - MAX_GLOBOS
        cfg["latex"] = _maximo(0, cfg["latex"] - sobra)
        total = total_globos(cfg)
        cambios.append(
            f"Un bouquet lleva como máximo {_numero(MAX_GLOBOS)} globos:"
            " se quitaron los de látex que sobraban."
        )
    if total == 0:
        cfg["latex"] = 3
        cambios.append("El ramo no puede estar vacío: se pusieron 3 globos de látex.")

    # Forma.
    f["modo"] = "suelo" if f["modo"] == "suelo" else "flotante"
    f["grandes"] = "arriba" if f["grandes"] == "arriba" else "abajo"
    suelo = f["modo"] == "suelo"
    T = topes(f["modo"])
    f["ancho"] = _acotar(f["ancho"], 0.5, 1.6)
    f["escalon"] = _acotar(f["escalon"], 0.5, 1.2)
    f["apretado"] = _acotar(f["apretado"], 0.7, 1.2)
    f["inclinacion"] = _acotar(f["inclinacion"], -1, 1)
    f["desorden"] = _acotar(f["desorden"], 0, 1)
    lim = limites(cfg)
    niveles = _redondear(_acotar(f["niveles"], lim["nivelesMin"], lim["nivelesMax"]))
    # A ras del suelo no hay niveles de cinta: el valor solo se guarda por si se vuelve a un ramo flotante.
    if not suelo and niveles != _redondear(f["niveles"]):
        if niveles > f["niveles"]:
            cambios.append(
                f"Con {_numero(total)} globos hacen falta al menos {_numero(niveles)} niveles de"
                " cinta: en un solo nivel quedarían en fila."
            )
        else:
            cambios.append(
                f"Con {_numero(total)} globos no se pueden usar más de {_numero(niveles)} niveles"
                " de cinta."
            )
    f["niveles"] = niveles
    # Ancho y alto: con globos o especiales grandes el ramo puede salir demasiado ancho o alto. Primero se
    # ajusta el escalón y los niveles; si no alcanza, se quitan globos para que siga siendo un ramo.
    # A ras del suelo el ramo es un montón: en vez de niveles se cambia la forma (más angosto o más ancho)
    # antes de quitar globos.
    bajo_escalon = False
    subio_niveles = False
    cambio_forma = False
    acorto_cinta = False
    quito = False
    # A ras del suelo la cinta abre el montón (los globos pueden alejarse más del peso): se mide con la cinta
    # que tiene, no con la más corta.
    if suelo:
        f["cintaM"] = _acotar(f["cintaM"], T["cintaMin"], T["cintaMax"])
    for _vuelta in range(80):
        medida = _tamano_de(
            cast(
                ConfigRamo,
                {**cfg, "forma": {**f, "cintaM": f["cintaM"] if suelo else T["cintaMin"]}},
            )
        )
        muy_ancho = medida["ancho"] > T["ancho"]
        muy_alto = medida["alto"] > T["alto"]
        if not muy_ancho and not muy_alto:
            break
        if not suelo:
            lim = limites(cfg)
        if muy_alto and f["escalon"] > 0.5 + 1e-9:
            f["escalon"] = _maximo(0.5, _redondear((f["escalon"] - 0.1) * 100) / 100)
            bajo_escalon = True
            continue
        if suelo:
            if f["cintaM"] > T["cintaMin"] + 1e-9:
                f["cintaM"] = _maximo(T["cintaMin"], _redondear((f["cintaM"] - 0.1) * 100) / 100)
                acorto_cinta = True
                continue
            if muy_ancho and not muy_alto and f["ancho"] > 0.5 + 1e-9:
                f["ancho"] = _maximo(0.5, _redondear((f["ancho"] - 0.1) * 100) / 100)
                cambio_forma = True
                continue
            if muy_alto and not muy_ancho and f["ancho"] < 1.6 - 1e-9:
                f["ancho"] = _minimo(1.6, _redondear((f["ancho"] + 0.1) * 100) / 100)
                cambio_forma = True
                continue
        elif muy_ancho and not muy_alto and f["niveles"] < lim["nivelesMax"]:
            f["niveles"] += 1
            subio_niveles = True
            continue
        if cfg["latex"] > 0 and total_globos(cfg) > 3:
            if suelo:
                # A ras del suelo cada acomodo cuesta más: se busca de una vez con cuántos globos de látex
                # cabe (búsqueda binaria).
                minimo = _maximo(0, 3 - (total_globos(cfg) - cfg["latex"]))

                def cabe(k: float) -> bool:
                    medido = _tamano_de(cast(ConfigRamo, {**cfg, "latex": k, "forma": dict(f)}))
                    return bool(medido["ancho"] <= T["ancho"] and medido["alto"] <= T["alto"])

                lo = minimo
                hi = cfg["latex"] - 1
                if cabe(lo):
                    while lo < hi:
                        medio = _techo((lo + hi) / 2)
                        if cabe(medio):
                            lo = medio
                        else:
                            hi = medio - 1
                cfg["latex"] = lo
            else:
                cfg["latex"] -= 1
            quito = True
            continue
        cantidades = [e["cantidad"] for e in cfg["especiales"]]
        if cantidades:
            tope = max(cantidades)
            i = len(cantidades) - 1 - cantidades[::-1].index(tope)
        else:
            i = -1
        if i >= 0 and cfg["especiales"][i]["cantidad"] > 0 and total_globos(cfg) > 1:
            cfg["especiales"][i]["cantidad"] -= 1
            quito = True
            continue
        break
    if bajo_escalon:
        cambios.append(
            f"Con esos globos el ramo pasaba de {_coma(T['alto'], 1)} m de alto: se bajó"
            f" {'la altura del montón' if suelo else 'el escalón entre niveles'}."
        )
    if subio_niveles:
        cambios.append(
            f"Con esos globos el ramo pasaba de {_coma(T['ancho'], 1)} m de ancho:"
            " se subieron los niveles de cinta."
        )
    if acorto_cinta:
        cambios.append(
            f"Con esos globos el montón pasaba de {_coma(T['ancho'], 1)} m de ancho o de"
            f" {_coma(T['alto'], 1)} m de alto: se acortó la cinta."
        )
    if cambio_forma:
        cambios.append(
            f"Con esos globos el montón no cabía en {_coma(T['ancho'], 1)} m de ancho y"
            f" {_coma(T['alto'], 1)} m de alto: se cambió la proporción ancho/alto."
        )
    if quito:
        cambios.append(
            f"Aun así no cabía (máximo {_coma(T['ancho'], 1)} m de ancho y"
            f" {_coma(T['alto'], 1)} m de alto): se quitaron algunos globos para que siga siendo"
            " un ramo."
        )
    lim = limites(cfg)
    cinta = _acotar(f["cintaM"], T["cintaMin"], _maximo(T["cintaMin"], lim["cintaMax"]))
    if abs(cinta - f["cintaM"]) > 1e-6 and f["cintaM"] > lim["cintaMax"]:
        cambios.append(
            f"La cinta se acortó a {_coma(cinta, 2)} m: el ramo no puede pasar de"
            f" {_coma(T['alto'], 1)} m de alto."
        )
    f["cintaM"] = cinta

    # Cinta, peso y colores.
    cfg["cinta"]["tipo"] = "lisa" if cfg["cinta"]["tipo"] == "lisa" else "rizada"
    cfg["cinta"]["color"] = normalizar_color(cfg["cinta"]["color"], "#e6b8a2")
    cfg["peso"]["tipo"] = (
        cfg["peso"]["tipo"] if cfg["peso"]["tipo"] in ("regalo", "bolsa", "ninguno") else "regalo"
    )
    cfg["peso"]["color"] = normalizar_color(cfg["peso"]["color"], "#f6efe6")
    cfg["colores"]["lista"] = [
        {**c, "peso": _redondear(_acotar(c["peso"], 1, 100))} for c in cfg["colores"]["lista"][:8]
    ]
    if not cfg["colores"]["lista"]:
        cfg["colores"]["lista"] = [{"hex": "#ffffff", "peso": 50, "acabado": "mate", "rol": "base"}]
    cfg["colores"]["mezcla"] = _acotar(cfg["colores"]["mezcla"], 0, 1)

    cfg["aspecto"]["semilla"] = _minimo(99999, _maximo(1, _redondear(cfg["aspecto"]["semilla"])))
    cfg["real"]["desperdicio"] = _acotar(cfg["real"]["desperdicio"], 0, 0.3)
    cfg["real"]["precio"] = _maximo(0, cfg["real"]["precio"])
    cfg["ramos"] = _redondear(_acotar(cfg["ramos"], 1, 20))
    return cfg, cambios


def _num(valor: object, respaldo: float) -> float:
    """``Number.isFinite``: un ``NaN``, un infinito o algo que no es número caen al respaldo."""
    return float(cast(float, valor)) if _es_finito(valor) else respaldo


def _obj(valor: object) -> dict[str, Any]:
    return valor if isinstance(valor, dict) else {}


def _bool(valor: object, respaldo: bool) -> bool:
    return valor if isinstance(valor, bool) else respaldo


def _peso_mezcla(crudo: dict[Any, Any], t: int, respaldo: float) -> float:
    """El peso de un tamaño en la mezcla que llega de fuera (la clave puede ser el entero o su texto)."""
    if t in crudo:
        return _num(crudo[t], respaldo)
    return _num(crudo.get(str(t)), respaldo)


def normalizar_config(entrada: object) -> ConfigRamo:
    """Convierte cualquier cosa que llegue de fuera (enlace, almacenamiento) en un diseño válido.

    Nunca lanza.
    """
    return normalizar_config_con_cambios(entrada)[0]


def normalizar_config_con_cambios(entrada: object) -> tuple[ConfigRamo, list[str]]:
    """Lo mismo, **y lo que hubo que corregir** para que el ramo fuera posible."""
    base = config_inicial()
    e = _obj(entrada)
    ta = _obj(e.get("tamanos"))
    mezcla = _obj(ta.get("mezcla"))
    co = _obj(e.get("colores"))
    fo = _obj(e.get("forma"))
    ci = _obj(e.get("cinta"))
    pe = _obj(e.get("peso"))
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
                    "acabado": o["acabado"]
                    if any(a["valor"] == o.get("acabado") for a in ACABADOS)
                    else "mate",
                    "rol": "acento" if o.get("rol") == "acento" else "base",
                }
            )
    else:
        lista = base["colores"]["lista"]

    especiales: list[Especial]
    if isinstance(e.get("especiales"), list):
        especiales = []
        for x in e["especiales"][:MAX_ESPECIALES]:
            o = _obj(x)
            tipo = next((s["valor"] for s in ESPECIALES if s["valor"] == o.get("tipo")), "estrella")
            contenido = o["contenido"] if o.get("contenido") in ("vacio", "plumas") else "confeti"
            especiales.append(
                {
                    "tipo": tipo,
                    "cantidad": _num(o.get("cantidad"), 1),
                    "cm": _num(o.get("cm"), 46),
                    "color": normalizar_color(o.get("color"), "#d4af37"),
                    "numero": _num(o.get("numero"), 1),
                    "contenido": contenido,
                }
            )
    else:
        especiales = base["especiales"]

    cfg: ConfigRamo = {
        "latex": _num(e.get("latex"), base["latex"]),
        "tamanos": {
            "mezcla": {
                t: _peso_mezcla(mezcla, t, base["tamanos"]["mezcla"][t]) for t in TAMANOS_GLOBO
            },
            "grandesAbajo": 0.5,
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
        "especiales": especiales,
        "forma": {
            "modo": "suelo" if fo.get("modo") == "suelo" else "flotante",
            "grandes": "arriba" if fo.get("grandes") == "arriba" else "abajo",
            "ancho": _num(fo.get("ancho"), base["forma"]["ancho"]),
            "niveles": _num(fo.get("niveles"), base["forma"]["niveles"]),
            "escalon": _num(fo.get("escalon"), base["forma"]["escalon"]),
            "apretado": _num(fo.get("apretado"), base["forma"]["apretado"]),
            "inclinacion": _num(fo.get("inclinacion"), base["forma"]["inclinacion"]),
            "desorden": _num(fo.get("desorden"), base["forma"]["desorden"]),
            "cintaM": _num(fo.get("cintaM"), base["forma"]["cintaM"]),
            "persona": _bool(fo.get("persona"), base["forma"]["persona"]),
            "suelo": _bool(fo.get("suelo"), base["forma"]["suelo"]),
        },
        "cinta": {
            "tipo": "lisa" if ci.get("tipo") == "lisa" else "rizada",
            "color": normalizar_color(ci.get("color"), base["cinta"]["color"]),
        },
        "peso": {
            "tipo": pe["tipo"]
            if str(pe.get("tipo")) in ("regalo", "bolsa", "ninguno")
            else base["peso"]["tipo"],
            "color": normalizar_color(pe.get("color"), base["peso"]["color"]),
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
        "ramos": _num(e.get("ramos"), base["ramos"]),
    }
    return sanear(cfg)
