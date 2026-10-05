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

- ``alturaM``  dónde vive la guirnalda. Pegada al piso es la tira del frente; por encima va montada en la
  pared, y entonces sus dos extremos quedan libres en el aire — que es justo lo que impide el arco de pie.
- ``colgadoM`` cómo se aparta de la recta entre sus extremos: positivo **cuelga** en U (festones), negativo
  **arquea hacia arriba**, cero la deja tensa. Nunca se nombra un arco.
- ``festones`` en cuántos tramos cuelga.
- ``ondaM``/``ondas`` la ondulación a lo largo.
- ``pendienteM`` cuánto sube (+) o baja (−) el extremo derecho respecto al izquierdo.
- ``volumen.racimo`` de cuántos globos es cada racimo.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from typing import cast

from app.patron_color import color_con_acabado_en, lista_en, nombre_color_en

#: Por encima de esto la guirnalda ya no se apoya en el piso: va montada en la pared o colgada. Medio metro es
#: media banda de las gruesas, así que por debajo una guirnalda «alta» seguiría tocando el suelo.
ALTURA_EN_ALTO_M = 0.5

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


def _en_alto(forma: Mapping[str, object]) -> bool:
    return _flotante(forma, "alturaM") >= ALTURA_EN_ALTO_M


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
    """
    forma = cast(Mapping[str, object], armado.get("forma") or {})
    volumen = cast(Mapping[str, object], armado.get("volumen") or {})
    colores = cast(Mapping[str, object], armado.get("colores") or {})
    paleta = cast(Sequence[Mapping[str, object]], colores.get("paleta") or [])
    gemini_colores, lora_colores = _colores(materiales, paleta)
    racimo = int(_flotante(volumen, "racimo") or 1)
    en_alto = _en_alto(forma)

    soporte_gemini = (
        "mounted flat against the wall, high up, with both ends hanging free in the air"
        if en_alto
        else "resting on the floor along the front"
    )
    soporte_lora = (
        "mounted flat high on the wall" if en_alto else "resting on the floor along the front"
    )

    frases = [
        f"GARLAND ASSEMBLY - {soporte_gemini}, {_linea_gemini(forma)}.",
        f"Build it from {_plural(racimo, 'balloon', 'balloons')} per cluster in "
        + (lista_en(gemini_colores) if gemini_colores else "the approved colors")
        + ", chained from the left end to the right end.",
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
    # línea, no pegado al soporte: es lo que cierra la frase contra el arco de pie.
    cabeza = f"{soporte_lora}{_linea_lora(forma)}" + (", both ends free" if en_alto else "")
    lora = f"{cabeza}, in clusters of {racimo_en}"
    return " ".join(frases), _ascii_sin_cifras(lora)


__all__ = [
    "ALTURA_EN_ALTO_M",
    "MINIMO_VISIBLE_M",
    "frases_guirnalda_organica",
]
