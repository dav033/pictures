"""Motor de la columna clásica, porteado de ``clasificador-decoraciones``.

Es la traducción a Python de ``src/lib/columna/motor.ts`` de ese repositorio: las
capas apiladas, el anillo de cada capa, el medio paso de giro entre capas y la
profundidad. Es el hermano de ``app.arco_clasico``, y se escribió igual por la
misma razón: **el conteo sale del armado**, no de una fórmula de densidad.

Qué es una columna clásica, en el modelo del original: una pila de **capas**, y
cada capa es un **anillo** de ``n`` globos repartidos alrededor del eje vertical
—cuatro es el cuarteto de toda la vida—. Cada capa va girada medio paso respecto
a la de abajo, que es lo que hace que los globos se encajen entre los de la capa
anterior. El total es ``capas × n``: un entero que se cuenta.

Antes de esto, una columna del plan **no tenía motor**: se contaba con la fórmula
λ (que no mira ni el diámetro de la pieza) y se dibujaba con el motor de silueta
**orgánico**, el de las guirnaldas, que siembra los racimos y los relaja. De ahí
salía una columna torcida y despareja en vez de una pila de anillos.

Lo que **sí** sigue siendo de este repositorio, y no se puede importar:

* **El número es comercial.** Sale de Python y es determinista; lo que cambia es
  que ahora sale de contar globos puestos. A cambio, las dos perillas del armado
  —globos por capa y compresión— pasan a ser perillas comerciales: las fija la
  **densidad** y viven en el contrato, no aquí.
* **No cotiza.** Devuelve globos y posiciones; el despiece por producto, color y
  variante sigue siendo de ``app.plan``.
* **No asigna colores.** La salida es geometría con la capa y el puesto de cada
  globo, que es la rejilla sobre la que ``app.patron_color`` pinta.
* **No dibuja.** Sin SVG y sin píxeles: las posiciones van en metros y quien las
  dibuja es la interfaz.

Lo que del original **no** se trajo:

* **El remate** (el globo grande, el racimo o el foil de la punta). Aquí no hay
  ningún concepto equivalente y añadirlo es tocar el contrato, así que va aparte.
* **Los dos tamaños de globo**, de abajo hacia arriba. Una columna clásica de
  este repositorio es de un solo diámetro —con varios, la pieza es orgánica y la
  cuenta el motor de siempre—, así que la convergencia de ``crearCapas`` que
  elige el tamaño por la altura no tiene nada que elegir. Si alguna vez se trae,
  **hay que portarla entera**: en el original el bloque `elegir`/`d`/`centro`
  está escrito dos veces a propósito, y es una iteración que converge, no un
  copiar y pegar.
* **El azar** (variación de tamaño, de tono y desorden). Una columna clásica es
  regular, y el conteo no puede depender de una semilla.

Puro: sin red, sin base de datos, sin FastAPI.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, cast

from app.generated_models import contract_schema
from app.silueta import MAX_GLOBOS, diametro_inflado_m

#: Diámetro del globo respecto a la separación entre vecinos del anillo: 1,14
#: quiere decir que se solapan un 12 %, que es lo que los hace verse tocándose.
#: Es el ``globo.tamano`` del original y su valor por defecto, el mismo que usa
#: ``app.arco_clasico``.
SOLAPE = 1.14

#: Globos por capa que admite el motor. Tres es el mínimo con el que un anillo
#: es un anillo; seis es el tope del original (``GLOBOS_CAPA_MIN/MAX``).
MIN_GLOBOS_CAPA = 3
MAX_GLOBOS_CAPA = 6

#: Alto de una capa respecto al diámetro del globo. El deslizador del original lo
#: llama «la fórmula profesional» en 0,80 y lo acota a este rango: por debajo las
#: capas se encaraman y por encima se separan.
COMPRESION_POR_DEFECTO = 0.8
MIN_COMPRESION = 0.7
MAX_COMPRESION = 1.0

#: Capas mínimas de una columna, como en el original: su búsqueda arranca en tres
#: y nunca devuelve menos, así que una columna muy baja recibe tres igual.
CAPAS_MINIMAS = 3

#: Tope del bucle de apilado del original. Es un seguro contra una altura
#: absurda, no una regla del oficio.
_MAX_CAPAS = 400

#: Cómo se arma una columna clásica según la densidad comercial declarada:
#: ``(globos por capa, compresión)``.
#:
#: **Es una regla comercial, no una perilla estética**: decide cuántos globos
#: lleva la pieza y por tanto lo que cuesta. Por eso tiene un solo dueño y está
#: donde están las otras de su clase: ``src/lib/plan/mezclas.ts``, que la exporta
#: al contrato ``plan-decoracion.v1`` dentro de ``x-reglas-mezclas`` y de donde se
#: lee aquí, igual que ``arco_clasico.ARMADO_POR_DENSIDAD``.
ARMADO_POR_DENSIDAD: dict[str, tuple[int, float]] = {
    densidad: (int(valores["globos_capa"]), float(valores["compresion"]))
    for densidad, valores in cast(
        dict[str, dict[str, float]],
        cast(dict[str, object], contract_schema("PlanDecoracion")["x-reglas-mezclas"])[
            "armado_columna_clasica"
        ],
    ).items()
}


class ColumnaInvalida(ValueError):
    """Una columna que no se puede armar tal como se pidió.

    Lleva ``motivo`` estable para que quien lo traduzca no tenga que leer el
    texto, igual que ``arco_clasico.ArcoInvalido``.
    """

    def __init__(self, motivo: str, mensaje: str) -> None:
        super().__init__(mensaje)
        self.motivo = motivo
        #: El texto, para quien lo traduce a un error de la API sin leer `str()`.
        self.mensaje = mensaje


# --- Entrada ------------------------------------------------------------------


#: Los cinco remates del original (``REMATES`` de ``columna/tipos.ts``), con el
#: mismo primer valor: **ninguno**. Que se pueda quitar es la propiedad que
#: importa, porque es la que deja portearlo sin mover ni un plan existente.
TipoRemate = Literal["ninguno", "globo", "racimo", "estrella", "corazon"]

#: Alto del remate en diámetros del globo del remate, para los dos que son de
#: látex, y en fracción del foil para los otros dos. Son los factores del
#: original, tal cual: ``dr * 0.8``, ``dr * 2.1`` y ``foilM * 0.9``.
_ALTO_GLOBO = 0.8
_ALTO_RACIMO = 2.1
_ALTO_FOIL = 0.9

#: Globos de un racimo de remate: de tres a cinco, como allá.
MIN_RACIMO_REMATE = 3
MAX_RACIMO_REMATE = 5


@dataclass(frozen=True)
class Remate:
    """Lo que corona la columna, o nada.

    Porteado de ``Remate`` del original. **Es opcional de verdad** (``ninguno``
    por defecto) y, lo que más importa, **no toca el cuerpo**: las capas y su
    conteo son los mismos lleve remate o no. Comprobado contra el motor de
    referencia en sus cinco variantes: el cuerpo da 36 globos en las cinco.

    Sus globos salen en una lista aparte (``RemateArmado.globos``), igual que el
    ``remate.globos`` del original va aparte de su ``conteo``: un remate es otra
    cosa que se compra, no un globo más de la pila. Un foil —estrella o
    corazón— no suma látex ninguno.
    """

    tipo: TipoRemate = "ninguno"
    #: Tamaño nominal del globo del remate (uno grande, o los del racimo).
    pulgadas: int = 24
    #: Globos del racimo, de 3 a 5. Se ignora en los otros tipos.
    cantidad: int = 5
    #: Alto del foil (m). Se ignora en los que no lo son.
    foil_m: float = 0.7


@dataclass(frozen=True)
class RemateArmado:
    """El remate ya resuelto: cuánto sube y qué globos pide."""

    tipo: TipoRemate
    #: Cuánto sube la pieza por encima de la última capa (m).
    alto_m: float
    #: ``(pulgadas, cantidad)`` de los globos de látex que pide. Vacío si no pide
    #: ninguno: sin remate, o con uno de foil.
    globos: tuple[tuple[int, int], ...]
    #: Alto del foil (m), cuando el remate es uno. ``None`` si no.
    foil_m: float | None


@dataclass(frozen=True)
class Columna:
    """Una columna clásica tal como se pide: su alto y cómo se arma.

    ``globos_capa`` y ``compresion`` son las dos perillas del armado, y **sí
    deciden el número de globos**: son la definición de la densidad de una
    columna. Quien las elige a partir de la densidad comercial es quien llama.

    El **diámetro no entra**: sale (``diametro_m``). Dos globos vecinos de una
    capa se tocan, así que el ancho de la pieza lo fijan el tamaño del globo y
    cuántos van en el anillo. Pedirlo además sería un segundo dueño de la misma
    medida.
    """

    alto_m: float
    #: Tamaño nominal del globo. Una columna clásica es de un solo tamaño.
    pulgadas: int = 12
    #: Globos del anillo de cada capa. Cuatro es el cuarteto de referencia.
    globos_capa: int = 4
    #: Alto de una capa en diámetros de globo.
    compresion: float = COMPRESION_POR_DEFECTO
    #: Cada capa, girada medio paso respecto a la de abajo. Apagado, los globos
    #: quedan apilados uno encima de otro en columnas rectas.
    escalonado: bool = True
    #: Lo que corona la pieza. Por defecto nada, que es lo que deja que esto
    #: exista sin mover ninguna columna ya cotizada.
    remate: Remate = field(default_factory=Remate)


# --- Salida -------------------------------------------------------------------


@dataclass(frozen=True)
class GloboColumna:
    """Un globo de la columna, en metros y en el plano del dibujo.

    ``x`` crece a la derecha y es cero en el eje; ``y`` crece hacia arriba desde
    el suelo, igual que en ``app.silueta``. ``z`` es la profundidad en metros,
    positiva hacia quien mira.
    """

    #: Capa a la que pertenece, 0 la del suelo.
    capa: int
    #: Puesto dentro del anillo de su capa (0 … n−1).
    puesto: int
    x: float
    y: float
    z: float
    radio_m: float
    #: −1 (al fondo, se oscurece) … 1 (de frente). Es ``z`` normalizado por el
    #: radio del anillo, como el ``prof`` del original.
    profundidad: float


@dataclass(frozen=True)
class ColumnaArmada:
    """La columna armada: sus capas, sus globos y sus medidas reales."""

    capas: int
    globos_capa: int
    globos: tuple[GloboColumna, ...]
    #: Globos de la pieza: ``capas × globos por capa``. Es la cifra que se cotiza.
    total: int
    #: Alto real del cuerpo de globos (m), que puede no ser el pedido: una capa
    #: entra entera o no entra.
    alto_m: float
    #: Diámetro exterior de la pieza (m), derivado del globo y del anillo.
    diametro_m: float
    #: El remate, ya resuelto. ``tipo: "ninguno"`` cuando no lleva.
    remate: RemateArmado
    #: Lo que no era posible tal como se pidió y cómo se resolvió.
    avisos: tuple[str, ...]

    @property
    def alto_total_m(self) -> float:
        """Alto de la pieza con su remate (m). ``alto_m`` es solo el cuerpo."""
        return self.alto_m + self.remate.alto_m


# --- Geometría del anillo -----------------------------------------------------


def radio_anillo(diametro_m: float, globos_capa: int) -> float:
    """Radio del anillo de centros de una capa (m).

    Porta ``radioAnillo``: los ``n`` globos se reparten en una circunferencia y
    dos vecinos quedan a ``d / SOLAPE`` uno de otro, así que el radio sale de
    ``2 · R · sen(π/n) = d / SOLAPE``.
    """
    return diametro_m / SOLAPE / 2 / math.sin(math.pi / max(2, globos_capa))


def diametro_columna_m(diametro_m: float, globos_capa: int) -> float:
    """Diámetro exterior de la columna (m): el anillo más un globo.

    Porta ``diametroColumna``. Es una medida **derivada**: con R-12 un trío mide
    0,56 m, un cuarteto 0,63 y un sexteto 0,77. Por eso el ancho declarado de la
    pieza no entra al armado — y por eso no cuadrará con él salvo coincidencia.
    """
    return 2 * radio_anillo(diametro_m, globos_capa) + diametro_m


def alto_de_capas(diametro_m: float, capas: int, compresion: float) -> float:
    """Alto del cuerpo (m) con esas capas: de la base de la primera a la cima de
    la última. Con un solo tamaño, cada capa sube ``compresion · d``."""
    return diametro_m + max(0, capas - 1) * compresion * diametro_m


def capas_para(alto_m: float, diametro_m: float, compresion: float) -> int:
    """Las capas cuyo alto real queda **más cerca** del pedido.

    Porta la búsqueda de ``crearCapas``: no se redondea hacia arriba ni hacia
    abajo, se elige el número de capas que menos se desvía del alto pedido, que
    es lo que importa cuando el globo es grande y una capa de más o de menos se
    nota. Nunca devuelve menos de ``CAPAS_MINIMAS``, también como el original.
    """
    paso = compresion * diametro_m
    mejor, menor = CAPAS_MINIMAS, math.inf
    for capas in range(CAPAS_MINIMAS, _MAX_CAPAS + 1):
        desvio = abs(alto_de_capas(diametro_m, capas, compresion) - alto_m)
        if desvio < menor:
            menor, mejor = desvio, capas
        # Una capa más solo puede alejarse: se puede parar.
        if alto_de_capas(diametro_m, capas, compresion) > alto_m + paso:
            break
    return mejor


# --- Armado -------------------------------------------------------------------


def armar_remate(remate: Remate) -> RemateArmado:
    """Resuelve el remate: cuánto sube y qué globos pide.

    Traducción del bloque de remate de ``generar``. **No mira el cuerpo y el
    cuerpo no lo mira a él**: por eso se puede quitar sin que se mueva nada.
    """
    if remate.tipo == "ninguno":
        return RemateArmado(tipo="ninguno", alto_m=0.0, globos=(), foil_m=None)
    if remate.tipo in ("estrella", "corazon"):
        if remate.foil_m <= 0:
            raise ColumnaInvalida(
                "remate_invalido", "Un remate de foil necesita un alto mayor que cero."
            )
        # Un foil no es látex: no pide ni un globo.
        return RemateArmado(
            tipo=remate.tipo,
            alto_m=remate.foil_m * _ALTO_FOIL,
            globos=(),
            foil_m=remate.foil_m,
        )
    if remate.pulgadas <= 0:
        raise ColumnaInvalida(
            "remate_invalido", "El tamaño del globo del remate debe ser positivo."
        )
    diametro_m = diametro_inflado_m(remate.pulgadas)
    if remate.tipo == "globo":
        return RemateArmado(
            tipo="globo",
            alto_m=diametro_m * _ALTO_GLOBO,
            globos=((remate.pulgadas, 1),),
            foil_m=None,
        )
    if not MIN_RACIMO_REMATE <= remate.cantidad <= MAX_RACIMO_REMATE:
        raise ColumnaInvalida(
            "remate_invalido",
            f"Un racimo de remate lleva de {MIN_RACIMO_REMATE} a {MAX_RACIMO_REMATE} globos,"
            f" no {remate.cantidad}.",
        )
    return RemateArmado(
        tipo="racimo",
        alto_m=diametro_m * _ALTO_RACIMO,
        globos=((remate.pulgadas, remate.cantidad),),
        foil_m=None,
    )


def _validar(columna: Columna) -> None:
    if not MIN_GLOBOS_CAPA <= columna.globos_capa <= MAX_GLOBOS_CAPA:
        raise ColumnaInvalida(
            "capa_fuera_de_rango",
            f"Una capa lleva de {MIN_GLOBOS_CAPA} a {MAX_GLOBOS_CAPA} globos,"
            f" no {columna.globos_capa}.",
        )
    if columna.pulgadas <= 0:
        raise ColumnaInvalida("tamano_invalido", "El tamaño nominal del globo debe ser positivo.")
    if not MIN_COMPRESION <= columna.compresion <= MAX_COMPRESION:
        raise ColumnaInvalida(
            "compresion_fuera_de_rango",
            f"El alto de capa va de {MIN_COMPRESION} a {MAX_COMPRESION} diámetros,"
            f" no {columna.compresion}.",
        )
    if columna.alto_m <= 0:
        raise ColumnaInvalida("sin_alto", "Una columna necesita un alto mayor que cero.")


def armar(columna: Columna) -> ColumnaArmada:
    """Arma la columna: cada globo en su sitio, y el total es lo que colocó.

    Traducción de ``generar`` del original, sin su dibujo, sin su remate y sin su
    azar.
    """
    _validar(columna)
    diametro_m = diametro_inflado_m(columna.pulgadas)
    n = columna.globos_capa
    capas = capas_para(columna.alto_m, diametro_m, columna.compresion)
    total = capas * n
    if total > MAX_GLOBOS:
        raise ColumnaInvalida(
            "demasiados_globos",
            f"Esta columna pide {total} globos y el motor arma hasta {MAX_GLOBOS}:"
            " divídela en piezas más pequeñas.",
        )

    avisos: list[str] = []
    alto_real = alto_de_capas(diametro_m, capas, columna.compresion)
    if abs(alto_real - columna.alto_m) > columna.compresion * diametro_m / 2:
        # Solo cuando la diferencia es de más de media capa: por debajo es el
        # redondeo normal de apilar globos y no hay nada que contar.
        avisos.append(
            f"Con globos R-{columna.pulgadas} la columna se arma en {capas} capas y mide"
            f" {alto_real:.2f} m, no los {columna.alto_m:.2f} m pedidos: una capa entra"
            " entera o no entra."
        )

    rho = radio_anillo(diametro_m, n)
    paso = columna.compresion * diametro_m
    radio_globo_m = diametro_m / 2
    globos: list[GloboColumna] = []
    for capa in range(capas):
        y = radio_globo_m + capa * paso
        # El medio paso de giro: es lo que encaja cada capa entre los globos de
        # la de abajo. Sin él, los globos quedan en columnas rectas.
        corrimiento = 0.5 if columna.escalonado and capa % 2 == 1 else 0.0
        for puesto in range(n):
            angulo = 2 * math.pi * (puesto + corrimiento) / n
            x = rho * math.sin(angulo)
            z = rho * math.cos(angulo)
            globos.append(
                GloboColumna(
                    capa=capa,
                    puesto=puesto,
                    x=x,
                    y=y,
                    z=z,
                    radio_m=radio_globo_m,
                    profundidad=z / rho if rho else 0.0,
                )
            )

    # Del fondo al frente y, a igual profundidad, de arriba abajo: es el orden en
    # que se pintan y el que decide quién tapa a quién (``globos.sort`` del
    # original). Importa más que en el arco: una columna es un cilindro visto de
    # frente, y la mitad de atrás tiene que quedar detrás.
    globos.sort(key=lambda globo: (globo.z, -globo.y))

    return ColumnaArmada(
        capas=capas,
        globos_capa=n,
        globos=tuple(globos),
        # El cuerpo, y solo el cuerpo: el remate va en su propia lista. Es lo
        # mismo que hace el original, donde ``conteo`` no incluye
        # ``remate.globos``, y es lo que deja que quitar el remate no mueva el
        # conteo de la pieza.
        total=len(globos),
        alto_m=alto_real,
        diametro_m=diametro_columna_m(diametro_m, n),
        remate=armar_remate(columna.remate),
        avisos=tuple(avisos),
    )


def contar(columna: Columna) -> int:
    """Globos que lleva la columna. Es ``armar(columna).total``, sin posiciones."""
    return armar(columna).total


def columna_de_densidad(alto_m: float, densidad: str, pulgadas: int = 12) -> Columna:
    """La columna que le toca a esa densidad comercial.

    El **ancho no entra**: a diferencia del arco, una columna no tiene medida
    libre a lo ancho. Dos globos vecinos de la capa se tocan, así que el
    diámetro lo fijan el tamaño del globo y los globos por capa, y sale en
    ``ColumnaArmada.diametro_m``. El ancho que el plan declare es, hoy, una
    medida que nadie usaba para contar (``plan._eje`` de una columna es su
    altura y el área usa el diámetro del GLOBO), así que esto no le quita nada a
    nadie; si alguna vez tuviera que mandar, mandaría eligiendo el tamaño del
    globo, y eso cambia el precio y se decide.
    """
    armado = ARMADO_POR_DENSIDAD.get(densidad)
    if armado is None:
        raise ColumnaInvalida(
            "densidad_desconocida",
            f"La densidad «{densidad}» no tiene armado de columna clásica; las que hay son"
            f" {', '.join(sorted(ARMADO_POR_DENSIDAD))}.",
        )
    globos_capa, compresion = armado
    return Columna(
        alto_m=alto_m,
        pulgadas=pulgadas,
        globos_capa=globos_capa,
        compresion=compresion,
    )
