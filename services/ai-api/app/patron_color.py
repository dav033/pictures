"""Patrón de color de una estructura (ADR-0028): dónde va cada color.

Dueño único de la semántica de ``patron_color`` (``patron-color.v1``): reglas
cruzadas, expansión a una rejilla de filas × posiciones, conteo por material,
presets, pistas leídas en la foto y la redacción (paso a paso, instrucciones de
armado y frases del prompt de imagen). TypeScript valida la forma y dibuja lo
que sale de aquí; nunca expande, cuenta ni redacta un patrón.

Módulo puro y determinista: sin E/S, sin ``random`` y sin reloj. La expansión
usa solo enteros, fracciones exactas y ``sha256``. Lo que depende del resolutor
—los globos por instancia que dan las medidas y si la mezcla efectiva tiene un
solo tamaño— llega ya calculado en ``EstructuraPatron``: ``plan.py`` lo calcula
y es quien lleva el conteo a la cotización.

Los números que aparecen en los textos son los de la leyenda de la gráfica
numerada: el material ``i`` de la estructura es el color ``i + 1``.

Zonas (ADR-0036): el único modo cuyo dibujo no es periódico ni va a lo largo de
un eje. Dice "este color va AGRUPADO en estos sitios" sobre una pared, con el
resto en un color de fondo. Es lo que ningún otro modo podía expresar y lo que
una pared orgánica del oficio es de verdad; su preset y la pista de la foto
salen de aquí igual que los demás.

Guirnalda con armado (ADR-0032, entrega E5): el patrón decide el color de cada
globo de los racimos; el armado (``armado_guirnalda.py``) decide la unidad, el
soporte, la forma, el relleno y los remates. ``EstructuraPatron`` trae del
armado solo sus globos por racimo y su forma: con ellos el preset va por racimo
(espiral o anillos, nunca confeti), la unidad del armado manda sobre la de la
foto y una guirnalda en U invertida admite el espejo desde el centro.
"""

from __future__ import annotations

import copy
import hashlib
import math
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import cast

from jsonschema import Draft7Validator

from app.generated_models import contract_schema

VERSION_PATRON = "patron-color.v1"
MAX_CELDAS = 4000
#: Distancia CIE76 máxima para leer un color de la foto como el de un material.
DELTA_E_PISTA = 25.0
CONFIANZA_MINIMA_PISTA = 0.5
#: Racimos de fondo entre flores cuando la pista de la foto dice "flor".
SEPARACION_FLOR_PISTA = 3

TIPOS_RACIMOS = frozenset({"columna", "arco", "semiarco", "guirnalda", "centro_mesa"})
TIPO_REJILLA = "pared"
_MODOS_LINEALES = ("espiral", "anillos", "bloques", "degradado", "aleatorio", "flor")
_MODOS_POR_TIPO: dict[str, tuple[str, ...]] = {
    "columna": _MODOS_LINEALES,
    "arco": _MODOS_LINEALES,
    "semiarco": _MODOS_LINEALES,
    "guirnalda": _MODOS_LINEALES,
    "centro_mesa": ("espiral", "anillos", "bloques", "aleatorio"),
    "pared": ("anillos", "bloques", "degradado", "aleatorio", "damero", "zonas"),
}
_TIPOS_ESPIRAL_SUGERIDA = frozenset({"columna", "arco", "semiarco", "guirnalda"})
#: Participación del color principal desde la que el preset de una pared va en
#: zonas (ADR-0036). Con un color que manda, una pared orgánica del oficio se
#: arma con los demás colores agrupados en manchas, no salteados; sin él (tres
#: o cuatro colores parejos) el confeti sigue siendo la lectura honesta.
DOMINANCIA_ZONAS = 0.5
#: Colores de una pared con los que el preset va en zonas: más allá, el fondo
#: deja de mandar y la pieza se describe mejor como una mezcla.
MAX_MATERIALES_ZONAS = 4
#: La forma del armado de guirnalda que se arma simétrica desde el centro (E5).
FORMA_GUIRNALDA_ESPEJO = "u_invertida"
AVISO_ESPEJO_GUIRNALDA = (
    "El patrón de la guirnalda quedó sin espejo: solo una guirnalda en U invertida se arma"
    " simétrica desde el centro."
)


def quitar_espejo_sin_u(estructura: dict[str, object], armado: object) -> list[str]:
    """Quita el espejo del patrón de una guirnalda que ya no va en U invertida (E5).

    El espejo de una guirnalda depende de su armado (``patron_color``): si el
    armado se quita o cambia de forma, el patrón en espejo ya no vale y la
    próxima resolución lo rechazaría. Se deja el mismo patrón sin espejo, con
    aviso; quien llama resincroniza ``participacion``. Un solo dueño para la
    edición (``plan_edicion``) y la vista previa del armado (``plan``, revisión 5).
    """
    patron = estructura.get("patron_color")
    if (
        estructura.get("tipo") != "guirnalda"
        or not isinstance(patron, Mapping)
        or patron.get("simetria") != "espejo"
        or (isinstance(armado, Mapping) and armado.get("forma") == FORMA_GUIRNALDA_ESPEJO)
    ):
        return []
    estructura["patron_color"] = {
        clave: copy.deepcopy(valor) for clave, valor in patron.items() if clave != "simetria"
    }
    return [AVISO_ESPEJO_GUIRNALDA]


# Tablas ES→EN de color y acabado (owners: taxonomy/v2.ts y
# mezcla-color-escena.ts), exportadas en plan-decoracion.v1 para que los
# prompts de Python y de TypeScript nombren igual cada color.
_PLAN_SCHEMA = contract_schema("PlanDecoracion")
_COLORES_EN: Mapping[str, str] = cast(Mapping[str, str], _PLAN_SCHEMA["x-colores-en"])
_ACABADOS_EN: Mapping[str, str] = cast(Mapping[str, str], _PLAN_SCHEMA["x-acabados-en"])
# La misma tabla CIELAB que lee catalog.py (similitud-color.ts, exportada en
# catalog-search.v1 como x-tonos-colores-catalogo): una sola tabla de tonos.
_LAB: Mapping[str, Sequence[float]] = cast(
    Mapping[str, Sequence[float]],
    contract_schema("CatalogSearch").get("x-tonos-colores-catalogo", {}).get("lab", {}),
)
# La forma de patron-color.v1 la valida el contrato; aquí solo se reutiliza
# para descartar un patrón armado aquí (una pista de la foto, un punto de
# partida) que no cabe en él, y para leer el borrador `desde`.
_ESQUEMA_PATRON: Mapping[str, object] = _PLAN_SCHEMA["properties"]["estructuras"]["items"][
    "properties"
]["patron_color"]
_FORMA = Draft7Validator(_ESQUEMA_PATRON)
_PROPIEDADES_PATRON = cast(Mapping[str, Mapping[str, object]], _ESQUEMA_PATRON["properties"])
#: Los modos y las direcciones del contrato, en su orden (dueño: el Zod de patron-color.v1).
MODOS: tuple[str, ...] = tuple(
    str(cast(Mapping[str, Mapping[str, object]], base["properties"])["modo"]["const"])
    for base in cast(list[Mapping[str, object]], _PROPIEDADES_PATRON["base"]["oneOf"])
)
DIRECCIONES: tuple[str, ...] = tuple(
    str(direccion) for direccion in cast(list[object], _PROPIEDADES_PATRON["direccion"]["enum"])
)
#: Las propiedades de la base de un modo del contrato, por su nombre.
def _base_del_contrato(modo: str) -> Mapping[str, Mapping[str, object]]:
    for base in cast(list[Mapping[str, object]], _PROPIEDADES_PATRON["base"]["oneOf"]):
        propiedades = cast(Mapping[str, Mapping[str, object]], base["properties"])
        if propiedades["modo"].get("const") == modo:
            return propiedades
    raise KeyError(f"patron-color.v1 no define el modo {modo!r}")


#: La mancha del modo ``zonas`` tal como la define el contrato.
_ZONA_CONTRATO = cast(
    Mapping[str, Mapping[str, object]],
    cast(Mapping[str, Mapping[str, object]], _base_del_contrato("zonas")["zonas"]["items"])[
        "properties"
    ],
)
#: Las anclas del contrato, en su orden (dueño: el Zod de patron-color.v1). Lo que
#: significa cada una —dónde cae en la pieza— es de aquí (``_ANCLAS``).
ANCLAS: tuple[str, ...] = tuple(
    str(ancla) for ancla in cast(list[object], _ZONA_CONTRATO["ancla"]["enum"])
)
#: Parte de la pieza que puede ocupar UNA mancha, también del contrato.
EXTENSION_ZONA_MAXIMA: int = int(cast(int, _ZONA_CONTRATO["extension"]["maximum"]))
#: Manchas por patrón, del contrato: quien lee la foto no puede devolver más.
ZONAS_MAXIMAS: int = int(cast(int, _base_del_contrato("zonas")["zonas"]["maxItems"]))

_TIPO_ES = {
    "columna": "una columna",
    "arco": "un arco",
    "semiarco": "un semiarco",
    "guirnalda": "una guirnalda",
    "centro_mesa": "un centro de mesa",
    "pared": "una pared",
    "backdrop": "un backdrop",
    "kit": "un kit",
    "accesorio": "un accesorio",
}
_MODO_ES = {
    "espiral": "espiral",
    "anillos": "anillos",
    "bloques": "bloques",
    "degradado": "degradé",
    "aleatorio": "confeti",
    "flor": "flores",
    "damero": "damero",
    "zonas": "zonas",
}
#: Dónde cae el centro de cada ancla dentro de la pieza, en SEXTOS de su ancho y
#: de su alto: el medio del tercio que nombra, no su borde (ADR-0036). ``y``
#: crece hacia abajo, como las filas de la rejilla y como se lee una foto.
#: Dueño de la geometría; la lista de valores admitidos es del contrato.
_ANCLAS: Mapping[str, tuple[int, int]] = {
    "superior_izquierda": (1, 1),
    "superior_centro": (3, 1),
    "superior_derecha": (5, 1),
    "media_izquierda": (1, 3),
    "centro": (3, 3),
    "media_derecha": (5, 3),
    "inferior_izquierda": (1, 5),
    "inferior_centro": (3, 5),
    "inferior_derecha": (5, 5),
}
_ANCLA_ES = {
    "superior_izquierda": "la esquina superior izquierda",
    "superior_centro": "el centro de arriba",
    "superior_derecha": "la esquina superior derecha",
    "media_izquierda": "el medio del lado izquierdo",
    "centro": "el centro",
    "media_derecha": "el medio del lado derecho",
    "inferior_izquierda": "la esquina inferior izquierda",
    "inferior_centro": "el centro de abajo",
    "inferior_derecha": "la esquina inferior derecha",
}
_ANCLA_EN = {
    "superior_izquierda": "the upper left corner",
    "superior_centro": "the top center",
    "superior_derecha": "the upper right corner",
    "media_izquierda": "the middle of the left side",
    "centro": "the center",
    "media_derecha": "the middle of the right side",
    "inferior_izquierda": "the lower left corner",
    "inferior_centro": "the bottom center",
    "inferior_derecha": "the lower right corner",
}
#: Anclas del preset, en el orden en que se reparten: primero las esquinas, y
#: cada una en el lado opuesto de la anterior, para que dos manchas del preset
#: no salgan pegadas.
_ANCLAS_PRESET: tuple[str, ...] = (
    "superior_derecha",
    "inferior_izquierda",
    "media_derecha",
    "superior_izquierda",
    "inferior_derecha",
    "media_izquierda",
    "superior_centro",
    "inferior_centro",
)
#: Suma máxima de las extensiones de las manchas: el resto es del fondo, y un
#: fondo que no llega a la décima parte de la pieza ya no es un fondo.
MAX_EXTENSION_ZONAS = 90
#: Presupuesto con el que se reparten unas extensiones que se pasaban del tope.
#: Ocho manchas con al menos 1 % cada una no pueden pasar de ``MAX_EXTENSION_ZONAS``.
_PRESUPUESTO_EXTENSION = MAX_EXTENSION_ZONAS - 10


class PatronColorInvalido(ValueError):
    """Regla cruzada incumplida (ADR-0028 §4).

    ``motivo`` es estable y lo lee la UI; ``mensaje`` va en español para el
    decorador. ``plan.py`` lo traduce al error de dominio ``patron_invalido``.
    """

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(f"{motivo}: {mensaje}")
        self.motivo = motivo
        self.mensaje = mensaje


@dataclass(frozen=True, slots=True)
class MaterialPatron:
    color: str | None
    acabado: str | None
    participacion: float


@dataclass(frozen=True, slots=True)
class EstructuraPatron:
    """Lo que el patrón necesita de una estructura ya completada del plan.

    ``total`` es ``T``, los globos por instancia que dan las medidas
    (``_total_globos``); ``un_tamano`` dice si la mezcla efectiva tiene un solo
    diámetro. ``racimo_armado`` y ``forma_armado`` son los globos por racimo y
    la forma del armado de una guirnalda por partes (ADR-0032), o ``None`` sin
    armado: entonces todo es como antes.
    """

    estructura_id: str
    tipo: str
    total: int
    un_tamano: bool
    ancho_m: float | None
    alto_m: float | None
    repeticiones: int
    materiales: tuple[MaterialPatron, ...]
    racimo_armado: int | None = None
    forma_armado: str | None = None


@dataclass(frozen=True, slots=True)
class Expansion:
    """Rejilla de una instancia: ``celdas[fila][posicion]`` es un índice de material."""

    geometria: str
    filas: int
    columnas: int
    celdas: tuple[tuple[int, ...], ...]
    #: ``(fila, material)`` de los globos que no ocupan posición (centro de flor).
    extras: tuple[tuple[int, int], ...]
    avisos: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Conteo:
    """Globos por material y por instancia que salen de la rejilla (§5)."""

    total: int
    unidades: tuple[int, ...]
    #: ``c_m / M``: la parte de la rejilla de cada material. Con varios tamaños,
    #: si un color se salvó de quedar sin globos, ``unidades / T``: la proporción
    #: que de verdad se compra.
    cuotas: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class _Acento:
    material: int
    cada: int
    desde: int
    posiciones: tuple[int, ...] | None


