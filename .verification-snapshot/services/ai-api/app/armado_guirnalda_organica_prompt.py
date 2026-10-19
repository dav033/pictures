"""Cómo se le cuenta a los modelos de imagen una guirnalda armada con el motor del diseñador.

Hermana de ``armado_arco_prompt`` (ADR-0035, paso 1) y de ``_frases_prompt`` de ``armado_guirnalda`` (ADR-0032):
Python es el dueño del armado y lo describe; TypeScript solo inserta la frase, tal cual. Viaja en
``plan_resuelto.armados_guirnalda_organica[]`` (``prompt_gemini`` y ``prompt_lora``), **fuera** del snapshot y de
``plan_hash``, como las demás frases derivadas. Sin armado no hay frase y los prompts son los de siempre.

Por qué hacía falta otra. El motor orgánico (ADR-0034) es el que arma las guirnaldas hoy, y no producía
ninguna frase: el caption decía «an organic balloon garland ... against the rear wall» y nada más. En el
vocabulario del LoRA v004 un arco de verdad es «organic balloon garland arch», así que esa frase es la del arco
a una palabra, y el modelo la cerraba en un arco de pie con patas (2026-10-03). La decisión 28 de ADR-0032 ya
había anotado exactamente ese fallo y su cura, pero su frase solo viaja con el armado de ADR-0032, que está
detrás de una bandera apagada por defecto. Esto le da la misma voz a la pieza que sí se arma.

El vocabulario es el de ``armado_guirnalda``, a propósito: se midió contra este mismo corpus y ya está probado
en producción. Lo que cambia es de dónde salen los datos —aquí la línea del motor (``forma``) en vez del
soporte y la forma declarados— y que el LoRA va en ASCII y **sin cifras** (ADR-0028 §8): no aprendió números.

Qué dice cada mando de la línea:

- ``alturaM``  dónde vive la guirnalda. Pegada al piso es la tira del frente; a la altura de una mesa corre por
  su borde; más arriba va montada en la pared, y entonces sus dos extremos quedan libres en el aire — que es
  justo lo que impide el arco de pie.
- ``colgadoM`` cómo se aparta de la recta entre sus extremos: positivo **cuelga** en U (festones), negativo
  **arquea hacia arriba**, cero la deja tensa. Nunca se nombra un arco.
- ``festones`` en cuántos tramos cuelga.
- ``ondaM``/``ondas`` la ondulación a lo largo.
- ``pendienteM`` cuánto sube (+) o baja (−) el extremo derecho respecto al izquierdo.
- ``volumen.racimo`` de cuántos globos es cada racimo, y el rango que de verdad arma el motor.
- ``colores`` **dónde va cada color**: los tramos en su orden de izquierda a derecha, racimos de un solo color o
  la mezcla pareja, y los acentos sueltos. Hasta el 2026-10-05 la frase era la misma para los tres repartos y
  reemplazaba a la del patrón, que sí lo decía, así que la imagen no se enteraba de dónde iba nada.

Las frases de dónde va cada color y del racimo (``frases_del_reparto``, ``rango_del_racimo``) son de las tres
piezas del motor orgánico: el arco y la columna las importan de aquí.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from typing import cast

from app.patron_color import color_con_acabado_en, lista_en, nombre_color_en
from app.patron_de_la_foto import RACIMO_MAX_MOTOR, RACIMO_MIN_MOTOR

#: Por encima de esto la guirnalda ya no se apoya en el piso. Medio metro es media banda de las gruesas, así
#: que por debajo una guirnalda «alta» seguiría tocando el suelo.
ALTURA_EN_ALTO_M = 0.5

#: Por encima de esto la guirnalda va en alto, montada en la pared o colgada; entre ``ALTURA_EN_ALTO_M`` y esto
#: corre a la altura de una mesa. Está entre la mesa de la receta (0,75 m, ``armado_estructura.ALTURA_MESA_M``)
#: y la forma lista de pared más baja del diseñador (``diagonal``, 1,1 m): una guirnalda a la altura de una mesa
#: que se contaba «montada en la pared, en alto» salía colgada en la pared (2026-10-05).
ALTURA_DE_PARED_M = 1.0

#: Desde aquí el difuminado del reparto por tramos (``colores.mezcla``) funde un color en el siguiente, y hasta
#: ``BORDE_LIMPIO`` deja los bordes limpios: los valores con los que la receta arma un degradé (0,9) y unos
#: bloques o unas zonas (0,05), ``patron_de_la_foto._MEZCLA_DE_MODO``.
DIFUMINADO_FUNDIDO = 0.6
BORDE_LIMPIO = 0.2

#: Desde este tamaño un globo cuenta como de los grandes al decir dónde van.
PULGADAS_GRANDES = 18

#: Por debajo de esto la curva o la ondulación no se ven y no se nombran: el motor acota en metros y un par de
#: centímetros son ruido, no un diseño.
MINIMO_VISIBLE_M = 0.05

#: Cifras en palabras para el caption LoRA, que no lleva dígitos.
_DIGITOS_EN = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
}


def _numero(valor: object) -> str:
    """Una medida en metros, a decímetros y sin ceros de más."""
    return f"{round(float(cast(float, valor)), 1):g}"


def _flotante(forma: Mapping[str, object], clave: str) -> float:
    valor = forma.get(clave)
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return 0.0
    return float(valor)


def _ascii_sin_cifras(texto: str) -> str:
    """El fragmento LoRA: ASCII, sin cifras y sin espacios dobles (ADR-0028 §8)."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return " ".join("".join(c for c in plano if not c.isdigit()).split())


