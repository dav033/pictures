"""Edición de un plan aprobado y vista previa de su patrón de color (ADR-0028 §9, §10).

Dueño único de la mutación declarativa de un plan: ``agregar``, ``reemplazar``,
``quitar``, ``repartir``, ``mezcla`` y ``patron``. Las cinco primeras son el
port uno a uno de ``aplicarEdicion`` (antes en ``src/lib/plan/aplicar-edicion.ts``,
con su redondeo de ``participacion`` a seis decimales); encima van las reglas
de patrón del §9. Next conserva lo que no es del dominio: el token firmado, la
re-resolución del plan base, la admisión de la variante en el snapshot, la
resolución del plan editado, la firma y la auditoría.

Puro: sin catálogo, sin E/S y sin reloj. Los colores se escriben tal como
llegan, sin canonizar: Next canoniza el plan entero al resolverlo.

Errores de dominio, como ``PlanResolutionError`` (la frontera HTTP los traduce
con ``details``):

| Código | HTTP |
| --- | ---: |
| ``estructura_no_encontrada`` | 404 |
| ``variante_objetivo_no_encontrada`` | 404 |
| ``reparto_no_corresponde`` | 409 |
| ``material_no_editable`` | 409 |
| ``patron_activo`` | 409 |
| ``unico_material`` | 400 |
| ``sin_participacion`` | 400 |
| ``patron_invalido`` (``estructura_id``, ``motivo``, ``mensaje``) | 422 |
| ``invalid_plan`` (el plan recibido o el editado incumple plan-decoracion.v1) | 422 |
"""

from __future__ import annotations

import copy
import math
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Annotated, Literal, cast

from jsonschema import Draft7Validator
from pydantic import ConfigDict, Field, ValidationError, field_validator, model_validator

from app.generated_models import PlanDecoracion, contract_schema
from app.operational_models import ContractModel, OperationalRequest
from app.patron_color import TIPO_REJILLA
from app.plan import (
    PlanResolutionError,
    patron_resuelto_de_estructura,
    sincronizar_participaciones,
    sugerir_patron_para_estructura,
)

PLAN_EDIT_SCOPE = "plan.edit"
PLAN_EDIT_REQUEST_VERSION = "plan-edit.v1"
PLAN_EDIT_RESULT_VERSION = "plan-edit-result.v1"
PLAN_PATRON_SCOPE = "plan.patron"
PLAN_PATRON_REQUEST_VERSION = "plan-patron.v1"
PLAN_PATRON_RESULT_VERSION = "plan-patron-result.v1"

#: Estructuras cuyo ``reemplazar`` va a ``variant_overrides``: su receta de
#: colores (``materiales``) no cambia.
TIPOS_GEOMETRICOS = frozenset({"arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"})
#: Participación del color que se agrega cuando la edición no trae una.
PARTICIPACION_AGREGAR = 0.2
_PARTICIPACION_MINIMA = 0.000001
_SEIS_DECIMALES = Decimal("0.000001")
_MAX_ACENTOS = 4
_MAX_PESOS = 6
_MAX_AVISO = 400

AVISO_PATRON_QUITAR = "El patrón se rehízo porque quitaste un color."
AVISO_PATRON_AGREGAR = "El patrón se rehízo para incluir el color nuevo."
AVISO_PATRON_UN_COLOR = "Se quitó el patrón de color porque la pieza quedó con un solo color."
AVISO_PATRON_SIN_PRESET = "Se quitó el patrón de color: con estos colores la pieza no admite uno."
AVISO_PATRON_SUGERIDO = (
    "La pieza ahora lleva un patrón de color sugerido; puedes cambiarlo con «Editar patrón»."
)

# `String.prototype.trim` de JavaScript: espacios de Unicode (Zs), tabuladores,
# fines de línea y BOM. `str.strip()` sin argumentos no es lo mismo (quita
# \x1c-\x1f y \x85, y no el BOM).
_ESPACIOS_JS = "\t\n\v\f\r                  　﻿"

# La vista previa devuelve lo mismo que `plan_resuelto.patrones_color[]`.
_PATRON_RESUELTO = Draft7Validator(
    contract_schema("PlanResuelto")["properties"]["patrones_color"]["items"]
)


# --- Contrato local (ADR-0026 §3) --------------------------------------------------


class _Estricto(ContractModel):
    model_config = ConfigDict(extra="forbid", strict=True)


