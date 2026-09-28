"""Armado de una guirnalda por partes (ADR-0032): el único dueño de sus reglas.

Un armado dice sobre qué va la guirnalda (``soporte``), qué forma toma, de qué
racimos se arma (unidad Sempertex y tamaño base), qué relleno de globos chicos
lleva entre racimos y qué globos grandes van de remate. Apunta a
``materiales`` por índice, como ``patron_color`` y ``armado_bouquet``. Este
módulo lo valida, sugiere uno cuando falta (por receta o, desde la entrega E4,
por la lectura de la foto) y lo resuelve en lo que dibuja la hoja de armado:
leyenda con un código por globo comprado, racimos numerados de izquierda a
derecha, relleno, remates, sueltos, insumos que el catálogo no vende, duración
estimada, pasos, avisos y las frases del prompt de imagen.

**Nunca cambia lo que se compra.** Los globos de la guirnalda los cuenta
``plan.py`` (medidas, densidad, mezcla y, con un armado que cuelga, el largo
real de la cuerda) y llegan aquí por instancia, material × tamaño
(``EstructuraGuirnalda.globos``). El armado solo los reparte: cada globo
comprado queda en exactamente un racimo, en el relleno, en un remate o suelto,
y ``validar`` lo comprueba. La receta nunca declara caída, así que completar
un armado deja el total en COP igual. La lectura de la foto sí puede traerla,
con el desnivel entre los extremos (decisión 26): relativos al largo, y aquí
se pasan a metros; entonces la cuerda es otra y ``plan.py`` cuenta sobre ella.

Reglas y su fuente:

- Unidades de armado (trío 3, cuarteto 4, quinteto 5): Sempertex, "Conceptos y
  técnicas – globos redondos".
- Relleno solo con globos de 9" o menos: el relleno es de globos chicos entre
  racimos (SEGUIMIENTO-guirnaldas §2.2).

Reglas del oficio **propuestas como supuestos a validar con el negocio**
(ADR-0032): cuarteto de 12" por defecto, trío en ``sencilla`` y quinteto en
``lujosa``; relleno de 5" solo en mezclas orgánicas; los globos de más de 12"
van de remate repartidos a lo largo; el soporte sale de la ubicación (pared en
``fondo_pared``, piso en ``piso_frontal``/``recorrido_suelo``, mesa en
``sobre_mesa_principal``; pared en el resto); insumos por soporte y ritmo de
armado de 12 a 20 racimos por hora.
"""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import cast

from jsonschema import Draft7Validator

from app.generated_models import contract_schema
from app.patron_color import (
    MaterialPatron,
    color_con_acabado_en,
    lista_en,
    material_de_color,
    nombre_color_en,
)

VERSION_ARMADO = "armado-guirnalda.v1"
CONFIANZA_MINIMA_LECTURA = 0.5
SOPORTES = ("pared", "colgada", "piso", "mesa", "sobre_estructura")
FORMAS = ("recta", "curva", "ondulada", "u_invertida", "arco_caido")
UNIDADES = ("trio", "cuarteto", "quinteto")
TAMANOS_BASE = (9, 11, 12)
POSICIONES_REMATE = ("extremo_izq", "extremo_der", "centro", "cada_n")
MAX_REMATES = 6

GLOBOS_POR_UNIDAD: Mapping[str, int] = {"trio": 3, "cuarteto": 4, "quinteto": 5}
#: Relleno: globos de este diámetro o menos (regla de §2.2).
RELLENO_MAXIMO_PULG = 9.0

# --- Supuestos del oficio (ADR-0032, a validar con el negocio) ------------------------

UNIDAD_POR_DENSIDAD: Mapping[str, str] = {
    "sencilla": "trio",
    "media": "cuarteto",
    "lujosa": "quinteto",
}
SOPORTE_POR_UBICACION: Mapping[str, str] = {
    "fondo_pared": "pared",
    "piso_frontal": "piso",
    "recorrido_suelo": "piso",
    "sobre_mesa_principal": "mesa",
}
SOPORTE_POR_DEFECTO = "pared"
MEZCLAS_ORGANICAS = frozenset({"organica_fina", "organica_gruesa"})
#: La receta rellena con los globos de 5" (y menores) de la compra.
TAMANO_RELLENO_RECETA_PULG = 5.0
#: Desde esta caída o este desnivel (fracción del largo) la foto cuenta: por debajo la
#: guirnalda se lee recta y nivelada, y su cuerda cambiaría menos del 1 % (decisión 26).
MEDIDA_RELATIVA_MINIMA = 0.05
#: Formas sin caída propia que, si la foto las ve caer, cuelgan en arco (decisión 26).
FORMAS_QUE_CAEN = frozenset({"recta", "curva"})
#: Tope de ``caida_m`` y de ``desnivel_m`` en ``armado-guirnalda.v1`` (en valor absoluto).
MAX_METROS_GEOMETRIA = 5.0
_MARGEN_TIRA = 1.1
_SEPARACION_GANCHOS_M = 0.5
_SEPARACION_PESAS_M = 1.5
_BAJADA_CUERDA_M = 1.5
#: Racimos por hora (armador lento, rápido) y globos sueltos pegados por hora.
RACIMOS_POR_HORA = (12, 20)
GLOBOS_PEGADOS_POR_HORA = (40, 60)
INSTALACION_HORAS: Mapping[str, tuple[float, float]] = {
    "pared": (0.25, 0.5),
    "colgada": (0.5, 1.0),
    "piso": (0.1, 0.25),
    "mesa": (0.1, 0.25),
    "sobre_estructura": (0.25, 0.5),
}

_PLAN_SCHEMA = contract_schema("PlanDecoracion")
_ESQUEMA_ARMADO: Mapping[str, object] = cast(
    Mapping[str, object],
    _PLAN_SCHEMA["properties"]["estructuras"]["items"]["properties"]["armado_guirnalda"],
)
_FORMA = Draft7Validator(_ESQUEMA_ARMADO)
# Qué formas cuelgan (y cuentan la cuerda con su caída): dueño
# estructuras-oficiales.ts, exportado en x-geometria-estructuras-oficiales.
_GEOMETRIA_GUIRNALDA: Mapping[str, object] = cast(
    Mapping[str, Mapping[str, object]], _PLAN_SCHEMA["x-geometria-estructuras-oficiales"]
)["guirnalda"]
_GEOMETRIA_FORMAS: Mapping[str, Mapping[str, object]] = cast(
    Mapping[str, Mapping[str, object]], _GEOMETRIA_GUIRNALDA["formas"]
)
FORMAS_CON_CAIDA = frozenset(
    forma for forma, datos in _GEOMETRIA_FORMAS.items() if datos.get("conCaida") is True
)
#: Soportes donde una forma que cuelga tiene de dónde colgar y un extremo puede ir más
#: alto que el otro (``desnivel_m``, decisión 26). Dueño: armado-guirnalda.ts
#: (``SOPORTES_CON_CAIDA_GUIRNALDA``), exportado en ``x-reglas-guirnalda``.
SOPORTES_CON_CAIDA = frozenset(
    cast(
        list[str],
        cast(Mapping[str, object], _PLAN_SCHEMA["x-reglas-guirnalda"])["soportesConCaida"],
    )
)


