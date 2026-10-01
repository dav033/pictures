"""Dónde queda cada globo de un patrón de color, sobre la silueta real de la pieza.

Fase 2 del motor de silueta (``app.silueta``). La gráfica del patrón dibuja hoy
una rejilla de filas × columnas que es la misma para una pared que para una
guirnalda; aquí se convierte esa rejilla en las POSICIONES reales de los globos
de la pieza, en metros, para que la interfaz las dibuje tal cual.

Es **solo dibujo**. Tres cosas no cambian y están garantizadas por construcción,
no por buena voluntad:

* **El conteo no se recalcula.** Las cantidades por tamaño y por color salen de
  la matriz tamaño × material que ya armó ``plan.py`` (``_pattern_matrix``, el
  mismo despiece que se compra). Las sumas de sus filas son los ``cupos`` de la
  silueta —así hay exactamente una posición por globo cotizado— y las sumas de
  sus columnas son ``conteo_por_instancia``, el conteo por color de hoy. El
  color se REASIGNA sobre otras posiciones; nadie vuelve a contar.
* **``plan_hash`` no cambia.** Esto vive en ``plan_resuelto.patrones_color[]``,
  que ``plan.py`` añade DESPUÉS de firmar ``{plan, snapshot}`` y fuera del
  snapshot (ADR-0028 decisión 5). Añadir campos ahí no puede tocar la firma.
* **Si falta un dato, no hay falla.** Cualquier pieza que no se pueda armar
  —tipo sin silueta, medidas ausentes, presupuesto agotado— devuelve un
  ``Croquis`` sin posiciones y con el MOTIVO, y la interfaz sigue con la rejilla
  de siempre. La degradación es correcta; lo que no puede ser es invisible, así
  que el motivo viaja en el patrón resuelto (``sin_silueta``) y de ahí al log.

El grosor VISIBLE de la banda (lo que mide de ancho un arco orgánico al mirarlo)
no tiene dueño en el repositorio: el ``_BAND_WIDTH`` de ``plan.py`` es la tira
delgada cuya área, por λ, da el conteo, y λ absorbe la profundidad. Aquí se usa
un valor de DIBUJO derivado de las medidas de la pieza, marcado como estético
(``_GROSOR_*``); no entra en el conteo, en el despiece ni en la cotización.
"""

from __future__ import annotations

import dataclasses
import hashlib
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, cast

from app.arco_clasico import Arco, ArcoArmado, ArcoInvalido
from app.arco_clasico import arco_de_densidad as arco_clasico_de_densidad
from app.arco_clasico import armar as armar_arco_clasico
from app.columna_clasica import Columna, ColumnaArmada, ColumnaInvalida
from app.columna_clasica import armar as armar_columna_clasica
from app.columna_clasica import columna_de_densidad as columna_clasica_de_densidad
from app.generated_models import contract_schema
from app.silueta import (
    ESTILO,
    Cupo,
    Disposicion,
    GloboSilueta,
    Medidas,
    Peticion,
    SiluetaInvalida,
    TipoSilueta,
    disponer,
)

# --- Presupuesto de dibujo ----------------------------------------------------

#: Vueltas de relajación con que se arma el croquis de la gráfica. El motor usa
#: 48 por defecto, que es lo que vale la pena para dibujar UNA pieza a pedido;
#: aquí se arma una por estructura dentro de cada resolución del plan, así que
#: 16 es el presupuesto. Medido en esta máquina (2026-09-29): una pared de 600
#: globos tarda 2,6 s con 48 vueltas y 0,68 s con 16, con el mismo número de
#: globos encimados (cero) y la misma ocupación. Es una perilla de forma del
#: motor, no una regla comercial: no cambia cuántos globos hay ni de qué color.
_VUELTAS_GRAFICA = 16

#: Globos por instancia que se dibujan desde la silueta. Por encima de esto la
#: pieza se queda con la rejilla de siempre.
#:
#: 420 dejaba fuera el caso corriente: una pared orgánica de 2,4 x 2,4 m con la
#: mezcla `organica_fina` lleva 483 globos y se quedaba sin croquis, que es
#: justo la pieza para la que se hizo (2026-09-29, foto "Mr & Mrs" del usuario).
#:
#: Vuelto a medir el mismo día en la máquina del usuario, con carga real y no en
#: reposo: 420 globos 1,5 s · 483 2,0 s · 600 2,8 s · 700 3,7 s · 900 5,5 s —
#: unas cuatro veces lo que dio la primera medida. 600 cubre una pared grande y
#: cuesta ~2,8 s la PRIMERA vez; después el croquis se recuerda por petición
#: (``_disponer_recordado``) y cada repintado son 1-2 ms. El motor admite hasta
#: 1600 (``silueta.MAX_GLOBOS``), pero eso pasa de 5 s dentro de la resolución.
#:
#: Subido a 700 el 2026-09-30: el tope se calibró contra la pared INTERIOR y una
#: pared EXTERIOR de 3 × 2,4 m con densidad lujosa y mezcla `organica_fina`
#: cuenta 603 globos — tres por encima. Se quedaba sin croquis y la gráfica
#: volvía a la rejilla genérica, que es un damero regular: lo peor que se le
#: puede enseñar al generador de una pared orgánica, y justo la pieza donde más
#: falta hace. 700 cubre esa pared y cuesta 3,45 s la primera vez (medido).
MAX_GLOBOS_PIEZA = 700

