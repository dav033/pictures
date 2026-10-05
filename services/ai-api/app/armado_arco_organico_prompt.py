"""Cómo se le cuenta a los modelos de imagen un arco armado con el motor orgánico.

Hermana de ``armado_arco_prompt`` (el arco CLÁSICO de patrones, ADR-0035) y de
``armado_guirnalda_organica_prompt`` (la guirnalda del mismo motor orgánico): Python es el dueño del armado y
lo describe; TypeScript solo inserta la frase, tal cual. Viaja en ``plan_resuelto.armados_arco_organico[]``
(``prompt_gemini`` y ``prompt_lora``), **fuera** del snapshot y de ``plan_hash``, como las demás frases
derivadas. Sin armado no hay frase y los prompts son byte a byte los de siempre.

Por qué hacía falta. El arco orgánico se cablea desde el 2026-10-03 —la receta lo construye, el motor lo
cuenta y la resolución lo publica— pero **no producía ninguna frase** para los modelos de imagen: el caption
se quedaba en el sustantivo y los colores, así que la pieza salía a ojo del LoRA y la proporción, la curva, el
lado cargado y el grosor de la banda no llegaban a la imagen que se aprueba. El arco clásico y la guirnalda
orgánica ya tienen la suya desde ADR-0035; esta es la que faltaba.

Qué dice cada mando (los mismos que lee ``_armado_arco_organico`` en ``app/armado_estructura.py``):

- ``forma.anchoM`` / ``forma.altoM``  la proporción: más alto que ancho es un arco alto; mucho más ancho que
  alto, uno bajo y tendido. Se leen de ``resuelto`` (``ancho_m``, ``alto_m``) cuando el motor las devuelve,
  porque recorta el alto y el grosor cuando no caben: la frase no promete lo que no se armó, y así la palabra
  y la cifra de una misma frase no se contradicen. Los mandos quedan de respaldo.
- ``forma.curva``  qué tan cerrada es la curva. Más es más herradura (patas rectas y cima plana, ``p = 2/curva``
  en ``app/organico/espina.py``); menos, una curva que sube a una punta suave.
- ``forma.carga``  de −1 a +1, **qué lado pesa más**, con su lado nombrado: ahí la banda engorda y van los
  globos más grandes. Es lo que hace asimétrico a un arco orgánico, y no se voltea con ``espejo`` (el factor
  del grosor se mide siempre de la pata izquierda a la derecha).
- ``forma.cima``  por dónde pasa el punto más alto: 0,5 centrado, menos corrido a la izquierda.
- ``forma.espejo``  voltea la pieza. **No se dice con la palabra «mirrored»**, que no significa nada sin una
  referencia: se dice volteando los lados que se nombran, que es lo que de verdad hace. Mueve la cima al otro
  lado y, en un medio arco, cambia la pata que se apoya.
- ``forma.corte``  menos de 1 es un **medio arco**: sube por una pata y termina en el aire. Entonces no se
  dice que apoya por sus dos patas, porque no es verdad.
- ``volumen.grosorPatasM`` frente a ``volumen.grosorCimaM``  si la banda engorda hacia arriba o hacia abajo
  (también de ``resuelto``, ``grosor_patas_m`` y ``grosor_cima_m``, por lo mismo).
- ``volumen.racimo``  en racimos de N, en palabras, y para Gemini el rango que de verdad arma el motor.
- ``colores``  dónde va cada color: los tramos en su orden de una pata a la otra (en un medio arco, de su pata a
  su punta), racimos de un solo color o los acentos sueltos (``frases_del_reparto``, la misma de la guirnalda).

**Ojo con ``forma.suelo``**: es la línea del piso del dibujo (``app/organico/dibujo.py``), no si la pieza se
apoya. Un arco orgánico apoya siempre en el suelo por sus patas, y eso es justo lo que lo distingue de una
guirnalda, así que se dice en las dos frases.

El fragmento LoRA es un **modificador**: el compilador del caption ya escribió «an organic balloon garland
arch of ... balloons» (en el corpus v004 un arco de verdad se llama así, regla 4 de
``scripts/lora/recaption-v004.ts``) y pega esto detrás, así que no empieza por el sustantivo ni lo vuelve a
nombrar: nombrarlo otra vez son dos arcos seguidos, el fallo que ya tuvieron el bouquet y la guirnalda. Va en
ASCII y **sin cifras** (ADR-0028 §8): el LoRA v004 no aprendió números y las cantidades van en palabras. Y
todo en positivo, porque FLUX no tiene prompt negativo: se describe lo que la pieza **es**.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from typing import cast

from app.armado_guirnalda_organica_prompt import frases_del_reparto, texto_del_racimo
from app.patron_color import color_con_acabado_en, lista_en

#: Un arco completo. Por debajo es un medio arco: la banda se corta antes de bajar por la otra pata.
ARCO_COMPLETO = 1.0

#: Proporciones (ancho / alto). Hasta la primera es un arco alto; de la última en adelante, bajo y tendido.
PROPORCION_ALTA = 1.0
PROPORCION_PAREJA = 1.35
PROPORCION_TENDIDA = 2.0

#: ``forma.curva`` va de 1,7 a 3,4 y el motor arma la superelipse con ``p = 2/curva``: en 2 es una curva
#: redonda, por debajo se cierra en punta y por encima se abre en herradura de patas rectas y cima plana.
CURVA_ABIERTA = 1.9
CURVA_CERRADA = 2.6

#: Por debajo de esto la cima pasa por el centro y no se corre a ningún lado (``cima`` va de 0,3 a 0,7).
CIMA_CENTRADA = 0.04

#: Por debajo de esto los dos lados pesan igual: ``carga`` acota a ±1 y una pizca no es una asimetría.
CARGA_MINIMA = 0.1

#: Por debajo de esto el grosor de las patas y el de la cima son el mismo: el motor acota en metros y un par
#: de centímetros son ruido, no un diseño.
MINIMO_VISIBLE_M = 0.05

#: Cifras en palabras para el caption LoRA, que no lleva dígitos. El racimo acota a 8.
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


def _flotante(mapa: Mapping[str, object], clave: str, por_defecto: float = 0.0) -> float:
    valor = mapa.get(clave)
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return por_defecto
    return float(valor)


def _ascii_sin_cifras(texto: str) -> str:
    """El fragmento LoRA: ASCII, sin cifras y sin espacios dobles (ADR-0028 §8)."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return " ".join("".join(c for c in plano if not c.isdigit()).split())


