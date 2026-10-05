"""Cómo se le cuenta a los modelos de imagen una columna clásica ya armada (ADR-0035).

Hermana de ``armado_arco_prompt`` (el arco clásico, con sus catorce patrones) y de
``armado_guirnalda_organica_prompt``: Python es el dueño del armado y lo describe; TypeScript solo inserta la
frase, tal cual. Viaja en ``plan_resuelto.armados_columna[]`` (``prompt_gemini`` y ``prompt_lora``), **fuera**
del snapshot y de ``plan_hash``, como las demás frases derivadas. Sin armado no hay frase y los prompts son
byte a byte los de siempre.

Por qué hacía falta. Una columna clásica (``armado_columna``) es una torre de anillos con patrón: el patrón
decide el color de cada globo, ``globos_capa`` cuántos globos tiene cada anillo, el inflado cuántos anillos
caben en el alto, y el remate qué corona la punta. De todo eso el caption del LoRA solo sabía decir «a balloon
column of ... balloons»: ni el patrón, ni los globos por capa, ni el remate de la punta llegaban a la imagen,
así que «Regenerar visual» podía aprobar una imagen que no es lo que se cobra. Es exactamente el agujero que
ADR-0035 tapó para el arco; esta es la gemela que faltaba.

El remate es el caso más caro. Con ``remate.tipo: "ninguno"`` la columna termina a ras de su último anillo, y
hay que decirlo **en positivo**: FLUX no tiene prompt negativo y un «no topper» en el caption le hace dibujar
uno. Es el mismo fallo que el 2026-10-04 coronó con un globo gigante dos columnas orgánicas que el plan no
corona.

De dónde salen los datos. Lo que el motor **colocó** (``resuelto``) manda sobre lo que el armado **pidió**: los
globos por anillo, el tamaño de los globos de abajo y de arriba, cuántos anillos hay, las medidas y los globos
del remate se leen de la columna resuelta. El motor sanea el armado (un racimo R24 que no cabe sale a R18) y la
frase tiene que contar la columna que se construye, no la que se escribió.

Gemini lee inglés con cifras (medidas reales, tamaños nominales, globos por anillo). El fragmento LoRA va en
ASCII y **sin cifras** (ADR-0028 §8): el v004 no aprendió números, así que las cantidades van en palabras. Es
un **modificador** y no empieza por el sustantivo: el compilador del caption ya escribió «a balloon column of
... balloons» y pega esto detrás (``lora-caption-compiler.ts``), así que empezar por el sustantivo nombraría
dos columnas seguidas — el fallo que ya tuvieron el bouquet y la guirnalda. Nunca nombra un arco: en el
vocabulario del corpus esa palabra es otra pieza.

Lección de ADR-0032: la frase de Gemini cierra con que la pieza es solo de globos redondos de látex, sin cintas
ni tela. Con remate de estrella o de corazón el cierre deja fuera ese foil, que sí es parte de lo que se cobra.
"""

from __future__ import annotations

import unicodedata
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import cast

from app.patron_color import color_con_acabado_en, lista_en, nombre_color_en

#: Cifras en palabras para el fragmento LoRA, que no lleva dígitos. Cubre los globos por anillo (3 a 6), los
#: globos de un racimo (3 a 5) y los colores de una columna (hasta 8).
_DIGITOS_EN = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
}

#: Los dos foil que pueden coronar una columna, dichos como lo que son.
_FOIL_EN = {"estrella": "star", "corazon": "heart"}


def _numero(valor: object) -> str:
    """Una medida en metros, a decímetros y sin ceros de más."""
    return f"{round(float(cast(float, valor)), 1):g}"


