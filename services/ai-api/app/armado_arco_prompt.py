"""Cómo se cuenta un arco armado a los modelos de imagen (ADR-0035, paso 1).

Un arco con ``armado_arco`` se cuenta con el motor, pero ni el prompt de Gemini ni el caption del LoRA sabían nada
de su armado: la imagen salía de ``medidas`` y de los colores, y «Regenerar visual» podía aprobar una imagen
distinta de lo que se cobraba. Aquí Python, que es el dueño del armado, lo describe: el patrón con los colores en
su papel, la forma, las medidas ya armadas y el tamaño del globo.

Es **derivado**: viaja en ``plan_resuelto.armados_arco[]`` (``prompt_gemini`` y ``prompt_lora``), fuera del snapshot
y de ``plan_hash``, como las frases del patrón (ADR-0028 §12), del bouquet (ADR-0030) y de la guirnalda
(ADR-0032). TypeScript solo las inserta, tal cual. Sin armado no hay frase y los prompts son byte a byte los de
siempre.

Gemini lee inglés con cifras (medidas reales, tamaño). El caption LoRA va en ASCII y **sin cifras ni medidas**,
como el de la guirnalda: no aprendió números y una cifra suelta en el caption es ruido.

Lecciones de ``ADR-0032``: una frase de globos no habla de franjas «retorcidas» ni de cuerdas (la imagen salió con
cintas), así que cada patrón se dice como colores de globos y la de Gemini cierra con que es solo de globos.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from app.patron_color import color_con_acabado_en, lista_en, nombre_color_en

#: Cifras en palabras para el caption LoRA («a mix of five colors»), que no lleva dígitos.
_DIGITOS_EN = {5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine"}

_FORMA_EN = {
    "alto": "a tall arch, taller than it is wide",
    "semi": "a half-circle arch",
    "herradura": "a horseshoe arch with straight legs",
}
_FORMA_LORA = {
    "alto": "a tall balloon arch",
    "semi": "a half-circle balloon arch",
    "herradura": "a horseshoe balloon arch with straight legs",
}


def _numero(valor: object) -> str:
    """Una medida en metros, a decímetros y sin ceros de más."""
    return f"{round(float(cast(float, valor)), 1):g}"


def _colores_lora(nombres: Sequence[str]) -> str:
    distintos = list(dict.fromkeys(nombres))
    if len(distintos) > 4:
        cuantos = _DIGITOS_EN.get(len(distintos), "many")
        return f"a mix of {cuantos} colors"
    return str(lista_en(distintos))


def _en_orden(nombres: Sequence[str], opciones: Mapping[str, object]) -> list[str]:
    """Con ``invertir`` el orden de los colores se lee al revés (apilado, chevron, ombré, arcoíris)."""
    return list(reversed(nombres)) if opciones.get("invertir") else list(nombres)


def _patron_en(
    patron: str, colores: Sequence[str], opciones: Mapping[str, object], *, lora: bool
) -> str:
    """El patrón dicho como colores de globos, con cada color en su papel (``colores`` va en el orden del armado)."""
    primero = colores[0]
    en_orden = _en_orden(colores, opciones)
    todos = lista_en(en_orden) if not lora else _colores_lora(en_orden)

    def papel(posicion: int) -> str:
        return colores[posicion] if posicion < len(colores) else primero

    if patron == "solido":
        return f"all in {primero}"
    if patron == "bloques":
        return f"in blocks of color following one another along the arch: {todos}"
    if patron == "apilado":
        return f"in layers of color across the width of the band, from the outer edge to the center: {todos}"
    if patron == "espiral":
        return f"with diagonal stripes of {todos} wrapping around the arch, each stripe made of the balloons' own colors"
    if patron == "espiralPunteada":
        return (
            f"with diagonal stripes of {papel(0)} and {papel(1)} wrapping around the arch,"
            f" and a few {papel(2)} balloons as dot accents"
        )
    if patron == "zigzag":
        return f"with zigzag stripes of {todos} that break from side to side across the band"
    if patron == "chevron":
        return f"with V-shaped chevron stripes of {todos} pointing along the arch"
    if patron == "diamante":
        return (
            f"with a repeating diamond motif: {papel(0)} centers ringed by {papel(1)},"
            f" on a {papel(2)} background"
        )
    if patron == "punteado":
        return f"on a {papel(0)} background with {papel(1)} balloons scattered like polka dots"
    if patron == "franjas":
        return f"with thick diagonal candy-cane stripes of {todos}"
    if patron == "floral":
        fondo = lista_en([papel(0), papel(3)] if len(colores) > 3 else [papel(0)])
        return (
            f"with balloon flowers ({papel(2)} centers and {papel(1)} petals)"
            f" on a background of {fondo}"
        )
    if patron == "ombre":
        return f"in an ordered gradient from {en_orden[0]} to {en_orden[-1]}, through {todos}"
    if patron == "arcoiris":
        return f"in parallel bands of color following the arch like a rainbow, the first color on the outside: {todos}"
    if patron == "doslados":
        return f"with the outside of the arch in {papel(0)} and the inside in {papel(1)}"
    # Un patrón que el motor sume y esta tabla aún no conozca: los colores en orden, sin inventar un dibujo.
    return f"in {todos}"


def _tamano_lora(nominal: int) -> str:
    """El tamaño del globo en palabras (el caption no lleva cifras): solo se dice lo que sale de lo corriente."""
    if nominal <= 9:
        return "small "
    if nominal == 12:
        return ""
    return "giant " if nominal >= 36 else "large "


def frases_arco(
    armado: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str | None, str | None]],
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)`` de un arco armado y resuelto.

    ``materiales`` son el ``(color, acabado)`` de cada material de la pieza, en el orden de ``materiales`` del plan:
    los índices del armado apuntan a ellos y el nombre sale de lo que el plan compra, como en las otras frases.
    """
    patron = str(armado["patron"])
    opciones = cast(Mapping[str, object], armado.get("opciones") or {})
    geometria = cast(Mapping[str, object], armado["geometria"])
    globo = cast(Mapping[str, object], armado["globo"])
    indices = cast(Sequence[int], armado["materiales"])
    forma = str(geometria["forma"])
    nominal = int(cast(int, globo["nominal"]))

    gemini_colores = [color_con_acabado_en(*materiales[i]) for i in indices]
    lora_colores = [nombre_color_en(materiales[i][0]) for i in indices]
    ancho = _numero(resuelto["ancho_m"])
    alto = _numero(resuelto["alto_m"])
    a_lo_ancho = int(cast(int, resuelto["columnas"]))

    gemini = (
        f"ARCH ASSEMBLY — {_FORMA_EN[forma]}, about {ancho} m wide and {alto} m tall, built as a band"
        f" {a_lo_ancho} balloons wide of round {nominal}-inch latex balloons packed tightly in staggered rows,"
        f" {_patron_en(patron, gemini_colores, opciones, lora=False)}."
        " Keep that pattern readable on the band and make the whole arch only of round latex balloons:"
        " no ribbons, streamers or fabric."
    )
    lora = (
        f"{_FORMA_LORA[forma]} made of {_tamano_lora(nominal)}round balloons"
        f" {_patron_en(patron, lora_colores, opciones, lora=True)}"
    )
    return gemini, lora


__all__ = ["frases_arco"]