class ArmadoInvalido(ValueError):
    """Un armado que no se puede armar o no corresponde a lo que se compra."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo
        self.mensaje = mensaje


@dataclass(frozen=True)
class GloboGuirnalda:
    """Lo que compra una guirnalda de un material en un tamaño, por instancia.

    ``tamano_pulg`` es el diámetro del despiece (la mezcla efectiva). Lo demás
    viene de la línea resuelta cuando se pudo leer (``product_id``…): la
    leyenda nombra lo que se compra de verdad.
    """

    material: int
    tamano_pulg: float
    por_instancia: int
    color: str | None
    acabado: str | None
    product_id: str | None = None
    variant_id: str | None = None
    tamano_codigo: str | None = None
    diam_entregado: float | None = None


@dataclass(frozen=True)
class OtraEstructura:
    """Otra pieza del plan: una posible anfitriona de ``sobre_estructura``."""

    estructura_id: str
    tipo: str
    nombre: str
    #: Elemento de la foto que materializa (``referencia_element_id``): la lectura
    #: de la guirnalda nombra a su anfitriona por el elemento, no por el plan.
    referencia_element_id: str | None = None


@dataclass(frozen=True)
class EstructuraGuirnalda:
    """Lo que el armado necesita de una guirnalda del plan, ya contada por ``plan.py``."""

    estructura_id: str
    nombre: str
    es_guirnalda: bool
    ubicacion: str
    densidad: str
    mezcla: str
    repeticiones: int
    #: Largo declarado (``largo_m`` o ``ancho_m``) y largo real de la cuerda con la caída.
    largo_m: float
    largo_cuerda_m: float
    materiales: tuple[MaterialPatron, ...]
    globos: tuple[GloboGuirnalda, ...]
    otras: tuple[OtraEstructura, ...] = ()
    #: Filas de la rejilla del patrón de color (material por posición), si tiene patrón.
    filas_patron: tuple[tuple[int, ...], ...] | None = None
    #: El patrón expandido sobre ``n`` racimos seguidos (``patron_color.filas_de_racimos``,
    #: E5): el racimo ``i`` toma la fila ``i``. ``None`` (o si devuelve ``None``): las
    #: filas de ``filas_patron`` tomadas a lo largo.
    filas_de_racimos: Callable[[int], tuple[tuple[int, ...], ...] | None] | None = field(
        default=None, compare=False, repr=False
    )

    @property
    def total(self) -> int:
        return sum(globo.por_instancia for globo in self.globos)

    @property
    def k_patron(self) -> int | None:
        return len(self.filas_patron[0]) if self.filas_patron else None


@dataclass(frozen=True)
class _Remate:
    posicion: str
    material: int
    #: ``(globo, cantidad)`` en el orden del remate (del más grande al más chico).
    globos: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class _Reparto:
    """Cada globo comprado de una instancia en su lugar; índices de ``estructura.globos``."""

    k: int
    racimos: tuple[tuple[int, ...], ...]
    relleno: tuple[tuple[int, int], ...]
    remates: tuple[_Remate, ...]
    sueltos: tuple[tuple[int, int], ...]
    #: Posiciones de un racimo que no pudieron llevar el color del patrón.
    fuera_de_patron: int


# --- Utilidades ------------------------------------------------------------------------


def _redondear(valor: float) -> int:
    return int(Decimal(str(valor)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _cuarto(valor: float, redondeo: str) -> float:
    """``valor`` a cuartos de hora, hacia abajo o hacia arriba."""
    cuartos = (Decimal(str(valor)) * 4).quantize(Decimal("1"), rounding=redondeo)
    return float(cuartos / 4)


def _medio_metro(valor: float) -> float:
    medios = (Decimal(str(valor)) * 2).quantize(Decimal("1"), rounding=ROUND_CEILING)
    return float(medios / 2)


def _mayor_resto(total: int, pesos: Sequence[int]) -> list[int]:
    """Reparto por mayor resto en aritmética exacta (empates a la menor posición)."""
    suma = sum(pesos)
    if total <= 0 or suma <= 0:
        return [0 for _peso in pesos]
    cuotas = [Fraction(total * peso, suma) for peso in pesos]
    pisos = [math.floor(cuota) for cuota in cuotas]
    orden = sorted(range(len(pesos)), key=lambda i: (-(cuotas[i] - pisos[i]), i))
    for indice in orden[: total - sum(pisos)]:
        pisos[indice] += 1
    return pisos


def _esparcir(cuentas: Sequence[tuple[int, int]]) -> list[int]:
    """Cada clave repetida su cuenta, repartida a lo largo lo más parejo posible."""
    posiciones = sorted(
        (Fraction(2 * j + 1, 2 * cantidad), orden, clave)
        for orden, (clave, cantidad) in enumerate(cuentas)
        for j in range(cantidad)
    )
    return [clave for _posicion, _orden, clave in posiciones]


def _clase_base(base: int) -> tuple[float, float]:
    """Diámetros que cuentan como globo del racimo: 9–10" o 11–12"."""
    return (9.0, 10.0) if base == 9 else (11.0, 12.0)


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def _pulgadas(valor: float) -> str:
    return f'{int(valor)}"' if float(valor).is_integer() else f'{valor:g}"'


def _ascii_sin_cifras(texto: str) -> str:
    """El fragmento LoRA: ASCII, sin cifras y sin espacios dobles (ADR-0028 §8)."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return " ".join("".join(c for c in plano if not c.isdigit()).split())


# --- Validación y reparto ----------------------------------------------------------------


def _indices_materiales(armado: Mapping[str, object]) -> list[int]:
    usados = [int(cast(int, remate["material"])) for remate in _remates(armado)]
    relleno = armado.get("relleno")
    if isinstance(relleno, Mapping):
        usados.append(int(cast(int, relleno["material"])))
    return usados


def _remates(armado: Mapping[str, object]) -> list[Mapping[str, object]]:
    return cast(list[Mapping[str, object]], armado.get("remates", []))


def _validar_forma_y_soporte(estructura: EstructuraGuirnalda, armado: Mapping[str, object]) -> None:
    if not estructura.es_guirnalda:
        raise ArmadoInvalido("no_es_guirnalda", "Solo una guirnalda se arma por racimos.")
    if next(_FORMA.iter_errors(armado), None) is not None:
        raise ArmadoInvalido(
            "forma_invalida", "El armado no tiene la forma de armado-guirnalda.v1."
        )
    if estructura.total <= 0:
        raise ArmadoInvalido("guirnalda_sin_globos", "La guirnalda no lleva globos que armar.")
    if any(indice >= len(estructura.materiales) for indice in _indices_materiales(armado)):
        raise ArmadoInvalido(
            "material_fuera_de_rango", "El armado nombra un color que la guirnalda no lleva."
        )
    soporte = str(armado["soporte"])
    anfitriona_id = armado.get("estructura_id")
    if soporte == "sobre_estructura":
        if not isinstance(anfitriona_id, str):
            raise ArmadoInvalido(
                "anfitriona_faltante", "Di sobre qué pieza del plan va la guirnalda."
            )
        anfitriona = next(
            (
                otra
                for otra in estructura.otras
                if otra.estructura_id == anfitriona_id
                and otra.estructura_id != estructura.estructura_id
            ),
            None,
        )
        if anfitriona is None:
            raise ArmadoInvalido(
                "anfitriona_inexistente",
                "La pieza sobre la que va la guirnalda no está en el plan.",
            )
        if anfitriona.tipo == "guirnalda":
            raise ArmadoInvalido(
                "anfitriona_es_guirnalda",
                "Una guirnalda no se arma sobre otra guirnalda: únelas en una sola más larga.",
            )
    elif anfitriona_id is not None:
        raise ArmadoInvalido(
            "anfitriona_sin_sobre_estructura",
            "Solo una guirnalda sobre otra pieza dice cuál es esa pieza.",
        )
    if soporte == "colgada" and armado.get("puntos_de_anclaje") is None:
        raise ArmadoInvalido(
            "colgada_sin_anclajes",
            "Una guirnalda colgada necesita al menos 2 puntos de anclaje.",
        )
    forma = str(armado["forma"])
    if armado.get("caida_m") is not None and forma not in FORMAS_CON_CAIDA:
        raise ArmadoInvalido(
            "caida_sin_forma_colgante",
            "Solo una guirnalda en U invertida o en arco caído tiene caída.",
        )
    if forma in FORMAS_CON_CAIDA and soporte not in SOPORTES_CON_CAIDA:
        raise ArmadoInvalido(
            "forma_no_admitida",
            "Una guirnalda que cuelga necesita la pared o puntos de anclaje de donde colgar.",
        )
    if armado.get("desnivel_m") is not None and soporte not in SOPORTES_CON_CAIDA:
        raise ArmadoInvalido(
            "desnivel_sin_soporte",
            "Solo una guirnalda en la pared o colgada tiene un extremo más alto que el otro.",
        )
    k = GLOBOS_POR_UNIDAD[str(cast(Mapping[str, object], armado["racimo"])["unidad"])]
    if estructura.k_patron is not None and k != estructura.k_patron:
        raise ArmadoInvalido(
            "racimo_distinto_del_patron",
            f"El patrón de color va en racimos de {estructura.k_patron} globos: usa esa unidad"
            " o cambia el patrón.",
        )