#: Globos que puede dibujar una resolución completa, sumando todas sus piezas.
#: Dos piezas grandes, no una. Una propuesta con cuatro paredes dibuja las
#: primeras y las demás se quedan con la rejilla (con su motivo en el log), en
#: vez de que el plan entero tarde diez segundos más. Con las medidas de arriba
#: son ~7,4 s en el peor caso, y solo la primera vez que se dibuja cada pieza.
PRESUPUESTO_GLOBOS = 1400


#: Por qué una pieza se quedó sin croquis y la gráfica sigue con su rejilla.
#: Cada valor descarta una causa distinta al leer el log: el tipo (un aro, un
#: centro de mesa), una medida que el plan no declara, el tamaño de la pieza, el
#: presupuesto que se gastaron las piezas anteriores, el motor y un despiece que
#: no corresponde con la rejilla. Son los valores del contrato
#: (``patron-color.v1``, ``sin_silueta``): cambiarlos es cambiarlo.
MotivoSinSilueta = Literal[
    "tipo_sin_silueta",
    "medidas_incompletas",
    "pieza_muy_grande",
    "presupuesto_agotado",
    "motor_rechazo",
    "despiece_incoherente",
]


@dataclass(frozen=True, slots=True)
class Croquis:
    """El croquis de una pieza, o por qué no lo hay. Nunca las dos cosas."""

    posiciones: list[dict[str, object]] | None
    motivo: MotivoSinSilueta | None


def _sin_croquis(motivo: MotivoSinSilueta) -> Croquis:
    return Croquis(posiciones=None, motivo=motivo)


class PresupuestoGrafica:
    """Cuántos globos le queda por dibujar a una resolución.

    Uno por resolución: el orden en que se gasta es el de las estructuras del
    plan, así que dos resoluciones del mismo plan dibujan las mismas piezas.
    """

    __slots__ = ("restante",)

    def __init__(self, globos: int = PRESUPUESTO_GLOBOS) -> None:
        self.restante = globos

    def motivo(self, globos: int) -> MotivoSinSilueta | None:
        """Por qué no alcanza para ``globos``, o ``None`` si alcanza."""
        if globos > MAX_GLOBOS_PIEZA:
            return "pieza_muy_grande"
        return "presupuesto_agotado" if globos > self.restante else None

    def gastar(self, globos: int) -> None:
        self.restante = max(0, self.restante - globos)


#: Croquis que se recuerdan a la vez. Las posiciones no dependen del color: la
#: vista previa del editor vuelve a pedir la MISMA pieza (mismo tipo, mismas
#: medidas, mismos cupos) con otro patrón en cada toque, y armarla otra vez
#: costaba el precio entero cada vez; por eso el editor se había quedado con la
#: rejilla genérica. Se recuerda por ``Peticion``, que es todo lo que el motor
#: mira, así que un cambio de medidas, de tamaño de racimo o de despiece es una
#: petición distinta y se vuelve a armar.
#:
#: Medido en esta máquina (2026-09-29, ocho toques por caso, cambiando solo el
#: color, con ``_VUELTAS_GRAFICA``). Coste por toque, sin recordar → recordando:
#: arco 200 globos 135 ms → 1,7 ms · 300 243 ms → 1,3 ms · 420 674 ms → 1,8 ms;
#: pared 200 94 ms → 0,7 ms · 420 537 ms → 1,5 ms; columna 200 333 ms → 1,1 ms ·
#: 420 878 ms → 2,0 ms. El primer croquis de una pieza sigue costando lo mismo
#: (81–817 ms según el tipo y el tamaño); lo que desaparece es pagarlo en cada
#: toque. Una pieza que el plan ya dibujó llega recordada al editor: la petición
#: es la misma.
#:
#: Con 32 entradas cabe la pieza que se está editando y las de la última
#: resolución; cada una son como mucho ``MAX_GLOBOS_PIEZA`` globos inmutables.
_CROQUIS_RECORDADOS = 32


@lru_cache(maxsize=_CROQUIS_RECORDADOS)
def _disponer_recordado(peticion: Peticion) -> Disposicion:
    """``silueta.disponer`` recordado por petición.

    ``Disposicion`` y todo lo que cuelga de ella son inmutables, así que la
    misma se puede entregar a dos llamadores; aquí solo se lee. No es una regla
    comercial ni cambia lo que el motor coloca: la misma petición da el mismo
    croquis, recordado o no (``test_el_croquis_es_determinista``).
    """
    return disponer(peticion)


# --- Grosor visible de la banda (estética) ------------------------------------

#: Fracción de la medida menor de la pieza que mide de ancho la banda de un arco
#: o un semiarco al VERLO, acotada al rango del oficio. Estética: un arco
#: orgánico se lee con 0,6–1,1 m de banda y con 0,29 m (la tira del conteo) se
#: leería como un alambre. No entra en ningún número que se cobre.
_GROSOR_BANDA = 0.22
_GROSOR_BANDA_MIN = 0.35
_GROSOR_BANDA_MAX = 1.00
#: Lo mismo para una guirnalda, sobre su largo: una tira de 6 m se ve con unos
#: 0,4 m de banda.
_GROSOR_GUIRNALDA = 0.07
_GROSOR_GUIRNALDA_MIN = 0.22
_GROSOR_GUIRNALDA_MAX = 0.60
#: Una columna sin ancho declarado. El ancho declarado, cuando está, ES el
#: grosor de su banda: no hay nada que inventar.
_GROSOR_COLUMNA_M = 0.40
#: Cuánto se afina la banda en la punta cuando la estructura oficial no declara
#: su ``anchoFinalBanda``. Estética.
_AFINADO_DIBUJO = 0.62

