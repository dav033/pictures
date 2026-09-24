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
    "pared": ("anillos", "bloques", "degradado", "aleatorio", "damero"),
}
_TIPOS_ESPIRAL_SUGERIDA = frozenset({"columna", "arco", "semiarco", "guirnalda"})

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
# para descartar un patrón armado desde una pista que no cabe en él.
_FORMA = Draft7Validator(
    _PLAN_SCHEMA["properties"]["estructuras"]["items"]["properties"]["patron_color"]
)

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
}


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
    diámetro.
    """

    estructura_id: str
    tipo: str
    total: int
    un_tamano: bool
    ancho_m: float | None
    alto_m: float | None
    repeticiones: int
    materiales: tuple[MaterialPatron, ...]


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


def _globos_por_racimo(p: _Patron) -> int:
    if p.globos_por_racimo is not None:
        return p.globos_por_racimo
    if p.modo == "espiral":
        return len(_enteros(p.base["racimo"]))
    return 4


def _rejilla(estructura: EstructuraPatron, p: _Patron) -> tuple[str, int, int]:
    total = max(0, estructura.total)
    if estructura.tipo == TIPO_REJILLA:
        ancho, alto = estructura.ancho_m, estructura.alto_m
        razon = ancho / alto if ancho and alto else 1.0
        columnas = max(2, _redondear(math.sqrt(total * razon)))
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
    if p.espejo and tipo != "arco":
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


def _racimo_sugerido(estructura: EstructuraPatron) -> list[int]:
    """Cuatro posiciones: una por material y el resto por mayor resto, intercaladas."""
    partes = [Fraction(str(material.participacion)) for material in estructura.materiales]
    cantidad = len(partes)
    sobrantes = [max(Fraction(0), 4 * parte - 1) for parte in partes]
    if sum(sobrantes) == 0:
        sobrantes = [Fraction(1)] * cantidad
    posiciones = [1 + extra for extra in _mayor_resto(4 - cantidad, sobrantes)]
    racimo: list[int] = []
    anterior: int | None = None
    for _posicion in range(4):
        disponibles = [indice for indice in range(cantidad) if posiciones[indice] > 0]
        distintos = [indice for indice in disponibles if indice != anterior] or disponibles
        elegido = min(distintos, key=lambda indice: (-posiciones[indice], -partes[indice], indice))
        racimo.append(elegido)
        posiciones[elegido] -= 1
        anterior = elegido
    return racimo


def sugerir_patron(estructura: EstructuraPatron) -> dict[str, object]:
    """Preset del oficio para una estructura sin patrón (``origen: "sugerido"``).

    Espiral de cuartetos en racimos de un solo tamaño con 2–4 colores; confeti
    por ``participacion`` en el resto. Lanza ``PatronColorInvalido`` cuando la
    estructura no admite patrón o el preset dejaría un color sin globos.
    """
    _validar_estructura(estructura)
    cantidad = len(estructura.materiales)
    base: dict[str, object]
    if estructura.tipo in _TIPOS_ESPIRAL_SUGERIDA and estructura.un_tamano and cantidad <= 4:
        base = {"modo": "espiral", "racimo": _racimo_sugerido(estructura), "trazo": "espiral"}
    else:
        base = {
            "modo": "aleatorio",
            "pesos": _pesos_por_participacion(estructura, range(cantidad)),
            "semilla": _semilla(estructura.estructura_id),
        }
    patron: dict[str, object] = {"version": VERSION_PATRON, "origen": "sugerido", "base": base}
    validar_y_expandir(estructura, patron)
    return patron


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
                # El espejo evalúa base y acentos desde los dos pies; el
                # confeti lo ignora (§3), así que no se ofrece.
                "espejo": estructura.tipo == "arco" and modo != "aleatorio",
            }
        )
    return admitidos


def _por_participacion(estructura: EstructuraPatron) -> list[int]:
    """Índices de material de mayor a menor participación (desempate por posición)."""
    return sorted(
        range(len(estructura.materiales)),
        key=lambda indice: (-Fraction(str(estructura.materiales[indice].participacion)), indice),
    )


def _con_acentos_para_sin_uso(
    estructura: EstructuraPatron, patron: dict[str, object]
) -> dict[str, object]:
    """Cada color que la base no usa entra como acento (como con las pistas, §7)."""
    usados = _materiales_de_base(cast(Mapping[str, object], patron["base"]))
    sin_uso = [indice for indice in range(len(estructura.materiales)) if indice not in usados]
    if sin_uso:
        patron["acentos"] = [
            {
                "material": material,
                "cada": 3 + orden,
                "desde": 2 + orden,
                **({"posiciones": [0]} if estructura.tipo != TIPO_REJILLA else {}),
            }
            for orden, material in enumerate(sin_uso)
        ]
    return patron


def sugerir_patron_modo(estructura: EstructuraPatron, modo: str) -> dict[str, object]:
    """Punto de partida de un estilo concreto que elige el decorador (``origen: "sugerido"``).

    Parte de la ``participacion`` de la pieza: el color principal manda en el
    fondo, el orden de los bloques o la secuencia. Los colores que el estilo no
    usa entran como acentos. Lanza ``PatronColorInvalido`` si el estilo no se
    arma en la estructura o dejaría un color sin globos.
    """
    _validar_estructura(estructura)
    if modo not in _MODOS_POR_TIPO[estructura.tipo]:
        opciones = ", ".join(_MODO_ES[opcion] for opcion in _MODOS_POR_TIPO[estructura.tipo])
        raise PatronColorInvalido(
            "modo_no_permitido",
            f"El patrón «{_MODO_ES.get(modo, modo)}» no se arma en {_TIPO_ES[estructura.tipo]};"
            f" elige {opciones}.",
        )
    cantidad = len(estructura.materiales)
    orden = _por_participacion(estructura)
    patron: dict[str, object] = {"version": VERSION_PATRON, "origen": "sugerido"}
    if modo == "espiral":
        if cantidad <= 4:
            patron["base"] = {
                "modo": "espiral",
                "racimo": _racimo_sugerido(estructura),
                "trazo": "espiral",
            }
        else:
            # Cinco o seis colores: un racimo con una posición por color.
            patron["globos_por_racimo"] = cantidad
            patron["base"] = {
                "modo": "espiral",
                "racimo": list(range(cantidad)),
                "trazo": "espiral",
            }
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
    else:
        patron["base"] = {"modo": "damero", "secuencia": orden[:4], "tamano": 1}
    patron = _con_acentos_para_sin_uso(estructura, patron)
    validar_y_expandir(estructura, patron)
    return patron


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
                **({"posiciones": [0]} if estructura.tipo != TIPO_REJILLA else {}),
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
_K_EN = {1: "single", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"}
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
            self.eje_en = "from both bases up to the top, mirrored on each side"
            self.eje_es = "desde cada pie hasta la clave, en espejo"
        else:
            self.eje_en, self.eje_es = _EJE_EN[estructura.tipo], _EJE_ES[estructura.tipo]

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
            f"built with stacked bands of {self.lista_lora(secuencia)} repeating {self.eje_en}",
        )

    def bloques(self) -> _Texto:
        pesos = _pesos(self.p.base["bloques"])
        transversal = self.p.direccion == "transversal"
        largo = self.expansion.columnas if transversal else self.expansion.filas
        efectivo = (largo + 1) // 2 if self.p.espejo else largo
        tamanos = _mayor_resto(efectivo, [peso for _material, peso in pesos])
        bloques = [
            (material, tamano, _redondear(100 * tamano / efectivo))
            for (material, _peso), tamano in zip(pesos, tamanos, strict=True)
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
        u = self.linea
        orden = ", luego ".join(
            f"{u.cantidad(tamano)} de {self.es(m)}" for m, tamano, _pct in bloques if tamano
        )
        desde = ", desde cada pie hasta la clave" if self.p.espejo else ""
        return _Texto(
            "Bloques",
            f"Bloques de color sólido {self.eje_es}: {detalle_es}.",
            [f"Arma los bloques en orden{desde}: {orden}."],
            gemini,
            lora,
        )

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
        colores = _distintos([material for material, _peso in _pesos(self.p.base["pesos"])])
        return _Texto(
            "Confeti",
            f"Confeti: {_lista_es([self.es(i) for i in colores])} repartidos salteados, sin"
            " formar líneas.",
            [
                "Reparte los colores salteados, evitando que un mismo color forme líneas o"
                " manchas; la gráfica numerada propone un lugar para cada globo."
            ],
            "",
            "",
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
            contando = ", contando desde cada pie" if self.p.espejo else ""
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
        }[self.p.modo]()
        instrucciones_acentos, gemini_acentos, lora_acentos = self.acentos()
        gemini, lora = modo.gemini, modo.lora
        # El confeti deja vacías las dos frases: el prompt conserva su redacción
        # orgánica de siempre (ADR-0028 §8).
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
    "Conteo",
    "EstructuraPatron",
    "Expansion",
    "MaterialPatron",
    "PatronColorInvalido",
    "TIPOS_RACIMOS",
    "modos_admitidos",
    "sugerir_patron_modo",
    "TIPO_REJILLA",
    "VERSION_PATRON",
    "conteo_por_instancia",
    "forma_valida",
    "material_de_color",
    "participaciones",
    "patron_desde_pista",
    "patron_resuelto",
    "sugerir_patron",
    "validar_y_expandir",
]