def _tomar_relleno(
    estructura: EstructuraGuirnalda,
    relleno: Mapping[str, object],
    restantes: list[int],
    minimo_base: float,
) -> tuple[tuple[int, int], ...]:
    globos = estructura.globos
    chicos = [
        i
        for i, globo in enumerate(globos)
        if globo.tamano_pulg < minimo_base
        and globo.tamano_pulg <= RELLENO_MAXIMO_PULG
        and restantes[i] > 0
    ]
    if not chicos:
        raise ArmadoInvalido(
            "relleno_sin_globos_chicos",
            'El relleno es de globos de 9" o menos y esta mezcla no los lleva.',
        )
    pedido = _redondear(float(cast(float, relleno["proporcion"])) * estructura.total)
    if pedido <= 0:
        raise ArmadoInvalido(
            "relleno_vacio", "Con esa proporción el relleno no lleva ningún globo: quítalo."
        )
    disponibles = sum(restantes[i] for i in chicos)
    if pedido > disponibles:
        raise ArmadoInvalido(
            "relleno_mayor_que_la_mezcla",
            f"El relleno pide {pedido} globos chicos y la guirnalda compra {disponibles}.",
        )
    material = int(cast(int, relleno["material"]))
    tomados: dict[int, int] = {}
    falta = pedido
    for tamano in sorted({globos[i].tamano_pulg for i in chicos}):
        if falta <= 0:
            break
        del_tamano = [i for i in chicos if globos[i].tamano_pulg == tamano]
        # Primero el color del relleno; el resto, en proporción a lo que se compra.
        propios = [i for i in del_tamano if globos[i].material == material]
        otros = [i for i in del_tamano if globos[i].material != material]
        for i in propios:
            cantidad = min(falta, restantes[i])
            tomados[i] = tomados.get(i, 0) + cantidad
            restantes[i] -= cantidad
            falta -= cantidad
        disponible_otros = sum(restantes[i] for i in otros)
        cuota = min(falta, disponible_otros)
        for i, cantidad in zip(
            otros, _mayor_resto(cuota, [restantes[i] for i in otros]), strict=True
        ):
            if cantidad:
                tomados[i] = tomados.get(i, 0) + cantidad
                restantes[i] -= cantidad
        falta -= cuota
    return tuple((i, cantidad) for i, cantidad in sorted(tomados.items()) if cantidad)


def _tomar_remates(
    estructura: EstructuraGuirnalda,
    armado: Mapping[str, object],
    restantes: list[int],
    maximo_base: float,
) -> tuple[_Remate, ...]:
    globos = estructura.globos
    remates: list[_Remate] = []
    for remate in _remates(armado):
        material = int(cast(int, remate["material"]))
        posicion = str(remate["posicion"])
        grandes = sorted(
            (
                i
                for i, globo in enumerate(globos)
                if globo.material == material
                and globo.tamano_pulg > maximo_base
                and restantes[i] > 0
            ),
            key=lambda i: (-globos[i].tamano_pulg, i),
        )
        if not grandes:
            color = estructura.materiales[material].color or f"n.º {material + 1}"
            raise ArmadoInvalido(
                "remate_sin_globo_grande",
                f"El remate {color} necesita un globo más grande que los del racimo y la"
                " guirnalda ya no compra uno.",
            )
        tomados: list[tuple[int, int]] = []
        if posicion == "cada_n":
            for i in grandes:
                tomados.append((i, restantes[i]))
                restantes[i] = 0
        else:
            tomados.append((grandes[0], 1))
            restantes[grandes[0]] -= 1
        remates.append(_Remate(posicion, material, tuple(tomados)))
    return tuple(remates)