def _entero(valor: object, defecto: int = 0) -> int:
    """Un entero del armado o de la columna resuelta; lo que no es un número no se inventa."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return defecto
    return int(valor)


def _palabra(cantidad: int) -> str:
    """Una cantidad en palabras para el LoRA; lo que no cabe en la tabla se dice sin cifra."""
    return _DIGITOS_EN.get(cantidad, "several")


def _ascii_sin_cifras(texto: str) -> str:
    """El fragmento LoRA: ASCII, sin cifras y sin espacios dobles (ADR-0028 §8)."""
    plano = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return " ".join("".join(c for c in plano if not c.isdigit()).split())


def _globos(resuelto: Mapping[str, object]) -> Sequence[Mapping[str, object]]:
    return cast(Sequence[Mapping[str, object]], resuelto.get("globos") or [])


def _nombres(
    indices: Sequence[int], materiales: Sequence[tuple[str, str]]
) -> tuple[list[str], list[str]]:
    """``(para Gemini, para el LoRA)``: los colores del plan a los que apuntan esos índices, en su orden.

    Se nombran por lo que el plan compra, como el patrón (ADR-0028 §8): el color y el acabado del material.
    Un índice que el plan no tiene se descarta en vez de inventarle un color.
    """
    gemini: list[str] = []
    lora: list[str] = []
    for indice in indices:
        if not 0 <= indice < len(materiales):
            continue
        color, acabado = materiales[indice]
        gemini.append(str(color_con_acabado_en(color, acabado)))
        lora.append(str(nombre_color_en(color)))
    return gemini, lora


def _indices_patron(armado: Mapping[str, object]) -> list[int]:
    """Los materiales del cuerpo, en el orden del armado (el primero es el color principal)."""
    return [_entero(i, -1) for i in cast(Sequence[object], armado.get("materiales") or [])]


# --- Lo que el motor colocó --------------------------------------------------------------


def _globos_por_anillo(
    resuelto: Mapping[str, object], cuerpo: Mapping[str, object]
) -> tuple[int, int]:
    """``(mínimo, máximo)`` de globos por anillo, contados sobre los globos ya colocados.

    Por altura todos los anillos llevan los mismos; por capas cada capa trae los suyos y pueden variar, así
    que se cuentan en vez de leer ``cuerpo.globos_capa``.
    """
    cuenta = Counter(_entero(globo.get("capa")) for globo in _globos(resuelto))
    if not cuenta:
        declarado = _entero(cuerpo.get("globos_capa"), 4)
        return declarado, declarado
    return min(cuenta.values()), max(cuenta.values())


def _tamanos_cuerpo(
    resuelto: Mapping[str, object], cuerpo: Mapping[str, object]
) -> tuple[int, int]:
    """``(tamaño nominal del anillo de abajo, del de arriba)`` de los globos ya colocados.

    Si difieren, la columna se afina (o se ensancha) a lo largo de la altura. Sale de los globos y no de
    ``cuerpo.abajo``/``cuerpo.arriba`` porque por capas el tamaño lo trae cada capa.
    """
    globos = _globos(resuelto)
    if not globos:
        return _entero(cuerpo.get("abajo"), 12), _entero(cuerpo.get("arriba"), 12)
    por_anillo = {_entero(globo.get("capa")): _entero(globo.get("tamano"), 12) for globo in globos}
    return por_anillo[min(por_anillo)], por_anillo[max(por_anillo)]


# --- El patrón ---------------------------------------------------------------------------


def _colores_lora(nombres: Sequence[str]) -> str:
    """Los colores del fragmento LoRA: más de cuatro distintos se dicen como una mezcla, en palabras."""
    distintos = list(dict.fromkeys(nombres))
    if len(distintos) > 4:
        return f"a mix of {_palabra(len(distintos))} colors"
    return str(lista_en(distintos))


def _lista(colores: Sequence[str], *, lora: bool) -> str:
    """Los colores tal como los dice cada modelo: el LoRA resume una mezcla grande, Gemini los enumera."""
    if not colores:
        return "the approved colors"
    return _colores_lora(colores) if lora else str(lista_en(colores))


def _patron_en(
    patron: str,
    colores: Sequence[str],
    opciones: Mapping[str, object],
    *,
    lora: bool,
    por_capas: bool,
) -> str:
    """El patrón dicho como colores de globos sobre la torre de anillos, con cada color en su papel.

    ``colores`` va en el orden del armado: el primero es el principal, y cada patrón del motor
    (``app/columna/patrones.py``) usa los siguientes en un papel concreto — el diamante pinta el centro con el
    segundo y el anillo con el tercero, el punteado pone los puntos del segundo sobre el fondo del primero, el
    ombré recorre la secuencia de abajo arriba. Un patrón que el motor sume y esta tabla aún no conozca cae a
    los colores en orden, sin inventarle un dibujo.

    Nada de esto lleva cifras: lo que vale para el LoRA vale igual para Gemini, y los mandos numéricos del
    patrón (cuántas vueltas, cuántas capas por banda) no se dicen porque la cifra sin el dibujo no ayuda.
    """
    primero = colores[0] if colores else "the main color"
    todos = _lista(colores, lora=lora)

    def papel(posicion: int) -> str:
        return colores[posicion] if posicion < len(colores) else primero

    if por_capas:
        # Por capas el patrón no decide nada: la lista de capas **es** el diseño y cada una trae sus colores.
        return f"its rings colored one by one from the bottom up, in {todos}"
    if patron == "solido":
        return f"all in {primero}"
    if patron == "apilado":
        return f"in horizontal bands of color stacked up the column from the bottom up: {todos}"
    if patron == "espiral":
        # Con inclinación cero la espiral degenera en rayas verticales rectas, y eso es otra columna.
        inclinacion = opciones.get("inclinacion")
        if isinstance(inclinacion, (int, float)) and not isinstance(inclinacion, bool):
            if not inclinacion:
                return f"with straight vertical stripes of {todos} running from the base to the top"
        return (
            f"with diagonal stripes of {todos} spiraling up around the column,"
            " each stripe made of the balloons' own colors"
        )
    if patron == "rayas":
        return (
            f"with straight vertical stripes of {todos} running from the base to the top,"
            " repeating around the column"
        )
    if patron == "zigzag":
        return (
            f"with zigzag stripes of {todos} that break from side to side as they climb the column"
        )
    if patron == "diamante":
        if len(colores) > 2:
            return (
                f"with a repeating diamond motif around the column: {papel(1)} centers"
                f" ringed by {papel(2)}, on a {papel(0)} background"
            )
        return f"with a repeating motif of {papel(1)} diamonds on a {papel(0)} background"
    if patron == "punteado":
        return (
            f"on a {papel(0)} background with evenly spaced rings of {papel(1)} balloons"
            " dotted up the column"
        )
    if patron == "ombre":
        # ``invertir`` lee la secuencia al revés: el último color del armado queda abajo.
        en_orden = list(reversed(colores)) if opciones.get("invertir") else list(colores)
        if len(en_orden) < 2:
            return f"all in {primero}"
        return (
            f"in an ordered gradient up the column from {en_orden[0]} at the base"
            f" to {en_orden[-1]} at the top, through {_lista(en_orden, lora=lora)}"
        )
    if patron == "aleatorio":
        return f"in {todos} mixed at random, with touching balloons kept in different colors"
    return f"in {todos}"


def _tamano_lora(nominal: int) -> str:
    """El tamaño del globo en palabras (el caption no lleva cifras): solo lo que sale de lo corriente."""
    if nominal <= 9:
        return "small "
    if nominal == 12:
        return ""
    return "giant " if nominal >= 36 else "large "


# --- El remate ---------------------------------------------------------------------------


def _globos_remate(
    resuelto: Mapping[str, object], materiales: Sequence[tuple[str, str]]
) -> tuple[int, int, list[str], list[str]]:
    """``(cuántos globos, su tamaño nominal, colores Gemini, colores LoRA)`` del remate ya resuelto.

    Del remate **resuelto**, no del pedido: el motor baja el tamaño de un racimo que sea más ancho que la
    columna y reparte sus globos entre los colores, y la frase cuenta el remate que se arma.
    """
    lineas = cast(
        Sequence[Mapping[str, object]],
        cast(Mapping[str, object], resuelto.get("remate") or {}).get("globos") or [],
    )
    cuantos = sum(_entero(linea.get("cantidad")) for linea in lineas)
    tamano = max((_entero(linea.get("tamano")) for linea in lineas), default=12)
    gemini, lora = _nombres([_entero(linea.get("material"), -1) for linea in lineas], materiales)
    return cuantos, tamano, gemini, lora


def _remate_gemini(
    tipo: str,
    remate: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
) -> str:
    """Cómo termina la punta, con cifras. Con ``ninguno`` el último anillo **es** la punta, dicho así."""
    alto = _numero(resuelto.get("remate_alto_m") or 0)
    if tipo == "ninguno":
        return (
            "The column ends flush at its top ring: that last ring of balloons is the highest point of the"
            " piece and its top is left bare, with no topper balloon, cluster, star or heart above it."
        )
    if tipo in _FOIL_EN:
        gemini, _lora = _nombres([_entero(remate.get("material"), -1)], materiales)
        color = f" in {gemini[0]}" if gemini else ""
        return (
            f"Crown it with a single {_FOIL_EN[tipo]}-shaped foil balloon{color}, about {alto} m tall,"
            " standing upright on the top ring."
        )
    cuantos, tamano, gemini, _lora = _globos_remate(resuelto, materiales)
    colores = f" in {lista_en(gemini)}" if gemini else ""
    if tipo == "racimo":
        return (
            f"Crown it with a cluster of {cuantos} round {tamano}-inch latex balloons{colores},"
            f" adding about {alto} m above the top ring."
        )
    return (
        f"Crown it with a single round {tamano}-inch latex balloon{colores},"
        f" sitting on the top ring and adding about {alto} m."
    )


def _remate_lora(
    tipo: str,
    remate: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
) -> str:
    """Lo mismo para el caption: en palabras, en positivo y sin nombrar lo que la punta no lleva.

    Con ``ninguno`` se describe la punta que sí hay —el último anillo, a ras— porque FLUX no tiene prompt
    negativo: un «no topper» le hace dibujar uno (2026-10-04).
    """
    if tipo == "ninguno":
        return "ending flush at its top ring, the last ring of balloons level and bare on top"
    if tipo in _FOIL_EN:
        _gemini, lora = _nombres([_entero(remate.get("material"), -1)], materiales)
        color = f"{lora[0]} " if lora else ""
        return f"topped with a {color}foil {_FOIL_EN[tipo]} standing upright"
    cuantos, tamano, _gemini, lora = _globos_remate(resuelto, materiales)
    colores = f" in {_colores_lora(lora)}" if lora else ""
    if tipo == "racimo":
        return (
            f"topped with a cluster of {_palabra(cuantos)}"
            f" {_tamano_lora(tamano)}round balloons{colores}"
        )
    return f"topped with a single {_tamano_lora(tamano)}round balloon{colores}"


# --- El cuerpo ---------------------------------------------------------------------------


def _cuantos_gemini(minimo: int, maximo: int) -> str:
    return str(minimo) if minimo == maximo else f"{minimo} to {maximo}"


def _cuantos_lora(minimo: int, maximo: int) -> str:
    return _palabra(minimo) if minimo == maximo else f"{_palabra(minimo)} to {_palabra(maximo)}"


def _globos_gemini(abajo: int, arriba: int) -> str:
    """Los globos del cuerpo con su tamaño nominal; si cambia de abajo arriba, la columna se afina."""
    if abajo == arriba:
        return f"round {abajo}-inch latex balloons each"
    return (
        "round latex balloons each, graded from"
        f" {abajo}-inch balloons in the bottom ring to {arriba}-inch in the top ring"
    )


def _globos_lora(abajo: int, arriba: int) -> str:
    """Lo mismo sin cifras: el tamaño en palabras, y el cambio dicho como se ve."""
    if abajo == arriba:
        return f"{_tamano_lora(abajo)}round balloons"
    desde, hacia = ("larger", "smaller") if arriba < abajo else ("smaller", "larger")
    return f"round balloons grading from {desde} at the base to {hacia} at the top"


def frases_columna(
    armado: Mapping[str, object],
    resuelto: Mapping[str, object],
    materiales: Sequence[tuple[str, str]],
) -> tuple[str, str]:
    """``(prompt_gemini, prompt_lora)`` de una columna clásica armada y resuelta.

    ``materiales`` son el ``(color, acabado)`` de cada material de la pieza, en el orden de ``materiales`` del
    plan: los índices del armado apuntan a ellos y el nombre sale de lo que el plan compra, como en las otras
    frases.

    ``prompt_gemini`` es una instrucción de montaje con cifras y medidas reales; ``prompt_lora`` es un
    **modificador** de la columna que el compilador del caption ya nombró, en ASCII y sin cifras.
    """
    cuerpo = cast(Mapping[str, object], armado.get("cuerpo") or {})
    remate = cast(Mapping[str, object], armado.get("remate") or {})
    opciones = cast(Mapping[str, object], armado.get("opciones") or {})
    patron = str(armado.get("patron") or "")
    tipo = str(remate.get("tipo") or "ninguno")
    por_capas = armado.get("modo") == "capas" and bool(armado.get("capas"))

    gemini_colores, lora_colores = _nombres(_indices_patron(armado), materiales)
    anillos = _entero(resuelto.get("capas"), 1)
    minimo, maximo = _globos_por_anillo(resuelto, cuerpo)
    abajo, arriba = _tamanos_cuerpo(resuelto, cuerpo)
    escalonado = bool(cuerpo.get("escalonado"))

    alto = _numero(resuelto.get("alto_total_m") or 0)
    diametro = _numero(resuelto.get("diametro_m") or 0)
    pie = (
        "standing on a weighted base plate at its foot"
        if cuerpo.get("base")
        else "standing directly on the floor"
    )
    nido_gemini = (
        "every ring turned half a step over the one below so its balloons nest in the gaps of the"
        " ring beneath"
        if escalonado
        else "every ring stacked straight on the one below, balloon directly over balloon"
    )
    # Con remate de foil la estrella o el corazón son parte de la pieza, así que el cierre de ADR-0032 los
    # deja fuera en vez de pedir que todo sea látex y contradecir la frase anterior.
    solo_latex = " everything below that foil topper" if tipo in _FOIL_EN else " the whole column"
    # Una columna de un solo tamaño es igual de gruesa de abajo arriba; una graduada se afina (o se
    # ensancha) a propósito, y pedirle grosor constante contradiría la frase del cuerpo.
    forma = (
        "Keep the column the same thickness all the way up"
        if abajo == arriba
        else "Let the thickness change gradually with the balloon size"
    )
    frases = [
        f"COLUMN ASSEMBLY - a free-standing balloon column about {alto} m tall and {diametro} m"
        f" across, {pie}, built as a stack of {anillos} rings of {_cuantos_gemini(minimo, maximo)}"
        f" {_globos_gemini(abajo, arriba)}, {nido_gemini},"
        f" {_patron_en(patron, gemini_colores, opciones, lora=False, por_capas=por_capas)}.",
        _remate_gemini(tipo, remate, resuelto, materiales),
        f"{forma} and that color layout readable from the base to the top, and make{solo_latex}"
        " only of round latex balloons: no ribbons, streamers or fabric.",
    ]

    nido_lora = (
        "each ring nested into the gaps of the one below"
        if escalonado
        else "each ring stacked straight over the one below"
    )
    lora = (
        f"stacked in rings of {_cuantos_lora(minimo, maximo)} {_globos_lora(abajo, arriba)},"
        f" {nido_lora}, {_patron_en(patron, lora_colores, opciones, lora=True, por_capas=por_capas)},"
        f" {_remate_lora(tipo, remate, resuelto, materiales)}"
    )
    return " ".join(frases), _ascii_sin_cifras(lora)


__all__ = ["frases_columna"]