@dataclass(frozen=True, slots=True)
class _Pintado:
    fila: int
    columna: int | None
    material: int


@dataclass(frozen=True, slots=True)
class _Patron:
    modo: str
    base: Mapping[str, object]
    globos_por_racimo: int | None
    acentos: tuple[_Acento, ...]
    pintados: tuple[_Pintado, ...]
    espejo: bool
    direccion: str


# --- Lectura -----------------------------------------------------------------


def _normalizar(valor: str) -> str:
    return "".join(
        caracter
        for caracter in unicodedata.normalize("NFD", valor.strip().lower())
        if unicodedata.category(caracter) != "Mn"
    )


def _redondear(valor: float) -> int:
    return int(Decimal(str(valor)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _entero(valor: object) -> int:
    # El JSON Schema acepta 2.0 como entero; lo que no sea entero no llega aquí.
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or valor % 1:
        raise ValueError("patron_color: se esperaba un entero")
    return int(valor)


def _enteros(valor: object) -> list[int]:
    if not isinstance(valor, list):
        raise ValueError("patron_color: se esperaba una lista de enteros")
    return [_entero(item) for item in valor]


@dataclass(frozen=True, slots=True)
class _Zona:
    """Una mancha de color agrupada en un sitio de la pieza (ADR-0036)."""

    material: int
    ancla: str
    extension: int


def _zonas(valor: object) -> list[_Zona]:
    if not isinstance(valor, list):
        raise ValueError("patron_color: se esperaba una lista de zonas")
    manchas: list[_Zona] = []
    for item in valor:
        if not isinstance(item, Mapping):
            raise ValueError("patron_color: zona inválida")
        ancla = str(item.get("ancla"))
        if ancla not in _ANCLAS:
            raise ValueError("patron_color: ancla desconocida")
        manchas.append(
            _Zona(
                material=_entero(item.get("material")),
                ancla=ancla,
                extension=_entero(item.get("extension")),
            )
        )
    return manchas


def _extensiones_acotadas(extensiones: Sequence[int]) -> list[int]:
    """Extensiones que dejan sitio al fondo (``MAX_EXTENSION_ZONAS``).

    Dueño único del tope, para el preset y para la pista de la foto: si lo que
    se pide se pasa, se reparte el presupuesto por mayor resto conservando la
    proporción entre las manchas y con al menos 1 % en cada una (el contrato no
    admite 0). Si cabe, no se toca nada: la extensión leída es la que vale.
    """
    if sum(extensiones) <= MAX_EXTENSION_ZONAS:
        return list(extensiones)
    return [max(1, parte) for parte in _mayor_resto(_PRESUPUESTO_EXTENSION, extensiones)]


def _pesos(valor: object) -> list[tuple[int, int]]:
    if not isinstance(valor, list):
        raise ValueError("patron_color: se esperaba una lista de pesos")
    pares: list[tuple[int, int]] = []
    for item in valor:
        if not isinstance(item, Mapping):
            raise ValueError("patron_color: peso inválido")
        pares.append((_entero(item.get("material")), _entero(item.get("peso"))))
    return pares


def forma_valida(patron: object) -> bool:
    """``True`` si ``patron`` cumple la forma de ``patron-color.v1``."""
    return isinstance(patron, Mapping) and bool(_FORMA.is_valid(copy.deepcopy(dict(patron))))


def _leer(patron: Mapping[str, object]) -> _Patron:
    if not forma_valida(patron):
        raise ValueError("patron_color no cumple patron-color.v1")
    base = cast(Mapping[str, object], patron["base"])
    acentos = tuple(
        _Acento(
            material=_entero(item["material"]),
            cada=_entero(item["cada"]),
            desde=_entero(item["desde"]),
            posiciones=tuple(_enteros(item["posiciones"])) if "posiciones" in item else None,
        )
        for item in cast(list[Mapping[str, object]], patron.get("acentos", []))
    )
    pintados = tuple(
        _Pintado(
            fila=_entero(item["fila"]),
            columna=_entero(item["columna"]) if "columna" in item else None,
            material=_entero(item["material"]),
        )
        for item in cast(list[Mapping[str, object]], patron.get("pintados", []))
    )
    globos = patron.get("globos_por_racimo")
    return _Patron(
        modo=str(base["modo"]),
        base=base,
        globos_por_racimo=_entero(globos) if globos is not None else None,
        acentos=acentos,
        pintados=pintados,
        espejo=patron.get("simetria") == "espejo",
        direccion=str(patron.get("direccion") or "longitudinal"),
    )


def _indices_base(p: _Patron) -> list[int]:
    """Materiales de la base en el orden del patrón (el que nombran los textos)."""
    base = p.base
    if p.modo == "espiral":
        return _enteros(base["racimo"])
    if p.modo in ("anillos", "damero"):
        return _enteros(base["secuencia"])
    if p.modo == "degradado":
        return _enteros(base["paradas"])
    if p.modo == "bloques":
        return [material for material, _peso in _pesos(base["bloques"])]
    if p.modo == "aleatorio":
        return [material for material, _peso in _pesos(base["pesos"])]
    if p.modo == "zonas":
        # El fondo primero: es el color que manda en la pieza y el que abre los textos.
        return [_entero(base["fondo"]), *(zona.material for zona in _zonas(base["zonas"]))]
    return [_entero(base["fondo"]), _entero(base["petalo"]), _entero(base["centro"])]


def _distintos(indices: Sequence[int]) -> list[int]:
    return list(dict.fromkeys(indices))


def _mayor_resto(total: int, pesos: Sequence[int | Fraction]) -> list[int]:
    """Reparto por mayor resto en aritmética exacta.

    Mismo criterio que ``plan._hamilton`` con desempate 0 (mayor resto y luego
    menor índice), sin redondeo binario: dos restos iguales empatan de verdad.
    """
    suma = sum(pesos, Fraction(0))
    if total <= 0 or suma <= 0:
        return [0 for _peso in pesos]
    cuotas = [Fraction(total) * Fraction(peso) / suma for peso in pesos]
    pisos = [math.floor(cuota) for cuota in cuotas]
    orden = sorted(
        range(len(cuotas)), key=lambda indice: (-(cuotas[indice] - pisos[indice]), indice)
    )
    for indice in orden[: total - sum(pisos)]:
        pisos[indice] += 1
    return pisos


def _celdas_por_material(
    celdas: Sequence[Sequence[int]], extras: Sequence[tuple[int, int]], cantidad: int
) -> list[int]:
    """``c_m``: celdas más extras de cada material en una instancia."""
    conteo = [0] * cantidad
    for fila in celdas:
        for material in fila:
            conteo[material] += 1
    for _fila, material in extras:
        conteo[material] += 1
    return conteo


def _repartir_varios_tamanos(total: int, celdas: Sequence[int]) -> tuple[list[int], bool]:
    """Globos por material con varios tamaños (§5): ``T`` por mayor resto de las celdas.

    Como en ``plan._distribute_units``, cada color de la gráfica es una compra:
    si la rejilla tiene más posiciones que globos y un color con celdas queda en
    0, toma un globo del material con más (desempate por posición). Devuelve
    también si hubo que hacerlo. Con menos globos que colores alguno sigue en 0
    y ``_expandir`` lo rechaza como ``material_sin_uso``.
    """
    unidades = _mayor_resto(total, celdas)
    ajustado = False
    for indice, cantidad in enumerate(celdas):
        if not cantidad or unidades[indice]:
            continue
        donante = max(range(len(unidades)), key=lambda item: (unidades[item], -item))
        if unidades[donante] <= 1:
            break
        unidades[donante] -= 1
        unidades[indice] = 1
        ajustado = True
    return unidades, ajustado


# --- Reglas cruzadas y geometría (§2, §4) ---------------------------------------


def _nombre_color(estructura: EstructuraPatron, indice: int) -> str:
    """Color de un material con su número de leyenda: "azul (3)"."""
    color = estructura.materiales[indice].color
    return f"{color} ({indice + 1})" if color else f"n.º {indice + 1}"


def _validar_estructura(estructura: EstructuraPatron) -> None:
    if estructura.tipo not in _MODOS_POR_TIPO:
        tipo = _TIPO_ES.get(estructura.tipo, "esta pieza")
        raise PatronColorInvalido(
            "tipo_sin_patron",
            f"{tipo[0].upper()}{tipo[1:]} no se arma por racimos ni en rejilla: no lleva patrón"
            " de color.",
        )
    if len(estructura.materiales) < 2:
        raise PatronColorInvalido(
            "un_solo_material", "La pieza tiene un solo color: agrega otro para armar un patrón."
        )


def _admite_espejo(estructura: EstructuraPatron) -> bool:
    """Un arco, o una guirnalda armada en U invertida: simétrica desde el centro (E5)."""
    return estructura.tipo == "arco" or (
        estructura.tipo == "guirnalda" and estructura.forma_armado == FORMA_GUIRNALDA_ESPEJO
    )


def _racimo_de_armado(estructura: EstructuraPatron) -> int | None:
    """Globos por racimo del armado de una guirnalda (ADR-0032), o ``None``."""
    return estructura.racimo_armado if estructura.tipo == "guirnalda" else None


def _globos_por_racimo(p: _Patron) -> int:
    if p.globos_por_racimo is not None:
        return p.globos_por_racimo
    if p.modo == "espiral":
        return len(_enteros(p.base["racimo"]))
    return 4


def _columnas_de_rejilla(estructura: EstructuraPatron) -> int:
    """Ancho de la rejilla de una pared. Depende SOLO de la estructura (total y
    proporción), no del patrón, así que se puede saber antes de armarlo."""
    total = max(0, estructura.total)
    ancho, alto = estructura.ancho_m, estructura.alto_m
    razon = ancho / alto if ancho and alto else 1.0
    return max(2, _redondear(math.sqrt(total * razon)))


def _posiciones_de_acento(estructura: EstructuraPatron, orden: int) -> dict[str, object]:
    """Dónde cae un acento de relleno: el color que la base no llegó a usar.

    En una pieza de racimos va en la posición 0 de cada racimo, como siempre.

    En una PARED, un acento SIN ``posiciones`` pinta la FILA ENTERA: ``_aplicar_capas``
    recorre ``range(columnas)`` cuando faltan, así que con ``cada: 3`` sale un TERCIO
    de la pieza en bandas horizontales de lado a lado. Es lo contrario de lo que pide
    la frase del propio modo (``no stripes, no bands``) y es lo que se ve cuando la
    foto muestra ese color MEZCLADO entre el dominante en vez de agrupado — el blanco
    perlado de una pared blush, por ejemplo.

    Con el mismo paso en columnas que en filas, el cruce de los dos deja puntos
    sueltos en vez de franjas: salpicado entre el dominante, que es como se arma
    (decisión del 2026-09-30). Con paso 3 pinta ~1/9 de la pieza en vez de 1/3.
    """
    if estructura.tipo != TIPO_REJILLA:
        return {"posiciones": [0]}
    paso = 3 + orden
    return {"posiciones": list(range(orden % paso, _columnas_de_rejilla(estructura), paso))}


def _rejilla(estructura: EstructuraPatron, p: _Patron) -> tuple[str, int, int]:
    total = max(0, estructura.total)
    if estructura.tipo == TIPO_REJILLA:
        columnas = _columnas_de_rejilla(estructura)
        return "rejilla", max(1, _redondear(total / columnas)), columnas
    k = _globos_por_racimo(p)
    return "racimos", max(1, _redondear(total / k)), k


def _validar(estructura: EstructuraPatron, p: _Patron) -> tuple[str, int, int]:
    _validar_estructura(estructura)
    tipo = estructura.tipo
    cantidad = len(estructura.materiales)
    usados = [
        *_indices_base(p),
        *(acento.material for acento in p.acentos),
        *(pintado.material for pintado in p.pintados),
    ]
    fuera = sorted({indice for indice in usados if indice >= cantidad})
    if fuera:
        raise PatronColorInvalido(
            "material_fuera_de_rango",
            f"El patrón usa el color n.º {fuera[0] + 1}, pero la pieza solo tiene {cantidad}"
            " colores.",
        )
    permitidos = _MODOS_POR_TIPO[tipo]
    if p.modo not in permitidos:
        opciones = ", ".join(_MODO_ES[modo] for modo in permitidos)
        raise PatronColorInvalido(
            "modo_no_permitido",
            f"El patrón «{_MODO_ES[p.modo]}» no se arma en {_TIPO_ES[tipo]}; elige {opciones}.",
        )
    k = _globos_por_racimo(p)
    if p.modo == "espiral" and len(_enteros(p.base["racimo"])) != k:
        raise PatronColorInvalido(
            "racimo_incompleto",
            f"La espiral va en racimos de {k} globos, pero el racimo del patrón tiene"
            f" {len(_enteros(p.base['racimo']))} posiciones.",
        )
    if p.direccion != "longitudinal" and tipo != TIPO_REJILLA:
        raise PatronColorInvalido(
            "direccion_no_permitida",
            "Solo una pared lleva el patrón de lado a lado o en diagonal.",
        )
    if p.direccion == "diagonal" and p.modo != "degradado":
        raise PatronColorInvalido(
            "direccion_no_permitida", "La diagonal solo se arma con un degradé."
        )
    if p.modo == "zonas":
        if p.direccion != "longitudinal":
            # Las manchas son sitios de la pieza, no un recorrido por un eje:
            # girar el patrón no querría decir nada.
            raise PatronColorInvalido(
                "direccion_no_permitida",
                "Las zonas van donde las pone la gráfica: no se arman de lado a lado ni en"
                " diagonal.",
            )
        extensiones = sum(zona.extension for zona in _zonas(p.base["zonas"]))
        if extensiones > MAX_EXTENSION_ZONAS:
            raise PatronColorInvalido(
                "zonas_sin_fondo",
                f"Las zonas ocupan el {extensiones} % de la pieza y no dejan sitio al fondo"
                f" {_nombre_color(estructura, _entero(p.base['fondo']))}: bájalas hasta el"
                f" {MAX_EXTENSION_ZONAS} % entre todas.",
            )
    if p.espejo and not _admite_espejo(estructura):
        if tipo == "guirnalda":
            raise PatronColorInvalido(
                "simetria_no_permitida",
                "Una guirnalda solo se arma en espejo con el armado en U invertida, simétrica"
                " desde el centro.",
            )
        raise PatronColorInvalido("simetria_no_permitida", "El espejo solo se arma en un arco.")
    geometria, filas, columnas = _rejilla(estructura, p)
    if filas * columnas > MAX_CELDAS:
        raise PatronColorInvalido(
            "rejilla_demasiado_grande",
            f"La pieza saldría con {filas * columnas} globos por instancia y la gráfica admite"
            f" hasta {MAX_CELDAS}: divídela en piezas más pequeñas.",
        )
    return geometria, filas, columnas


# --- Expansión (§3) ------------------------------------------------------------


def _degradado_suave(paradas: Sequence[int], indice: int, largo: int, ancho: int) -> list[int]:
    """Una línea del degradé suave: ``u`` de sus ``ancho`` celdas ya son del tono siguiente."""
    m = len(paradas)
    numerador = (2 * indice + 1) * (m - 1)  # x = numerador / (2 L)
    denominador = 2 * largo
    j = min(numerador // denominador, m - 2)
    resto = numerador - j * denominador  # f = resto / (2 L)
    u = (2 * resto * ancho + denominador) // (2 * denominador)  # round_half_up(f * n)
    return [
        paradas[j + 1] if (posicion + 1) * u // ancho > posicion * u // ancho else paradas[j]
        for posicion in range(ancho)
    ]


def _linea(p: _Patron, indice: int, efectivo: int, ancho: int, bloques: Sequence[int]) -> list[int]:
    """Celdas de la línea ``indice`` (ya reflejada si hay espejo) en un modo por líneas."""
    base = p.base
    if p.modo == "anillos":
        secuencia, repeticion = _enteros(base["secuencia"]), _entero(base["largo"])
        return [secuencia[(indice // repeticion) % len(secuencia)]] * ancho
    if p.modo == "bloques":
        return [bloques[indice]] * ancho
    if p.modo == "degradado":
        paradas = _enteros(base["paradas"])
        if base["transicion"] == "suave":
            return _degradado_suave(paradas, indice, efectivo, ancho)
        m = len(paradas)
        return [paradas[min((2 * indice + 1) * m // (2 * efectivo), m - 1)]] * ancho
    separacion = _entero(base["separacion"])  # flor
    clave = "fondo" if indice % (separacion + 3) < separacion else "petalo"
    return [_entero(base[clave])] * ancho


def _lineas(p: _Patron, largo: int, ancho: int) -> tuple[list[list[int]], list[tuple[int, int]]]:
    """Modos que pintan línea a línea a lo largo del eje, con espejo si lo hay."""
    efectivo = (largo + 1) // 2 if p.espejo else largo
    bloques: list[int] = []
    if p.modo == "bloques":
        pesos = _pesos(p.base["bloques"])
        tamanos = _mayor_resto(efectivo, [peso for _material, peso in pesos])
        bloques = [
            material
            for (material, _peso), tamano in zip(pesos, tamanos, strict=True)
            for _linea in range(tamano)
        ]
    lineas: list[list[int]] = []
    extras: list[tuple[int, int]] = []
    for indice in range(largo):
        reflejado = min(indice, largo - 1 - indice) if p.espejo else indice
        lineas.append(_linea(p, reflejado, efectivo, ancho, bloques))
        if p.modo == "flor":
            separacion = _entero(p.base["separacion"])
            if reflejado % (separacion + 3) == separacion + 1:
                extras.append((indice, _entero(p.base["centro"])))
    return lineas, extras


def _aleatorio(
    pesos: Sequence[tuple[int, int]], semilla: int, filas: int, columnas: int
) -> list[list[int]]:
    """Confeti: cuotas exactas por peso y posiciones por orden de ``sha256``."""
    cuotas = _mayor_resto(filas * columnas, [peso for _material, peso in pesos])
    orden = sorted(
        ((fila, posicion) for fila in range(filas) for posicion in range(columnas)),
        key=lambda celda: hashlib.sha256(f"{semilla}:{celda[0]}:{celda[1]}".encode()).hexdigest(),
    )
    celdas = [[0] * columnas for _fila in range(filas)]
    inicio = 0
    for (material, _peso), cuota in zip(pesos, cuotas, strict=True):
        for fila, posicion in orden[inicio : inicio + cuota]:
            celdas[fila][posicion] = material
        inicio += cuota
    return celdas


def _celdas_de_zona(
    ancla: str, cupo: int, libres: Sequence[tuple[int, int]], filas: int, columnas: int
) -> list[tuple[int, int]]:
    """Las ``cupo`` celdas libres más cercanas al ancla, de dentro afuera (ADR-0036).

    Solo enteros: el centro de la celda ``(fila, columna)`` vale
    ``(12·columna + 6, 12·fila + 6)`` en doceavos de celda y el ancla
    ``(2·ax·columnas, 2·ay·filas)`` con ``(ax, ay)`` en sextos de la pieza, así
    que la distancia al cuadrado es exacta y el orden no depende del redondeo
    binario. Se mide sobre índices de celda, no sobre fracciones de la pieza,
    porque la rejilla se arma con celdas casi cuadradas (``_rejilla``): una
    mancha sale redonda en la pared, que es como se agrupan los globos.

    Desempate por ``(distancia, fila, columna)``: determinista y sin ``sha256``.
    """
    ax, ay = _ANCLAS[ancla]
    centro_x = 2 * ax * columnas
    centro_y = 2 * ay * filas

    def distancia(celda: tuple[int, int]) -> tuple[int, int, int]:
        fila, columna = celda
        dx = 12 * columna + 6 - centro_x
        dy = 12 * fila + 6 - centro_y
        return (dx * dx + dy * dy, fila, columna)

    return sorted(libres, key=distancia)[:cupo]


def _rejilla_de_zonas(
    base: Mapping[str, object], filas: int, columnas: int
) -> list[list[int]]:
    """Fondo de un color con manchas agrupadas en sitios de la pieza (ADR-0036).

    El tamaño de cada mancha sale por mayor resto de las extensiones declaradas
    y del resto que queda para el fondo, con al menos una celda por mancha: así
    el conteo por color de una pared en zonas se lee igual que el de un confeti
    —una cuota exacta por color— y lo único que cambia es DÓNDE caen.

    Las manchas se sirven en su orden y cada una toma solo celdas libres, así
    que dos manchas que se solapan no se pisan: la primera manda y la segunda se
    corre hacia afuera. Una mancha que no alcanza ninguna celda deja su color sin
    globos, y ``_expandir`` lo rechaza como ``material_sin_uso`` igual que en
    cualquier otro modo.
    """
    fondo = _entero(base["fondo"])
    manchas = _zonas(base["zonas"])
    celdas = [[fondo] * columnas for _fila in range(filas)]
    total = filas * columnas
    extensiones = [zona.extension for zona in manchas]
    # Lo que no piden las manchas es del fondo. ``_validar`` ya garantizó que las
    # extensiones no pasan de ``MAX_EXTENSION_ZONAS``, así que el fondo nunca es 0.
    resto = max(0, 100 - sum(extensiones))
    cupos = _mayor_resto(total, [*extensiones, resto])
    libres = [(fila, columna) for fila in range(filas) for columna in range(columnas)]
    tomadas: set[tuple[int, int]] = set()
    for zona, cupo in zip(manchas, cupos[:-1], strict=True):
        disponibles = [celda for celda in libres if celda not in tomadas]
        for celda in _celdas_de_zona(zona.ancla, max(1, cupo), disponibles, filas, columnas):
            celdas[celda[0]][celda[1]] = zona.material
            tomadas.add(celda)
    return celdas


def _degradado_diagonal(
    paradas: Sequence[int], suave: bool, filas: int, columnas: int
) -> list[list[int]]:
    m = len(paradas)
    denominador = 4 * filas * columnas  # t = numerador / denominador

    def celda(fila: int, posicion: int) -> int:
        numerador = (2 * fila + 1) * columnas + (2 * posicion + 1) * filas
        if not suave:
            return paradas[min(numerador * m // denominador, m - 1)]
        j = min(numerador * (m - 1) // denominador, m - 2)
        resto = numerador * (m - 1) - j * denominador  # f = resto / denominador
        umbral = 2 * ((3 * fila + 5 * posicion) % 8) + 1  # (h + 0.5) / 8 = umbral / 16
        return paradas[j + 1] if 16 * resto > umbral * denominador else paradas[j]

    return [[celda(fila, posicion) for posicion in range(columnas)] for fila in range(filas)]


def _base(p: _Patron, filas: int, columnas: int) -> tuple[list[list[int]], list[tuple[int, int]]]:
    base = p.base
    if p.modo == "espiral":
        racimo = _enteros(base["racimo"])
        return [list(racimo) for _fila in range(filas)], []
    if p.modo == "aleatorio":
        return _aleatorio(_pesos(base["pesos"]), _entero(base["semilla"]), filas, columnas), []
    if p.modo == "zonas":
        return _rejilla_de_zonas(base, filas, columnas), []
    if p.modo == "damero":
        secuencia, tamano = _enteros(base["secuencia"]), _entero(base["tamano"])
        celdas = [
            [
                secuencia[(fila // tamano + posicion // tamano) % len(secuencia)]
                for posicion in range(columnas)
            ]
            for fila in range(filas)
        ]
        return celdas, []
    if p.modo == "degradado" and p.direccion == "diagonal":
        suave = base["transicion"] == "suave"
        return _degradado_diagonal(_enteros(base["paradas"]), suave, filas, columnas), []
    if p.direccion == "transversal":
        lineas, _extras = _lineas(p, columnas, filas)
        traspuestas = [
            [lineas[posicion][fila] for posicion in range(columnas)] for fila in range(filas)
        ]
        return traspuestas, []
    return _lineas(p, filas, columnas)


def _aplicar_capas(p: _Patron, celdas: list[list[int]], unidad: str, avisos: list[str]) -> None:
    """Acentos y después pintados, en su orden (§3, capas)."""
    filas, columnas = len(celdas), len(celdas[0])
    for numero, acento in enumerate(p.acentos, start=1):
        posiciones = acento.posiciones if acento.posiciones is not None else tuple(range(columnas))
        validas = [posicion for posicion in posiciones if posicion < columnas]
        if len(validas) < len(posiciones):
            fuera = sorted({posicion + 1 for posicion in posiciones if posicion >= columnas})
            avisos.append(
                f"El acento {numero} pide {_plural(len(fuera), 'la posición', 'las posiciones')}"
                f" {_lista_es([str(posicion) for posicion in fuera])} y cada {unidad} tiene"
                f" {columnas} globos: {_plural(len(fuera), 'se ignoró', 'se ignoraron')}."
            )
        for fila in range(filas):
            indice = min(fila, filas - 1 - fila) if p.espejo else fila
            if indice + 1 >= acento.desde and (indice + 1 - acento.desde) % acento.cada == 0:
                for posicion in validas:
                    celdas[fila][posicion] = acento.material
    fuera_de_rango = 0
    for pintado in p.pintados:
        if pintado.fila >= filas or (pintado.columna is not None and pintado.columna >= columnas):
            fuera_de_rango += 1
        elif pintado.columna is None:
            celdas[pintado.fila] = [pintado.material] * columnas
        else:
            celdas[pintado.fila][pintado.columna] = pintado.material
    if fuera_de_rango == 1:
        avisos.append("1 pintado quedó fuera de la estructura")
    elif fuera_de_rango:
        avisos.append(f"{fuera_de_rango} pintados quedaron fuera de la estructura")


def _expandir(estructura: EstructuraPatron, p: _Patron) -> Expansion:
    geometria, filas, columnas = _validar(estructura, p)
    celdas, extras = _base(p, filas, columnas)
    avisos: list[str] = []
    unidad = _unidad(geometria, columnas, transversal=False).singular
    _aplicar_capas(p, celdas, unidad, avisos)
    cantidad = len(estructura.materiales)
    por_material = _celdas_por_material(celdas, extras, cantidad)
    for indice in range(cantidad):
        if not por_material[indice]:
            raise PatronColorInvalido(
                "material_sin_uso",
                f"El color {_nombre_color(estructura, indice)} no queda en ningún globo del"
                " patrón: úsalo en el patrón o quítalo de la pieza.",
            )
    if not estructura.un_tamano:
        # Con varios tamaños los globos de cada color son los del conteo (§5), no
        # las celdas: con menos globos que colores alguno se queda sin comprar.
        total = max(0, estructura.total)
        unidades, _ajustado = _repartir_varios_tamanos(total, por_material)
        for indice in range(cantidad):
            if not unidades[indice]:
                raise PatronColorInvalido(
                    "material_sin_uso",
                    f"La pieza lleva {total} globos de varios tamaños y no"
                    f" alcanzan para sus {cantidad} colores: el color"
                    f" {_nombre_color(estructura, indice)} se queda sin globos. Quita un color"
                    " o agranda la pieza.",
                )
    return Expansion(
        geometria=geometria,
        filas=filas,
        columnas=columnas,
        celdas=tuple(tuple(fila) for fila in celdas),
        extras=tuple(extras),
        avisos=tuple(avisos),
    )


def validar_y_expandir(estructura: EstructuraPatron, patron: Mapping[str, object]) -> Expansion:
    """Valida las reglas cruzadas (§4) y expande el patrón a su rejilla (§2, §3).

    Lanza ``PatronColorInvalido`` con el motivo estable. ``patron`` debe cumplir
    ya la forma de ``patron-color.v1`` (la valida el contrato del plan).
    """
    return _expandir(estructura, _leer(patron))


def filas_de_racimos(
    estructura: EstructuraPatron, patron: Mapping[str, object], racimos: int
) -> tuple[tuple[int, ...], ...] | None:
    """El patrón sobre ``racimos`` racimos seguidos: el color de cada racimo de un armado (E5).

    La rejilla del patrón tiene ``round(T / k)`` filas porque cuenta todos los
    globos de la pieza, y el armado de una guirnalda arma menos racimos: el
    relleno y los remates toman el color de su material y no ocupan
    posiciones. Tomar filas de la rejilla a lo largo rompía los estilos que se
    repiten (unos anillos de tres colores sobre 8 de 12 filas perdían un
    color) y el espejo. Aquí el patrón se expande con exactamente esas filas:
    el racimo ``i`` es la fila ``i``, con el mismo estilo, el espejo desde el
    centro y los acentos contados por racimo. El conteo y la compra siguen
    saliendo de la rejilla completa (``conteo_por_instancia``).

    ``None`` si el patrón no va por racimos o lleva globos pintados a mano (sus
    filas son las de la rejilla completa: el armado las toma a lo largo, como
    antes). Lanza ``PatronColorInvalido`` si el patrón no vale en la pieza.
    """
    p = _leer(patron)
    geometria, _filas, columnas = _validar(estructura, p)
    if geometria != "racimos" or p.pintados or racimos < 1:
        return None
    celdas, _extras = _base(p, racimos, columnas)
    _aplicar_capas(p, celdas, _unidad(geometria, columnas, transversal=False).singular, [])
    return tuple(tuple(fila) for fila in celdas)


# --- Conteo (§5) -----------------------------------------------------------------


def conteo_por_instancia(estructura: EstructuraPatron, expansion: Expansion) -> Conteo:
    """Globos de cada material por instancia: el patrón manda sobre ``participacion``.

    Con un solo tamaño el total es la rejilla completa (celdas + extras); con
    varios se conserva ``T`` y se reparte en proporción a la rejilla, con al
    menos un globo por color de la gráfica.
    """
    celdas = _celdas_por_material(expansion.celdas, expansion.extras, len(estructura.materiales))
    globos = expansion.filas * expansion.columnas + len(expansion.extras)
    cuotas = tuple(cantidad / globos for cantidad in celdas)
    if estructura.un_tamano:
        return Conteo(total=globos, unidades=tuple(celdas), cuotas=cuotas)
    total = max(0, estructura.total)
    unidades, ajustado = _repartir_varios_tamanos(total, celdas)
    if ajustado:
        # Un color se salvó de quedar sin globos y el conteo ya no sigue la
        # proporción de la rejilla: participacion declara lo que se compra y la
        # matriz tamaño × color se siembra con cuotas que no pasan de su margen.
        cuotas = tuple(cantidad / total for cantidad in unidades)
    return Conteo(total=total, unidades=tuple(unidades), cuotas=cuotas)


def participaciones(conteo: Conteo) -> list[float]:
    """``participacion`` que el plan debe declarar (§5).

    ``round(cuota, 6)`` por material (``c_m / M``, o la del conteo cuando un
    color se salvó de quedar sin globos); el último absorbe el resto para que
    sumen exactamente 1.
    """
    redondeadas = [round(cuota, 6) for cuota in conteo.cuotas[:-1]]
    return [*redondeadas, round(1 - sum(redondeadas), 6)]


# --- Presets y pistas de la foto (§6, §7) ---------------------------------------


def _semilla(estructura_id: str) -> int:
    return int(hashlib.sha256(estructura_id.encode("utf-8")).hexdigest()[:8], 16) % 2147483647


def _pesos_por_participacion(
    estructura: EstructuraPatron, indices: Sequence[int]
) -> list[dict[str, object]]:
    return [
        {
            "material": indice,
            "peso": max(1, _redondear(estructura.materiales[indice].participacion * 100)),
        }
        for indice in indices
    ]


def _racimo_sugerido(estructura: EstructuraPatron, k: int = 4) -> list[int]:
    """``k`` posiciones: una por material y el resto por mayor resto, intercaladas.

    Exige ``k >= len(materiales)``; con ``k = 4`` es el racimo del preset (§6).
    """
    partes = [Fraction(str(material.participacion)) for material in estructura.materiales]
    cantidad = len(partes)
    sobrantes = [max(Fraction(0), k * parte - 1) for parte in partes]
    if sum(sobrantes) == 0:
        sobrantes = [Fraction(1)] * cantidad
    posiciones = [1 + extra for extra in _mayor_resto(k - cantidad, sobrantes)]
    racimo: list[int] = []
    anterior: int | None = None
    for _posicion in range(k):
        disponibles = [indice for indice in range(cantidad) if posiciones[indice] > 0]
        distintos = [indice for indice in disponibles if indice != anterior] or disponibles
        elegido = min(distintos, key=lambda indice: (-posiciones[indice], -partes[indice], indice))
        racimo.append(elegido)
        posiciones[elegido] -= 1
        anterior = elegido
    return racimo


def _preset_por_racimo(estructura: EstructuraPatron, k: int) -> dict[str, object]:
    """Preset de una guirnalda armada: los racimos de ``k`` globos de su armado (E5).

    Con varios tamaños el preset de siempre caía en confeti; en una guirnalda
    armada los globos del relleno y de los remates no ocupan posiciones del
    patrón (toman el color de su material, ``armado_guirnalda._repartir``) y
    lo que el patrón colorea son los racimos. Espiral si los colores caben en
    un racimo (``_racimo_sugerido``); si no, anillos: cada racimo de un color,
    en orden de participación. Si ninguno se puede armar, confeti con los
    racimos del armado, para que la unidad siga siendo la suya.
    """
    cantidad = len(estructura.materiales)
    base: dict[str, object] = (
        {"modo": "espiral", "racimo": _racimo_sugerido(estructura, k), "trazo": "espiral"}
        if cantidad <= k
        else {"modo": "anillos", "secuencia": _por_participacion(estructura), "largo": 1}
    )
    confeti: dict[str, object] = {
        "modo": "aleatorio",
        "pesos": _pesos_por_participacion(estructura, range(cantidad)),
        "semilla": _semilla(estructura.estructura_id),
    }
    for candidata in (base, confeti):
        patron: dict[str, object] = {
            "version": VERSION_PATRON,
            "origen": "sugerido",
            "globos_por_racimo": k,
            "base": candidata,
        }
        if _armable(estructura, patron):
            return patron
    validar_y_expandir(estructura, patron)
    return patron


def sugerir_patron(estructura: EstructuraPatron) -> dict[str, object]:
    """Preset del oficio para una estructura sin patrón (``origen: "sugerido"``).

    Espiral de cuartetos en racimos de un solo tamaño con 2–4 colores; zonas en
    una pared con un color que manda (``_pared_va_en_zonas``); confeti por
    ``participacion`` en el resto. Una guirnalda armada va por los racimos de su
    armado (``_preset_por_racimo``). Lanza ``PatronColorInvalido`` cuando la
    estructura no admite patrón o el preset dejaría un color sin globos.

    Si el preset elegido no se puede armar en la pieza, cae al confeti antes de
    fallar: el preset es una sugerencia y una pared sin patrón se queda sin
    gráfica y sin frase para el generador, que es el agujero que cerró ADR-0036.
    """
    _validar_estructura(estructura)
    racimo_armado = _racimo_de_armado(estructura)
    if racimo_armado is not None:
        return _preset_por_racimo(estructura, racimo_armado)
    cantidad = len(estructura.materiales)
    confeti: dict[str, object] = {
        "modo": "aleatorio",
        "pesos": _pesos_por_participacion(estructura, range(cantidad)),
        "semilla": _semilla(estructura.estructura_id),
    }
    base: dict[str, object] = confeti
    if estructura.tipo in _TIPOS_ESPIRAL_SUGERIDA and estructura.un_tamano and cantidad <= 4:
        base = {"modo": "espiral", "racimo": _racimo_sugerido(estructura), "trazo": "espiral"}
    elif _pared_va_en_zonas(estructura):
        base = _base_de_zonas_sugerida(estructura, _por_participacion(estructura))
    patron: dict[str, object] = {"version": VERSION_PATRON, "origen": "sugerido", "base": base}
    if base is not confeti and not _armable(estructura, patron):
        patron = {"version": VERSION_PATRON, "origen": "sugerido", "base": confeti}
    validar_y_expandir(estructura, patron)
    return patron


def _pared_va_en_zonas(estructura: EstructuraPatron) -> bool:
    """Si el preset de una pared debe ir en zonas y no en confeti (ADR-0036).

    Una pared con un color que manda (``DOMINANCIA_ZONAS``) y hasta
    ``MAX_MATERIALES_ZONAS`` colores es la pared orgánica del oficio: el fondo
    de un tono y los demás agrupados en manchas. Eso es además lo que el prompt
    de imagen pedía por su cuenta cuando la pieza no traía patrón
    (``ORGANIC_COLOR_DISTRIBUTION``: "intentional organic clusters"), y lo que un
    confeti le contradecía. Con tres o cuatro colores parejos no hay fondo que
    mande y el confeti sigue siendo la lectura honesta.
    """
    if estructura.tipo != TIPO_REJILLA or not 2 <= len(estructura.materiales) <= (
        MAX_MATERIALES_ZONAS
    ):
        return False
    principal = max(material.participacion for material in estructura.materiales)
    return Fraction(str(principal)) >= Fraction(str(DOMINANCIA_ZONAS))


def modos_admitidos(estructura: EstructuraPatron) -> list[dict[str, object]]:
    """Estilos que admite la estructura, con sus direcciones y si llevan espejo.

    Es lo que el editor ofrece: la misma tabla y las mismas reglas que
    ``_validar`` aplica (§4), dichas una vez aquí para que la interfaz no
    tenga que repetirlas. Vacía si la estructura no admite patrón.
    """
    if estructura.tipo not in _MODOS_POR_TIPO or len(estructura.materiales) < 2:
        return []
    admitidos: list[dict[str, object]] = []
    for modo in _MODOS_POR_TIPO[estructura.tipo]:
        direcciones = ["longitudinal"]
        if estructura.tipo == TIPO_REJILLA and modo in ("anillos", "bloques", "degradado"):
            direcciones.append("transversal")
        if estructura.tipo == TIPO_REJILLA and modo == "degradado":
            direcciones.append("diagonal")
        admitidos.append(
            {
                "modo": modo,
                "direcciones": direcciones,
                # El espejo evalúa base y acentos desde los dos pies (o los
                # dos extremos de una guirnalda en U); el confeti lo ignora
                # (§3), así que no se ofrece.
                "espejo": _admite_espejo(estructura) and modo != "aleatorio",
            }
        )
    return admitidos


def _por_participacion(estructura: EstructuraPatron) -> list[int]:
    """Índices de material de mayor a menor participación (desempate por posición)."""
    return sorted(
        range(len(estructura.materiales)),
        key=lambda indice: (-Fraction(str(estructura.materiales[indice].participacion)), indice),
    )


def _acento_json(acento: _Acento) -> dict[str, object]:
    return {
        "material": acento.material,
        "cada": acento.cada,
        "desde": acento.desde,
        **({"posiciones": list(acento.posiciones)} if acento.posiciones is not None else {}),
    }


def _con_acentos(
    estructura: EstructuraPatron, patron: Mapping[str, object], conservados: Sequence[_Acento]
) -> dict[str, object]:
    """``patron`` con sus acentos: primero uno por cada color que ni la base ni
    ``conservados`` usan (como con las pistas, §7) y detrás ``conservados``,
    que mandan si pisan el mismo globo. Sin acentos, sin la clave."""
    resultado = {clave: valor for clave, valor in patron.items() if clave != "acentos"}
    usados = _materiales_de_base(cast(Mapping[str, object], patron["base"])) | {
        acento.material for acento in conservados
    }
    sin_uso = [indice for indice in range(len(estructura.materiales)) if indice not in usados]
    acentos = [
        {
            "material": material,
            "cada": 3 + orden,
            "desde": 2 + orden,
            **_posiciones_de_acento(estructura, orden),
        }
        for orden, material in enumerate(sin_uso)
    ] + [_acento_json(acento) for acento in conservados]
    if acentos:
        resultado["acentos"] = acentos
    return resultado


def _preset_de_estilo(estructura: EstructuraPatron, modo: str, k: int | None) -> dict[str, object]:
    """Base de un estilo desde la ``participacion``, sin acentos; ``k`` fija los globos por racimo.

    El color principal manda en el fondo, el orden de los bloques o la
    secuencia. En espiral el racimo tiene ``k`` posiciones: una por color y el
    resto por participación; si ``k`` no alcanza para todos, van los ``k``
    principales y los demás quedan para los acentos.
    """
    cantidad = len(estructura.materiales)
    orden = _por_participacion(estructura)
    patron: dict[str, object] = {"version": VERSION_PATRON, "origen": "sugerido"}
    if k is not None:
        patron["globos_por_racimo"] = k
    if modo == "espiral":
        if k is None and cantidad > 4:
            # Cinco o seis colores: un racimo con una posición por color.
            patron["globos_por_racimo"] = cantidad
            racimo = list(range(cantidad))
        elif k is None or cantidad <= k:
            racimo = _racimo_sugerido(estructura, 4 if k is None else k)
        else:
            racimo = orden[:k]
        patron["base"] = {"modo": "espiral", "racimo": racimo, "trazo": "espiral"}
    elif modo == "anillos":
        patron["base"] = {"modo": "anillos", "secuencia": orden, "largo": 1}
    elif modo == "bloques":
        pesos = {
            cast(int, peso["material"]): peso["peso"]
            for peso in _pesos_por_participacion(estructura, range(cantidad))
        }
        patron["base"] = {
            "modo": "bloques",
            "bloques": [{"material": indice, "peso": pesos[indice]} for indice in orden],
        }
    elif modo == "degradado":
        patron["base"] = {
            "modo": "degradado",
            "paradas": list(range(cantidad)),
            "transicion": "suave",
        }
    elif modo == "aleatorio":
        patron["base"] = {
            "modo": "aleatorio",
            "pesos": _pesos_por_participacion(estructura, range(cantidad)),
            "semilla": _semilla(estructura.estructura_id),
        }
    elif modo == "flor":
        fondo, petalo = orden[0], orden[1]
        centro = orden[2] if cantidad >= 3 else fondo
        patron["base"] = {
            "modo": "flor",
            "fondo": fondo,
            "petalo": petalo,
            "centro": centro,
            "separacion": SEPARACION_FLOR_PISTA,
        }
    elif modo == "zonas":
        patron["base"] = _base_de_zonas_sugerida(estructura, orden)
    else:
        patron["base"] = {"modo": "damero", "secuencia": orden[:4], "tamano": 1}
    return patron


def _base_de_zonas_sugerida(
    estructura: EstructuraPatron, orden: Sequence[int]
) -> dict[str, object]:
    """Base de un patrón en zonas desde la ``participacion`` (ADR-0036).

    El color principal es el fondo y cada uno de los demás va en UNA mancha del
    tamaño de su participación, repartidas por ``_ANCLAS_PRESET``. Sin la foto
    no hay manera de saber en cuántos sitios va agrupado un color ni en cuáles:
    una mancha por color es lo que el preset sabe de verdad, y la foto es la que
    puede decir "el dorado va en cuatro zonas" (``_base_de_pista``).

    Con más de nueve colores solo los ocho primeros llevan mancha y el resto
    queda para los acentos: ``_con_acentos`` añade uno por color sin uso y con
    doce colores (el tope del contrato) sobran tres, que caben en los cuatro
    acentos que el contrato admite.
    """
    fondo, *resto = orden
    manchas = list(resto[: min(ZONAS_MAXIMAS, len(_ANCLAS_PRESET))])
    extensiones = _extensiones_acotadas(
        [
            max(1, _redondear(estructura.materiales[indice].participacion * 100))
            for indice in manchas
        ]
    )
    return {
        "modo": "zonas",
        "fondo": fondo,
        "zonas": [
            {"material": indice, "ancla": ancla, "extension": extension}
            for indice, ancla, extension in zip(
                manchas, _ANCLAS_PRESET, extensiones, strict=False
            )
        ],
    }


def _armable(estructura: EstructuraPatron, patron: Mapping[str, object]) -> bool:
    """Si ``patron`` cumple la forma y las reglas cruzadas (§4) en la estructura."""
    if not forma_valida(patron):
        return False
    try:
        validar_y_expandir(estructura, patron)
    except PatronColorInvalido:
        return False
    return True


def _acento_cabe(
    estructura: EstructuraPatron, patron: Mapping[str, object], acento: _Acento
) -> bool:
    """El material existe y sus posiciones caben en cada racimo (o fila) de ``patron``."""
    if acento.material >= len(estructura.materiales):
        return False
    if acento.posiciones is None:
        return True
    _geometria, _filas, columnas = _rejilla(estructura, _leer(patron))
    return all(posicion < columnas for posicion in acento.posiciones)


_DIRECCION_ES = {"transversal": "de lado a lado", "diagonal": "en diagonal"}


@dataclass(frozen=True, slots=True)
class PuntoDePartida:
    """Punto de partida de un estilo y, en español, lo que no se pudo conservar del borrador."""

    patron: dict[str, object]
    avisos: tuple[str, ...]


def sugerir_patron_modo(
    estructura: EstructuraPatron, modo: str, desde: Mapping[str, object] | None = None
) -> PuntoDePartida:
    """Punto de partida de un estilo concreto que elige el decorador (``origen: "sugerido"``).

    Parte de la ``participacion`` de la pieza: el color principal manda en el
    fondo, el orden de los bloques o la secuencia. Los colores que el estilo no
    usa entran como acentos. Lanza ``PatronColorInvalido`` si el estilo no se
    arma en la estructura o dejaría un color sin globos.

    ``desde`` es el borrador del que viene el decorador (con la forma de
    ``patron-color.v1``). De él se conserva lo que el estilo nuevo admite, en
    este orden: los globos por racimo (solo en racimos), la dirección si está
    entre las ``direcciones`` del estilo, el espejo si el estilo lo lleva y
    cada acento cuyo color y posiciones siguen existiendo. Lo que el estilo no
    ofrece (el espejo en un confeti, la diagonal en unos anillos) se deja sin
    más; lo que sí ofrece pero dejaría el patrón inválido se quita con un
    aviso. Los globos pintados a mano no pasan: son de la gráfica del estilo
    anterior.
    """
    _validar_estructura(estructura)
    if modo not in _MODOS_POR_TIPO[estructura.tipo]:
        opciones = ", ".join(_MODO_ES[opcion] for opcion in _MODOS_POR_TIPO[estructura.tipo])
        raise PatronColorInvalido(
            "modo_no_permitido",
            f"El patrón «{_MODO_ES.get(modo, modo)}» no se arma en {_TIPO_ES[estructura.tipo]};"
            f" elige {opciones}.",
        )
    previo = _leer(desde) if desde is not None else None
    estilo = f"«{_MODO_ES[modo]}»"
    avisos: list[str] = []
    # En una guirnalda armada la unidad la decide el armado (E5).
    k = _racimo_de_armado(estructura) or (
        previo.globos_por_racimo
        if previo is not None and estructura.tipo in TIPOS_RACIMOS
        else None
    )
    patron = _con_acentos(estructura, _preset_de_estilo(estructura, modo, k), ())
    if k is None:
        validar_y_expandir(estructura, patron)
    elif not _armable(estructura, patron):
        patron = _con_acentos(estructura, _preset_de_estilo(estructura, modo, None), ())
        validar_y_expandir(estructura, patron)
        pedido = _unidad("racimos", k, transversal=False).plural
        queda = _unidad("racimos", _globos_por_racimo(_leer(patron)), transversal=False).plural
        avisos.append(f"El estilo {estilo} no se arma en {pedido} en esta pieza: queda en {queda}.")
    if previo is None:
        return PuntoDePartida(patron, ())
    patron, capas = _con_capas_del_borrador(estructura, modo, patron, previo)
    return PuntoDePartida(patron, (*avisos, *capas))


def _con_capas_del_borrador(
    estructura: EstructuraPatron, modo: str, patron: dict[str, object], previo: _Patron
) -> tuple[dict[str, object], list[str]]:
    """Dirección, espejo y acentos de ``previo`` que el estilo ``modo`` admite.

    Cada capa entra solo si el patrón sigue siendo válido; si no, se quita con
    un aviso en español. Devuelve el patrón y esos avisos.
    """
    estilo = f"«{_MODO_ES[modo]}»"
    admitido = next(item for item in modos_admitidos(estructura) if item["modo"] == modo)
    capas: list[tuple[dict[str, object], str]] = []
    if previo.direccion in _DIRECCION_ES and previo.direccion in cast(
        list[str], admitido["direcciones"]
    ):
        capas.append(
            (
                {"direccion": previo.direccion},
                f"El estilo {estilo} no se arma {_DIRECCION_ES[previo.direccion]} en esta pieza:"
                " queda de arriba abajo.",
            )
        )
    if previo.espejo and admitido["espejo"]:
        capas.append(
            (
                {"simetria": "espejo"},
                f"El estilo {estilo} no se arma en espejo en esta pieza: queda sin espejo.",
            )
        )
    avisos: list[str] = []
    for cambios, aviso in capas:
        candidato = {**patron, **cambios}
        if _armable(estructura, candidato):
            patron = candidato
        else:
            avisos.append(aviso)
    conservados: list[_Acento] = []
    for acento in previo.acentos:
        candidato = _con_acentos(estructura, patron, [*conservados, acento])
        if _acento_cabe(estructura, patron, acento) and _armable(estructura, candidato):
            conservados.append(acento)
            patron = candidato
            continue
        color = (
            _nombre_color(estructura, acento.material)
            if acento.material < len(estructura.materiales)
            else f"n.º {acento.material + 1}"
        )
        avisos.append(f"El acento de {color} no cabe en el estilo {estilo}: se quitó.")
    return patron, avisos


def _delta_e(uno: Sequence[float], otro: Sequence[float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(uno, otro, strict=True)))


def material_de_color(materiales: Sequence[MaterialPatron], color: str) -> int | None:
    """Material que corresponde a un color leído en la foto.

    Primero la igualdad normalizada con ``materiales[].color``; si no, el
    material de tono más cercano (ΔE CIE76 ≤ 25 en la tabla LAB del contrato,
    empate al primero). ``None`` si nada está lo bastante cerca.
    """
    buscado = _normalizar(color)
    for indice, material in enumerate(materiales):
        if material.color and _normalizar(material.color) == buscado:
            return indice
    tono = _LAB.get(buscado)
    if tono is None:
        return None
    mejor: tuple[float, int] | None = None
    for indice, material in enumerate(materiales):
        otro = _LAB.get(_normalizar(material.color or ""))
        if otro is None:
            continue
        distancia = _delta_e(tono, otro)
        if distancia <= DELTA_E_PISTA and (mejor is None or distancia < mejor[0]):
            mejor = (distancia, indice)
    return mejor[1] if mejor is not None else None


def _base_de_pista(
    estructura: EstructuraPatron, modo: str, indices: list[int], pista: Mapping[str, object]
) -> dict[str, object] | None:
    if modo == "espiral":
        k = _entero(pista["globos_por_racimo"]) if pista.get("globos_por_racimo") is not None else 4
        racimo = [indices[posicion % len(indices)] for posicion in range(k)]
        return {"modo": "espiral", "racimo": racimo, "trazo": "espiral"}
    if modo == "anillos":
        return {"modo": "anillos", "secuencia": indices, "largo": 1}
    if modo == "bloques":
        pesos = pista.get("pesos")
        propios = (
            _enteros(pesos) if isinstance(pesos, list) and len(pesos) == len(indices) else None
        )
        return {
            "modo": "bloques",
            "bloques": [
                {"material": indice, "peso": propios[orden] if propios else 1}
                for orden, indice in enumerate(indices)
            ],
        }
    if modo == "degradado":
        return {"modo": "degradado", "paradas": indices, "transicion": "suave"}
    if modo == "aleatorio":
        # Un confeti reparte todos los colores de la pieza por su participación:
        # los que la foto no nombró también entran como peso, nunca como acentos
        # (un acento encima de un confeti bloquearía su deslizador de colores).
        return {
            "modo": "aleatorio",
            "pesos": _pesos_por_participacion(estructura, list(range(len(estructura.materiales)))),
            "semilla": _semilla(estructura.estructura_id),
        }
    if modo == "zonas":
        return _base_de_zonas_de_pista(estructura, indices, pista)
    if modo == "flor":
        if len(indices) < 3:
            return None
        fondo, petalo, centro = indices[:3]
        return {
            "modo": "flor",
            "fondo": fondo,
            "petalo": petalo,
            "centro": centro,
            "separacion": SEPARACION_FLOR_PISTA,
        }
    return {"modo": "damero", "secuencia": indices, "tamano": 1}


def _base_de_zonas_de_pista(
    estructura: EstructuraPatron, indices: Sequence[int], pista: Mapping[str, object]
) -> dict[str, object] | None:
    """Las manchas que la foto leyó, con el material de cada color (ADR-0036).

    ``colores[0]`` es el fondo (lo dice el prompt) y cada mancha trae su color
    por nombre, porque quien lee la foto no conoce los índices de la pieza: se
    resuelven con la misma tabla de tonos que ``colores`` (``material_de_color``).

    ``None`` —y quien llama cae al preset— cuando la pista no trae manchas, una
    mancha nombra un color que la pieza no lleva, o el fondo se queda sin sitio.
    Preferir el preset a inventar una mancha: una zona en el sitio equivocado
    sale en la gráfica, en la hoja de armado y en el prompt de imagen.
    """
    manchas = pista.get("zonas")
    if not isinstance(manchas, list) or not manchas:
        return None
    materiales: list[int] = []
    anclas: list[str] = []
    extensiones: list[int] = []
    for item in manchas:
        if not isinstance(item, Mapping):
            return None
        ancla = str(item.get("ancla"))
        material = material_de_color(estructura.materiales, str(item.get("color")))
        if ancla not in _ANCLAS or material is None:
            return None
        materiales.append(material)
        anclas.append(ancla)
        extensiones.append(_entero(item.get("extension")))
    return {
        "modo": "zonas",
        "fondo": indices[0],
        "zonas": [
            {"material": material, "ancla": ancla, "extension": extension}
            for material, ancla, extension in zip(
                materiales, anclas, _extensiones_acotadas(extensiones), strict=True
            )
        ],
    }


def _materiales_de_base(base: Mapping[str, object]) -> set[int]:
    """Índices de material que nombra una base declarativa, en cualquier modo."""
    usados: set[int] = set()
    for clave in ("racimo", "secuencia", "paradas"):
        usados.update(_enteros(base.get(clave, [])))
    for clave in ("bloques", "pesos"):
        lista = base.get(clave)
        for item in lista if isinstance(lista, list) else []:
            if isinstance(item, Mapping):
                usados.add(_entero(item.get("material")))
    for clave in ("fondo", "petalo", "centro"):
        if base.get(clave) is not None:
            usados.add(_entero(base[clave]))
    if base.get("zonas") is not None:
        usados.update(zona.material for zona in _zonas(base["zonas"]))
    return usados


def patron_desde_pista(
    estructura: EstructuraPatron, pista: Mapping[str, object]
) -> dict[str, object] | None:
    """Patrón que describe la pista leída en la foto (``origen: "referencia"``), §7.

    ``None`` si la confianza no llega a 0,5, si un color de la pista no
    corresponde a ningún material, o si el patrón no vale para la estructura;
    quien llama cae entonces al preset.
    """
    confianza = pista.get("confianza")
    if not isinstance(confianza, (int, float)) or confianza < CONFIANZA_MINIMA_PISTA:
        return None
    racimo_armado = _racimo_de_armado(estructura)
    if racimo_armado is not None:
        # Guirnalda armada (E5): la foto da los colores y el estilo; la unidad
        # del racimo es la del armado.
        pista = {**pista, "globos_por_racimo": racimo_armado}
    colores = pista.get("colores")
    if not isinstance(colores, list) or not colores:
        return None
    indices: list[int] = []
    for color in colores:
        indice = material_de_color(estructura.materiales, str(color))
        if indice is None:
            return None
        indices.append(indice)
    base = _base_de_pista(estructura, str(pista.get("modo")), indices, pista)
    if base is None:
        return None
    patron: dict[str, object] = {"version": VERSION_PATRON, "origen": "referencia", "base": base}
    if pista.get("globos_por_racimo") is not None and estructura.tipo != TIPO_REJILLA:
        patron["globos_por_racimo"] = _entero(pista["globos_por_racimo"])
    # Sin uso respecto del patrón que de verdad se armó: la espiral recorta la
    # lista a k, la flor usa tres colores y el confeti ya reparte todos.
    usados = _materiales_de_base(base)
    sin_uso = [indice for indice in range(len(estructura.materiales)) if indice not in usados]
    if len(sin_uso) > 4:
        return None
    if sin_uso:
        patron["acentos"] = [
            {
                "material": material,
                "cada": 3 + orden,
                "desde": 2 + orden,
                **_posiciones_de_acento(estructura, orden),
            }
            for orden, material in enumerate(sin_uso)
        ]
    if not forma_valida(patron):
        return None
    try:
        validar_y_expandir(estructura, patron)
    except PatronColorInvalido:
        return None
    return patron


# --- Redacción (§8) --------------------------------------------------------------

_EJE_EN = {
    "columna": "from base to top",
    "arco": "from the left base over the top to the right base",
    "semiarco": "from the base to the open tip",
    "guirnalda": "along its length",
    "centro_mesa": "from the bottom up",
    "pared": "from top to bottom",
}
_EJE_ES = {
    "columna": "de la base a la punta",
    "arco": "del pie izquierdo, por la clave, al pie derecho",
    "semiarco": "de la base a la punta",
    "guirnalda": "de un extremo al otro",
    "centro_mesa": "de abajo arriba",
    "pared": "de arriba abajo",
}
#: Eje en espejo (en, es): desde los pies de un arco o los extremos de una guirnalda en U (E5).
_EJE_ESPEJO = {
    "arco": (
        "from both bases up to the top, mirrored on each side",
        "desde cada pie hasta la clave, en espejo",
    ),
    "guirnalda": (
        "from both ends up to the center, mirrored on each side",
        "desde cada extremo hasta el centro, en espejo",
    ),
}
#: Desde dónde se cuenta y dónde se encuentran las dos mitades de una pieza en espejo.
_PIE_Y_CLAVE_ES = {"arco": ("cada pie", "la clave"), "guirnalda": ("cada extremo", "el centro")}
_K_EN = {1: "single", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"}
#: Globos de un color dentro de un racimo, en palabras: el fragmento LoRA no lleva cifras.
_CUENTA_EN = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
}
#: Cómo se encaja cada racimo de una guirnalda por partes (trazo de la espiral), frase Gemini.
_GIRO_GUIRNALDA_EN = {
    "espiral": (
        "each one turned a little further in the same direction, so the colors trace a soft"
        " spiral through the balloons"
    ),
    "zigzag": (
        "turned one way for two clusters and the other way for the next two, so the colors"
        " trace a soft zigzag through the balloons"
    ),
    "recto": "all turned the same way, so each color lines up along the garland",
}
_GIRO_EN = {
    1: "one half",
    2: "one quarter",
    3: "one sixth",
    4: "one eighth",
    5: "one tenth",
    6: "one twelfth",
    7: "one fourteenth",
    8: "one sixteenth",
}
_UNIDADES = {
    1: ("globo", "globos", False),
    2: ("pareja", "parejas", True),
    3: ("trío", "tríos", False),
    4: ("cuarteto", "cuartetos", False),
    5: ("quinteto", "quintetos", False),
    6: ("sexteto", "sextetos", False),
}
_INFLADO = "Infla cada globo con el calibrador para que todos queden del mismo tamaño."
_GRAFICA = "Sigue la gráfica numerada: cada número es un color de la leyenda."
_PARED = (
    "Arma la pared fila por fila, de arriba abajo, siguiendo la gráfica numerada: cada"
    " número es un color de la leyenda."
)


@dataclass(frozen=True, slots=True)
class _Unidad:
    singular: str
    plural: str
    femenina: bool
    en: str

    def cantidad(self, n: int) -> str:
        return f"{n} {self.singular if n == 1 else self.plural}"

    @property
    def el(self) -> str:
        return "la" if self.femenina else "el"

    @property
    def los(self) -> str:
        return "las" if self.femenina else "los"


@dataclass(frozen=True, slots=True)
class _Texto:
    nombre: str
    descripcion: str
    instrucciones: list[str]
    gemini: str
    lora: str


def _unidad(geometria: str, k: int, *, transversal: bool) -> _Unidad:
    if geometria == "rejilla":
        return (
            _Unidad("columna", "columnas", True, "column")
            if transversal
            else _Unidad("fila", "filas", True, "row")
        )
    singular, plural, femenina = _UNIDADES.get(k, (f"racimo de {k}", f"racimos de {k}", False))
    return _Unidad(singular, plural, femenina, "cluster")


def _plural(n: int, singular: str, plural: str) -> str:
    return singular if n == 1 else plural


def _lista_es(nombres: Sequence[str]) -> str:
    return nombres[0] if len(nombres) == 1 else f"{', '.join(nombres[:-1])} y {nombres[-1]}"


def _lista_en(nombres: Sequence[str]) -> str:
    return nombres[0] if len(nombres) == 1 else f"{', '.join(nombres[:-1])} and {nombres[-1]}"


def _ordinal(n: int) -> str:
    sufijo = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{sufijo}"


def _nombre_en(color: str | None) -> str:
    """Color en inglés según la tabla del contrato; lo que no conoce es "catalog color".

    Nunca la palabra en español: el control de idioma del caption LoRA la
    rechaza (ADR-0028 §8).
    """
    clave = _normalizar(color or "")
    nombre = _COLORES_EN.get(clave) or next(
        (
            ingles
            for espanol, ingles in sorted(_COLORES_EN.items(), key=lambda par: -len(par[0]))
            if clave.startswith(f"{espanol} ")
        ),
        None,
    )
    return nombre or "catalog color"


def _color_en(material: MaterialPatron) -> str:
    """Color con su acabado para la frase Gemini ("pearl white"), desde ``x-acabados-en``.

    El fragmento LoRA nombra solo el color (``_nombre_en``): el compilador lo
    pone detrás de su propia frase de materiales, que ya dice los acabados con
    el vocabulario del LoRA, y una segunda tabla nombraría el mismo globo de
    dos maneras.
    """
    nombre = _nombre_en(material.color)
    acabado = _ACABADOS_EN.get(_normalizar(material.acabado or ""))
    return f"{acabado} {nombre}" if acabado else nombre


def nombre_color_en(color: str | None) -> str:
    """Solo el color en inglés (fragmento LoRA); ``_nombre_en`` para otros módulos."""
    return _nombre_en(color)


def color_con_acabado_en(color: str | None, acabado: str | None) -> str:
    """Color con su acabado en inglés (frase Gemini); ``_color_en`` para otros módulos."""
    return _color_en(MaterialPatron(color, acabado, 1.0))


def lista_en(nombres: Sequence[str]) -> str:
    """``a, b and c`` en inglés; ``_lista_en`` para otros módulos."""
    return str(_lista_en(nombres))


def _sin_repetir_seguidos(nombres: Sequence[str]) -> list[str]:
    """Una secuencia sin el mismo nombre dos veces seguidas ("gold, then gold")."""
    return [
        nombre
        for indice, nombre in enumerate(nombres)
        if not indice or nombre != nombres[indice - 1]
    ]


class _Redactor:
    """Textos de un patrón ya expandido, con los nombres de color de la estructura."""

    def __init__(self, estructura: EstructuraPatron, p: _Patron, expansion: Expansion) -> None:
        self.estructura = estructura
        self.p = p
        self.expansion = expansion
        self.racimos = expansion.geometria == "racimos"
        self.unidad = _unidad(expansion.geometria, expansion.columnas, transversal=False)
        self.linea = _unidad(
            expansion.geometria, expansion.columnas, transversal=p.direccion == "transversal"
        )
        if p.direccion == "transversal":
            self.eje_en, self.eje_es = "from left to right", "de izquierda a derecha"
        elif p.direccion == "diagonal":
            self.eje_en = "diagonally from the top left corner to the bottom right corner"
            self.eje_es = "en diagonal, de la esquina superior izquierda a la inferior derecha"
        elif p.espejo:
            self.eje_en, self.eje_es = _EJE_ESPEJO.get(estructura.tipo, _EJE_ESPEJO["arco"])
        else:
            self.eje_en, self.eje_es = _EJE_EN[estructura.tipo], _EJE_ES[estructura.tipo]
        self.pie_es, self.clave_es = _PIE_Y_CLAVE_ES.get(estructura.tipo, _PIE_Y_CLAVE_ES["arco"])
        # Guirnalda por partes (ADR-0032): el patrón colorea los racimos de su
        # armado, así que se redacta como racimos de globos, nunca como franjas
        # o bandas que envuelven la pieza (el modelo las dibujaba como cintas).
        self.guirnalda_por_racimos = self.racimos and _racimo_de_armado(estructura) is not None

    def es(self, indice: int) -> str:
        return _nombre_color(self.estructura, indice)

    def en(self, indice: int) -> str:
        """Nombre para la frase Gemini: color con su acabado."""
        return _color_en(self.estructura.materiales[indice])

    def lora(self, indice: int) -> str:
        """Nombre para el fragmento LoRA: solo el color (ver ``_color_en``)."""
        return _nombre_en(self.estructura.materiales[indice].color)

    def lista_lora(self, indices: Sequence[int]) -> str:
        # Dos acabados del mismo color son un solo nombre en el caption.
        distintos = list(dict.fromkeys(self.lora(i) for i in indices))
        return _lista_en(distintos) if len(distintos) <= 4 else "multicolor"

    def composicion(self, racimo: Sequence[int], *, lora: bool) -> str:
        """Cuántos globos de cada color lleva un racimo: "two pink, one orange and one gold".

        En palabras (el fragmento LoRA no lleva cifras) y en el orden en que
        aparecen los colores; dos materiales con el mismo nombre suman.
        """
        cuentas: dict[str, int] = {}
        for indice in racimo:
            nombre = self.lora(indice) if lora else self.en(indice)
            cuentas[nombre] = cuentas.get(nombre, 0) + 1
        return _lista_en([f"{_CUENTA_EN.get(n, 'several')} {c}" for c, n in cuentas.items()])

    def espiral_guirnalda(self, racimo: Sequence[int], trazo: str) -> tuple[str, str]:
        """``(gemini, lora)`` de una espiral sobre los racimos de una guirnalda por partes.

        La espiral de una columna son franjas de globos que la rodean; en una
        guirnalda orgánica "wrapped in a spiral of ... stripes" hacía que el
        modelo dibujara cintas retorcidas cruzando la pieza (2026-09-28). Aquí
        se dice lo que el decorador arma: racimos iguales de globos redondos,
        uno detrás de otro, con cuántos globos de cada color lleva cada uno.
        """
        k = len(racimo)
        colores_lora = list(dict.fromkeys(self.lora(i) for i in racimo))
        if len(_distintos(racimo)) <= 4:
            cada = (
                f"every {_K_EN[k]}-balloon cluster is the same:"
                f" {self.composicion(racimo, lora=False)} round latex balloons, in the order"
                f" {', '.join(self.en(i) for i in racimo)} around the cluster"
            )
        else:
            cada = (
                f"every {_K_EN[k]}-balloon cluster is the same, a repeating sequence of"
                f" {len(_distintos(racimo))} colors of round latex balloons"
            )
        gemini = (
            f"COLOR PATTERN — {cada}. The clusters repeat one after another {self.eje_en},"
            f" {_GIRO_GUIRNALDA_EN[trazo]}. The pattern comes only from the balloons' own"
            " colors; keep the order unbroken and do not randomize."
        )
        if len(colores_lora) <= 4:
            composicion = self.composicion(racimo, lora=True)
            # "two pink and one gold balloon", "two pink and two white balloons".
            globo = (
                "balloon" if composicion.rsplit(" and ", 1)[-1].startswith("one ") else "balloons"
            )
            lora = f"every cluster holding {composicion} {globo}"
        else:
            lora = "every cluster holding the same mix of multicolor balloons"
        return gemini, lora

    def armado(self) -> str:
        k = self.expansion.columnas
        if k == 1:
            return "Cada posición de la gráfica es un globo suelto."
        if k == 2:
            return "Arma parejas: dos globos amarrados por el cuello."
        if k == 3:
            return "Arma una pareja y súmale un globo para formar cada trío."
        if k == 4:
            return (
                "Arma parejas (dos globos amarrados por el cuello) y une dos parejas para formar"
                " cada cuarteto."
            )
        return f"Arma cada {self.unidad.singular} con {k} globos, empezando por parejas."

    def espiral(self) -> _Texto:
        texto = self._espiral()
        if not self.guirnalda_por_racimos:
            return texto
        gemini, lora = self.espiral_guirnalda(
            _enteros(self.p.base["racimo"]), str(self.p.base["trazo"])
        )
        return _Texto(texto.nombre, texto.descripcion, texto.instrucciones, gemini, lora)

    def _espiral(self) -> _Texto:
        racimo = _enteros(self.p.base["racimo"])
        trazo = str(self.p.base["trazo"])
        k, u = len(racimo), self.unidad
        distintos = _distintos(racimo)
        secuencia_es = ", ".join(self.es(i) for i in racimo)
        secuencia_en = (
            ", ".join(self.en(i) for i in racimo)
            if len(distintos) <= 4
            else f"a repeating sequence of {len(distintos)} colors"
        )
        racimo_en = f"identical {_K_EN[k]}-balloon clusters ({secuencia_en} around each cluster)"
        giro = f"1/{2 * k} de vuelta"
        colores = self.lista_lora(racimo)
        orden = f"Dentro de cada {u.singular} respeta el orden de colores: {secuencia_es}."
        iguales = (
            f"{u.plural[0].upper()}{u.plural[1:]} iguales de"
            f" {_lista_es([self.es(i) for i in racimo])}"
        )
        if trazo == "zigzag":
            return _Texto(
                "Zig-zag",
                f"{iguales} que giran dos capas hacia la izquierda y dos hacia la derecha: los"
                f" colores forman un zigzag {self.eje_es}.",
                [
                    orden,
                    f"Gira {u.los} {u.plural} de dos en dos: dos hacia la izquierda y {u.los} dos"
                    f" siguientes hacia la derecha, {giro} cada vez, para dibujar el zigzag.",
                ],
                f"COLOR PATTERN — {racimo_en} turned left for two layers and right for the next"
                f" two, so the stripes zigzag {self.eje_en}; keep the order unbroken.",
                f"with zigzag chevron stripes of {colores} running {self.eje_en}",
            )
        if trazo == "recto":
            return _Texto(
                "Franjas rectas",
                f"{iguales} que se apilan alternando su posición en cada capa: cada color forma"
                f" una franja recta {self.eje_es}.",
                [
                    orden,
                    f"Alterna la posición de {u.los} {u.plural} en cada capa (sin giro, {giro},"
                    " sin giro…) para que cada color forme una franja recta.",
                ],
                f"COLOR PATTERN — {racimo_en} stacked without rotation so each color runs as a"
                f" straight stripe {self.eje_en}.",
                f"composed of straight stripes of {colores} balloons running {self.eje_en}",
            )
        return _Texto(
            "Espiral",
            f"{iguales} que se encajan girando {giro} en cada capa: los colores forman espirales"
            f" continuas {self.eje_es}.",
            [
                orden,
                f"Encaja cada {u.singular} sobre {u.el} anterior girándolo {giro}, siempre en el"
                " mismo sentido: así aparece la espiral.",
            ],
            f"COLOR PATTERN — build it from {racimo_en} rotated {_GIRO_EN[k]} of a turn per layer"
            " so the colors form continuous diagonal spiral stripes winding"
            f" {self.eje_en}; keep the order unbroken and do not randomize.",
            f"wrapped in a spiral of {colores} stripes winding {self.eje_en}",
        )

    def anillos(self) -> _Texto:
        secuencia = _enteros(self.p.base["secuencia"])
        largo, u = _entero(self.p.base["largo"]), self.linea
        distintos = _distintos(secuencia)
        orden_es = " → ".join(self.es(i) for i in secuencia)
        orden_en = (
            f"the order {' → '.join(self.en(i) for i in secuencia)}"
            if len(distintos) <= 4
            else f"a repeating sequence of {len(distintos)} colors"
        )
        por_color = f"{largo} {u.en}{'' if largo == 1 else 's'} per color"
        return _Texto(
            "Anillos",
            f"Cada {u.singular} va de un solo color, en el orden {orden_es}, {u.cantidad(largo)}"
            f" por color, repitiéndose {self.eje_es}.",
            [
                f"Arma cada {u.singular} de un solo color y cambia de color cada"
                f" {u.cantidad(largo)}, en este orden: {orden_es}."
            ],
            f"COLOR PATTERN — each {u.en} is a single color; {u.en}s follow {orden_en},"
            f" {por_color}, repeating {self.eje_en}.",
            self.anillos_lora(secuencia),
        )

    def anillos_lora(self, secuencia: Sequence[int]) -> str:
        """Fragmento LoRA de los anillos; en una guirnalda por partes, racimos de un color.

        "stacked bands" describe los anillos de una columna; en una guirnalda
        armada por racimos cada racimo es de un color, y "bands" invitaba a
        dibujar cintas (ver ``espiral_guirnalda``).
        """
        if not self.guirnalda_por_racimos:
            return (
                f"built with stacked bands of {self.lista_lora(secuencia)} repeating {self.eje_en}"
            )
        colores = list(dict.fromkeys(self.lora(i) for i in secuencia))
        turno = f"{_lista_en(colores)} in turn" if len(colores) <= 4 else "the colors in turn"
        return f"each cluster one solid color, {turno} {self.eje_en}"

    def bloques(self) -> _Texto:
        pesos = _pesos(self.p.base["bloques"])
        transversal = self.p.direccion == "transversal"
        largo = self.expansion.columnas if transversal else self.expansion.filas
        efectivo = (largo + 1) // 2 if self.p.espejo else largo
        tamanos = _mayor_resto(efectivo, [peso for _material, peso in pesos])
        # Líneas de cada bloque en la pieza entera, como las pinta `_lineas`:
        # con espejo cada bloque sale de los dos pies, salvo la línea central de
        # un largo impar, que es una sola (la de la clave).
        bloque_de_linea = [indice for indice, tamano in enumerate(tamanos) for _ in range(tamano)]
        lineas_por_bloque = [0] * len(tamanos)
        for indice in range(largo):
            reflejado = min(indice, largo - 1 - indice) if self.p.espejo else indice
            lineas_por_bloque[bloque_de_linea[reflejado]] += 1
        bloques = [
            (material, tamano, _redondear(100 * lineas / largo))
            for (material, _peso), tamano, lineas in zip(
                pesos, tamanos, lineas_por_bloque, strict=True
            )
        ]
        detalle_es = ", ".join(f"{self.es(m)} ~{pct} %" for m, _tamano, pct in bloques)
        if len(bloques) <= 4:
            detalle_en = ", ".join(f"{self.en(m)} (~{pct}%)" for m, _tamano, pct in bloques)
            secuencia_en = ", then ".join(
                _sin_repetir_seguidos([self.lora(m) for m, _tamano, _pct in bloques])
            )
            gemini = (
                f"COLOR PATTERN — solid color blocks in this order {self.eje_en}: {detalle_en};"
                " clean transitions between blocks."
            )
            lora = f"color-blocked in sections of {secuencia_en} {self.eje_en}"
        else:
            gemini = (
                f"COLOR PATTERN — solid color blocks {self.eje_en} in a sequence of"
                f" {len(bloques)} colors; clean transitions between blocks."
            )
            lora = f"color-blocked in multicolor sections {self.eje_en}"
        return _Texto(
            "Bloques",
            f"Bloques de color sólido {self.eje_es}: {detalle_es}.",
            [self._orden_de_bloques(bloques, largo)],
            gemini,
            lora,
        )

    def _orden_de_bloques(self, bloques: Sequence[tuple[int, int, int]], largo: int) -> str:
        """Paso a paso de los bloques; con espejo, desde cada pie y la clave aparte.

        ``bloques`` es ``(material, tamaño en media pieza, %)``. Con espejo y un
        largo impar, la línea de la clave es una sola: el bloque que la contiene
        pone una línea menos desde cada pie y la de la clave se nombra aparte,
        para que armar desde los dos pies no dé una línea de más.
        """
        u = self.linea
        por_pie = [(material, tamano) for material, tamano, _pct in bloques]
        clave: int | None = None
        if self.p.espejo and largo % 2:
            central = max(indice for indice, (_m, tamano) in enumerate(por_pie) if tamano)
            clave, tamano = por_pie[central]
            por_pie[central] = (clave, tamano - 1)
        orden = ", luego ".join(
            f"{u.cantidad(tamano)} de {self.es(m)}" for m, tamano in por_pie if tamano
        )
        if not self.p.espejo:
            return f"Arma los bloques en orden: {orden}."
        desde = f"desde {self.pie_es} hasta {self.clave_es}"
        if clave is None:
            return f"Arma los bloques en orden, {desde}: {orden}."
        en_la_clave = f"{u.cantidad(1)} de {self.es(clave)}"
        if not orden:
            return f"Arma {en_la_clave} en {self.clave_es}."
        return f"Arma los bloques en orden, {desde}: {orden}; en {self.clave_es}, {en_la_clave}."

    def degradado(self) -> _Texto:
        paradas = _enteros(self.p.base["paradas"])
        m, u = len(paradas), self.linea
        es = [self.es(i) for i in paradas]
        en = [self.en(i) for i in paradas]
        tonos_lora = _sin_repetir_seguidos([self.lora(i) for i in paradas])
        if self.p.base["transicion"] == "escalonada":
            descripcion = (
                f"Degradé por franjas {self.eje_es}: {', luego '.join(es)}; cada franja de un"
                " solo color."
            )
            bandas = f": {', then '.join(en)}" if m <= 4 else f" through a sequence of {m} colors"
            gemini = (
                f"COLOR PATTERN — stepped ombré bands {self.eje_en}{bandas}; each band a single"
                " solid color."
            )
            # El caption LoRA es ASCII: "ombre", no "ombré" (ADR-0028 §8).
            prefijo_lora = "in stepped ombre bands"
            orden = (
                f"Ordena {u.los} {u.plural} por franjas del tono inicial, {es[0]}, al final,"
                f" {es[-1]}; cada franja va de un solo tono, sin mezclar."
            )
        else:
            intermedios = f" pasando por {_lista_es(es[1:-1])}" if m > 2 else ""
            descripcion = (
                f"Degradé {self.eje_es} de {es[0]} a {es[-1]}{intermedios}, con transiciones"
                " mezcladas."
            )
            mezcla = (
                f"{en[0]}, blending through {_lista_en(en[1:-1])} into {en[-1]}"
                if m > 2
                else f"{en[0]}, blending into {en[-1]}"
            )
            tonos = f": {mezcla}" if m <= 4 else f" through a sequence of {m} colors"
            gemini = (
                f"COLOR PATTERN — a gradual ombré {self.eje_en}{tonos}; soft mixed transition"
                " zones, no hard lines."
            )
            prefijo_lora = "in an ombre gradient"
            orden = (
                f"Ordena {u.los} {u.plural} del tono inicial, {es[0]}, al final, {es[-1]}; en cada"
                " transición mezcla globos de los dos tonos para que el cambio sea suave."
            )
        if self.p.direccion == "diagonal":
            orden = (
                "El degradé avanza en diagonal: en cada fila, pon cada tono donde lo marca la"
                " gráfica numerada."
            )
        if len(tonos_lora) == 1:
            # Dos acabados del mismo color: el tono es uno solo en el caption.
            lora = f"{prefijo_lora} of {tonos_lora[0]} {self.eje_en}"
        elif len(tonos_lora) <= 4:
            tramo = f" through {_lista_en(tonos_lora[1:-1])}" if len(tonos_lora) > 2 else ""
            lora = f"{prefijo_lora} from {tonos_lora[0]}{tramo} to {tonos_lora[-1]} {self.eje_en}"
        else:
            lora = f"{prefijo_lora} of many colors {self.eje_en}"
        return _Texto("Degradé", descripcion, [orden], gemini, lora)

    def aleatorio(self) -> _Texto:
        """Confeti; sus dos frases dicen al generador lo que la tarjeta promete (ADR-0035).

        Hasta el 2026-09-29 las dos frases iban vacías a propósito (ADR-0028 §8)
        para que el prompt conservara su reparto orgánico. Ese reparto pide justo
        lo contrario de un confeti ("intentional organic clusters and
        transitions… avoid random speckles"), y una pared blush con racimos de
        dorado salió en tres franjas verticales. ADR-0035 lo enmienda.

        Ninguna de las dos frases dice "confetti": en el inglés de este repo es
        un producto (``balloon.round.foil.white.printed_confetti``, "clear
        confetti-filled balloons"), y nombrarlo invitaría a rellenar de confeti
        globos de látex opaco. El reparto se dice "scattered evenly".
        """
        colores = _distintos([material for material, _peso in _pesos(self.p.base["pesos"])])
        # Máximo 4 colores nombrados, como en los demás modos (ADR-0028 §8).
        nombrados_en = (
            _lista_en([self.en(i) for i in colores])
            if len(colores) <= 4
            else f"{len(colores)} colors"
        )
        return _Texto(
            "Confeti",
            f"Confeti: {_lista_es([self.es(i) for i in colores])} repartidos salteados, sin"
            " formar líneas.",
            [
                "Reparte los colores salteados, evitando que un mismo color forme líneas o"
                " manchas; la gráfica numerada propone un lugar para cada globo."
            ],
            f"COLOR PATTERN — an even scatter of {nombrados_en} intermixed balloon by balloon"
            " over the whole piece, every color reaching every area; no stripes, no bands, no"
            " blocks, no gradient, and no color gathered into a zone or a corner.",
            f"with {self.lista_lora(colores)} scattered evenly all over the piece",
        )

    def flor(self) -> _Texto:
        base = self.p.base
        fondo, petalo, centro = (_entero(base[clave]) for clave in ("fondo", "petalo", "centro"))
        separacion, u = _entero(base["separacion"]), self.unidad
        cada = u.singular if separacion == 1 else f"{separacion} {u.plural}"
        return _Texto(
            "Flores",
            f"Flores: cada {cada} de fondo {self.es(fondo)}, tres {u.plural} de {self.es(petalo)}"
            f" forman una flor con un globo {self.es(centro)} en el centro.",
            [
                f"Deja {u.cantidad(separacion)} de fondo ({self.es(fondo)}) entre flor y flor.",
                f"Cada flor son tres {u.plural} de pétalos ({self.es(petalo)}); el globo del centro"
                f" ({self.es(centro)}) va en {u.el} {u.singular} de pétalos del medio.",
            ],
            f"COLOR PATTERN — every {separacion} {self.en(fondo)} clusters, three {self.en(petalo)}"
            f" clusters form a flower with one {self.en(centro)} balloon at its center; repeat"
            f" {self.eje_en}.",
            f"with daisy flowers of {self.lora(petalo)} petals and a {self.lora(centro)} center"
            f" set between {self.lora(fondo)} clusters",
        )

    def damero(self) -> _Texto:
        secuencia = _enteros(self.p.base["secuencia"])
        tamano = _entero(self.p.base["tamano"])
        es = _lista_es([self.es(i) for i in secuencia])
        en = _lista_en([self.en(i) for i in secuencia])
        colores_lora = self.lista_lora(secuencia)
        if len(secuencia) > 2:
            cuadros = f", en cuadros de {tamano} × {tamano} globos" if tamano > 1 else ""
            return _Texto(
                "Diagonal",
                f"Bandas diagonales de {es} (arcoíris diagonal){cuadros}.",
                [],
                f"COLOR PATTERN — diagonal bands of {en} repeating across the wall.",
                f"with diagonal rainbow bands of {colores_lora}",
            )
        uno, otro = (self.es(i) for i in secuencia)
        uno_en, otro_en = (self.en(i) for i in secuencia)
        if tamano == 1:
            descripcion = f"Damero de {uno} y {otro}, alternando globo a globo."
            gemini = (
                f"COLOR PATTERN — a checkerboard of alternating {uno_en} and {otro_en} balloons."
            )
        else:
            descripcion = f"Damero de {uno} y {otro} en cuadros de {tamano} × {tamano} globos."
            gemini = (
                f"COLOR PATTERN — a checkerboard of {uno_en} and {otro_en} squares of"
                f" {tamano} × {tamano} balloons."
            )
        return _Texto("Damero", descripcion, [], gemini, f"in a checkerboard of {colores_lora}")

    def zonas(self) -> _Texto:
        """Zonas: un fondo con manchas de color AGRUPADAS en sitios de la pieza (ADR-0036).

        Es el modo que existe para decir lo que ningún otro podía: "el dorado va
        en cuatro zonas". Las dos frases se escriben con la gramática del corpus
        (ADR-0035): un ``COLOR PATTERN — `` con su refuerzo tras el punto y coma
        para Gemini, y una cláusula corta, ASCII y sin cifras ni negaciones para
        el LoRA.

        Las manchas se agrupan POR COLOR, no una por una: cuatro clausulas de
        dorado seguidas hacían una frase que el generador leía como cuatro
        colores distintos, y lo que la pieza dice es un color en cuatro sitios.
        """
        base = self.p.base
        fondo = _entero(base["fondo"])
        manchas = _zonas(base["zonas"])
        # Un color y sus anclas, en el orden en que aparecen: el dorado con sus
        # cuatro sitios en una sola cláusula.
        agrupadas: dict[int, list[str]] = {}
        porcentaje: dict[int, int] = {}
        for zona in manchas:
            agrupadas.setdefault(zona.material, []).append(zona.ancla)
            porcentaje[zona.material] = porcentaje.get(zona.material, 0) + zona.extension
        nombrados = len({fondo, *agrupadas})
        detalle_es = "; ".join(
            f"{self.es(material)} agrupado en {_lista_es([_ANCLA_ES[ancla] for ancla in anclas])}"
            f" (~{porcentaje[material]} % de la pieza)"
            for material, anclas in agrupadas.items()
        )
        instrucciones = [
            f"El fondo de la pared es {self.es(fondo)}: rellena con él todo lo que no sea una"
            " zona.",
            *(
                f"Agrupa {self.es(material)} en"
                f" {_lista_es([_ANCLA_ES[ancla] for ancla in anclas])}, unos"
                f" {porcentaje[material]} % de la pared en total; deja cada zona compacta, sin"
                " globos suyos sueltos por el resto."
                for material, anclas in agrupadas.items()
            ),
        ]
        return _Texto(
            "Zonas",
            f"Fondo de {self.es(fondo)} con {detalle_es}.",
            instrucciones,
            self.zonas_gemini(fondo, agrupadas, len(manchas), nombrados),
            self.zonas_lora(fondo, agrupadas, nombrados),
        )

    def zonas_gemini(
        self, fondo: int, agrupadas: Mapping[int, Sequence[str]], manchas: int, nombrados: int
    ) -> str:
        """Frase Gemini de las zonas: un fondo y cada color con todos sus sitios.

        Cuatro colores nombrados es el techo de todos los modos (ADR-0028 §8); por
        encima se dice cuántas manchas y cuántos colores, sin nombrarlos.
        """
        # "a base of X filling the whole piece" le hizo pintar a Gemini un PANEL
        # liso de ese color con los globos colgando alrededor, en vez de una
        # pared de globos (2026-09-29, pared "Mr & Mrs" del usuario): "base" y
        # "fill" describen un fondo, no globos. Todo lo que se nombra aquí tiene
        # que decir que son globos.
        remate = (
            " each patch is one solid group of touching balloons of that single color, and the"
            " remaining balloons fill everything between the patches; no stripes, no bands, no"
            " gradient and no even scatter of the patch colors."
        )
        cabeza = f"COLOR PATTERN — most of the balloons are {self.en(fondo)}, covering the whole piece, with"
        if nombrados > 4:
            return (
                f"{cabeza} {manchas} compact patches of {nombrados - 1} other colors gathered at"
                f" particular places on it;{remate}"
            )
        # ", plus " y no " and ": la lista de anclas de cada color ya lleva su
        # propio "and", y dos seguidos hacían una frase en la que el último sitio
        # de un color parecía ser del siguiente.
        clausulas = ", plus ".join(
            f"{self.en(material)} gathered into {_CUENTA_EN.get(len(anclas), 'several')} compact"
            f" {_plural(len(anclas), 'patch', 'patches')} at"
            f" {_lista_en([_ANCLA_EN[ancla] for ancla in anclas])}"
            for material, anclas in agrupadas.items()
        )
        return f"{cabeza} {clausulas};{remate}"

    def zonas_lora(
        self, fondo: int, agrupadas: Mapping[int, Sequence[str]], nombrados: int
    ) -> str:
        """Fragmento LoRA de las zonas: ASCII, sin cifras y sin negaciones (ADR-0028 §8).

        "over a X base" le hacía pintar al LoRA un PANEL liso de ese color con
        los globos alrededor, igual que "a base of" en la frase Gemini
        (2026-09-29): la imagen la genera el LoRA, así que esta es la frase que
        de verdad decide. "among X balloons" dice lo mismo y todo lo que nombra
        son globos.

        Nombra el sitio solo cuando el color va en uno: con varios pesa más que
        cualquier otro fragmento del caption y el compilador tiene un tope
        (``LORA_PROMPT_MAX_LENGTH``) que empieza a tirar partes. "in four compact
        patches" dice el mismo look sin cifras.
        """
        if nombrados > 4:
            return f"with compact multicolor patches among {self.lora(fondo)} balloons"
        clausulas = _sin_repetir_seguidos(
            [
                f"{self.lora(material)} clustered at {_ANCLA_EN[anclas[0]]}"
                if len(anclas) == 1
                else f"{self.lora(material)} clustered in"
                f" {_CUENTA_EN.get(len(anclas), 'several')} compact patches"
                for material, anclas in agrupadas.items()
            ]
        )
        return f"with {', plus '.join(clausulas)} among {self.lora(fondo)} balloons"

    def acentos(self) -> tuple[list[str], list[str], str]:
        """Instrucciones, frases Gemini y fragmento LoRA de los acentos."""
        instrucciones: list[str] = []
        gemini: list[str] = []
        u = self.unidad
        for acento in self.p.acentos:
            if acento.posiciones is None:
                donde = "en todos sus globos"
            else:
                numeros = [str(posicion + 1) for posicion in acento.posiciones]
                posicion = _plural(len(numeros), "la posición", "las posiciones")
                donde = f"en {posicion} {_lista_es(numeros)}"
            contando = f", contando desde {self.pie_es}" if self.p.espejo else ""
            instrucciones.append(
                f"Acento: cada {acento.cada} {u.plural}, empezando en {u.el} {u.singular}"
                f" {acento.desde}{contando}, lleva {self.es(acento.material)} {donde}."
            )
            gemini.append(
                f"Every {_ordinal(acento.cada)} {u.en} (starting at {u.en} {acento.desde})"
                f" carries {self.en(acento.material)}."
            )
        materiales = [acento.material for acento in self.p.acentos]
        lora = (
            f", with evenly spaced {self.lista_lora(materiales)} accent clusters"
            if materiales
            else ""
        )
        return instrucciones, gemini, lora

    def textos(self) -> _Texto:
        modo = {
            "espiral": self.espiral,
            "anillos": self.anillos,
            "bloques": self.bloques,
            "degradado": self.degradado,
            "aleatorio": self.aleatorio,
            "flor": self.flor,
            "damero": self.damero,
            "zonas": self.zonas,
        }[self.p.modo]()
        instrucciones_acentos, gemini_acentos, lora_acentos = self.acentos()
        gemini, lora = modo.gemini, modo.lora
        # Todos los modos redactan sus dos frases, el confeti incluido desde
        # ADR-0035. Las guardas siguen aquí porque un modo sin frase (o un
        # `prompt_gemini` vacío que llegue de una versión anterior del servicio)
        # no debe recibir los acentos pegados a una cadena vacía.
        if gemini:
            gemini = " ".join(
                [
                    gemini,
                    *gemini_acentos,
                    *(
                        [
                            "Some clusters were hand-painted by the decorator; follow the"
                            " per-cluster color map exactly."
                        ]
                        if self.p.pintados
                        else []
                    ),
                ]
            )
        if lora:
            lora += lora_acentos
        pintados = (
            ["Hay globos pintados a mano: respétalos tal cual aparecen en la gráfica numerada."]
            if self.p.pintados
            else []
        )
        instrucciones = [
            _INFLADO,
            self.armado() if self.racimos else _PARED,
            *modo.instrucciones,
            *instrucciones_acentos,
            *pintados,
            *([_GRAFICA] if self.racimos else []),
        ]
        return _Texto(modo.nombre, modo.descripcion, instrucciones, gemini, lora)


def _valores_distintos(fila: object) -> object:
    """Una fila de celdas con cada par (tipo, valor) una sola vez, en su orden."""
    if not isinstance(fila, list):
        return fila
    try:
        return list({(type(valor), valor): valor for valor in fila}.values())
    except TypeError:  # un valor que no se puede comparar: que lo vea el validador
        return fila


def para_validar(patron: Mapping[str, object]) -> dict[str, object]:
    """Copia de un patrón resuelto para validarlo contra plan-resuelto.v1 sin recorrer cada globo.

    Las rejillas (``celdas`` y ``pasos[].celdas``) son lo único grande: miles
    de enteros en una pared, y validarlos uno a uno con el JSON Schema era casi
    todo el costo de la vista previa y de la resolución. La regla de cada celda
    (entero de 0 a 2^53 - 1) solo mira su tipo y su valor, y el contrato no
    limita el largo de una fila: validar cada par (tipo, valor) distinto de una
    fila una sola vez da el mismo resultado que validarla entera. ``True`` y
    ``1`` son pares distintos, así que un booleano sigue sin pasar por entero.
    Solo para validar: lo que se responde es el patrón completo.
    """
    copia = dict(patron)
    celdas = patron.get("celdas")
    if isinstance(celdas, list):
        copia["celdas"] = [_valores_distintos(fila) for fila in celdas]
    pasos = patron.get("pasos")
    if isinstance(pasos, list):
        copia["pasos"] = [
            {**paso, "celdas": _valores_distintos(paso["celdas"])}
            if isinstance(paso, Mapping) and "celdas" in paso
            else paso
            for paso in pasos
        ]
    return copia


def _pasos(expansion: Expansion) -> list[dict[str, object]]:
    """Filas idénticas consecutivas (celdas y extras), 1-based e inclusivas."""
    extras_por_fila: dict[int, list[int]] = {}
    for numero, material in expansion.extras:
        extras_por_fila.setdefault(numero, []).append(material)
    tramos: list[tuple[int, int, list[int], list[int]]] = []
    for indice, fila in enumerate(expansion.celdas):
        celdas, extras = list(fila), extras_por_fila.get(indice, [])
        if tramos and tramos[-1][2] == celdas and tramos[-1][3] == extras:
            desde, _hasta, _celdas, _extras = tramos[-1]
            tramos[-1] = (desde, indice + 1, celdas, extras)
        else:
            tramos.append((indice + 1, indice + 1, celdas, extras))
    return [
        {"desde": desde, "hasta": hasta, "celdas": celdas, "extras": extras}
        for desde, hasta, celdas, extras in tramos
    ]


def patron_resuelto(
    estructura: EstructuraPatron, patron: Mapping[str, object], *, aplicado: bool
) -> dict[str, object]:
    """``PatronColorResuelto`` (plan-resuelto.v1 §8): rejilla, conteo, pasos y textos.

    ``aplicado`` distingue el patrón del plan de una sugerencia; con una
    sugerencia los conteos son los de la sugerencia, no los del plan.
    """
    p = _leer(patron)
    expansion = _expandir(estructura, p)
    conteo = conteo_por_instancia(estructura, expansion)
    texto = _Redactor(estructura, p, expansion).textos()
    avisos = list(expansion.avisos)
    if estructura.un_tamano and conteo.total != estructura.total:
        if expansion.geometria == "racimos":
            unidad = _unidad("racimos", expansion.columnas, transversal=False)
            centros = " y los centros de las flores" if expansion.extras else ""
            avisos.append(
                f"Con {unidad.plural} completos{centros} cada pieza lleva {conteo.total} globos;"
                f" las medidas daban {estructura.total}."
            )
        else:
            avisos.append(
                f"Con la rejilla completa ({expansion.filas} × {expansion.columnas}) la pared lleva"
                f" {conteo.total} globos; las medidas daban {estructura.total}."
            )
    posiciones = expansion.filas * expansion.columnas + len(expansion.extras)
    if not estructura.un_tamano and conteo.total != posiciones:
        avisos.append(
            f"La gráfica tiene {posiciones} posiciones y la mezcla de varios tamaños da"
            f" {conteo.total} globos por pieza: el conteo por color reparte esos"
            f" {conteo.total} en la proporción de la gráfica, con al menos uno por color."
        )
    return {
        "estructura_id": estructura.estructura_id,
        "aplicado": aplicado,
        "patron": copy.deepcopy(dict(patron)),
        "geometria": expansion.geometria,
        "filas": expansion.filas,
        "columnas": expansion.columnas,
        "repeticiones": estructura.repeticiones,
        "globos_por_instancia": conteo.total,
        "celdas": [list(fila) for fila in expansion.celdas],
        "extras": [{"fila": fila, "material": material} for fila, material in expansion.extras],
        "conteo": [
            {
                "material": indice,
                "color": material.color,
                "acabado": material.acabado,
                "unidades_por_instancia": unidades,
                "unidades_total": unidades * estructura.repeticiones,
            }
            for indice, (material, unidades) in enumerate(
                zip(estructura.materiales, conteo.unidades, strict=True)
            )
        ],
        "pasos": _pasos(expansion),
        "nombre": texto.nombre,
        "descripcion": texto.descripcion,
        "instrucciones": texto.instrucciones,
        "prompt_gemini": texto.gemini,
        "prompt_lora": texto.lora,
        "avisos": avisos,
    }


__all__ = [
    "ANCLAS",
    "AVISO_ESPEJO_GUIRNALDA",
    "quitar_espejo_sin_u",
    "Conteo",
    "DIRECCIONES",
    "EXTENSION_ZONA_MAXIMA",
    "MAX_EXTENSION_ZONAS",
    "ZONAS_MAXIMAS",
    "EstructuraPatron",
    "Expansion",
    "FORMA_GUIRNALDA_ESPEJO",
    "MODOS",
    "MaterialPatron",
    "PatronColorInvalido",
    "PuntoDePartida",
    "TIPOS_RACIMOS",
    "modos_admitidos",
    "para_validar",
    "sugerir_patron_modo",
    "TIPO_REJILLA",
    "VERSION_PATRON",
    "color_con_acabado_en",
    "conteo_por_instancia",
    "filas_de_racimos",
    "forma_valida",
    "lista_en",
    "material_de_color",
    "nombre_color_en",
    "participaciones",
    "patron_desde_pista",
    "patron_resuelto",
    "sugerir_patron",
    "validar_y_expandir",
]