def _racimos(
    estructura: EstructuraGuirnalda, restantes: list[int], k: int
) -> tuple[tuple[tuple[int, ...], ...], tuple[tuple[int, int], ...], int]:
    """Racimos de izquierda a derecha con lo que queda, y los globos que sobran.

    Cada material lleva su propia fila de tamaños repartidos a lo largo. Sin
    patrón, los colores se reparten parejo por toda la guirnalda; con patrón,
    el racimo ``i`` toma los colores de la fila ``i`` del patrón expandido
    sobre los racimos que de verdad se arman (``filas_de_racimos``, E5), o, si
    no se puede, de la fila de la rejilla que le corresponde a lo largo. Si a
    un color ya no le quedan globos, la posición toma el color que más tenga
    (y se cuenta en ``fuera_de_patron``).
    """
    globos = estructura.globos
    pool = sum(restantes)
    cantidad = pool // k
    por_material: dict[int, list[int]] = {}
    for material in sorted({globo.material for globo in globos}):
        cuentas = [
            (i, restantes[i]) for i, globo in enumerate(globos) if globo.material == material
        ]
        por_material[material] = _esparcir([(i, c) for i, c in cuentas if c > 0])
    filas = estructura.filas_patron
    por_racimo = (
        estructura.filas_de_racimos(cantidad)
        if filas and estructura.filas_de_racimos is not None
        else None
    )
    if (
        por_racimo is not None
        and len(por_racimo) == cantidad
        and all(len(fila) == k for fila in por_racimo)
    ):
        deseados = [material for fila in por_racimo for material in fila]
    elif filas:
        deseados = [
            material
            for i in range(cantidad)
            for material in filas[((2 * i + 1) * len(filas)) // (2 * cantidad)]
        ]
    else:
        deseados = _esparcir(
            [(material, len(secuencia)) for material, secuencia in por_material.items()]
        )[: cantidad * k]
    fuera = 0
    posiciones: list[int] = []
    for material in deseados:
        secuencia = por_material.get(material)
        if not secuencia:
            fuera += 1
            material = min(
                (m for m, s in por_material.items() if s),
                key=lambda m: (-len(por_material[m]), m),
            )
            secuencia = por_material[material]
        posiciones.append(secuencia.pop(0))
    for i in posiciones:
        restantes[i] -= 1
    racimos = tuple(tuple(posiciones[r * k : (r + 1) * k]) for r in range(cantidad))
    sueltos = tuple((i, restantes[i]) for i in range(len(globos)) if restantes[i] > 0)
    for i, _c in sueltos:
        restantes[i] = 0
    return racimos, sueltos, fuera


def _repartir(estructura: EstructuraGuirnalda, armado: Mapping[str, object]) -> _Reparto:
    _validar_forma_y_soporte(estructura, armado)
    racimo = cast(Mapping[str, object], armado["racimo"])
    k = GLOBOS_POR_UNIDAD[str(racimo["unidad"])]
    minimo, maximo = _clase_base(int(cast(int, racimo["tamano_pulg_base"])))
    globos = estructura.globos
    if not any(minimo <= g.tamano_pulg <= maximo and g.por_instancia for g in globos):
        raise ArmadoInvalido(
            "racimo_sin_globos_base",
            f"La guirnalda no compra globos de {_pulgadas(float(cast(int, racimo['tamano_pulg_base'])))}"
            " para armar sus racimos.",
        )
    restantes = [globo.por_instancia for globo in globos]
    relleno_armado = armado.get("relleno")
    relleno = (
        _tomar_relleno(estructura, relleno_armado, restantes, minimo)
        if isinstance(relleno_armado, Mapping)
        else ()
    )
    remates = _tomar_remates(estructura, armado, restantes, maximo)
    if sum(restantes) < k:
        raise ArmadoInvalido(
            "guirnalda_sin_racimos",
            "Con el relleno y los remates no quedan globos para un solo racimo.",
        )
    racimos, sueltos, fuera = _racimos(estructura, restantes, k)
    usados = [0] * len(globos)
    for fila in racimos:
        for i in fila:
            usados[i] += 1
    for i, cantidad in (*relleno, *sueltos, *(g for r in remates for g in r.globos)):
        usados[i] += cantidad
    if usados != [globo.por_instancia for globo in globos]:
        raise ArmadoInvalido(
            "unidades_no_coinciden",
            "El armado no usa exactamente los globos que el plan compra.",
        )
    return _Reparto(k, racimos, relleno, remates, sueltos, fuera)


def validar(estructura: EstructuraGuirnalda, armado: Mapping[str, object]) -> None:
    """Valida el armado contra la guirnalda y lo que compra. ``ArmadoInvalido`` si no."""
    _repartir(estructura, armado)


def racimo_y_forma(armado: object) -> tuple[int | None, str | None]:
    """Lo que el patrón de color lee de un armado (E5): globos por racimo y forma.

    ``(None, None)`` sin armado. No valida: lo que no se reconoce es ``None``.
    """
    if not isinstance(armado, Mapping):
        return None, None
    racimo = armado.get("racimo")
    unidad = racimo.get("unidad") if isinstance(racimo, Mapping) else None
    forma = armado.get("forma")
    return (
        GLOBOS_POR_UNIDAD.get(unidad) if isinstance(unidad, str) else None,
        forma if isinstance(forma, str) else None,
    )


# --- Sugerencia (receta o lectura de la foto) ----------------------------------------------


def _base_sugerida(estructura: EstructuraGuirnalda) -> int | None:
    tamanos = {globo.tamano_pulg for globo in estructura.globos if globo.por_instancia}
    if 12.0 in tamanos:
        return 12
    if 11.0 in tamanos:
        return 11
    if any(9.0 <= tamano <= 10.0 for tamano in tamanos):
        return 9
    return None


def _unidad_sugerida(estructura: EstructuraGuirnalda) -> str | None:
    if estructura.k_patron is not None:
        return next((u for u, k in GLOBOS_POR_UNIDAD.items() if k == estructura.k_patron), None)
    return UNIDAD_POR_DENSIDAD.get(estructura.densidad, "cuarteto")


def _receta(estructura: EstructuraGuirnalda) -> dict[str, object] | None:
    if not estructura.es_guirnalda or estructura.total <= 0:
        return None
    base = _base_sugerida(estructura)
    unidad = _unidad_sugerida(estructura)
    if base is None or unidad is None:
        return None
    relleno: dict[str, object] | None = None
    if estructura.mezcla in MEZCLAS_ORGANICAS:
        por_material: dict[int, int] = {}
        for globo in estructura.globos:
            if globo.tamano_pulg <= TAMANO_RELLENO_RECETA_PULG and globo.por_instancia:
                por_material[globo.material] = por_material.get(globo.material, 0) + (
                    globo.por_instancia
                )
        if por_material:
            material = min(por_material, key=lambda m: (-por_material[m], m))
            proporcion = min(0.5, round(sum(por_material.values()) / estructura.total, 4))
            relleno = {"material": material, "proporcion": proporcion}
    _minimo, maximo = _clase_base(base)
    con_grandes = sorted(
        {g.material for g in estructura.globos if g.tamano_pulg > maximo and g.por_instancia}
    )
    return {
        "version": VERSION_ARMADO,
        "origen": "sugerido",
        "soporte": SOPORTE_POR_UBICACION.get(estructura.ubicacion, SOPORTE_POR_DEFECTO),
        "forma": "recta",
        "racimo": {"unidad": unidad, "tamano_pulg_base": base},
        "relleno": relleno,
        "remates": [{"material": m, "posicion": "cada_n"} for m in con_grandes[:MAX_REMATES]],
    }


def _metros_de(relativo: object, largo_m: float) -> float | None:
    """Una medida relativa al largo en metros, a centímetros y dentro del contrato (±5 m).

    ``None`` si no es un número, queda por debajo de ``MEDIDA_RELATIVA_MINIMA``
    o se redondea a cero.
    """
    if isinstance(relativo, bool) or not isinstance(relativo, (int, float)):
        return None
    if not math.isfinite(relativo) or abs(relativo) < MEDIDA_RELATIVA_MINIMA or largo_m <= 0:
        return None
    metros = (Decimal(str(relativo)) * Decimal(str(largo_m))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return max(-MAX_METROS_GEOMETRIA, min(MAX_METROS_GEOMETRIA, float(metros))) if metros else None


def geometria_de_lectura(lectura: Mapping[str, object], largo_m: float) -> dict[str, object]:
    """La forma, la caída y el desnivel que la foto dice, en metros sobre ``largo_m``.

    ADR-0032, decisión 26. La lectura (con confianza desde 0,5) trae medidas
    relativas al largo horizontal, nunca metros: ``caida_relativa`` (cuánto
    baja el centro bajo la recta que une los extremos) y ``desnivel_relativo``
    (el extremo derecho menos el izquierdo). Cuentan solo en una guirnalda que
    la foto ve en la pared o colgada (``SOPORTES_CON_CAIDA``) y desde
    ``MEDIDA_RELATIVA_MINIMA``. Una recta o una curva que cae pasa a
    ``arco_caido`` con su caída; una U invertida o un arco caído la llevan tal
    cual; una ondulada no (su onda no es una caída). El desnivel va en
    cualquier forma. ``largo_m`` es el tramo horizontal del plan, sea del
    cliente o no: la caída nunca lo cambia, solo alarga la cuerda. ``{}`` si
    no hay nada que medir. Puro: ``plan.py`` lo usa también para que el
    conteo de la foto compare con la cuerda que se va a comprar.
    """
    confianza = lectura.get("confianza")
    if (
        isinstance(confianza, bool)
        or not isinstance(confianza, (int, float))
        or confianza < CONFIANZA_MINIMA_LECTURA
        or lectura.get("soporte") not in SOPORTES_CON_CAIDA
        or lectura.get("forma") not in FORMAS
    ):
        return {}
    forma = str(lectura["forma"])
    caida = _metros_de(lectura.get("caida_relativa"), largo_m)
    desnivel = _metros_de(lectura.get("desnivel_relativo"), largo_m)
    if caida is not None and caida > 0 and forma in FORMAS_QUE_CAEN:
        forma = "arco_caido"
    geometria: dict[str, object] = {}
    if caida is not None and caida > 0 and forma in FORMAS_CON_CAIDA:
        geometria["caida_m"] = caida
    if desnivel is not None:
        geometria["desnivel_m"] = desnivel
    return {"forma": forma, **geometria} if geometria else {}


def _forma_desde_lectura(
    estructura: EstructuraGuirnalda, lectura: Mapping[str, object], receta: Mapping[str, object]
) -> dict[str, object]:
    """La receta con la forma que la foto dice: soporte, anfitriona, forma, anclajes y unidad.

    ``sobre_estructura`` solo si la anfitriona que la foto nombra
    (``anfitriona_element_id``) la materializa otra pieza del plan. Una forma
    que cuelga sin un soporte de donde colgar se queda recta, y una guirnalda
    colgada sin anclajes visibles cuelga de dos. La caída y el desnivel que la
    foto lee (relativos al largo) entran en metros con ``geometria_de_lectura``
    (decisión 26): alargan la cuerda, y ``plan.py`` cuenta sobre ella y compara
    el conteo de la foto (ADR-0031) con esa cuerda.
    """
    armado = dict(receta)
    armado["origen"] = "referencia"
    soporte = lectura.get("soporte")
    if soporte == "sobre_estructura":
        anfitriona = next(
            (
                otra
                for otra in estructura.otras
                if otra.referencia_element_id is not None
                and otra.referencia_element_id == lectura.get("anfitriona_element_id")
                and otra.tipo != "guirnalda"
            ),
            None,
        )
        if anfitriona is not None:
            armado["soporte"] = soporte
            armado["estructura_id"] = anfitriona.estructura_id
    elif soporte in SOPORTES:
        armado["soporte"] = soporte
    forma = lectura.get("forma")
    if forma in FORMAS and (
        forma not in FORMAS_CON_CAIDA or armado["soporte"] in SOPORTES_CON_CAIDA
    ):
        armado["forma"] = forma
    puntos = lectura.get("puntos_de_anclaje")
    if isinstance(puntos, int) and not isinstance(puntos, bool):
        armado["puntos_de_anclaje"] = puntos
    elif armado["soporte"] == "colgada":
        armado["puntos_de_anclaje"] = 2
    unidad = lectura.get("unidad_racimo")
    if unidad in UNIDADES and (
        estructura.k_patron is None or GLOBOS_POR_UNIDAD[str(unidad)] == estructura.k_patron
    ):
        armado["racimo"] = {**cast(Mapping[str, object], receta["racimo"]), "unidad": unidad}
    # Solo en pared o colgada, que es entonces el soporte leído: la receta no lo cambia.
    armado.update(geometria_de_lectura(lectura, estructura.largo_m))
    return armado


def _desde_lectura(
    estructura: EstructuraGuirnalda, lectura: Mapping[str, object], receta: Mapping[str, object]
) -> dict[str, object]:
    """La receta con todo lo que la foto dice (E4): la forma, el relleno y los remates.

    Forma de la lectura: ``LecturaGuirnaldaSchema`` (``src/lib/plan/armado-guirnalda.ts``,
    exportada en ``reference-blueprint.v2``). El relleno toma el material del
    color leído y su proporción (``null`` si la foto no muestra relleno); los
    remates, solo los de látex (un metalizado o una burbuja no se compra con la
    guirnalda), con el material de su color. ``racimos_visibles`` y
    ``colores_por_racimo`` no cambian el armado: el color de cada racimo es del
    patrón (E5). Lo que no se lee o no se compra se queda como en la receta.
    """
    armado = _forma_desde_lectura(estructura, lectura, receta)
    relleno = lectura.get("relleno")
    if relleno is None and "relleno" in lectura:
        armado["relleno"] = None
    elif isinstance(relleno, Mapping) and isinstance(relleno.get("color"), str):
        material = material_de_color(estructura.materiales, str(relleno["color"]))
        proporcion = relleno.get("proporcion")
        if material is not None and isinstance(proporcion, (int, float)):
            armado["relleno"] = {"material": material, "proporcion": min(0.5, float(proporcion))}
    remates: list[dict[str, object]] = []
    for remate in cast(list[Mapping[str, object]], lectura.get("remates") or []):
        if remate.get("clase", "latex") != "latex" or not isinstance(remate.get("color"), str):
            continue
        material = material_de_color(estructura.materiales, str(remate["color"]))
        if material is not None and remate.get("posicion") in POSICIONES_REMATE:
            remates.append({"material": material, "posicion": remate["posicion"]})
    if remates or lectura.get("remates") == []:
        armado["remates"] = remates[:MAX_REMATES]
    return armado


def sugerir_armado(
    estructura: EstructuraGuirnalda, lectura: Mapping[str, object] | None = None
) -> dict[str, object] | None:
    """Un armado que reparte exactamente lo que el plan compra, o ``None``.

    Sin ``lectura``, la receta del oficio: soporte por ubicación, forma recta
    (sin caída: el total no cambia), unidad por densidad (la del patrón, si lo
    hay), relleno de 5" en mezclas orgánicas y los globos grandes de remate
    repartidos. Con ``lectura`` confiable (E4, la lectura de la guirnalda en
    la foto) lo que ella diga manda; si su relleno o sus remates no se pueden
    armar con lo que se compra, se conserva al menos su forma (soporte, forma,
    unidad) con el relleno y los remates de la receta; si ni eso, la receta.
    ``None`` cuando ni la receta cabe (una mezcla sin globos de 9" a 12", un
    patrón con racimos de otra unidad): la guirnalda queda como hoy.
    """
    receta = _receta(estructura)
    if receta is None:
        return None
    candidatos: list[dict[str, object]] = []
    if (
        lectura is not None
        and float(cast(float, lectura.get("confianza", 0))) >= CONFIANZA_MINIMA_LECTURA
    ):
        candidatos.append(_desde_lectura(estructura, lectura, receta))
        candidatos.append(_forma_desde_lectura(estructura, lectura, receta))
    candidatos.append(receta)
    for armado in candidatos:
        try:
            validar(estructura, armado)
        except ArmadoInvalido:
            continue
        return armado
    return None


def opciones_admitidas(estructura: EstructuraGuirnalda) -> dict[str, object]:
    """Lo que el editor puede ofrecer para la pieza, decidido aquí (TypeScript no tiene reglas)."""
    anfitrionas = [
        otra.estructura_id
        for otra in estructura.otras
        if otra.tipo != "guirnalda" and otra.estructura_id != estructura.estructura_id
    ]
    tamanos = {g.tamano_pulg for g in estructura.globos if g.por_instancia}
    bases = [
        base
        for base in TAMANOS_BASE
        if any(_clase_base(base)[0] <= t <= _clase_base(base)[1] for t in tamanos)
    ]
    base = _base_sugerida(estructura)
    minimo, maximo = _clase_base(base) if base is not None else (0.0, math.inf)
    return {
        "soportes": [s for s in SOPORTES if s != "sobre_estructura" or anfitrionas],
        "anfitrionas": anfitrionas,
        "unidades": [
            u
            for u, k in GLOBOS_POR_UNIDAD.items()
            if (estructura.k_patron is None or k == estructura.k_patron) and estructura.total >= k
        ],
        "tamanos_base": bases,
        "materiales_relleno": sorted(
            {
                g.material
                for g in estructura.globos
                if g.por_instancia
                and g.tamano_pulg < minimo
                and g.tamano_pulg <= RELLENO_MAXIMO_PULG
            }
        ),
        "materiales_remate": sorted(
            {g.material for g in estructura.globos if g.por_instancia and g.tamano_pulg > maximo}
        ),
    }


# --- Resolución (lo que dibuja la hoja de armado) --------------------------------------------

_UNIDAD_ES = {
    "trio": ("trío", "tríos"),
    "cuarteto": ("cuarteto", "cuartetos"),
    "quinteto": ("quinteto", "quintetos"),
}
_TECNICA_UNIDAD = {
    "trio": "amarra una pareja y suma un tercer globo al nudo",
    "cuarteto": "amarra dos parejas y crúzalas",
    "quinteto": "amarra dos parejas, crúzalas y fija el quinto globo al centro",
}
_POSICION_ES = {
    "extremo_izq": "en el extremo izquierdo",
    "extremo_der": "en el extremo derecho",
    "centro": "al centro",
    "cada_n": "repartidos a lo largo",
}
_NOMBRE_SOPORTE = {
    "pared": "Guirnalda en pared",
    "colgada": "Guirnalda colgada",
    "piso": "Guirnalda en el piso",
    "mesa": "Guirnalda sobre la mesa",
}
_SOPORTE_ES = {
    "pared": "sobre la pared",
    "colgada": "colgada de sus puntos de anclaje",
    "piso": "apoyada en el piso",
    "mesa": "sobre la mesa",
}
_UNIDAD_EN = {
    "trio": ("three-balloon cluster", "three-balloon clusters", "three"),
    "cuarteto": ("four-balloon cluster", "four-balloon clusters", "four"),
    "quinteto": ("five-balloon cluster", "five-balloon clusters", "five"),
}
_ANFITRIONA_EN = {
    "arco": "balloon arch",
    "semiarco": "half balloon arch",
    "columna": "balloon column",
    "pared": "balloon wall",
    "centro_mesa": "balloon centerpiece",
    "backdrop": "backdrop",
    "escultura": "balloon sculpture",
    "kit": "balloon piece",
    "accesorio": "prop",
}
_POSICION_EN = {
    "extremo_izq": "at the left end",
    "extremo_der": "at the right end",
    "centro": "at the center",
}
_DIGITOS_EN = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")


def _descripcion(globo: GloboGuirnalda) -> str:
    color = " ".join(parte for parte in (globo.color, globo.acabado) if parte)
    tamano = globo.tamano_codigo or _pulgadas(globo.diam_entregado or globo.tamano_pulg)
    return " ".join(parte for parte in (tamano, color) if parte) or tamano


def _racimos_de_remate(posicion: str, cantidad: int, racimos: int) -> list[int]:
    if posicion == "extremo_izq":
        return [1] * cantidad
    if posicion == "extremo_der":
        return [racimos] * cantidad
    if posicion == "centro":
        return [(racimos + 1) // 2] * cantidad
    return [((2 * j + 1) * racimos) // (2 * cantidad) + 1 for j in range(cantidad)]


def _anfitriona(
    estructura: EstructuraGuirnalda, armado: Mapping[str, object]
) -> OtraEstructura | None:
    return next(
        (o for o in estructura.otras if o.estructura_id == armado.get("estructura_id")), None
    )


def _insumos(
    estructura: EstructuraGuirnalda,
    armado: Mapping[str, object],
    pegados: int,
) -> list[dict[str, object]]:
    soporte = str(armado["soporte"])
    largo = estructura.largo_cuerda_m
    reps = estructura.repeticiones
    puntos = armado.get("puntos_de_anclaje")
    insumos: list[dict[str, object]] = [
        {
            "insumo": "tira",
            "cantidad": _medio_metro(largo * _MARGEN_TIRA) * reps,
            "unidad": "m",
            "detalle": "tira perforada para armar la guirnalda: su largo más un 10 % para amarres",
            "estimado": False,
        }
    ]
    if soporte == "colgada":
        anclajes = int(cast(int, puntos))
        insumos.append(
            {
                "insumo": "cuerda",
                "cantidad": _medio_metro(largo + _BAJADA_CUERDA_M * anclajes) * reps,
                "unidad": "m",
                "detalle": "nailon o cuerda para colgarla: su largo más 1,5 m de bajada por anclaje",
                "estimado": True,
            }
        )
        insumos.append(
            {
                "insumo": "ganchos",
                "cantidad": anclajes * reps,
                "unidad": "ganchos",
                "detalle": "uno por punto de anclaje",
                "estimado": False,
            }
        )
    elif soporte == "pared":
        ganchos = (
            int(cast(int, puntos))
            if puntos is not None
            else max(2, math.ceil(largo / _SEPARACION_GANCHOS_M) + 1)
        )
        insumos.append(
            {
                "insumo": "ganchos",
                "cantidad": ganchos * reps,
                "unidad": "ganchos",
                "detalle": (
                    "ganchos adhesivos, uno por punto de anclaje"
                    if puntos is not None
                    else "ganchos adhesivos o pegante para pared, uno cada 50 cm"
                ),
                "estimado": False,
            }
        )
    elif soporte == "piso":
        insumos.append(
            {
                "insumo": "pesa",
                "cantidad": max(2, math.ceil(largo / _SEPARACION_PESAS_M) + 1) * reps,
                "unidad": "pesas",
                "detalle": "pesas pequeñas a lo largo para que la guirnalda no ruede",
                "estimado": False,
            }
        )
    elif soporte == "sobre_estructura":
        insumos.append(
            {
                "insumo": "amarres",
                "cantidad": (math.ceil(largo / _SEPARACION_GANCHOS_M) + 1) * reps,
                "unidad": "amarres",
                "detalle": "cintillos o amarres a la pieza anfitriona, uno cada 50 cm",
                "estimado": False,
            }
        )
    puntos_pegante = pegados + (2 if soporte == "mesa" else 0)
    if puntos_pegante:
        insumos.append(
            {
                "insumo": "pegante",
                "cantidad": puntos_pegante * reps,
                "unidad": "puntos",
                "detalle": "puntos de pegamento para el relleno, los remates y los globos sueltos"
                + (" y los extremos sobre la mesa" if soporte == "mesa" else ""),
                "estimado": True,
            }
        )
    insumos.append(
        {"insumo": "tijeras", "cantidad": 1, "unidad": "tijeras", "detalle": "", "estimado": False}
    )
    insumos.append(
        {
            "insumo": "bomba",
            "cantidad": 1,
            "unidad": "bomba",
            "detalle": "infladora con calibrador de tamaños",
            "estimado": False,
        }
    )
    return insumos


def _duracion(
    estructura: EstructuraGuirnalda, soporte: str, racimos: int, pegados: int
) -> dict[str, object]:
    lento, rapido = RACIMOS_POR_HORA
    pegado_lento, pegado_rapido = GLOBOS_PEGADOS_POR_HORA
    instalar_min, instalar_max = INSTALACION_HORAS[soporte]
    reps = estructura.repeticiones
    minimo = reps * (racimos / rapido + pegados / pegado_rapido + instalar_min)
    maximo = reps * (racimos / lento + pegados / pegado_lento + instalar_max)
    horas_min = max(0.25, _cuarto(minimo, ROUND_FLOOR))
    return {
        "horas_min": horas_min,
        "horas_max": max(horas_min, _cuarto(maximo, ROUND_CEILING)),
        "estimado": True,
    }


def _colores_lora(nombres: Sequence[str]) -> str:
    distintos = list(dict.fromkeys(nombres))
    if len(distintos) > 4:
        cuantos = _DIGITOS_EN[len(distintos)] if len(distintos) < 10 else "many"
        return f"a mix of {cuantos} colors"
    return str(lista_en(distintos))


def _frases_prompt(
    estructura: EstructuraGuirnalda,
    armado: Mapping[str, object],
    reparto: _Reparto,
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)``: inglés; LoRA en ASCII y sin cifras."""
    globos = estructura.globos
    soporte = str(armado["soporte"])
    forma = str(armado["forma"])
    racimo = cast(Mapping[str, object], armado["racimo"])
    unidad = str(racimo["unidad"])
    base = float(cast(int, racimo["tamano_pulg_base"]))
    caida = armado.get("caida_m")
    puntos = armado.get("puntos_de_anclaje")
    tramos = max(1, int(cast(int, puntos)) - 1) if puntos is not None else 1
    anfitriona = _anfitriona(estructura, armado)
    anfitriona_en = _ANFITRIONA_EN.get(anfitriona.tipo, "structure") if anfitriona else "structure"

    en_racimos: dict[int, int] = {}
    for fila in reparto.racimos:
        for i in fila:
            en_racimos[globos[i].material] = en_racimos.get(globos[i].material, 0) + 1
    materiales = sorted(en_racimos, key=lambda m: (-en_racimos[m], m))

    def color(material: int, *, lora: bool) -> str:
        # Named by what is bought (the legend's line), like the pattern (ADR-0028 §8).
        globo = next((g for g in globos if g.material == material), None)
        datos = estructura.materiales[material]
        nombre, acabado = (globo.color, globo.acabado) if globo else (datos.color, datos.acabado)
        return str(nombre_color_en(nombre) if lora else color_con_acabado_en(nombre, acabado))

    soporte_en = {
        "pared": "an organic balloon garland mounted flat against the wall",
        "colgada": (
            f"an organic balloon garland hung from {int(cast(int, puntos))} anchor points"
            if puntos is not None
            else "an organic balloon garland hung between anchor points"
        ),
        "piso": "an organic balloon garland resting on the floor along the front",
        "mesa": "an organic balloon garland running along the table edge",
        "sobre_estructura": (
            f"an organic balloon garland wrapped around the {anfitriona_en}, following its shape"
        ),
    }[soporte]
    caida_en = f" about {float(cast(float, caida)):g} m deep" if caida is not None else ""
    forma_en = {
        "recta": "running straight along its length",
        "curva": "following a gentle curve",
        "ondulada": "rising and falling in a soft wave along its length",
        "arco_caido": (
            f"dipping between its anchor points in {_plural(tramos, 'swag', 'swags')}{caida_en}"
        ),
        "u_invertida": "shaped as an inverted U"
        + (f" whose sides drop about {float(cast(float, caida)):g} m" if caida is not None else ""),
    }[forma]
    cantidad = len(reparto.racimos)
    frases = [
        # Sobre otra pieza la guirnalda sigue la forma de su anfitriona.
        f"GARLAND ASSEMBLY — {soporte_en}."
        if soporte == "sobre_estructura"
        else f"GARLAND ASSEMBLY — {soporte_en}, {forma_en}.",
        f"Build it from {_plural(cantidad, *_UNIDAD_EN[unidad][:2])} of {_pulgadas(base)} balloons in "
        + lista_en([color(m, lora=False) for m in materiales])
        + ", chained from the left end to the right end.",
    ]
    relleno_materiales: list[int] = []
    if reparto.relleno:
        relleno_materiales = list(dict.fromkeys(globos[i].material for i, _c in reparto.relleno))
        tamanos = sorted({globos[i].tamano_pulg for i, _c in reparto.relleno})
        frases.append(
            f"Tuck small {' and '.join(_pulgadas(t) for t in tamanos)} "
            + lista_en([color(m, lora=False) for m in relleno_materiales])
            + " filler balloons into the gaps between the clusters."
        )
    remates_en: list[str] = []
    for remate in reparto.remates:
        tamano = " and ".join(
            dict.fromkeys(_pulgadas(globos[i].tamano_pulg) for i, _c in remate.globos)
        )
        total = sum(c for _i, c in remate.globos)
        nombre = f"{color(remate.material, lora=False)} balloon"
        if remate.posicion == "cada_n":
            cada = max(1, _redondear(cantidad / total))
            remates_en.append(
                f"large {tamano} {nombre}s spaced along it, about one every"
                f" {_plural(cada, 'cluster', 'clusters')}"
                if total > 1
                else f"one large {tamano} {nombre} along it"
            )
        else:
            remates_en.append(f"a large {tamano} {nombre} {_POSICION_EN[remate.posicion]}")
    if remates_en:
        frases.append("Accents: " + "; ".join(remates_en) + ".")
    frases.append(
        "Keep the clusters tight and twisted against each other so the garland reads as one"
        " continuous organic piece with no gaps."
    )

    extras_lora: list[str] = []
    if relleno_materiales:
        extras_lora.append(
            f"small {_colores_lora([color(m, lora=True) for m in relleno_materiales])}"
            " filler balloons"
        )
    if reparto.remates:
        grandes = list(dict.fromkeys(color(r.material, lora=True) for r in reparto.remates))
        extras_lora.append(f"large {_colores_lora(grandes)} accent balloons")
    anclajes = int(cast(int, puntos)) if puntos is not None else None
    return " ".join(frases), _frase_lora(
        soporte, forma, anclajes, anfitriona_en, unidad, extras_lora
    )


def _frase_lora(
    soporte: str,
    forma: str,
    anclajes: int | None,
    anfitriona_en: str,
    unidad: str,
    extras: Sequence[str],
) -> str:
    """Fragmento LoRA del armado: un modificador de la guirnalda, nunca otra guirnalda (E5).

    El compilador del caption ya escribe "an organic balloon garland" con sus
    materiales (y sus colores) y pone esta frase detrás, tal cual, como la del
    patrón de color. Empezar por el sustantivo nombraba dos guirnaldas
    seguidas, el mismo fallo que tuvo el bouquet. Lleva el soporte ("draped
    between two anchor points", "resting on the floor along the front",
    "running along the table edge", "wrapped around the balloon arch",
    "mounted flat against the wall"), la forma, la unidad del racimo y, con sus
    colores, el relleno y los remates. ASCII y sin cifras (ADR-0028 §8): el
    número de anclajes va en palabras.
    """
    if soporte == "colgada":
        puntos = anclajes if anclajes is not None else 2
        soporte_lora = (
            "draped between two anchor points"
            if puntos == 2
            else f"draped across {_DIGITOS_EN[puntos]} anchor points"
        )
    else:
        soporte_lora = {
            "pared": "mounted flat against the wall",
            "piso": "resting on the floor along the front",
            "mesa": "running along the table edge",
            "sobre_estructura": f"wrapped around the {anfitriona_en}",
        }[soporte]
    # Sobre otra pieza la guirnalda sigue la forma de su anfitriona.
    forma_lora = (
        ""
        if soporte == "sobre_estructura"
        else {
            "recta": "",
            "curva": " in a gentle curve",
            "ondulada": " in a soft wave",
            "arco_caido": " dipping in swags",
            "u_invertida": " shaped as an inverted U",
        }[forma]
    )
    lora = f"{soporte_lora}{forma_lora} in clusters of {_UNIDAD_EN[unidad][2]}"
    if extras:
        lora += " with " + " and ".join(extras)
    return _ascii_sin_cifras(lora)


def _desnivel(armado: Mapping[str, object]) -> float | None:
    desnivel = armado.get("desnivel_m")
    if isinstance(desnivel, bool) or not isinstance(desnivel, (int, float)) or not desnivel:
        return None
    return float(desnivel)


def _desnivel_es(armado: Mapping[str, object]) -> str:
    """ "el extremo derecho 0,4 m más bajo que el izquierdo", o vacío sin desnivel."""
    desnivel = _desnivel(armado)
    if desnivel is None:
        return ""
    metros = f"{abs(desnivel):g}".replace(".", ",")
    return (
        f"el extremo derecho {metros} m más {'bajo' if desnivel < 0 else 'alto'} que el izquierdo"
    )


def _frase_desnivel(armado: Mapping[str, object]) -> str:
    """La línea del desnivel para Uzume (decisión 26), aparte de ``_frases_prompt``; vacía sin él.

    Va detrás de las frases del armado, tal cual. El fragmento LoRA no la
    lleva: ni v007 ni v004 aprendieron el desnivel y no admite cifras.
    """
    desnivel = _desnivel(armado)
    if desnivel is None:
        return ""
    bajo, alto = ("right", "left") if desnivel < 0 else ("left", "right")
    return (
        f"Its {bajo} end hangs about {abs(desnivel):g} m lower than its {alto} end,"
        f" so the garland slopes down toward the {bajo}."
    )


def armado_resuelto(
    estructura: EstructuraGuirnalda, armado: Mapping[str, object]
) -> dict[str, object]:
    """``armados_guirnalda[i]`` de ``plan-resuelto.v1``. ``ArmadoInvalido`` si no vale."""
    reparto = _repartir(estructura, armado)
    globos = estructura.globos
    reps = estructura.repeticiones
    orden = sorted(
        (i for i, globo in enumerate(globos) if globo.por_instancia),
        key=lambda i: (globos[i].material, globos[i].tamano_pulg, i),
    )
    codigo = {i: posicion + 1 for posicion, i in enumerate(orden)}
    leyenda = [
        {
            "codigo": codigo[i],
            "material": globos[i].material,
            "product_id": globos[i].product_id,
            "variant_id": globos[i].variant_id,
            "descripcion": _descripcion(globos[i]),
            "color": globos[i].color,
            "acabado": globos[i].acabado,
            "tamano_pulg": globos[i].diam_entregado or globos[i].tamano_pulg,
            "unidades_por_instancia": globos[i].por_instancia,
            "unidades_total": globos[i].por_instancia * reps,
        }
        for i in orden
    ]
    racimo = cast(Mapping[str, object], armado["racimo"])
    unidad = str(racimo["unidad"])
    base = float(cast(int, racimo["tamano_pulg_base"]))
    cantidad = len(reparto.racimos)
    racimos = [
        {"numero": numero, "codigos": [codigo[i] for i in fila]}
        for numero, fila in enumerate(reparto.racimos, start=1)
    ]
    relleno_armado = armado.get("relleno")
    relleno_total = sum(c for _i, c in reparto.relleno)
    relleno = (
        {
            "material": int(cast(int, relleno_armado["material"])),
            "total": relleno_total,
            "codigos": [{"codigo": codigo[i], "cantidad": c} for i, c in reparto.relleno],
        }
        if isinstance(relleno_armado, Mapping)
        else None
    )
    remates: list[dict[str, object]] = []
    for remate in reparto.remates:
        total = sum(c for _i, c in remate.globos)
        lugares = _racimos_de_remate(remate.posicion, total, cantidad)
        desde = 0
        for i, c in remate.globos:
            remates.append(
                {
                    "posicion": remate.posicion,
                    "codigo": codigo[i],
                    "cantidad": c,
                    "racimos": lugares[desde : desde + c],
                }
            )
            desde += c
    sueltos = [{"codigo": codigo[i], "cantidad": c} for i, c in reparto.sueltos]
    remates_total = sum(cast(int, r["cantidad"]) for r in remates)
    sueltos_total = sum(c for _i, c in reparto.sueltos)
    pegados = relleno_total + remates_total + sueltos_total
    soporte = str(armado["soporte"])
    anfitriona = _anfitriona(estructura, armado)
    nombre_codigo = {entrada["codigo"]: entrada["descripcion"] for entrada in leyenda}
    singular, plural = _UNIDAD_ES[unidad]

    def codigos_es(pares: Sequence[tuple[int, int]]) -> str:
        return ", ".join(f"{c} de {nombre_codigo[codigo[i]]} ({codigo[i]})" for i, c in pares)

    caida = armado.get("caida_m")
    puntos = armado.get("puntos_de_anclaje")
    pasos = [
        f"Infla y calibra los {estructura.total} globos de cada guirnalda según la leyenda.",
        f"Arma {_plural(cantidad, singular, plural)} de {_pulgadas(base)}: {_TECNICA_UNIDAD[unidad]}."
        " Cada racimo lleva los códigos de la gráfica.",
        f"Pasa los racimos por la tira en orden, del 1 (extremo izquierdo) al {cantidad}"
        " (extremo derecho), girando cada uno un cuarto de vuelta respecto del anterior.",
    ]
    if relleno is not None:
        pasos.append(
            f"Relleno: pega los {relleno_total} globos chicos en los huecos entre racimos,"
            f" repartidos parejo: {codigos_es(reparto.relleno)}."
        )
    for entrada in remates:
        sitios = [str(r) for r in sorted(set(cast(list[int], entrada["racimos"])))]
        donde = (
            _POSICION_ES[str(entrada["posicion"])]
            if entrada["posicion"] != "cada_n"
            else f"junto al racimo {sitios[0]}"
            if len(sitios) == 1
            else f"junto a los racimos {', '.join(sitios[:-1])} y {sitios[-1]}"
        )
        pasos.append(
            f"Remate: {_plural(cast(int, entrada['cantidad']), 'globo', 'globos')}"
            f" {nombre_codigo[cast(int, entrada['codigo'])]} ({entrada['codigo']}) {donde}."
        )
    if reparto.sueltos:
        pasos.append(
            f"Reparte los globos sueltos entre los racimos para cerrar huecos: {codigos_es(reparto.sueltos)}."
        )
    caida_es = (
        f", con una caída de {float(cast(float, caida)):g} m".replace(".", ",") if caida else ""
    )
    if _desnivel_es(armado):
        caida_es += (" y " if caida_es else ", con ") + _desnivel_es(armado)
    pasos.append(
        {
            "pared": "Fija la guirnalda a la pared de izquierda a derecha con ganchos o pegante"
            + caida_es
            + ".",
            "colgada": f"Cuélgala de sus {puntos} puntos de anclaje con la cuerda" + caida_es + ".",
            "piso": "Apóyala en el piso a lo largo del frente y asegúrala con las pesas.",
            "mesa": "Apóyala a lo largo del borde de la mesa y fija los extremos con pegante.",
            "sobre_estructura": "Amárrala a "
            + (anfitriona.nombre if anfitriona else "la pieza anfitriona")
            + " cada 50 cm, siguiendo su forma.",
        }[soporte]
    )

    avisos: list[str] = []
    if sueltos_total:
        avisos.append(
            f"Sobra 1 globo que no completa un {singular}: va suelto entre los racimos."
            if sueltos_total == 1
            else f"Sobran {sueltos_total} globos que no completan un {singular}: van sueltos"
            " entre los racimos."
        )
    if str(armado["forma"]) in FORMAS_CON_CAIDA and caida is None:
        avisos.append(
            "Sin caída la guirnalda se cuenta con su largo recto: indica cuánto baja el centro"
            " para contar el largo real de la cuerda."
        )
    if reparto.fuera_de_patron:
        avisos.append(
            f"{_plural(reparto.fuera_de_patron, 'globo', 'globos')} de los racimos no siguen el"
            " patrón: su color ya se usó en el relleno o los remates."
        )

    nombre = (
        f"Guirnalda sobre {anfitriona.nombre}"
        if soporte == "sobre_estructura" and anfitriona is not None
        else _NOMBRE_SOPORTE.get(soporte, "Guirnalda")
    )
    detalles = [
        f"{_plural(cantidad, singular, plural)} de {_pulgadas(base)} de izquierda a derecha"
    ]
    if relleno is not None:
        detalles.append(f"relleno de {relleno_total} globos chicos")
    if remates_total:
        detalles.append(f"{_plural(remates_total, 'globo grande', 'globos grandes')} de remate")
    lugar = (
        f"abrazada a {anfitriona.nombre}"
        if soporte == "sobre_estructura" and anfitriona is not None
        else _SOPORTE_ES.get(soporte, "")
    )
    descripcion = (
        (", ".join(detalles[:-1]) + (" y " if len(detalles) > 1 else "") + detalles[-1])
        + (f", {lugar}" if lugar else "")
        + "."
    )
    prompt_gemini, prompt_lora = _frases_prompt(estructura, armado, reparto)
    prompt_gemini = " ".join(f for f in (prompt_gemini, _frase_desnivel(armado)) if f)
    return {
        "estructura_id": estructura.estructura_id,
        "armado": dict(armado),
        "repeticiones": reps,
        "largo_m": round(estructura.largo_m, 2),
        "largo_cuerda_m": round(estructura.largo_cuerda_m, 2),
        "globos_por_instancia": estructura.total,
        "leyenda": leyenda,
        "racimos": racimos,
        "relleno": relleno,
        "remates": remates,
        "sueltos": sueltos,
        "insumos": _insumos(estructura, armado, pegados),
        "duracion_estimada": _duracion(estructura, soporte, cantidad, pegados),
        "nombre": nombre,
        "descripcion": descripcion[:1].upper() + descripcion[1:],
        "pasos": pasos,
        "avisos": avisos,
        "prompt_gemini": prompt_gemini,
        "prompt_lora": prompt_lora,
    }


__all__ = [
    "ArmadoInvalido",
    "EstructuraGuirnalda",
    "FORMAS",
    "FORMAS_CON_CAIDA",
    "GloboGuirnalda",
    "OtraEstructura",
    "SOPORTES",
    "UNIDADES",
    "VERSION_ARMADO",
    "armado_resuelto",
    "geometria_de_lectura",
    "opciones_admitidas",
    "racimo_y_forma",
    "sugerir_armado",
    "validar",
]