#: Geometría de las estructuras oficiales, del contrato (dueño:
#: ``src/lib/plan/estructuras-oficiales.ts``), igual que la lee ``plan.py``.
#: De aquí sale ``anchoFinalBanda``, que ya es la razón entre el ancho final de
#: la banda y el de su arranque: el afinado de la punta no se inventa cuando la
#: estructura oficial lo declara.
_GEOMETRIA_OFICIAL: dict[str, dict[str, object]] = cast(
    dict[str, dict[str, object]],
    contract_schema("PlanDecoracion").get("x-geometria-estructuras-oficiales", {}),
)

#: Tipos del plan que el motor sabe dibujar, con su silueta. Una pared se
#: reparte aparte (densa u orgánica, según la estructura oficial).
_TIPO_SILUETA: dict[str, TipoSilueta] = {
    "arco": "arco",
    "semiarco": "semiarco",
    "columna": "columna",
    "guirnalda": "guirnalda",
}
#: Estructuras oficiales cuya forma el motor no dibuja: un aro es una
#: circunferencia cerrada y el motor solo tiene medio arco abierto. Dibujarlo
#: como un arco sería peor que la rejilla de hoy.
_OFICIALES_SIN_SILUETA = frozenset({"aro_circular"})
#: La pared que se arma con borde vivo. Las demás son un rectángulo limpio.
_OFICIAL_PARED_ORGANICA = "pared_organica"
_TIPOS_PARED: frozenset[TipoSilueta] = frozenset({"pared_densa", "pared_organica"})


@dataclass(frozen=True, slots=True)
class PiezaSilueta:
    """Lo que hace falta de una estructura del plan para armar su croquis.

    Solo geometría declarada. Ni cantidades, ni precios, ni colores: eso entra
    por la matriz del despiece y por la rejilla del patrón.
    """

    estructura_id: str
    tipo: str
    estructura_oficial: str | None = None
    ancho_m: float = 0.0
    alto_m: float = 0.0
    largo_m: float = 0.0
    #: Armado de una guirnalda (ADR-0032): su forma, su caída y sus anclajes.
    forma_guirnalda: str | None = None
    caida_m: float | None = None
    anclajes: int | None = None
    #: Densidad comercial de un **arco clásico**, y solo de él: es lo que
    #: traduce ``arco_clasico.ARMADO_POR_DENSIDAD`` a globos por anillo y
    #: separación entre anillos. Va la densidad y no las dos perillas para que
    #: el armado siga teniendo un solo dueño. ``None`` en todo lo demás, y
    #: entonces el croquis sale del motor de silueta de siempre.
    densidad_arco: str | None = None
    #: Densidad comercial de una **columna clásica**, y solo de ella: es lo
    #: que traduce ``columna_clasica.ARMADO_POR_DENSIDAD`` a globos por capa
    #: y alto de capa. Va la densidad y no las dos perillas por lo mismo que
    #: en el arco: para que el armado siga teniendo un solo dueño. ``None``
    #: en todo lo demás, y entonces el croquis sale del motor orgánico.
    densidad_columna: str | None = None
    #: Cómo se monta un **arco clásico**: banda escalonada (el de siempre) o
    #: anillos iguales. Lo decide el patrón —un arco de anillos se arma recto—,
    #: y tiene que llegar aquí para que el croquis sea la pieza que se contó.
    arco_escalonado: bool = True


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return min(maximo, max(minimo, valor))


def _semilla(estructura_id: str) -> int:
    """Semilla de la FORMA de una pieza: la misma estructura, el mismo croquis.

    Propia del croquis y no la del patrón (``patron_color._semilla``): la forma
    de un arco no tiene que cambiar porque cambien las reglas con que se siembra
    un patrón aleatorio.
    """
    return int(hashlib.sha256(f"silueta:{estructura_id}".encode()).hexdigest()[:8], 16)


def _tipo_de_silueta(pieza: PiezaSilueta) -> TipoSilueta | None:
    if pieza.estructura_oficial in _OFICIALES_SIN_SILUETA:
        return None
    if pieza.tipo == "pared":
        return (
            "pared_organica"
            if pieza.estructura_oficial == _OFICIAL_PARED_ORGANICA
            else "pared_densa"
        )
    return _TIPO_SILUETA.get(pieza.tipo)


def _afinado(oficial: str | None) -> float:
    ancho_final = _GEOMETRIA_OFICIAL.get(oficial or "", {}).get("anchoFinalBanda")
    return (
        float(ancho_final)
        if isinstance(ancho_final, (int, float)) and 0 < float(ancho_final) <= 1
        else _AFINADO_DIBUJO
    )


def _grosor_dibujo(pieza: PiezaSilueta, tipo: TipoSilueta) -> tuple[float, float] | None:
    """Grosor visible de la banda en el arranque y en la punta (m), o ``None``.

    Estética documentada, no una medida del oficio: ver ``_GROSOR_BANDA``.
    """
    if tipo == "columna":
        base = pieza.ancho_m if pieza.ancho_m > 0 else _GROSOR_COLUMNA_M
    elif tipo == "guirnalda":
        largo = pieza.largo_m or pieza.ancho_m
        if largo <= 0:
            return None
        base = _acotar(_GROSOR_GUIRNALDA * largo, _GROSOR_GUIRNALDA_MIN, _GROSOR_GUIRNALDA_MAX)
    else:
        menor = min(pieza.ancho_m, pieza.alto_m)
        if menor <= 0:
            return None
        base = _acotar(_GROSOR_BANDA * menor, _GROSOR_BANDA_MIN, _GROSOR_BANDA_MAX)
    return base, base * _afinado(pieza.estructura_oficial)


