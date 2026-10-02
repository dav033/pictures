"""Lo que comparten las vistas previas de los motores del diseñador (ADR-0034).

``app/plan_armado_arco.py`` y ``app/plan_armado_guirnalda_organica.py`` son el mismo transporte sobre dos
puertas distintas: leen el plan, encuentran la pieza, resuelven con qué tonos se dibuja y recortan la
respuesta a lo que publican los contratos. Esto es la parte que de verdad es una sola, y vive aquí por una
razón concreta: **el gris neutro y su aviso son política**, no plomería. Tenerlos escritos en dos sitios es la
deriva silenciosa que ``AGENTS.md`` persigue —el día que alguien cambie la frase o el tono en uno, el otro
seguirá diciendo lo de antes y nada fallará—.

**Aquí solo entra lo que las dos necesitan igual.** Lo que cada pieza necesita distinto se queda en su
módulo, aunque se parezca:

- El **tope de avisos** sale del contrato de cada resuelto y no coincide (16 en ``armados_arco[]``, 32 en
  ``armados_guirnalda_organica[]``), así que cada caso de uso lo lee con ``sub_esquema``/``tope`` y lo pasa a
  ``avisos_con_tono_neutro``. La política de dónde va el aviso es común; el tope es de cada contrato.
- La **lectura de ``medidas``** no es la misma cosa: en un arco, ``ancho_m`` y ``alto_m`` son la caja
  exterior; en una guirnalda, el eje es ``largo_m`` y, si falta, ``ancho_m``. Lo común es ``medida()``, que
  solo dice si un número sirve como medida; interpretarlo es de cada pieza.
- La forma del armado, los campos del resuelto y el tipo de pieza son de cada contrato.

Puro: sin catálogo, sin E/S y sin reloj.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Annotated, cast

from pydantic import Field, ValidationError

from app.generated_models import PlanDecoracion, contract_schema
from app.motores.canonico import codigo_de, es_hex, hex_de
from app.plan import PlanResolutionError


def sub_esquema(esquema: Mapping[str, object], *claves: str) -> Mapping[str, object]:
    """Un subesquema del contrato exportado, por su camino de claves.

    Las formas y los topes se leen del contrato y no se escriben a mano: el dueño es el Zod de
    ``src/lib/plan/`` y repetir aquí un ``maxItems`` sería un segundo dueño que se desincroniza en silencio.
    """
    actual = esquema
    for clave in claves:
        actual = cast(Mapping[str, object], actual[clave])
    return actual


def tope(esquema: Mapping[str, object], clave: str) -> int:
    """Un tope entero del contrato (``maxItems``, ``maximum``…)."""
    return int(cast(int, esquema[clave]))


#: El esquema de una estructura del plan, de donde salen la forma de cada armado y los topes de la pieza.
ESTRUCTURA_SCHEMA = sub_esquema(
    contract_schema("PlanDecoracion"), "properties", "estructuras", "items"
)
#: Colores por estructura en el plan (``materiales``).
MAX_MATERIALES_PIEZA = tope(sub_esquema(ESTRUCTURA_SCHEMA, "properties", "materiales"), "maxItems")

#: Cuando la pieza llega sin sus tonos resueltos, el dibujo sale en el gris neutro del motor. Se dice en los
#: avisos en vez de inventar un color: el conteo y la compra siguen siendo exactos (van por índice de
#: material), pero lo que se ve no son los colores de la pieza y el decorador tiene que saberlo.
TONO_NEUTRO = str(hex_de(None))
AVISO_SIN_COLORES = (
    "El dibujo va en un tono neutro porque los colores de la pieza no llegaron resueltos."
)

#: El ``estructura_id`` de una petición, con el mismo tope que el resto de los contratos del plan.
Identificador = Annotated[str, Field(min_length=1, max_length=160)]
#: Un tono que llega de fuera. Lo valida la frontera: el motor solo ve ``#rrggbb``.
ColorHex = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


def validar_plan(plan: Mapping[str, object]) -> None:
    """El mismo contrato que exige la resolución: un plan que no lo cumple no se dibuja."""
    try:
        PlanDecoracion.model_validate(plan)
    except ValidationError as error:
        raise PlanResolutionError("invalid_plan", 422) from error


def _estructuras(plan: Mapping[str, object]) -> Sequence[Mapping[str, object]]:
    crudas = plan.get("estructuras")
    if not isinstance(crudas, Sequence):
        return ()
    return [e for e in cast(Sequence[object], crudas) if isinstance(e, Mapping)]


def estructura_de(plan: Mapping[str, object], estructura_id: str) -> Mapping[str, object]:
    """La pieza del plan que se va a dibujar, o ``estructura_no_encontrada`` (404)."""
    for estructura in _estructuras(plan):
        if estructura.get("estructura_id") == estructura_id:
            return estructura
    raise PlanResolutionError("estructura_no_encontrada", 404)


def materiales_de(estructura: Mapping[str, object]) -> Sequence[Mapping[str, object]]:
    """Los materiales de la pieza, en su orden: es el orden al que apuntan los índices de un armado."""
    crudos = estructura.get("materiales")
    if not isinstance(crudos, Sequence):
        return ()
    return [m for m in cast(Sequence[object], crudos) if isinstance(m, Mapping)]


def _tono_declarado(material: Mapping[str, object]) -> str | None:
    """El tono del material si se sabe sin catálogo: un ``#rrggbb`` o una referencia Sempertex (``sx:041``).

    Un plan normal nombra el color en palabras («dorado», «rosado»), que no es un tono: resolverlo es del
    catálogo y aquí no hay. Por eso esto devuelve ``None`` y no un gris: quien llama decide qué hacer con la
    falta.
    """
    color = material.get("color")
    if es_hex(color) or codigo_de(color) is not None:
        return str(hex_de(color))
    return None


def tonos_de(
    estructura: Mapping[str, object], colores: Sequence[str] | None
) -> tuple[list[str], bool]:
    """Los tonos con los que el motor pinta la pieza, y si son de verdad los suyos.

    Primero lo que manda el navegador (el catálogo ya los resolvió); si no llegan, lo que el propio plan
    declare en hexadecimal o en referencia; y si tampoco, el gris neutro del motor para todos.
    """
    materiales = materiales_de(estructura)
    if colores is not None and len(colores) >= len(materiales) and materiales:
        return [color.lower() for color in colores[: len(materiales)]], True
    declarados = [_tono_declarado(material) for material in materiales]
    if materiales and all(tono is not None for tono in declarados):
        return [cast(str, tono) for tono in declarados], True
    return [tono if tono is not None else TONO_NEUTRO for tono in declarados], False


def avisos_con_tono_neutro(avisos: Sequence[str], max_avisos: int) -> list[str]:
    """Los avisos del motor más el del gris neutro, que va **último** y siempre cabe.

    Si el motor ya llenó la lista, el aviso desplaza al último suyo: entre perder una corrección del motor y
    no decir que el dibujo no lleva los colores de la pieza, lo segundo es peor. ``max_avisos`` lo pone cada
    contrato, porque no coincide entre los resueltos.
    """
    return [*avisos[: max_avisos - 1], AVISO_SIN_COLORES]


def acotar(valor: float, minimo: float, maximo: float) -> float:
    return min(max(valor, minimo), maximo)


def medida(valor: object) -> float | None:
    """Un número del plan que sirve como medida, o ``None``.

    Solo dice si el valor sirve; **qué medida es** (el ancho de un arco, el eje de una guirnalda) lo
    interpreta cada pieza, que es lo único que sabe a qué mando del motor va.
    """
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor) if valor > 0 else None


__all__ = [
    "AVISO_SIN_COLORES",
    "ColorHex",
    "ESTRUCTURA_SCHEMA",
    "Identificador",
    "MAX_MATERIALES_PIEZA",
    "TONO_NEUTRO",
    "acotar",
    "avisos_con_tono_neutro",
    "estructura_de",
    "materiales_de",
    "medida",
    "sub_esquema",
    "tonos_de",
    "tope",
    "validar_plan",
]
