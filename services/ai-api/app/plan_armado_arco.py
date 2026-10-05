"""Vista previa del editor de armado de arcos, con su dibujo (ADR-0034).

``POST /internal/v1/plan/armado-arco`` resuelve el armado que manda el editor, o da la receta de la pieza con
``armado_arco: null``, y devuelve **el arco resuelto y su SVG**. Es el gemelo de la vista previa de guirnaldas
(``plan_edicion.vista_previa_armado_guirnalda``, ADR-0032 E6): sin catálogo, sin E/S, sin reloj y sin escribir
nada; el plan llega en el cuerpo y de él sale todo.

Vive en su propio módulo y no dentro de ``plan_edicion.py`` porque no comparte nada con la edición del plan:
no muta el plan, no toca participaciones ni patrones y su único dueño de reglas es ``app/armado_arco.py``, la
puerta del motor migrado. ``app/cotizacion_profesional.py`` es el mismo caso (una operación con su módulo, su
scope y su modelo de petición).

**Aquí no se calcula nada del armado.** Cuántos globos lleva el arco, de qué color es cada uno, qué se compra
y cómo se dibuja lo decide el motor; este módulo solo traduce entre el plan y ``EstructuraArco``, elige la
receta cuando no llega armado y recorta la respuesta a lo que publican los contratos.

El SVG es derivado: no entra en el plan, ni en el snapshot, ni en ``plan_hash`` (ADR-0034, consecuencia 2).
Viaja solo por esta ruta.

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

from app.arco.patrones import config_inicial
from app.armado_arco import (
    VERSION,
    ArmadoInvalido,
    EstructuraArco,
    armado_resuelto,
    avisos_colores_sin_uso,
    limites_de,
    opciones_admitidas,
)
from app.armado_arco_prompt import frases_arco
from app.generated_models import contract_schema
from app.operational_models import OperationalRequest
from app.plan import MERMA, PlanResolutionError, armado_arco_de_patron

# La frontera comparte con la del otro motor la lectura del plan y la política del gris neutro
# (``app/plan_armado_comun.py``). Los tres ``X as X`` son re-exportaciones deliberadas: el aviso, el tono y el
# tope de colores se siguen leyendo desde este módulo (lo hacen sus pruebas y ``__all__``), pero su dueño es
# uno solo.
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


def _texto(valor: object) -> str | None:
    return valor.strip() or None if isinstance(valor, str) else None


PLAN_ARMADO_ARCO_SCOPE = "plan.armado_arco"
PLAN_ARMADO_ARCO_REQUEST_VERSION = "plan-armado-arco.v1"
PLAN_ARMADO_ARCO_RESULT_VERSION = "plan-armado-arco-result.v1"

#: El tipo de pieza que arma este motor. ADR-0034 le da el arco, la columna y la guirnalda; el semiarco, la
#: pared, el centro de mesa y la escultura siguen por el camino viejo, así que aquí solo entra ``arco``.
TIPO_ARCO = "arco"

#: La forma de ``armado-arco.v1`` la valida el contrato exportado, igual que en ``app/armado_arco.py``: la
#: frontera no repite las reglas cruzadas, que son del motor.
_FORMA_ARMADO = Draft7Validator(sub_esquema(ESTRUCTURA_SCHEMA, "properties", "armado_arco"))
#: Lo que se devuelve como ``arco`` es exactamente ``plan_resuelto.armados_arco[]``.
_ESQUEMA_ARCO = sub_esquema(contract_schema("PlanResuelto"), "properties", "armados_arco", "items")
_ARCO_RESUELTO = Draft7Validator(_ESQUEMA_ARCO)
#: Los campos del arco resuelto, en el orden del contrato: el motor devuelve además el dibujo, el desperdicio
#: y el diseño saneado, que no son parte de ``armados_arco[]``.
_CAMPOS_ARCO: tuple[str, ...] = tuple(sub_esquema(_ESQUEMA_ARCO, "properties"))
#: Tope de avisos de ``armados_arco[]``. No coincide con el de la guirnalda orgánica, así que lo lee cada
#: caso de uso de su propio contrato: lo común es dónde va el aviso, no cuántos caben.
MAX_AVISOS: int = tope(sub_esquema(_ESQUEMA_ARCO, "properties", "avisos"), "maxItems")

#: El patrón al que cae la receta cuando la pieza tiene menos colores de los que pide el patrón inicial del
#: motor (la espiral necesita dos). Un color es un arco sólido, que es lo que se arma de verdad.
PATRON_UN_COLOR = "solido"


class PlanArmadoArcoRequest(OperationalRequest):
    """``plan-armado-arco.v1``: resolver el armado de un arco (o, con ``None``, dar su receta).

    Sin catálogo: el plan dice qué pieza es y qué colores lleva. ``colores`` son los tonos ``#rrggbb`` de
    ``materiales`` **en su orden**, tal como los tiene el navegador después de que el catálogo los resolvió;
    es lo mismo que hacen las ``lineas`` de la vista previa de guirnaldas (nombrar lo que Python no puede
    saber sin catálogo) y, como ellas, es opcional: sin ellos el motor dibuja en su gris neutro y lo avisa.
    """

    schema_version: Literal["plan-armado-arco.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_arco: dict[str, object] | None
    colores: list[ColorHex] | None = Field(default=None, max_length=MAX_MATERIALES_PIEZA)

    @field_validator("armado_arco")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_FORMA_ARMADO.iter_errors(valor), None) is not None:
            raise ValueError("armado_arco no cumple armado-arco.v1")
        return valor


def _rango_de_colores(opciones: Mapping[str, object], patron: str) -> tuple[int, int]:
    """Cuántos colores admite un patrón, según el propio motor (``opciones_admitidas``)."""
    for descrito in cast(Sequence[Mapping[str, object]], opciones["patrones"]):
        if descrito["id"] == patron:
            return int(cast(int, descrito["min_colores"])), int(cast(int, descrito["max_colores"]))
    raise RuntimeError(f"el motor no describe el patron {patron}")


def _receta(
    estructura: Mapping[str, object], opciones: Mapping[str, object], cuantos_colores: int
) -> dict[str, object]:
    """El armado por defecto de la pieza: el diseño inicial del motor con la geometría del plan.

    ``config_inicial()`` es la imagen de referencia del diseñador (espiral, herradura, cuartetos a lo ancho,
    globo R12 regular), así que una receta no es una invención de esta frontera: es lo que el motor abre por
    defecto. Solo se cambian dos cosas, que sí son de la pieza: el ancho y el alto que declara el plan, y el
    patrón cuando la pieza no tiene colores para el inicial. Todo lo demás —si el ancho da para el grosor de
    la banda, si el alto cabe en la forma— lo corrige ``armado_resuelto`` y lo cuenta en ``avisos``.
    """
    inicial = config_inicial()
    patron = str(inicial["patron"])
    minimo, _maximo_inicial = _rango_de_colores(opciones, patron)
    if cuantos_colores < minimo:
        patron = PATRON_UN_COLOR
    _minimo, maximo = _rango_de_colores(opciones, patron)
    geometria = dict(cast(Mapping[str, object], inicial["geometria"]))
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    ancho_m = cast(Mapping[str, Mapping[str, float]], opciones)["ancho_m"]
    alto_m = cast(Mapping[str, Mapping[str, float]], opciones)["alto_m"]
    geometria["anchoM"] = acotar(
        medida(medidas.get("ancho_m")) or float(cast(float, geometria["anchoM"])),
        ancho_m["min"],
        ancho_m["max"],
    )
    geometria["altoM"] = acotar(
        medida(medidas.get("alto_m")) or float(cast(float, geometria["altoM"])),
        alto_m["min"],
        alto_m["max"],
    )
    return {
        "version": VERSION,
        "origen": "sugerido",
        "patron": patron,
        "opciones": {
            clave: float(valor)
            for clave, valor in cast(Mapping[str, Mapping[str, float]], inicial["opciones"])[
                patron
            ].items()
        },
        "geometria": geometria,
        "globo": dict(cast(Mapping[str, object], inicial["globo"])),
        "capas": [],
        "secciones": [],
        # Los colores de la pieza en su orden, hasta donde el patrón admite: el primero es el principal.
        "materiales": list(range(min(cuantos_colores, maximo))),
    }


def vista_previa_armado_arco(request: PlanArmadoArcoRequest) -> dict[str, object]:
    """``plan-armado-arco-result.v1``: el armado dado resuelto con su dibujo, o la receta con ``None``.

    Devuelve el arco tal como viajará en ``plan_resuelto.armados_arco[]``, su gráfica (``lienzo`` y ``svg``,
    lo que ``VistaArcoSchema`` publica), el armado con el que se resolvió —para que el editor pueda guardar la
    receta que pidió—, las herramientas que el motor ofrece (``opciones``) y los rangos que la interfaz puede
    mover con este armado puesto (``limites``).
    """
    validar_plan(request.plan)
    estructura = estructura_de(request.plan, request.estructura_id)
    opciones = opciones_admitidas()
    tonos, resueltos = tonos_de(estructura, request.colores)
    pieza = EstructuraArco(es_arco=estructura.get("tipo") == TIPO_ARCO, materiales=tonos)
    armado = (
        dict(request.armado_arco)
        if request.armado_arco is not None
        # Un arco clásico con patrón de color tiene ya su receta: la que la confirmación le escribe y la guía de
        # escena dibuja (``plan.armado_arco_de_patron``). El editor arranca de ese arco y no de otro. Hasta que se
        # guarde, la resolución lo cobra con la fórmula y la rejilla del patrón.
        else armado_arco_de_patron({k: v for k, v in estructura.items() if k != "armado_arco"})
        or _receta(estructura, opciones, len(tonos))
    )
    try:
        # El desperdicio es política del plan, no del armado: el mismo `MERMA` con el que la resolución compra,
        # para que lo que la vista previa dice que hay que comprar sea lo que el plan cobra.
        resuelto = armado_resuelto(pieza, armado, MERMA)
        limites = limites_de(armado, pieza)
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

    arco: dict[str, object] = {
        campo: resuelto[campo] for campo in _CAMPOS_ARCO if campo in resuelto
    }
    # Lo que la imagen lee de este armado (ADR-0035): la misma frase que publicará la resolución.
    arco["estructura_id"] = request.estructura_id
    arco["prompt_gemini"], arco["prompt_lora"] = frases_arco(
        armado,
        resuelto,
        [
            (_texto(material.get("color")), _texto(material.get("acabado")))
            for material in materiales_de(estructura)
        ],
    )
    if not resueltos:
        arco["avisos"] = avisos_con_tono_neutro(cast(Sequence[str], arco["avisos"]), MAX_AVISOS)
    # Los colores de la pieza que el armado no toma no se comprarían: se dice antes de guardar.
    sin_uso = avisos_colores_sin_uso(
        [str(material.get("color") or "") for material in materiales_de(estructura)],
        cast(Sequence[int], armado["materiales"]),
    )
    arco["avisos"] = [*cast(Sequence[str], arco["avisos"]), *sin_uso][:MAX_AVISOS]
    if next(_ARCO_RESUELTO.iter_errors(arco), None) is not None:
        raise RuntimeError("el arco resuelto no cumple plan-resuelto.v1")
    grafica = cast(Mapping[str, object], resuelto["grafica"])
    return {
        "operation_schema_version": PLAN_ARMADO_ARCO_RESULT_VERSION,
        "arco": arco,
        # Solo lo que publica `VistaArcoSchema`: el documento SVG completo que emite el motor es para
        # descargarlo, no para el editor, que lo pinta dentro de su propio `<svg>`.
        "grafica": {"lienzo": grafica["lienzo"], "svg": grafica["svg"]},
        "armado": armado,
        "opciones": opciones,
        "limites": limites,
    }


__all__ = [
    "AVISO_SIN_COLORES",
    "MAX_MATERIALES_PIEZA",
    "PLAN_ARMADO_ARCO_REQUEST_VERSION",
    "PLAN_ARMADO_ARCO_RESULT_VERSION",
    "PLAN_ARMADO_ARCO_SCOPE",
    "PATRON_UN_COLOR",
    "PlanArmadoArcoRequest",
    "TIPO_ARCO",
    "TONO_NEUTRO",
    "vista_previa_armado_arco",
]
