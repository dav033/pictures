"""El color de un material del plan como lo fabrica Sempertex: la referencia que se compra.

``referencia_de`` resuelve (color, acabado) del plan a la referencia de la tabla del repo dueño
(``clasificador-decoraciones/scripts/migracion/tabla-color-sempertex.ts`` → ``app/motores/tabla-color.json``,
que no se edita aquí), y ``acabado_del_motor`` lleva su familia al acabado con el que pinta el motor orgánico.

El bloque de cifras para Gemini (código, Pantone y color del globo inflado) **ya no se arma aquí**: desde
2026-10-04 lo arma el prompt de imagen para todas las piezas con globos (``bloqueColoresExactos`` en
``src/lib/ia/uzume/build-image-prompt.ts``, con ``referenciaDelCatalogo`` de ``referencia-sempertex.ts``, la
misma prioridad de familias que ``_FAMILIAS_POR_ACABADO``). Antes solo lo llevaban las piezas del motor.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from typing import Any, Mapping

from app.motores.canonico import TABLA


#: De la palabra de acabado que trae un material del plan a las familias del catálogo que puede ser, **en
#: orden de preferencia**.
#:
#: Las dos puntas las tienen otros: el vocabulario de acabados del plan es de ``ACABADO_EN``
#: (``mezcla-color-escena.ts``, que Python lee como ``x-acabados-en``) y las familias son de la tabla. Lo que
#: vive aquí es el emparejamiento, y es de aquí porque no es el mismo que hace ``acabado-observado.ts``: ese
#: parte de lo que un modelo escribió mirando una foto («chrome gold») y tiene que perdonar que no diga el
#: acabado; este parte de la palabra que el propio catálogo le puso al material, que siempre lo dice.
#:
#: El orden importa y no es el de la tabla: «cromado» es antes un Reflex que un Metal, y quedarse con el
#: primero de la tabla daba el Metal Dorado (``#8c6b30``) donde se compra el Reflex (``#c5a253``). Es la misma
#: prioridad que ya aplicaba ``hexDelCatalogo`` en TypeScript.
_FAMILIAS_POR_ACABADO: Mapping[str, tuple[str, ...]] = {
    "reflex": ("reflex", "metal"),
    "cromado": ("reflex", "metal"),
    "metal": ("metal", "reflex"),
    "metalizado": ("metal", "reflex"),
    "satin": ("satin", "silk"),
    "satinado": ("satin", "silk"),
    "perlado": ("silk", "satin"),
    "perla": ("silk", "satin"),
    "fashion": ("fashion", "pastelMate", "neon"),
    "mate": ("fashion", "pastelMate", "neon"),
    "pastel": ("pastelMate", "pastelDusk"),
    "pastel mate": ("pastelMate", "pastelDusk"),
    "neon": ("neon",),
    "transparente": ("cristal",),
    "cristal": ("cristal",),
    "translucido": ("cristal",),
}


def _plegar(texto: str) -> str:
    """Sin tildes, sin dobles espacios y en minúsculas: así se comparan dos nombres de distinta mano."""
    plano = unicodedata.normalize("NFD", texto)
    sin_tildes = "".join(c for c in plano if unicodedata.category(c) != "Mn")
    return " ".join(sin_tildes.strip().lower().split())


@lru_cache(maxsize=1)
def _por_nombre() -> Mapping[str, tuple[dict[str, Any], ...]]:
    """Del nombre en español de la lámina a sus referencias, en el orden de la lámina.

    Varias por nombre a propósito: «Dorado» son seis referencias (una por familia), y cuál de ellas se compra
    lo dice el acabado. El orden de la tabla es el del fabricante, que empieza por Fashion, la que se vende
    por defecto.
    """
    crudo = json.loads(TABLA.read_text(encoding="utf-8"))
    indice: dict[str, list[dict[str, Any]]] = {}
    for referencia in crudo["referencias"]:
        indice.setdefault(_plegar(str(referencia["nombre"])), []).append(referencia)
    return {nombre: tuple(refs) for nombre, refs in indice.items()}


def referencia_de(color: str | None, acabado: str | None) -> dict[str, Any] | None:
    """La referencia del catálogo que se compra para ese color y ese acabado, o ``None``.

    ``None`` cuando el color no es un nombre de la lámina —la paleta del plan tiene 26 palabras y 16 nombran
    una referencia— o cuando viene vacío. Quien llame se queda con las palabras de siempre: un color que no
    está en la lámina no se inventa.
    """
    if not color:
        return None
    candidatas = _por_nombre().get(_plegar(color))
    if not candidatas:
        return None
    for familia in _FAMILIAS_POR_ACABADO.get(_plegar(acabado or ""), ()):
        for referencia in candidatas:
            if referencia.get("familia") == familia:
                return referencia
    # Sin acabado que restrinja, o con uno que ninguna de estas referencias tiene, la primera de la lámina.
    return candidatas[0]


def referencia_del_titulo(titulo: str | None, acabado: str | None) -> dict[str, Any] | None:
    """La referencia que nombra el título del producto que se compra, o ``None`` si no nombra una sola.

    El color del material es la familia («azul») y la familia cae en su primera referencia: el Azul 040, un
    celeste. El producto comprado dice el tono («Fashion Azul Rey», «Fashion Azul Naval»), y la guía de escena
    dibujaba celestes unas columnas azul rey (pruebas del 2026-10-05). Se busca el nombre más largo de la
    lámina que el título dice con palabras enteras; con dos nombres distintos no se elige ninguno.
    """
    if not titulo:
        return None
    plegado = f" {' '.join(re.sub(r'[^a-z0-9]+', ' ', _plegar(titulo)).split())} "
    dichos = [nombre for nombre in _por_nombre() if f" {nombre} " in plegado]
    # «azul» va dentro de «azul rey»: el nombre que otro más largo contiene no es otro tono.
    tonos = [
        nombre
        for nombre in dichos
        if not any(nombre != otro and f" {nombre} " in f" {otro} " for otro in dichos)
    ]
    if len(tonos) != 1:
        return None
    return referencia_de(tonos[0], acabado)


#: La familia de la referencia del catálogo, en el acabado con el que pinta el motor orgánico. Es la tabla
#: ``acabadoDe`` de ``src/lib/referencias/vista-previa.ts`` del repo dueño (clasificador-decoraciones), y
#: esta es su **única** copia en pictures: la leen el dibujo de las piezas (``dibujo_estructura.py``) y las
#: recetas de los motores orgánicos (``armado_estructura.py`` y ``plan_armado_*_organic*.py``). Lo que no
#: está aquí es látex normal: mate.
ACABADO_MOTOR_POR_FAMILIA: Mapping[str, str] = {
    "cristal": "transparente",
    "metal": "cromado",
    "reflex": "cromado",
}
ACABADO_MOTOR_POR_DEFECTO = "mate"


def acabado_del_motor(color: str | None, acabado: str | None) -> str:
    """El acabado con el que el motor orgánico pinta un material del plan.

    El plan escribe la palabra del catálogo («reflex», «metalizado», «cristal»), y el motor solo conoce
    ``mate``, ``cromado``, ``confeti`` y ``transparente``. El paso de una a otra es el del repo dueño: la
    referencia Sempertex que se compra para ese color y ese acabado, y de ella su familia. Si el color no está
    en la lámina, la familia sale de la palabra de acabado sola, con la misma preferencia que ``referencia_de``
    (un «reflex» rosado sigue siendo cromado). Antes, lo que no se llamara igual que un acabado del motor caía
    a mate y un dorado cromado se dibujaba mate (auditoría 2026-10-04, M3).
    """
    de_la_palabra = _FAMILIAS_POR_ACABADO.get(_plegar(acabado or ""), ())
    referencia = referencia_de(color, acabado)
    familia_comprada = str(referencia.get("familia") or "") if referencia is not None else ""
    # `referencia_de` cae a la primera referencia de la lámina cuando ese color no existe en la familia del
    # acabado (no hay «Rosado Cristal»): ahí manda la palabra del catálogo, no la referencia de respaldo.
    familias = (
        (familia_comprada,)
        if familia_comprada and (not de_la_palabra or familia_comprada in de_la_palabra)
        else de_la_palabra
    )
    for familia in familias:
        if familia in ACABADO_MOTOR_POR_FAMILIA:
            return ACABADO_MOTOR_POR_FAMILIA[familia]
    return ACABADO_MOTOR_POR_DEFECTO


#: Familias que son látex mate de verdad: el motor las pinta mate sin aproximar nada.
_FAMILIAS_MATES = frozenset({"fashion", "pastelMate", "pastelDusk"})


def es_aproximacion_del_motor(color: str | None, acabado: str | None) -> bool:
    """Si el motor pinta este material con un acabado que **no** es el suyo (un perlado o un neón, en mate).

    Sale de las mismas dos tablas que ``acabado_del_motor``: es aproximación cuando el resultado es mate y la
    palabra del catálogo no nombra una familia mate. Sin acabado declarado no hay nada que aproximar.
    """
    if not acabado or acabado_del_motor(color, acabado) != ACABADO_MOTOR_POR_DEFECTO:
        return False
    familias = _FAMILIAS_POR_ACABADO.get(_plegar(acabado), ())
    # La familia preferida de la palabra (la primera, la misma que usa `referencia_de`) decide.
    return not familias or familias[0] not in _FAMILIAS_MATES


__all__ = [
    "ACABADO_MOTOR_POR_DEFECTO",
    "ACABADO_MOTOR_POR_FAMILIA",
    "acabado_del_motor",
    "es_aproximacion_del_motor",
    "referencia_de",
    "referencia_del_titulo",
]