def _plural(cantidad: int, singular: str, plural: str) -> str:
    return f"{cantidad} {singular if cantidad == 1 else plural}"


def _soporte(forma: Mapping[str, object]) -> str:
    """``piso`` | ``mesa`` | ``pared``: dónde corre la guirnalda, leído de la altura de su línea.

    El armado no dice el soporte —lo dice su ``alturaM``, que la receta pone según dónde va la pieza
    (``armado_estructura._linea_del_soporte``)—, así que la frase se lo pregunta a la altura y no a la ubicación
    del plan: dice lo que se armó.
    """
    altura = _flotante(forma, "alturaM")
    if altura < ALTURA_EN_ALTO_M:
        return "piso"
    if altura < ALTURA_DE_PARED_M:
        return "mesa"
    return "pared"


def _indice(color: Mapping[str, object], cuantos: int) -> int | None:
    """El material de una entrada de la paleta, si el plan lo tiene; si no, ``None``."""
    indice = color.get("material")
    if isinstance(indice, bool) or not isinstance(indice, int) or not 0 <= indice < cuantos:
        return None
    return indice


def rango_del_racimo(racimo: int) -> tuple[int, int] | None:
    """Cuántos globos lleva de verdad un racimo del motor, ``(de, a)``, o ``None`` si el armado pide otro.

    El motor no arma racimos iguales: cada uno sale con uno más o uno menos que ``volumen.racimo`` (nunca menos
    de dos). Con un racimo que el motor acota (fuera de ``RACIMO_MIN_MOTOR`` a ``RACIMO_MAX_MOTOR``) no se da
    rango: la cifra del armado ya no es la que se arma, y un rango al lado la contradiría.
    """
    if not RACIMO_MIN_MOTOR <= racimo <= RACIMO_MAX_MOTOR:
        return None
    return max(RACIMO_MIN_MOTOR, racimo - 1), racimo + 1


def texto_del_racimo(racimo: int) -> str:
    """«4 balloons per cluster (3 to 5 in each)»: el racimo del armado y el rango que de verdad arma el motor."""
    rango = rango_del_racimo(racimo)
    en_cada = f" ({rango[0]} to {rango[1]} in each)" if rango is not None else ""
    return f"{_plural(racimo, 'balloon', 'balloons')} per cluster{en_cada}"


def secciones_y_acentos(
    paleta: Sequence[Mapping[str, object]], cuantos: int
) -> tuple[list[int], list[int]]:
    """``(secciones, acentos)`` de la paleta: los materiales de cada tramo en el orden del motor y los sueltos.

    Las secciones van en el orden de la paleta, que es el que recorre el reparto por tramos, con dos entradas
    seguidas del mismo material unidas en una; los acentos (``rol`` ``acento``), sin repetir. Un índice que el
    plan no tiene se descarta.
    """
    secciones: list[int] = []
    acentos: list[int] = []
    for color in paleta:
        indice = _indice(color, cuantos)
        if indice is None:
            continue
        if color.get("rol") == "acento":
            if indice not in acentos:
                acentos.append(indice)
        elif not secciones or secciones[-1] != indice:
            secciones.append(indice)
    return secciones, acentos


