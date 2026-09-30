"""Cotización profesional: el precio al cliente sobre los materiales del plan.

El decorador profesional parte de los materiales que ya cotizó el plan (las
bolsas cerradas y su precio de catálogo) y agrega sus propios costos: mano de
obra, equipos y transporte (alquileres incluidos) y costos indirectos, más el
porcentaje de utilidad. Ningún costo trae un valor predefinido: los escribe el
decorador; lo único que viene del catálogo son los productos y el precio por
bolsa de partida, que el decorador puede cambiar (el precio de su distribuidor).

Las mismas reglas que la plantilla de cotización de Sempertex:

- el subtotal de cada línea es costo unitario × cantidad;
- total de costos = materiales + mano de obra + equipos y transporte + indirectos;
- la utilidad es un recargo sobre el total de costos (30 % sobre el costo), y
  el margen real que deja se informa aparte (30 % sobre el costo es 23,08 % del
  precio);
- precio sugerido = total de costos + utilidad.

Dinero en pesos colombianos enteros, cada redondeo mitad hacia arriba. Sin
catálogo, sin base de datos y sin efectos: nada de esto entra al ``plan_hash``.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.operational_models import ContractModel, OperationalRequest

COTIZACION_PROFESIONAL_SCOPE = "plan.cotizacion_profesional"
COTIZACION_PROFESIONAL_REQUEST_VERSION = "cotizacion-profesional.v1"
COTIZACION_PROFESIONAL_RESULT_VERSION = "cotizacion-profesional-result.v1"

MAX_LINEAS_MATERIALES = 256
MAX_LINEAS_SECCION = 50
#: Un billón de pesos: por encima de esto el número es un error de digitación.
MAX_COP = 1_000_000_000_000
MAX_PAQUETES = 100_000
MAX_CANTIDAD = Decimal("100000")
MAX_UTILIDAD_PORCENTAJE = Decimal("1000")

_UNIDAD = Decimal("1")
_CENTESIMA = Decimal("0.01")

Pesos = Annotated[int, Field(ge=0, le=MAX_COP)]
Descripcion = Annotated[str, Field(min_length=1, max_length=120)]
Cantidad = Annotated[Decimal, Field(gt=0, le=MAX_CANTIDAD, decimal_places=2)]

SeccionCosto = Literal["mano_de_obra", "equipos_transporte", "indirectos"]
SECCIONES: tuple[SeccionCosto, ...] = ("mano_de_obra", "equipos_transporte", "indirectos")


class LineaMaterial(ContractModel):
    """Una compra del plan: el producto y las bolsas son del catálogo."""

    variant_id: Annotated[str, Field(min_length=1, max_length=160)]
    descripcion: Descripcion
    paquetes: Annotated[int, Field(ge=1, le=MAX_PAQUETES)]
    precio_paquete_catalogo_cop: Pesos
    #: El precio por bolsa que puso el decorador; ``None`` usa el del catálogo.
    precio_paquete_cop: Pesos | None = None


class LineaCosto(ContractModel):
    descripcion: Descripcion
    costo_unitario_cop: Pesos
    cantidad: Cantidad


class CotizacionProfesionalRequest(OperationalRequest):
    """``cotizacion-profesional.v1``."""

    schema_version: Literal["cotizacion-profesional.v1"]
    materiales: list[LineaMaterial] = Field(min_length=1, max_length=MAX_LINEAS_MATERIALES)
    mano_de_obra: list[LineaCosto] = Field(default_factory=list, max_length=MAX_LINEAS_SECCION)
    equipos_transporte: list[LineaCosto] = Field(
        default_factory=list, max_length=MAX_LINEAS_SECCION
    )
    indirectos: list[LineaCosto] = Field(default_factory=list, max_length=MAX_LINEAS_SECCION)
    #: ``None`` mientras el decorador no escribe un porcentaje: sin utilidad.
    utilidad_porcentaje: (
        Annotated[Decimal, Field(ge=0, le=MAX_UTILIDAD_PORCENTAJE, decimal_places=2)] | None
    ) = None

    @model_validator(mode="after")
    def materiales_sin_repetir(self) -> CotizacionProfesionalRequest:
        ids = [linea.variant_id for linea in self.materiales]
        if len(ids) != len(set(ids)):
            raise ValueError("cada variante va una sola vez en materiales")
        return self


def _pesos(valor: Decimal) -> int:
    return int(valor.quantize(_UNIDAD, rounding=ROUND_HALF_UP))


def _centesimas(valor: Decimal) -> float:
    return float(valor.quantize(_CENTESIMA, rounding=ROUND_HALF_UP))


def _materiales(lineas: list[LineaMaterial]) -> tuple[list[dict[str, object]], int]:
    filas: list[dict[str, object]] = []
    total = 0
    for linea in lineas:
        catalogo = linea.precio_paquete_catalogo_cop
        precio = catalogo if linea.precio_paquete_cop is None else linea.precio_paquete_cop
        subtotal = precio * linea.paquetes
        total += subtotal
        filas.append(
            {
                "variant_id": linea.variant_id,
                "descripcion": linea.descripcion,
                "paquetes": linea.paquetes,
                "precio_paquete_catalogo_cop": catalogo,
                "precio_paquete_cop": precio,
                "precio_editado": precio != catalogo,
                "subtotal_cop": subtotal,
            }
        )
    return filas, total


def _seccion(lineas: list[LineaCosto]) -> tuple[dict[str, object], int]:
    filas: list[dict[str, object]] = []
    total = 0
    for linea in lineas:
        # Cada línea se redondea a pesos antes de sumar, como la plantilla.
        subtotal = _pesos(Decimal(linea.costo_unitario_cop) * linea.cantidad)
        total += subtotal
        filas.append(
            {
                "descripcion": linea.descripcion,
                "costo_unitario_cop": linea.costo_unitario_cop,
                "cantidad": float(linea.cantidad),
                "subtotal_cop": subtotal,
            }
        )
    return {"lineas": filas, "total_cop": total}, total


def cotizar_profesional(payload: CotizacionProfesionalRequest) -> dict[str, object]:
    """``cotizacion-profesional-result.v1`` para los costos que escribió el decorador."""

    materiales, total_materiales = _materiales(payload.materiales)
    secciones: dict[str, object] = {}
    total_costos = total_materiales
    for nombre in SECCIONES:
        seccion, total = _seccion(getattr(payload, nombre))
        secciones[nombre] = seccion
        total_costos += total
    porcentaje = payload.utilidad_porcentaje
    utilidad = 0 if porcentaje is None else _pesos(Decimal(total_costos) * porcentaje / 100)
    precio = total_costos + utilidad
    margen = None if precio == 0 else _centesimas(Decimal(utilidad) * 100 / Decimal(precio))
    return {
        "operation_schema_version": COTIZACION_PROFESIONAL_RESULT_VERSION,
        "currency": "COP",
        "materiales": {"lineas": materiales, "total_cop": total_materiales},
        **secciones,
        "total_costos_cop": total_costos,
        "utilidad_porcentaje": None if porcentaje is None else float(porcentaje),
        "utilidad_cop": utilidad,
        "precio_sugerido_cop": precio,
        "margen_porcentaje": margen,
    }


__all__ = [
    "COTIZACION_PROFESIONAL_REQUEST_VERSION",
    "COTIZACION_PROFESIONAL_RESULT_VERSION",
    "COTIZACION_PROFESIONAL_SCOPE",
    "CotizacionProfesionalRequest",
    "cotizar_profesional",
]
