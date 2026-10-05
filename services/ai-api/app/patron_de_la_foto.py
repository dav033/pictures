"""De la lectura del patrón de la foto al patrón del motor (ADR-0039).

La foto se lee en el vocabulario de ``patron-color.v1`` (ADR-0028 §7, ``PistaPatronSchema``): uno de ocho
modos —``espiral``, ``anillos``, ``bloques``, ``degradado``, ``aleatorio``, ``flor``, ``damero``, ``zonas``—,
los colores **por nombre de catálogo** en orden de dominancia, cuántos globos lleva un racimo, y su confianza.
El motor del diseñador tiene su propio vocabulario: catorce patrones en el arco y nueve en la columna, cada uno
con sus mandos (ADR-0034). **Son dos vocabularios distintos y este módulo es el único sitio donde se cruzan.**

Hasta aquí la receta del armado elegía el patrón del motor por el **número de colores** de la pieza (sólido con
uno, la espiral del diseñador con dos a cuatro, el arcoíris o el ombré de cinco en adelante). La lectura de la
foto ya existía, alimentaba ``patron_color`` y **no llegaba al motor**: una columna que en la foto es un
apilado de anillos salía en espiral.

Lo que este módulo decide y lo que no:

- **Decide** qué patrón del motor dice lo mismo que el modo leído, en qué orden van sus materiales, qué mando
  del motor recibe cada número de la lectura, y cuántos globos lleva un racimo (la capa de la columna, la
  banda del arco).
- **No decide** de qué material es un color leído: eso es ``patron_color.material_de_color``, que ya lo resuelve
  por nombre y, si no, por tono (ΔE CIE76 ≤ 25). Un segundo criterio de color sería un segundo dueño.
- **No decide** si el armado se sostiene (la puerta del motor, ``app/armado_arco.py`` y
  ``app/armado_columna.py``), ni acota los mandos a su rango (``_opciones_del_patron``, con los controles que
  publica el motor), ni toca el precio.

Los mismos cortes que ``patron_color.patron_desde_pista``, por las mismas razones: una confianza por debajo de
``CONFIANZA_MINIMA_PISTA`` no se usa, y un color de la lectura que no es de ningún material de la pieza tumba
la lectura entera —si la foto nombra tres colores y uno no está, lo que se armaría no es lo que se leyó—.
Cuando la lectura no se puede honrar devuelve ``None`` **con su aviso**, y la receta vuelve a elegir por el
número de colores. Degradar en silencio es lo que no se hace.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from app.arco.patrones import PATRONES as PATRONES_ARCO
from app.armado_columna import PATRONES as PATRONES_COLUMNA
from app.armado_columna import TIPOS_REMATE
from app.patron_color import (
    CONFIANZA_MINIMA_PISTA,
    SEPARACION_FLOR_PISTA,
    MaterialPatron,
    material_de_color,
)

#: Los ocho modos de ``patron-color.v1``. El contrato es el dueño; aquí solo se nombran para la tabla.
MODOS = ("espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero", "zonas")

#: El mando ``modo`` del ombré del arco (``arco/patrones.py``). «A lo largo» es el 0 y no se pide: es el valor
#: con el que arranca el motor.
_OMBRE_SIMETRICO = 1.0
_OMBRE_A_LO_ANCHO = 2.0

#: El único valor de ``simetria`` del contrato de la pista: las dos mitades iguales, reflejadas.
SIMETRIA_ESPEJO = "espejo"

#: Anillos leídos en la foto: un racimo (una fila del arco, una capa de la columna) por color, que es el
#: ``largo: 1`` con el que ``patron_color._base_de_pista`` arma la misma lectura.
_ANILLO_DE_UN_RACIMO = 1.0

#: Qué patrón del motor dice lo mismo que cada modo, por orden de preferencia: se queda el primero cuya
#: aritmética de color admita los materiales que la lectura nombra. La espiral no está porque la decide el
#: tipo de pieza (en el arco es una franja trenzada; en la columna, la espiral de capas).
_PREFERENCIAS_ARCO: Mapping[str, tuple[str, ...]] = {
    "espiral": ("espiral",),
    # Anillos y bloques son lo mismo visto desde la foto: tramos de un color seguidos a lo largo del arco.
    # Los diferencia el largo del tramo, que es un mando.
    "anillos": ("bloques",),
    "bloques": ("bloques",),
    "degradado": ("ombre", "bloques"),
    # El motor no tiene un «al azar» en el arco: un fondo con lunares es lo más cerca que llega.
    "aleatorio": ("punteado", "bloques"),
    # El floral del arco lleva cuatro colores (hojas, fondo, pétalos y centro); con menos queda el fondo con
    # lunares, que es la flor sin pétalos.
    "flor": ("floral", "punteado"),
    "damero": ("diamante", "bloques"),
    # Una mancha agrupada en un sitio de la pieza es un tramo de color, y el tramo del motor es el bloque.
    "zonas": ("bloques",),
}

_PREFERENCIAS_COLUMNA: Mapping[str, tuple[str, ...]] = {
    "espiral": ("espiral",),
    # En una columna los anillos se apilan, y eso es exactamente el «apilado» del motor.
    "anillos": ("apilado",),
    "bloques": ("apilado",),
    "degradado": ("ombre", "apilado"),
    "aleatorio": ("aleatorio",),
    # La columna no tiene floral: una flor sobre un fondo queda como lunares sobre un fondo.
    "flor": ("punteado",),
    "damero": ("diamante", "apilado"),
    "zonas": ("apilado",),
}


@dataclass(frozen=True)
class PatronLeido:
    """El patrón del motor que dice lo que la foto leyó de una pieza.

    ``opciones`` son los mandos **pedidos**, no los finales: quien arma los pasa por
    ``_opciones_del_patron``, que los acota al rango que publica el motor y avisa de lo que movió. Lo mismo
    ``globos_por_racimo``, que es la banda del arco o la capa de la columna y lo acota su geometría.
    """

    patron: str
    materiales: tuple[int, ...]
    opciones: dict[str, float]
    modo: str
    globos_por_racimo: int | None


def _texto(valor: object) -> str | None:
    return valor.strip() if isinstance(valor, str) and valor.strip() else None


def _entero(valor: object) -> int | None:
    """Un entero de verdad. Un booleano no es un número (``True`` no es un racimo de uno)."""
    if isinstance(valor, bool) or not isinstance(valor, int):
        return None
    return valor


def _nombres_leidos(pista: Mapping[str, object]) -> list[str] | None:
    """Los colores de la lectura en su orden, más los de sus manchas. ``None`` si no nombra ninguno.

    El primero es el dominante: es el que la foto vio más y el que manda en el patrón del motor (el fondo del
    punteado, el primer tono del ombré, el primer tramo del bloque).
    """
    crudos = pista.get("colores")
    if not isinstance(crudos, Sequence) or isinstance(crudos, (str, bytes)):
        return None
    nombres = [nombre for nombre in map(_texto, cast(Sequence[object], crudos)) if nombre]
    zonas = pista.get("zonas")
    if isinstance(zonas, Sequence) and not isinstance(zonas, (str, bytes)):
        for zona in cast(Sequence[object], zonas):
            if isinstance(zona, Mapping):
                nombre = _texto(zona.get("color"))
                if nombre:
                    nombres.append(nombre)
    return nombres or None


def _materiales_de(
    nombres: Sequence[str], materiales: Sequence[MaterialPatron]
) -> tuple[int, ...] | None:
    """Los materiales de la pieza que la lectura nombra, en su orden y sin repetir.

    ``None`` en cuanto un color no es de ningún material: es el corte de ``patron_desde_pista``, y por la
    misma razón —armar con los que sí casaron sería armar otra pieza—.
    """
    salida: list[int] = []
    for nombre in nombres:
        indice = material_de_color(materiales, nombre)
        if indice is None:
            return None
        if indice not in salida:
            salida.append(indice)
    return tuple(salida)


def _motas_leidas(pista: Mapping[str, object]) -> list[str]:
    """Los colores que la foto vio salpicados sobre las secciones, en su orden."""
    crudas = pista.get("motas")
    if not isinstance(crudas, Sequence) or isinstance(crudas, (str, bytes)):
        return []
    return [nombre for nombre in map(_texto, cast(Sequence[object], crudas)) if nombre]


def _arity_arco(patron: str) -> tuple[int, int]:
    """Cuántos colores admite un patrón del arco: su lista, o los puestos fijos de su paleta."""
    definicion = PATRONES_ARCO[patron]
    lista = definicion.lista
    if lista:
        return int(cast(int, lista["min"])), int(cast(int, lista["max"]))
    cuantos = len(definicion.colores)
    return cuantos, cuantos


def _arity_columna(patron: str, tope: int) -> tuple[int, int]:
    """Lo mismo en la columna, que no publica lista: su mínimo de color y el tope de materiales del contrato."""
    return int(PATRONES_COLUMNA[patron].min_colores), tope


def _mandos(tipo: str, patron: str, modo: str, pista: Mapping[str, object]) -> dict[str, float]:
    """Los números de la lectura puestos en los mandos del motor que dicen lo mismo.

    Un mando que el patrón elegido no tiene se queda fuera aquí mismo: ``_opciones_del_patron`` avisaría de
    un mando ignorado, y ese aviso es para el modelo, no para la foto.
    """
    controles = (
        {cast(str, c["clave"]) for c in PATRONES_ARCO[patron].controles}
        if tipo == "arco"
        else {c.clave for c in PATRONES_COLUMNA[patron].controles}
    )
    pedidas: dict[str, float] = {}

    def poner(clave: str, valor: float | None) -> None:
        if valor is not None and clave in controles:
            pedidas[clave] = valor

    if modo == "anillos":
        # Un racimo por color: el largo del bloque en el arco (en filas), las capas por banda en la columna.
        poner("largo", _ANILLO_DE_UN_RACIMO)
        poner("grosor", _ANILLO_DE_UN_RACIMO)
    elif modo == "flor":
        # Racimos de fondo entre una flor y la siguiente, el mismo que usa la lectura de `patron_color`.
        poner("sepFilas", float(SEPARACION_FLOR_PISTA))
        poner("sepCapas", float(SEPARACION_FLOR_PISTA))

    # El eje y la simetría que la foto leyó (ADR-0039). Donde el motor no tiene el mando, `poner` los deja
    # fuera: la columna no se arma en espejo y su ombré no tiene dirección, así que allí no cambia nada.
    espejo = pista.get("simetria") == SIMETRIA_ESPEJO
    direccion = pista.get("direccion")
    if patron == "ombre":
        # El ombré del arco degrada a lo largo, en espejo desde los dos pies, o a lo ancho de la banda: son
        # los tres valores del mando `modo` que publica el motor. La lectura dice cuál, y el espejo manda
        # sobre el eje (un arco simétrico degrada desde los dos pies). «A lo largo» no se pide nunca: es el
        # valor con el que arranca el motor y el lector no manda la dirección longitudinal.
        if espejo:
            poner("modo", _OMBRE_SIMETRICO)
        elif direccion == "transversal":
            poner("modo", _OMBRE_A_LO_ANCHO)
    elif espejo:
        # Las dos patas del arco reflejadas. El mando existe en casi todos sus patrones, con el valor de
        # partida en 0 en unos (la espiral, los bloques) y en 1 en otros (el punteado, el diamante).
        poner("espejo", 1.0)
    return pedidas


def patron_del_motor(
    tipo: str,
    pista: Mapping[str, object] | None,
    materiales: Sequence[MaterialPatron],
    avisos: list[str],
    *,
    tope_materiales: int = 8,
) -> PatronLeido | None:
    """El patrón del motor que dice lo que la foto leyó de esta pieza, o ``None`` con su aviso.

    ``materiales`` son los de la pieza de verdad, en su orden: son el tope de lo que la lectura puede nombrar
    y la tabla con la que se resuelve cada color. ``tipo`` es ``arco`` o ``columna``; la guirnalda del motor
    no tiene patrón que elegir (su lectura va por otro camino, ADR-0032) y se contesta ``None`` sin aviso.
    """
    if tipo not in ("arco", "columna") or not isinstance(pista, Mapping) or not materiales:
        return None
    modo = pista.get("modo")
    if not isinstance(modo, str) or modo not in MODOS:
        return None
    confianza = pista.get("confianza")
    if not isinstance(confianza, (int, float)) or isinstance(confianza, bool):
        return None
    if confianza < CONFIANZA_MINIMA_PISTA:
        # No es un fallo: es una lectura que su propio dueño tampoco usaría. Sin aviso, porque el decorador
        # no tiene nada que hacer con ella.
        return None
    nombres = _nombres_leidos(pista)
    if nombres is None:
        return None
    indices = _materiales_de(nombres, materiales)
    if indices is None:
        avisos.append(
            f"La foto leyo «{modo}» con un color que no es de esta pieza; el patron sale de la receta."
        )
        return None
    preferencias = (_PREFERENCIAS_ARCO if tipo == "arco" else _PREFERENCIAS_COLUMNA).get(modo, ())
    for patron in preferencias:
        minimo, maximo = (
            _arity_arco(patron) if tipo == "arco" else _arity_columna(patron, tope_materiales)
        )
        if len(indices) < minimo:
            continue
        return PatronLeido(
            patron=patron,
            materiales=indices[:maximo],
            opciones=_mandos(tipo, patron, modo, pista),
            modo=modo,
            globos_por_racimo=_entero(pista.get("globos_por_racimo")),
        )
    avisos.append(
        f"La foto leyo «{modo}» y la pieza tiene {len(indices)} color(es): no alcanzan para ese patron "
        "del motor, asi que el patron sale de la receta."
    )
    return None


#: La guirnalda del motor **no tiene patrón**: lo que decide dónde va cada color es su reparto, y el motor
#: publica tres (``organico/tipos.py``). Estos son los modos de la foto que dicen lo mismo que uno de ellos:
#:
#: - ``aleatorio`` es la mezcla equilibrada de una guirnalda orgánica, que es el ``azar``.
#: - ``anillos`` es cada racimo de un solo color, que es literalmente el reparto ``racimos``.
#: - ``bloques``, ``degradado`` y ``zonas`` son tramos de color seguidos, y el reparto ``tramos`` los recorre
#:   en el orden de la paleta, que es el orden en que la foto nombró los colores.
#:
#: Los tres que faltan no tienen equivalente y se dicen: una ``espiral`` (racimos iguales girados), una
#: ``flor`` y un ``damero`` no se pueden armar con una guirnalda orgánica, y forzar uno sería armar otra cosa.
#: Las piezas que arma el motor orgánico: no tienen patrón que elegir, tienen **reparto**. La guirnalda y la
#: columna orgánica comparten el mismo modelo de paleta (``app/organico``), así que la lectura de la foto se
#: traduce igual en las tres: el arco orgánico es el mismo motor con una línea guía curva.
TIPOS_DE_REPARTO = frozenset({"guirnalda", "columna_organica", "arco_organico"})

_REPARTO_DE_MODO: Mapping[str, str] = {
    "aleatorio": "azar",
    "anillos": "racimos",
    "bloques": "tramos",
    "degradado": "tramos",
    "zonas": "tramos",
}


@dataclass(frozen=True)
class RepartoLeido:
    """El reparto de la pieza orgánica que dice lo que la foto leyó, con sus colores en el orden de la foto.

    ``acentos`` son las **motas**: los materiales que la foto vio salpicados sobre las secciones en vez de
    ocupando una. El motor los arma como globos sueltos que no se tocan entre sí (``organico/motor.py``), que
    es exactamente lo que son las burbujas cristal o los cromados sueltos de un arco orgánico.
    """

    reparto: str
    materiales: tuple[int, ...]
    modo: str
    acentos: tuple[int, ...] = ()


def reparto_del_motor(
    tipo_pieza: str,
    pista: Mapping[str, object] | None,
    materiales: Sequence[MaterialPatron],
    avisos: list[str],
) -> RepartoLeido | None:
    """El reparto de la pieza orgánica que dice lo que la foto leyó, o ``None`` para el del motor.

    Los **pesos** de la paleta no salen de aquí: el reparto dice dónde va cada color y la participación que el
    plan declara dice cuánto se compra de cada uno. Son dos dueños distintos y ninguno pisa al otro.
    """
    if tipo_pieza not in TIPOS_DE_REPARTO or not isinstance(pista, Mapping) or not materiales:
        return None
    modo = pista.get("modo")
    if not isinstance(modo, str) or modo not in MODOS:
        return None
    confianza = pista.get("confianza")
    if (
        not isinstance(confianza, (int, float))
        or isinstance(confianza, bool)
        or confianza < CONFIANZA_MINIMA_PISTA
    ):
        return None
    reparto = _REPARTO_DE_MODO.get(modo)
    if reparto is None:
        avisos.append(
            f"La foto leyo «{modo}», que una guirnalda organica no puede armar; "
            "el reparto sale de la receta."
        )
        return None
    nombres = _nombres_leidos(pista)
    if nombres is None:
        return None
    indices = _materiales_de(nombres, materiales)
    if indices is None:
        avisos.append(
            f"La foto leyo «{modo}» con un color que no es de esta pieza; el reparto sale de la receta."
        )
        return None
    motas = _materiales_de(_motas_leidas(pista), materiales)
    # Una mota que no es de ningún material de la pieza se descarta sola, sin tumbar el reparto: el resto de
    # la lectura sigue sirviendo. Es distinto de un color de sección, que sí la tumba, porque una sección mal
    # resuelta cambia la pieza entera y una mota solo se queda sin salpicar.
    return RepartoLeido(
        reparto=reparto,
        materiales=indices,
        modo=modo,
        acentos=tuple(i for i in (motas or ()) if i not in indices),
    )


@dataclass(frozen=True)
class RemateLeido:
    """Lo que la foto vio coronando una columna: su tipo del motor y, si se vio, de qué material es.

    El tamaño del globo, los globos del racimo y el alto del foil **no** están aquí a propósito: la foto no
    los mide y los pone el motor (decisión del 2026-10-02: sin lectura, el remate sigue siendo su globo de
    24"). Lo que la foto aporta es lo que no se podía saber de otro modo: si la punta lleva algo o no.
    """

    tipo: str
    material: int | None


def remate_del_motor(
    tipo_pieza: str,
    lectura: Mapping[str, object] | None,
    materiales: Sequence[MaterialPatron],
    avisos: list[str],
) -> RemateLeido | None:
    """El remate que la foto leyó de esta columna, o ``None`` para que lo ponga el motor.

    ``None`` y un remate ``ninguno`` no son lo mismo y el contrato de la lectura los separa: ausente es «no
    se ve la punta» y deja el remate del motor; ``ninguno`` es «la punta no lleva nada» y deja la columna a
    ras de su último anillo (``armado-columna.ts``, ``RemateLeidoSchema``).
    """
    if tipo_pieza != "columna" or not isinstance(lectura, Mapping):
        return None
    tipo = lectura.get("tipo")
    if not isinstance(tipo, str) or tipo not in TIPOS_REMATE:
        return None
    color = lectura.get("color")
    material: int | None = None
    if isinstance(color, str) and color.strip():
        material = material_de_color(materiales, color)
        if material is None:
            # El tipo de remate se conserva: que la columna lleve un globo arriba es lo que se leyó, y de
            # qué color es lo accesorio. Sin material, el motor lo corona con el color principal.
            avisos.append(
                f"El remate de la foto es «{color}», que no es un color de esta pieza; "
                "va del color principal."
            )
    return RemateLeido(tipo=tipo, material=material)


#: Los cuatro tamaños que la foto sabe distinguir (``TAMANOS_LEIDOS`` del contrato) y la mezcla de
#: ``mezclas.ts`` que dice lo mismo. **El tercer cruce de vocabularios de este módulo**, con el mismo corte que
#: los otros dos: la foto no nombra diámetros ni proporciones —no los sabe— y la tabla de mezclas no nombra lo
#: que se ve en una foto.
#:
#: La mezcla la elegía a ojo la IA que arma el plan, desde la descripción de la pieza y sin mirar la foto. Una
#: columna dorada de globos casi todos gigantes salía ``organica_gruesa`` (45 % de 12", 25 % de 9") contra una
#: foto en la que no había casi ningún 12" (2026-10-03). La mezcla que hacía falta, ``solo_grandes``, existía en
#: la tabla desde siempre: nadie se lo preguntaba a la foto.
#:
#: Lo que esta tabla **no** decide: qué se compra. La proporción de cada diámetro, la sustitución cuando el
#: producto no tiene un tamaño y el precio siguen siendo de ``mezclas.ts`` y de este módulo de plan, que son sus
#: dueños. Aquí solo se elige cuál de las cuatro mezclas nombra lo que la foto vio.
MEZCLA_DE_TAMANOS: Mapping[str, str] = {
    "casi_todos_gigantes": "solo_grandes",
    "grandes_con_pocos_chicos": "organica_gruesa",
    "chicos_con_pocos_grandes": "organica_fina",
    "un_solo_tamano": "clasica",
}


def mezcla_del_motor(
    pista: Mapping[str, object] | None,
    avisos: list[str],
) -> str | None:
    """La mezcla que dice lo que la foto leyó en los tamaños, o ``None`` si la foto no lo dice.

    ``None`` no es un fallo: la lectura declara ``tamanos`` solo cuando en la foto se distinguen, y entonces
    manda la mezcla que declaró el plan. Lo que no se hace es inventar una.

    Los mismos cortes que el resto del módulo: por debajo de ``CONFIANZA_MINIMA_PISTA`` la lectura no se usa, y
    un valor que no está en la tabla deja aviso en vez de caer en un silencio.
    """
    if pista is None:
        return None
    leido = _texto(pista.get("tamanos"))
    if leido is None:
        return None
    confianza = pista.get("confianza")
    if isinstance(confianza, (int, float)) and float(confianza) < CONFIANZA_MINIMA_PISTA:
        avisos.append(f"tamaños leídos con confianza {float(confianza):.2f}: se ignoran")
        return None
    mezcla = MEZCLA_DE_TAMANOS.get(leido)
    if mezcla is None:
        avisos.append(f"tamaños leídos desconocidos: {leido}")
        return None
    return mezcla


__all__ = [
    "MEZCLA_DE_TAMANOS",
    "MODOS",
    "PatronLeido",
    "RemateLeido",
    "RepartoLeido",
    "TIPOS_DE_REPARTO",
    "mezcla_del_motor",
    "patron_del_motor",
    "remate_del_motor",
    "reparto_del_motor",
]
