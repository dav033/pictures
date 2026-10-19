"""Vista previa del dibujo esquemático de una pieza sin motor.

``POST /internal/v1/plan/dibujo-estructura`` devuelve **el dibujo de la pared, el aro circular, el techo de
globos o el centro de mesa** que el plan declara: el SVG y el lienzo en el que va. Es el gemelo de las vistas
previas de los motores (``app/plan_armado_columna_organica.py`` y las otras tres): sin catálogo, sin E/S, sin
reloj y sin escribir nada; el plan llega en el cuerpo y de él sale todo.

**No es una vista previa de armado.** Esas cuatro resuelven un armado con el motor del diseñador, que coloca
cada globo y además cuenta y compra. Aquí no hay motor ni armado: estas cuatro piezas no lo tienen, y lo que se
devuelve es el dibujo esquemático de ``app/referencias/dibujos.py`` —«No calculan cantidades: la medida es la
típica de cada estructura»—. Por eso la respuesta es **solo la gráfica**: no hay pieza resuelta, ni conteo, ni
compra, ni opciones, ni límites, y la ruta no tiene edición que ofrecer.

**La mezcla de tamaños la trae quien llama**, tal como la publica ``plan_resuelto.estructuras[].mezcla_real``.
No se recalcula aquí: la pieza tiene una sola cuenta de globos y es la de ``plan.py``. Lo mismo vale al
contrario: nada de esta ruta vuelve al plan. El SVG es derivado y no entra en el plan, ni en el snapshot, ni en
``plan_hash`` (ADR-0034, consecuencia 2); viaja solo por aquí.

El lienzo **no es cuadrado** y además cambia con la pieza (600 × 560 la pared, 600 × 600 el aro y el centro,
640 × 420 el techo), así que la gráfica lleva ``ancho`` y ``alto`` por separado.

Errores de dominio, como ``PlanResolutionError`` (la frontera HTTP los traduce con ``details``):

| Código | HTTP |
| --- | ---: |
| ``estructura_no_encontrada`` | 404 |
| ``invalid_plan`` (el plan recibido incumple plan-decoracion.v1) | 422 |
| ``estructura_sin_dibujo`` (``estructura_id``: la pieza no tiene dibujo esquemático) | 422 |
"""

from __future__ import annotations

from typing import Literal, cast

from jsonschema import Draft7Validator
from pydantic import Field, field_validator

from app.arco.tipos import TAMANOS_GLOBO
from app.dibujo_estructura import dibujo_de
from app.generated_models import contract_schema
from app.operational_models import OperationalRequest
from app.plan import PlanResolutionError
from app.plan_armado_comun import (
    MAX_MATERIALES_PIEZA,
    Identificador,
    estructura_de,
    sub_esquema,
    validar_plan,
)

PLAN_DIBUJO_ESTRUCTURA_SCOPE = "plan.dibujo_estructura"
PLAN_DIBUJO_ESTRUCTURA_REQUEST_VERSION = "plan-dibujo-estructura.v1"
PLAN_DIBUJO_ESTRUCTURA_RESULT_VERSION = "plan-dibujo-estructura-result.v1"

#: La forma de una línea de ``mezcla_real`` la valida el contrato exportado, igual que las otras rutas validan
#: con él la forma de su armado: ``plan-resuelto.v1`` es su dueño y aquí no se repite.
_LINEA_MEZCLA_REAL = Draft7Validator(
    sub_esquema(
        contract_schema("PlanResuelto"),
        "properties",
        "estructuras",
        "items",
        "properties",
        "mezcla_real",
        "items",
    )
)

#: Cuántas líneas de mezcla caben. ``mezcla_real`` agrupa las líneas de la pieza por forma de globo y
#: diámetro, así que su cota es la de la rejilla que puede llenar una estructura: sus materiales (el tope del
#: contrato) por los tamaños redondos del catálogo. No es un número elegido: los dos factores tienen dueño.
MAX_LINEAS_MEZCLA = MAX_MATERIALES_PIEZA * len(TAMANOS_GLOBO)


class PlanDibujoEstructuraRequest(OperationalRequest):
    """``plan-dibujo-estructura.v1``: el dibujo esquemático de una pieza del plan.

    Sin catálogo: el plan dice qué pieza es, qué colores lleva y con qué patrón se pintan, y el color de cada
    material sale de su referencia Sempertex (``app/color_catalogo.py``). ``mezcla_real`` es la mezcla de
    tamaños que la resolución ya calculó para esa pieza, copiada de
    ``plan_resuelto.estructuras[].mezcla_real``; sin ella el dibujo sale con el tamaño estándar, que es el
    respaldo del propio dibujo.
    """

    schema_version: Literal["plan-dibujo-estructura.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    mezcla_real: list[dict[str, object]] = Field(default_factory=list, max_length=MAX_LINEAS_MEZCLA)

    @field_validator("mezcla_real")
    @classmethod
    def validar_mezcla(cls, valor: list[dict[str, object]]) -> list[dict[str, object]]:
        for linea in valor:
            if next(_LINEA_MEZCLA_REAL.iter_errors(linea), None) is not None:
                raise ValueError("mezcla_real no cumple plan-resuelto.v1")
        return valor


def vista_previa_dibujo_estructura(request: PlanDibujoEstructuraRequest) -> dict[str, object]:
    """``plan-dibujo-estructura-result.v1``: la gráfica de la pieza (``ancho``, ``alto`` y ``svg``).

    ``estructura_sin_dibujo`` (422) cuando la pieza no tiene uno: o la arma un motor —y entonces el dibujo es
    el de su vista previa, que coloca cada globo— o no tiene forma fija (la figura). Es un rechazo y no una
    respuesta vacía porque quien llama sabe de antemano cuáles se dibujan: pedirlo de otra pieza es un error
    suyo, no un caso normal.
    """
    validar_plan(request.plan)
    estructura = estructura_de(request.plan, request.estructura_id)
    dibujo = dibujo_de(estructura, request.mezcla_real)
    if dibujo is None:
        raise PlanResolutionError(
            "estructura_sin_dibujo", 422, {"estructura_id": request.estructura_id}
        )
    return {
        "operation_schema_version": PLAN_DIBUJO_ESTRUCTURA_RESULT_VERSION,
        # El lienzo va con ancho y alto porque no es cuadrado y cambia con la pieza. Lo que viaja es el
        # interior del `<svg>`, como en las vistas previas de los motores: la interfaz lo pinta dentro del suyo.
        "grafica": {
            "ancho": cast(float, dibujo["ancho"]),
            "alto": cast(float, dibujo["alto"]),
            "svg": cast(str, dibujo["svg"]),
        },
    }


__all__ = [
    "MAX_LINEAS_MEZCLA",
    "PLAN_DIBUJO_ESTRUCTURA_REQUEST_VERSION",
    "PLAN_DIBUJO_ESTRUCTURA_RESULT_VERSION",
    "PLAN_DIBUJO_ESTRUCTURA_SCOPE",
    "PlanDibujoEstructuraRequest",
    "vista_previa_dibujo_estructura",
]