def _peticion(pieza: PiezaSilueta, cupos: Sequence[Cupo], tipo: TipoSilueta) -> Peticion | None:
    """La petición del motor para esta pieza, o ``None`` si le falta un dato."""
    medidas = Medidas(ancho_m=pieza.ancho_m, alto_m=pieza.alto_m, largo_m=pieza.largo_m)
    estilo = dataclasses.replace(ESTILO, vueltas=_VUELTAS_GRAFICA)
    semilla = _semilla(pieza.estructura_id)
    if tipo in _TIPOS_PARED:
        if pieza.ancho_m <= 0 or pieza.alto_m <= 0:
            return None
        return Peticion(
            tipo=tipo, medidas=medidas, cupos=tuple(cupos), estilo=estilo, semilla=semilla
        )
    grosores = _grosor_dibujo(pieza, tipo)
    if grosores is None:
        return None
    base, punta = grosores
    # Solo una guirnalda con armado trae forma; el motor rechaza una forma en
    # cualquier otro tipo, y una caída en una forma que no cuelga.
    con_armado = tipo == "guirnalda" and pieza.forma_guirnalda is not None
    forma = pieza.forma_guirnalda if con_armado else None
    caida = pieza.caida_m if con_armado and (pieza.caida_m or 0) > 0 else None
    anclajes = pieza.anclajes if con_armado and (pieza.anclajes or 0) > 1 else None
    return Peticion(
        tipo=tipo,
        medidas=medidas,
        cupos=tuple(cupos),
        grosor_m=base,
        grosor_punta_m=punta,
        forma=forma,
        caida_m=caida,
        anclajes=anclajes,
        estilo=estilo,
        semilla=semilla,
    )


def _cupos(matriz: Sequence[Sequence[int]], pulgadas: Sequence[int]) -> tuple[Cupo, ...]:
    """Los cupos del motor: la suma de cada FILA de la matriz del despiece.

    Una posición por globo cotizado, del tamaño con que se cotizó. El motor no
    reparte nada: coloca exactamente estos.
    """
    return tuple(
        Cupo(pulgadas=pulgadas[fila], cantidad=total)
        for fila, total in enumerate(sum(cantidades) for cantidades in matriz)
        if total > 0
    )


# --- De la rejilla del patrón a las posiciones ---------------------------------

#: Qué eje recorre la rejilla de cada tipo de banda: la fila 0 es la base de una
#: columna (sube) y el extremo izquierdo de un arco o una guirnalda (avanza a la
#: derecha). Misma convención que ``extremosFilas`` en la interfaz.
_EJE_VERTICAL = frozenset({"columna"})

Preferencia = Callable[[GloboSilueta], int]


def _celda(celdas: Sequence[Sequence[int]], fila: int, columna: int) -> int:
    linea = celdas[min(max(fila, 0), len(celdas) - 1)]
    return linea[min(max(columna, 0), len(linea) - 1)]


def _lectura_pared(
    globos: Sequence[GloboSilueta], celdas: Sequence[Sequence[int]]
) -> tuple[list[GloboSilueta], Preferencia]:
    """Una pared se lee POR EL SITIO: cada globo toma la celda donde de verdad está.

    ``celdas[fila][columna]`` va de arriba a abajo y de izquierda a derecha, así
    que un degradé, unos bloques, un damero o unas manchas se leen sobre la
    silueta como se leían sobre la rejilla.

    La correspondencia va por POSICIÓN normalizada dentro de la pieza. Antes iba
    por PUESTO: los globos se partían en tantas bandas como filas, con la misma
    cantidad en cada una, y dentro de la banda por orden de izquierda a derecha.
    Eso se eligió porque repartir por altura en crudo dejaba bandas con menos
    globos de los que su color tenía cupo. Pero el cupo lo hace cumplir
    ``_materiales`` aguas abajo —esto es solo una PREFERENCIA—, así que el
    argumento no se sostenía, y el precio era alto: en una pared orgánica las
    filas de arriba tienen menos globos y la banda se estiraba igual sobre todo
    el ancho, de modo que el color de un sitio se pintaba en otro.

    Medido el 2026-09-30 sobre una pared de 483 globos con manchas en zonas:
    solo el **72 %** de los globos recibía el color de su propio sitio. Uno de
    cada cuatro se pintaba con el de otra parte de la pared, y eso es lo que
    deshacía las manchas y las dejaba salpicadas.
    """
    orden = sorted(globos, key=lambda globo: (-globo.y, globo.x, globo.indice))
    filas = len(celdas)
    xs = [globo.x for globo in globos]
    ys = [globo.y for globo in globos]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    ancho = (x1 - x0) or 1.0
    alto = (y1 - y0) or 1.0

    def preferencia(globo: GloboSilueta) -> int:
        # El motor crece hacia arriba (`y = 0` es el suelo) y la rejilla va de
        # arriba a abajo, así que la altura se voltea.
        fila = int((1.0 - (globo.y - y0) / alto) * filas)
        fila = max(0, min(filas - 1, fila))
        columnas = len(celdas[fila]) or 1
        columna = int(((globo.x - x0) / ancho) * columnas)
        return _celda(celdas, fila, max(0, min(columnas - 1, columna)))

    return orden, preferencia


