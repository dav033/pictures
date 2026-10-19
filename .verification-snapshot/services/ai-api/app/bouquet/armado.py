"""Bouquet «por partes»: el dibujo de lo que describe el contrato ``armado-bouquet.v1`` (ADR-0030).

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/armado.ts``.

Aquí **solo se dibuja** lo que ese contrato describe; las reglas comerciales (cuántos globos se compran,
pesas, helio, si un látex chico va con helio…) son de ``app/armado_bouquet.py`` y de ``plan.py`` y no se
repiten. Por eso este módulo es mínimo: tipos del contrato, una lista corta de materiales (lo que el sistema
principal llama «leyenda»), un saneado que solo mira la forma y el dibujo.

Lectura del contrato: ``niveles`` van de abajo hacia arriba; cada nivel tiene ``cantidad`` unidades (suelto,
pareja, trío, cuarteto…) puestas una al lado de la otra y ``posiciones`` es el material de cada globo de la
unidad. Los niveles se apilan girando media vuelta cada uno (así los globos de arriba caen en los huecos de
los de abajo, como en una columna). ``remate`` va arriba y los números según ``numero.disposicion``.

Ojo: los nombres de este módulo (``ARMADO_VERSION``, ``VARIANTES_ARMADO``…) son los del **diseñador**, no los
del contrato Zod de ``pictures`` (``src/lib/plan/armado-bouquet.ts``), que usa ``ARMADO_BOUQUET_VERSION``,
``VARIANTES_BOUQUET`` y compañía. Son la misma forma vista desde los dos lados.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, TypedDict, cast

from app.arco.color import normalizar_color
from app.motores import mate
from app.motores.canonico import resolver_colores
from app.motores.js import (
    _es_finito,
    _maximo,
    _minimo,
    _numero,
    _redondear,
    crear_rng,
    mezclar,
)
from app.organico.dibujo import Marco, degradado, referencias
from app.organico.tipos import ACABADOS, Aspecto, diametro_m

__all__ = [
    "ARMADO_VERSION",
    "DISPOSICIONES_NUMERO",
    "GLOBOS_POR_UNIDAD",
    "MAX_GLOBOS_ARMADO",
    "MAX_MATERIALES",
    "MAX_NIVELES",
    "MAX_UNIDADES",
    "ORIGENES_ARMADO",
    "ROLES_NIVEL",
    "TIPOS_MATERIAL",
    "UNIDADES_ARMADO",
    "VARIANTES_ARMADO",
    "ArmadoBouquetV1",
    "ConfigArmado",
    "EstadoArmado",
    "MaterialArmado",
    "NivelArmado",
    "OpcionesArmado",
    "ResultadoArmado",
    "armado_desde_json",
    "armado_inicial",
    "estado_armado_inicial",
    "generar_armado",
    "normalizar_armado",
    "normalizar_estado_armado",
    "radio_material",
    "svg_documento_armado",
]

ARMADO_VERSION = "armado-bouquet.v1"

VARIANTES_ARMADO = ("base_aire", "helio_apilado", "helio_escalonado")


class _Texto(TypedDict):
    texto: str
    ayuda: str


VARIANTES_TEXTO: dict[str, _Texto] = {
    "base_aire": {
        "texto": "Base de aire",
        "ayuda": (
            "Globos inflados con aire, apilados sobre una base y una varilla. No flotan: es de mesa"
            " o de piso."
        ),
    },
    "helio_apilado": {
        "texto": "Helio apilado",
        "ayuda": "Capas de globos con helio, una sobre otra, atadas a una pesa.",
    },
    "helio_escalonado": {
        "texto": "Helio escalonado",
        "ayuda": "Globos con helio a alturas distintas de cinta, atados a una pesa.",
    },
}

UNIDADES_ARMADO = ("suelto", "pareja", "trio", "cuarteto", "quinteto", "sexteto")
#: Globos de cada unidad de armado (técnica Sempertex).
GLOBOS_POR_UNIDAD: dict[str, int] = {
    "suelto": 1,
    "pareja": 2,
    "trio": 3,
    "cuarteto": 4,
    "quinteto": 5,
    "sexteto": 6,
}
UNIDADES_TEXTO: dict[str, str] = {
    "suelto": "Suelto (1)",
    "pareja": "Pareja (2)",
    "trio": "Trío (3)",
    "cuarteto": "Cuarteto (4)",
    "quinteto": "Quinteto (5)",
    "sexteto": "Sexteto (6)",
}

ROLES_NIVEL = ("base", "cuerpo", "capa", "alrededor", "acento", "relleno")
ROLES_TEXTO: dict[str, str] = {
    "base": "Base",
    "cuerpo": "Cuerpo",
    "capa": "Capa",
    "alrededor": "Alrededor",
    "acento": "Acento",
    "relleno": "Relleno",
}

DISPOSICIONES_NUMERO = ("centro", "lados", "arriba", "abajo")
DISPOSICIONES_TEXTO: dict[str, str] = {
    "arriba": "Arriba",
    "centro": "Al centro",
    "lados": "A los lados",
    "abajo": "Abajo",
}

ORIGENES_ARMADO = ("decorador", "referencia", "sugerido")


class NivelArmado(TypedDict):
    rol: str
    unidad: str
    cantidad: float
    posiciones: list[int]


class NumeroArmado(TypedDict):
    digitos: list[int]
    disposicion: str


class ArmadoBouquetV1(TypedDict, total=False):
    """Contrato ``armado-bouquet.v1`` (solo forma)."""

    version: str
    origen: str
    variante: str
    niveles: list[NivelArmado]
    remate: list[int]
    numero: NumeroArmado


#: Qué es cada material: en el sistema principal sale de la «leyenda» (producto, tamaño, color, dígito).
TIPOS_MATERIAL = ("latex", "metalizado", "burbuja", "numero")
TIPOS_MATERIAL_TEXTO: dict[str, str] = {
    "latex": "Látex",
    "metalizado": "Metalizado redondo",
    "burbuja": "Burbuja",
    "numero": "Número foil",
}


class MaterialArmado(TypedDict):
    color: str
    acabado: str
    tipo: str
    tamanoPulg: float
    digito: str


class ConfigArmado(TypedDict):
    """Lo que el diseñador guarda de un bouquet por partes: el armado y los materiales que indexa."""

    armado: ArmadoBouquetV1
    materiales: list[MaterialArmado]


class EstadoArmado(TypedDict):
    """El armado con sus materiales, cómo se ven los globos y si se muestra una persona de referencia."""

    armado: ArmadoBouquetV1
    materiales: list[MaterialArmado]
    aspecto: Aspecto
    persona: bool


#: Un armado del contrato admite hasta 12 materiales (índices 0–11), 8 niveles y 24 unidades por nivel.
MAX_MATERIALES = 12
MAX_NIVELES = 8
MAX_UNIDADES = 24
MAX_GLOBOS_ARMADO = 96

_SOMBRA = "#0a1a16"


def _f(valor: float) -> str:
    """Un número del SVG: a dos decimales y escrito como lo escribe JavaScript."""
    return str(_numero(_redondear(valor * 100) / 100))


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


# --------------------------------------------------------------------------------------------------------
# Estado inicial y saneado
# --------------------------------------------------------------------------------------------------------


def armado_inicial() -> ConfigArmado:
    """El de la foto de referencia: dos cuartetos de látex cromado sobre una base de aire y un número foil."""
    return {
        "armado": {
            "version": ARMADO_VERSION,
            "origen": "decorador",
            "variante": "base_aire",
            "niveles": [
                {"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
                {"rol": "cuerpo", "unidad": "cuarteto", "cantidad": 1, "posiciones": [1, 1, 1, 1]},
            ],
            "numero": {"digitos": [2], "disposicion": "arriba"},
        },
        "materiales": [
            {
                "color": "#7a4bb0",
                "acabado": "cromado",
                "tipo": "latex",
                "tamanoPulg": 12,
                "digito": "",
            },
            {
                "color": "#d9a9cf",
                "acabado": "cromado",
                "tipo": "latex",
                "tamanoPulg": 12,
                "digito": "",
            },
            {
                "color": "#c3c7cd",
                "acabado": "cromado",
                "tipo": "numero",
                "tamanoPulg": 16,
                "digito": "5",
            },
        ],
    }


def estado_armado_inicial() -> EstadoArmado:
    """El armado de ejemplo con su aspecto de partida y sin persona de referencia."""
    base = armado_inicial()
    return {
        "armado": base["armado"],
        "materiales": base["materiales"],
        "aspecto": {
            "brillo": 0.6,
            "sombra": 0.16,
            "contorno": 0.6,
            "profundidad": 0.35,
            "semilla": 1,
        },
        "persona": False,
    }


def _num(valor: object, respaldo: float) -> float:
    """``Number.isFinite``: un ``NaN``, un infinito o algo que no es número caen al respaldo."""
    return float(cast(float, valor)) if _es_finito(valor) else respaldo


def _obj(valor: object) -> dict[str, Any]:
    return valor if isinstance(valor, dict) else {}


def _uno(lista: tuple[str, ...] | list[str], valor: object, respaldo: str) -> str:
    """``lista.includes(v) ? v : respaldo``."""
    return valor if isinstance(valor, str) and valor in lista else respaldo


_UN_DIGITO = re.compile(r"^\d$")


def normalizar_armado(entrada: object) -> ConfigArmado:
    """Convierte cualquier cosa que llegue de fuera en un armado que se pueda dibujar.

    Solo mira la forma: los índices se ajustan a los materiales y las posiciones a los globos de la unidad;
    las reglas de negocio (qué se puede comprar o poner con helio) no se revisan aquí. Nunca lanza.
    """
    base = armado_inicial()
    e = _obj(entrada)
    materiales: list[MaterialArmado]
    if isinstance(e.get("materiales"), list):
        materiales = []
        for i, m in enumerate(e["materiales"][:MAX_MATERIALES]):
            o = _obj(m)
            respaldo = base["materiales"][i % len(base["materiales"])]
            tipo = _uno(TIPOS_MATERIAL, o.get("tipo"), "latex")
            digito_crudo = o.get("digito")
            if isinstance(digito_crudo, str) and _UN_DIGITO.match(digito_crudo):
                digito = digito_crudo
            else:
                digito = "0" if tipo == "numero" else ""
            materiales.append(
                {
                    "color": normalizar_color(o.get("color"), respaldo["color"]),
                    "acabado": _uno([a["valor"] for a in ACABADOS], o.get("acabado"), "mate"),
                    "tipo": tipo,
                    "tamanoPulg": _acotar(
                        _num(o.get("tamanoPulg"), 16 if tipo == "numero" else 12), 4, 44
                    ),
                    "digito": digito,
                }
            )
    else:
        materiales = base["materiales"]
    mats = materiales if materiales else base["materiales"]
    n = len(mats)

    def indice(v: object) -> int:
        return int(mate.fmod(mate.fmod(_redondear(_num(v, 0)), n) + n, n))

    a = _obj(e.get("armado"))
    crudas = a["niveles"] if isinstance(a.get("niveles"), list) else base["armado"]["niveles"]
    niveles: list[NivelArmado] = []
    for nv in crudas[:MAX_NIVELES]:
        o = _obj(nv)
        unidad = _uno(UNIDADES_ARMADO, o.get("unidad"), "suelto")
        k = GLOBOS_POR_UNIDAD[unidad]
        if isinstance(o.get("posiciones"), list) and o["posiciones"]:
            dadas = [indice(p) for p in o["posiciones"]]
        else:
            dadas = [0]
        niveles.append(
            {
                "rol": _uno(ROLES_NIVEL, o.get("rol"), "cuerpo"),
                "unidad": unidad,
                "cantidad": _redondear(_acotar(_num(o.get("cantidad"), 1), 1, MAX_UNIDADES)),
                # Un color por globo de la unidad: si faltan, se repite el último; si sobran, se cortan.
                "posiciones": [dadas[int(_minimo(j, len(dadas) - 1))] for j in range(k)],
            }
        )

    # Demasiados globos: se quitan unidades de los niveles de más arriba hasta que siga siendo un bouquet.
    def total() -> float:
        suma = 0.0
        for nv in niveles:
            suma += nv["cantidad"] * GLOBOS_POR_UNIDAD[nv["unidad"]]
        return suma

    vuelta = 0
    while vuelta < 400 and total() > MAX_GLOBOS_ARMADO:
        cantidades = [nv["cantidad"] for nv in niveles]
        tope = max(cantidades)
        i = len(cantidades) - 1 - cantidades[::-1].index(tope)
        if niveles[i]["cantidad"] > 1:
            niveles[i]["cantidad"] -= 1
        else:
            niveles.pop()
        vuelta += 1

    remate = [indice(x) for x in a["remate"][:4]] if isinstance(a.get("remate"), list) else []
    nu = _obj(a.get("numero"))
    digitos = [indice(x) for x in nu["digitos"][:3]] if isinstance(nu.get("digitos"), list) else []

    armado: ArmadoBouquetV1 = {
        "version": ARMADO_VERSION,
        "origen": _uno(ORIGENES_ARMADO, a.get("origen"), "decorador"),
        "variante": _uno(VARIANTES_ARMADO, a.get("variante"), "base_aire"),
        "niveles": niveles,
    }
    if remate:
        armado["remate"] = remate
    if digitos:
        armado["numero"] = {
            "digitos": digitos,
            "disposicion": _uno(DISPOSICIONES_NUMERO, nu.get("disposicion"), "arriba"),
        }
    # Un armado sin nada que dibujar vuelve al de ejemplo.
    if not armado["niveles"] and "remate" not in armado and "numero" not in armado:
        return normalizar_armado({"armado": base["armado"], "materiales": mats})
    return {"armado": armado, "materiales": mats}


def normalizar_estado_armado(entrada: object) -> EstadoArmado:
    """Convierte cualquier cosa que llegue de fuera en un estado válido. Nunca lanza."""
    base = estado_armado_inicial()
    e = _obj(entrada)
    a = _obj(e.get("aspecto"))
    config = normalizar_armado(e)
    return {
        "armado": config["armado"],
        "materiales": config["materiales"],
        "aspecto": {
            "brillo": _acotar(_num(a.get("brillo"), base["aspecto"]["brillo"]), 0, 1),
            "sombra": _acotar(_num(a.get("sombra"), base["aspecto"]["sombra"]), 0, 0.5),
            "contorno": _acotar(_num(a.get("contorno"), base["aspecto"]["contorno"]), 0, 3),
            "profundidad": _acotar(
                _num(a.get("profundidad"), base["aspecto"]["profundidad"]), 0, 1
            ),
            "semilla": 1,
        },
        "persona": e.get("persona") is True,
    }


#: Nombres de color del sistema principal (su «leyenda» los trae en español) → color de dibujo.
COLORES_NOMBRE: dict[str, str] = {
    "blanco": "#f5f3ee",
    "negro": "#1f2124",
    "gris": "#9aa0a6",
    "plateado": "#c3c7cd",
    "plata": "#c3c7cd",
    "dorado": "#d4af37",
    "oro": "#d4af37",
    "rosa dorado": "#c98b6b",
    "cobre": "#b87345",
    "bronce": "#a9772e",
    "rojo": "#c0392b",
    "vino": "#7d1f36",
    "burgundy": "#7d1f36",
    "naranja": "#e8853a",
    "coral": "#f0836a",
    "durazno": "#f4c7b5",
    "melocoton": "#f4c7b5",
    "amarillo": "#f2c94c",
    "verde": "#3f9b5b",
    "menta": "#a8d5c2",
    "turquesa": "#3fb3b0",
    "azul": "#2f6fc0",
    "celeste": "#8ec5ee",
    "azul marino": "#1f3a68",
    "morado": "#7a4bb0",
    "violeta": "#7a4bb0",
    "lila": "#c9a9de",
    "lavanda": "#c9a9de",
    "fucsia": "#d63384",
    "rosa": "#eeaec1",
    "rosado": "#eeaec1",
    "rosa pastel": "#f3c9d5",
    "beige": "#e4d3b6",
    "crema": "#f1e6cf",
    "marfil": "#f1e6cf",
    "arena": "#dcc7a1",
    "cafe": "#7a5238",
    "marron": "#7a5238",
}

_HEX6 = re.compile(r"^#[0-9a-f]{6}$")


def _limpio(valor: object) -> str:
    """Sin espacios, en minúsculas y sin tildes: ``normalize("NFD")`` y fuera las marcas de U+0300–U+036F."""
    if not isinstance(valor, str):
        return ""
    descompuesto = unicodedata.normalize("NFD", valor.strip().lower())
    return "".join(c for c in descompuesto if not ("̀" <= c <= "ͯ"))


def _color_de_nombre(nombre: object, respaldo: str) -> str:
    """El color de dibujo de un nombre en español, de un hexadecimal, o el respaldo."""
    n = _limpio(nombre)
    if not n:
        return respaldo
    if _HEX6.match(n):
        return n
    if n in COLORES_NOMBRE:
        return COLORES_NOMBRE[n]
    parte = next(
        (k for k in sorted(COLORES_NOMBRE.keys(), key=lambda k: -len(k)) if k in n),
        None,
    )
    return COLORES_NOMBRE[parte] if parte is not None else respaldo


def armado_desde_json(texto: str) -> dict[str, Any]:
    """Lee un JSON pegado con la salida del sistema principal.

    Admite un ``armado-bouquet.v1`` solo, un armado resuelto (con su ``leyenda``, de la que salen los
    materiales) o el estado de este diseñador (``armado`` + ``materiales``). Devuelve ``{"config": …}`` o
    ``{"error": …}``.
    """
    try:
        dato = json.loads(texto)
    except ValueError:
        return {"error": "El texto no es un JSON válido."}
    e = _obj(dato)
    if e.get("armado"):
        armado: Any = e["armado"]
    elif e.get("niveles") or e.get("variante"):
        armado = e
    else:
        armado = None
    if not armado:
        return {
            "error": "No encontré un armado: falta el campo «armado» (o «niveles» y «variante»)."
        }
    if isinstance(e.get("materiales"), list):
        return {"config": normalizar_armado({"armado": armado, "materiales": e["materiales"]})}
    if isinstance(e.get("leyenda"), list):
        # Salida resuelta: un material por código de la leyenda, en el orden del índice que declara cada
        # entrada.
        filas = sorted((_obj(x) for x in e["leyenda"]), key=lambda p: _num(p.get("material"), 0))
        materiales: list[MaterialArmado | None] = []
        for fila in filas:
            i = int(_redondear(_num(fila.get("material"), len(materiales))))
            if i < 0 or i >= MAX_MATERIALES or (i < len(materiales) and materiales[i] is not None):
                continue
            tipo = _uno(TIPOS_MATERIAL, fila.get("tipo_globo"), "latex")
            acabado_crudo = _limpio(fila.get("acabado"))
            if re.search(r"crom|chrome|metal|perl", acabado_crudo):
                acabado = "cromado"
            elif re.search(r"transparent|cristal", acabado_crudo):
                acabado = "transparente"
            elif re.search(r"confeti|confetti", acabado_crudo):
                acabado = "confeti"
            else:
                acabado = "mate"
            digito = fila.get("digito")
            while len(materiales) <= i:
                materiales.append(None)
            materiales[i] = {
                "color": _color_de_nombre(fila.get("color"), "#9aa0a6"),
                "acabado": acabado,
                "tipo": tipo,
                "tamanoPulg": _num(fila.get("tamano_pulg"), 16 if tipo == "numero" else 12),
                "digito": digito if isinstance(digito, str) else "",
            }
        # Un hueco (índice sin fila en la leyenda) se rellena con un látex gris para no romper los índices.
        completos: list[MaterialArmado] = [
            m
            if m is not None
            else {
                "color": "#9aa0a6",
                "acabado": "mate",
                "tipo": "latex",
                "tamanoPulg": 12,
                "digito": "",
            }
            for m in materiales
        ]
        if completos:
            return {"config": normalizar_armado({"armado": armado, "materiales": completos})}
    return {
        "config": normalizar_armado(
            {"armado": armado, "materiales": armado_inicial()["materiales"]}
        )
    }


# --------------------------------------------------------------------------------------------------------
# Geometría
# --------------------------------------------------------------------------------------------------------

_TAMANOS: tuple[int, ...] = (5, 9, 12, 18, 24, 36)


def _nominal_de(pulg: float) -> int:
    """El tamaño estándar más próximo a un tamaño en pulgadas."""
    mejor = _TAMANOS[0]
    for t in _TAMANOS:
        if abs(t - pulg) < abs(mejor - pulg):
            mejor = t
    return mejor


def radio_material(m: MaterialArmado) -> float:
    """Radio (m) de un globo redondo de un material.

    El látex se infla como en el resto del diseñador; foil y burbuja miden lo que dice su tamaño.
    """
    if m["tipo"] == "latex":
        return float(diametro_m(_nominal_de(m["tamanoPulg"])) / 2)
    return float((m["tamanoPulg"] * 0.0254) / 2)


def _alto_numero(m: MaterialArmado) -> float:
    """Alto (m) de un número foil: su tamaño en pulgadas."""
    return m["tamanoPulg"] * 0.0254


@dataclass(eq=False)
class _Globo3D:
    x: float
    y: float
    z: float
    r: float
    mat: int
    nivel: int


@dataclass(eq=False)
class _Pieza:
    x: float
    y: float
    r: float
    alto: float
    ancho: float
    mat: int
    digito: str
    tipo: str


#: Alto de la base (m) donde termina el soporte: la base de aire es baja; con helio, la pesa y su cinta.
BASE_M = 0.035
PESA_M: dict[str, float] = {"alto": 0.13, "ancho": 0.17}
#: Cuánto baja en pantalla un globo por estar más cerca (vista desde un poco más arriba), en radios de anillo.
INCLINACION_VISTA = 0.42


class _PorNivel(TypedDict):
    rol: str
    unidad: str
    cantidad: float
    globos: float


@dataclass(eq=False)
class ResultadoArmado:
    svg: str
    altoM: float
    anchoM: float
    #: Globos redondos (niveles + remate).
    globos: int
    #: Globos número.
    numeros: int
    porNivel: list[_PorNivel]
    #: Cuántos globos usa cada material (mismo orden que ``materiales``).
    usados: list[int]


class OpcionesArmado(TypedDict, total=False):
    ajustar: bool
    prefijo: str
    persona: bool
    suelo: bool
    cinta: dict[str, str]
    pesa: dict[str, str]


_LIENZO: dict[str, float] = {"w": 600, "h": 720}


def generar_armado(
    entrada: ConfigArmado, aspecto: Aspecto, op: OpcionesArmado | None = None
) -> ResultadoArmado:
    """Dibuja el armado: niveles apilados en 3D (de frente, un poco desde arriba), remate, números y soporte."""
    op = {} if op is None else op
    # Los colores canónicos (`sx:041`) se cambian por su hexadecimal aquí: de esta línea para abajo el motor
    # solo ve `#rrggbb`, igual que siempre (ver `app/motores/canonico.py`).
    cfg = cast(ConfigArmado, resolver_colores(entrada))
    armado = cfg["armado"]
    materiales = cfg["materiales"]
    helio = armado["variante"] != "base_aire"
    escalonado = armado["variante"] == "helio_escalonado"

    def mat(i: int) -> MaterialArmado:
        return materiales[i] if 0 <= i < len(materiales) else materiales[0]

    crudo = op.get("prefijo")
    prefijo = "" if crudo is None else crudo
    numero_cfg = armado.get("numero")
    abajo = numero_cfg is not None and numero_cfg["disposicion"] == "abajo"

    # 1) Numeros de abajo: el bouquet se apoya sobre ellos.
    digitos: list[tuple[int, MaterialArmado]] = [
        (i, mat(i)) for i in (numero_cfg["digitos"] if numero_cfg is not None else [])
    ]
    alto_digitos = max(_alto_numero(m) for _i, m in digitos) if digitos else 0.0
    soporte = (PESA_M["alto"] + (0.5 if escalonado else 0.35)) if helio else BASE_M
    cursor = soporte + (alto_digitos * 0.7 if abajo else 0)
    base0 = cursor

    # 2) Niveles de abajo hacia arriba.
    globos: list[_Globo3D] = []
    rho_torre = 0.0
    for i, nv in enumerate(armado["niveles"]):
        k = GLOBOS_POR_UNIDAD[nv["unidad"]]
        rs = [radio_material(mat(p)) for p in nv["posiciones"]]
        r_max = max(rs)
        # Anillo en el que los k globos se tocan entre sí.
        rho = 0.0 if k == 1 else r_max / mate.sin(mate.pi / k)
        rho_torre = float(_maximo(rho_torre, rho))
        paso_x = 2 * (rho + r_max) * 0.9
        # Cada nivel gira media vuelta respecto del anterior; la pareja arranca de lado para que se vea como
        # dos globos.
        theta0 = (0 if i % 2 == 0 else mate.pi / k) + (mate.pi / 2 if k == 2 else 0)
        u = 0.0
        while u < nv["cantidad"]:
            ux = (u - (nv["cantidad"] - 1) / 2) * paso_x
            if escalonado:
                indice_par = (u if nv["cantidad"] > 1 else i) % 2 == 0
                desnivel = (-0.45 if indice_par else 0.45) * r_max
            else:
                desnivel = 0.0
            for j in range(k):
                th = theta0 + (j / k) * mate.pi * 2
                globos.append(
                    _Globo3D(
                        x=ux + rho * mate.sin(th),
                        z=rho * mate.cos(th),
                        y=cursor + r_max + desnivel,
                        r=rs[j],
                        mat=nv["posiciones"][j],
                        nivel=i,
                    )
                )
            u += 1
        paso = 1.8 if k >= 3 else (1.9 if k == 2 else 2)
        cursor += paso * r_max + (r_max * 0.45 if escalonado else 0)

    def vista(g: _Globo3D) -> float:
        return g.y - INCLINACION_VISTA * g.z

    r_max_torre = max(g.r for g in globos) if globos else 0.1
    # Techo de los niveles y anchos.
    techo = max(vista(g) + g.r for g in globos) if globos else base0
    techo_niveles = techo
    izq0 = min(g.x - g.r for g in globos) if globos else -0.1
    der0 = max(g.x + g.r for g in globos) if globos else 0.1

    # 3) Remate (arriba) y números.
    piezas: list[_Pieza] = []
    remate: list[tuple[int, MaterialArmado]] = [(i, mat(i)) for i in armado.get("remate", [])]
    if remate:
        rs_remate = [radio_material(m) for _i, m in remate]
        ancho_remate = 0.0
        for r in rs_remate:
            ancho_remate += 2 * r * 1.04
        x = -ancho_remate / 2
        cima = techo
        for k2, (indice_mat, material) in enumerate(remate):
            r = rs_remate[k2]
            x += r * 1.04
            es_numero = material["tipo"] == "numero"
            piezas.append(
                _Pieza(
                    x=x,
                    y=cima + r * 0.8,
                    r=r,
                    alto=2 * r,
                    ancho=2 * r * 0.68 if es_numero else 2 * r,
                    mat=indice_mat,
                    digito=(material["digito"] or "0") if es_numero else "",
                    tipo=material["tipo"],
                )
            )
            x += r * 1.04
        techo = max(p.y + p.r for p in piezas)

    numeros: list[_Pieza] = []
    izq_num = 0.0
    der_num = 0.0
    if numero_cfg is not None and digitos:
        disp = numero_cfg["disposicion"]
        hs = [_alto_numero(m) for _i, m in digitos]
        anchos = [h * 0.68 for h in hs]
        paso_total = 0.0
        for w in anchos:
            paso_total += w * 1.12
        x = -paso_total / 2
        for k2, (indice_mat, material) in enumerate(digitos):
            h = hs[k2]
            w = anchos[k2]
            cx = x + (w * 1.12) / 2
            if disp == "arriba":
                cy = techo + h / 2 - h * 0.42
            elif disp == "abajo":
                cy = soporte + h / 2
            elif disp == "lados":
                # Un número a cada lado del bouquet, de pie en el suelo: el primero a la izquierda, el resto
                # a la derecha.
                derecha = len(digitos) == 1 or k2 > 0
                lado_izq = izq0 - w * 0.55 - 0.03
                lado_der = der0 + w * 0.55 + 0.03
                cx = lado_der + _maximo(0, k2 - 1) * w * 1.1 if derecha else lado_izq
                cy = soporte - (PESA_M["alto"] if helio else 0) + h / 2
            else:
                cy = (base0 + techo) / 2
            x += w * 1.12
            pieza = _Pieza(
                x=cx,
                y=cy,
                r=h / 2,
                alto=h,
                ancho=w,
                mat=indice_mat,
                digito=material["digito"] or "0",
                tipo="numero",
            )
            piezas.append(pieza)
            numeros.append(pieza)
            if disp == "lados":
                if cx < 0:
                    izq_num = float(_minimo(izq_num, cx - w / 2))
                else:
                    der_num = float(_maximo(der_num, cx + w / 2))
        if disp == "arriba":
            techo = float(max([techo, *[p.y + p.alto / 2 for p in numeros]]))

    # 4) Medidas y encuadre.
    izq = min([izq0, *[p.x - p.ancho / 2 for p in piezas], izq_num])
    der = max([der0, *[p.x + p.ancho / 2 for p in piezas], der_num])
    soporte_ancho = PESA_M["ancho"] if helio else _maximo(0.16, (der0 - izq0) * 0.5)
    ancho_m = float(max([0.3, der - izq, soporte_ancho]))
    alto_m = float(_maximo(techo, soporte))
    persona = bool(op.get("persona")) and not op.get("ajustar")
    if op.get("ajustar"):
        escala = float(_minimo((_LIENZO["w"] - 60) / ancho_m, (_LIENZO["h"] - 60) / alto_m))
        piso = _LIENZO["h"] - 30 - _maximo(0, (_LIENZO["h"] - 60 - alto_m * escala) / 2)
        centro = _LIENZO["w"] / 2
        marco = Marco(
            escala=escala,
            piso=piso,
            cx=centro,
            centro=centro,
            anchoPx=ancho_m * escala,
            w=_LIENZO["w"],
            h=_LIENZO["h"],
        )
    else:
        alto_ref = _maximo(alto_m + 0.05, 1.7 if persona else 0.5)
        # La regla sube hasta el siguiente medio metro: la escala cuenta esa altura para que no se corte.
        alto_regla = mate.ceil(alto_ref * 2) / 2
        centro = 400 if persona else 320
        piso = _LIENZO["h"] - 52
        escala = float(
            _minimo((piso - 34) / alto_regla, (170 if persona else 250) / (ancho_m / 2 + 0.05))
        )
        marco = Marco(
            escala=escala,
            piso=piso,
            cx=centro,
            centro=centro,
            anchoPx=ancho_m * escala,
            w=_LIENZO["w"],
            h=_LIENZO["h"],
            referencia={
                "persona": persona,
                "altoRef": alto_ref,
                "personaX": 112,
                "reglaX": 44,
            },
        )
    cx0 = (izq + der) / 2

    def X(x_m: float) -> float:
        return float(centro + (x_m - cx0) * escala)

    def Y(y_m: float) -> float:
        return float(piso - y_m * escala)

    # 5) Dibujo.
    grad: dict[str, str] = {}

    def id_grad(color: str, acabado: str) -> str:
        ident = f"{prefijo}a{color[1:]}{acabado[0]}"
        if ident not in grad:
            grad[ident] = degradado(ident, color, acabado)
        return ident

    def id_foil(color: str, cromado: bool = False) -> str:
        ident = f"{prefijo}f{color[1:]}{'c' if cromado else ''}"
        if ident not in grad:
            if cromado:
                paradas = (
                    f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.9)}"/>'
                    f'<stop offset="0.2" stop-color="{color}"/>'
                    f'<stop offset="0.38" stop-color="{mezclar(color, "#000000", 0.5)}"/>'
                    f'<stop offset="0.55" stop-color="{mezclar(color, "#ffffff", 0.6)}"/>'
                    f'<stop offset="0.78" stop-color="{mezclar(color, "#000000", 0.32)}"/>'
                    f'<stop offset="1" stop-color="{mezclar(color, "#ffffff", 0.5)}"/>'
                )
            else:
                paradas = (
                    f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.75)}"/>'
                    f'<stop offset="0.3" stop-color="{color}"/>'
                    f'<stop offset="0.62" stop-color="{mezclar(color, "#000000", 0.38)}"/>'
                    f'<stop offset="1" stop-color="{mezclar(color, "#ffffff", 0.4)}"/>'
                )
            grad[ident] = (
                f'<linearGradient id="{ident}" x1="0.1" y1="0" x2="0.9" y2="1">'
                f"{paradas}</linearGradient>"
            )
        return ident

    partes: list[str] = []
    if marco.referencia:
        partes.append(referencias(marco))
    if op.get("suelo") is not False:
        x1 = 20 if marco.referencia else centro - (ancho_m * escala) / 2 - 12
        x2 = _LIENZO["w"] - 20 if marco.referencia else centro + (ancho_m * escala) / 2 + 12
        partes.append(
            f'<line x1="{_f(x1)}" y1="{_f(piso + 8)}" x2="{_f(x2)}" y2="{_f(piso + 8)}"'
            f' stroke="#8fa39a" stroke-width="3" stroke-linecap="round" stroke-opacity="0.55"/>'
        )

    # Soporte, detrás de todo.
    cinta = op.get("cinta") or {"tipo": "lisa", "color": "#e6b8a2"}
    if not helio:
        bw = soporte_ancho * escala
        partes.append(
            f'<rect x="{_f(X(0) - bw / 2)}" y="{_f(Y(BASE_M))}" width="{_f(bw)}"'
            f' height="{_f(BASE_M * escala)}" rx="3" fill="#59635f" stroke="#2b3330"'
            f' stroke-width="1"/>'
            f'<rect x="{_f(X(0) - bw / 2)}" y="{_f(Y(BASE_M))}" width="{_f(bw)}"'
            f' height="{_f(_maximo(1.5, BASE_M * escala * 0.3))}" rx="2" fill="#7a8681"/>'
        )
        # La varilla llega hasta el centro del remate o del número de arriba, o del último nivel.
        alturas = [
            p.y
            for p in piezas
            if p.tipo != "numero"
            or (numero_cfg is not None and numero_cfg["disposicion"] == "arriba")
        ]
        altura_varilla = max([techo_niveles - r_max_torre, *alturas])
        tope_varilla = Y(altura_varilla)
        partes.append(
            f'<line x1="{_f(X(0))}" y1="{_f(Y(BASE_M))}" x2="{_f(X(0))}"'
            f' y2="{_f(tope_varilla)}" stroke="#aab4b0"'
            f' stroke-width="{_f(_maximo(1.6, 0.012 * escala))}" stroke-linecap="round"'
            f' stroke-opacity="0.85"/>'
        )
    else:
        # Cintas desde el nudo de cada globo del primer nivel (y de los números de arriba) hasta la pesa.
        pesa_x = X(0)
        pesa_y = Y(PESA_M["alto"])
        punta = [g for g in globos if g.nivel == 0]
        if punta:
            cabos = [{"x": g.x, "y": vista(g) - g.r} for g in punta]
        else:
            cabos = [{"x": p.x, "y": p.y - p.alto / 2} for p in piezas]
        for c in cabos:
            partes.append(
                f'<path d="M{_f(X(c["x"]))} {_f(Y(c["y"]))}Q{_f((X(c["x"]) + pesa_x) / 2)}'
                f' {_f((Y(c["y"]) + pesa_y) / 2)} {_f(pesa_x)} {_f(pesa_y)}" fill="none"'
                f' stroke="{cinta["color"]}" stroke-width="1.3" stroke-opacity="0.9"'
                f' stroke-linecap="round"/>'
            )
        # Una cinta central que baja del remate o de los números hasta la pesa, por detrás de la torre.
        partes.append(
            f'<line x1="{_f(X(0))}" y1="{_f(Y(techo - r_max_torre))}" x2="{_f(pesa_x)}"'
            f' y2="{_f(pesa_y)}" stroke="{cinta["color"]}" stroke-width="1.3"'
            f' stroke-opacity="0.75"/>'
        )

    # Globos de los niveles y remate, de atrás hacia adelante; los números de «arriba» van entre los del
    # fondo y los del frente.
    dibujos: list[tuple[float, int, str]] = []

    def oscuro(z: float) -> float:
        if aspecto["profundidad"] > 0 and rho_torre > 0 and z < 0:
            return float(0.26 * aspecto["profundidad"] * _minimo(1, -z / rho_torre))
        return 0.0

    def esfera(m: MaterialArmado, cx: float, cy: float, R: float, idx: int, sombra: float) -> str:
        rnd = crear_rng(idx * 2654435761 + 17)
        trazo = (
            f' stroke="{mezclar(m["color"], "#000000", 0.45)}" stroke-opacity="0.6"'
            f' stroke-width="{_numero(aspecto["contorno"])}"'
            if aspecto["contorno"] > 0
            else ""
        )
        s = ""
        translucido = (
            m["acabado"] == "confeti" or m["acabado"] == "transparente" or m["tipo"] == "burbuja"
        )
        if aspecto["sombra"] > 0:
            s += (
                f'<ellipse cx="{_f(cx + R * 0.07)}" cy="{_f(cy + R * 0.1)}"'
                f' rx="{_f(R * 1.01)}" ry="{_f(R * 1.01)}" fill="{_SOMBRA}"'
                f' fill-opacity="{_f(aspecto["sombra"] * (0.1 if translucido else 1))}"/>'
            )
        if m["tipo"] == "burbuja":
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R)}" fill="#ffffff"'
                f' fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.6"/>'
            )
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R * 0.93)}" fill="none"'
                f' stroke="#ffffff" stroke-opacity="0.18" stroke-width="{_f(R * 0.05)}"/>'
            )
            if m["acabado"] == "confeti":
                tonos = [m["color"], "#d4af37", "#ffffff", mezclar(m["color"], "#ffffff", 0.5)]
                for k3 in range(30):
                    ang = rnd() * mate.pi * 2
                    rad = mate.sqrt(rnd()) * R * 0.85
                    s += (
                        f'<circle cx="{_f(cx + mate.cos(ang) * rad)}"'
                        f' cy="{_f(cy + mate.sin(ang) * rad)}"'
                        f' r="{_f(R * (0.025 + rnd() * 0.03))}"'
                        f' fill="{tonos[k3 % len(tonos)]}" fill-opacity="0.9"/>'
                    )
        elif m["tipo"] == "metalizado":
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R)}"'
                f' fill="url(#{id_foil(m["color"], m["acabado"] == "cromado")})"'
                f' stroke="{mezclar(m["color"], "#000000", 0.4)}" stroke-width="1"/>'
            )
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R * 0.78)}" fill="none"'
                f' stroke="#fff" stroke-opacity="0.28" stroke-width="1"/>'
            )
        elif m["acabado"] == "confeti" or m["acabado"] == "transparente":
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R)}"'
                f' fill="{mezclar(m["color"], "#ffffff", 0.78)}"'
                f' fill-opacity="{_numero(0.32 if m["acabado"] == "confeti" else 0.18)}"'
                f"{trazo}/>"
            )
            if m["acabado"] == "confeti":
                tonos = [m["color"], "#ffffff", "#d4af37", mezclar(m["color"], "#ffffff", 0.5)]
                for k3 in range(int(_maximo(8, _redondear(R / 2.2)))):
                    ang = rnd() * mate.pi * 2
                    rad = mate.sqrt(rnd()) * R * 0.78
                    s += (
                        f'<circle cx="{_f(cx + mate.cos(ang) * rad)}"'
                        f' cy="{_f(cy + mate.sin(ang) * rad)}"'
                        f' r="{_f(R * (0.05 + rnd() * 0.05))}"'
                        f' fill="{tonos[k3 % len(tonos)]}" fill-opacity="0.92"/>'
                    )
        else:
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R)}"'
                f' fill="url(#{id_grad(m["color"], m["acabado"])})"{trazo}/>'
            )
        if sombra > 0:
            s += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(R)}" fill="{_SOMBRA}"'
                f' fill-opacity="{_f(sombra)}"/>'
            )
        if aspecto["brillo"] > 0:
            b = (
                _minimo(1, aspecto["brillo"] * 1.3)
                if (m["acabado"] == "cromado" or m["tipo"] == "metalizado")
                else aspecto["brillo"]
            )
            hx = cx - 0.38 * R
            hy = cy - 0.46 * R
            s += (
                f'<ellipse cx="{_f(hx)}" cy="{_f(hy)}" rx="{_f(0.17 * R)}"'
                f' ry="{_f(0.27 * R)}" transform="rotate(30 {_f(hx)} {_f(hy)})" fill="#fff"'
                f' fill-opacity="{_f(b * (0.6 if translucido else 0.9))}"/>'
            )
            s += (
                f'<path d="M{_f(cx + 0.64 * R)} {_f(cy + 0.62 * R)}A{_f(0.9 * R)}'
                f' {_f(0.9 * R)} 0 0 1 {_f(cx - 0.18 * R)} {_f(cy + 0.9 * R)}" fill="none"'
                f' stroke="#fff" stroke-opacity="{_f(0.28 * b)}" stroke-width="{_f(0.06 * R)}"'
                f' stroke-linecap="round"/>'
            )
        return s

    def numero_foil(p: _Pieza, m: MaterialArmado) -> str:
        H = p.alto * escala
        cx = X(p.x)
        cy = Y(p.y)
        ident = id_foil(m["color"], m["acabado"] == "cromado")
        borde = mezclar(m["color"], "#000000", 0.4)
        s = (
            f'<text x="{_f(cx)}" y="{_f(cy + H * 0.05)}" text-anchor="middle"'
            f' dominant-baseline="central"'
            f' font-family="Arial Black, Inter, Arial, sans-serif" font-weight="900"'
            f' font-size="{_f(H * 1.02)}" fill="url(#{ident})" stroke="{borde}"'
            f' stroke-width="{_f(H * 0.04)}" stroke-linejoin="round"'
            f' paint-order="stroke">{p.digito}</text>'
        )
        if aspecto["brillo"] > 0:
            s += (
                f'<text x="{_f(cx)}" y="{_f(cy + H * 0.05)}" text-anchor="middle"'
                f' dominant-baseline="central"'
                f' font-family="Arial Black, Inter, Arial, sans-serif" font-weight="900"'
                f' font-size="{_f(H * 0.96)}" fill="none" stroke="#fff"'
                f' stroke-opacity="{_f(0.3 * aspecto["brillo"])}" stroke-width="1">'
                f"{p.digito}</text>"
            )
        return s

    for idx, g in enumerate(globos):
        dibujos.append(
            (
                g.z,
                g.nivel,
                esfera(mat(g.mat), X(g.x), Y(vista(g)), g.r * escala, idx, oscuro(g.z)),
            )
        )
    de_numero = {id(p) for p in numeros}
    for idx, p in enumerate(piezas):
        m = mat(p.mat)
        if id(p) in de_numero:
            continue
        # El remate va al frente de su nivel: encima de los globos de atrás y de los del frente (un número
        # foil de remate se dibuja como número).
        dibujos.append(
            (
                99,
                99,
                numero_foil(p, m)
                if p.tipo == "numero"
                else esfera(m, X(p.x), Y(p.y), p.r * escala, 100 + idx, 0),
            )
        )
    disp_final = numero_cfg["disposicion"] if numero_cfg is not None else None
    for p in numeros:
        m = mat(p.mat)
        # Arriba: entre los globos de atrás (z < 0) y los del frente (z ≥ 0), así queda «metido» entre ellos
        # como en la foto. Centro: delante de todo. Abajo y a los lados: de pie, delante del soporte.
        if disp_final == "arriba":
            z = -0.001
        elif disp_final == "centro":
            z = 100.0
        else:
            z = 98.0
        dibujos.append((z, 50 if disp_final == "arriba" else 100, numero_foil(p, m)))
    dibujos.sort(key=lambda d: (d[0], d[1]))
    # Los globos del frente (z ≥ 0) del nivel más alto se dibujan después del número de arriba: la orden por
    # z ya lo garantiza.
    for d in dibujos:
        partes.append(d[2])

    # La pesa va delante de las cintas y de los globos de abajo.
    pesa = op.get("pesa")
    if helio and (pesa is None or pesa.get("tipo") != "ninguno"):
        color_pesa = (pesa or {}).get("color") or "#f6efe6"
        w = PESA_M["ancho"] * escala
        h = PESA_M["alto"] * escala
        partes.append(
            f'<rect x="{_f(X(0) - w / 2)}" y="{_f(Y(PESA_M["alto"]))}" width="{_f(w)}"'
            f' height="{_f(h)}" rx="2" fill="{color_pesa}" stroke="{mezclar(color_pesa, "#000000", 0.4)}"'
            f' stroke-width="1"/>'
            f'<rect x="{_f(X(0) - w * 0.07)}" y="{_f(Y(PESA_M["alto"]))}"'
            f' width="{_f(w * 0.14)}" height="{_f(h)}"'
            f' fill="{mezclar(cinta["color"], color_pesa, 0.15)}"/>'
        )

    # Conteo por material.
    usados = [0 for _ in materiales]
    for g in globos:
        if 0 <= g.mat < len(usados):
            usados[g.mat] += 1
    for p in piezas:
        if 0 <= p.mat < len(usados):
            usados[p.mat] += 1

    return ResultadoArmado(
        svg=f"<defs>{''.join(grad.values())}</defs>{''.join(partes)}",
        altoM=alto_m,
        anchoM=ancho_m,
        globos=len(globos) + len([p for p in piezas if p.tipo != "numero"]),
        numeros=len([p for p in piezas if p.tipo == "numero"]),
        porNivel=[
            {
                "rol": nv["rol"],
                "unidad": nv["unidad"],
                "cantidad": nv["cantidad"],
                "globos": nv["cantidad"] * GLOBOS_POR_UNIDAD[nv["unidad"]],
            }
            for nv in armado["niveles"]
        ],
        usados=usados,
    )


def svg_documento_armado(interior: str, titulo: str = "Bouquet por partes") -> str:
    """Documento SVG completo, listo para descargar."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_numero(_LIENZO["w"])}'
        f' {_numero(_LIENZO["h"])}" width="{_numero(_LIENZO["w"])}"'
        f' height="{_numero(_LIENZO["h"])}" role="img" aria-label="{titulo}">{interior}</svg>\n'
    )