Identificador = Annotated[str, Field(min_length=1, max_length=160)]


class LineaBase(_Estricto):
    """Línea resuelta del plan base: lo que el cliente ve y puede quitar o reemplazar."""

    product_id: Identificador
    variant_id: Identificador
    color: str | None = Field(max_length=160)


class LineasBaseEstructura(_Estricto):
    estructura_id: Identificador
    lineas: list[LineaBase] = Field(max_length=256)


class VarianteEdicion(_Estricto):
    product_id: Identificador
    variant_id: Identificador
    color: str | None = Field(default=None, min_length=1, max_length=80)
    acabado: str | None = Field(default=None, min_length=1, max_length=80)


class EdicionMaterial(_Estricto):
    """``agregar``, ``reemplazar`` o ``quitar`` una pieza (``EdicionSchema`` en Next)."""

    accion: Literal["agregar", "reemplazar", "quitar"]
    estructura_id: Identificador
    objetivo_variant_id: Identificador | None = None
    variante: VarianteEdicion | None = None
    participacion: float | None = Field(default=None, gt=0.01, lt=0.8)

    @model_validator(mode="after")
    def exigir_campos(self) -> "EdicionMaterial":
        if self.accion != "agregar" and self.objetivo_variant_id is None:
            raise ValueError("la operación necesita objetivo_variant_id")
        if self.accion != "quitar" and self.variante is None:
            raise ValueError("la operación necesita una variante")
        return self


class EdicionReparto(_Estricto):
    """Nueva ``participacion`` de cada material, en el orden de ``materiales``."""

    accion: Literal["repartir"]
    estructura_id: Identificador
    participaciones: list[float] = Field(min_length=2, max_length=6)

    @field_validator("participaciones")
    @classmethod
    def validar_participaciones(cls, valores: list[float]) -> list[float]:
        if any(not 0.05 <= valor < 1 for valor in valores):
            raise ValueError("cada participación va de 0.05 a menos de 1")
        return valores


class EdicionMezcla(_Estricto):
    accion: Literal["mezcla"]
    estructura_id: Identificador
    mezcla: Literal["clasica", "organica_fina", "organica_gruesa", "solo_grandes"]


class EdicionPatron(_Estricto):
    """Fija (o, con ``None``, quita) el patrón de color de una estructura."""

    accion: Literal["patron"]
    estructura_id: Identificador
    patron_color: dict[str, object] | None


Edicion = Annotated[
    EdicionMaterial | EdicionReparto | EdicionMezcla | EdicionPatron,
    Field(discriminator="accion"),
]


class PlanEditRequest(OperationalRequest):
    """``plan-edit.v1``: una edición sobre el plan declarativo aprobado.

    ``lineas_base`` son las líneas resueltas (verificadas por Next) de la
    estructura editada; ``colores_variante``, los colores reales de la variante
    admitida al agregar o reemplazar. ``completar_patrones`` sigue la bandera
    ``PATRONES_COLOR_V1``: solo con ella una pieza que pasa de un color a dos
    recibe su preset, como al confirmar el plan.
    """

    schema_version: Literal["plan-edit.v1"]
    plan: dict[str, object]
    lineas_base: list[LineasBaseEstructura] = Field(max_length=8)
    edicion: Edicion
    colores_variante: list[Annotated[str, Field(max_length=160)]] = Field(max_length=24)
    completar_patrones: bool = Field(default=False, strict=True)


