"""Motor del arco clásico, porteado entero de ``clasificador-decoraciones``.

Es la traducción a Python de ``src/lib/arco/motor.ts`` de ese repositorio: la
línea guía del arco, el empaquetado escalonado de los globos sobre la banda, la
compensación de la curva y la profundidad. Porteado **entero**, y eso incluye
lo que antes no se trajo: **el conteo sale del dibujo**.

Por qué entero, y no solo la colocación. El primer intento (2026-10-01, por la
mañana) se trajo la colocación pero conservó un modelo de conteo propio —anillos
de ``k`` globos, ``anillos × k``— y dejó una costura entre dos modelos. Todos
los defectos de esa pasada salieron de ahí: la banda quedaba aplastada (cuatro
globos metidos a la fuerza en el ancho de un racimo, columnas a 0,40 diámetros
contra los 0,88 de la referencia), la espiral se dibujaba como un damero, y cada
arreglo abría otro frente. Con un solo modelo no hay costura: el motor coloca y
cuenta lo que colocó, igual que allá.

Lo que **sí** sigue siendo de este repositorio, y no se puede importar:

* **El número es comercial.** Sale de Python y es determinista, que es lo que
  pide la regla; lo que cambia es que ahora sale de contar globos puestos y no
  de una fórmula. A cambio, las perillas del dibujo (los globos a lo ancho y la
  separación entre filas) pasan a ser perillas comerciales: moverlas mueve el
  precio. Por eso las fija la **densidad** y viven en el contrato, no aquí.
* **No cotiza.** Devuelve globos y posiciones; el despiece por producto, color y
  variante sigue siendo de ``app.plan``.
* **No asigna colores.** La salida es geometría con la fila y el carril de cada
  globo, que es la rejilla sobre la que ``app.patron_color`` pinta.
* **No dibuja.** Sin SVG y sin píxeles: las posiciones van en metros y quien las
  dibuja es la interfaz. Lo que del original NO se trajo es justo su ``dibujar``.

Determinismo: sin azar. El original admite variación de tamaño, desorden y
variación de tono; aquí no se porteó ninguna, porque un arco clásico es regular
y porque el conteo no puede depender de una semilla.

Puro: sin red, sin base de datos, sin FastAPI.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Literal, cast

# El empaquetado escalonado vive en ``app.banda_escalonada`` para que el
# patrón pueda leerlo sin cerrar un ciclo de importación. Se reexporta aquí
# porque es parte de este motor y porque quien ya lo importaba de aquí sigue
# igual (``carril_de`` y ``carril_sin_globo`` los lee ``app.plan``).
from app.arco_saneado import (
    MAX_GLOBOS_ANCHO,
    MIN_GLOBOS_ANCHO,
    RAZON_GROSOR_MAX,
    SOLAPE,
    globos_ancho_maximo,
    paso_columna_m,
    sanear,
)
from app.banda_escalonada import carril_de, carril_sin_globo, columna_de
from app.generated_models import contract_schema
from app.silueta import MAX_GLOBOS, diametro_inflado_m

#: La superficie pública del motor. Incluye lo que se reexporta de
#: ``app.arco_saneado`` y de ``app.banda_escalonada``: están partidos por un
#: ciclo de importación, no porque sean otra cosa, y quien los importaba de aquí
#: antes de la partición sigue igual.
__all__ = [
    "ARMADO_POR_DENSIDAD",
    "Arco",
    "ArcoArmado",
    "ArcoInvalido",
    "COMPENSACION",
    "FormaArco",
    "GloboArco",
    "MAX_GLOBOS_ANCHO",
    "MIN_GLOBOS_ANCHO",
    "OVALO",
    "PASO_GIRO",
    "RAZON_GROSOR_MAX",
    "SOLAPE",
    "VANO_MINIMO_M",
    "arco_de_densidad",
    "armar",
    "cabe_como_arco",
    "carril_de",
    "carril_sin_globo",
    "columna_de",
    "contar",
    "globos_ancho_maximo",
    "globos_ancho_que_cabe",
    "grosor_banda_m",
    "paso_columna_m",
    "sanear",
    "vano_m",
]

_EPS = 1e-9


#: Formas del arco, las tres del original. ``alto`` es la media elipse,
#: ``semi`` el semicírculo y ``herradura`` dos patas rectas con el semicírculo
#: encima, que es como se arma cuando el alto pedido pasa del radio.
FormaArco = Literal["alto", "semi", "herradura"]

#: ``MIN_GLOBOS_ANCHO``, ``MAX_GLOBOS_ANCHO``, ``SOLAPE``, ``RAZON_GROSOR_MAX`` y
#: ``paso_columna_m`` viven en ``app.arco_saneado``, que es el porte de
#: ``limites.ts``, y se reexportan desde aquí: son del motor, pero su dueño es
#: quien decide qué arco es viable.

#: Alargamiento del globo a lo largo del arco (``globo.ovalo`` del original).
OVALO = 1.06

#: Ajuste en las curvas: los globos de afuera crecen y los de adentro se achican
#: para que todos se toquen parejo. 0 = ninguno, 1 = total.
COMPENSACION = 0.85

#: Topes del estiramiento de la curva. Evitan los dos extremos feos: un globo
#: diminuto en el borde interior de una curva cerrada y uno enorme en el
#: exterior.
_ESTIRAMIENTO_MINIMO = 0.92
_ESTIRAMIENTO_MAXIMO = 1.35

#: Alto de una fila en diámetros, el empaquetado hexagonal del original.
_ALTO_DE_FILA = 0.866

#: Filas mínimas del arco, como en el original: por debajo de seis no es un arco.
_FILAS_MINIMAS = 6

#: Paso con que se cuantiza el giro del globo, en grados. Es el ``PASO_ROT`` del
#: original, donde sirve para poder compartir un degradado por color y por giro.
PASO_GIRO = 15

#: Puntos con los que se muestrea la línea guía. Es el ``N`` del original.
_MUESTRAS = 1200

#: Cómo se arma un arco clásico según la densidad comercial declarada:
#: ``(globos a lo ancho, separación entre filas)``.
#:
#: **Es una regla comercial, no una perilla estética**: decide cuántos globos
#: lleva el arco y por tanto lo que cuesta. Por eso tiene un solo dueño y está
#: donde están las otras reglas de este tipo: ``src/lib/plan/mezclas.ts``, que
#: la exporta al contrato ``plan-decoracion.v1`` dentro de ``x-reglas-mezclas``
#: y de donde se lee aquí.
ARMADO_POR_DENSIDAD: dict[str, tuple[int, float]] = {
    densidad: (int(valores["globos_ancho"]), float(valores["separacion_filas"]))
    for densidad, valores in cast(
        dict[str, dict[str, float]],
        cast(dict[str, object], contract_schema("PlanDecoracion")["x-reglas-mezclas"])[
            "armado_arco_clasico"
        ],
    ).items()
}


class ArcoInvalido(ValueError):
    """Un arco que no se puede armar tal como se pidió.

    Lleva ``motivo`` estable para que quien lo traduzca no tenga que leer el
    texto.
    """

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(mensaje)
        self.motivo = motivo
        #: El texto, para quien lo traduce a un error de la API sin leer `str()`.
        self.mensaje = mensaje


# --- Entrada ------------------------------------------------------------------


@dataclass(frozen=True)
class Arco:
    """Un arco clásico tal como se pide: medidas exteriores y cómo se arma.

    ``globos_ancho`` y ``separacion_filas`` son las dos perillas del armado, y
    **sí deciden el número de globos**: son la definición de la densidad de un
    arco, no una preferencia estética. Quien las elige a partir de la densidad
    comercial declarada es quien llama.
    """

    ancho_m: float
    alto_m: float
    #: Tamaño nominal del globo. Un arco clásico es de un solo tamaño (la mezcla
    #: ``clasica`` del contrato es 100 % R-12).
    pulgadas: int = 12
    #: Globos que caben a lo ancho de la banda. Cuatro es el arco de referencia.
    globos_ancho: int = 4
    #: Separación entre filas: 1 es el empaquetado hexagonal justo, por debajo
    #: las filas se aprietan y entran más.
    separacion_filas: float = 1.0
    #: Cómo se monta la pieza. Con ``True`` es la **banda escalonada** del motor
    #: de referencia: las filas pares llevan ``globos_ancho`` y las impares una
    #: menos, corridas medio puesto. Es el empaquetado que hace que una espiral
    #: se trence, y es el de siempre.
    #:
    #: Con ``False`` son **anillos iguales**: todas las filas llevan los mismos
    #: globos, apiladas rectas. Es otro montaje, no otra forma de pintar, y es el
    #: que hace falta cuando cada anillo es de un color: con el escalonado, un
    #: color cae siempre en las filas de ``n`` y el otro en las de ``n − 1``, así
    #: que los anillos de un color salen más estrechos y hundidos, y el reparto
    #: no es mitad y mitad. Cuesta un 13-14 % más de globos.
    escalonado: bool = True


# --- Salida -------------------------------------------------------------------


@dataclass(frozen=True)
class GloboArco:
    """Un globo del arco, en metros y en el plano del dibujo.

    ``x`` crece a la derecha e ``y`` hacia arriba desde el piso, igual que en
    ``app.silueta``.
    """

    #: Fila a lo largo del arco, 0 en una pata y la última en la otra.
    fila: int
    #: Carril a lo ancho de la banda, contado desde el borde de afuera. Las
    #: filas van escalonadas, así que un carril puede quedarse sin globo en una
    #: fila: es el hueco del empaquetado, no un error.
    carril: int
    x: float
    y: float
    radio_m: float
    #: Radio a lo largo del arco: el globo es un poco ovalado (``OVALO``).
    radio_largo_m: float
    #: −1 (al borde de la banda, se oscurece) … 1 (en el centro, de frente). La
    #: banda es un tubo: el centro queda de cara al espectador y los dos bordes
    #: se van hacia atrás.
    profundidad: float
    #: Giro del globo en grados para el dibujo, ya cuantizado a 15° como en el
    #: original. Es el ángulo de la línea guía en ese punto, medido en el
    #: sistema de la PANTALLA (la ``y`` al revés que aquí), porque es quien lo
    #: usa: con él el óvalo del globo sigue el arco en vez de quedarse vertical.
    giro_grados: int


@dataclass(frozen=True)
class ArcoArmado:
    """El arco armado: sus filas, sus globos y sus medidas reales."""

    forma: FormaArco
    #: Filas a lo largo del arco. Con ``globos_ancho`` es la rejilla del patrón.
    filas: int
    #: Globos que caben a lo ancho de la banda.
    globos_ancho: int
    globos: tuple[GloboArco, ...]
    #: Globos del arco: los que el motor colocó. Es la cifra que se cotiza, y
    #: por el escalonado no es ``filas × globos_ancho`` sino algo menos.
    total: int
    #: Largo de la línea guía por el centro de la banda (m).
    largo_espina_m: float
    #: Ancho visible de la banda de globos (m).
    grosor_m: float
    #: Medidas exteriores con las que de verdad se armó, que pueden no ser las
    #: pedidas si algo no cabía.
    ancho_m: float
    alto_m: float
    #: Lo que no era posible tal como se pidió y cómo se resolvió.
    avisos: tuple[str, ...]

    def globos_de_fila(self, fila: int) -> int:
        """Globos que lleva esa fila: ``globos_ancho`` o uno menos si va escalonada."""
        return self.globos_ancho if fila % 2 == 0 else self.globos_ancho - 1


# --- Geometría de la banda ----------------------------------------------------


def grosor_banda_m(diametro_m: float, globos_ancho: int) -> float:
    """Ancho visible de la banda (m): ``globos a lo ancho × paso``."""
    return float(globos_ancho * paso_columna_m(diametro_m))


#: Hueco interior mínimo de un arco (m). Por debajo de esto las dos patas se
#: juntan y la pieza deja de ser un arco.
VANO_MINIMO_M = 0.30

def vano_m(ancho_m: float, diametro_m: float, globos_ancho: int) -> float:
    """Hueco que queda entre las dos patas del arco (m).

    El radio de la línea por el centro de la banda es ``(ancho − grosor) / 2``,
    así que entre las dos patas quedan ``ancho − 2 · grosor``. Puede salir
    negativo, que es la señal de que esa combinación no es un arco.
    """
    return ancho_m - 2 * grosor_banda_m(diametro_m, globos_ancho)


def globos_ancho_que_cabe(ancho_m: float, pulgadas: int, deseado: int) -> int:
    """Los globos a lo ancho que de verdad entran en un arco de ese ancho.

    La densidad **pide** un ancho de banda y el arco decide el que cabe
    (``arco_saneado.globos_ancho_maximo``, el porte de ``limites().nMax``).
    """
    return int(max(MIN_GLOBOS_ANCHO, min(deseado, globos_ancho_maximo(ancho_m, pulgadas))))


def cabe_como_arco(ancho_m: float, pulgadas: int, globos_ancho: int) -> bool:
    """Si ese arco se puede armar sin cerrarse, con la banda que le quepa.

    ``globos_ancho`` es el que **pide** la densidad: lo que se comprueba es la
    banda que de verdad se armaría (``globos_ancho_que_cabe``), porque es la que
    va a ir. Quien pregunta antes de armar puede contar esa pieza por otro camino
    en vez de recibir un fallo; quien arma sin preguntar recibe ``arco_sin_vano``.
    """
    cabe = globos_ancho_que_cabe(ancho_m, pulgadas, globos_ancho)
    return vano_m(ancho_m, diametro_inflado_m(pulgadas), cabe) >= VANO_MINIMO_M


#: Nombre anterior, que leía ``plan.py``. Se mantiene mientras quede algún
#: llamador; el motor ya no arma por anillos.
cabe_como_anillos = cabe_como_arco


# --- Línea guía ---------------------------------------------------------------


@dataclass(frozen=True)
class _Muestra:
    x: float
    y: float
    #: Tangente unitaria.
    tx: float
    ty: float
    #: Largo acumulado desde el arranque.
    s: float


@dataclass(frozen=True)
class _Espina:
    """La línea guía muestreada, igual que ``crearEspina`` del original."""

    forma: FormaArco
    puntos: tuple[_Muestra, ...]
    largo_m: float

    def en_largo(self, s: float) -> _Muestra:
        """El punto a ``s`` metros del arranque, interpolado entre muestras."""
        bajo, alto = 0, len(self.puntos) - 1
        while alto - bajo > 1:
            medio = (bajo + alto) // 2
            if self.puntos[medio].s <= s:
                bajo = medio
            else:
                alto = medio
        a, b = self.puntos[bajo], self.puntos[alto]
        u = (s - a.s) / (b.s - a.s) if b.s - a.s else 0.0
        return _Muestra(
            x=a.x + (b.x - a.x) * u, y=a.y + (b.y - a.y) * u, tx=a.tx, ty=a.ty, s=s
        )


def _crear_espina(forma: FormaArco, ancho_m: float, alto_m: float, grosor_m: float) -> _Espina:
    """Línea guía del arco según su forma, en metros y con ``y`` hacia arriba.

    Traducción de ``crearEspina``. El original trabaja en píxeles de un lienzo
    con la ``y`` hacia abajo; aquí se hace en metros con la ``y`` hacia arriba,
    que es el sistema de ``app.silueta``, y el arco va centrado en ``x = 0``.
    """
    radio = max(0.01, (ancho_m - grosor_m) / 2)
    altura = max(0.01, alto_m - grosor_m / 2)
    pata = max(0.0, alto_m - radio - grosor_m / 2)
    if forma == "herradura" and pata <= 0:
        forma = "semi"

    def punto(t: float) -> tuple[float, float]:
        if forma == "semi":
            return radio * math.cos(math.pi * (1 - t)), radio * math.sin(math.pi * t)
        if forma == "alto":
            return radio * math.cos(math.pi * (1 - t)), altura * math.sin(math.pi * t)
        total = 2 * pata + math.pi * radio
        s = t * total
        if s < pata:
            return -radio, s
        if s < pata + math.pi * radio:
            angulo = (s - pata) / radio
            return -radio * math.cos(angulo), pata + radio * math.sin(angulo)
        return radio, pata - (s - pata - math.pi * radio)

    crudos = [punto(i / _MUESTRAS) for i in range(_MUESTRAS + 1)]
    largos: list[float] = [0.0]
    for anterior, siguiente in zip(crudos, crudos[1:]):
        largos.append(largos[-1] + math.hypot(siguiente[0] - anterior[0], siguiente[1] - anterior[1]))
    muestras: list[_Muestra] = []
    for indice, (x, y) in enumerate(crudos):
        a = crudos[max(0, indice - 1)]
        b = crudos[min(_MUESTRAS, indice + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        modulo = math.hypot(dx, dy) or 1.0
        muestras.append(_Muestra(x=x, y=y, tx=dx / modulo, ty=dy / modulo, s=largos[indice]))
    return _Espina(forma=forma, puntos=tuple(muestras), largo_m=largos[-1])





# --- Armado -------------------------------------------------------------------


def _validar(arco: Arco) -> None:
    if arco.pulgadas <= 0:
        raise ArcoInvalido("tamano_invalido", "El tamaño nominal del globo debe ser positivo.")
    if arco.ancho_m <= 0:
        raise ArcoInvalido("sin_ancho", "Un arco necesita un ancho mayor que cero.")
    if arco.alto_m <= 0:
        raise ArcoInvalido("sin_alto", "Un arco necesita un alto mayor que cero.")


def armar(arco: Arco) -> ArcoArmado:
    """Arma el arco: cada globo en su sitio, y el total es lo que colocó.

    Traducción de ``generar`` del original, sin su dibujo y sin su azar.
    """
    _validar(arco)
    # Primero se sanea, como allá: ``sanear`` corre antes de ``generar`` y deja
    # un diseño viable más la lista de lo que le cambió. Aquí esa lista entra en
    # los avisos del armado, que es el canal que ya existía.
    medidas = sanear(
        arco.ancho_m, arco.alto_m, arco.globos_ancho, arco.pulgadas, arco.separacion_filas
    )
    arco = replace(
        arco,
        ancho_m=medidas.ancho_m,
        alto_m=medidas.alto_m,
        globos_ancho=medidas.globos_ancho,
        separacion_filas=medidas.separacion_filas,
    )
    diametro_m = diametro_inflado_m(arco.pulgadas)
    ancho = arco.globos_ancho
    paso = paso_columna_m(diametro_m)
    grosor_m = grosor_banda_m(diametro_m, ancho)
    avisos: list[str] = list(medidas.cambios)

    ancho_m = arco.ancho_m
    # El original NO falla nunca: si el arco es más angosto que su banda más
    # 0,30 m, lo ensancha y lo dice (``motor.ts``, ``anchoMinimo``). Antes aquí
    # se lanzaba ``arco_sin_vano``, que salía al cliente como un 422 o como un
    # croquis que desaparecía, donde allá había una pieza armada y un aviso.
    #
    # El 0,30 es margen sobre UN grosor, no sobre dos: es la red de último
    # recurso. Quien de verdad impide que la banda tape la abertura es
    # ``arco_saneado`` con su 36 %, y por eso los dos van juntos.
    ancho_minimo = grosor_m + VANO_MINIMO_M
    if ancho_m < ancho_minimo - _EPS:
        avisos.append(
            f"Con globos R-{arco.pulgadas} y {ancho} a lo ancho, la banda mide"
            f" {grosor_m:.2f} m: el arco no puede ser más angosto que"
            f" {ancho_minimo:.2f} m. Se ajustó el ancho."
        )
        ancho_m = ancho_minimo

    radio_m = (ancho_m - grosor_m) / 2
    alto_m = arco.alto_m
    forma: FormaArco = "herradura"
    if alto_m < radio_m + grosor_m / 2 - _EPS:
        avisos.append(
            f"El alto pedido ({alto_m:.2f} m) es menor que el de un semicírculo de"
            f" {ancho_m:.2f} m de ancho: el arco se dibuja como semicírculo."
        )
        forma = "semi"
        alto_m = radio_m + grosor_m / 2

    espina = _crear_espina(forma, ancho_m, alto_m, grosor_m)
    if espina.largo_m <= 0:
        raise ArcoInvalido(
            "arco_sin_largo",
            "Las medidas dejan la línea del arco en cero: revisa ancho y alto.",
        )

    # ``Math.round`` redondea la mitad HACIA ARRIBA; el ``round`` de Python la
    # redondea al par (2,5 -> 2). Con una fila de diferencia cambia el conteo, así
    # que aquí va la del original.
    filas = max(
        _FILAS_MINIMAS,
        math.floor(espina.largo_m / (paso * _ALTO_DE_FILA * arco.separacion_filas) + 0.5),
    )
    total = (filas + 1) // 2 * ancho + filas // 2 * (ancho - 1)
    if total > MAX_GLOBOS:
        raise ArcoInvalido(
            "demasiados_globos",
            f"Este arco pide {total} globos y el motor arma hasta {MAX_GLOBOS}:"
            " divídelo en piezas más pequeñas.",
        )

    paso_fila = espina.largo_m / filas
    radio_globo_m = diametro_m / 2
    globos: list[GloboArco] = []
    for fila in range(filas):
        s = (fila + 0.5) * paso_fila
        punto = espina.en_largo(s)
        # Normal hacia adentro del arco. En el sistema del original (``y`` hacia
        # abajo) es ``(−ty, tx)``; con la ``y`` hacia arriba, ``(ty, −tx)``.
        nx, ny = punto.ty, -punto.tx
        par = (not arco.escalonado) or fila % 2 == 0
        en_fila = ancho if par else ancho - 1
        # ``rotBase`` del original. Allí la tangente de pantalla es ``(tx, ty)``
        # con la ``y`` hacia abajo; aquí la ``y`` va hacia arriba, así que la de
        # pantalla es ``(tx, −ty)`` y el mismo ``atan2(−tx, ty)`` queda como
        # ``atan2(−tx, −ty)``. En la pata recta da 180° (el óvalo se queda
        # vertical, a lo largo del arco) y en la clave −90° (se tumba, también a
        # lo largo del arco).
        giro_grados = (
            round(math.degrees(math.atan2(-punto.tx, -punto.ty)) / PASO_GIRO) * PASO_GIRO
        ) % 360

        # Curvatura del arco en esta fila: en las curvas el borde de afuera es
        # más largo que el de adentro.
        antes = espina.en_largo(max(0.0, s - paso_fila))
        despues = espina.en_largo(min(espina.largo_m, s + paso_fila))
        giro = math.atan2(despues.ty, despues.tx) - math.atan2(antes.ty, antes.tx)
        while giro > math.pi:
            giro -= 2 * math.pi
        while giro < -math.pi:
            giro += 2 * math.pi
        curvatura = abs(giro) / max(1e-6, despues.s - antes.s)

        for puesto in range(en_fila):
            columna = puesto + 0.5 if par else puesto + 1.0
            # Hacia adentro del arco es positivo.
            v = (columna - ancho / 2) * paso
            estiramiento = (
                min(_ESTIRAMIENTO_MAXIMO, max(_ESTIRAMIENTO_MINIMO, 1 - curvatura * v))
                ** COMPENSACION
            )
            # 1 en el centro de la banda (de frente) y menos hacia los bordes.
            frente = math.cos((columna / ancho - 0.5) * math.pi * 0.9)
            radio = radio_globo_m * (0.92 + 0.08 * frente) * estiramiento
            globos.append(
                GloboArco(
                    fila=fila,
                    carril=carril_de(columna, ancho) if arco.escalonado else puesto,
                    x=punto.x + nx * v,
                    y=punto.y + ny * v,
                    radio_m=radio,
                    radio_largo_m=radio * OVALO,
                    profundidad=(frente - 0.6) / 0.6,
                    giro_grados=giro_grados,
                )
            )

    return ArcoArmado(
        forma=espina.forma,
        filas=filas,
        globos_ancho=ancho,
        globos=tuple(globos),
        total=len(globos),
        largo_espina_m=espina.largo_m,
        grosor_m=grosor_m,
        ancho_m=ancho_m,
        alto_m=alto_m,
        avisos=tuple(avisos),
    )


def contar(arco: Arco) -> int:
    """Globos que lleva el arco. Es ``armar(arco).total``, sin las posiciones."""
    return armar(arco).total


def arco_de_densidad(
    ancho_m: float,
    alto_m: float,
    densidad: str,
    pulgadas: int = 12,
    escalonado: bool = True,
) -> Arco:
    """El arco que le toca a esa densidad comercial."""
    armado = ARMADO_POR_DENSIDAD.get(densidad)
    if armado is None:
        raise ArcoInvalido(
            "densidad_desconocida",
            f"La densidad «{densidad}» no tiene armado de arco clásico; las que hay son"
            f" {', '.join(sorted(ARMADO_POR_DENSIDAD))}.",
        )
    deseado, separacion = armado
    return Arco(
        ancho_m=ancho_m,
        alto_m=alto_m,
        pulgadas=pulgadas,
        # La densidad pide una banda; el ancho del arco decide la que cabe.
        globos_ancho=globos_ancho_que_cabe(ancho_m, pulgadas, deseado),
        separacion_filas=separacion,
        escalonado=escalonado,
    )
