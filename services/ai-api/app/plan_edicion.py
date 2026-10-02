"""Edición de un plan aprobado y vista previa de su patrón de color (ADR-0028 §9, §10).

Dueño único de la mutación declarativa de un plan: ``agregar``, ``reemplazar``,
``quitar``, ``repartir``, ``mezcla``, ``patron``, ``armado`` (bouquet, ADR-0030)
``armado_guirnalda`` (ADR-0032) y ``armado_arco`` (ADR-0035). Las cinco primeras son el
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
| ``sin_patron`` (solo la vista previa del deslizador) | 409 |
| ``unico_material`` | 400 |
| ``sin_participacion`` | 400 |
| ``patron_invalido`` (``estructura_id``, ``motivo``, ``mensaje``; en la vista previa, además ``modos_admitidos``) | 422 |
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

from app.armado_arco import ArmadoInvalido as ArmadoArcoInvalido
from app.armado_arco import EstructuraArco, armado_resuelto, avisos_colores_sin_uso
from app.armado_arco import validar as validar_armado_arco
from app.generated_models import PlanDecoracion, contract_schema
from app.plan_edicion_columna import (
    fijar_armado_columna,
    revisar_armado_columna,
    sin_armado_columna,
)
from app.plan_edicion_columna_organica import (
    fijar_armado_columna_organica,
    revisar_armado_columna_organica,
    sin_armado_columna_organica,
)
from app.plan_edicion_guirnalda_organica import (
    fijar_armado_guirnalda_organica,
    revisar_armado_guirnalda_organica,
    sin_armado_guirnalda_organica,
)
from app.operational_models import ContractModel, OperationalRequest
from app.patron_color import TIPO_REJILLA, forma_valida, para_validar
from app.patron_color import AVISO_ESPEJO_GUIRNALDA as AVISO_ESPEJO_GUIRNALDA
from app.patron_color import quitar_espejo_sin_u
from app.armado_bouquet import DISPOSICIONES, VARIANTES
from app.plan import (
    ComprasPorMaterial,
    PlanResolutionError,
    VistaPreviaPatron,
    compras_de_estructura,
    modos_admitidos_de_estructura,
    opciones_de_armado,
    sincronizar_participaciones,
    sugerir_patron_para_estructura,
    validar_armado_guirnalda_sin_catalogo,
    validar_armado_sin_catalogo,
    vista_previa_de_armado,
    vista_previa_de_armado_guirnalda,
    vista_previa_de_estructura,
)
from app.plan_armado_comun import TONO_NEUTRO

PLAN_EDIT_SCOPE = "plan.edit"
PLAN_EDIT_REQUEST_VERSION = "plan-edit.v1"
PLAN_EDIT_RESULT_VERSION = "plan-edit-result.v1"
PLAN_PATRON_SCOPE = "plan.patron"
PLAN_PATRON_REQUEST_VERSION = "plan-patron.v1"
PLAN_PATRON_RESULT_VERSION = "plan-patron-result.v1"
PLAN_ARMADO_SCOPE = "plan.armado_bouquet"
PLAN_ARMADO_REQUEST_VERSION = "plan-armado-bouquet.v1"
PLAN_ARMADO_RESULT_VERSION = "plan-armado-bouquet-result.v1"
PLAN_ARMADO_GUIRNALDA_SCOPE = "plan.armado_guirnalda"
PLAN_ARMADO_GUIRNALDA_REQUEST_VERSION = "plan-armado-guirnalda.v1"
PLAN_ARMADO_GUIRNALDA_RESULT_VERSION = "plan-armado-guirnalda-result.v1"
#: Materiales por estructura en Plan 1.1.
MAX_GLOBOS_PIEZA = 12

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
#: Líneas resueltas de una pieza, como ``LineasBaseEstructura``.
MAX_LINEAS_PIEZA = 256
#: El deslizador de colores es una decisión del decorador (§9).
ORIGEN_DECORADOR = "decorador"

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
# Y la del armado, lo mismo que `plan_resuelto.armados_bouquet[]`.
_ARMADO_RESUELTO = Draft7Validator(
    contract_schema("PlanResuelto")["properties"]["armados_bouquet"]["items"]
)
_ARMADO_FORMA = Draft7Validator(
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_bouquet"
    ]
)
AVISO_ARMADO_QUITADO = "El armado del bouquet se quitó porque cambiaste sus globos."
AVISO_ARMADO_REHACER = "El armado del bouquet se vuelve a sugerir con los globos nuevos."
# Guirnaldas (ADR-0032): lo mismo que `plan_resuelto.armados_guirnalda[]` y su forma.
_ARMADO_GUIRNALDA_RESUELTO = Draft7Validator(
    contract_schema("PlanResuelto")["properties"]["armados_guirnalda"]["items"]
)
_ARMADO_GUIRNALDA_FORMA = Draft7Validator(
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_guirnalda"
    ]
)
AVISO_ARMADO_GUIRNALDA_QUITADO = (
    "El armado de la guirnalda se quitó porque ya no cabe en sus globos."
)
AVISO_ARMADO_GUIRNALDA_COLOR = "El armado de la guirnalda se quitó porque quitaste un color."
AVISO_ARMADO_GUIRNALDA_REHACER = (
    "El armado de la guirnalda se vuelve a sugerir con los globos nuevos."
)
AVISO_ARMADO_ARCO_COLORES = (
    "Quitaste un color: el armado del arco se ajustó a los colores que quedan. "
    "Revisa el patrón con «Editar arco»."
)
AVISO_ARMADO_ARCO_SOLIDO = (
    "Quitaste un color y el patrón del arco ya no cabe con los que quedan: el arco pasó a sólido. "
    "Elige otro patrón con «Editar arco»."
)
AVISO_ARMADO_ARCO_COLOR_NUEVO = (
    "Agregaste un color: el arco no lo usa todavía. Elige un patrón que lo tome con «Editar arco»."
)
# Arcos (ADR-0035): la forma de `armado_arco` la valida el contrato exportado, como en `app/armado_arco.py`.
_ARMADO_ARCO_FORMA = Draft7Validator(
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_arco"
    ]
)
# Columnas (ADR-0035, paso 3): la forma de `armado_columna` la valida el contrato exportado, igual que la del arco.
_ARMADO_COLUMNA_FORMA = Draft7Validator(
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_columna"
    ]
)
# Columnas orgánicas (ADR-0035, paso 3): la forma de `armado_columna_organica` la valida el contrato exportado.
_ARMADO_COLUMNA_ORGANICA_FORMA = Draft7Validator(
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_columna_organica"
    ]
)
# Guirnaldas del motor (ADR-0035, paso 3): la forma de `armado_guirnalda_organica` la valida el contrato exportado.
_ARMADO_GUIRNALDA_ORGANICA_FORMA = Draft7Validator(
    contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"]["properties"][
        "armado_guirnalda_organica"
    ]
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
    lineas: list[LineaBase] = Field(max_length=MAX_LINEAS_PIEZA)


class LineaComprada(_Estricto):
    """Línea resuelta de la pieza tal como la tiene el navegador (vista previa, §10).

    Es la de ``plan_resuelto.estructuras[].lineas``, reducida a lo que dice qué
    se compra. Solo nombra: con ella Python lee qué color compra cada material
    tras un reemplazo (``compras_de_estructura``); nunca cuenta ni cobra.
    """

    product_id: Identificador
    variant_id: Identificador
    color: str | None = Field(max_length=160)
    acabado: str | None = Field(default=None, max_length=160)
    unidades: int = Field(ge=1, le=1_000_000)
    diam_pulg: float | None = Field(default=None, ge=0, le=100)


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


class EdicionArmado(_Estricto):
    """Fija (o, con ``None``, quita) el armado por niveles de un bouquet (ADR-0030)."""

    accion: Literal["armado"]
    estructura_id: Identificador
    armado_bouquet: dict[str, object] | None

    @field_validator("armado_bouquet")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_ARMADO_FORMA.iter_errors(valor), None) is not None:
            raise ValueError("armado_bouquet no cumple armado-bouquet.v1")
        return valor


class EdicionArmadoGuirnalda(_Estricto):
    """Fija (o, con ``None``, quita) el armado por partes de una guirnalda (ADR-0032)."""

    accion: Literal["armado_guirnalda"]
    estructura_id: Identificador
    armado_guirnalda: dict[str, object] | None

    @field_validator("armado_guirnalda")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_ARMADO_GUIRNALDA_FORMA.iter_errors(valor), None) is not None:
            raise ValueError("armado_guirnalda no cumple armado-guirnalda.v1")
        return valor


class EdicionArmadoArco(_Estricto):
    """Fija (o, con ``None``, quita) el armado de un arco (ADR-0035, paso 1)."""

    accion: Literal["armado_arco"]
    estructura_id: Identificador
    armado_arco: dict[str, object] | None

    @field_validator("armado_arco")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_ARMADO_ARCO_FORMA.iter_errors(valor), None) is not None:
            raise ValueError("armado_arco no cumple armado-arco.v1")
        return valor


class EdicionArmadoColumna(_Estricto):
    """Fija (o, con ``None``, quita) el armado de una columna (ADR-0035, paso 3)."""

    accion: Literal["armado_columna"]
    estructura_id: Identificador
    armado_columna: dict[str, object] | None

    @field_validator("armado_columna")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_ARMADO_COLUMNA_FORMA.iter_errors(valor), None) is not None:
            raise ValueError("armado_columna no cumple armado-columna.v1")
        return valor


class EdicionArmadoColumnaOrganica(_Estricto):
    """Fija (o, con ``None``, quita) el armado de la columna orgánica del motor (ADR-0035, paso 3)."""

    accion: Literal["armado_columna_organica"]
    estructura_id: Identificador
    armado_columna_organica: dict[str, object] | None

    @field_validator("armado_columna_organica")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if (
            valor is not None
            and next(_ARMADO_COLUMNA_ORGANICA_FORMA.iter_errors(valor), None) is not None
        ):
            raise ValueError("armado_columna_organica no cumple armado-columna-organica.v1")
        return valor


class EdicionArmadoGuirnaldaOrganica(_Estricto):
    """Fija (o, con ``None``, quita) el armado de la guirnalda del motor (ADR-0035, paso 3)."""

    accion: Literal["armado_guirnalda_organica"]
    estructura_id: Identificador
    armado_guirnalda_organica: dict[str, object] | None

    @field_validator("armado_guirnalda_organica")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if (
            valor is not None
            and next(_ARMADO_GUIRNALDA_ORGANICA_FORMA.iter_errors(valor), None) is not None
        ):
            raise ValueError("armado_guirnalda_organica no cumple armado-guirnalda-organica.v1")
        return valor


EdicionPlan = (
    EdicionMaterial
    | EdicionReparto
    | EdicionMezcla
    | EdicionPatron
    | EdicionArmado
    | EdicionArmadoGuirnalda
    | EdicionArmadoArco
    | EdicionArmadoColumna
    | EdicionArmadoColumnaOrganica
    | EdicionArmadoGuirnaldaOrganica
)
Edicion = Annotated[EdicionPlan, Field(discriminator="accion")]


class GloboNavegador(_Estricto):
    """Lo que el navegador sabe de un globo de la pieza (``plan_resuelto.estructuras[].lineas``).

    Solo clasifica (látex, metalizado, burbuja o número, y su tamaño), como el
    catálogo al resolver; nunca cuenta ni cobra: las cantidades son del plan.
    """

    product_id: Identificador
    variant_id: Identificador
    titulo: str = Field(max_length=400)
    forma: str | None = Field(default=None, max_length=40)
    diam_pulg: float | None = Field(default=None, ge=0, le=100)
    tamano_codigo: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=160)
    acabado: str | None = Field(default=None, max_length=160)


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
    #: ``BOUQUETS_ARMADO_V1``: Next volverá a sugerir el armado que la edición quita.
    completar_armados: bool = Field(default=False, strict=True)
    #: ``GUIRNALDAS_ARMADO_V1``: lo mismo para el armado de una guirnalda (ADR-0032).
    completar_armados_guirnalda: bool = Field(default=False, strict=True)


class PlanPatronRequest(OperationalRequest):
    """``plan-patron.v1``: expandir un patrón (o, con ``None``, sugerir uno).

    Con ``participaciones`` (y ``patron_color`` nulo) es la vista previa del
    deslizador de colores sobre un confeti: el mismo ``repartir`` que aplicará
    la edición, sin guardarlo, para dibujar la pieza mientras se arrastra.
    Con ``modo`` es el punto de partida de ese estilo; ``desde`` (solo con
    ``modo``) es el borrador del editor, del que Python conserva lo que el
    estilo nuevo admite (``sugerir_patron_modo``). ``lineas`` (con cualquiera
    de ellas) son las líneas resueltas de la pieza que tiene el navegador: la
    vista previa nombra con ellas cada color por lo que se compra, como la
    resolución (§8).
    """

    schema_version: Literal["plan-patron.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    patron_color: dict[str, object] | None
    participaciones: list[float] | None = Field(default=None, min_length=2, max_length=6)
    #: Con ``patron_color`` nulo, el punto de partida de ese estilo en vez del preset.
    modo: (
        Literal[
            "espiral",
            "anillos",
            "bloques",
            "degradado",
            "aleatorio",
            "flor",
            "damero",
            # `patron_color` declara `zonas` entre los modos de una pared y el
            # editor lo ofrece en la galería de estilos; sin este literal, pulsar
            # "Zonas" devolvía 422 (2026-09-30).
            "zonas",
        ]
        | None
    ) = None
    #: Con ``modo``: el borrador del que viene el decorador (forma de ``patron-color.v1``).
    desde: dict[str, object] | None = None
    #: Líneas resueltas de la pieza (``plan_resuelto.estructuras[].lineas``): solo nombran.
    lineas: list[LineaComprada] | None = Field(default=None, max_length=MAX_LINEAS_PIEZA)

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
        if self.modo is not None and (
            self.patron_color is not None or self.participaciones is not None
        ):
            raise ValueError("modo solo pide el punto de partida de un estilo")
        if self.desde is not None and self.modo is None:
            raise ValueError("desde solo acompaña a modo")
        if self.desde is not None and not forma_valida(self.desde):
            raise ValueError("desde no cumple patron-color.v1")
        return self


class PlanArmadoRequest(OperationalRequest):
    """``plan-armado-bouquet.v1``: resolver un armado (o, con ``None``, sugerir uno).

    Sin catálogo: ``globos`` dicen qué es cada globo de la pieza (los mismos
    datos que Next tiene en sus líneas resueltas); las cantidades son del plan.
    ``variante`` y ``disposicion`` (solo con ``armado_bouquet`` nulo) son lo
    que el decorador eligió en el editor.
    """

    schema_version: Literal["plan-armado-bouquet.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_bouquet: dict[str, object] | None
    globos: list[GloboNavegador] = Field(min_length=1, max_length=MAX_GLOBOS_PIEZA)
    variante: Literal["base_aire", "helio_apilado", "helio_escalonado"] | None = None
    disposicion: Literal["centro", "lados", "arriba", "abajo"] | None = None

    @field_validator("armado_bouquet")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_ARMADO_FORMA.iter_errors(valor), None) is not None:
            raise ValueError("armado_bouquet no cumple armado-bouquet.v1")
        return valor

    @model_validator(mode="after")
    def eleccion_solo_al_sugerir(self) -> "PlanArmadoRequest":
        if self.armado_bouquet is not None and (
            self.variante is not None or self.disposicion is not None
        ):
            raise ValueError("variante y disposicion solo piden una sugerencia")
        return self


class LineaGuirnalda(LineaComprada):
    """Línea resuelta de una guirnalda (vista previa del armado, ADR-0032).

    La de ``LineaComprada`` más el código de tamaño, con el que la leyenda
    nombra cada globo como al resolver. Solo nombra: nunca cuenta ni cobra.
    """

    tamano_codigo: str | None = Field(default=None, max_length=40)


class PlanArmadoGuirnaldaRequest(OperationalRequest):
    """``plan-armado-guirnalda.v1``: resolver el armado de una guirnalda (o sugerir uno con ``None``).

    Sin catálogo: los globos los cuenta el plan; ``lineas`` (las líneas
    resueltas de la pieza que tiene el navegador) solo nombran cada código.
    """

    schema_version: Literal["plan-armado-guirnalda.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_guirnalda: dict[str, object] | None
    lineas: list[LineaGuirnalda] | None = Field(default=None, max_length=MAX_LINEAS_PIEZA)

    @field_validator("armado_guirnalda")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_ARMADO_GUIRNALDA_FORMA.iter_errors(valor), None) is not None:
            raise ValueError("armado_guirnalda no cumple armado-guirnalda.v1")
        return valor


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
    al confeti (se quitan) y se avisa. El reparto que queda lo eligió el
    decorador con el deslizador, así que el patrón pasa a ``origen:
    "decorador"`` aunque viniera de la foto o del preset. Con otro modo el
    reparto se cambia en el editor de patrón: ``patron_activo``.
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
    estructura["patron_color"] = {
        **sin_capas,
        "origen": ORIGEN_DECORADOR,
        "base": {**base, "pesos": pesos},
    }
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
        sincronizar_participaciones(plan, str(estructura["estructura_id"]))
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


def _quitar_armado(estructura: dict[str, object], *, rehacer: bool) -> list[str]:
    """Un bouquet cuyos globos o reparto cambian pierde su armado (ADR-0030).

    El armado acomoda exactamente lo que se compra; tras la edición ya no
    coincidiría y la resolución lo rechazaría. Se quita y se avisa; con
    ``rehacer`` (``completar_armados``, la bandera de Next) el aviso dice que
    la resolución que sigue lo vuelve a sugerir (``completar_armados_de``).
    """
    if estructura.pop("armado_bouquet", None) is None:
        return []
    return [AVISO_ARMADO_REHACER if rehacer else AVISO_ARMADO_QUITADO]


def _fijar_armado(estructura: dict[str, object], edicion: EdicionArmado) -> None:
    """Fija o quita el armado; sin catálogo valida forma y conteo (``armado_invalido``)."""
    if edicion.armado_bouquet is None:
        estructura.pop("armado_bouquet", None)
        return
    armado = copy.deepcopy(edicion.armado_bouquet)
    validar_armado_sin_catalogo(estructura, armado)
    estructura["armado_bouquet"] = armado


def _fijar_armado_guirnalda(
    plan: dict[str, object], estructura: dict[str, object], edicion: EdicionArmadoGuirnalda
) -> list[str]:
    """Fija o quita el armado de una guirnalda; valida todo sin catálogo (``armado_invalido``).

    Todo lo que un armado de guirnalda comprueba se sabe sin catálogo: la pieza
    anfitriona, los anclajes, el relleno, los remates y el patrón; con una
    forma que cuelga, el conteo con el largo de la cuerda. Un patrón en espejo
    pierde el espejo si la guirnalda deja de ir en U invertida (E5).
    """
    avisos = _quitar_espejo_sin_u(estructura, edicion.armado_guirnalda)
    if edicion.armado_guirnalda is None:
        estructura.pop("armado_guirnalda", None)
        return avisos
    armado = copy.deepcopy(edicion.armado_guirnalda)
    validar_armado_guirnalda_sin_catalogo(plan, edicion.estructura_id, armado)
    estructura["armado_guirnalda"] = armado
    return avisos


def _fijar_armado_arco(estructura: dict[str, object], edicion: EdicionArmadoArco) -> list[str]:
    """Fija o quita el armado de un arco; lo comprueba contra la pieza sin catálogo (``armado_invalido``).

    Lo que el motor exige del armado —que la pieza sea un arco, que el patrón tenga los colores que pide, que
    cada índice exista en ``materiales`` y que no salgan más globos de los que el contrato publica— se sabe sin
    catálogo: es ``armado_arco.armado_resuelto``, la misma puerta de la vista previa y de la resolución, así que
    guardar no acepta lo que luego la resolución rechazaría. Lo demás (el ancho que cabe, el alto de la forma) el
    motor lo corrige al resolver y lo cuenta en los avisos; no se rechaza. Los colores no importan aquí, solo
    cuántos son.

    **Las medidas de la pieza las pone el armado.** Un arco armado mide lo que el motor dice que mide (su ancho y
    su alto exteriores, ya corregidos), no lo que el plan declaraba antes: si no, la tarjeta, el cálculo y la
    imagen hablarían de dos arcos. Devuelve los avisos de lo que guardar deja sin comprar (un color de la pieza que
    el armado no toma).
    """
    if edicion.armado_arco is None:
        estructura.pop("armado_arco", None)
        return []
    armado = copy.deepcopy(edicion.armado_arco)
    pieza = EstructuraArco(
        es_arco=estructura.get("tipo") == "arco",
        materiales=[TONO_NEUTRO] * len(_materiales(estructura)),
    )
    try:
        resuelto = armado_resuelto(pieza, armado)
    except ArmadoArcoInvalido as error:
        raise PlanResolutionError(
            "armado_invalido",
            422,
            {
                "estructura_id": edicion.estructura_id,
                "motivo": error.motivo,
                "mensaje": error.mensaje,
            },
        ) from error
    estructura["armado_arco"] = armado
    medidas = estructura.get("medidas")
    estructura["medidas"] = {
        **(cast(Mapping[str, object], medidas) if isinstance(medidas, Mapping) else {}),
        "ancho_m": round(float(resuelto["ancho_m"]), 2),
        "alto_m": round(float(resuelto["alto_m"]), 2),
    }
    return _colores_sin_uso(estructura)


def _colores_sin_uso(estructura: Mapping[str, object]) -> list[str]:
    """Los colores de la pieza que el armado del arco no toma, como avisos para el decorador."""
    armado = estructura.get("armado_arco")
    if not isinstance(armado, Mapping):
        return []
    return cast(
        list[str],
        avisos_colores_sin_uso(
            [str(material.get("color") or "") for material in _materiales(estructura)],
            cast(Sequence[int], armado["materiales"]),
        ),
    )


def _sin_armado_arco(estructura: Mapping[str, object]) -> None:
    """El reparto y la mezcla no se editan en un arco armado: la compra sale de su armado.

    Con ``armado_arco`` la cuenta es la del motor (cada globo colocado), así que ni ``participacion`` ni
    ``mezcla`` cambian cuántos globos se compran: aceptarlos solo movería el ``plan_hash`` con el mismo total y
    diría «listo, cambié…» sin cambiar nada. Los colores y el tamaño del globo se cambian desde el armado.
    """
    if estructura.get("armado_arco") is not None:
        raise PlanResolutionError("armado_arco_activo", 409)


def _identidades(materiales: Sequence[Mapping[str, object]]) -> list[tuple[object, object, object]]:
    return [(m.get("product_id"), m.get("variant_id"), m.get("color")) for m in materiales]


def _indice_quitado(
    antes: Sequence[tuple[object, object, object]], despues: Sequence[tuple[object, object, object]]
) -> int | None:
    """La posición del material que una edición quitó, o ``None`` si no se quitó ninguno."""
    if len(despues) != len(antes) - 1:
        return None
    return next(
        (i for i, previo in enumerate(antes) if i >= len(despues) or despues[i] != previo), None
    )


def _sin_posiciones(secuencias: object, nuevas: Mapping[int, int]) -> list[list[int] | None]:
    """Las capas o secciones del armado tras quitar posiciones de ``materiales``.

    Capas y secciones nombran POSICIONES de ``armado_arco.materiales`` (no índices de la pieza): al quitar una
    posición se descartan sus apariciones y las demás se corren. Una secuencia que se queda vacía vuelve a
    seguir el patrón (``None``).
    """
    salida: list[list[int] | None] = []
    for secuencia in cast(Sequence[Sequence[int] | None], secuencias):
        if secuencia is None:
            salida.append(None)
            continue
        quedan = [nuevas[i] for i in secuencia if i in nuevas]
        salida.append(quedan or None)
    return salida


def _revisar_armado_arco(
    estructura: dict[str, object],
    antes: Sequence[tuple[object, object, object]],
) -> list[str]:
    """Un arco armado vuelve a validarse contra los colores que la pieza lleva ahora (ADR-0035).

    ``armado_arco.materiales`` nombra los colores de la pieza por índice (y sus capas y secciones, las
    posiciones de esa lista), así que cambiar los colores de la pieza los puede dejar apuntando a otro color o a
    ninguno. Nunca se guarda así:

    - **Quitar un color**: los índices mayores se corren y las posiciones que lo usaban se descartan. Si con lo
      que queda el patrón sigue cabiendo, se conserva y se avisa; si no (pide más colores de los que quedan), el
      arco baja a ``solido`` con el primer color y las capas y secciones se quitan, y se dice. Si el color que
      sale es posterior a todos los que usa el armado, no hay nada que mover.
    - **Agregar un color**: los índices no se mueven y el armado vale tal cual; el color nuevo no se usa hasta
      que el decorador elija un patrón que lo tome, y se avisa.
    - Reemplazar o repartir no cambian cuántos son ni su orden: nada que revisar.
    """
    armado = estructura.get("armado_arco")
    if not isinstance(armado, dict):
        return []
    despues = _identidades(_materiales(estructura))
    if len(despues) == len(antes) + 1:
        return [AVISO_ARMADO_ARCO_COLOR_NUEVO]
    quitado = _indice_quitado(antes, despues)
    if quitado is None:
        return []
    usados = cast(list[int], armado["materiales"])
    if all(indice < quitado for indice in usados):
        return []
    posiciones = {p: i for p, i in enumerate(usados) if i != quitado}
    nuevas = {viejo: nuevo for nuevo, viejo in enumerate(posiciones)}
    ajustado = {
        **armado,
        "origen": "decorador",
        "materiales": [i - 1 if i > quitado else i for i in posiciones.values()],
        "capas": _sin_posiciones(armado["capas"], nuevas),
        "secciones": _sin_posiciones(armado["secciones"], nuevas),
    }
    pieza = EstructuraArco(es_arco=True, materiales=[TONO_NEUTRO] * len(despues))
    try:
        if not ajustado["materiales"]:
            raise ArmadoArcoInvalido("sin_materiales", "El arco no lleva colores que armar.")
        validar_armado_arco(pieza, ajustado)
    except ArmadoArcoInvalido:
        estructura["armado_arco"] = {
            **ajustado,
            "patron": "solido",
            "opciones": {},
            "materiales": [0],
            "capas": [],
            "secciones": [],
        }
        return [AVISO_ARMADO_ARCO_SOLIDO, *_colores_sin_uso(estructura)]
    estructura["armado_arco"] = ajustado
    return [AVISO_ARMADO_ARCO_COLORES, *_colores_sin_uso(estructura)]


def _quitar_espejo_sin_u(estructura: dict[str, object], armado: object) -> list[str]:
    """La regla vive en ``patron_color.quitar_espejo_sin_u`` (la usa también la vista previa)."""
    avisos: list[str] = quitar_espejo_sin_u(estructura, armado)
    return avisos


def _revisar_armado_guirnalda(
    plan: dict[str, object], indice: int, *, quitar_siempre: bool, rehacer: bool
) -> list[str]:
    """Una guirnalda editada conserva su armado solo si todavía cabe en sus globos (ADR-0032).

    El armado de una guirnalda no lleva cantidades: tras cambiar colores,
    reparto, mezcla o patrón se vuelve a validar contra el plan editado y se
    queda si vale. Quitar un color corre los índices de ``materiales``, así
    que ahí se quita siempre. Con ``rehacer`` (``completar_armados_guirnalda``,
    la bandera de Next) el aviso dice que la re-resolución lo vuelve a sugerir.
    """
    estructura = _estructura(plan, indice)
    armado = estructura.get("armado_guirnalda")
    if armado is None:
        return []
    if not quitar_siempre:
        try:
            validar_armado_guirnalda_sin_catalogo(
                plan, str(estructura["estructura_id"]), cast(Mapping[str, object], armado)
            )
            return []
        except PlanResolutionError as error:
            if error.code != "armado_invalido":
                raise
    estructura.pop("armado_guirnalda", None)
    if rehacer:
        return [AVISO_ARMADO_GUIRNALDA_REHACER]
    return [AVISO_ARMADO_GUIRNALDA_COLOR if quitar_siempre else AVISO_ARMADO_GUIRNALDA_QUITADO]


def editar_plan(
    plan: Mapping[str, object],
    edicion: EdicionPlan,
    lineas_base: Sequence[LineasBaseEstructura] = (),
    colores_variante: Sequence[str] = (),
    *,
    completar_patrones: bool = False,
    completar_armados: bool = False,
    completar_armados_guirnalda: bool = False,
) -> PlanEditado:
    """Aplica una edición al plan declarativo y devuelve el plan editado, ya validado.

    Si la estructura editada termina con patrón, ``participacion`` se reescribe
    desde su rejilla (``sincronizar_participaciones``): el plan editado ya dice
    lo que la resolución va a contar. Una guirnalda con armado lo conserva
    mientras siga cabiendo en sus globos (``_revisar_armado_guirnalda``).
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
    elif isinstance(edicion, EdicionArmado):
        _fijar_armado(estructura, edicion)
    elif isinstance(edicion, EdicionArmadoGuirnalda):
        avisos = _fijar_armado_guirnalda(editado, estructura, edicion)
    elif isinstance(edicion, EdicionArmadoArco):
        avisos = _fijar_armado_arco(estructura, edicion)
    elif isinstance(edicion, EdicionArmadoColumna):
        avisos = fijar_armado_columna(estructura, edicion.armado_columna, edicion.estructura_id)
    elif isinstance(edicion, EdicionArmadoColumnaOrganica):
        avisos = fijar_armado_columna_organica(
            estructura, edicion.armado_columna_organica, edicion.estructura_id
        )
    elif isinstance(edicion, EdicionArmadoGuirnaldaOrganica):
        avisos = fijar_armado_guirnalda_organica(
            estructura, edicion.armado_guirnalda_organica, edicion.estructura_id
        )
    elif isinstance(edicion, EdicionReparto):
        _sin_armado_arco(estructura)
        sin_armado_columna(estructura)
        sin_armado_columna_organica(estructura)
        sin_armado_guirnalda_organica(estructura)
        avisos = _repartir(estructura, edicion.participaciones)
        avisos += _quitar_armado(estructura, rehacer=completar_armados)
    elif isinstance(edicion, EdicionMezcla):
        _sin_armado_arco(estructura)
        sin_armado_columna(estructura)
        sin_armado_columna_organica(estructura)
        sin_armado_guirnalda_organica(estructura)
        estructura["mezcla"] = edicion.mezcla
    else:
        materiales_antes = len(_materiales(estructura))
        identidades_antes = _identidades(_materiales(estructura))
        _editar_materiales(estructura, edicion, lineas_base, colores_variante)
        avisos = _ajustar_patron(editado, indice, edicion, materiales_antes, completar_patrones)
        avisos += _quitar_armado(estructura, rehacer=completar_armados)
        avisos += _revisar_armado_arco(estructura, identidades_antes)
        avisos += revisar_armado_columna(estructura, identidades_antes)
        avisos += revisar_armado_columna_organica(estructura, identidades_antes)
        avisos += revisar_armado_guirnalda_organica(estructura, identidades_antes)
    if _estructura(editado, indice).get("patron_color") is not None:
        # Valida el patrón (forma y reglas del §4) y reescribe participacion,
        # solo en la pieza editada: las demás no cambiaron.
        editado = sincronizar_participaciones(editado, edicion.estructura_id)
    if not isinstance(
        edicion,
        (
            EdicionArmado,
            EdicionArmadoGuirnalda,
            EdicionArmadoArco,
            EdicionArmadoColumna,
            EdicionArmadoColumnaOrganica,
            EdicionArmadoGuirnaldaOrganica,
        ),
    ):
        avisos += _revisar_armado_guirnalda(
            editado,
            indice,
            quitar_siempre=isinstance(edicion, EdicionMaterial) and edicion.accion == "quitar",
            rehacer=completar_armados_guirnalda,
        )
        editada = _estructura(editado, indice)
        sin_espejo = _quitar_espejo_sin_u(editada, editada.get("armado_guirnalda"))
        if sin_espejo:
            # El armado en U se fue con esta edición: el patrón sigue, sin espejo.
            avisos += sin_espejo
            editado = sincronizar_participaciones(editado, edicion.estructura_id)
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
        completar_armados=request.completar_armados,
        completar_armados_guirnalda=request.completar_armados_guirnalda,
    )
    return {
        "operation_schema_version": PLAN_EDIT_RESULT_VERSION,
        "plan": resultado.plan,
        "avisos": list(resultado.avisos),
    }