def frases_del_reparto(
    colores: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
    *,
    eje_gemini: str,
    eje_lora: str,
    pieza_en: str,
    invertir: bool = False,
) -> tuple[list[str], str]:
    """``(frases para Gemini, cláusula para el LoRA)`` de dónde va cada color en una pieza del motor orgánico.

    - ``tramos``: las secciones en su orden a lo largo del eje («white, then gold, then white»), con bordes
      limpios o fundidas según el difuminado del armado (``colores.mezcla``).
    - ``racimos``: cada racimo de un solo color.
    - ``azar``: nada; es la mezcla pareja que el caption ya da por hecha.
    - los acentos, en cualquier reparto: globos sueltos de un color por toda la pieza.

    Con el vocabulario de las frases del patrón (``patron_color``: «color-blocked in sections of», «in an ombre
    gradient», «each cluster one solid color»), que son las que esta frase reemplaza en el prompt. ``invertir``
    nombra las secciones al revés del orden del motor (un medio arco volteado se cuenta desde su pata).
    """
    secciones, acentos = secciones_y_acentos(
        cast(Sequence[Mapping[str, object]], colores.get("paleta") or []), len(materiales)
    )
    if invertir:
        secciones.reverse()

    def gemini(indice: int) -> str:
        nombre, acabado = materiales[indice]
        return str(color_con_acabado_en(nombre, acabado))

    def lora(indice: int) -> str:
        return str(nombre_color_en(materiales[indice][0]))

    reparto = colores.get("reparto")
    mezcla = _flotante(colores, "mezcla")
    frases: list[str] = []
    clausulas: list[str] = []
    if reparto == "tramos" and len(secciones) > 1:
        borde = (
            ", each blending gradually into the next"
            if mezcla >= DIFUMINADO_FUNDIDO
            else ", with clean edges between sections"
            if mezcla <= BORDE_LIMPIO
            else ""
        )
        frases.append(
            f"Its colors run in sections {eje_gemini}: "
            + ", then ".join(gemini(i) for i in secciones)
            + f"{borde}."
        )
        tonos = [lora(i) for i in secciones]
        if len(tonos) > 4:
            clausulas.append(f"color-blocked in multicolor sections {eje_lora}")
        elif mezcla >= DIFUMINADO_FUNDIDO:
            medio = f" through {lista_en(tonos[1:-1])}" if len(tonos) > 2 else ""
            clausulas.append(
                f"in an ombre gradient from {tonos[0]}{medio} to {tonos[-1]} {eje_lora}"
            )
        else:
            clausulas.append(f"color-blocked in sections of {', then '.join(tonos)} {eje_lora}")
    elif reparto == "racimos" and len(secciones) > 1:
        frases.append(
            "Each cluster is a single solid color, the colors alternating from cluster to cluster."
        )
        clausulas.append("each cluster one solid color")
    if acentos:
        paleta = cast(Sequence[Mapping[str, object]], colores.get("paleta") or [])
        pocos = all(_flotante(paleta[i], "peso") <= 10 for i in acentos if i < len(paleta))
        if pocos:
            frases.append(
                f"Scatter a few small {lista_en([gemini(i) for i in acentos])} balloons over the whole {pieza_en} as"
                " accents, never two of them touching."
            )
            clausulas.append(
                f"with a few small {lista_en([lora(i) for i in acentos])} accent balloons scattered throughout"
            )
        else:
            frases.append(
                f"Scatter single {lista_en([gemini(i) for i in acentos])} balloons over the whole {pieza_en} as"
                " accents, never two of them touching."
            )
            clausulas.append(
                f"with scattered single {lista_en([lora(i) for i in acentos])} accent balloons"
            )
    return frases, ", ".join(clausulas)


def _donde_los_grandes(resuelto: Mapping[str, object]) -> str | None:
    """La frase de dónde quedaron los globos grandes de la guirnalda ya armada, o ``None`` si no hay qué decir.

    Se mira la pieza armada y no los mandos: con el volumen de partida los grandes no caben en los extremos
    delgados y acaban hacia el centro aunque ``grandesAbajo`` los mande a los extremos. Grandes son los de
    ``PULGADAS_GRANDES`` en adelante; si no hay al menos dos, o todos lo son, no se dice nada.
    """
    donde = _tercio_de_los_grandes(resuelto)
    return (
        None if donde is None else f"The large balloons ({PULGADAS_GRANDES} inches and up) {donde}."
    )


