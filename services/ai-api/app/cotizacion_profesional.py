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

Globos a granel (opcional): el decorador puede cotizar los globos SUELTOS,
exactamente las unidades del plan y no paquetes cerrados. Cada material trae
entonces ``granel`` (unidades del plan, unidades por paquete, globos extra que
agrega para vender y, si lo escribió, su costo por globo). El precio por globo
de partida es el del paquete ÷ sus unidades, redondeado a pesos (estimado; si
el paquete es de una unidad, es el precio de catálogo de esa unidad). Con
``modo_materiales="granel"`` el total de materiales es el de los globos
sueltos; con ``"paquete"`` (lo de siempre) es el de los paquetes. Se informan
los dos totales y el sobrante que dejarían los paquetes.

Compatibilidad: un Python anterior a esto prohíbe campos de más
(``extra="forbid"``). El cliente manda la cabecera ``x-cotizacion-modos`` y
solo este Python la entiende: con ella el resultado anuncia
``modos_materiales``, y el cliente solo manda ``granel`` a quien lo anunció.
Sin la cabecera ni ``granel``, el resultado es idéntico al de antes.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal, cast

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
#: Globos de una línea a granel (los del plan, los extra o los de un paquete).
MAX_UNIDADES = 100_000

#: Con esta cabecera (cualquier valor) el resultado anuncia los modos de materiales que este Python sabe cotizar.
CABECERA_MODOS_MATERIALES = "x-cotizacion-modos"
ModoMateriales = Literal["paquete", "granel"]
MODOS_MATERIALES: tuple[ModoMateriales, ...] = ("paquete", "granel")

_UNIDAD = Decimal("1")
_CENTESIMA = Decimal("0.01")

Pesos = Annotated[int, Field(ge=0, le=MAX_COP)]
Descripcion = Annotated[str, Field(min_length=1, max_length=120)]
Cantidad = Annotated[Decimal, Field(gt=0, le=MAX_CANTIDAD, decimal_places=2)]
Unidades = Annotated[int, Field(ge=1, le=MAX_UNIDADES)]

SeccionCosto = Literal["mano_de_obra", "equipos_transporte", "indirectos"]
SECCIONES: tuple[SeccionCosto, ...] = ("mano_de_obra", "equipos_transporte", "indirectos")


class GranelMaterial(ContractModel):
    """Los globos sueltos de un material: los del plan y los que el decorador agrega para vender."""

    #: Exactamente los globos que usa el plan (la cotización del plan ya los resolvió).
    unidades_plan: Unidades
    #: Globos por paquete de la variante del catálogo.
    unidades_paquete: Unidades
    unidades_extra: Annotated[int, Field(ge=0, le=MAX_UNIDADES)] = 0
    #: Lo que le cuesta cada globo al decorador; ``None`` usa el del paquete ÷ sus unidades.
    precio_unidad_cop: Pesos | None = None


class LineaMaterial(ContractModel):
    """Una compra del plan: el producto y las bolsas son del catálogo."""

    variant_id: Annotated[str, Field(min_length=1, max_length=160)]
    descripcion: Descripcion
    paquetes: Annotated[int, Field(ge=1, le=MAX_PAQUETES)]
    precio_paquete_catalogo_cop: Pesos
    #: El precio por bolsa que puso el decorador; ``None`` usa el del catálogo.
    precio_paquete_cop: Pesos | None = None
    #: Los globos sueltos de este material (modo a granel); ``None`` sin granel.
    granel: GranelMaterial | None = None


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
    #: Qué total de materiales entra al precio: el de los paquetes (siempre) o el de los globos sueltos.
    modo_materiales: ModoMateriales = "paquete"

    @model_validator(mode="after")
    def materiales_sin_repetir(self) -> CotizacionProfesionalRequest:
        ids = [linea.variant_id for linea in self.materiales]
        if len(ids) != len(set(ids)):
            raise ValueError("cada variante va una sola vez en materiales")
        return self

    @model_validator(mode="after")
    def granel_en_todos_o_en_ninguno(self) -> CotizacionProfesionalRequest:
        # Medio granel no tiene un total a granel: o todos los materiales traen sus globos sueltos o ninguno.
        con_granel = [linea.granel is not None for linea in self.materiales]
        if any(con_granel) and not all(con_granel):
            raise ValueError("granel va en todos los materiales o en ninguno")
        if self.modo_materiales == "granel" and not all(con_granel):
            raise ValueError("el modo a granel necesita los globos sueltos de cada material")
        return self


def _pesos(valor: Decimal) -> int:
    return int(valor.quantize(_UNIDAD, rounding=ROUND_HALF_UP))


def _centesimas(valor: Decimal) -> float:
    return float(valor.quantize(_CENTESIMA, rounding=ROUND_HALF_UP))


