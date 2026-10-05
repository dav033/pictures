"""Vista previa del editor de armado de columnas, con su dibujo (ADR-0034, ADR-0035 paso 3).

``POST /internal/v1/plan/armado-columna`` resuelve el armado que manda el editor, o da la receta de la pieza con
``armado_columna: null``, y devuelve **la columna resuelta y su SVG**. Es el gemelo de la vista previa de arcos
(``app/plan_armado_arco.py``): sin catálogo, sin E/S, sin reloj y sin escribir nada; el plan llega en el cuerpo y de
él sale todo.

**Aquí no se calcula nada del armado.** Cuántas capas lleva la columna, dónde va cada globo, de qué color es y cómo
se dibuja lo decide el motor (``app/columna/``, dueño ``clasificador-decoraciones``); este módulo solo traduce entre
el plan y ``EstructuraColumna``, elige la receta cuando no llega armado y recorta la respuesta a lo que publican los
contratos. La compra de la pieza no sale de aquí: la cuenta ``plan.py`` (ADR-0034 §3).

El SVG es derivado: no entra en el plan, ni en el snapshot, ni en ``plan_hash`` (ADR-0034, consecuencia 2). Viaja
solo por esta ruta.

Errores de dominio, como ``PlanResolutionError`` (la frontera HTTP los traduce con ``details``):

| Código | HTTP |
| --- | ---: |
| ``estructura_no_encontrada`` | 404 |
| ``invalid_plan`` (el plan recibido incumple plan-decoracion.v1) | 422 |
| ``armado_invalido`` (``estructura_id``, ``motivo``, ``mensaje``) | 422 |
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal, cast

from jsonschema import Draft7Validator
from pydantic import Field, field_validator

from app.armado_columna_prompt import frases_columna
from app.armado_columna import (
    ArmadoInvalido,
    EstructuraColumna,
    armado_resuelto,
    avisos_colores_sin_uso,
    config_inicial,
    grafica_de,
    materiales_con_globos,
    limites_de,
    opciones_admitidas,
    opciones_iniciales,
)
from app.generated_models import contract_schema
from app.operational_models import OperationalRequest
from app.plan import PlanResolutionError

# La frontera comparte con los otros motores la lectura del plan y la política del gris neutro
# (``app/plan_armado_comun.py``). Los ``X as X`` son re-exportaciones deliberadas: el aviso, el tono y el tope
# de colores se siguen leyendo desde este módulo, pero su dueño es uno solo.
from app.plan_armado_comun import (
    AVISO_SIN_COLORES as AVISO_SIN_COLORES,
    ESTRUCTURA_SCHEMA,
    MAX_MATERIALES_PIEZA as MAX_MATERIALES_PIEZA,
    TONO_NEUTRO as TONO_NEUTRO,
    ColorHex,
    Identificador,
    acotar,
    avisos_con_tono_neutro,
    estructura_de,
    materiales_de,
    medida,
    sub_esquema,
    tonos_de,
    tope,
    validar_plan,
)

PLAN_ARMADO_COLUMNA_SCOPE = "plan.armado_columna"
PLAN_ARMADO_COLUMNA_REQUEST_VERSION = "plan-armado-columna.v1"
PLAN_ARMADO_COLUMNA_RESULT_VERSION = "plan-armado-columna-result.v1"

#: El tipo de pieza que arma este motor.
TIPO_COLUMNA = "columna"

#: La forma de ``armado-columna.v1`` la valida el contrato exportado, igual que en ``app/plan_armado_arco.py``: la
#: frontera no repite las reglas cruzadas, que son del motor.
_FORMA_ARMADO = Draft7Validator(sub_esquema(ESTRUCTURA_SCHEMA, "properties", "armado_columna"))
#: Lo que se devuelve como ``columna`` es exactamente ``plan_resuelto.armados_columna[]``.
_ESQUEMA_COLUMNA = sub_esquema(
    contract_schema("PlanResuelto"), "properties", "armados_columna", "items"
)
_COLUMNA_RESUELTA = Draft7Validator(_ESQUEMA_COLUMNA)
#: Los campos de la columna resuelta, en el orden del contrato.
_CAMPOS_COLUMNA: tuple[str, ...] = tuple(sub_esquema(_ESQUEMA_COLUMNA, "properties"))
#: Tope de avisos de ``armados_columna[]``; lo lee cada caso de uso de su propio contrato.
MAX_AVISOS: int = tope(sub_esquema(_ESQUEMA_COLUMNA, "properties", "avisos"), "maxItems")
#: Cuántos colores nombra a lo sumo un armado (``materiales`` del contrato).
MAX_MATERIALES_ARMADO: int = tope(
    sub_esquema(ESTRUCTURA_SCHEMA, "properties", "armado_columna", "properties", "materiales"),
    "maxItems",
)

#: El patrón al que cae la receta cuando la pieza tiene menos colores de los que pide el patrón inicial del motor
#: (la espiral necesita dos). Un color es una columna sólida, que es lo que se arma de verdad.
PATRON_UN_COLOR = "solido"


class PlanArmadoColumnaRequest(OperationalRequest):
    """``plan-armado-columna.v1``: resolver el armado de una columna (o, con ``None``, dar su receta).

    Sin catálogo: el plan dice qué pieza es y qué colores lleva. ``colores`` son los tonos ``#rrggbb`` de
    ``materiales`` **en su orden**, tal como los tiene el navegador después de que el catálogo los resolvió; es
    opcional: sin ellos el motor dibuja en su gris neutro y lo avisa.
    """

    schema_version: Literal["plan-armado-columna.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_columna: dict[str, object] | None
    colores: list[ColorHex] | None = Field(default=None, max_length=MAX_MATERIALES_PIEZA)

    @field_validator("armado_columna")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_FORMA_ARMADO.iter_errors(valor), None) is not None:
            raise ValueError("armado_columna no cumple armado-columna.v1")
        return valor


def _minimo_de_colores(opciones: Mapping[str, object], patron: str) -> int:
    """Cuántos colores pide un patrón como mínimo, según el propio motor (``opciones_admitidas``)."""
    for descrito in cast(Sequence[Mapping[str, object]], opciones["patrones"]):
        if descrito["id"] == patron:
            return int(cast(int, descrito["min_colores"]))
    raise RuntimeError(f"el motor no describe el patron {patron}")


def _receta(
    estructura: Mapping[str, object], opciones: Mapping[str, object], cuantos_colores: int
) -> dict[str, object]:
    """El armado por defecto de la pieza: el diseño inicial del motor con el alto del plan.

    ``config_inicial()`` es el diseño con el que el diseñador abre una columna (espiral, 1,6 m, anillos de 4,
    globos R12, base y remate de globo), así que una receta no es una invención de esta frontera. Solo se cambian
    dos cosas, que sí son de la pieza: el alto que declara el plan, y el patrón cuando la pieza no tiene colores
    para el inicial. Todo lo demás —si el alto cabe con el diámetro, si el remate guarda proporción— lo corrige
    ``armado_resuelto`` y lo cuenta en ``avisos``.
    """
    inicial = config_inicial()
    patron = inicial.patron
    if cuantos_colores < _minimo_de_colores(opciones, patron):
        patron = PATRON_UN_COLOR
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    rango_alto = cast(Mapping[str, float], opciones["alto_m"])
    alto_m = acotar(
        medida(medidas.get("alto_m")) or inicial.columna.alto_m,
        rango_alto["min"],
        rango_alto["max"],
    )
    columna, globo, remate = inicial.columna, inicial.globo, inicial.remate
    return {
        "version": "armado-columna.v1",
        "origen": "sugerido",
        "modo": "altura",
        "patron": patron,
        "opciones": dict(opciones_iniciales()[patron]),
        "cuerpo": {
            "alto_m": alto_m,
            "globos_capa": int(columna.globos_capa),
            "abajo": columna.abajo,
            "arriba": columna.arriba,
            "escalonado": columna.escalonado,
            "base": columna.base,
        },
        "inflado": {
            "inflado": globo.inflado,
            "tamano": globo.tamano,
            "compresion": globo.compresion,
            "variacion_tam": globo.variacion_tam,
            "variacion_tono": globo.variacion_tono,
            "desorden": globo.desorden,
            "semilla": int(globo.semilla),
        },
        "remate": {
            "tipo": remate.tipo,
            "tamano": remate.tamano,
            "cantidad": int(remate.cantidad),
            "foil_m": remate.foil_m,
            "material": 0,
        },
        "capas": [],
        # Los colores de la pieza en su orden: el primero es el principal y un patrón toma los que necesita.
        "materiales": list(
            range(1 if patron == PATRON_UN_COLOR else min(cuantos_colores, MAX_MATERIALES_ARMADO))
        ),
    }


def vista_previa_armado_columna(request: PlanArmadoColumnaRequest) -> dict[str, object]:
    """``plan-armado-columna-result.v1``: el armado dado resuelto con su dibujo, o la receta con ``None``.

    Devuelve la columna tal como viajará en ``plan_resuelto.armados_columna[]``, su gráfica (``lienzo`` y ``svg``),
    el armado con el que se resolvió —para que el editor pueda guardar la receta que pidió—, las herramientas que el
    motor ofrece (``opciones``) y los rangos que la interfaz puede mover con este armado puesto (``limites``).
    """
    validar_plan(request.plan)
    estructura = estructura_de(request.plan, request.estructura_id)
    opciones = opciones_admitidas()
    tonos, resueltos = tonos_de(estructura, request.colores)
    pieza = EstructuraColumna(es_columna=estructura.get("tipo") == TIPO_COLUMNA, materiales=tonos)
    armado = (
        dict(request.armado_columna)
        if request.armado_columna is not None
        else _receta(estructura, opciones, len(tonos))
    )
    try:
        resuelto = armado_resuelto(pieza, armado)
        grafica = grafica_de(pieza, armado)
        limites = limites_de(armado, pieza)
        usados = materiales_con_globos(resuelto)
    except ArmadoInvalido as error:
        raise PlanResolutionError(
            "armado_invalido",
            422,
            {
                "estructura_id": request.estructura_id,
                "motivo": error.motivo,
                "mensaje": error.mensaje,
            },
        ) from error

    # `if campo in resuelto` como en el arco y en la guirnalda: desde el 2026-10-04 el contrato publica
    # ademas `estructura_id` y las dos frases para la imagen, que el motor no escribe — las pone esta ruta.
    columna: dict[str, object] = {
        campo: resuelto[campo] for campo in _CAMPOS_COLUMNA if campo in resuelto
    }
    avisos = cast(Sequence[str], columna["avisos"])
    if not resueltos:
        avisos = avisos_con_tono_neutro(avisos, MAX_AVISOS)
    # Los colores de la pieza que el armado no toma no se comprarían: se dice antes de guardar.
    sin_uso = avisos_colores_sin_uso(
        [str(material.get("color") or "") for material in materiales_de(estructura)], usados
    )
    # Lo que la imagen lee de este armado: la misma frase que publicara la resolucion (ADR-0035).
    columna["estructura_id"] = request.estructura_id
    columna["prompt_gemini"], columna["prompt_lora"] = frases_columna(
        armado,
        resuelto,
        [
            (str(material.get("color") or ""), str(material.get("acabado") or ""))
            for material in materiales_de(estructura)
        ],
    )
    columna["avisos"] = [*avisos, *sin_uso][:MAX_AVISOS]
    if next(_COLUMNA_RESUELTA.iter_errors(columna), None) is not None:
        raise RuntimeError("la columna resuelta no cumple plan-resuelto.v1")
    return {
        "operation_schema_version": PLAN_ARMADO_COLUMNA_RESULT_VERSION,
        "columna": columna,
        # Solo lo que publica `VistaColumnaSchema`: el documento SVG completo es para descargarlo, no para el
        # editor, que lo pinta dentro de su propio `<svg>`.
        "grafica": {"lienzo": grafica["lienzo"], "svg": grafica["svg"]},
        "armado": armado,
        "opciones": opciones,
        "limites": limites,
    }


__all__ = [
    "AVISO_SIN_COLORES",
    "MAX_MATERIALES_PIEZA",
    "PATRON_UN_COLOR",
    "PLAN_ARMADO_COLUMNA_REQUEST_VERSION",
    "PLAN_ARMADO_COLUMNA_RESULT_VERSION",
    "PLAN_ARMADO_COLUMNA_SCOPE",
    "PlanArmadoColumnaRequest",
    "TIPO_COLUMNA",
    "TONO_NEUTRO",
    "vista_previa_armado_columna",
]