def _tercio_de_los_grandes(resuelto: Mapping[str, object]) -> str | None:
    """En qué parte del largo se juntan los globos grandes, contado por tercios."""
    globos = [
        cast(Mapping[str, object], globo)
        for globo in cast(Sequence[object], resuelto.get("globos") or [])
        if isinstance(globo, Mapping)
    ]
    xs = [_flotante(globo, "x") for globo in globos]
    grandes = [
        _flotante(globo, "x") for globo in globos if _flotante(globo, "tamano") >= PULGADAS_GRANDES
    ]
    if len(grandes) < 2 or len(grandes) == len(globos) or max(xs) - min(xs) <= 0:
        return None
    desde, largo = min(xs), max(xs) - min(xs)
    tercios = [0, 0, 0]
    for x in grandes:
        tercios[min(2, int(3 * (x - desde) / largo))] += 1
    izquierda, centro, derecha = (cuenta / len(grandes) for cuenta in tercios)
    if izquierda >= 0.25 and derecha >= 0.25 and izquierda + derecha >= 0.75:
        return "gather toward both ends"
    if izquierda >= 0.6:
        return "gather toward the left end"
    if derecha >= 0.6:
        return "gather toward the right end"
    if centro >= 0.6:
        return "gather around the middle"
    return "are spread along its whole length"


def _colores(
    materiales: Sequence[tuple[str, str]], paleta: Sequence[Mapping[str, object]]
) -> tuple[list[str], list[str]]:
    """``(para Gemini, para el LoRA)``: los colores de la paleta del armado, en su orden, sin repetir.

    Se nombran por lo que se compra, como el patrón (ADR-0028 §8): el color y el acabado del material del plan
    al que apunta cada entrada de la paleta. Un índice que el plan no tiene se descarta en vez de inventarlo.
    """
    gemini: list[str] = []
    lora: list[str] = []
    for color in paleta:
        indice = color.get("material")
        if isinstance(indice, bool) or not isinstance(indice, int):
            continue
        if not 0 <= indice < len(materiales):
            continue
        nombre, acabado = materiales[indice]
        gemini.append(str(color_con_acabado_en(nombre, acabado)))
        lora.append(str(nombre_color_en(nombre)))
    return list(dict.fromkeys(gemini)), list(dict.fromkeys(lora))


def _lados(pendiente: float) -> tuple[str, str]:
    """``(lado alto, lado bajo)``. Pendiente positiva sube el extremo DERECHO."""
    return ("right", "left") if pendiente > 0 else ("left", "right")


def _linea_lora(forma: Mapping[str, object]) -> str:
    """La línea de la guirnalda en positivo y sin cifras, con el vocabulario de la decisión 28.

    Nunca nombra un arco, ni patas, ni bases: FLUX no tiene prompt negativo, así que lo que la pieza **no** es
    no se escribe; se describe lo que sí es.
    """
    colgado = _flotante(forma, "colgadoM")
    onda = _flotante(forma, "ondaM")
    pendiente = _flotante(forma, "pendienteM")
    festones = int(_flotante(forma, "festones") or 1)

    # Todas empiezan por coma: son una cláusula más detrás del soporte, como en ADR-0032.
    if colgado >= MINIMO_VISIBLE_M:
        base = (
            ", dipping in swags" if festones > 1 else ", dipping in a single swag between its ends"
        )
    elif colgado <= -MINIMO_VISIBLE_M:
        base = ", curving gently upward along the top"
    elif onda >= MINIMO_VISIBLE_M:
        base = ", rising and falling in a soft wave along its length"
    else:
        base = ", running straight along its length"
    if abs(pendiente) < MINIMO_VISIBLE_M:
        return base
    alto, bajo = _lados(pendiente)
    return f"{base}, higher on the {alto} and lower at the {bajo} end"


def _linea_gemini(forma: Mapping[str, object]) -> str:
    """Lo mismo para Gemini, que sí lee cifras: las medidas reales de la línea."""
    colgado = _flotante(forma, "colgadoM")
    onda = _flotante(forma, "ondaM")
    pendiente = _flotante(forma, "pendienteM")
    festones = int(_flotante(forma, "festones") or 1)

    if colgado >= MINIMO_VISIBLE_M:
        partes = [
            f"dipping between its ends in {_plural(festones, 'swag', 'swags')},"
            f" about {_numero(colgado)} m deep"
        ]
    elif colgado <= -MINIMO_VISIBLE_M:
        partes = [
            "bowing gently upward along the top, its middle about"
            f" {_numero(abs(colgado))} m above the straight line between its ends"
        ]
    elif onda >= MINIMO_VISIBLE_M:
        partes = [
            f"rising and falling in a soft wave about {_numero(onda)} m deep along its length"
        ]
    else:
        partes = ["running straight along its length"]
    if abs(pendiente) >= MINIMO_VISIBLE_M:
        alto, bajo = _lados(pendiente)
        partes.append(
            f"its {bajo} end hangs about {_numero(abs(pendiente))} m lower than its {alto} end"
        )
    return ", ".join(partes)


