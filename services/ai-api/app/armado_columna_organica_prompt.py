"""Cómo se le cuenta a los modelos de imagen una columna armada con el motor orgánico.

Hermana de ``armado_arco_prompt`` (ADR-0035, paso 1) y de ``armado_guirnalda_organica_prompt``: Python es el dueño
del armado y lo describe; TypeScript solo inserta la frase, tal cual. Viaja en
``plan_resuelto.armados_columna_organica[]`` (``prompt_gemini`` y ``prompt_lora``), **fuera** del snapshot y de
``plan_hash``, como las demás frases derivadas. Sin armado no hay frase y los prompts son byte a byte los de siempre.

Por qué hacía falta. El compilador del caption solo sabe nombrar la pieza y sus materiales —«a balloon column of
large and small ... balloons»— y de la columna no dice ni la silueta ni cómo termina arriba. El 2026-10-04 un plan de
**dos** columnas orgánicas rosa/blanco/plata salió de la LoRA con **un globo gigante coronando cada columna**, que no
está en el plan ni en la cotización: ``_armado_columna_organica`` en ``app/armado_estructura.py`` apaga la corona a
propósito —«coronar una columna que nadie vio coronada es inventar globos que se cobran»— y el prompt nunca se
enteraba de esa decisión. Las mismas dos columnas salieron además como torres exentas cuando la foto las tenía
abrazando el fondo.

De ese fallo, lo que arregla esta frase es el armado: la silueta, el lado hacia el que se va la punta, el serpenteo,
el racimo y, sobre todo, **cómo acaba arriba**. La ubicación (contra la pared del fondo, flanqueando) es de la
cláusula del caption, que ya la escribe; repetirla aquí dejaba la cola colgando del racimo, el fallo que la decisión
28 de ADR-0032 anotó en la guirnalda.

La corona en positivo, no en negativo. FLUX **no tiene prompt negativo**: «no large balloon on top» es una
instrucción que entiende como el globo que nombra, y lo dibuja. Con ``corona.activa`` apagada la frase dice en
positivo cómo termina la punta (con los mismos racimos que el resto); encendida, la nombra con su tamaño y su color.
Gemini sí lee negaciones, y las usa igual que las piezas hermanas para el cierre de «solo globos».

Qué dice cada mando:

- ``forma.altoM`` y ``volumen.grosorPatasM`` frente a ``volumen.grosorCimaM``  la silueta: punta bastante más
  delgada que la base, se afina al subir; parecidas, recta de abajo arriba; punta más ancha, se abre arriba.
- ``forma.inclinacionM``  hacia qué lado se va la punta, con su lado nombrado (negativo, a la izquierda).
- ``forma.serpenteoM``  si la línea serpentea en S.
- ``volumen.racimo``  de cuántos globos es cada racimo (en palabras para el LoRA, que no lleva cifras), y para
  Gemini el rango que de verdad arma el motor.
- ``colores``  dónde va cada color: los tramos de la base a la punta, racimos de un solo color o los acentos
  sueltos (``frases_del_reparto``, la misma de la guirnalda).
- ``corona.activa`` (con ``tamano`` y ``material``)  cómo acaba la punta.

El vocabulario es el del corpus v004, el mismo de las piezas hermanas: «tapering», «widest at the base», «leaning»,
«in clusters of four», «topped by a large ... balloon». El fragmento LoRA va en ASCII y **sin cifras** (ADR-0028 §8):
no aprendió números. Y es un **modificador**: el compilador ya escribió el sustantivo, así que no empieza por él —
empezar por él nombraba dos columnas seguidas, el fallo que ya tuvieron el bouquet y la guirnalda. Nunca nombra un
arco: «asymmetrical balloon column» se dibujó doblándose como un medio arco (2026-10-03).
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from typing import cast

from app.armado_guirnalda_organica_prompt import frases_del_reparto, texto_del_racimo
from app.patron_color import color_con_acabado_en, lista_en, nombre_color_en

#: Por debajo de esto una inclinación o un serpenteo no se ven y no se nombran: el motor acota en metros y un par de
#: centímetros son ruido, no un diseño. Es el mismo umbral de la guirnalda orgánica.
MINIMO_VISIBLE_M = 0.05

#: Cuánto tiene que apartarse la punta de la base para que la silueta se nombre. El contrato admite grosores de
#: 0,2 a 3 m, así que la silueta es una proporción, no una diferencia: una punta de 0,45 m sobre una base de 0,85 m
#: (el diseño de partida) se afina, y 0,8 sobre 0,85 es la misma columna de abajo arriba.
PROPORCION_SILUETA = 0.85

#: Cifras en palabras para el caption LoRA, que no lleva dígitos. El racimo del contrato llega a 8.
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

#: La silueta abre el fragmento LoRA. Empieza por palabra y no por coma: el compilador pega la frase detrás del
#: sustantivo con un espacio («... balloons widest at the base and tapering toward the top»), como la hermana.
_SILUETA_LORA = {
    # Ninguna empieza por un determinante: «... balloons the same width from bottom to top» colgaba la medida de
    # los globos y no de la columna. Las tres abren por adjetivo, como el corpus abre sus modificadores.
    "afina": "widest at the base and tapering toward the top",
    "recta": "even in width from bottom to top",
    "abre": "narrow at the base and widening toward the top",
}

#: Lo mismo para Gemini, que lleva las medidas reales detrás (``_silueta_gemini``).
_SILUETA_GEMINI = {
    "afina": "tapering as it rises",
    "recta": "the same thickness from bottom to top",
    "abre": "widening as it rises",
}


def _numero(valor: object) -> str:
    """Una medida en metros, a decímetros y sin ceros de más."""
    return f"{round(float(cast(float, valor)), 1):g}"


def _flotante(mapa: Mapping[str, object], clave: str) -> float:
    valor = mapa.get(clave)
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return 0.0
    return float(valor)


def _ascii_sin_cifras(texto: str) -> str:
    """El fragmento LoRA: ASCII, sin cifras y sin espacios dobles (ADR-0028 §8)."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return " ".join("".join(c for c in plano if not c.isdigit()).split())


