"""Motor de silueta: dónde queda cada globo de una estructura, en metros.

Hoy la gráfica y el patrón de color expanden una rejilla de filas × columnas
(``patron_color._rejilla``) que es la misma para una pared que para una
guirnalda. Este módulo produce, en su lugar, la POSICIÓN REAL de cada globo a
partir del tipo de estructura y sus medidas: una espina (curva guía con
tangente, normal y largo acumulado) con un grosor variable a lo largo para las
siluetas de banda —guirnalda, arco, semiarco, columna—, y un rectángulo de
borde limpio o de borde vivo para las paredes.

Lo que este módulo NO hace, a propósito:

* **No decide cantidades.** ``Peticion.cupos`` dice cuántos globos de cada
  tamaño nominal hay que colocar y el motor coloca exactamente esos. El dueño
  del conteo, del despiece y de la cotización sigue siendo
  ``services/ai-api/app/plan.py``; si el motor apuntara un número por su
  cuenta habría dos dueños de la misma cifra.
* **No aplica reglas comerciales.** Ni densidad, ni λ, ni ancho de banda
  comercial, ni sustitución de diámetros. El grosor de la banda entra como
  dato (``Peticion.grosor_m``), medido por quien sí es su dueño.
* **No asigna colores.** La salida es geometría; el color se reparte después
  (``patron_color``), sobre estas posiciones.

Determinismo: misma petición y misma semilla dan exactamente la misma salida.
El azar es un generador propio de 32 bits (``_Azar``), no ``random``, para que
el resultado no dependa de la versión de CPython ni del estado global del
proceso. Es requisito, no detalle: de estas posiciones saldrán la gráfica y,
al integrarse, el conteo que el cliente ve.

El modelo de espina, capas de profundidad y relajación está adaptado del
diseñador orgánico del usuario (``clasificador-decoraciones/src/lib/organico``);
aquí es solo geometría y respeta las cuotas por tamaño, que allí no existen.

Puro: sin red, sin base de datos, sin FastAPI. Lee del contrato exportado la
tabla de mezclas (dueño ``src/lib/plan/mezclas.ts``) y las formas de guirnalda
que cuelgan (dueño ``src/lib/plan/estructuras-oficiales.ts``, a través de
``app.armado_guirnalda``) en vez de copiarlas.

Sobre el largo del archivo (AGENTS.md pide revisar los que pasan de 400
líneas): tiene una sola razón para cambiar —cómo se convierte una estructura en
posiciones de globo— y partirlo en «formas» y «empaquetado» obligaría a
importar dos módulos para una sola operación, con el empaquetado dependiendo de
los tipos de las formas. Queda como sus vecinos del mismo servicio
(``armado_guirnalda.py``, ``patron_color.py``). Si crece, la costura es esa:
todo lo que va de ``_Globo`` para abajo.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from app.armado_guirnalda import FORMAS as FORMAS_GUIRNALDA
from app.armado_guirnalda import FORMAS_CON_CAIDA
from app.generated_models import contract_schema

#: Tipos de silueta que el motor sabe dibujar. Son las primitivas de geometría
#: del plan (``tipoBase`` de ``estructuras-oficiales.ts``) más la distinción de
#: pared que sí cambia la forma: la densa es un rectángulo limpio y la orgánica
#: cubre lo mismo con el contorno irregular.
TipoSilueta = Literal[
    "arco", "semiarco", "guirnalda", "columna", "pared_densa", "pared_organica"
]
TIPOS: tuple[TipoSilueta, ...] = (
    "arco",
    "semiarco",
    "guirnalda",
    "columna",
    "pared_densa",
    "pared_organica",
)
_TIPOS_BANDA: frozenset[str] = frozenset({"arco", "semiarco", "guirnalda", "columna"})
_TIPOS_PARED: frozenset[str] = frozenset({"pared_densa", "pared_organica"})

#: Cuánto queda un globo por debajo de su diámetro nominal, **como factor
#: lineal**. Ya no lo usa ``diametro_inflado_m``: la medida de verdad es la
#: tabla ``_INFLADO_PULGADAS``, porque un globo no se infla proporcional a su
#: etiqueta. Sigue aquí porque es el mismo 0,92 que ``plan.py`` escribe a mano
#: cuatro veces dentro de la fórmula de densidad λ, que se **calibró** con él:
#: cambiárselo movería el precio de paredes, guirnaldas y semiarcos. Son dos
#: definiciones conviviendo, y esta es la que falta migrar.
FACTOR_INFLADO = 0.92
_PULGADA_M = 0.0254

#: A cuántas pulgadas reales queda inflado cada tamaño nominal. Dueño:
#: ``src/lib/plan/mezclas.ts`` (``INFLADO_PULGADAS``), que lo exporta al
#: contrato igual que la tabla de mezclas y los armados.
_INFLADO_PULGADAS: dict[float, float] = {
    float(nominal): float(pulgadas)
    for nominal, pulgadas in cast(
        dict[str, float],
        cast(dict[str, object], contract_schema("PlanDecoracion")["x-reglas-mezclas"])[
            "inflado_pulgadas"
        ],
    ).items()
}

#: Cuánto se pueden meter dos globos uno en otro según su distancia en
#: profundidad (fracción de la suma de radios). Dos globos de la misma capa casi
#: se tocan; uno del fondo y otro del frente se solapan de verdad al mirarlos.
_PENETRACION = (0.06, 0.34, 0.5, 0.6)
#: Puntos con que se muestrea una espina. Fijo: la salida no puede depender de
#: un parámetro de muestreo.
_N_PUNTOS = 720
#: Tope de globos por instancia. Igual que ``patron_color.MAX_CELDAS``, es un
#: límite de la gráfica, no del oficio.
MAX_GLOBOS = 1600
_EPS = 1e-9


class SiluetaInvalida(ValueError):
    """Una petición que no describe una silueta que se pueda armar."""

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(mensaje)
        self.motivo = motivo
        self.mensaje = mensaje


# --- Azar determinista --------------------------------------------------------


class _Azar:
    """``mulberry32``: 32 bits de estado, misma secuencia en cualquier máquina.

    Se usa en vez de ``random.Random`` para no depender del generador de la
    biblioteca estándar ni de su estado global, y para dar la misma secuencia
    que el diseñador orgánico del que viene el modelo.
    """

    __slots__ = ("_a",)

    def __init__(self, semilla: int) -> None:
        self._a = semilla & 0xFFFFFFFF

    def __call__(self) -> float:
        self._a = (self._a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self._a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return min(maximo, max(minimo, valor))


# --- Entrada ------------------------------------------------------------------


@dataclass(frozen=True)
class Medidas:
    """Medidas exteriores pedidas (m). Las que no usa un tipo se ignoran."""

    ancho_m: float = 0.0
    alto_m: float = 0.0
    largo_m: float = 0.0


@dataclass(frozen=True)
class Cupo:
    """Cuántos globos de un tamaño nominal hay que colocar.

    Viene de fuera ya decidido (el despiece de ``plan.py``): el motor no lo
    reparte ni lo redondea, solo lo coloca.
    """

    pulgadas: int
    cantidad: int


@dataclass(frozen=True)
class Estilo:
    """Perillas de forma del motor. Ninguna es una regla comercial.

    Todas describen cómo se ve la silueta, no cuánto cuesta ni cuántos globos
    lleva. Los valores por defecto son el orgánico de referencia del oficio.
    """

    #: Globos por racimo al sembrar. Un decorador arma en racimos de 3 a 5.
    racimo: int = 4
    #: Cuánto se abulta y se afina el grosor a lo largo de la banda (0 = parejo).
    irregularidad: float = 0.35
    #: Cuánto serpentea la línea guía respecto a la curva limpia (0 = limpia).
    ondulacion: float = 0.3
    #: Cuánto se concentran los grandes en la base y los chicos en la punta.
    grandes_abajo: float = 0.6
    #: Cuánto varía el inflado de un globo a otro (0 = todos al mismo diámetro).
    variacion_inflado: float = 0.1
    #: Fracción de globos que se salen del borde de la banda.
    salientes: float = 0.35
    #: Dónde queda la cima de un arco, de 0,3 (izquierda) a 0,7 (derecha).
    cima: float = 0.5
    #: Cuán cuadrada (3) o puntiaguda (1,7) es la curva de un arco. 2 = elipse.
    curva: float = 2.0
    #: Cuánto se corre de lado la punta de una columna (m).
    serpenteo_m: float = 0.08
    #: Arqueo de una guirnalda «curva», como fracción de su largo.
    arqueo: float = 0.08
    #: Amplitud y cantidad de ondas de una guirnalda «ondulada».
    onda: float = 0.05
    ondas: float = 2.5
    #: Cuánto muerde el borde vivo de una pared orgánica, como fracción del lado.
    #: Muerde siempre hacia dentro: la pared nunca se sale de las medidas.
    borde_vivo: float = 0.09
    #: Vueltas de relajación. Corta antes cuando ya casi nada se mueve.
    vueltas: int = 48


ESTILO = Estilo()

#: Amplitud máxima del borde vivo (fracción del lado): más que esto y dos lados
#: opuestos se cruzan y el contorno deja de ser un polígono simple.
_BORDE_VIVO_TOPE = 0.20
#: Cuánto muerde el borde vivo, medido en DIÁMETROS del globo dominante. La
#: mordida se mide en globos y no en fracción de la pieza: con 0,09 del lado
#: menor, una pared de 2,0 × 1,5 m mordía 13,5 cm — menos de medio globo de 12",
#: un borde "orgánico" indistinguible de uno recto (medido 2026-09-30).
_MORDIDA_EN_GLOBOS = 1.2
#: Suelo de la envolvente del borde: lo que muerde la esquina respecto del
#: centro. Con 0 las cuatro esquinas salían rectas.
_SUELO_ENVOLVENTE = 0.35


@dataclass(frozen=True)
class Peticion:
    """Todo lo que el motor necesita. Ninguna cantidad la decide él."""

    tipo: TipoSilueta
    medidas: Medidas
    #: Globos por tamaño nominal, ya repartidos fuera.
    cupos: tuple[Cupo, ...]
    #: Grosor visible de la banda (m) en el arranque —las patas de un arco, la
    #: base de una columna, los extremos de una guirnalda—. Obligatorio en las
    #: siluetas de banda, prohibido en las paredes: su dueño es quien mide la
    #: banda, no el motor.
    #:
    #: Es el grosor que se VE (0,6–1,1 m en un arco orgánico del oficio), no el
    #: ``_BAND_WIDTH`` de ``plan.py``: ese es una tira delgada cuyo área, por λ,
    #: da el conteo, y λ absorbe la profundidad. Son dos cifras distintas de dos
    #: dueños distintos; confundirlas es lo que la fase de integración tiene que
    #: resolver, no este motor.
    grosor_m: float | None = None
    #: Grosor en la punta (m): la cima de un arco, el final de un semiarco o de
    #: una columna, el centro de una guirnalda. Sin él, la banda es pareja.
    grosor_punta_m: float | None = None
    #: Forma del armado de una guirnalda (``armado_guirnalda.FORMAS``).
    forma: str | None = None
    #: Caída (m) y anclajes de una forma que cuelga (``FORMAS_CON_CAIDA``).
    caida_m: float | None = None
    anclajes: int | None = None
    estilo: Estilo = ESTILO
    semilla: int = 0

    @property
    def total(self) -> int:
        return sum(cupo.cantidad for cupo in self.cupos)


# --- Salida -------------------------------------------------------------------


@dataclass(frozen=True)
class PuntoEspina:
    """Un punto de la curva guía, en metros. ``y = 0`` es el suelo."""

    x: float
    y: float
    #: Tangente unitaria, en el sentido en que se recorre la espina.
    tx: float
    ty: float
    #: Normal unitaria (la tangente girada 90°): hacia afuera en la cima.
    nx: float
    ny: float
    #: Largo acumulado desde el arranque (m).
    s: float


@dataclass(frozen=True)
class Espina:
    """Curva guía de una silueta de banda, con su grosor punto por punto."""

    puntos: tuple[PuntoEspina, ...]
    #: Grosor de la banda (m) en cada punto, alineado con ``puntos``.
    grosores: tuple[float, ...]
    #: Largo de la curva (m). Es el largo DIBUJADO: el eje que se cotiza lo
    #: mide ``plan.py._eje``, que sigue siendo su dueño.
    largo: float

    def indice_en(self, fraccion: float) -> int:
        """Índice del punto que está en esa fracción del largo (sobre la curva)."""
        objetivo = _acotar(fraccion, 0.0, 1.0) * self.largo
        bajo, alto = 0, len(self.puntos) - 1
        while alto - bajo > 1:
            medio = (bajo + alto) // 2
            if self.puntos[medio].s <= objetivo:
                bajo = medio
            else:
                alto = medio
        return bajo

    def grosor_en(self, fraccion: float) -> float:
        return self.grosores[self.indice_en(fraccion)]

    @property
    def area_m2(self) -> float:
        """Área que cubre la banda (m²): el grosor integrado a lo largo."""
        area = 0.0
        for i in range(1, len(self.puntos)):
            area += self.grosores[i] * (self.puntos[i].s - self.puntos[i - 1].s)
        return area


@dataclass(frozen=True)
class Borde:
    """Contorno de una pared: el rectángulo pedido, con el borde vivo o limpio.

    La perturbación muerde siempre hacia dentro y se apaga en las esquinas, así
    que la pared orgánica cubre menos que el rectángulo y nunca se sale de las
    medidas que pidió el cliente. Con ``amplitud = 0`` es el rectángulo limpio
    de la pared densa.
    """

    ancho_m: float
    alto_m: float
    amplitud: float
    #: Fases ya sorteadas (una por lado × dos armónicos): la forma no cambia
    #: porque cambie otra perilla.
    fases: tuple[float, ...]

    def _mordida(self, t: float, lado: int) -> float:
        """Cuánto muerde el borde (m) en la fracción ``t`` de ese lado, ≥ 0."""
        if self.amplitud <= 0:
            return 0.0
        t = _acotar(t, 0.0, 1.0)
        # La envolvente afina la mordida hacia los extremos para que dos lados
        # contiguos no la sumen entera en la esquina. Pero valía CERO en t=0 y
        # t=1, así que una pared orgánica tenía las cuatro esquinas perfectamente
        # rectas (medido 2026-09-30) — y en una pared de racimos la esquina es de
        # lo más irregular que hay. Con suelo, la esquina muerde una parte y el
        # centro sigue mordiendo entero.
        envolvente: float = _SUELO_ENVOLVENTE + (1.0 - _SUELO_ENVOLVENTE) * math.sin(math.pi * t) ** 0.7
        a = self.fases[lado * 2] * math.tau
        b = self.fases[lado * 2 + 1] * math.tau
        onda = 0.65 * math.sin(2.3 * math.tau * t + a) + 0.35 * math.sin(
            4.7 * math.tau * t + b
        )
        return self.amplitud * envolvente * (0.55 + 0.45 * onda)

    def x_izq(self, y: float) -> float:
        return self._mordida(y / self.alto_m, 0)

    def x_der(self, y: float) -> float:
        return self.ancho_m - self._mordida(y / self.alto_m, 1)

    def y_inf(self, x: float) -> float:
        return self._mordida(x / self.ancho_m, 2)

    def y_sup(self, x: float) -> float:
        return self.alto_m - self._mordida(x / self.ancho_m, 3)

    def contorno(self, pasos: int = 96) -> tuple[tuple[float, float], ...]:
        """Polígono cerrado del borde, en sentido antihorario."""
        puntos: list[tuple[float, float]] = []
        for i in range(pasos):
            x = self.ancho_m * i / pasos
            puntos.append((x, self.y_inf(x)))
        for i in range(pasos):
            y = self.alto_m * i / pasos
            puntos.append((self.x_der(y), y))
        for i in range(pasos):
            x = self.ancho_m * (1 - i / pasos)
            puntos.append((x, self.y_sup(x)))
        for i in range(pasos):
            y = self.alto_m * (1 - i / pasos)
            puntos.append((self.x_izq(y), y))
        return tuple(puntos)

    @property
    def area_m2(self) -> float:
        """Área encerrada por el contorno (m²), por la fórmula del cordón."""
        puntos = self.contorno()
        doble = 0.0
        for (x0, y0), (x1, y1) in zip(puntos, puntos[1:] + puntos[:1], strict=True):
            doble += x0 * y1 - x1 * y0
        return abs(doble) / 2


@dataclass(frozen=True)
class Silueta:
    """El contorno de una estructura en metros, listo para colocar globos.

    Es de banda (``espina``) o de área (``borde``), nunca las dos. La ``caja``
    es la envolvente real de la silueta: en un arco, una columna o una pared
    coincide con las medidas pedidas; en una guirnalda el alto lo pone su propia
    banda y su caída, porque el plan no mide el alto de una guirnalda.
    """

    tipo: TipoSilueta
    medidas: Medidas
    espina: Espina | None
    borde: Borde | None
    #: ``(x_min, y_min, x_max, y_max)`` en metros.
    caja: tuple[float, float, float, float]

    @property
    def area_m2(self) -> float:
        if self.espina is not None:
            return self.espina.area_m2
        assert self.borde is not None
        return self.borde.area_m2

    def contorno(self) -> tuple[tuple[float, float], ...]:
        """Polígono cerrado de la silueta, en metros.

        En una banda son los dos costados de la espina, uno de ida y otro de
        vuelta; en una curva muy cerrada ese contorno se puede cruzar sobre sí
        mismo, así que sirve para dibujar, no para medir el área (``area_m2``
        integra el grosor a lo largo, que sí es el área de la banda).
        """
        if self.borde is not None:
            return self.borde.contorno()
        assert self.espina is not None
        izquierda: list[tuple[float, float]] = []
        derecha: list[tuple[float, float]] = []
        for punto, grosor in zip(self.espina.puntos, self.espina.grosores, strict=True):
            mitad = grosor / 2
            izquierda.append((punto.x + punto.nx * mitad, punto.y + punto.ny * mitad))
            derecha.append((punto.x - punto.nx * mitad, punto.y - punto.ny * mitad))
        return tuple(izquierda) + tuple(reversed(derecha))

    def baseza(self, fraccion: float, y: float) -> float:
        """Cuánto «de base» es un sitio: 1 en las patas o los extremos, 0 en la punta.

        Es lo único que el motor usa para que los globos grandes tiendan a la
        base y los chicos a la punta, como arma un decorador.
        """
        if self.tipo in _TIPOS_PARED:
            _, _, _, alto = self.caja
            return _acotar(1 - y / max(alto, _EPS), 0.0, 1.0)
        u = _acotar(fraccion, 0.0, 1.0)
        # El arco y la guirnalda tienen dos extremos (las dos patas, las dos
        # puntas); el semiarco y la columna, uno solo.
        angulo = math.pi * u if self.tipo in ("arco", "guirnalda") else math.pi / 2 * u
        avance: float = math.sin(angulo) ** 0.6
        return 1 - avance


@dataclass(frozen=True)
class GloboSilueta:
    """Un globo colocado, en metros."""

    x: float
    y: float
    #: Radio inflado (m).
    r: float
    #: Capa de profundidad: 0 = fondo.
    capa: int
    #: Tamaño nominal (pulgadas), el del cupo con que se pidió.
    nominal: int
    #: Orden estable de colocación.
    indice: int
    #: Racimo al que pertenece (los globos de un racimo se armaron juntos).
    racimo: int


@dataclass(frozen=True)
class Disposicion:
    """Las posiciones de una silueta. De aquí salen la gráfica y el conteo."""

    silueta: Silueta
    globos: tuple[GloboSilueta, ...]
    #: Capas de profundidad que se usaron.
    capas: int
    #: Área de los globos sobre el área de la silueta. Vale varias veces 1 en
    #: una estructura real, porque los globos se apilan en capas de profundidad:
    #: es la densidad de empaque, no un error. Sirve para ver si los globos que
    #: pidió el llamador cuadran con las medidas que pidió; el motor no decide
    #: cuántos lleva la pieza, así que nunca rechaza por esto.
    ocupacion: float

    def por_capa(self) -> tuple[tuple[GloboSilueta, ...], ...]:
        """Los globos agrupados del fondo al frente, para dibujarlos en ese orden."""
        capas: list[list[GloboSilueta]] = [[] for _ in range(self.capas)]
        for globo in self.globos:
            capas[globo.capa].append(globo)
        return tuple(tuple(sorted(capa, key=lambda g: -g.y)) for capa in capas)


# --- Tamaños ------------------------------------------------------------------


def diametro_inflado_m(pulgadas: float) -> float:
    """Diámetro (m) al que queda un globo de ese tamaño nominal al inflarlo.

    Sale de la tabla del oficio (``x-reglas-mezclas.inflado_pulgadas``, dueño
    ``src/lib/plan/mezclas.ts``), que es la ``INFLADO_PULG`` del clasificador. No
    es ``nominal × un factor``: un R-5 queda en 4″ —un 80 % de su etiqueta— y un
    R-12 en 10,5″, un 87,5 %. El factor lineal que había antes le daba a un R-18
    un 15 % de más.

    Un tamaño que no esté en la tabla se interpola entre los dos vecinos, y por
    debajo o por encima se estira el extremo. Los cinco del catálogo están todos
    en la tabla, así que eso no le pasa a nada que se cotice.
    """
    puntos = _INFLADO_PULGADAS
    if pulgadas in puntos:
        return puntos[pulgadas] * _PULGADA_M
    nominales = sorted(puntos)
    if pulgadas <= nominales[0]:
        bajo, alto = nominales[0], nominales[1]
    elif pulgadas >= nominales[-1]:
        bajo, alto = nominales[-2], nominales[-1]
    else:
        alto = next(n for n in nominales if n > pulgadas)
        bajo = nominales[nominales.index(alto) - 1]
    avance = (pulgadas - bajo) / (alto - bajo)
    return (puntos[bajo] + (puntos[alto] - puntos[bajo]) * avance) * _PULGADA_M


def _rango(pulgadas: float) -> float:
    """Cuán «grande» es un tamaño respecto al R-12, en octavas.

    Sale del propio diámetro (R-5 ≈ −1,26, R-12 = 0, R-24 = 1) en vez de una
    tabla escrita a mano, así que un diámetro nuevo entra sin tocar nada.
    """
    return math.log(max(pulgadas, _EPS) / 12) / math.log(2)


def mezcla_del_contrato(nombre: str) -> tuple[tuple[int, float], ...]:
    """Proporciones por tamaño de una mezcla, leídas del contrato exportado.

    La tabla tiene un solo dueño, ``src/lib/plan/mezclas.ts``, que la exporta a
    ``plan-decoracion.v1`` como ``x-reglas-mezclas``; aquí se lee de ahí, igual
    que hace ``plan.py``. Es una comodidad para previsualizar y para las
    pruebas: quien reparte los globos de verdad es el despiece de ``plan.py``.
    """
    reglas = cast(
        Mapping[str, object], contract_schema("PlanDecoracion")["x-reglas-mezclas"]
    )
    mezclas = cast(Mapping[str, object], reglas["mezclas"])
    if nombre not in mezclas:
        raise SiluetaInvalida(
            "mezcla_desconocida", f"El contrato no define la mezcla «{nombre}»."
        )
    tamanos = cast(Sequence[Mapping[str, float]], mezclas[nombre])
    return tuple(
        (int(tamano["pulgadas"]), float(tamano["proporcion"])) for tamano in tamanos
    )


def cupos_desde_mezcla(
    proporciones: Sequence[tuple[int, float]], total: int
) -> tuple[Cupo, ...]:
    """Reparte ``total`` globos entre los tamaños de una mezcla, por mayor resto.

    **No es el despiece.** El despiece comercial —con sus sustituciones, sus
    tamaños obligatorios y sus márgenes— es de ``plan.py``. Esto solo sirve para
    previsualizar una silueta o para escribir una prueba sin arrastrar el
    resolutor entero.
    """
    if total < 0:
        raise SiluetaInvalida("total_negativo", "El total de globos no puede ser negativo.")
    suma = sum(proporcion for _pulgadas, proporcion in proporciones)
    if not proporciones or suma <= 0:
        raise SiluetaInvalida("mezcla_vacia", "La mezcla no tiene ningún tamaño con peso.")
    exactos = [(total * proporcion / suma) for _pulgadas, proporcion in proporciones]
    enteros = [int(math.floor(valor)) for valor in exactos]
    faltan = total - sum(enteros)
    restos = sorted(
        range(len(exactos)),
        key=lambda i: (-(exactos[i] - enteros[i]), proporciones[i][0]),
    )
    for i in restos[:faltan]:
        enteros[i] += 1
    return tuple(
        Cupo(pulgadas=proporciones[i][0], cantidad=enteros[i])
        for i in range(len(proporciones))
        if enteros[i] > 0
    )


# --- Espinas ------------------------------------------------------------------


def _medir(puntos: Sequence[tuple[float, float]]) -> tuple[PuntoEspina, ...]:
    """Tangente, normal y largo acumulado de una lista de puntos."""
    medidos: list[PuntoEspina] = []
    s = 0.0
    ultimo = len(puntos) - 1
    for i, (x, y) in enumerate(puntos):
        if i > 0:
            s += math.hypot(x - puntos[i - 1][0], y - puntos[i - 1][1])
        ax, ay = puntos[max(0, i - 1)]
        bx, by = puntos[min(ultimo, i + 1)]
        dx, dy = bx - ax, by - ay
        largo = math.hypot(dx, dy) or 1.0
        medidos.append(
            PuntoEspina(
                x=x, y=y, tx=dx / largo, ty=dy / largo, nx=-dy / largo, ny=dx / largo, s=s
            )
        )
    return tuple(medidos)


def _ruido(u: float, fases: Sequence[float], frecuencia: float = 1.0) -> float:
    """Tres armónicos suaves en [−1, 1], con las fases ya sorteadas."""
    return (
        0.5 * math.sin(math.tau * 1.1 * frecuencia * u + fases[4] * math.tau)
        + 0.3 * math.sin(math.tau * 2.7 * frecuencia * u + fases[5] * math.tau)
        + 0.2 * math.sin(math.tau * 4.9 * frecuencia * u + fases[6] * math.tau)
    )


def _grosores(
    puntos: Sequence[PuntoEspina],
    largo: float,
    base: float,
    punta: float,
    perfil: str,
    estilo: Estilo,
    fases: Sequence[float],
    frecuencia: float,
) -> tuple[float, ...]:
    """Grosor de la banda punto por punto: base → punta, más abultamientos.

    ``perfil`` dice dónde está la «punta»: en ``arco`` es la cima y la banda
    vuelve al grosor de las patas al otro lado; en ``monotono`` la banda va del
    arranque al final sin volver.
    """
    salida: list[float] = []
    minimo = min(base, punta) * 0.35
    for punto in puntos:
        u = punto.s / largo if largo > 0 else 0.0
        if perfil == "arco":
            avance = math.sin(math.pi * u) ** 0.7
        else:
            avance = u**0.85
        recto = base + (punta - base) * avance
        salida.append(
            max(minimo, recto * (1 + estilo.irregularidad * 0.5 * _ruido(u, fases, frecuencia)))
        )
    return tuple(salida)


def _ondular(
    puntos: Sequence[PuntoEspina],
    largo: float,
    amplitud: float,
    fases: Sequence[float],
    *,
    y_minimo: float = 0.0,
) -> tuple[tuple[float, float], ...]:
    """Corre la curva a lo largo de su normal, sin mover los extremos."""
    if amplitud <= 0 or largo <= 0:
        return tuple((punto.x, punto.y) for punto in puntos)
    k1 = 1.4 + fases[0] * 1.4
    k2 = 3.0 + fases[1] * 2.0
    movidos: list[tuple[float, float]] = []
    for punto in puntos:
        u = punto.s / largo
        envolvente = math.sin(math.pi * u) ** 0.8
        desvio = (
            amplitud
            * envolvente
            * (
                0.7 * math.sin(math.tau * k1 * u + fases[2] * math.tau)
                + 0.3 * math.sin(math.tau * k2 * u + fases[3] * math.tau)
            )
        )
        movidos.append(
            (punto.x + punto.nx * desvio, max(y_minimo, punto.y + punto.ny * desvio))
        )
    return tuple(movidos)


def _espina_arco(
    medidas: Medidas, base: float, punta: float, estilo: Estilo, fases: Sequence[float]
) -> Espina:
    """Media superelipse de pata a pata, con la cima corrida y ondulada.

    La curva va por dentro: la banda se dibuja a los dos lados, así que el
    borde exterior del arco llega justo al ancho y al alto pedidos.
    """
    a = max(0.2, (medidas.ancho_m - base) / 2)
    altura = max(0.3, medidas.alto_m - punta / 2)
    p = 2 / _acotar(estilo.curva, 1.7, 3.4)
    gamma = math.log(_acotar(estilo.cima, 0.3, 0.7)) / math.log(0.5)
    crudos: list[tuple[float, float]] = []
    for i in range(_N_PUNTOS + 1):
        th = math.pi * (1 - i / _N_PUNTOS)
        c, s = math.cos(th), math.sin(th)
        xr = math.copysign(abs(c) ** p, c)
        u = (xr + 1) / 2
        crudos.append((a * (2 * u**gamma - 1) + medidas.ancho_m / 2, altura * abs(s) ** p))
    puntos = _medir(crudos)
    largo = puntos[-1].s
    amplitud = estilo.ondulacion * 0.09 * min(medidas.ancho_m, medidas.alto_m)
    puntos = _medir(_ondular(puntos, largo, amplitud, fases))
    largo = puntos[-1].s
    return Espina(
        puntos=puntos,
        grosores=_grosores(puntos, largo, base, punta, "arco", estilo, fases, 1.0),
        largo=largo,
    )


def _espina_semiarco(
    medidas: Medidas, base: float, punta: float, estilo: Estilo, fases: Sequence[float]
) -> Espina:
    """Cuarto de elipse: arranca en el suelo, sube ``alto`` y alcanza ``ancho``.

    Es el mismo eje que mide ``plan.py._eje`` para un semiarco (un cuarto de
    elipse de semiejes ancho y alto), medido aquí sobre la curva dibujada.
    """
    a = max(0.2, medidas.ancho_m - base)
    b = max(0.2, medidas.alto_m - base / 2 - punta / 2)
    crudos = [
        (
            a * math.sin(math.pi / 2 * i / _N_PUNTOS) + base / 2,
            b * (1 - math.cos(math.pi / 2 * i / _N_PUNTOS)) + base / 2,
        )
        for i in range(_N_PUNTOS + 1)
    ]
    puntos = _medir(crudos)
    largo = puntos[-1].s
    amplitud = estilo.ondulacion * 0.06 * min(medidas.ancho_m, medidas.alto_m)
    puntos = _medir(_ondular(puntos, largo, amplitud, fases, y_minimo=base / 2))
    largo = puntos[-1].s
    return Espina(
        puntos=puntos,
        grosores=_grosores(puntos, largo, base, punta, "monotono", estilo, fases, 1.0),
        largo=largo,
    )


def _espina_columna(
    medidas: Medidas, base: float, punta: float, estilo: Estilo, fases: Sequence[float]
) -> Espina:
    """Sube vertical desde el suelo; la punta se corre de lado y serpentea.

    Termina medio globo antes del alto pedido: con los globos de la punta, la
    columna mide lo que se pidió.
    """
    altura = max(0.3, medidas.alto_m - punta / 2)
    k1 = 2.0 + fases[0] * 2.0
    k2 = 4.0 + fases[1] * 3.0
    amplitud = estilo.ondulacion * 0.035 * altura
    centro = max(medidas.ancho_m, base) / 2
    crudos: list[tuple[float, float]] = []
    for i in range(_N_PUNTOS + 1):
        t = i / _N_PUNTOS
        arranque = min(1.0, t * 5)  # la base no se mueve
        x = (
            estilo.serpenteo_m * math.sin(math.pi * t) * arranque
            + amplitud
            * arranque
            * (
                0.7 * math.sin(math.tau * k1 * t + fases[2] * math.tau)
                + 0.3 * math.sin(math.tau * k2 * t + fases[3] * math.tau)
            )
        )
        crudos.append((centro + x, altura * t + base / 2))
    puntos = _medir(crudos)
    largo = puntos[-1].s
    return Espina(
        puntos=puntos,
        grosores=_grosores(puntos, largo, base, punta, "monotono", estilo, fases, 1.0),
        largo=largo,
    )


def _altura_guirnalda(
    t: float, largo: float, forma: str, caida: float, tramos: int, estilo: Estilo
) -> float:
    """Alto de la línea guía de una guirnalda (m) en la fracción ``t``, sobre su base.

    Las formas son las del armado (``armado_guirnalda.FORMAS``) y cuáles cuelgan
    lo dice el contrato (``FORMAS_CON_CAIDA``), no una lista repetida aquí.
    """
    if forma == "curva":
        return estilo.arqueo * largo * 4 * t * (1 - t)
    if forma == "ondulada":
        # Desplazada para que la onda entera quede sobre la base, no medio
        # cortada por el suelo.
        return estilo.onda * largo * (1 + math.sin(math.tau * estilo.ondas * t))
    if forma == "u_invertida":
        return caida * math.sin(math.pi * t)
    if forma == "arco_caido":
        u = (t * tramos) % 1.0 if t < 1.0 else 1.0
        return caida - caida * 4 * u * (1 - u)
    return 0.0


def _espina_guirnalda(
    medidas: Medidas,
    base: float,
    punta: float,
    forma: str,
    caida: float,
    anclajes: int,
    estilo: Estilo,
    fases: Sequence[float],
) -> Espina:
    """Tira horizontal de extremo a extremo, con la forma de su armado.

    El largo va de 0 a ``largo_m`` (o ``ancho_m``); el alto lo pone la propia
    banda y la caída, porque el plan no mide el alto de una guirnalda. El grosor
    va de los extremos al centro.
    """
    largo_x = medidas.largo_m or medidas.ancho_m
    tramos = max(1, anclajes - 1) if forma == "arco_caido" else 1
    piso = base / 2
    crudos: list[tuple[float, float]] = []
    for i in range(_N_PUNTOS + 1):
        t = i / _N_PUNTOS
        temblor = (
            0.012
            * min(largo_x, 6.0)
            * estilo.ondulacion
            * math.sin(math.tau * (3 + fases[1] * 2) * t + fases[2] * math.tau)
            * math.sin(math.pi * t)
        )
        alto = _altura_guirnalda(t, largo_x, forma, caida, tramos, estilo)
        crudos.append((largo_x * t, max(piso, piso + alto + temblor)))
    puntos = _medir(crudos)
    largo = puntos[-1].s
    frecuencia = max(1.0, largo_x / 3)
    return Espina(
        puntos=puntos,
        grosores=_grosores(puntos, largo, base, punta, "arco", estilo, fases, frecuencia),
        largo=largo,
    )


# --- Construcción de la silueta -----------------------------------------------


def _diametro_dominante_m(cupos: tuple[Cupo, ...]) -> float:
    """Diámetro (m) del tamaño que más globos aporta.

    Es la unidad con la que se mide una mordida del borde: un borde que muerde
    menos de un globo no se distingue de uno recto.
    """
    if not cupos:
        return 0.0
    dominante = max(cupos, key=lambda cupo: (cupo.cantidad, cupo.pulgadas))
    return dominante.pulgadas * 0.0254


def _fases(semilla: int) -> tuple[float, ...]:
    """Ocho números sorteados de una vez: la forma no cambia por otra perilla."""
    azar = _Azar(semilla * 7919 + 13)
    return tuple(azar() for _ in range(8))


def _validar(peticion: Peticion) -> None:
    tipo = peticion.tipo
    if tipo not in TIPOS:
        raise SiluetaInvalida("tipo_desconocido", f"El motor no dibuja «{tipo}».")
    medidas = peticion.medidas
    if tipo == "guirnalda":
        if (medidas.largo_m or medidas.ancho_m) <= 0:
            raise SiluetaInvalida(
                "sin_largo", "Una guirnalda necesita su largo (o su ancho) en metros."
            )
    elif tipo == "columna":
        if medidas.alto_m <= 0:
            raise SiluetaInvalida("sin_alto", "Una columna necesita su alto en metros.")
    elif medidas.ancho_m <= 0 or medidas.alto_m <= 0:
        raise SiluetaInvalida(
            "sin_medidas", f"Un {tipo.replace('_', ' ')} necesita su ancho y su alto en metros."
        )
    if tipo in _TIPOS_BANDA:
        if peticion.grosor_m is None or peticion.grosor_m <= 0:
            raise SiluetaInvalida(
                "sin_grosor",
                "El grosor de la banda lo mide quien la cotiza, no el motor:"
                " pásalo en metros.",
            )
        if peticion.grosor_punta_m is not None and peticion.grosor_punta_m <= 0:
            raise SiluetaInvalida("grosor_punta_invalido", "El grosor de la punta no es positivo.")
    elif peticion.grosor_m is not None or peticion.grosor_punta_m is not None:
        raise SiluetaInvalida(
            "grosor_en_pared",
            "Una pared es un área, no una banda: no lleva grosor, lleva capas.",
        )
    if peticion.forma is not None:
        if tipo != "guirnalda":
            raise SiluetaInvalida(
                "forma_sin_guirnalda", "Solo una guirnalda se arma con una forma."
            )
        if peticion.forma not in FORMAS_GUIRNALDA:
            raise SiluetaInvalida(
                "forma_desconocida", f"«{peticion.forma}» no es una forma de guirnalda."
            )
    if peticion.caida_m is not None:
        if (peticion.forma or "recta") not in FORMAS_CON_CAIDA:
            raise SiluetaInvalida(
                "caida_sin_forma_colgante", "Esa forma no cuelga: no tiene caída."
            )
        if peticion.caida_m <= 0:
            raise SiluetaInvalida("caida_invalida", "La caída no es positiva.")
    if not peticion.cupos:
        raise SiluetaInvalida("sin_cupos", "Sin cupos no hay globos que colocar.")
    for cupo in peticion.cupos:
        if cupo.pulgadas <= 0:
            raise SiluetaInvalida("tamano_invalido", "Un tamaño nominal no es positivo.")
        if cupo.cantidad < 0:
            raise SiluetaInvalida("cantidad_invalida", "Un cupo no puede ser negativo.")
    total = peticion.total
    if total <= 0:
        raise SiluetaInvalida("sin_globos", "Los cupos suman cero globos.")
    if total > MAX_GLOBOS:
        raise SiluetaInvalida(
            "demasiados_globos",
            f"La pieza saldría con {total} globos por instancia y la gráfica admite"
            f" hasta {MAX_GLOBOS}: divídela en piezas más pequeñas.",
        )


def crear_silueta(peticion: Peticion) -> Silueta:
    """El contorno de la estructura, en metros, sin globos todavía."""
    _validar(peticion)
    tipo = peticion.tipo
    medidas = peticion.medidas
    estilo = peticion.estilo
    fases = _fases(peticion.semilla)
    if tipo in _TIPOS_PARED:
        lado_menor = min(medidas.ancho_m, medidas.alto_m)
        # La mordida se mide en GLOBOS, no en fracción de la pieza: la misma
        # fracción daba media mordida en una pared pequeña y dos en una grande,
        # y lo que hace que un borde se lea como roto es que falte un globo.
        # `borde_vivo` sigue mandando: en 0 la pared vuelve al rectángulo limpio.
        amplitud = (
            min(
                _MORDIDA_EN_GLOBOS * _diametro_dominante_m(peticion.cupos),
                _BORDE_VIVO_TOPE * lado_menor,
            )
            if tipo == "pared_organica" and estilo.borde_vivo > 0.0
            else 0.0
        )
        borde = Borde(
            ancho_m=medidas.ancho_m,
            alto_m=medidas.alto_m,
            amplitud=amplitud,
            fases=fases,
        )
        return Silueta(
            tipo=tipo,
            medidas=medidas,
            espina=None,
            borde=borde,
            caja=(0.0, 0.0, medidas.ancho_m, medidas.alto_m),
        )

    base = cast(float, peticion.grosor_m)
    punta = peticion.grosor_punta_m if peticion.grosor_punta_m is not None else base
    if tipo == "arco":
        espina = _espina_arco(medidas, base, punta, estilo, fases)
        caja = (0.0, 0.0, medidas.ancho_m, medidas.alto_m)
    elif tipo == "semiarco":
        espina = _espina_semiarco(medidas, base, punta, estilo, fases)
        caja = (0.0, 0.0, medidas.ancho_m, medidas.alto_m)
    elif tipo == "columna":
        espina = _espina_columna(medidas, base, punta, estilo, fases)
        ancho = max(medidas.ancho_m, base + 2 * abs(estilo.serpenteo_m))
        caja = (0.0, 0.0, ancho, medidas.alto_m)
    else:
        caida = peticion.caida_m or 0.0
        espina = _espina_guirnalda(
            medidas,
            base,
            punta,
            peticion.forma or "recta",
            caida,
            peticion.anclajes or 2,
            estilo,
            fases,
        )
        largo_x = medidas.largo_m or medidas.ancho_m
        cima = max(
            punto.y + grosor / 2
            for punto, grosor in zip(espina.puntos, espina.grosores, strict=True)
        )
        caja = (0.0, 0.0, largo_x, cima)
    return Silueta(tipo=tipo, medidas=medidas, espina=espina, borde=None, caja=caja)


# --- Empaquetado --------------------------------------------------------------


@dataclass
class _Globo:
    """Un globo mientras se acomoda (mutable; se congela al devolverlo)."""

    x: float
    y: float
    r: float
    nominal: int
    racimo: int
    #: Ganas de estar al frente: 0 = al fondo, 1 = delante de todo. Los grandes
    #: tiran hacia el frente. ``_repartir_capas`` lo convierte en la capa.
    puntaje: float
    capa: int = 0
    #: Índice del punto de espina más cercano (solo en siluetas de banda).
    si: int = 0
    #: Se sale del borde de la banda (los salientes rompen la línea).
    saliente: bool = False


#: Cuánta fracción de una superficie llega a cubrir una capa de círculos de
#: tamaños mezclados bien apretados. Por encima de esto no caben: hay que
#: apilar otra capa detrás.
_APRETADO = 0.82
#: Tope de capas de profundidad. Más que esto no se distingue al dibujarlo.
_CAPAS_TOPE = 6


def _area_globos(cupos: Sequence[Cupo]) -> float:
    """Superficie (m²) que suman los globos pedidos, al diámetro nominal inflado."""
    return sum(
        cupo.cantidad * math.pi * (diametro_inflado_m(cupo.pulgadas) / 2) ** 2 for cupo in cupos
    )


def _capas(area_globos: float, area_silueta: float) -> int:
    """Cuántas capas de profundidad hacen falta para que quepan esos globos.

    Sale de la superficie, no del grosor ni de la densidad comercial: si el
    llamador pide 400 globos en una pared de 2,4 × 2,4 m, es que la pared va
    cuatro globos de fondo, y dibujarlos todos en dos capas los metería unos
    dentro de otros. Nunca menos de dos —hasta la banda más delgada tiene
    globos delante y detrás— ni más de ``_CAPAS_TOPE``.
    """
    if area_silueta <= 0:
        return 2
    necesarias = math.ceil(area_globos / (area_silueta * _APRETADO) - _EPS)
    return int(_acotar(necesarias, 2, _CAPAS_TOPE))


def _diametro_medio(cupos: Sequence[Cupo]) -> float:
    total = sum(cupo.cantidad for cupo in cupos) or 1
    return sum(diametro_inflado_m(c.pulgadas) * c.cantidad for c in cupos) / total


def _sembrar(silueta: Silueta, peticion: Peticion) -> list[_Globo]:
    """Siembra racimos y reparte los globos de cada cupo a su alrededor.

    Los cupos se respetan exactamente: cada globo consume una unidad de un
    tamaño, y cuando un tamaño se agota deja de sortearse. El sesgo de «grandes
    abajo» solo cambia el ORDEN en que se gastan los cupos, nunca cuántos hay.
    """
    estilo = peticion.estilo
    azar = _Azar(peticion.semilla * 104729 + 7)
    restantes = [cupo.cantidad for cupo in peticion.cupos]
    nominales = [cupo.pulgadas for cupo in peticion.cupos]
    rangos = [_rango(pulgadas) for pulgadas in nominales]
    rango_max = max(abs(valor) for valor in rangos) or 1.0
    diametro = _diametro_medio(peticion.cupos)
    quedan = sum(restantes)
    centros = _centros(silueta, peticion, azar)
    por_racimo = _miembros(quedan, len(centros), azar)
    globos: list[_Globo] = []
    for indice, centro in enumerate(centros):
        if quedan <= 0:
            break
        cx, cy, fraccion, grosor, si = centro
        miembros = por_racimo[indice]
        baseza = silueta.baseza(fraccion, cy)
        for _ in range(miembros):
            if quedan <= 0:
                break
            k = _elegir_tamano(
                restantes, rangos, nominales, baseza, estilo.grandes_abajo, grosor, azar
            )
            restantes[k] -= 1
            quedan -= 1
            nominal = nominales[k]
            r = diametro_inflado_m(nominal) * (1 - estilo.variacion_inflado * azar()) / 2
            normalizado = _acotar((rangos[k] + rango_max) / (2 * rango_max), 0.0, 1.0)
            puntaje = azar() ** (1.6 - 1.1 * normalizado)
            angulo = azar() * math.tau
            radio = diametro * 0.62 * math.sqrt(azar())
            globos.append(
                _Globo(
                    x=cx + math.cos(angulo) * radio,
                    y=cy + math.sin(angulo) * radio,
                    r=r,
                    nominal=nominal,
                    racimo=indice,
                    puntaje=puntaje,
                    si=si,
                    saliente=azar() < estilo.salientes * 0.3,
                )
            )
    return globos


def _repartir_capas(globos: list[_Globo], capas: int) -> None:
    """Reparte los globos entre las capas, con la misma carga en cada una.

    Los grandes tiran al frente (``puntaje``), pero una capa no puede quedarse
    con la mitad de los globos: si se amontonan en el fondo, ahí se meten unos
    dentro de otros y la profundidad no se aprovecha. El orden de desempate es
    el de colocación, así que el reparto es determinista.
    """
    orden = sorted(range(len(globos)), key=lambda i: (globos[i].puntaje, i))
    for puesto, i in enumerate(orden):
        globos[i].capa = min(capas - 1, puesto * capas // max(1, len(globos)))


def _miembros(total: int, cuantos: int, azar: _Azar) -> tuple[int, ...]:
    """Cuántos globos arma cada racimo. La suma es exactamente ``total``.

    Los racimos de un decorador no son todos del mismo tamaño, así que el
    reparto lleva un salto por racimo; el mayor resto se queda con lo que sobra
    para que no se pierda ni se invente un globo.
    """
    if cuantos <= 0:
        return ()
    pesos = [1.0 + (azar() - 0.5) * 0.5 for _ in range(cuantos)]
    suma = sum(pesos)
    exactos = [total * peso / suma for peso in pesos]
    enteros = [int(math.floor(valor)) for valor in exactos]
    faltan = total - sum(enteros)
    orden = sorted(range(cuantos), key=lambda i: (-(exactos[i] - enteros[i]), i))
    for i in orden[:faltan]:
        enteros[i] += 1
    return tuple(enteros)


def _elegir_tamano(
    restantes: Sequence[int],
    rangos: Sequence[float],
    nominales: Sequence[int],
    baseza: float,
    grandes_abajo: float,
    grosor: float,
    azar: _Azar,
) -> int:
    """Índice del cupo del que sale el próximo globo.

    Pesa lo que queda de cada cupo por dos sesgos de oficio: los grandes tienden
    a la base y un globo mucho más gordo que la banda casi no entra donde la
    banda es delgada. Nunca elige un cupo agotado.
    """
    pesos: list[float] = []
    for i, queda in enumerate(restantes):
        if queda <= 0:
            pesos.append(0.0)
            continue
        cabe = 1.0 if grosor <= 0 or diametro_inflado_m(nominales[i]) <= grosor * 1.2 else 0.06
        pesos.append(queda * cabe * math.exp(grandes_abajo * 2.2 * rangos[i] * (baseza - 0.4)))
    suma = sum(pesos)
    if suma <= 0:  # todos los cupos que quedan son demasiado grandes para la banda
        return max(range(len(restantes)), key=lambda i: (restantes[i], -nominales[i]))
    objetivo = azar() * suma
    acumulado = 0.0
    for i, peso in enumerate(pesos):
        acumulado += peso
        if objetivo <= acumulado:
            return i
    return max(range(len(pesos)), key=lambda i: pesos[i])


def _centros(
    silueta: Silueta, peticion: Peticion, azar: _Azar
) -> list[tuple[float, float, float, float, int]]:
    """Centros de racimo: ``(x, y, fracción, grosor, índice de espina)``.

    En una banda se reparten a lo largo de la espina, más juntos donde la banda
    es más gruesa; en una pared, sobre una rejilla con el paso justo para el
    total y con un salto por celda, así que el reparto es parejo pero no se lee
    como una cuadrícula.
    """
    total = peticion.total
    por_racimo = max(2, peticion.estilo.racimo)
    cuantos = max(1, math.ceil(total / por_racimo))
    if silueta.espina is not None:
        espina = silueta.espina
        acumulado = [0.0]
        for i in range(1, len(espina.puntos)):
            paso = espina.puntos[i].s - espina.puntos[i - 1].s
            acumulado.append(acumulado[-1] + espina.grosores[i] * paso)
        medida = acumulado[-1] or 1.0
        centros: list[tuple[float, float, float, float, int]] = []
        desfase = azar()
        for c in range(cuantos):
            u = (desfase + c * 0.6180339887) % 1.0
            si = _indice_por_medida(acumulado, u * medida)
            punto = espina.puntos[si]
            grosor = espina.grosores[si]
            desvio = (azar() - 0.5) * grosor * 0.5
            centros.append(
                (
                    punto.x + punto.nx * desvio,
                    punto.y + punto.ny * desvio,
                    punto.s / espina.largo if espina.largo else 0.0,
                    grosor,
                    si,
                )
            )
        return centros
    assert silueta.borde is not None
    _, _, ancho, alto = silueta.caja
    columnas = max(1, int(round(math.sqrt(cuantos * ancho / max(alto, _EPS)))))
    filas = max(1, math.ceil(cuantos / columnas))
    salida: list[tuple[float, float, float, float, int]] = []
    for fila in range(filas):
        for columna in range(columnas):
            if len(salida) >= cuantos:
                break
            x = ancho * (columna + 0.5 + (azar() - 0.5) * 0.7) / columnas
            y = alto * (fila + 0.5 + (azar() - 0.5) * 0.7) / filas
            salida.append((x, y, 0.0, 0.0, 0))
    return salida


def _indice_por_medida(acumulado: Sequence[float], objetivo: float) -> int:
    bajo, alto = 0, len(acumulado) - 1
    while alto - bajo > 1:
        medio = (bajo + alto) // 2
        if acumulado[medio] <= objetivo:
            bajo = medio
        else:
            alto = medio
    return bajo


def _adentro(valor: float, minimo: float, maximo: float, fuerza: float) -> float:
    """Empuja ``valor`` hacia ``[minimo, maximo]`` por ``fuerza`` de lo que se pasa.

    Con ``fuerza = 1`` lo mete de golpe. Durante la relajación se empuja poco: si
    a cada vuelta se pegara al borde, los globos que la multitud empuja hacia
    afuera acabarían todos apilados sobre la misma línea, unos dentro de otros
    (borde de una pared densa, 2026-09-29).
    """
    if maximo < minimo:
        return (minimo + maximo) / 2
    if valor < minimo:
        return valor + (minimo - valor) * fuerza
    if valor > maximo:
        return valor - (valor - maximo) * fuerza
    return valor


def _encajar(globo: _Globo, silueta: Silueta, fuerza: float = 0.65) -> float:
    """Mete el globo dentro de la silueta y devuelve cuánto lo movió (m)."""
    x0, y0, x1, y1 = silueta.caja
    antes_x, antes_y = globo.x, globo.y
    if silueta.espina is not None:
        espina = silueta.espina
        ultimo = len(espina.puntos) - 1
        mejor, distancia = globo.si, math.inf
        for q in range(max(0, globo.si - 14), min(ultimo, globo.si + 14) + 1):
            punto = espina.puntos[q]
            d2 = (punto.x - globo.x) ** 2 + (punto.y - globo.y) ** 2
            if d2 < distancia:
                distancia, mejor = d2, q
        globo.si = mejor
        punto = espina.puntos[mejor]
        fuera = (globo.x - punto.x) * punto.nx + (globo.y - punto.y) * punto.ny
        limite = max(0.04, espina.grosores[mejor] / 2 - globo.r * 0.85) + (
            globo.r * 0.95 if globo.saliente else 0.0
        )
        if abs(fuera) > limite:
            correccion = (abs(fuera) - limite) * fuerza * math.copysign(1.0, fuera)
            globo.x -= punto.nx * correccion
            globo.y -= punto.ny * correccion
        # Cohesión suave hacia la línea guía, para que la banda no se abra.
        globo.x -= punto.nx * fuera * 0.012
        globo.y -= punto.ny * fuera * 0.012
    else:
        borde = silueta.borde
        assert borde is not None
        # El borde vivo muerde hacia dentro: un globo que lo pisa vuelve al
        # lado más cercano, así que la pared orgánica se lee irregular en el
        # contorno y llena en el medio.
        globo.x = _adentro(
            globo.x,
            borde.x_izq(globo.y) + globo.r,
            borde.x_der(globo.y) - globo.r,
            fuerza,
        )
        globo.y = _adentro(
            globo.y,
            borde.y_inf(globo.x) + globo.r,
            borde.y_sup(globo.x) - globo.r,
            fuerza,
        )
    globo.x = _adentro(globo.x, x0 + globo.r, x1 - globo.r, fuerza)
    globo.y = _adentro(globo.y, y0 + globo.r, y1 - globo.r, fuerza)
    return math.hypot(globo.x - antes_x, globo.y - antes_y)


def _rejilla(globos: Sequence[_Globo], celda: float) -> dict[tuple[int, int], list[int]]:
    casillas: dict[tuple[int, int], list[int]] = {}
    for i, globo in enumerate(globos):
        clave = (int(globo.x // celda), int(globo.y // celda))
        casillas.setdefault(clave, []).append(i)
    return casillas


def _vecinos(
    casillas: Mapping[tuple[int, int], Sequence[int]], globo: _Globo, celda: float
) -> list[int]:
    cx, cy = int(globo.x // celda), int(globo.y // celda)
    salida: list[int] = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            salida.extend(casillas.get((cx + dx, cy + dy), ()))
    return salida


def _relajar(
    globos: list[_Globo], silueta: Silueta, vueltas: int, borde: float = 0.65
) -> None:
    """Empuja los globos hasta que quedan apretados y dentro de la silueta."""
    if not globos:
        return
    celda = max(globo.r for globo in globos) * 2 or 0.1
    vueltas = max(1, vueltas)
    calmas = 0
    for vuelta in range(vueltas):
        fuerza = 0.5 if vuelta < vueltas * 0.75 else 0.35
        casillas = _rejilla(globos, celda)
        mayor = 0.0
        for i, a in enumerate(globos):
            for j in _vecinos(casillas, a, celda):
                if j <= i:
                    continue
                b = globos[j]
                dx, dy = b.x - a.x, b.y - a.y
                distancia = math.hypot(dx, dy) or 1e-6
                minimo = (a.r + b.r) * (1 - _PENETRACION[min(3, abs(a.capa - b.capa))])
                if distancia >= minimo:
                    continue
                empuje = (minimo - distancia) * fuerza
                mayor = max(mayor, empuje)
                peso = (b.r * b.r) / (a.r * a.r + b.r * b.r)
                ux, uy = dx / distancia, dy / distancia
                a.x -= ux * empuje * peso
                a.y -= uy * empuje * peso
                b.x += ux * empuje * (1 - peso)
                b.y += uy * empuje * (1 - peso)
        for globo in globos:
            mayor = max(mayor, _encajar(globo, silueta, borde))
        calmas = calmas + 1 if mayor < 0.0015 else 0
        if vuelta > vueltas // 2 and calmas >= 3:
            break


def _pegar(globos: list[_Globo], silueta: Silueta) -> int:
    """Acerca al vecino más cercano los globos que quedaron flotando.

    Devuelve cuántos seguían sueltos al final: un globo suelto en la gráfica se
    lee como un error de armado, así que sirve de diagnóstico.
    """
    if len(globos) < 2:
        return 0
    celda = max(globo.r for globo in globos) * 3 or 0.1
    sueltos = 0
    for _ in range(3):
        casillas = _rejilla(globos, celda)
        sueltos = 0
        for i, a in enumerate(globos):
            mejor, hueco = -1, math.inf
            for j in _vecinos(casillas, a, celda):
                if j == i:
                    continue
                b = globos[j]
                separacion = math.hypot(b.x - a.x, b.y - a.y) - (a.r + b.r)
                if separacion < hueco:
                    hueco, mejor = separacion, j
            if mejor < 0 or hueco <= 0.08 * a.r:
                continue
            sueltos += 1
            b = globos[mejor]
            distancia = math.hypot(b.x - a.x, b.y - a.y) or 1e-6
            objetivo = (a.r + b.r) * 0.86
            a.x = b.x - (b.x - a.x) / distancia * objetivo
            a.y = b.y - (b.y - a.y) / distancia * objetivo
            _encajar(a, silueta)
    return sueltos


#: Por debajo de esta razón entre la distancia y la suma de radios, dos globos
#: de la MISMA capa no están uno al lado del otro: están uno dentro del otro.
#: Entre capas distintas ese solape es normal y es lo que da la profundidad.
_JUNTOS = 0.55


def _razon(a: _Globo, b: _Globo) -> float:
    return math.hypot(b.x - a.x, b.y - a.y) / (a.r + b.r)


def _desapilar(globos: list[_Globo], capas: int) -> None:
    """Manda a otra capa a los globos que quedaron dentro de otro de la suya.

    Cuando el llamador pide más globos de los que caben, la relajación llega a
    un empate en el que dos globos comparten sitio. Si comparten sitio y capa,
    la gráfica los dibuja como un globo deforme; si uno pasa a otra capa, se
    leen como lo que son en una estructura real: uno delante del otro. La capa
    es la única libertad que queda, porque la posición ya la fijó la silueta y
    el tamaño lo fijó el cupo.
    """
    if capas < 2 or len(globos) < 2:
        return
    celda = max(globo.r for globo in globos) * 2 or 0.1
    for _ in range(2):
        casillas = _rejilla(globos, celda)
        for i, globo in enumerate(globos):
            vecinos = [globos[j] for j in _vecinos(casillas, globo, celda) if j != i]
            if not vecinos:
                continue
            sitio = [math.inf] * capas
            for vecino in vecinos:
                sitio[vecino.capa] = min(sitio[vecino.capa], _razon(globo, vecino))
            if sitio[globo.capa] >= _JUNTOS:
                continue
            mejor = max(range(capas), key=lambda c: (sitio[c], -abs(c - globo.capa)))
            if sitio[mejor] > sitio[globo.capa]:
                globo.capa = mejor


def disponer(peticion: Peticion) -> Disposicion:
    """Crea la silueta y coloca en ella exactamente los globos de los cupos."""
    return disponer_en(crear_silueta(peticion), peticion)


def disponer_en(silueta: Silueta, peticion: Peticion) -> Disposicion:
    """Coloca los globos de ``peticion`` sobre una silueta ya creada.

    Separar los dos pasos permite dibujar la misma silueta con otros cupos (o
    medir su área) sin volver a construir la curva.
    """
    _validar(peticion)
    capas = _capas(_area_globos(peticion.cupos), silueta.area_m2)
    vueltas = max(1, peticion.estilo.vueltas)
    globos = _sembrar(silueta, peticion)
    _repartir_capas(globos, capas)
    # Primero con el borde flojo, para que nadie se apile sobre la línea del
    # contorno; luego con el borde firme, que es el que manda: ningún globo
    # se sale de las medidas que pidió el cliente.
    _relajar(globos, silueta, vueltas, borde=0.65)
    _pegar(globos, silueta)
    _relajar(globos, silueta, max(8, vueltas // 3), borde=1.0)
    _desapilar(globos, capas)
    area_globos = sum(math.pi * globo.r**2 for globo in globos)
    return Disposicion(
        silueta=silueta,
        globos=tuple(
            GloboSilueta(
                x=globo.x,
                y=globo.y,
                r=globo.r,
                capa=globo.capa,
                nominal=globo.nominal,
                indice=i,
                racimo=globo.racimo,
            )
            for i, globo in enumerate(globos)
        ),
        capas=capas,
        ocupacion=area_globos / max(silueta.area_m2, _EPS),
    )


__all__ = [
    "ESTILO",
    "FACTOR_INFLADO",
    "MAX_GLOBOS",
    "TIPOS",
    "Borde",
    "Cupo",
    "Disposicion",
    "Espina",
    "Estilo",
    "GloboSilueta",
    "Medidas",
    "Peticion",
    "PuntoEspina",
    "Silueta",
    "SiluetaInvalida",
    "TipoSilueta",
    "crear_silueta",
    "cupos_desde_mezcla",
    "diametro_inflado_m",
    "disponer",
    "disponer_en",
    "mezcla_del_contrato",
]