def frases_guirnalda_organica(
    armado: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)`` de una guirnalda armada con el motor orgánico.

    ``prompt_gemini`` es una instrucción de montaje con cifras; ``prompt_lora`` es un **modificador** de la
    guirnalda que el compilador del caption ya nombró ("an organic balloon garland of ... balloons"), así que
    no empieza por el sustantivo: empezar por él nombraba dos guirnaldas seguidas, el fallo que ya tuvieron el
    bouquet y la guirnalda de ADR-0032.

    Dice dónde va cada color (``frases_del_reparto``), dónde quedaron los globos grandes, el rango de globos
    por racimo que de verdad arma el motor y dónde se apoya (pared, mesa o piso, por la altura de la línea).
    Corto a propósito: es una frase más dentro del prompt de toda la escena.
    """
    forma = cast(Mapping[str, object], armado.get("forma") or {})
    volumen = cast(Mapping[str, object], armado.get("volumen") or {})
    colores = cast(Mapping[str, object], armado.get("colores") or {})
    paleta = cast(Sequence[Mapping[str, object]], colores.get("paleta") or [])
    gemini_colores, _lora_colores = _colores(materiales, paleta)
    racimo = int(_flotante(volumen, "racimo") or 1)
    soporte = _soporte(forma)
    en_alto = soporte == "pared"

    soporte_gemini, soporte_lora = {
        "pared": (
            "mounted flat against the wall, high up, with both ends hanging free in the air",
            "mounted flat high on the wall",
        ),
        # El vocabulario de la mesa es el del armado por partes (``armado_guirnalda._frase_lora``).
        "mesa": (
            "running along the table edge, at table height",
            "running along the table edge",
        ),
        "piso": ("resting on the floor along the front", "resting on the floor along the front"),
    }[soporte]
    reparto_gemini, reparto_lora = frases_del_reparto(
        colores,
        materiales,
        eje_gemini="from the left end to the right end",
        eje_lora="along its length",
        pieza_en="garland",
    )
    grandes = _donde_los_grandes(resuelto)

    frases = [
        f"GARLAND ASSEMBLY - {soporte_gemini}, {_linea_gemini(forma)}.",
        f"Build it from {texto_del_racimo(racimo)} in "
        + (lista_en(gemini_colores) if gemini_colores else "the approved colors")
        + ", chained from the left end to the right end.",
        *reparto_gemini,
        *([grandes] if grandes else []),
        "Keep the clusters packed tightly against each other so the garland reads as one continuous"
        " organic piece with no gaps, made only of round latex balloons: no ribbons, streamers,"
        " twisted bands or fabric.",
    ]
    if en_alto:
        # El mismo cierre que la decisión 28 le puso a la guirnalda de pared: sin esto la imagen le ponía
        # un soporte de pie debajo para sostenerla.
        frases.insert(
            1,
            "Both ends hang free in the air, well above the floor: no stands, no legs, no poles"
            " and no frame reaching the floor.",
        )
    sueltos = resuelto.get("sueltos")
    if isinstance(sueltos, int) and not isinstance(sueltos, bool) and sueltos > 0:
        frases.append("Leave no balloon floating on its own: every balloon touches another.")

    racimo_en = _DIGITOS_EN.get(racimo, "several")
    # El orden de la decisión 28: soporte, línea, extremos libres, racimo. «both ends free» va detrás de la
    # línea, no pegado al soporte: es lo que cierra la frase contra el arco de pie (y es lo que el prompt de
    # TypeScript lee para saber que va en alto, ``FRASE_EXTREMOS_LIBRES``). Dónde va cada color, al final.
    cabeza = f"{soporte_lora}{_linea_lora(forma)}" + (", both ends free" if en_alto else "")
    lora = f"{cabeza}, in clusters of {racimo_en}" + (f", {reparto_lora}" if reparto_lora else "")
    return " ".join(frases), _ascii_sin_cifras(lora)


__all__ = [
    "ALTURA_DE_PARED_M",
    "ALTURA_EN_ALTO_M",
    "BORDE_LIMPIO",
    "DIFUMINADO_FUNDIDO",
    "MINIMO_VISIBLE_M",
    "PULGADAS_GRANDES",
    "frases_del_reparto",
    "frases_guirnalda_organica",
    "rango_del_racimo",
    "secciones_y_acentos",
    "texto_del_racimo",
]