def _lado(derecha: bool) -> str:
    """El lado nombrado como lo ve quien mira la pieza de frente."""
    return "right" if derecha else "left"


def _medida(
    resuelto: Mapping[str, object], clave: str, mando: Mapping[str, object], clave_mando: str
) -> float:
    """La medida **ya armada** si el motor la devolvió, y si no el mando que se le pidió.

    Las cifras de Gemini son las que el motor midió (ADR-0035): el arco orgánico baja el alto y el grosor
    cuando no caben en el ancho, y una frase que prometiera el mando describiría otra pieza. La proporción y
    el engorde se leen de **estas mismas** medidas para que la palabra y la cifra de una frase no se
    contradigan nunca.
    """
    valor = resuelto.get(clave)
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or float(valor) <= 0:
        return _flotante(mando, clave_mando)
    return float(valor)


def _colores(
    materiales: Sequence[tuple[str, str]], paleta: Sequence[Mapping[str, object]]
) -> list[str]:
    """Los colores de la paleta del armado, en su orden y sin repetir, para la frase de Gemini.

    Se nombran por lo que se compra, como el patrón (ADR-0028 §8): el color y el acabado del material del plan
    al que apunta cada entrada de la paleta. Un índice que el plan no tiene se descarta en vez de inventarlo.
    El fragmento LoRA no lleva colores: el compilador del caption ya los escribió.
    """
    nombres: list[str] = []
    for color in paleta:
        indice = color.get("material")
        if isinstance(indice, bool) or not isinstance(indice, int):
            continue
        if not 0 <= indice < len(materiales):
            continue
        nombre, acabado = materiales[indice]
        nombres.append(str(color_con_acabado_en(nombre, acabado)))
    return list(dict.fromkeys(nombres))