def _lado(inclinacion: float) -> str:
    """Hacia qué lado se corre la punta. El contrato: negativo, hacia la izquierda."""
    return "left" if inclinacion < 0 else "right"


def _silueta(volumen: Mapping[str, object]) -> str:
    """``afina`` | ``recta`` | ``abre``, leyendo el grosor de la base y el de la punta del armado.

    Se decide con el armado y no con la columna resuelta a propósito: el grosor pedido es lo que el decorador
    aprobó y lo que la compra cobra, y el motor puede recortarlo unos centímetros al colocar los globos sin que la
    silueta cambie de familia.
    """
    base = _flotante(volumen, "grosorPatasM")
    punta = _flotante(volumen, "grosorCimaM")
    if base <= 0 or punta <= 0:
        return "recta"
    if punta <= base * PROPORCION_SILUETA:
        return "afina"
    if punta * PROPORCION_SILUETA >= base:
        return "abre"
    return "recta"


def _colores_gemini(
    materiales: Sequence[tuple[str, str]], paleta: Sequence[Mapping[str, object]]
) -> list[str]:
    """Los colores de la paleta del armado, en su orden y sin repetir, para la frase de Gemini.

    Se nombran por lo que se compra, como el patrón (ADR-0028 §8): el color y el acabado del material del plan al
    que apunta cada entrada de la paleta. Un índice que el plan no tiene se descarta en vez de inventarlo.

    El fragmento LoRA **no** repite la paleta: el compilador del caption ya nombró cada material de la pieza con su
    color y su acabado justo delante, y decirlos otra vez los contaba dos veces. Lo único de color que sí lleva es el
    globo de la punta, porque de ese no sabe nada.
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


def _tamano_corona_lora(nominal: int) -> str:
    """El tamaño del globo de la punta en palabras (el caption no lleva cifras), como en el arco.

    El corpus corona con «a single larger clear balloon», «a large royal blue balloon»: la punta se dice por lo que
    sobresale del cuerpo, no por su diámetro, así que un R12 es «larger» y no un número que el LoRA no leería.
    """
    if nominal <= 9:
        return "small"
    if nominal <= 12:
        return "larger"
    return "giant" if nominal >= 36 else "large"


def _corona(corona: Mapping[str, object], materiales: Sequence[tuple[str, str]]) -> tuple[str, str]:
    """``(para Gemini, para el LoRA)``: cómo acaba la punta de la columna, siempre en positivo.

    Apagada es el caso que importa: sin esto el caption no decía nada de la punta y la LoRA coronaba la columna con
    un globo gigante que no está en el plan ni en la cotización. Se dice lo que sí hay arriba —los mismos racimos—,
    nunca lo que no hay: FLUX no tiene prompt negativo.
    """
    if corona.get("activa") is not True:
        return (
            "The column ends at the top with the same balloon clusters as the rest of its body,"
            " at the same sizes: nothing larger crowns it and there is no topper.",
            ", ending at the top with the same clusters as the rest",
        )
    nominal = int(_flotante(corona, "tamano") or 12)
    indice = corona.get("material")
    if isinstance(indice, bool) or not isinstance(indice, int) or not 0 <= indice < len(materiales):
        nombre_gemini, nombre_lora = "", ""
    else:
        nombre, acabado = materiales[indice]
        nombre_gemini = f"{color_con_acabado_en(nombre, acabado)} "
        nombre_lora = f"{nombre_color_en(nombre)} "
    return (
        f"Top the column with a single large {nominal}-inch {nombre_gemini}round latex balloon,"
        " sitting on the tip.",
        f", topped by a {_tamano_corona_lora(nominal)} {nombre_lora}balloon",
    )


def _linea_lora(forma: Mapping[str, object]) -> str:
    """Hacia dónde se va la columna y si serpentea, en positivo y sin cifras."""
    partes = []
    inclinacion = _flotante(forma, "inclinacionM")
    if abs(inclinacion) >= MINIMO_VISIBLE_M:
        partes.append(f", leaning toward the {_lado(inclinacion)}")
    if _flotante(forma, "serpenteoM") >= MINIMO_VISIBLE_M:
        partes.append(", curving in a soft S as it rises")
    return "".join(partes)


def _linea_gemini(forma: Mapping[str, object]) -> list[str]:
    """Lo mismo para Gemini, que sí lee cifras: las medidas reales del corrimiento y de la S."""
    partes = []
    inclinacion = _flotante(forma, "inclinacionM")
    if abs(inclinacion) >= MINIMO_VISIBLE_M:
        partes.append(
            f"its top leaning about {_numero(abs(inclinacion))} m to the"
            f" {_lado(inclinacion)} of its base"
        )
    serpenteo = _flotante(forma, "serpenteoM")
    if serpenteo >= MINIMO_VISIBLE_M:
        partes.append(f"its body curving in a soft S about {_numero(serpenteo)} m wide as it rises")
    return partes


def frases_columna_organica(
    armado: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)`` de una columna armada con el motor orgánico.

    ``prompt_gemini`` es una instrucción de montaje con cifras y las medidas ya armadas; ``prompt_lora`` es un
    **modificador** de la columna que el compilador del caption ya nombró («a balloon column of large and small ...
    balloons»), así que no empieza por el sustantivo.

    ``materiales`` son el ``(color, acabado)`` de cada material de la pieza, en el orden de ``materiales`` del plan:
    los índices del armado apuntan a ellos y el nombre sale de lo que el plan compra, como en las otras frases.
    """
    forma = cast(Mapping[str, object], armado.get("forma") or {})
    volumen = cast(Mapping[str, object], armado.get("volumen") or {})
    colores = cast(Mapping[str, object], armado.get("colores") or {})
    paleta = cast(Sequence[Mapping[str, object]], colores.get("paleta") or [])
    gemini_colores = _colores_gemini(materiales, paleta)
    racimo = int(_flotante(volumen, "racimo") or 1)
    silueta = _silueta(volumen)
    corona_gemini, corona_lora = _corona(
        cast(Mapping[str, object], armado.get("corona") or {}), materiales
    )

    # Las medidas son las de la columna ya armada, como en el arco: es lo que se construye y lo que se cobra.
    alto = _numero(resuelto.get("alto_m", _flotante(forma, "altoM")))
    base = _numero(resuelto.get("grosor_base_m", _flotante(volumen, "grosorPatasM")))
    punta = _numero(resuelto.get("grosor_punta_m", _flotante(volumen, "grosorCimaM")))

    cabeza = [
        f"a balloon column about {alto} m tall, about {base} m thick at the base"
        f" and {punta} m at the top, {_SILUETA_GEMINI[silueta]}",
        *_linea_gemini(forma),
    ]
    # Dónde va cada color, solo para Gemini: el fragmento LoRA no repite la paleta (``_colores_gemini``).
    reparto_gemini, _reparto_lora = frases_del_reparto(
        colores,
        materiales,
        eje_gemini="from the base to the top",
        eje_lora="from base to top",
        pieza_en="column",
    )
    frases = [
        "COLUMN ASSEMBLY - " + ", ".join(cabeza) + ".",
        f"Build it from {texto_del_racimo(racimo)} in "
        + (lista_en(gemini_colores) if gemini_colores else "the approved colors")
        + ", in mixed sizes, chained from the floor up to the tip.",
        *reparto_gemini,
        corona_gemini,
        "Keep the clusters packed tightly against each other so the column reads as one continuous"
        " organic piece with no gaps, made only of round latex balloons: no ribbons, streamers,"
        " twisted bands or fabric.",
    ]
    sueltos = resuelto.get("sueltos")
    if isinstance(sueltos, int) and not isinstance(sueltos, bool) and sueltos > 0:
        frases.append("Leave no balloon floating on its own: every balloon touches another.")

    racimo_en = _DIGITOS_EN.get(racimo, "several")
    # El orden es el de la guirnalda: silueta, línea, racimo y cómo acaba arriba. La punta va al final, pegada a lo
    # último que se lee: es lo que la LoRA se inventaba.
    lora = f"{_SILUETA_LORA[silueta]}{_linea_lora(forma)}, in clusters of {racimo_en}{corona_lora}"
    return " ".join(frases), _ascii_sin_cifras(lora)


__all__ = [
    "MINIMO_VISIBLE_M",
    "PROPORCION_SILUETA",
    "frases_columna_organica",
]