def vista_previa_armado(request: PlanArmadoRequest) -> dict[str, object]:
    """``plan-armado-bouquet-result.v1``: el armado dado resuelto, o la receta con ``None``.

    Sin catálogo; la leyenda, los insumos y las frases son los que dará la
    próxima resolución con esos globos. Un rechazo ``armado_invalido`` de la
    pieza trae además los estilos y las disposiciones que admite, para que el
    editor los siga ofreciendo.
    """
    globos = [globo.model_dump() for globo in request.globos]
    try:
        vista = vista_previa_de_armado(
            request.plan,
            request.estructura_id,
            request.armado_bouquet,
            globos,
            variante=request.variante,
            disposicion=request.disposicion,
        )
    except PlanResolutionError as error:
        detalles = error.details or {}
        if (
            error.code != "armado_invalido"
            or detalles.get("estructura_id") != request.estructura_id
        ):
            raise
        opciones = opciones_de_armado(request.plan, request.estructura_id, globos)
        raise PlanResolutionError(
            error.code,
            error.status_code,
            {
                **detalles,
                "variantes_admitidas": opciones[0],
                "disposiciones_admitidas": opciones[1],
            },
        ) from error
    if next(_ARMADO_RESUELTO.iter_errors(vista.armado), None) is not None:
        raise RuntimeError("el armado resuelto no cumple plan-resuelto.v1")
    return {
        "operation_schema_version": PLAN_ARMADO_RESULT_VERSION,
        "armado": vista.armado,
        "variantes_admitidas": [v for v in VARIANTES if v in vista.variantes_admitidas],
        "disposiciones_admitidas": [d for d in DISPOSICIONES if d in vista.disposiciones_admitidas],
    }