class PlanPatronRequest(OperationalRequest):
    """``plan-patron.v1``: expandir un patrón (o, con ``None``, sugerir uno).

    Con ``participaciones`` (y ``patron_color`` nulo) es la vista previa del
    deslizador de colores sobre un confeti: el mismo ``repartir`` que aplicará
    la edición, sin guardarlo, para dibujar la pieza mientras se arrastra.
    """

    schema_version: Literal["plan-patron.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    patron_color: dict[str, object] | None
    participaciones: list[float] | None = Field(default=None, min_length=2, max_length=6)

    @field_validator("participaciones")
    @classmethod
    def validar_participaciones(cls, valores: list[float] | None) -> list[float] | None:
        if valores is not None and any(not 0.05 <= valor < 1 for valor in valores):
            raise ValueError("cada participación va de 0.05 a menos de 1")
        return valores

    @model_validator(mode="after")
    def reparto_sin_patron(self) -> "PlanPatronRequest":
        if self.participaciones is not None and self.patron_color is not None:
            raise ValueError("participaciones y patron_color no van juntos")
        return self


@dataclass(frozen=True, slots=True)
class PlanEditado:
    plan: dict[str, object]
    avisos: tuple[str, ...]


# --- Utilidades (mismas reglas que el TypeScript que reemplazan) ------------------


def _validar_plan(plan: Mapping[str, object]) -> None:
    try:
        PlanDecoracion.model_validate(plan)
    except ValidationError as error:
        raise PlanResolutionError("invalid_plan", 422) from error


def _recortar(valor: str) -> str:
    return valor.strip(_ESPACIOS_JS)


def _normalizar(valor: str) -> str:
    """Sin tildes (solo U+0300–U+036F tras NFD), recortado y en minúsculas."""
    descompuesto = unicodedata.normalize("NFD", valor)
    return _recortar("".join(c for c in descompuesto if not "̀" <= c <= "ͯ")).lower()


def _a_seis_decimales(valor: float) -> float:
    """``Number(valor.toFixed(6))``: el binario exacto, mitades lejos de cero."""
    return float(Decimal(valor).quantize(_SEIS_DECIMALES, rounding=ROUND_HALF_UP))


def _redondear(valor: float) -> int:
    return int(Decimal(str(valor)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _peso(participacion: float) -> int:
    """Peso de confeti de una participación: ``max(1, round_half_up(p * 100))`` (§6, §9)."""
    return max(1, _redondear(participacion * 100))


def _peso_exacto(valor: Fraction) -> int:
    """Peso de confeti de un valor exacto: mitades hacia arriba, nunca menos de 1."""
    return max(1, math.floor(valor + Fraction(1, 2)))


def _participacion(material: Mapping[str, object]) -> float:
    return float(cast(float, material["participacion"]))


def _sin_nulos(valores: Mapping[str, object]) -> dict[str, object]:
    """Un campo opcional ausente no viaja (en TypeScript era ``undefined``)."""
    return {clave: valor for clave, valor in valores.items() if valor is not None}


def _materiales(estructura: Mapping[str, object]) -> list[dict[str, object]]:
    materiales = cast(list[Mapping[str, object]], estructura["materiales"])
    return [dict(material) for material in materiales]


def normalizar_participaciones(
    materiales: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Participaciones que suman 1, redondeadas a seis decimales.

    Cada material toma ``p / total`` redondeado; el último, lo que falta hasta
    1 (nunca menos de 0.000001). Las sumas van en orden, como el ``reduce``
    que reemplaza (``sum`` de Python 3.12 compensa el redondeo y daría otro
    resultado en el último decimal).
    """
    total = 0.0
    for material in materiales:
        total += _participacion(material)
    if total <= 0:
        raise PlanResolutionError("sin_participacion", 400)
    acumulado = 0.0
    ultimo = len(materiales) - 1
    resultado: list[dict[str, object]] = []
    for indice, material in enumerate(materiales):
        if indice == ultimo:
            participacion = max(_PARTICIPACION_MINIMA, _a_seis_decimales(1 - acumulado))
        else:
            participacion = _a_seis_decimales(_participacion(material) / total)
        acumulado += participacion
        resultado.append({**material, "participacion": participacion})
    return resultado


def indice_material_para_linea(materiales: Sequence[Mapping[str, object]], linea: LineaBase) -> int:
    """Material que produjo una línea: por variante exacta; si no, por producto y color."""
    for indice, material in enumerate(materiales):
        mismo_producto = material.get("product_id") == linea.product_id
        if mismo_producto and material.get("variant_id") == linea.variant_id:
            return indice
    color = _normalizar(linea.color or "")
    for indice, material in enumerate(materiales):
        propio = material.get("color")
        if (
            material.get("product_id") == linea.product_id
            and _normalizar("" if propio is None else str(propio)) == color
        ):
            return indice
    return -1


def color_de_edicion(color: str | None, colores_variante: Sequence[str]) -> str | None:
    """Color que la edición escribe para la variante elegida (agregar y reemplazar).

    Dice lo que de verdad se compra: con una variante de un solo color gana ese
    color salvo que el pedido sea el mismo; con varios, el pedido. Nunca el
    color de la pieza reemplazada. Sin canonizar: Next canoniza al resolver.
    """
    pedido = _recortar(color) if color is not None and _recortar(color) else None
    if len(colores_variante) != 1:
        return pedido
    unico = colores_variante[0]
    return pedido if pedido and _normalizar(pedido) == _normalizar(unico) else unico


# --- Edición de materiales (port de aplicarEdicion) --------------------------------


def _variante(edicion: EdicionMaterial) -> VarianteEdicion:
    if edicion.variante is None:  # el modelo ya lo exige; esto solo estrecha el tipo
        raise PlanResolutionError("invalid_plan", 422)
    return edicion.variante


def _linea_objetivo(
    lineas_base: Sequence[LineasBaseEstructura], estructura_id: str, variant_id: str | None
) -> LineaBase:
    estructura = next((item for item in lineas_base if item.estructura_id == estructura_id), None)
    linea = (
        next((item for item in estructura.lineas if item.variant_id == variant_id), None)
        if estructura is not None
        else None
    )
    if linea is None:
        raise PlanResolutionError("variante_objetivo_no_encontrada", 404)
    return linea


def _encadenar_override(
    estructura: Mapping[str, object],
    objetivo_variant_id: str,
    variante: VarianteEdicion,
    color: str | None,
) -> list[dict[str, object]]:
    """``variant_overrides`` con el reemplazo, encadenado a uno anterior de la misma pieza.

    Si la línea que se reemplaza ya venía de un override, el nuevo apunta a la
    variante original y el anterior desaparece: la cadena nunca crece.
    """
    previos = cast(list[Mapping[str, object]], estructura.get("variant_overrides") or [])
    overrides = [
        dict(override)
        for override in previos
        if override.get("objetivo_variant_id") != objetivo_variant_id
    ]
    anterior = next(
        (
            indice
            for indice, override in enumerate(overrides)
            if override.get("variant_id") == objetivo_variant_id
        ),
        None,
    )
    objetivo = objetivo_variant_id
    if anterior is not None:
        objetivo = str(overrides[anterior]["objetivo_variant_id"])
        del overrides[anterior]
    nuevo = _sin_nulos(
        {
            "objetivo_variant_id": objetivo,
            "product_id": variante.product_id,
            "variant_id": variante.variant_id,
            "color": color,
        }
    )
    return [*overrides, nuevo]


def _parte_agregada(edicion: EdicionMaterial) -> float:
    """Participación pedida para el color que se agrega (0.2 si no trae una)."""
    return edicion.participacion if edicion.participacion is not None else PARTICIPACION_AGREGAR


def _agregar_material(
    estructura: dict[str, object], edicion: EdicionMaterial, color: str | None
) -> None:
    variante = _variante(edicion)
    participacion = _parte_agregada(edicion)
    restante = 1 - participacion
    existentes = [
        {**material, "participacion": _participacion(material) * restante}
        for material in normalizar_participaciones(_materiales(estructura))
    ]
    nuevo = _sin_nulos(
        {
            "product_id": variante.product_id,
            "variant_id": variante.variant_id,
            "color": color,
            "acabado": variante.acabado,
            "participacion": participacion,
            "rol_material": "acento",
        }
    )
    estructura["materiales"] = normalizar_participaciones([*existentes, nuevo])


def _editar_materiales(
    estructura: dict[str, object],
    edicion: EdicionMaterial,
    lineas_base: Sequence[LineasBaseEstructura],
    colores_variante: Sequence[str],
) -> None:
    color = (
        None
        if edicion.accion == "quitar"
        else color_de_edicion(_variante(edicion).color, colores_variante)
    )
    if edicion.accion == "agregar":
        _agregar_material(estructura, edicion, color)
        return
    linea = _linea_objetivo(lineas_base, edicion.estructura_id, edicion.objetivo_variant_id)
    if edicion.accion == "reemplazar" and estructura.get("tipo") in TIPOS_GEOMETRICOS:
        # Una pieza geométrica no cambia su receta de colores: el reemplazo vive
        # en variant_overrides. Por eso no se busca el material de la línea: una
        # pieza ya editada puede tener un color que no está en `materiales`.
        estructura["variant_overrides"] = _encadenar_override(
            estructura, linea.variant_id, _variante(edicion), color
        )
        return
    materiales = _materiales(estructura)
    indice = indice_material_para_linea(materiales, linea)
    if indice < 0:
        raise PlanResolutionError("material_no_editable", 409)
    if edicion.accion == "quitar":
        if len(materiales) == 1:
            raise PlanResolutionError("unico_material", 400)
        del materiales[indice]
        estructura["materiales"] = normalizar_participaciones(materiales)
        return
    variante = _variante(edicion)
    anterior = materiales[indice]
    materiales[indice] = _sin_nulos(
        {
            **anterior,
            "product_id": variante.product_id,
            "variant_id": variante.variant_id,
            "color": color if color is not None else anterior.get("color"),
            "acabado": (
                variante.acabado if variante.acabado is not None else anterior.get("acabado")
            ),
        }
    )
    estructura["materiales"] = materiales


_AVISO_CAPAS_CONFETI = (
    "Los acentos y los globos pintados a mano se integraron al confeti para respetar"
    " el reparto que elegiste."
)


def _repartir(estructura: dict[str, object], participaciones: Sequence[float]) -> list[str]:
    """Solo cambian las participaciones; con confeti, también sus pesos (conserva la semilla).

    Los pesos de un confeti son su reparto solo cuando la base llena toda la
    rejilla: con ``acentos`` o ``pintados`` encima, esas celdas ya tienen color
    y el reparto pedido no saldría (un acento fija un mínimo de su color y el
    deslizador movería la rejilla al revés de lo pedido). El deslizador es la
    forma de decir "así se reparte este confeti", así que las capas se integran
    al confeti (se quitan) y se avisa. Con otro modo el reparto se cambia en el
    editor de patrón: ``patron_activo``.
    """
    patron = cast(dict[str, object] | None, estructura.get("patron_color"))
    base = cast(dict[str, object], patron["base"]) if patron is not None else None
    if patron is not None and base is not None and base.get("modo") != "aleatorio":
        raise PlanResolutionError("patron_activo", 409)
    materiales = _materiales(estructura)
    if len(materiales) != len(participaciones):
        raise PlanResolutionError("reparto_no_corresponde", 409)
    normalizados = normalizar_participaciones(
        [
            {**material, "participacion": parte}
            for material, parte in zip(materiales, participaciones, strict=True)
        ]
    )
    estructura["materiales"] = normalizados
    if patron is None or base is None:
        return []
    pesos = [
        {"material": indice, "peso": _peso(_participacion(material))}
        for indice, material in enumerate(normalizados)
    ]
    capas = bool(patron.get("acentos") or patron.get("pintados"))
    sin_capas = {
        clave: valor for clave, valor in patron.items() if clave not in ("acentos", "pintados")
    }
    estructura["patron_color"] = {**sin_capas, "base": {**base, "pesos": pesos}}
    return [_AVISO_CAPAS_CONFETI] if capas else []


# --- Patrón tras cambiar los colores (§9) ------------------------------------------


def _estructura(plan: Mapping[str, object], indice: int) -> dict[str, object]:
    return cast(list[dict[str, object]], plan["estructuras"])[indice]


def _rehacer_patron(plan: dict[str, object], indice: int, aviso: str) -> list[str]:
    """Preset nuevo con los colores que tiene ahora la pieza; sin preset posible, sin patrón."""
    estructura = _estructura(plan, indice)
    estructura.pop("patron_color", None)
    preset = sugerir_patron_para_estructura(plan, str(estructura["estructura_id"]))
    if preset is None:
        return [AVISO_PATRON_SIN_PRESET]
    estructura["patron_color"] = preset
    return [aviso]


def _pesos_con_color_nuevo(
    pesos: Sequence[Mapping[str, object]], nuevo: int, parte: float
) -> list[dict[str, object]]:
    """Pesos del confeti con el color nuevo, en tanto por ciento de la base (§9).

    El color nuevo toma ``parte`` de la base y los pesos que ya estaban
    conservan su proporción entre sí, escalados a ``(1 - parte) * 100``. Salen
    de los pesos, nunca de ``participacion``: esta ya cuenta las celdas de los
    acentos y los pintados, que siguen encima de la base sin cambiar, y
    volver a aplicarlos sobre ella contaría dos veces su color.
    """
    total = sum(cast(int, peso["peso"]) for peso in pesos)
    resto = (1 - Fraction(str(parte))) * 100
    escalados = [
        {
            "material": peso["material"],
            "peso": _peso_exacto(Fraction(cast(int, peso["peso"]), total) * resto),
        }
        for peso in pesos
    ]
    return [*escalados, {"material": nuevo, "peso": _peso(parte)}]


def _patron_con_color_nuevo(
    estructura: Mapping[str, object], patron: Mapping[str, object], parte: float
) -> dict[str, object] | None:
    """El patrón con el último material como peso de confeti o como acento; ``None`` sin cupo."""
    nuevo = len(_materiales(estructura)) - 1
    base = cast(dict[str, object], patron["base"])
    if base.get("modo") == "aleatorio":
        pesos = cast(list[Mapping[str, object]], base["pesos"])
        if len(pesos) >= _MAX_PESOS:
            return None
        return {**patron, "base": {**base, "pesos": _pesos_con_color_nuevo(pesos, nuevo, parte)}}
    acentos = list(cast(list[object], patron.get("acentos") or []))
    if len(acentos) >= _MAX_ACENTOS:
        return None
    acento: dict[str, object] = (
        {"material": nuevo, "cada": 3, "desde": 2}
        if estructura.get("tipo") == TIPO_REJILLA
        else {"material": nuevo, "cada": 2, "desde": 2, "posiciones": [0]}
    )
    return {**patron, "acentos": [*acentos, acento]}


def _agregar_al_patron(plan: dict[str, object], indice: int, parte: float) -> list[str]:
    estructura = _estructura(plan, indice)
    patron = _patron_con_color_nuevo(
        estructura, cast(Mapping[str, object], estructura["patron_color"]), parte
    )
    if patron is None:
        return _rehacer_patron(plan, indice, AVISO_PATRON_AGREGAR)
    estructura["patron_color"] = patron
    try:
        # Valida el patrón con la geometría de la pieza (reglas del §4).
        sincronizar_participaciones(plan)
    except PlanResolutionError as error:
        propio = (error.details or {}).get("estructura_id") == estructura["estructura_id"]
        if error.code != "patron_invalido" or not propio:
            raise
        # El acento dejó un color sin globos (o no cabe en la rejilla): preset.
        return _rehacer_patron(plan, indice, AVISO_PATRON_AGREGAR)
    return []


def _ajustar_patron(
    plan: dict[str, object],
    indice: int,
    edicion: EdicionMaterial,
    materiales_antes: int,
    completar_patrones: bool,
) -> list[str]:
    """Reglas del §9 para ``agregar`` y ``quitar``; devuelve los avisos para el decorador."""
    estructura = _estructura(plan, indice)
    if edicion.accion == "reemplazar":
        return []
    tiene_patron = estructura.get("patron_color") is not None
    if edicion.accion == "quitar":
        if not tiene_patron:
            return []
        if len(_materiales(estructura)) < 2:
            estructura.pop("patron_color", None)
            return [AVISO_PATRON_UN_COLOR]
        return _rehacer_patron(plan, indice, AVISO_PATRON_QUITAR)
    if tiene_patron:
        return _agregar_al_patron(plan, indice, _parte_agregada(edicion))
    if completar_patrones and materiales_antes == 1 and estructura.get("tipo") in TIPOS_GEOMETRICOS:
        preset = sugerir_patron_para_estructura(plan, str(estructura["estructura_id"]))
        if preset is not None:
            estructura["patron_color"] = preset
            return [AVISO_PATRON_SUGERIDO]
    return []


# --- Casos de uso ------------------------------------------------------------------


def editar_plan(
    plan: Mapping[str, object],
    edicion: EdicionMaterial | EdicionReparto | EdicionMezcla | EdicionPatron,
    lineas_base: Sequence[LineasBaseEstructura] = (),
    colores_variante: Sequence[str] = (),
    *,
    completar_patrones: bool = False,
) -> PlanEditado:
    """Aplica una edición al plan declarativo y devuelve el plan editado, ya validado.

    Si la estructura editada termina con patrón, ``participacion`` se reescribe
    desde su rejilla (``sincronizar_participaciones``): el plan editado ya dice
    lo que la resolución va a contar.
    """
    _validar_plan(plan)
    editado = copy.deepcopy(dict(plan))
    estructuras = cast(list[dict[str, object]], editado["estructuras"])
    indice = next(
        (
            posicion
            for posicion, item in enumerate(estructuras)
            if item.get("estructura_id") == edicion.estructura_id
        ),
        None,
    )
    if indice is None:
        raise PlanResolutionError("estructura_no_encontrada", 404)
    estructura = estructuras[indice]
    avisos: list[str] = []
    if isinstance(edicion, EdicionPatron):
        if edicion.patron_color is None:
            estructura.pop("patron_color", None)
        else:
            estructura["patron_color"] = copy.deepcopy(edicion.patron_color)
    elif isinstance(edicion, EdicionReparto):
        avisos = _repartir(estructura, edicion.participaciones)
    elif isinstance(edicion, EdicionMezcla):
        estructura["mezcla"] = edicion.mezcla
    else:
        materiales_antes = len(_materiales(estructura))
        _editar_materiales(estructura, edicion, lineas_base, colores_variante)
        avisos = _ajustar_patron(editado, indice, edicion, materiales_antes, completar_patrones)
    if _estructura(editado, indice).get("patron_color") is not None:
        # Valida el patrón (forma y reglas del §4) y reescribe participacion.
        editado = sincronizar_participaciones(editado)
    _validar_plan(editado)
    return PlanEditado(plan=editado, avisos=tuple(aviso[:_MAX_AVISO] for aviso in avisos))


def ejecutar_edicion(request: PlanEditRequest) -> dict[str, object]:
    """``plan-edit-result.v1`` de una petición ya admitida en la frontera."""
    resultado = editar_plan(
        request.plan,
        request.edicion,
        request.lineas_base,
        request.colores_variante,
        completar_patrones=request.completar_patrones,
    )
    return {
        "operation_schema_version": PLAN_EDIT_RESULT_VERSION,
        "plan": resultado.plan,
        "avisos": list(resultado.avisos),
    }


def _vista_previa_reparto(
    plan: Mapping[str, object], estructura_id: str, participaciones: Sequence[float]
) -> dict[str, object]:
    """El confeti de la estructura tras ``repartir``, sin guardar nada.

    Es la misma edición que aplicará ``/plan/edit``; una estructura sin patrón
    no tiene nada que dibujar (``sin_patron``) y otro modo es ``patron_activo``.
    """
    estructura = next(
        (
            item
            for item in cast(list[Mapping[str, object]], plan.get("estructuras", []))
            if isinstance(item, Mapping) and item.get("estructura_id") == estructura_id
        ),
        None,
    )
    if estructura is not None and estructura.get("patron_color") is None:
        raise PlanResolutionError("sin_patron", 409)
    editado = editar_plan(
        plan,
        EdicionReparto(
            accion="repartir", estructura_id=estructura_id, participaciones=list(participaciones)
        ),
    )
    nuevo = next(
        item
        for item in cast(list[dict[str, object]], editado.plan["estructuras"])
        if item.get("estructura_id") == estructura_id
    )
    patron: dict[str, object] = patron_resuelto_de_estructura(
        editado.plan, estructura_id, cast(dict[str, object], nuevo["patron_color"])
    )
    if editado.avisos:
        patron["avisos"] = [*editado.avisos, *cast(list[str], patron["avisos"])]
    return patron


def vista_previa_patron(request: PlanPatronRequest) -> dict[str, object]:
    """``plan-patron-result.v1``: el patrón dado expandido, o la sugerencia con ``None``.

    Sin catálogo; la rejilla y el conteo son los que dará la próxima resolución.
    """
    if request.participaciones is not None:
        patron = _vista_previa_reparto(request.plan, request.estructura_id, request.participaciones)
    else:
        patron = patron_resuelto_de_estructura(
            request.plan, request.estructura_id, request.patron_color
        )
    if next(_PATRON_RESUELTO.iter_errors(patron), None) is not None:
        raise RuntimeError("el patrón resuelto no cumple plan-resuelto.v1")
    return {"operation_schema_version": PLAN_PATRON_RESULT_VERSION, "patron": patron}


__all__ = [
    "EdicionMaterial",
    "EdicionMezcla",
    "EdicionPatron",
    "EdicionReparto",
    "LineaBase",
    "LineasBaseEstructura",
    "PARTICIPACION_AGREGAR",
    "PLAN_EDIT_SCOPE",
    "PLAN_PATRON_SCOPE",
    "PlanEditRequest",
    "PlanEditado",
    "PlanPatronRequest",
    "TIPOS_GEOMETRICOS",
    "VarianteEdicion",
    "color_de_edicion",
    "editar_plan",
    "ejecutar_edicion",
    "indice_material_para_linea",
    "normalizar_participaciones",
    "vista_previa_patron",
]