def _granel(linea: LineaMaterial, precio_paquete: int) -> dict[str, object] | None:
    """Los globos sueltos de un material: precio por globo, subtotal y lo que sobraría con paquetes."""

    granel = linea.granel
    if granel is None:
        return None
    # El precio por globo de partida sale del paquete que se cotiza (el del decorador si lo cambió). Con un
    # paquete de una unidad es el precio de esa unidad; con más, es una estimación redondeada a pesos.
    base = _pesos(Decimal(precio_paquete) / granel.unidades_paquete)
    precio = base if granel.precio_unidad_cop is None else granel.precio_unidad_cop
    unidades = granel.unidades_plan + granel.unidades_extra
    capacidad = linea.paquetes * granel.unidades_paquete
    return {
        "unidades_plan": granel.unidades_plan,
        "unidades_extra": granel.unidades_extra,
        "unidades": unidades,
        "unidades_paquete": granel.unidades_paquete,
        "precio_unidad_base_cop": base,
        "precio_unidad_estimado": granel.unidades_paquete > 1,
        "precio_unidad_cop": precio,
        "precio_unidad_editado": precio != base,
        "subtotal_cop": precio * unidades,
        # Los globos del plan que quedarían sin usar si se compran los paquetes de la cotización.
        "sobrante_paquetes": max(0, capacidad - granel.unidades_plan),
    }


def _materiales(lineas: list[LineaMaterial], modo: ModoMateriales) -> tuple[dict[str, object], int]:
    filas: list[dict[str, object]] = []
    total_paquetes = 0
    sueltos: list[dict[str, object]] = []
    for linea in lineas:
        catalogo = linea.precio_paquete_catalogo_cop
        precio = catalogo if linea.precio_paquete_cop is None else linea.precio_paquete_cop
        subtotal = precio * linea.paquetes
        total_paquetes += subtotal
        fila: dict[str, object] = {
            "variant_id": linea.variant_id,
            "descripcion": linea.descripcion,
            "paquetes": linea.paquetes,
            "precio_paquete_catalogo_cop": catalogo,
            "precio_paquete_cop": precio,
            "precio_editado": precio != catalogo,
            "subtotal_cop": subtotal,
        }
        granel = _granel(linea, precio)
        if granel is not None:
            fila["granel"] = granel
            sueltos.append(granel)
        filas.append(fila)
    if not sueltos:
        # Sin granel, exactamente el resultado de siempre (un cliente anterior lo valida estricto).
        return {"lineas": filas, "total_cop": total_paquetes}, total_paquetes

    def suma(campo: str) -> int:
        return sum(int(cast(int, item[campo])) for item in sueltos)

    total_granel = suma("subtotal_cop")
    total = total_granel if modo == "granel" else total_paquetes
    resumen = {
        "lineas": filas,
        "total_cop": total,
        "modo": modo,
        "total_paquetes_cop": total_paquetes,
        "granel": {
            "unidades_plan": suma("unidades_plan"),
            "unidades_extra": suma("unidades_extra"),
            "unidades": suma("unidades"),
            "sobrante_paquetes": suma("sobrante_paquetes"),
            "total_cop": total_granel,
        },
    }
    return resumen, total


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


def cotizar_profesional(
    payload: CotizacionProfesionalRequest, *, anunciar_modos: bool = False
) -> dict[str, object]:
    """``cotizacion-profesional-result.v1`` para los costos que escribió el decorador.

    ``anunciar_modos`` (el cliente mandó ``x-cotizacion-modos``) agrega ``modos_materiales``: así el cliente
    sabe que puede pedir el modo a granel sin mandárselo a un Python que lo rechazaría.
    """

    materiales, total_materiales = _materiales(payload.materiales, payload.modo_materiales)
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
    resultado: dict[str, object] = {
        "operation_schema_version": COTIZACION_PROFESIONAL_RESULT_VERSION,
        "currency": "COP",
        "materiales": materiales,
        **secciones,
        "total_costos_cop": total_costos,
        "utilidad_porcentaje": None if porcentaje is None else float(porcentaje),
        "utilidad_cop": utilidad,
        "precio_sugerido_cop": precio,
        "margen_porcentaje": margen,
    }
    if anunciar_modos:
        resultado["modos_materiales"] = list(MODOS_MATERIALES)
    return resultado


__all__ = [
    "CABECERA_MODOS_MATERIALES",
    "COTIZACION_PROFESIONAL_REQUEST_VERSION",
    "COTIZACION_PROFESIONAL_RESULT_VERSION",
    "COTIZACION_PROFESIONAL_SCOPE",
    "MODOS_MATERIALES",
    "CotizacionProfesionalRequest",
    "GranelMaterial",
    "cotizar_profesional",
]