def _proporcion(ancho: float, alto: float) -> tuple[str, str]:
    """``(Gemini, LoRA)``: lo alto o lo tendido del arco, del ancho y el alto ya armados."""
    if ancho <= 0 or alto <= 0:
        return "an arch", "standing upright"
    relacion = ancho / alto
    if relacion <= PROPORCION_ALTA:
        return "a tall arch, taller than it is wide", "tall and narrow, taller than it is wide"
    if relacion < PROPORCION_PAREJA:
        return "an arch about as wide as it is tall", "about as wide as it is tall"
    if relacion < PROPORCION_TENDIDA:
        return "a wide arch, clearly wider than it is tall", "wider than it is tall"
    return (
        "a low, wide arch, spreading much wider than it is tall",
        "low and wide, spreading much wider than it is tall",
    )


def _curva(forma: Mapping[str, object]) -> tuple[str, str]:
    """``(Gemini, LoRA)``: qué tan cerrada va la curva."""
    curva = _flotante(forma, "curva", CURVA_ABIERTA)
    if curva <= CURVA_ABIERTA:
        return (
            "its curve sweeping up to a soft point at the top",
            "sweeping up to a soft point at the top",
        )
    if curva < CURVA_CERRADA:
        return "its curve a rounded sweep", "softly rounded at the top"
    return (
        "its curve closing in tight, with straight legs and a flat crown like a horseshoe",
        "with straight legs and a flat top",
    )


def _cima(forma: Mapping[str, object]) -> tuple[str, str]:
    """``(Gemini, LoRA)``: por dónde pasa el punto más alto. ``espejo`` lo manda al otro lado."""
    cima = _flotante(forma, "cima", 0.5)
    if abs(cima - 0.5) < CIMA_CENTRADA:
        return "its highest point centered over the opening", "its highest point centered"
    lado = _lado((cima > 0.5) != bool(forma.get("espejo")))
    return (
        f"its highest point shifted toward the {lado} side",
        f"its highest point off to the {lado}",
    )


def _carga(forma: Mapping[str, object]) -> tuple[str, str]:
    """``(Gemini, LoRA)``: qué lado pesa más, que es lo que hace asimétrico a un arco orgánico."""
    carga = _flotante(forma, "carga")
    if abs(carga) < CARGA_MINIMA:
        return (
            "it carries the same volume on both sides",
            "evenly weighted on both sides",
        )
    lado = _lado(carga > 0)
    return (
        f"it carries more volume on the {lado} side, where the band thickens and the largest balloons mass",
        f"heavier and thicker on the {lado}, with the largest balloons massed there",
    )


def _engorde(patas: float, cima: float) -> tuple[str, str]:
    """``(Gemini, LoRA)``: si la banda engorda hacia abajo (patas) o hacia arriba (cima)."""
    if patas - cima >= MINIMO_VISIBLE_M:
        return (
            "thickest at the legs and tapering toward the crown",
            "thickest at the legs and tapering toward the top",
        )
    if cima - patas >= MINIMO_VISIBLE_M:
        return (
            "slimmer at the legs and swelling toward the crown",
            "slimmer at the legs and swelling toward the top",
        )
    return "the same thickness all the way along", "the same thickness all the way along"


def _apoyo(forma: Mapping[str, object]) -> tuple[str, str]:
    """``(Gemini, LoRA)``: que apoya en el suelo por sus patas, lo que lo distingue de una guirnalda.

    Con ``corte`` menor que 1 es un medio arco y solo apoya una pata: la izquierda, o la derecha con
    ``espejo`` (``app/organico/espina.py`` corta por el final y luego voltea).
    """
    if _flotante(forma, "corte", ARCO_COMPLETO) >= ARCO_COMPLETO:
        return (
            "standing on the floor on both legs",
            "standing on the floor on both legs",
        )
    espejo = bool(forma.get("espejo"))
    pata, aire = _lado(espejo), _lado(not espejo)
    return (
        f"standing on the floor on its {pata} leg and climbing until it finishes free in the air"
        f" on the {aire}",
        f"standing on the floor on its {pata} leg, climbing and finishing free in the air"
        f" on the {aire}",
    )