def vista_previa_armado_guirnalda(request: PlanArmadoGuirnaldaRequest) -> dict[str, object]:
    """``plan-armado-guirnalda-result.v1``: el armado dado resuelto, o la receta con ``None``.

    Sin catálogo; la leyenda, los racimos, los insumos y las frases son los que
    dará la próxima resolución. ``opciones`` es lo que el editor puede ofrecer
    para la pieza (soportes, anfitrionas, unidades, tamaños base, colores de
    relleno y de remate), decidido en Python.
    """
    vista = vista_previa_de_armado_guirnalda(
        request.plan,
        request.estructura_id,
        request.armado_guirnalda,
        [linea.model_dump() for linea in request.lineas] if request.lineas else None,
    )
    if next(_ARMADO_GUIRNALDA_RESUELTO.iter_errors(vista.armado), None) is not None:
        raise RuntimeError("el armado resuelto no cumple plan-resuelto.v1")
    return {
        "operation_schema_version": PLAN_ARMADO_GUIRNALDA_RESULT_VERSION,
        "armado": vista.armado,
        "opciones": vista.opciones,
    }


def _vista_previa_reparto(
    plan: Mapping[str, object],
    estructura_id: str,
    participaciones: Sequence[float],
    compras: ComprasPorMaterial,
) -> VistaPreviaPatron:
    """El confeti de la estructura tras ``repartir``, sin guardar nada.

    Es la misma edición que aplicará ``/plan/edit``; una estructura sin patrón
    no tiene nada que dibujar (``sin_patron``) y otro modo es ``patron_activo``.
    ``compras`` se leyó del plan recibido (el de las líneas): ``repartir`` no
    cambia los materiales, solo cuántos globos lleva cada uno.
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
    vista = vista_previa_de_estructura(
        editado.plan,
        estructura_id,
        cast(dict[str, object], nuevo["patron_color"]),
        compras=compras,
    )
    if editado.avisos:
        vista.patron["avisos"] = [*editado.avisos, *cast(list[str], vista.patron["avisos"])]
    return vista


def _rechazo_con_estilos(
    error: PlanResolutionError, request: PlanPatronRequest
) -> PlanResolutionError | None:
    """``patron_invalido`` de la pieza pedida, con los estilos que admite (ADR-0028 §10).

    Sin sugerencia posible (una rejilla demasiado chica, por ejemplo) el editor
    sigue ofreciendo los estilos de la pieza: van en el mismo rechazo. ``None``
    si el rechazo es otro, habla de otra pieza o ya los trae.
    """
    detalles = error.details or {}
    if (
        error.code != "patron_invalido"
        or detalles.get("estructura_id") != request.estructura_id
        or "modos_admitidos" in detalles
    ):
        return None
    try:
        modos = modos_admitidos_de_estructura(request.plan, request.estructura_id)
    except PlanResolutionError:
        return None
    return PlanResolutionError(
        error.code, error.status_code, {**detalles, "modos_admitidos": modos}
    )


def vista_previa_patron(request: PlanPatronRequest) -> dict[str, object]:
    """``plan-patron-result.v1``: el patrón dado expandido, o la sugerencia con ``None``.

    Sin catálogo; la rejilla y el conteo son los que dará la próxima resolución.
    Con ``lineas``, cada color se nombra por lo que se compra, como al
    resolver (``compras_de_estructura``); si no corresponden al plan, por lo
    que declara ``materiales``.
    Los estilos que ofrece el editor (``modos_admitidos``) los decide Python:
    viajan con la respuesta y con el rechazo ``patron_invalido`` de la pieza.
    """
    compras = (
        compras_de_estructura(
            request.plan,
            request.estructura_id,
            [linea.model_dump() for linea in request.lineas],
        )
        if request.lineas
        else {}
    )
    try:
        if request.participaciones is not None:
            vista = _vista_previa_reparto(
                request.plan, request.estructura_id, request.participaciones, compras
            )
        else:
            vista = vista_previa_de_estructura(
                request.plan,
                request.estructura_id,
                request.patron_color,
                modo=request.modo,
                desde=request.desde,
                compras=compras,
            )
    except PlanResolutionError as error:
        con_estilos = _rechazo_con_estilos(error, request)
        if con_estilos is None:
            raise
        raise con_estilos from error
    if next(_PATRON_RESUELTO.iter_errors(para_validar(vista.patron)), None) is not None:
        raise RuntimeError("el patrón resuelto no cumple plan-resuelto.v1")
    return {
        "operation_schema_version": PLAN_PATRON_RESULT_VERSION,
        "patron": vista.patron,
        "modos_admitidos": vista.modos_admitidos,
    }


__all__ = [
    "AVISO_ARMADO_GUIRNALDA_COLOR",
    "AVISO_ARMADO_GUIRNALDA_QUITADO",
    "AVISO_ARMADO_GUIRNALDA_REHACER",
    "AVISO_ARMADO_QUITADO",
    "AVISO_ARMADO_REHACER",
    "EdicionArmado",
    "EdicionArmadoColumna",
    "EdicionArmadoColumnaOrganica",
    "EdicionArmadoGuirnalda",
    "EdicionPlan",
    "EdicionMaterial",
    "EdicionMezcla",
    "EdicionPatron",
    "EdicionReparto",
    "GloboNavegador",
    "LineaBase",
    "LineaComprada",
    "LineaGuirnalda",
    "LineasBaseEstructura",
    "MAX_LINEAS_PIEZA",
    "ORIGEN_DECORADOR",
    "PARTICIPACION_AGREGAR",
    "PLAN_ARMADO_GUIRNALDA_SCOPE",
    "PLAN_ARMADO_SCOPE",
    "PLAN_EDIT_SCOPE",
    "PLAN_PATRON_SCOPE",
    "PlanArmadoGuirnaldaRequest",
    "PlanArmadoRequest",
    "vista_previa_armado",
    "vista_previa_armado_guirnalda",
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