def _corazones(
    grupo: Sequence[GloboSilueta], cuantos: int
) -> list[GloboSilueta]:
    """Los ``cuantos`` globos más cercanos al centro del racimo, de dentro afuera."""
    x = sum(globo.x for globo in grupo) / len(grupo)
    y = sum(globo.y for globo in grupo) / len(grupo)
    cercanos = sorted(grupo, key=lambda globo: (math.hypot(globo.x - x, globo.y - y), globo.indice))
    return cercanos[:cuantos]


def _lectura_banda(
    globos: Sequence[GloboSilueta],
    tipo: TipoSilueta,
    celdas: Sequence[Sequence[int]],
    extras: Sequence[tuple[int, int]] = (),
) -> tuple[list[GloboSilueta], Preferencia]:
    """Una banda se lee por racimos: la fila del patrón es un racimo del armado.

    El motor ya agrupa los globos en racimos (``GloboSilueta.racimo``) y los
    siembra a lo largo de la espina en orden de razón dorada, no de extremo a
    extremo, así que los racimos se ordenan por su sitio sobre el eje: de abajo
    arriba en una columna y de izquierda a derecha en un arco, un semiarco o una
    guirnalda. El racimo n.º ``i`` de los ``n`` que salieron toma la fila
    ``i · filas / n`` de la rejilla, y el globo n.º ``k`` de su racimo la
    posición ``k · columnas / tamaño``: el estilo se lee igual aunque el motor
    arme más o menos racimos que filas tenga la rejilla.

    ``extras`` son los globos que no ocupan posición de racimo: hoy solo el
    centro de una flor, que la rejilla cuelga de su fila (``patron_color._lineas``
    con el modo ``flor``, el único que los produce y que solo admiten las bandas,
    ``_MODOS_POR_TIPO``). Sobre la silueta ese globo existe igual —su cupo lo
    absorbe, porque la matriz del despiece cuenta celdas más extras— pero no
    había nada que lo llevara al medio de su flor: ningún sitio pedía el color
    del centro, así que caía donde cayera por el reparto de sobrantes y las
    flores salían sin corazón. Aquí el centro lo pide el globo más cercano al
    centro del racimo que le toca, y lo pide PRIMERO, antes que los pétalos de su
    racimo, para que el cupo de ese color y ese tamaño llegue a tiempo. Sigue
    siendo una preferencia: si a ese color ya no le quedan globos de ese tamaño,
    ``_materiales`` decide como siempre. Nadie recuenta nada.
    """
    miembros: dict[int, list[GloboSilueta]] = {}
    for globo in sorted(globos, key=lambda globo: globo.indice):
        miembros.setdefault(globo.racimo, []).append(globo)
    vertical = tipo in _EJE_VERTICAL
    centros = {
        racimo: sum(globo.y if vertical else globo.x for globo in grupo) / len(grupo)
        for racimo, grupo in miembros.items()
    }
    rango = {
        racimo: puesto
        for puesto, racimo in enumerate(sorted(centros, key=lambda item: (centros[item], item)))
    }
    tamano = {racimo: len(grupo) for racimo, grupo in miembros.items()}
    puesto_en_racimo = {
        globo.indice: puesto for grupo in miembros.values() for puesto, globo in enumerate(grupo)
    }
    filas = len(celdas)
    racimos = max(1, len(rango))

    def fila_de(racimo: int) -> int:
        return min(filas - 1, rango[racimo] * filas // racimos)

    extras_por_fila: dict[int, list[int]] = {}
    for fila, material in extras:
        extras_por_fila.setdefault(fila, []).append(material)
    corazon: dict[int, int] = {}
    for racimo, grupo in miembros.items():
        pedidos = extras_por_fila.get(fila_de(racimo))
        if not pedidos:
            continue
        for globo, material in zip(_corazones(grupo, len(pedidos)), pedidos, strict=False):
            corazon[globo.indice] = material

    def preferido(globo: GloboSilueta) -> int:
        centro = corazon.get(globo.indice)
        if centro is not None:
            return centro
        fila = fila_de(globo.racimo)
        columnas = len(celdas[min(max(fila, 0), filas - 1)]) or 1
        dentro = puesto_en_racimo[globo.indice] * columnas // max(1, tamano[globo.racimo])
        return _celda(celdas, fila, dentro)

    orden = sorted(
        globos,
        key=lambda globo: (
            rango[globo.racimo],
            globo.indice not in corazon,
            puesto_en_racimo[globo.indice],
        ),
    )
    return orden, preferido


def _materiales(
    orden: Sequence[GloboSilueta],
    preferido: Preferencia,
    matriz: Sequence[Sequence[int]],
    pulgadas: Sequence[int],
) -> dict[int, int] | None:
    """El material de cada posición, con las cantidades de la matriz intactas.

    Cada posición pide el color que el patrón pinta en su sitio; si a ese color
    ya no le quedan globos DE ESE TAMAÑO se lleva el que más le queden (empate
    al de menor número de leyenda). Las cantidades por color no se negocian: son
    las columnas de la matriz, que son ``conteo_por_instancia``. El color se
    mueve de sitio, nunca de cantidad.

    ``None`` si las posiciones y los cupos no cuadran, que sería un motor y una
    matriz que no hablan del mismo despiece: mejor la rejilla de siempre que una
    gráfica que no suma.
    """
    fila_de_tamano = {pulgada: fila for fila, pulgada in enumerate(pulgadas)}
    restantes = [list(cantidades) for cantidades in matriz]
    salida: dict[int, int] = {}
    # DOS pasadas. En una sola, una posición que no podía tener su color se
    # llevaba "el que más le quedaba" y con eso ROBABA el cupo a otra posición
    # que sí lo prefería: la sustitución se propagaba y deshacía las manchas.
    # El dorado de una pared salía salpicado en vez de agrupado, y los globos
    # grandes acababan del color equivocado (visto 2026-09-30).
    #
    # Primera pasada: todo el que PUEDE tener su color lo tiene. Segunda: solo
    # los que no pudieron reparten lo que sobra, sin quitárselo a nadie.
    pendientes: list[GloboSilueta] = []
    for globo in orden:
        fila = fila_de_tamano.get(globo.nominal)
        if fila is None:
            return None
        quedan = restantes[fila]
        material = preferido(globo)
        if material < len(quedan) and quedan[material] > 0:
            quedan[material] -= 1
            salida[globo.indice] = material
        else:
            pendientes.append(globo)
    for globo in pendientes:
        quedan = restantes[fila_de_tamano[globo.nominal]]
        material = max(range(len(quedan)), key=lambda indice: (quedan[indice], -indice))
        if quedan[material] <= 0:
            return None
        quedan[material] -= 1
        salida[globo.indice] = material
    if any(cantidad for quedan in restantes for cantidad in quedan):
        return None
    return salida


#: Escalones de profundidad que admite ``capa`` en el contrato (0 … 15).
_CAPAS_DE_PROFUNDIDAD = 15


def _capa_de_profundidad(profundidad: float) -> int:
    """La profundidad continua del motor (−1 … 1) en los escalones de ``capa``."""
    return max(
        0,
        min(
            _CAPAS_DE_PROFUNDIDAD,
            round((max(-1.0, min(1.0, profundidad)) + 1) / 2 * _CAPAS_DE_PROFUNDIDAD),
        ),
    )


def _arco_de_pieza(pieza: PiezaSilueta, pulgadas: int) -> Arco | None:
    """El arco clásico de esta pieza, o ``None`` si no es uno."""
    if pieza.densidad_arco is None or pieza.tipo != "arco":
        return None
    try:
        return arco_clasico_de_densidad(
            pieza.ancho_m, pieza.alto_m, pieza.densidad_arco, pulgadas, pieza.arco_escalonado
        )
    except ArcoInvalido:
        return None


def _lectura_arco(
    armado: ArcoArmado, celdas: Sequence[Sequence[int]], pulgadas: int
) -> tuple[list[GloboSilueta], Preferencia]:
    """Un arco clásico se lee EXACTO: la fila es la fila y la columna, el carril.

    Aquí no hay aproximación que negociar, y es la diferencia con las otras
    lecturas. En una pared o en una banda orgánica la rejilla del patrón y las
    posiciones del motor son dos mallas distintas, y el color de un sitio es una
    PREFERENCIA que ``_materiales`` cumple cuando puede (la pared mide un 88 %).
    En un arco la rejilla **es** el armado —``filas × globos a lo ancho``, la
    impone ``plan._ancho_de_arco_clasico``— así que cada globo tiene su celda y
    es de un solo tamaño: la primera pasada de ``_materiales`` las cumple todas.

    Al revés no: las filas van escalonadas (las impares llevan un globo menos),
    así que en esas filas un carril se queda sin globo. Es el hueco del
    empaquetado, no un error, y por eso la rejilla tiene más celdas que globos:
    ``_materiales`` reparte sobre los globos, nunca sobre las celdas.
    """
    globos = [
        GloboSilueta(
            # El motor centra el arco en su eje y el contrato pide ``x`` no
            # negativa, así que se corre al borde izquierdo de la pieza.
            x=globo.x + armado.ancho_m / 2,
            y=globo.y,
            r=globo.radio_m,
            # La banda es un tubo, y su profundidad es continua: el centro de
            # cara al espectador y los dos bordes hacia atrás. ``capa`` la lleva
            # en los dieciséis escalones que admite el contrato, 0 el fondo,
            # como en ``silueta._repartir_capas``. Con dos escalones —lo que
            # había— todos los globos del fondo se oscurecían igual y la banda
            # salía de color sucio en vez de leerse como un tubo; la profundidad
            # sin escalonar viaja aparte, en ``prof``.
            capa=_capa_de_profundidad(globo.profundidad),
            nominal=pulgadas,
            indice=indice,
            racimo=globo.fila,
        )
        for indice, globo in enumerate(armado.globos)
    ]
    sitio = {indice: (globo.fila, globo.carril) for indice, globo in enumerate(armado.globos)}

    def preferido(globo: GloboSilueta) -> int:
        fila, carril = sitio[globo.indice]
        return _celda(celdas, fila, carril)

    # Del fondo al frente y, a igual profundidad, por su sitio en el arco: es el
    # ``z = d·10 + i·1e-4`` del original (``motor.ts``), y es lo que decide quién
    # tapa a quién. Ordenar por la capa escalonada no basta: dentro de una capa
    # el carril central de una fila se pintaba antes que los carriles de la fila
    # siguiente, y el relieve del tubo salía invertido a trozos.
    profundidad = {indice: globo.profundidad for indice, globo in enumerate(armado.globos)}
    orden = sorted(globos, key=lambda globo: (profundidad[globo.indice], globo.indice))
    return orden, preferido


def _croquis_de_arco(
    arco: Arco,
    celdas: Sequence[Sequence[int]],
    matriz: Sequence[Sequence[int]],
    pulgadas: Sequence[int],
    total: int,
    presupuesto: PresupuestoGrafica,
) -> Croquis:
    """Croquis de un arco clásico, con el motor porteado del clasificador."""
    try:
        armado = armar_arco_clasico(arco)
    except ArcoInvalido:
        return _sin_croquis("motor_rechazo")
    if armado.total != total:
        # La matriz del despiece y el armado hablarían de piezas distintas.
        return _sin_croquis("despiece_incoherente")
    if len(celdas) != armado.filas or any(
        len(fila) != armado.globos_ancho for fila in celdas
    ):
        return _sin_croquis("despiece_incoherente")
    presupuesto.gastar(total)
    orden, preferido = _lectura_arco(armado, celdas, pulgadas[0])
    materiales = _materiales(orden, preferido, matriz, pulgadas)
    if materiales is None:
        return _sin_croquis("despiece_incoherente")
    return Croquis(
        posiciones=[
            {
                "x": round(globo.x, 4),
                "y": round(globo.y, 4),
                "r": round(globo.r, 4),
                "capa": globo.capa,
                "material": materiales[globo.indice],
                # Lo que el motor calcula por globo y hasta ahora se tiraba: con
                # la profundidad sin escalonar el fondo se oscurece como un tono
                # del mismo color, y con el giro el óvalo sigue la línea del arco
                # en vez de quedarse vertical en la clave.
                "prof": round(armado.globos[globo.indice].profundidad, 4),
                "giro": armado.globos[globo.indice].giro_grados,
            }
            for globo in orden
        ],
        motivo=None,
    )


def _columna_de_pieza(pieza: PiezaSilueta, pulgadas: int) -> Columna | None:
    """La columna clásica de esta pieza, o ``None`` si no lo es."""
    if pieza.densidad_columna is None or pieza.tipo != "columna":
        return None
    try:
        return columna_clasica_de_densidad(pieza.alto_m, pieza.densidad_columna, pulgadas)
    except ColumnaInvalida:
        return None


def _lectura_columna(
    armada: ColumnaArmada, celdas: Sequence[Sequence[int]], pulgadas: int
) -> tuple[list[GloboSilueta], Preferencia]:
    """Una columna clásica se lee EXACTO: la fila es la capa y la columna, el puesto.

    Es el mismo trato que el arco clásico y por la misma razón: la rejilla **es**
    el armado —``capas × globos por capa``, que impone
    ``plan._capa_de_columna_clasica``—, así que cada globo tiene su celda y es de
    un solo tamaño. Y aquí no hay ni siquiera el hueco del escalonado: una
    columna gira sus capas medio paso en ÁNGULO, no quitando un globo, así que
    todas las capas van llenas y la rejilla no tiene celdas de sobra.
    """
    medio = armada.diametro_m / 2
    globos = [
        GloboSilueta(
            # El motor centra la columna en su eje y el contrato pide ``x`` no
            # negativa, así que se corre al borde izquierdo de la pieza.
            x=globo.x + medio,
            y=globo.y,
            r=globo.radio_m,
            capa=_capa_de_profundidad(globo.profundidad),
            nominal=pulgadas,
            indice=indice,
            racimo=globo.capa,
        )
        for indice, globo in enumerate(armada.globos)
    ]
    sitio = {indice: (globo.capa, globo.puesto) for indice, globo in enumerate(armada.globos)}

    def preferido(globo: GloboSilueta) -> int:
        capa, puesto = sitio[globo.indice]
        return _celda(celdas, capa, puesto)

    # ``armar`` ya los devolvió del fondo al frente y, a igual profundidad, de
    # arriba abajo. No se reordena: ese es el orden del motor y el que decide
    # quién tapa a quién.
    return globos, preferido


def _croquis_de_columna(
    columna: Columna,
    celdas: Sequence[Sequence[int]],
    matriz: Sequence[Sequence[int]],
    pulgadas: Sequence[int],
    total: int,
    presupuesto: PresupuestoGrafica,
) -> Croquis:
    """Croquis de una columna clásica, con el motor porteado del clasificador."""
    try:
        armada = armar_columna_clasica(columna)
    except ColumnaInvalida:
        return _sin_croquis("motor_rechazo")
    if armada.total != total:
        # La matriz del despiece y el armado hablarían de piezas distintas.
        return _sin_croquis("despiece_incoherente")
    if len(celdas) != armada.capas or any(
        len(fila) != armada.globos_capa for fila in celdas
    ):
        return _sin_croquis("despiece_incoherente")
    presupuesto.gastar(total)
    orden, preferido = _lectura_columna(armada, celdas, pulgadas[0])
    materiales = _materiales(orden, preferido, matriz, pulgadas)
    if materiales is None:
        return _sin_croquis("despiece_incoherente")
    return Croquis(
        posiciones=[
            {
                "x": round(globo.x, 4),
                "y": round(globo.y, 4),
                "r": round(globo.r, 4),
                "capa": globo.capa,
                "material": materiales[globo.indice],
                # Una columna es un cilindro visto de frente: la profundidad es
                # lo único que hace que se lea como tal. El giro va en cero
                # porque sus globos no siguen ninguna línea: el óvalo se queda
                # vertical, que es como se ven de verdad.
                "prof": round(armada.globos[globo.indice].profundidad, 4),
                "giro": 0,
            }
            for globo in orden
        ],
        motivo=None,
    )


def croquis_de_patron(
    pieza: PiezaSilueta,
    celdas: Sequence[Sequence[int]],
    matriz: Sequence[Sequence[int]],
    proporciones: Sequence[tuple[int, float]],
    presupuesto: PresupuestoGrafica | None = None,
    extras: Sequence[tuple[int, int]] = (),
) -> Croquis:
    """Las posiciones de los globos de una instancia, del fondo al frente.

    ``matriz`` es la matriz tamaño × material del despiece de ``plan.py``: sus
    filas son los tamaños de ``proporciones`` y sus columnas los materiales de
    la pieza. ``celdas`` es la rejilla del patrón ya expandida, que dice el
    color de cada sitio, y ``extras`` los globos que la rejilla cuelga de una
    fila sin darles posición (el centro de una flor).

    Un ``Croquis`` sin posiciones y con ``motivo`` —y la gráfica sigue con la
    rejilla— cuando el tipo no tiene silueta, falta una medida, el presupuesto
    de dibujo no alcanza o el motor rechaza la petición. Nunca lanza: esto es
    dibujo.
    """
    tipo = _tipo_de_silueta(pieza)
    if tipo is None:
        return _sin_croquis("tipo_sin_silueta")
    if not celdas or not matriz or len(matriz) != len(proporciones):
        return _sin_croquis("despiece_incoherente")
    total = sum(cantidad for cantidades in matriz for cantidad in cantidades)
    if total <= 0:
        return _sin_croquis("despiece_incoherente")
    presupuesto = presupuesto or PresupuestoGrafica()
    falta = presupuesto.motivo(total)
    if falta is not None:
        return _sin_croquis(falta)
    arco = _arco_de_pieza(pieza, proporciones[0][0])
    if arco is not None:
        return _croquis_de_arco(
            arco,
            celdas,
            matriz,
            [pulgada for pulgada, _proporcion in proporciones],
            total,
            presupuesto,
        )
    columna = _columna_de_pieza(pieza, proporciones[0][0])
    if columna is not None:
        return _croquis_de_columna(
            columna,
            celdas,
            matriz,
            [pulgada for pulgada, _proporcion in proporciones],
            total,
            presupuesto,
        )
    cupos = _cupos(matriz, [pulgadas for pulgadas, _proporcion in proporciones])
    peticion = _peticion(pieza, cupos, tipo)
    if peticion is None:
        return _sin_croquis("medidas_incompletas")
    try:
        disposicion = _disponer_recordado(peticion)
    except SiluetaInvalida:
        return _sin_croquis("motor_rechazo")
    if len(disposicion.globos) != total:
        return _sin_croquis("motor_rechazo")
    presupuesto.gastar(total)
    pulgadas = [pulgada for pulgada, _proporcion in proporciones]
    orden, preferido = (
        _lectura_pared(disposicion.globos, celdas)
        if tipo in _TIPOS_PARED
        else _lectura_banda(disposicion.globos, tipo, celdas, extras)
    )
    materiales = _materiales(orden, preferido, matriz, pulgadas)
    if materiales is None:
        return _sin_croquis("despiece_incoherente")
    # Del fondo al frente y, dentro de una capa, de arriba abajo: la interfaz
    # las pinta en este orden y lo de adelante queda encima, como el pseudo-3D
    # de siempre.
    return Croquis(
        posiciones=[
            {
                "x": round(globo.x, 4),
                "y": round(globo.y, 4),
                "r": round(globo.r, 4),
                "capa": globo.capa,
                "material": materiales[globo.indice],
            }
            for capa in disposicion.por_capa()
            for globo in capa
        ],
        motivo=None,
    )


def pieza_desde_estructura(
    estructura_id: str,
    tipo: str,
    estructura_oficial: str | None,
    medidas: Mapping[str, object],
    armado: Mapping[str, object] | None = None,
    densidad_arco: str | None = None,
    densidad_columna: str | None = None,
    arco_escalonado: bool = True,
) -> PiezaSilueta:
    """``PiezaSilueta`` desde una estructura del plan ya completada.

    ``densidad_arco`` y ``densidad_columna`` solo los manda quien ya sabe que la
    pieza es un arco clásico o una columna clásica (``plan._ancho_de_arco_clasico``
    y ``plan._capa_de_columna_clasica``), que son los mismos que deciden su
    conteo: así el croquis y la cifra no pueden hablar de dos piezas.
    """

    def metros(clave: str) -> float:
        valor = medidas.get(clave)
        return float(valor) if isinstance(valor, (int, float)) and math.isfinite(valor) else 0.0

    forma = armado.get("forma") if armado else None
    caida = armado.get("caida_m") if armado else None
    anclajes = armado.get("puntos_de_anclaje") if armado else None
    return PiezaSilueta(
        estructura_id=estructura_id,
        tipo=tipo,
        estructura_oficial=estructura_oficial,
        ancho_m=metros("ancho_m"),
        alto_m=metros("alto_m"),
        largo_m=metros("largo_m"),
        forma_guirnalda=forma if isinstance(forma, str) else None,
        caida_m=float(caida) if isinstance(caida, (int, float)) else None,
        anclajes=int(anclajes) if isinstance(anclajes, int) else None,
        densidad_arco=densidad_arco,
        densidad_columna=densidad_columna,
        arco_escalonado=arco_escalonado,
    )


__all__ = [
    "MAX_GLOBOS_PIEZA",
    "PRESUPUESTO_GLOBOS",
    "Croquis",
    "MotivoSinSilueta",
    "PiezaSilueta",
    "PresupuestoGrafica",
    "croquis_de_patron",
    "pieza_desde_estructura",
]