def frases_arco_organico(
    armado: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)`` de un arco armado con el motor orgánico.

    ``prompt_gemini`` es una instrucción de montaje con cifras y medidas reales; ``prompt_lora`` es un
    **modificador** del arco que el compilador del caption ya nombró («an organic balloon garland arch of ...
    balloons»), así que no empieza por el sustantivo ni lo vuelve a nombrar.

    ``materiales`` son el ``(color, acabado)`` de cada material de la pieza, en el orden de ``materiales`` del
    plan: los índices de la paleta apuntan a ellos y el nombre sale de lo que el plan compra.
    """
    forma = cast(Mapping[str, object], armado.get("forma") or {})
    volumen = cast(Mapping[str, object], armado.get("volumen") or {})
    colores = cast(Mapping[str, object], armado.get("colores") or {})
    paleta = cast(Sequence[Mapping[str, object]], colores.get("paleta") or [])
    nombres = _colores(materiales, paleta)
    racimo = int(_flotante(volumen, "racimo", 1.0) or 1)
    ancho = _medida(resuelto, "ancho_m", forma, "anchoM")
    alto = _medida(resuelto, "alto_m", forma, "altoM")
    patas = _medida(resuelto, "grosor_patas_m", volumen, "grosorPatasM")
    cima_m = _medida(resuelto, "grosor_cima_m", volumen, "grosorCimaM")

    proporcion_gemini, proporcion_lora = _proporcion(ancho, alto)
    curva_gemini, curva_lora = _curva(forma)
    cima_gemini, cima_lora = _cima(forma)
    carga_gemini, carga_lora = _carga(forma)
    engorde_gemini, engorde_lora = _engorde(patas, cima_m)
    apoyo_gemini, apoyo_lora = _apoyo(forma)
    # Dónde va cada color. El motor recorre el arco de izquierda a derecha; un medio arco se cuenta desde su
    # pata, que es como lo lee la foto, así que el volteado (pata a la derecha) se nombra al revés.
    medio = _flotante(forma, "corte", ARCO_COMPLETO) < ARCO_COMPLETO
    reparto_gemini, reparto_lora = frases_del_reparto(
        colores,
        materiales,
        eje_gemini="from its foot up to its free end"
        if medio
        else "from the left foot over the top to the right foot",
        eje_lora="from the base to the open tip"
        if medio
        else "from the left base over the top to the right base",
        pieza_en="arch",
        invertir=medio and bool(forma.get("espejo")),
    )

    frases = [
        f"ARCH ASSEMBLY - {proporcion_gemini}, about {_numero(ancho)} m wide and"
        f" {_numero(alto)} m tall, {apoyo_gemini}, {curva_gemini}, {cima_gemini}.",
        f"The band of balloons is about {_numero(patas)} m thick at the legs and"
        f" {_numero(cima_m)} m at the crown, {engorde_gemini}, and {carga_gemini}.",
        f"Build it from {texto_del_racimo(racimo)} in "
        + (lista_en(nombres) if nombres else "the approved colors")
        + ", in balloons of several sizes mixed together, the clusters overlapping and packed tightly"
        " against each other so the whole arch reads as one continuous organic band with no gaps,"
        " made only of round latex balloons: no ribbons, streamers, twisted bands or fabric.",
        *reparto_gemini,
    ]
    sueltos = resuelto.get("sueltos")
    if isinstance(sueltos, int) and not isinstance(sueltos, bool) and sueltos > 0:
        frases.append("Leave no balloon floating on its own: every balloon touches another.")

    # El orden del fragmento: primero lo que lo sostiene (las patas en el suelo, lo que lo separa de una
    # guirnalda), luego la silueta, luego el lado que pesa y el grosor, después el racimo, como en la
    # guirnalda orgánica, y al final dónde va cada color. Nada de esto nombra el arco otra vez: el caption ya
    # lo nombró.
    lora = ", ".join(
        [
            apoyo_lora,
            proporcion_lora,
            curva_lora,
            cima_lora,
            carga_lora,
            engorde_lora,
            f"in clusters of {_DIGITOS_EN.get(racimo, 'several')}",
            *([reparto_lora] if reparto_lora else []),
        ]
    )
    return " ".join(frases), _ascii_sin_cifras(lora)


__all__ = [
    "ARCO_COMPLETO",
    "CARGA_MINIMA",
    "CIMA_CENTRADA",
    "CURVA_ABIERTA",
    "CURVA_CERRADA",
    "MINIMO_VISIBLE_M",
    "PROPORCION_ALTA",
    "PROPORCION_PAREJA",
    "PROPORCION_TENDIDA",
    "frases_arco_organico",
]
