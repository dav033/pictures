"""Deterministic commercial plan resolution owned by the Python service.

The resolver consumes a validated declarative plan and catalog rows from one
published snapshot. It never searches for a substitute outside the allowlist
and never accepts price, availability, or package data from the request.

The stable domain error contract for ``/internal/v1/plan/resolve`` is:

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| ``invalid_plan`` | 422 | The plan does not conform to Plan 1.0. |
| ``catalog_snapshot_not_found`` | 422 | The requested catalog snapshot is not published. |
| ``allowlist_product_mismatch`` | 422 | A variant is paired with a product that does not own it in the snapshot. |
| ``patron_invalido`` | 422 | A structure's ``patron_color`` breaks a cross rule (ADR-0028 §4). |

``patron_invalido`` carries ``details``: ``estructura_id``, a stable ``motivo``
and a Spanish ``mensaje`` for the decorator. The pattern helpers used by the
editor (``patron_resuelto_de_estructura`` and friends) also raise
``estructura_no_encontrada`` (404).

An uncovered plan is not an error. The resolver returns HTTP 200 and reports
the missing material in ``plan_resuelto.sin_cobertura``; admissible catalog
substitutions are reported in ``plan_resuelto.sustituciones``. Callers must use
those fields when explaining partial coverage instead of treating it as a
failed resolution.

The transport and infrastructure codes remain ``invalid_request`` (422) for
an invalid operational envelope and ``catalog_store_unavailable`` (503) when
the catalog store cannot be used. They are not domain resolution outcomes.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import unicodedata
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import lru_cache, partial
from math import isfinite
from typing import Annotated, Literal, Protocol, cast
from urllib.parse import urlparse

from jsonschema import Draft7Validator
from pydantic import ConfigDict, Field, ValidationError, field_validator, model_validator

from app.generated_models import (
    contract_schema,
    ListaMaterialesRequest as ListaMaterialesPayload,
    ListaMaterialesResult,
    MaterialEstimate,
    PlanDecoracion,
    PlanResolutionResult,
    PlanResuelto,
    Quote,
)
from app.armado_bouquet import (
    CONFIANZA_MINIMA_LECTURA,
    MAX_CANTIDAD_NIVEL,
    MAX_TOTAL_LEIDO,
    ArmadoInvalido,
    CompraLeida,
    EstructuraBouquet,
    GloboCatalogo,
    MaterialBouquet,
    armado_resuelto,
    clasificar,
    compra_desde_lectura,
    disposiciones_admitidas,
    sugerir_armado,
    validar,
    variantes_admitidas,
)
from app.armado_arco import ArmadoInvalido as ArmadoArcoInvalido
from app.armado_arco_prompt import frases_arco
from app.armado_arco_organico_prompt import frases_arco_organico
from app.armado_columna_prompt import frases_columna
from app.armado_columna_organica_prompt import frases_columna_organica
from app.armado_guirnalda_organica_prompt import frases_guirnalda_organica
from app.armado_arco import EstructuraArco
from app.armado_arco import armado_resuelto as armado_arco_resuelto
from app.armado_arco_organico import ArmadoInvalido as ArmadoArcoOrganicoInvalido
from app.armado_arco_organico import EstructuraArcoOrganico
from app.armado_arco_organico import armado_resuelto as armado_arco_organico_resuelto
from app.armado_columna import ArmadoInvalido as ArmadoColumnaInvalido
from app.armado_columna import EstructuraColumna
from app.armado_columna import armado_resuelto as armado_columna_resuelto
from app.armado_columna_organica import ArmadoInvalido as ArmadoColumnaOrganicaInvalido
from app.armado_columna_organica import EstructuraColumnaOrganica
from app.armado_columna_organica import armado_resuelto as armado_columna_organica_resuelto
from app.armado_guirnalda_organica import ArmadoInvalido as ArmadoGuirnaldaOrganicaInvalido
from app.armado_guirnalda_organica import EstructuraGuirnalda as EstructuraGuirnaldaOrganica
from app.armado_guirnalda_organica import armado_resuelto as armado_guirnalda_organica_resuelto
from app.armado_guirnalda import ArmadoInvalido as ArmadoGuirnaldaInvalido
from app.armado_guirnalda import FORMAS_CON_ARQUEO as GARLAND_ARCHING_SHAPES
from app.armado_guirnalda import (
    EstructuraGuirnalda,
    GloboGuirnalda,
    OtraEstructura,
)
from app.armado_guirnalda import armado_resuelto as armado_guirnalda_resuelto
from app.armado_guirnalda import geometria_de_lectura as geometria_de_lectura_guirnalda
from app.armado_guirnalda import opciones_admitidas as opciones_armado_guirnalda
from app.armado_guirnalda import racimo_y_forma as racimo_y_forma_de_armado
from app.armado_guirnalda import sugerir_armado as sugerir_armado_guirnalda
from app.armado_guirnalda import validar as validar_armado_guirnalda
from app.catalog import purchase_color_for_unsold
from app.colores_titulo import WINE_TITLE
from app import conteo_foto
from app.flores_pieza import (
    ADORNO_FLOR,
    PULGADAS_FLOR,
    elegir_talla,
    es_linea_de_flor,
    lineas_del_cuerpo,
    partes_de_flores,
)
from app.patron_de_la_foto import mezcla_del_motor
from app.supuestos import agregar_supuesto, supuesto
from app.merma import MERMA as _MERMA_COMPARTIDA
from app.operational_models import ContractModel, OperationalRequest
from app.plan_worker import run_plan_cpu
from app.registro import registrar_evento
from app.patron_color import (
    CONFIANZA_MINIMA_PISTA,
    EstructuraPatron,
    Expansion,
    MaterialPatron,
    PatronColorInvalido,
    conteo_por_instancia,
    forma_valida,
    modos_admitidos,
    para_validar,
    participaciones,
    patron_desde_pista,
    patron_resuelto,
    sugerir_patron,
    sugerir_patron_modo,
    validar_y_expandir,
)
from app.patron_color import filas_de_racimos, quitar_espejo_sin_u
from app.silueta_patron import (
    Croquis,
    PresupuestoGrafica,
    croquis_de_patron,
    pieza_desde_estructura,
)


PLAN_RESOLUTION_SCOPE = "plan.resolve"
LISTA_MATERIALES_SCOPE = "plan.lista_materiales"
PLAN_RESOLUTION_REQUEST_VERSION = "plan-resolution.v1"
PLAN_RESOLUTION_RESULT_VERSION = "plan-resolution-result.v1"
PLAN_RESOLVED_VERSION = "plan-resuelto.v1"
#: La merma vive en ``app/merma.py`` (las puertas de los motores la necesitan y ``plan.py`` las importa); aquí se
#: re-exporta con su tipo, porque el resto del código y de las pruebas la lee de ``app.plan``.
MERMA: float = _MERMA_COMPARTIDA
MAX_SAFE_INTEGER = 9_007_199_254_740_991
# Mirrors PLAN_RESOLUTION_MAX_FLUX_VARIANTS (domain-v1.ts) and the recommendations
# bound: the same LoRA dataset pool reaches both. 2048 ids x 17 bytes (14-digit
# id, quotes, comma) is about 34.8 KB of the 64 KB body limit; 4096 would not fit.

_EXTERIOR = re.compile(r"jard[ií]n|exterior|terraza|playa|patio|campo", re.IGNORECASE)
# Which structures count their balloons by geometry: ``conteo_foto.es_geometrica`` (one owner; a
# centerpiece of a few counted balloons declares units instead, UI-6).
_DENSITY_LAMBDA = {"sencilla": 2.8, "media": 3.6, "lujosa": 4.5}
# Mix table, standard diameters, substitution cap and mandatory-size grammar.
# Owned by src/lib/plan/mezclas.ts and exported into the plan-decoracion.v1
# contract as ``x-reglas-mezclas``; this resolver reads them from there. There
# is no default: counting without the mix table would be wrong, not degraded.
_MIX_RULES: dict[str, object] = cast(
    dict[str, object], contract_schema("PlanDecoracion")["x-reglas-mezclas"]
)
_MIXES: dict[str, tuple[tuple[int, float], ...]] = {
    mix: tuple(
        (int(size["pulgadas"]), float(size["proporcion"]))
        for size in cast(list[dict[str, float]], sizes)
    )
    for mix, sizes in cast(dict[str, object], _MIX_RULES["mezclas"]).items()
}
_DIAMETROS_ESTANDAR: tuple[int, ...] = tuple(
    int(size) for size in cast(list[int], _MIX_RULES["diametros_estandar"])
)
_MAX_SUBSTITUTION_RATIO = float(cast(float, _MIX_RULES["razon_maxima_sustitucion"]))
_BAND_WIDTH: dict[str, float] = {
    "clasica": 1.3,
    "organica_fina": 1.02,
    "organica_gruesa": 1.3,
    "solo_grandes": 1.3,
}
# Geometry of official structure variants (aro circular, asymmetrical arches).
# Owned by src/lib/plan/estructuras-oficiales.ts and exported into the
# plan-decoracion.v1 contract, which is where this resolver reads it from.
_OFFICIAL_GEOMETRY: dict[str, dict[str, object]] = cast(
    dict[str, dict[str, object]],
    contract_schema("PlanDecoracion").get("x-geometria-estructuras-oficiales", {}),
)
# La ``forma`` de cada estructura oficial. Mismo dueño y misma vía que la
# geometría: ``src/lib/plan/estructuras-oficiales.ts``, exportada en
# ``x-formas-estructuras-oficiales``.
_OFFICIAL_SHAPES: dict[str, str] = cast(
    dict[str, str],
    contract_schema("PlanDecoracion").get("x-formas-estructuras-oficiales", {}),
)
#: Las formas que **ningún motor de globos produce**. Un motor arma una banda, una
#: torre o una tira: sabe hacer una curva simétrica, una asimétrica y un contorno
#: orgánico. Un aro cerrado y una pieza de forma libre (un techo, un centro de
#: mesa, un bouquet, una figura) no son ninguna de esas tres cosas. Mismo dueño que
#: la tabla de formas (``FORMAS_SIN_MOTOR`` de ``estructuras-oficiales.ts``),
#: exportado en ``x-formas-sin-motor``: la regla no se repite aquí.
FORMAS_SIN_MOTOR = frozenset(
    cast(list[str], contract_schema("PlanDecoracion").get("x-formas-sin-motor", []))
)
#: Las estructuras oficiales que no arma ningún motor, **derivadas de la tabla** y
#: no escritas a mano: hoy son ``aro_circular``, ``techo_globos``, ``centro_mesa``,
#: ``bouquet`` y ``figura``. Su conteo es el de la fórmula, que es el que necesitan
#: (ADR-0034 §3 y el comentario de ``_structure_count``): el aro se cuenta con su
#: ``π × diámetro`` y no con la banda de un arco.
#:
#: Hace falta porque ningún motor mira ``estructura_oficial``: la puerta pregunta
#: por el ``tipo``, y el ``tipoBase`` de un aro es ``arco`` y el de un techo
#: ``guirnalda``. Sin esto, la receta les ponía el armado de un arco o de una
#: guirnalda y la pieza se contaba **y se dibujaba** con la forma equivocada. Su
#: dibujo es el esquemático de ``app/dibujo_estructura.py``, que no cuenta nada.
OFICIALES_SIN_MOTOR = frozenset(
    oficial for oficial, forma in _OFFICIAL_SHAPES.items() if forma in FORMAS_SIN_MOTOR
)
#: Las estructuras oficiales de forma ``asimetrica`` (hoy ``arco_asimetrico``,
#: ``semiarco_asimetrico``, ``columna_asimetrica`` y ``pared_organica``), **derivadas
#: de la misma tabla**. La receta del motor las lee para no armar simétrica una
#: pieza que el plan declara asimétrica: en el diseñador la asimetría es una forma
#: lista del arco orgánico (``asimetrico``), no una forma del arco de patrones.
OFICIALES_ASIMETRICAS = frozenset(
    oficial for oficial, forma in _OFFICIAL_SHAPES.items() if forma == "asimetrica"
)


# Densities each official structure admits (arco_no_denso only sencilla,
# pared_densa only media/lujosa...). Same owner, estructuras-oficiales.ts, which
# exports them as the ``allOf`` coherence rules of the structure item; read from
# there so the photo count never picks one the plan would reject (review 2).
def _official_densities() -> dict[str, tuple[str, ...]]:
    """Densities per official variant, read from the rules that name one.

    The list holds more than densities: ``formas-pieza.ts`` adds its own rules
    (the chosen ``forma`` against the same official), and those name no density
    and do not always carry a ``const`` official. Each access is guarded so a new
    family of rules cannot break this read.
    """
    reglas = [
        regla
        for regla in cast(
            list[object],
            contract_schema("PlanDecoracion")["properties"]["estructuras"]["items"].get(
                "allOf", []
            ),
        )
        if isinstance(regla, Mapping)
    ]
    densidades: dict[str, tuple[str, ...]] = {}
    for regla in reglas:
        condicion = regla.get("if")
        consecuencia = regla.get("then")
        if not isinstance(condicion, Mapping) or not isinstance(consecuencia, Mapping):
            continue
        propiedades_si = condicion.get("properties")
        propiedades_entonces = consecuencia.get("properties")
        if not isinstance(propiedades_si, Mapping) or not isinstance(propiedades_entonces, Mapping):
            continue
        oficial = propiedades_si.get("estructura_oficial")
        densidad = propiedades_entonces.get("densidad")
        if not isinstance(oficial, Mapping) or not isinstance(densidad, Mapping):
            continue
        nombre = oficial.get("const")
        admitidas = densidad.get("enum")
        if isinstance(nombre, str) and isinstance(admitidas, list):
            densidades[nombre] = tuple(cast(list[str], admitidas))
    return densidades


_OFFICIAL_DENSITIES: dict[str, tuple[str, ...]] = _official_densities()


def _admitted_densities(structure: Mapping[str, object]) -> tuple[str, ...]:
    """The densities the structure's official variant admits; all three without one."""
    return _OFFICIAL_DENSITIES.get(
        _text(structure.get("estructura_oficial")) or "", tuple(_DENSITY_LAMBDA)
    )


# ADR-0032: geometry per shape of a garland that carries ``armado_guirnalda``
# (same owner and table). Read strictly: without it a hanging garland would be
# counted with its straight length.
_GARLAND_SHAPES: dict[str, dict[str, object]] = cast(
    dict[str, dict[str, object]], _OFFICIAL_GEOMETRY["guirnalda"]["formas"]
)
# ADR-0032, E4: the shape of a garland reading of the photo (``PistaGuirnaldaSchema``,
# owner src/lib/plan/armado-guirnalda.ts), checked against the exported contract
# instead of a second hand-written model.
_GARLAND_HINT = Draft7Validator(
    contract_schema("PlanResolutionRequest")["properties"]["pistas_guirnalda"]["items"]
)
_PHOTO_GEOMETRY_HINT = Draft7Validator(
    cast(Mapping[str, object], contract_schema("PlanResolutionRequest")["properties"]["pistas_geometria"]["items"])
)
_DEFAULT_MEASURES: dict[str, dict[str, dict[str, float]]] = {
    "arco": {"interior": {"ancho_m": 3, "alto_m": 2.4}, "exterior": {"ancho_m": 4, "alto_m": 2.6}},
    # ancho = horizontal reach of the curve; see src/lib/plan/medidas-defecto.ts.
    "semiarco": {
        "interior": {"ancho_m": 1.2, "alto_m": 2.2},
        "exterior": {"ancho_m": 1.5, "alto_m": 2.4},
    },
    "guirnalda": {"interior": {"largo_m": 2.5}, "exterior": {"largo_m": 3.5}},
    "columna": {"interior": {"alto_m": 1.8}, "exterior": {"alto_m": 2}},
    "pared": {
        "interior": {"ancho_m": 2.4, "alto_m": 2.4},
        "exterior": {"ancho_m": 3, "alto_m": 2.4},
    },
    "centro_mesa": {
        "interior": {"ancho_m": 0.4, "alto_m": 0.5},
        "exterior": {"ancho_m": 0.4, "alto_m": 0.5},
    },
    "backdrop": {"interior": {}, "exterior": {}},
    "kit": {"interior": {}, "exterior": {}},
    "accesorio": {"interior": {}, "exterior": {}},
}


class CatalogPlanStore(Protocol):
    async def published_snapshot(self, snapshot_id: str) -> str | None: ...

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[Mapping[str, object]]: ...

    async def fetch_catalog_identity(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[Mapping[str, object]]:
        """Return ``{product_id, variant_id}`` identity rows for one snapshot.

        Variant rows carry their real owner. Product rows carry
        ``variant_id=None``. Status, availability, currency, and price are
        deliberately ignored so ownership checks do not depend on stock.
        """
        ...

class PlanResolutionError(Exception):
    """Stable domain error translated by the HTTP boundary.

    Resolution codes are ``invalid_plan``, ``catalog_snapshot_not_found``,
    ``allowlist_product_mismatch`` and ``patron_invalido``; the pattern helpers
    add ``estructura_no_encontrada``. ``details`` travels next to the code in
    the error body (``patron_invalido``: ``estructura_id``, ``motivo``,
    ``mensaje``). Missing catalog coverage is represented in the successful
    result, not by this exception.
    """

    def __init__(
        self,
        code: str,
        status_code: int = 422,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.details: dict[str, object] | None = dict(details) if details else None


class PlanAllowlistEntry(ContractModel):
    product_id: str = Field(min_length=1, max_length=160)
    variant_ids: list[str] = Field(min_length=1, max_length=256)

    @field_validator("product_id")
    @classmethod
    def normalize_product_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("allowlist product_id must not be blank")
        return value

    @field_validator("variant_ids")
    @classmethod
    def normalize_variant_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("allowlist variant_ids must not be blank")
        if len(normalized) != len(set(normalized)):
            raise ValueError("allowlist variant_ids must be unique")
        return normalized


class ZonaLeida(ContractModel):
    """Una mancha de color leída en la foto (``PistaPatronSchema.zonas``, ADR-0036).

    El color va por NOMBRE de catálogo, no por índice: quien mira la foto no
    conoce los materiales de la pieza. ``patron_color.materiales_de_colores`` los
    resuelve con la misma tabla de tonos, junto con los ``colores`` de la pista.
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    color: str = Field(min_length=1, max_length=80)
    ancla: Literal[
        "superior_izquierda",
        "superior_centro",
        "superior_derecha",
        "media_izquierda",
        "centro",
        "media_derecha",
        "inferior_izquierda",
        "inferior_centro",
        "inferior_derecha",
    ]
    extension: int = Field(ge=1, le=60)


class PistaPatron(ContractModel):
    """Color pattern read in the reference photo (``PistaPatronSchema``, ADR-0028 §7)."""

    model_config = ConfigDict(extra="forbid", strict=True)

    referencia_element_id: str = Field(min_length=1, max_length=80)
    modo: Literal[
        "espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero", "zonas"
    ]
    colores: list[str] = Field(min_length=1, max_length=12)
    globos_por_racimo: int | None = Field(default=None, ge=1, le=8)
    pesos: list[int] | None = Field(default=None, max_length=12)
    #: Manchas leídas en la foto (ADR-0036). Este modelo se mantiene A MANO y se
    #: quedó sin `zonas` cuando nació el modo: `extra="forbid"` hacía que una
    #: pista real de zonas rechazara la petición de plan ENTERA con 422, y la app
    #: respondía SERVICIO_NO_DISPONIBLE (2026-09-30). `patron_color` sí sabía
    #: armarla desde el 29: era código inalcanzable porque la puerta de entrada
    #: no la dejaba pasar.
    zonas: list[ZonaLeida] | None = Field(default=None, max_length=8)
    #: Colores salpicados sobre las secciones en vez de ocupar una (las burbujas cristal, los cromados
    #: sueltos). Van aquí por la misma razón que `direccion` y `simetria`: este modelo se mantiene A MANO y
    #: sin el campo `extra="forbid"` rechazaría con 422 la petición de plan entera en cuanto el lector lo
    #: mande.
    motas: list[str] | None = Field(default=None, max_length=4)
    #: Por qué eje recorre el patrón la pieza y si sus dos mitades son iguales
    #: (ADR-0039). Los dos los lee la foto y los dos son opcionales: quien mira
    #: la foto no sabe qué admite la pieza, y ``patron_desde_pista`` descarta lo
    #: que no cabe sin tumbar la lectura. Van aquí, en este modelo que se
    #: mantiene A MANO, porque sin ellos ``extra="forbid"`` rechazaría con 422 la
    #: petición de plan entera en cuanto el lector los mande: es exactamente lo
    #: que pasó el 2026-09-30 con ``zonas``.
    direccion: Literal["longitudinal", "transversal", "diagonal"] | None = None
    simetria: Literal["espejo"] | None = None
    confianza: float = Field(ge=0, le=1)

    @field_validator("referencia_element_id")
    @classmethod
    def normalize_element_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("referencia_element_id must not be blank")
        return value

    @field_validator("colores")
    @classmethod
    def normalize_colors(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 80 for value in normalized):
            raise ValueError("colores must be non-blank strings of at most 80 characters")
        return normalized

    @field_validator("pesos")
    @classmethod
    def validate_weights(cls, values: list[int] | None) -> list[int] | None:
        if values is not None and any(value < 1 or value > 100 for value in values):
            raise ValueError("pesos must be integers between 1 and 100")
        return values


class NivelLeido(ContractModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    unidad: Literal["suelto", "pareja", "trio", "cuarteto", "quinteto", "sexteto"]
    colores: list[str] = Field(min_length=1, max_length=6)
    # Units of the level; absent in readings before bouquet-referencia v2 (worth 1).
    cantidad: int | None = Field(default=None, ge=1, le=MAX_CANTIDAD_NIVEL)
    clase_tamano: Literal["chico", "mediano", "grande", "gigante"] | None = None


class RemateLeido(ContractModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    clase: Literal["metalizado", "burbuja", "latex"]
    color: str | None = Field(default=None, min_length=1, max_length=80)


class NumeroLeido(ContractModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    digito: str = Field(pattern=r"^\d$")
    clase_tamano: Literal["chico", "grande"]


class PistaArmado(ContractModel):
    """Bouquet assembly read in the reference photo (``PistaArmadoSchema``, ADR-0030)."""

    model_config = ConfigDict(extra="forbid", strict=True)

    referencia_element_id: str = Field(min_length=1, max_length=80)
    variante: Literal["base_aire", "helio_apilado", "helio_escalonado"]
    niveles: list[NivelLeido] = Field(max_length=8)
    remate: RemateLeido | None = None
    numeros: list[NumeroLeido] | None = Field(default=None, max_length=3)
    disposicion: Literal["centro", "lados", "arriba", "abajo"] | None = None
    confianza: float = Field(ge=0, le=1)
    # Published by the reading itself (``armado_bouquet.total_leido``). The
    # resolution recounts the levels with that same function; it never trusts
    # a number that travelled through Next.
    total_globos: int | None = Field(default=None, ge=0, le=MAX_TOTAL_LEIDO)
    avisos: list[Annotated[str, Field(min_length=1, max_length=200)]] | None = Field(
        default=None, max_length=12
    )


class PistaTamanos(ContractModel):
    """Los tamaños de globo que la foto leyó en una pieza (``PistaTamanosSchema``).

    Su propia pista y **no un campo de** ``PistaPatron``, por lo mismo que el remate de la columna tiene la
    suya: un tamaño no es una disposición de color. Dentro de la pista de patrón no habría llegado nunca al
    caso que lo motivó —una pieza de un solo color no deja ``patron_color``, así que no deja pista— y los
    tamaños de esa columna dorada eran justo los que había que leer (2026-10-03).

    Este modelo también se mantiene A MANO, con lo que eso implica: un campo que el lector mande y que aquí
    no esté hace que ``extra="forbid"`` rechace la petición de plan ENTERA con 422.
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    referencia_element_id: str = Field(min_length=1, max_length=80)
    tamanos: Literal[
        "casi_todos_gigantes",
        "grandes_con_pocos_chicos",
        "chicos_con_pocos_grandes",
        "un_solo_tamano",
    ]
    confianza: float = Field(ge=0, le=1)


class ListaMaterialesLinea(ContractModel):
    variant_id: str = Field(min_length=1, max_length=160)
    cantidad: int = Field(gt=0, le=100_000)


class ListaMaterialesOperationalRequest(OperationalRequest):
    schema_version: Literal["lista-materiales.v1"]
    materiales: list[ListaMaterialesLinea] = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def validar_contrato_exportado(self) -> "ListaMaterialesOperationalRequest":
        validar_variant_ids_unicos([linea.variant_id for linea in self.materiales])
        ListaMaterialesPayload.model_validate(
            {
                "schema_version": self.schema_version,
                "materiales": [linea.model_dump() for linea in self.materiales],
            }
        )
        return self


def validar_variant_ids_unicos(variant_ids: Sequence[str]) -> None:
    if len(set(variant_ids)) != len(variant_ids):
        raise ValueError("variant_id debe ser único en materiales")


class PlanResolutionRequest(OperationalRequest):
    """Strict request carried inside the operational envelope."""

    schema_version: Literal["plan-resolution.v1"]
    plan: dict[str, object]
    allowlist: list[PlanAllowlistEntry] = Field(max_length=256)
    catalog_snapshot_id: str = Field(min_length=1, max_length=160)
    # ADR-0028 §7: Next asks for patterns once, when the plan is confirmed.
    # Later re-resolutions keep what the plan already declares.
    completar_patrones: bool = Field(default=False, strict=True)
    pistas_patron: list[PistaPatron] = Field(default_factory=list, max_length=16)
    #: Los tamaños leídos. **No** van con ``completar_patrones``: un tamaño no es una disposición de
    #: color, es una propiedad de la pieza, y una columna de un solo color —el caso que los motivó— no
    #: deja patrón ninguno. Misma regla que el remate y la inclinación (ADR-0039): la lectura está o no
    #: está, y sin ella la mezcla es la que el plan declaró.
    pistas_tamanos: list[PistaTamanos] = Field(default_factory=list, max_length=16)
    # ADR-0030: the same one-time completion for bouquet assemblies. After an
    # edit, Next limits it to the edited piece (``completar_armados_de``): a
    # bouquet whose assembly the decorator removed does not get it back.
    completar_armados: bool = Field(default=False, strict=True)
    pistas_armado: list[PistaArmado] = Field(default_factory=list, max_length=16)
    completar_armados_de: list[str] | None = Field(default=None, max_length=8)
    # ADR-0032: the same one-time completion for garlands, behind its own flag
    # (GUIRNALDAS_ARMADO_V1); ``completar_armados_de`` limits it too.
    completar_armados_guirnalda: bool = Field(default=False, strict=True)
    # E4: the garland readings of the photo, one per reference element.
    pistas_guirnalda: list[dict[str, object]] = Field(default_factory=list, max_length=16)

    @field_validator("pistas_guirnalda")
    @classmethod
    def validate_garland_hints(cls, values: list[dict[str, object]]) -> list[dict[str, object]]:
        if any(next(_GARLAND_HINT.iter_errors(value), None) is not None for value in values):
            raise ValueError("pistas_guirnalda must match the garland reading contract")
        return values

    # ADR-0031: the photo's balloon count, once, when the plan is confirmed; after
    # a mix edit, only for the edited piece (``completar_conteos_de``). The shape
    # of each hint is validated against the exported contract.
    completar_conteos: bool = Field(default=False, strict=True)
    pistas_conteo: list[dict[str, object]] = Field(default_factory=list, max_length=16)
    pistas_geometria: list[dict[str, object]] = Field(default_factory=list, max_length=16)
    medidas_cliente_de: list[str] | None = Field(default=None, max_length=16)
    completar_conteos_de: list[str] | None = Field(default=None, max_length=8)
    # Review 33: the customer gave measures (Next's clienteDioMedidasEspacio), so
    # the measures a structure declares are theirs and the count keeps them.
    medidas_del_cliente: bool = Field(default=False, strict=True)

    @field_validator("pistas_conteo")
    @classmethod
    def validate_count_hints(cls, values: list[dict[str, object]]) -> list[dict[str, object]]:
        return cast(list[dict[str, object]], conteo_foto.validar_pistas(values))

    @field_validator("pistas_geometria")
    @classmethod
    def validate_photo_geometry(cls, values: list[dict[str, object]]) -> list[dict[str, object]]:
        for value in values:
            if list(_PHOTO_GEOMETRY_HINT.iter_errors(value)):
                raise ValueError("pistas_geometria debe cumplir el contrato exportado")
        return values

    @field_validator("catalog_snapshot_id")
    @classmethod
    def normalize_snapshot_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("catalog_snapshot_id must not be blank")
        return value

    @model_validator(mode="after")
    def validate_plan_and_allowlist(self) -> "PlanResolutionRequest":
        product_ids = [entry.product_id for entry in self.allowlist]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("allowlist product_id values must be unique")
        try:
            PlanDecoracion.model_validate(self.plan)
        except ValidationError as error:
            raise ValueError("plan must match plan-decoracion.v1") from error
        return self


@dataclass(frozen=True, slots=True)
class Candidate:
    product_id: str
    variant_id: str
    sku: str | None
    sku_original: str | None
    source_snapshot_id: str
    source_variant_id: str | None
    inventory_quantity: int | None
    unidades_inferidas: bool | None
    title: str
    price: int
    units_per_package: int
    size_code: str | None
    shape: str | None
    diameter_inches: float | None
    colors: tuple[str, ...]
    variant_colors: tuple[str, ...]
    finishes: tuple[str, ...]
    image: str | None


def _mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise PlanResolutionError("invalid_plan", 422)
    return value


def _mappings(value: object) -> list[Mapping[str, object]]:
    if not isinstance(value, list):
        raise PlanResolutionError("invalid_plan", 422)
    return [_mapping(item) for item in value]


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value)
        except ValueError:
            return None
    else:
        return None
    return number if isfinite(number) else None


def _integer(value: object) -> int | None:
    number = _number(value)
    return int(number) if number is not None and number.is_integer() else None


def _price(value: object) -> int | None:
    try:
        amount = Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        return None
    return int(amount) if amount > 0 and int(amount) <= MAX_SAFE_INTEGER else None


def _round_half_up(value: float) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _normalize(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFD", value.strip().lower())
        if unicodedata.category(character) != "Mn"
    )


def _json_value(value: object) -> object:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def _strings(value: object) -> tuple[str, ...]:
    value = _json_value(value)
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(
        dict.fromkeys(_normalize(item) for item in value if isinstance(item, str) and item.strip())
    )


def _valid_image(value: object) -> str | None:
    candidate = _text(value)
    if candidate is None:
        return None
    parsed = urlparse(candidate)
    return candidate if parsed.scheme in {"http", "https"} and bool(parsed.netloc) else None


_GREY_TITLE = re.compile(r"\bgris\b")
_SILVER_TITLE = re.compile(r"\b(?:plata|plateado|plateada|silver)\b")
#: Mirror of ``TITULO_VINO`` (``src/lib/plan/colores-producto.ts``); owner: ``app.colores_titulo``.
_WINE_TITLE = WINE_TITLE


def _product_colors(title: str, colors: Sequence[str]) -> tuple[str, ...]:
    """Real colors of a catalog product.

    The derived catalog colors file grey balloons under "plateado" (Fashion
    Gris), but grey is not silver: a product whose title names "gris" and not
    silver has "gris" instead of "plateado" (E2E 2026-09-15, ejemplo-07).

    Wine is not red either: the live catalog files Fashion Merlot and Metal
    Vinotinto as "rojo", so a product whose title names a wine shade has
    "burdeos" instead of "rojo" (CASE-006, 2026-10-05).
    """
    folded_title = _normalize(title)
    crudos = tuple(dict.fromkeys(_normalize(color) for color in colors if _normalize(color)))
    folded = (
        tuple(dict.fromkeys("burdeos" if color == "rojo" else color for color in crudos))
        if _WINE_TITLE.search(folded_title)
        else crudos
    )
    if not _GREY_TITLE.search(folded_title) or _SILVER_TITLE.search(folded_title):
        return folded
    return tuple(dict.fromkeys(("gris", *(color for color in folded if color != "plateado"))))


def _variant_real_colors(
    title: str, variant_colors: Sequence[str], product_colors: Sequence[str]
) -> tuple[str, ...]:
    """Real colors of ONE variant.

    A product's derived colors come from its tags, which are Shopify color
    FAMILIES ("Fashion Violeta" is tagged MORADOS), so merging them with the
    variant's own colors made a one-color balloon look multi-color. The variant's
    colors win when it has any; otherwise the merged set is kept, never an empty
    list (products with no variant colors and several product colors would
    become uncoverable).
    """
    own = tuple(color for color in variant_colors if _normalize(color))
    return _product_colors(title, own if own else (*variant_colors, *product_colors))


def _candidate(row: Mapping[str, object], snapshot_id: str) -> Candidate | None:
    source_snapshot = _text(row.get("source_snapshot_id"))
    product_id = _text(row.get("product_id"))
    variant_id = _text(row.get("variant_id"))
    product_title = _text(row.get("producto_titulo"))
    if (
        source_snapshot != snapshot_id
        or product_id is None
        or variant_id is None
        or product_title is None
        or row.get("disponible") is not True
        or row.get("producto_disponible") is not True
    ):
        return None
    currency = _text(row.get("currency"))
    if currency != "COP":
        return None
    price = _price(row.get("precio"))
    units = _integer(row.get("unidades_paq"))
    if price is None or units is None or units <= 0:
        return None
    variant_title = _text(row.get("variante_titulo"))
    title = f"{product_title} — {variant_title}" if variant_title else product_title
    diameter = _number(row.get("diam_pulg"))
    if diameter is not None and diameter < 0:
        diameter = None
    inventory = _integer(row.get("inventory_quantity"))
    inferred = row.get("unidades_inferidas")
    return Candidate(
        product_id=product_id,
        variant_id=variant_id,
        sku=_text(row.get("sku")),
        sku_original=_text(row.get("sku_original")),
        source_snapshot_id=source_snapshot,
        source_variant_id=_text(row.get("source_variant_id")),
        inventory_quantity=inventory,
        unidades_inferidas=inferred if isinstance(inferred, bool) else None,
        title=title,
        price=price,
        units_per_package=units,
        size_code=_text(row.get("codigo_tamano")),
        shape=_text(row.get("forma")),
        diameter_inches=diameter,
        colors=_product_colors(
            product_title,
            _strings(row.get("colores_variante")) + _strings(row.get("colores_producto")),
        ),
        variant_colors=_variant_real_colors(
            product_title,
            _strings(row.get("colores_variante")),
            _strings(row.get("colores_producto")),
        ),
        finishes=_strings(row.get("acabados_producto")),
        image=_valid_image(row.get("imagen")),
    )


def _normalize_space_source(space: Mapping[str, object]) -> dict[str, object]:
    """A space measured "from the photo" is an estimate.

    The model does not measure photos: ``fuente: "foto"`` only states that the
    type of space was seen in a photo. Any of ``ancho_m``/``alto_m``/``largo_m``
    with that source becomes ``fuente: "supuesto"`` and keeps its numbers.
    """
    normalized = dict(space)
    has_measures = any(normalized.get(key) is not None for key in ("ancho_m", "alto_m", "largo_m"))
    if normalized.get("fuente") == "foto" and has_measures:
        normalized["fuente"] = "supuesto"
    return normalized


_NOMBRE_MEDIDA = {"ancho_m": "ancho", "alto_m": "alto", "largo_m": "largo"}


def _metros_es(valor: float) -> str:
    """Una medida como la lee el cliente: coma decimal y sin ceros de más (2.4 → «2,4»)."""
    return f"{valor:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _supuesto_de_medidas(
    structure: Mapping[str, object],
    structure_type: str,
    measures: Mapping[str, object],
    missing: Sequence[str],
    declared: Mapping[str, object] | None,
) -> str:
    """El supuesto de las medidas que el plan asumió para una pieza: solo las que faltaban.

    Sin ninguna medida, el de siempre («medidas asumidas para arco: 3 m × 2.4 m — no nos diste…»), que Next
    pone en palabras del cliente (``supuestoCliente``). Con alguna medida, dice cuál asumió y de dónde salen
    las otras: «Arco: usé un alto estándar de 2,4 m; el ancho de 3 m es el que pediste.» Hasta el 2026-10-07
    bastaba que faltara una para escribir el de siempre con las dos, y el cliente leía «no me diste el tamaño»
    justo después de pedir «un arco de 3 metros» (S3 del comparador 130). Una medida dada es «la que
    pediste» si es la que el plan declaró (``declared``, las medidas antes de medir la foto; sin él, todas las
    del plan) y «sale de la foto» si la escribió la escala de la foto (``_medir_desde_cajas``).
    """
    given = [
        key
        for key in ("ancho_m", "alto_m", "largo_m")
        if key not in missing and _number(measures.get(key)) is not None
    ]
    if not given:
        values = [
            str(measures[key]) + " m" for key in ("ancho_m", "alto_m", "largo_m") if key in measures
        ]
        return f"medidas asumidas para {structure_type}: {' × '.join(values)} — no nos diste el tamaño del espacio"

    def as_said(keys: Sequence[str]) -> str:
        return " y ".join(
            f"el {_NOMBRE_MEDIDA[key]} de {_metros_es(cast(float, _number(measures.get(key))))} m"
            for key in keys
        )

    def from_plan(key: str) -> bool:
        return declared is None or _number(declared.get(key)) == _number(measures.get(key))

    assumed = " y ".join(
        f"un {_NOMBRE_MEDIDA[key]} estándar de {_metros_es(cast(float, _number(measures.get(key))))} m"
        for key in missing
    )
    parts = [f"usé {assumed}"]
    asked = [key for key in given if from_plan(key)]
    photo = [key for key in given if not from_plan(key)]
    if asked:
        parts.append(f"{as_said(asked)} {'es el que pediste' if len(asked) == 1 else 'son los que pediste'}")
    if photo:
        parts.append(f"{as_said(photo)} {'sale de la foto' if len(photo) == 1 else 'salen de la foto'}")
    name = _text(structure.get("nombre")) or structure_type.replace("_", " ").capitalize()
    return cast(str, supuesto(name, "; ".join(parts) + "."))


def _complete_measures(
    raw_plan: Mapping[str, object],
    *,
    declaradas: Mapping[str, Mapping[str, object]] | None = None,
) -> dict[str, object]:
    """El plan con las medidas por defecto de cada pieza que no las trae, y un supuesto por pieza que lo dice.

    ``declaradas``: las medidas de cada pieza (por ``estructura_id``) tal como el plan las declaró, antes de
    que la foto escribiera las suyas; dicen en el supuesto qué medida pidió el cliente y cuál salió de la foto
    (``_supuesto_de_medidas``). Sin él, toda medida que el plan trae es la que pidió.
    """
    plan = {key: value for key, value in raw_plan.items()}
    space = _normalize_space_source(_mapping(plan.get("espacio")))
    plan["espacio"] = space
    exterior = _EXTERIOR.search(_text(space.get("tipo")) or "") is not None
    raw_assumptions = plan.get("supuestos", [])
    assumptions = (
        [value for value in raw_assumptions if isinstance(value, str)]
        if isinstance(raw_assumptions, list)
        else []
    )
    structures: list[dict[str, object]] = []
    for raw_structure in _mappings(plan.get("estructuras")):
        structure = dict(raw_structure)
        structure_type = _text(structure.get("tipo")) or ""
        defaults = _DEFAULT_MEASURES.get(structure_type, {}).get(
            "exterior" if exterior else "interior", {}
        )
        raw_measures = _mapping(structure.get("medidas"))
        measures = {**defaults, **dict(raw_measures)}
        missing = [key for key in defaults if raw_measures.get(key) is None]
        if missing:
            declared = (
                None
                if declaradas is None
                else declaradas.get(_text(structure.get("estructura_id")) or "", {})
            )
            assumptions.append(
                _supuesto_de_medidas(structure, structure_type, measures, missing, declared)
            )
        structure["medidas"] = measures
        structures.append(structure)
    plan["estructuras"] = structures
    plan["supuestos"] = list(dict.fromkeys(assumptions))
    return plan


def completar_medidas(raw_plan: Mapping[str, object]) -> dict[str, object]:
    """El plan con las medidas por defecto de cada estructura que no trae las suyas.

    Es ``_complete_measures`` publicado para que el armado del motor arme con **las mismas medidas** que el plan
    va a mostrar y a cobrar. Hasta hoy el armado se construía ANTES de que la resolución las completara: una
    pieza sin ``medidas`` se armaba con la plantilla del motor (un semiarco de 3,4 × 2,5 m) mientras el resumen
    decía 1,2 × 2,2 m, y el dibujo salía con la curva de la plantilla y no la de la pieza (CASE-004 de
    images-judge). Las medidas tienen un solo dueño, este módulo.

    Tolera un plan sin ``espacio`` (los llamadores internos del armado pasan planes mínimos): sin tipo de espacio
    se asumen las medidas de interior, que es lo que ``_complete_measures`` hace con un espacio vacío.
    """
    plan = dict(raw_plan)
    if not isinstance(plan.get("espacio"), Mapping):
        plan["espacio"] = {}
    return _complete_measures(plan)


def proporciones_de_mezcla(mezcla: str) -> tuple[tuple[int, float], ...] | None:
    """Qué proporción de cada diámetro pide una mezcla del plan, o ``None`` si no es una de ellas.

    Es la misma tabla con la que este resolutor cuenta y compra (``x-reglas-mezclas``, dueño
    ``src/lib/plan/mezclas.ts``), publicada para que el armado del motor pueda dibujar **los mismos globos
    que se cobran**: hasta hoy las piezas orgánicas se armaban siempre con la mezcla del diseño de partida
    del diseñador, dijera lo que dijera el plan.
    """
    return _MIXES.get(mezcla)


def _medir_desde_cajas(
    raw_plan: Mapping[str, object],
    pistas: Sequence[Mapping[str, object]],
    *,
    medidas_del_cliente: bool,
    medidas_cliente_de: Sequence[str] = (),
    anclados: set[str] | None = None,
) -> tuple[dict[str, object], list[str]]:
    """Deriva medidas con una escala isotrópica por foto aprobada.

    ``anclados`` recoge el ``estructura_id`` de cada pieza cuya caja **sí** se usó: la de una foto con escala,
    que es el ancla o sale de ella. Una caja cortada por un borde, poco confiable o en una foto sin pieza que dé
    escala no ancla ni deriva nada y no entra (``_ids_medidas_fijas_en_conteo``).
    """
    plan = dict(raw_plan)
    if not pistas:
        return plan, []
    por_id = {
        _text(pista.get("referencia_element_id")): pista
        for pista in pistas
        if _text(pista.get("referencia_element_id"))
    }
    piezas: list[tuple[dict[str, object], Mapping[str, object], Mapping[str, object], Mapping[str, object]]] = []
    avisos: list[str] = []
    cortadas: dict[str, dict[str, object]] = {}

    def mapa_opcional(value: object) -> Mapping[str, object]:
        return _mapping(value) if isinstance(value, Mapping) else {}

    def medidas_armado(estructura: Mapping[str, object]) -> dict[str, object]:
        arco = mapa_opcional(estructura.get("armado_arco"))
        geometria = mapa_opcional(arco.get("geometria"))
        if geometria:
            medidas_motor = {"ancho_m": _number(geometria.get("anchoM")), "alto_m": _number(geometria.get("altoM"))}
            return {clave: valor for clave, valor in medidas_motor.items() if valor is not None}
        arco_organico = mapa_opcional(estructura.get("armado_arco_organico"))
        forma_arco = mapa_opcional(arco_organico.get("forma"))
        if forma_arco:
            medidas_motor = {"ancho_m": _number(forma_arco.get("anchoM")), "alto_m": _number(forma_arco.get("altoM"))}
            return {clave: valor for clave, valor in medidas_motor.items() if valor is not None}
        columna_organica = mapa_opcional(estructura.get("armado_columna_organica"))
        forma_columna = mapa_opcional(columna_organica.get("forma"))
        if forma_columna:
            alto_motor = _number(forma_columna.get("altoM"))
            return {} if alto_motor is None else {"alto_m": alto_motor}
        columna = mapa_opcional(estructura.get("armado_columna"))
        cuerpo = mapa_opcional(columna.get("cuerpo"))
        alto_motor = _number(cuerpo.get("alto_m"))
        return {} if alto_motor is None else {"alto_m": alto_motor}

    def sincronizar_armados(
        estructura: dict[str, object],
        alto: float,
        ancho: float | None,
        id_estructura: str,
        grosor_base_m: float | None = None,
        dimensiones_cliente: Mapping[str, float] | None = None,
    ) -> None:
        organica = estructura.get("armado_columna_organica")
        if isinstance(organica, Mapping):
            armado = dict(organica)
            forma = dict(mapa_opcional(armado.get("forma")))
            volumen = dict(mapa_opcional(armado.get("volumen")))
            base_original = _number(volumen.get("grosorPatasM")) or 0.6
            base = grosor_base_m if grosor_base_m is not None else base_original
            punta = _number(volumen.get("grosorCimaM")) or 0.45
            if grosor_base_m is not None:
                punta *= base / base_original
            base_tope = min(1.6, math.floor(alto / 0.85 * 20 + 1e-9) / 20)
            base_ajustada = (
                dimensiones_cliente["ancho_m"]
                if dimensiones_cliente and "ancho_m" in dimensiones_cliente
                else min(base_tope, max(0.35, base))
            )
            punta_minima = max(0.35, math.ceil(base_ajustada * 0.35 * 20 - 1e-9) / 20)
            punta_tope = min(
                1.6,
                math.floor(base_ajustada * 1.6 * 20 + 1e-9) / 20,
                math.floor(alto / 0.85 * 20 + 1e-9) / 20,
            )
            punta_ajustada = min(punta_tope, max(punta_minima, punta))
            if base_ajustada != base or punta_ajustada != punta:
                avisos.append(f"Ajusté grosor del armado de {id_estructura} para respetar límites de altura.")
            forma["altoM"] = round(
                dimensiones_cliente.get("alto_m", alto) if dimensiones_cliente else alto, 2
            )
            volumen["grosorPatasM"] = round(base_ajustada, 2)
            volumen["grosorCimaM"] = round(punta_ajustada, 2)
            armado["forma"] = forma
            armado["volumen"] = volumen
            estructura["armado_columna_organica"] = armado
            if grosor_base_m is None:
                avisos.append(f"Conservé el grosor de {id_estructura}: la caja puede incluir su inclinación.")
            else:
                avisos.append(f"Derivé el grosor de {id_estructura} de la proporción de su caja de foto.")
        armado_arco_organico = estructura.get("armado_arco_organico")
        if isinstance(armado_arco_organico, Mapping) and isinstance(armado_arco_organico.get("forma"), Mapping):
            armado = dict(armado_arco_organico)
            forma = dict(mapa_opcional(armado.get("forma")))
            forma["altoM"] = round(alto, 2)
            if ancho is not None:
                forma["anchoM"] = round(ancho, 2)
            armado["forma"] = forma
            estructura["armado_arco_organico"] = armado
        armado_arco = estructura.get("armado_arco")
        if isinstance(armado_arco, Mapping) and isinstance(armado_arco.get("geometria"), Mapping):
            armado = dict(armado_arco)
            geometria = dict(mapa_opcional(armado.get("geometria")))
            geometria["altoM"] = round(alto, 2)
            if ancho is not None:
                geometria["anchoM"] = round(ancho, 2)
            armado["geometria"] = geometria
            estructura["armado_arco"] = armado
        armado_columna = estructura.get("armado_columna")
        if isinstance(armado_columna, Mapping) and isinstance(armado_columna.get("cuerpo"), Mapping):
            armado = dict(armado_columna)
            cuerpo = dict(mapa_opcional(armado.get("cuerpo")))
            cuerpo["alto_m"] = round(alto, 2)
            armado["cuerpo"] = cuerpo
            estructura["armado_columna"] = armado

    medidas_cliente = set(medidas_cliente_de)
    tipos_geometricos_oficiales = {
        "arco_asimetrico": "arco",
        "arco_no_denso": "arco",
        "semiarco_asimetrico": "semiarco",
        "columna_asimetrica": "columna",
        "columna_no_densa": "columna",
        "pared_densa": "pared",
        "pared_no_densa": "pared",
        "pared_organica": "pared",
    }
    for original in _mappings(plan.get("estructuras")):
        estructura = dict(original)
        referencia = _text(estructura.get("referencia_element_id"))
        pista = por_id.get(referencia or "")
        tipo_original = _text(estructura.get("tipo")) or ""
        oficial = _text(estructura.get("estructura_oficial")) or ""
        tipo = tipos_geometricos_oficiales.get(
            oficial, tipos_geometricos_oficiales.get(tipo_original, tipo_original)
        )
        if tipo not in {"semiarco", "arco", "arco_organico", "columna", "columna_organica", "pared"}:
            continue
        caja = _mapping(pista.get("caja")) if pista else {}
        ancho = _number(caja.get("width")) or 0.0
        alto = _number(caja.get("height")) or 0.0
        x = _number(caja.get("x")) or 0.0
        y = _number(caja.get("y")) or 0.0
        confianza = _number(pista.get("confianza")) if pista else None
        if pista is None:
            continue
        bordes = []
        if y <= 0.01:
            bordes.append("superior")
        if y + alto >= 0.99:
            bordes.append("inferior")
        if x <= 0.01:
            bordes.append("izquierdo")
        if x + ancho >= 0.99:
            bordes.append("derecho")
        if bordes:
            avisos.append(f"La caja de {referencia} está cortada por el borde {' y '.join(bordes)}; no ancla ni deriva esa pieza.")
            medidas_entregadas = dict(_mapping(estructura.get("medidas")))
            medidas = dict(medidas_entregadas)
            conservar_cliente = _text(estructura.get("estructura_id")) in medidas_cliente
            for clave, valor in medidas_armado(estructura).items():
                if not conservar_cliente or _number(medidas.get(clave)) is None:
                    medidas[clave] = valor
            if medidas:
                estructura["medidas"] = medidas
                alto_motor = _number(medidas.get("alto_m"))
                if conservar_cliente and alto_motor is not None:
                    sincronizar_armados(
                        estructura,
                        alto_motor,
                        _number(medidas.get("ancho_m")),
                        _text(estructura.get("estructura_id")) or "pieza",
                        dimensiones_cliente={
                            clave: valor
                            for clave in ("ancho_m", "alto_m")
                            if (valor := _number(medidas_entregadas.get(clave))) is not None
                        },
                    )
                id_cortada = _text(estructura.get("estructura_id"))
                if id_cortada:
                    cortadas[id_cortada] = estructura
            continue
        if confianza is None or confianza < 0.5 or ancho < 0.025 or alto < 0.05:
            avisos.append(
                f"No pude medir {referencia} con su caja de foto (confianza baja o caja pequeña); conservé medidas supuestas."
            )
            continue
        piezas.append((estructura, caja, _mapping(estructura.get("medidas")), pista))
        aspecto_foto = _number(pista.get("aspect_ratio"))
        if aspecto_foto is None or aspecto_foto <= 0:
            avisos.append(
                f"No pude leer la proporción de la foto para {referencia}; conservé medidas del motor y no usé su caja como ancla."
            )

    if not piezas:
        if cortadas:
            plan["estructuras"] = [
                cortadas.get(_text(estructura.get("estructura_id")) or "", estructura)
                for estructura in _mappings(plan.get("estructuras"))
            ]
        return plan, avisos

    def puntuacion_ancla(pieza: tuple[dict[str, object], Mapping[str, object], Mapping[str, object], Mapping[str, object]]) -> tuple[float, float, str]:
        estructura, caja, medidas, pista = pieza
        alto_declarado = _number(medidas.get("alto_m"))
        ancho_declarado = _number(medidas.get("ancho_m"))
        aspecto_foto = _number(pista.get("aspect_ratio")) or 1.0
        alto_caja = _number(caja.get("height")) or 1.0
        ancho_caja = _number(caja.get("width")) or 1.0
        error = 1.0
        if alto_declarado and ancho_declarado:
            aspecto_fisico = ancho_declarado / alto_declarado
            aspecto_caja = ancho_caja * aspecto_foto / alto_caja
            error = abs(math.log(max(0.01, aspecto_fisico) / max(0.01, aspecto_caja)))
        confianza = _number(pista.get("confianza")) or 0.0
        return error, -confianza, _text(estructura.get("estructura_id")) or ""

    por_foto: dict[str, list[tuple[dict[str, object], Mapping[str, object], Mapping[str, object], Mapping[str, object]]]] = {}
    for pieza in piezas:
        source_image_id = _text(pieza[3].get("source_image_id")) or ""
        por_foto.setdefault(source_image_id, []).append(pieza)
    escalas: dict[str, float] = {}
    avisos_escala: list[str] = []
    for source_image_id, piezas_foto in por_foto.items():
        con_medida = [
            pieza
            for pieza in piezas_foto
            if (_number(pieza[2].get("alto_m")) or _number(pieza[2].get("ancho_m")))
            and (_number(pieza[3].get("aspect_ratio")) or 0.0) > 0
        ]
        cliente = [pieza for pieza in con_medida if _text(pieza[0].get("estructura_id")) in medidas_cliente]
        # La columna suele traer una altura estándar de motor, pero no sirve como
        # referencia de escala: el tamaño real de esa misma pieza es lo que buscamos.
        # Priorizar medida explícita; después, semiarco/arco con medida estándar; por
        # último, otras piezas no columna. Nunca inventar escala desde una columna sola.
        semiarcos = [pieza for pieza in con_medida if _text(pieza[0].get("tipo")) == "semiarco"]
        arcos = [
            pieza
            for pieza in con_medida
            if _text(pieza[0].get("tipo")) in {"arco", "arco_organico"}
        ]
        otras_piezas = [
            pieza
            for pieza in con_medida
            if _text(pieza[0].get("tipo")) not in {"columna", "columna_organica"}
        ]
        candidatas = cliente or semiarcos or arcos or otras_piezas
        if candidatas:
            ancla = min(candidatas, key=puntuacion_ancla)
            alto_m = _number(ancla[2].get("alto_m"))
            ancho_m = _number(ancla[2].get("ancho_m"))
            alto_caja = _number(ancla[1].get("height")) or 1.0
            ancho_img = (_number(ancla[1].get("width")) or 1.0) * (_number(ancla[3].get("aspect_ratio")) or 1.0)
            # Una dimensión física fija ambas direcciones; si hay dos, el alto define
            # la escala y la dimensión transversal declarada se conserva solo en el ancla.
            escala = alto_m / alto_caja if alto_m is not None else (ancho_m or 2.2) / ancho_img
            escalas[source_image_id] = escala
            avisos_escala.append(f"Escala de la foto {source_image_id} anclada en {ancla[0].get('estructura_id')}.")
        else:
            avisos_escala.append(
                f"No hay pieza de referencia fiable para escalar la foto {source_image_id}; conservé las medidas del motor."
            )
    asumidos: list[str] = []

    nuevas_estructuras: list[dict[str, object]] = []
    for estructura_original in _mappings(plan.get("estructuras")):
        estructura = dict(estructura_original)
        referencia = _text(estructura.get("referencia_element_id"))
        pieza = next((item for item in piezas if _text(item[0].get("estructura_id")) == _text(estructura.get("estructura_id"))), None)
        if pieza is None:
            nuevas_estructuras.append(cortadas.get(_text(estructura.get("estructura_id")) or "", estructura))
            continue
        _, caja, medidas_originales, pista = pieza
        id_estructura = _text(estructura.get("estructura_id")) or referencia or "pieza"
        source_image_id = _text(pista.get("source_image_id")) or ""
        if source_image_id not in escalas:
            nuevas_estructuras.append(estructura)
            continue
        anclado = _text(estructura.get("estructura_id"))
        if anclados is not None and anclado:
            anclados.add(anclado)
        ancho_caja = _number(caja.get("width")) or 0.0
        alto_caja = _number(caja.get("height")) or 0.0
        aspecto_foto = _number(pista.get("aspect_ratio"))
        alto_estimado = alto_caja * escalas[source_image_id]
        ancho_estimado = (
            ancho_caja * aspecto_foto * escalas[source_image_id]
            if aspecto_foto is not None and aspecto_foto > 0
            else None
        )
        medidas = dict(medidas_originales)
        anterior_alto = _number(medidas.get("alto_m"))
        anterior_ancho = _number(medidas.get("ancho_m"))
        tipo_original = _text(estructura.get("tipo")) or ""
        oficial = _text(estructura.get("estructura_oficial")) or ""
        tipo = tipos_geometricos_oficiales.get(
            oficial, tipos_geometricos_oficiales.get(tipo_original, tipo_original)
        )
        id_estructura = _text(estructura.get("estructura_id")) or ""
        conservar_cliente = id_estructura in medidas_cliente
        es_columna_organica = tipo == "columna_organica" or isinstance(estructura.get("armado_columna_organica"), Mapping)
        alto_sin_tope = anterior_alto if conservar_cliente and anterior_alto is not None else alto_estimado
        limites_tipo = {
            "arco": (0.8, 6.0, 0.8, 10.0),
            "arco_organico": (1.0, 6.0, 1.5, 10.0),
            "semiarco": (1.0, 6.0, 1.5, 10.0),
            "columna": (0.8, 4.5, 0.3, 8.0),
            "columna_organica": (0.8, 4.5, 0.3, 8.0),
            "pared": (0.5, 4.5, 0.3, 8.0),
        }
        alto_minimo, alto_maximo, ancho_minimo, ancho_maximo = limites_tipo.get(tipo, (0.5, 4.5, 0.3, 8.0))
        alto_final = min(alto_maximo, max(alto_minimo, alto_sin_tope))
        dimensiones_ancho = tipo in {"arco", "semiarco", "arco_organico", "columna", "pared"} and not es_columna_organica
        ancho_sin_tope = anterior_ancho if conservar_cliente and anterior_ancho is not None else (ancho_estimado if ancho_estimado is not None else anterior_ancho)
        ancho_final = min(ancho_maximo, max(ancho_minimo, ancho_sin_tope)) if ancho_sin_tope is not None else None
        if dimensiones_ancho and ancho_final is not None and ancho_final != ancho_sin_tope:
            avisos.append(f"El ancho derivado de {id_estructura} ({ancho_sin_tope:.2f} m) excedía límites; ajusté a {ancho_final:.2f} m.")
        if tipo in {"semiarco", "arco_organico"}:
            armado_arco_org = mapa_opcional(estructura.get("armado_arco_organico"))
            volumen_arco_org = mapa_opcional(armado_arco_org.get("volumen"))
            grosor_cima = _number(volumen_arco_org.get("grosorCimaM")) or 0.45
            alto_minimo_org = max(
                1.0,
                math.ceil(0.4 * (ancho_final or 0.0) * 10 - 1e-9) / 10,
                math.ceil((grosor_cima / 2 + 0.7) * 10 - 1e-9) / 10,
            )
            alto_maximo_org = max(alto_minimo_org, math.floor(min(6.0, 1.8 * (ancho_final or 0.0)) * 10 + 1e-9) / 10)
            alto_final = min(alto_maximo_org, max(alto_minimo_org, alto_sin_tope))
        if alto_final != alto_sin_tope:
            avisos.append(f"La altura derivada de {id_estructura} ({alto_sin_tope:.2f} m) excedía límites; ajusté a {alto_final:.2f} m.")
        medidas["alto_m"] = round(alto_final, 2)
        if dimensiones_ancho and ancho_final is not None:
            medidas["ancho_m"] = round(ancho_final, 2)
        elif es_columna_organica and not conservar_cliente:
            medidas.pop("ancho_m", None)
        estructura["medidas"] = medidas

        if es_columna_organica and not isinstance(estructura.get("armado_columna_organica"), Mapping):
            avisos.append(f"Grosor de {id_estructura} queda al motor: la caja puede incluir su inclinación.")
        grosor_base = (
            anterior_ancho if conservar_cliente and anterior_ancho is not None else ancho_estimado
        ) if es_columna_organica else None
        if aspecto_foto is None or aspecto_foto <= 0:
            avisos.append(f"Conservé las dimensiones de {id_estructura}: falta proporción fiable de la foto.")
        sincronizar_armados(
            estructura,
            alto_final,
            ancho_final if dimensiones_ancho else None,
            id_estructura,
            grosor_base_m=grosor_base,
            dimensiones_cliente={
                clave: valor
                for clave in ("ancho_m", "alto_m")
                if conservar_cliente and (valor := _number(medidas_originales.get(clave))) is not None
            },
        )

        cambio = (
            anterior_alto is not None and abs(anterior_alto - alto_final) >= 0.05
        ) or (dimensiones_ancho and anterior_ancho is not None and abs(anterior_ancho - ancho_final) >= 0.05)
        if cambio:
            antes = f"{anterior_ancho:g} × {anterior_alto:g} m" if anterior_ancho is not None and anterior_alto is not None else f"alto {anterior_alto:g} m" if anterior_alto is not None else "sin ancho"
            despues = f"{medidas.get('ancho_m', '—')} × {medidas['alto_m']} m"
            asumidos.append(f"Medidas de {id_estructura} ajustadas de {antes} a {despues} según proporción de la foto.")
        nuevas_estructuras.append(estructura)

    plan["estructuras"] = nuevas_estructuras
    plan["supuestos"] = list(dict.fromkeys([*_strings(plan.get("supuestos")), *avisos_escala, *avisos, *asumidos]))
    return plan, avisos


def _complete_plan(
    raw_plan: Mapping[str, object],
    *,
    completar_patrones: bool = False,
    pistas: Sequence[Mapping[str, object]] = (),
    tamanos: Sequence[Mapping[str, object]] = (),
    pistas_geometria: Sequence[Mapping[str, object]] = (),
    medidas_del_cliente: bool = False,
    medidas_cliente_de: Sequence[str] = (),
    avisos: list[str] | None = None,
) -> dict[str, object]:
    """Fill default measures and make every color pattern authoritative.

    With ``completar_patrones`` a geometric structure without ``patron_color``
    gets the pattern of its photo hint, or else its preset (ADR-0028 §7),
    unless its motor counts it (``_suggested_pattern``). Then every structure
    with a pattern whose count is the grid's gets ``participacion`` rewritten
    from its grid, so the echoed plan says what is built and resolving the
    result again is a fixed point. A plan without patterns is returned exactly
    as before, which keeps its ``plan_hash``.

    ``avisos`` collects what completing the patterns could not do as asked (a
    preset that fell back to no pattern, a photo color left out of its
    pattern), as ``advertencias`` entries: they describe this resolution, not
    the plan, so they never enter it nor its hash.
    """
    plan, avisos_geometria = _medir_desde_cajas(
        raw_plan,
        pistas_geometria,
        medidas_del_cliente=medidas_del_cliente,
        medidas_cliente_de=medidas_cliente_de,
    )
    if avisos is not None:
        avisos.extend(avisos_geometria)
    declaradas = {
        _text(estructura.get("estructura_id")) or "": (
            medidas if isinstance(medidas := estructura.get("medidas"), Mapping) else {}
        )
        for estructura in _mappings(raw_plan.get("estructuras"))
    }
    antes = {s for s in cast(list[object], plan.get("supuestos") or []) if isinstance(s, str)}
    plan = _complete_measures(plan, declaradas=declaradas)
    asumidas = [s for s in cast(list[str], plan["supuestos"]) if s not in antes]
    if asumidas:
        _decidir(
            "regla:medidas_por_defecto",
            "qué medidas de cada pieza se asumen porque el plan no las trae",
            asumidas,
            "_DEFAULT_MEASURES: solo las que faltan; las que el plan trae son las que pidió el cliente y las"
            " que escribió la escala de la foto salen de ella",
            entrada={"medidas_declaradas": declaradas},
        )
    # Los tamaños no esperan a ``completar_patrones``: no son una disposición de color (ver
    # ``pistas_tamanos``). Siguen yendo ANTES de ``_assign_patterns`` porque la rejilla de un patrón se
    # dimensiona desde la mezcla.
    _assign_mixes(plan, tamanos)
    if completar_patrones:
        _assign_patterns(plan, pistas, avisos)
    return _sync_participations(plan, plan)


def _pattern_error(structure_id: str, error: PatronColorInvalido) -> PlanResolutionError:
    return PlanResolutionError(
        "patron_invalido",
        422,
        {"estructura_id": structure_id, "motivo": error.motivo, "mensaje": error.mensaje},
    )


def _pattern_context(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> EstructuraPatron:
    """What ``patron_color`` needs from one structure of a completed plan."""
    tipo = _text(structure.get("tipo")) or ""
    total, single_size = 0, False
    if conteo_foto.es_geometrica(structure):
        _axis, total, proportions, _unplaced = _structure_count(plan, structure)
        single_size = len(proportions) == 1
    measures = _mapping(structure.get("medidas"))
    # A garland built by clusters (ADR-0032, E5): the pattern reads the unit and
    # the shape of its assembly (preset by cluster, mirror in an inverted U).
    cluster, shape = racimo_y_forma_de_armado(
        structure.get("armado_guirnalda") if _is_garland(structure) else None
    )
    return EstructuraPatron(
        estructura_id=_text(structure.get("estructura_id")) or "",
        tipo=tipo,
        total=total,
        un_tamano=single_size,
        ancho_m=_number(measures.get("ancho_m")),
        alto_m=_number(measures.get("alto_m")),
        repeticiones=max(1, _integer(structure.get("repeticiones")) or 1),
        materiales=tuple(
            MaterialPatron(
                color=_text(material.get("color")),
                acabado=_text(material.get("acabado")),
                participacion=_number(material.get("participacion")) or 0.0,
            )
            for material in _mappings(structure.get("materiales"))
        ),
        racimo_armado=cluster,
        forma_armado=shape,
    )


@dataclass(frozen=True, slots=True)
class _BoughtLine:
    """What one demand of a patterned material bought (ADR-0028 §9).

    ``replaced`` says the line comes from ``variant_overrides``; ``color`` and
    ``finish`` are the resolved line's, i.e. what is actually bought.
    """

    replaced: bool
    color: str | None
    finish: str | None


#: What each material index of a structure buys, as ``_named_by_purchase``
#: reads it: from resolution (``_resolve_structures``) or read back from the
#: structure's resolved lines by the catalog-less preview
#: (``compras_de_estructura``).
ComprasPorMaterial = Mapping[int, Sequence[_BoughtLine]]


def _named_by_purchase(
    context: EstructuraPatron, bought: ComprasPorMaterial
) -> tuple[EstructuraPatron, list[str]]:
    """The pattern's materials named by what their lines buy, and its notices.

    A replacement (``reemplazar``) lives in ``variant_overrides``: it changes
    what a line buys, not ``materiales``. The pattern points at material
    indices, so its count, texts and prompts must name the color that is
    bought: a material whose lines all come from a replacement and say one
    color takes that color and the lines' finish. When only part of it was
    replaced with another color (one size of a mix of several), one number of
    the chart would be two colors: the material keeps its declared name and
    the pattern says so. A material without replaced lines is left as it is,
    so a plan without replacements names exactly what it declares.
    """
    materials = list(context.materiales)
    notices: list[str] = []
    for index, material in enumerate(context.materiales):
        lines = bought.get(index, ())
        if not any(line.replaced for line in lines):
            continue
        colors = {_normalize(line.color or "") for line in lines}
        if all(line.replaced for line in lines) and len(colors) == 1:
            finishes = {line.finish for line in lines}
            materials[index] = replace(
                material,
                color=lines[0].color,
                acabado=next(iter(finishes)) if len(finishes) == 1 else None,
            )
            continue
        declared = _normalize(material.color or "")
        others = list(
            dict.fromkeys(
                line.color or "otro color"
                for line in lines
                if line.replaced and _normalize(line.color or "") != declared
            )
        )
        if not others:
            continue
        name = f"{material.color} ({index + 1})" if material.color else f"n.º {index + 1}"
        other = " y ".join(others)
        same_name = "la gráfica, el conteo y los textos lo siguen nombrando como antes"
        if all(line.replaced for line in lines):
            # Every size was replaced, but not with one color.
            notices.append(
                f"El color {name} se cambió por {other} según el tamaño: {same_name}. Usa un"
                " solo color en todos sus tamaños para que la gráfica lo muestre."
            )
        else:
            notices.append(
                f"Solo una parte del color {name} se cambió por {other}: {same_name}. Cambia"
                f" también sus otros tamaños para que todo ese color sea {other}."
            )
    return replace(context, materiales=tuple(materials)), notices


def _replaced_line(
    line: Mapping[str, object],
    material: Mapping[str, object],
    overrides: Sequence[Mapping[str, object]],
) -> bool | None:
    """Whether a resolved line of ``material`` was bought by a replacement (§9).

    Resolution knows it: the override whose target it had chosen. Read back
    from the line, it is a line that one of the structure's
    ``variant_overrides`` buys (its product, and its variant or, when the
    plan-wide choice of packages bought it in another presentation, its
    color) and that is not what its own material asks for (the declared
    variant, or the declared product in the declared color). A replacement
    that happens to buy what another material of the piece buys therefore
    does not rename that material.

    ``None`` when the line cannot tell: a line of the material's own product
    in another color than the declared one, which an override also buys, is
    either the material's own purchase that ``_line_color`` relabelled (the
    declared color only matched a family color of the product, and the
    variant's only real color is the line's) or a replacement by that same
    product. Only the catalog knows which; the caller does not guess.
    """
    product = _text(line.get("product_id"))
    variant = _text(line.get("variant_id"))
    color = _normalize(_text(line.get("color")) or "")
    if variant is not None and variant == _text(material.get("variant_id")):
        return False
    own_product = product == _text(material.get("product_id"))
    if own_product and color == _normalize(_text(material.get("color")) or ""):
        return False
    for override in overrides:
        if _text(override.get("product_id")) != product:
            continue
        override_color = _text(override.get("color"))
        if _text(override.get("variant_id")) == variant or (
            override_color is not None and _normalize(override_color) == color
        ):
            return None if own_product else True
    return False


def _purchase_key(line: Mapping[str, object]) -> tuple[str | None, str, float | None]:
    """Product, color and size: what the plan-wide choice of packages keeps."""
    return (
        _text(line.get("product_id")),
        _normalize(_text(line.get("color")) or ""),
        _number(line.get("diam_pulg")),
    )


def _read_back_purchases(
    structure: Mapping[str, object],
    demands: Sequence[Mapping[str, object]],
    lines: Sequence[Mapping[str, object]],
) -> dict[int, list[_BoughtLine]]:
    """``demands`` matched in order with the structure's resolved ``lines``.

    Resolution writes one line per covered demand, in demand order; the
    plan-wide choice of packages (``_reoptimize_presentations``) may then split
    it into consecutive lines of the same product, color and size that add up
    to its units. Each demand therefore takes the consecutive lines whose
    units add up to its own. Empty — nothing read back — when they do not
    correspond: lines of another resolution, an uncovered demand, a line left
    over. A material with a line that ``_replaced_line`` cannot tell is left
    out: it is named as declared, without notices, instead of guessing; the
    other materials are still named by what their lines buy.
    """
    materials = _mappings(structure.get("materiales"))
    overrides = _mappings(structure.get("variant_overrides") or [])
    bought: dict[int, list[_BoughtLine]] = {}
    undecided: set[int] = set()
    runs = _runs_by_demand(demands, lines)
    if runs is None:
        return {}
    for demand, run in zip(demands, runs, strict=True):
        index = _integer(demand.get("material_index")) or 0
        for line in run:
            replaced = _replaced_line(line, materials[index], overrides)
            if replaced is None:
                undecided.add(index)
            bought.setdefault(index, []).append(
                _BoughtLine(
                    replaced=bool(replaced),
                    color=_text(line.get("color")),
                    finish=_text(line.get("acabado")),
                )
            )
    return {index: items for index, items in bought.items() if index not in undecided}


def _runs_by_demand(
    demands: Sequence[Mapping[str, object]], lines: Sequence[Mapping[str, object]]
) -> list[list[Mapping[str, object]]] | None:
    """The consecutive resolved lines that bought each demand, in demand order.

    ``None`` when they do not correspond (see ``_read_back_purchases``): a run
    that does not add up to its demand, mixes products, colors or sizes, buys
    a size that is not an admissible substitute, or a line left over.
    """
    runs: list[list[Mapping[str, object]]] = []
    position = 0
    for demand in demands:
        wanted = _integer(demand.get("cantidad")) or 0
        run: list[Mapping[str, object]] = []
        units = 0
        while units < wanted and position < len(lines):
            run.append(lines[position])
            units += _integer(lines[position].get("unidades")) or 0
            position += 1
        if units != wanted or len({_purchase_key(line) for line in run}) != 1:
            return None
        delivered = _number(run[0].get("diam_pulg"))
        requested = _number(demand.get("pulgadas"))
        if (
            delivered is not None
            and requested is not None
            and not _admissible_substitution(requested, delivered)
        ):
            return None
        runs.append(run)
    if position != len(lines):
        return None
    return runs


def _expand_pattern(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> tuple[EstructuraPatron, Expansion]:
    context = _pattern_context(plan, structure)
    try:
        return context, validar_y_expandir(context, _mapping(structure.get("patron_color")))
    except PatronColorInvalido as error:
        raise _pattern_error(context.estructura_id, error) from error


#: ``sugerir_patron`` rejections that mean the structure takes no pattern at all,
#: not that its pattern did not fit: nothing fell back, so nothing is reported.
_NO_PATTERN_REASONS = frozenset({"tipo_sin_patron", "un_solo_material"})


def _suggested_pattern(
    plan: Mapping[str, object],
    structure: Mapping[str, object],
    pistas: Sequence[Mapping[str, object]],
    avisos: list[str] | None = None,
) -> dict[str, object] | None:
    """Photo hint first, preset otherwise (ADR-0028 §7), for one structure of a completed plan.

    ``None`` when the structure admits no pattern: not geometric, a single
    color, or a grid too small for the preset (it keeps today's organic
    distribution), and when its motor counts it (``_armado_del_motor``: it
    carries its stored assembly). A motor piece is bought as its motor places
    it, so a grid on it was a second count that nobody builds: a classic arch
    with its assembly, declared 70/20/10, bought 30/29/29, echoed
    0.5/0.25/0.25 and charted 44/22/22. Its photo hint reaches the motor
    through its assembly (``patron_de_la_foto``), not through ``patron_color``.
    A classic arch or an organic garland without an assembly is counted by
    the formula, so it gets its preset as always.

    ``avisos`` gets the ``advertencias`` entries of what did not go as asked: a
    photo color its pattern was built without (``pista_patron_incompleta``), or
    a preset that did not fit, so the piece goes without a pattern
    (``patron_sin_aplicar``); that fallback used to be silent.
    """
    if _armado_del_motor(structure) is not None:
        return None
    context = _pattern_context(plan, structure)
    element_id = _text(structure.get("referencia_element_id"))
    hint = next(
        (
            pista
            for pista in pistas
            if element_id is not None
            and pista.get("referencia_element_id") == element_id
            and (_number(pista.get("confianza")) or 0.0) >= CONFIANZA_MINIMA_PISTA
        ),
        None,
    )
    name = _text(structure.get("nombre")) or context.estructura_id
    notes: list[str] = []
    pattern = patron_desde_pista(context, hint, notes) if hint is not None else None
    if pattern is not None:
        if avisos is not None:
            avisos.extend(
                f"pista_patron_incompleta:{context.estructura_id}: {name}: {note}" for note in notes
            )
        return cast(dict[str, object], pattern)
    try:
        return cast(dict[str, object], sugerir_patron(context))
    except PatronColorInvalido as error:
        if avisos is not None and error.motivo not in _NO_PATTERN_REASONS:
            avisos.append(
                f"patron_sin_aplicar:{context.estructura_id}: {name}: el patrón de color sugerido"
                " no cabe en la pieza, así que va sin patrón y sus colores se reparten como los"
                f" declara el plan. {error.mensaje}"
            )
        return None


def _assign_mixes(plan: dict[str, object], tamanos: Sequence[Mapping[str, object]]) -> None:
    """La mezcla que leyó la foto, cuando la leyó; en sitio, sobre un plan completado.

    Va **antes** de ``_assign_patterns`` porque la rejilla de un patrón se dimensiona desde la mezcla
    (``_pattern_context`` cuenta la pieza, y contarla usa sus proporciones): asignarla después dejaría el
    patrón armado sobre los tamaños viejos.

    Al contrario que ``_assign_patterns``, esta sí **pisa** lo que venía declarado, y queda dicho en un
    supuesto. La mezcla la elige la IA que arma el plan desde la descripción de la pieza, sin mirar la foto:
    no es una decisión del decorador, es una suposición sobre una foto que otro sí vio. Cuando la foto lo
    dice, manda la foto; cuando no dice nada (``tamanos`` es opcional), no se toca nada.
    """
    assumptions = list(_strings(plan.get("supuestos")))
    # Cuántos había al entrar: sin esto, un plan que no cambia ninguna mezcla salía igualmente con sus
    # supuestos reescritos (normalizados y sin repetidos) y su `plan_hash` se movía, así que volver a
    # resolver un plan ya firmado dejaba de ser punto fijo. Antes no se notaba porque esta función solo
    # corría detrás de `completar_patrones`, que es la primera resolución y nunca la segunda.
    traia = len(assumptions)
    for structure in cast(list[dict[str, object]], plan["estructuras"]):
        if not conteo_foto.es_geometrica(structure) and _text(structure.get("estructura_oficial")) != "racimo_pared":
            continue
        element_id = _text(structure.get("referencia_element_id"))
        hint = next(
            (
                pista
                for pista in tamanos
                if element_id is not None and pista.get("referencia_element_id") == element_id
            ),
            None,
        )
        avisos: list[str] = []
        leida = mezcla_del_motor(hint, avisos)
        declarada = _text(structure.get("mezcla"))
        if leida is None or leida not in _MIXES or leida == declarada:
            continue
        structure["mezcla"] = leida
        agregar_supuesto(
            assumptions,
            supuesto(
                _text(structure.get("nombre")) or "Estructura",
                f"los tamaños de la foto piden la mezcla {leida}, no {declarada or 'la de por defecto'}.",
            ),
        )
    if len(assumptions) > traia:
        plan["supuestos"] = list(dict.fromkeys(assumptions))


def _assign_patterns(
    plan: dict[str, object],
    pistas: Sequence[Mapping[str, object]],
    avisos: list[str] | None = None,
) -> None:
    """Photo hint first, preset otherwise (ADR-0028 §7); in place on a completed plan.

    A piece its motor counts gets none (``_suggested_pattern``); ``avisos``
    collects what fell back.
    """
    for structure in cast(list[dict[str, object]], plan["estructuras"]):
        if structure.get("patron_color") is not None:
            continue
        pattern = _suggested_pattern(plan, structure, pistas, avisos)
        if pattern is not None:
            structure["patron_color"] = pattern


def _sync_participations(
    measured: Mapping[str, object], target: Mapping[str, object], *, only: int | None = None
) -> dict[str, object]:
    """``target`` with ``participacion`` rewritten from each pattern's grid (§5).

    ``measured`` is the same plan with its measures completed, which is what
    the grid is sized from; ``target`` may be that plan or the caller's own.
    With ``only``, just the structure at that position: a grid depends on its
    own structure and the plan's mandatory sizes, never on another structure,
    so an edit or a preview of one piece does not expand the other patterns.

    A piece its motor counts (``_armado_del_motor``) keeps the ``participacion``
    it declares: what it buys is the motor's count, not the grid's, so writing
    the grid's shares made the echoed plan state a third split that neither
    the purchase nor the chart had. Its pattern is still expanded, so one that
    breaks a rule is rejected here as before.
    """
    result = dict(target)
    structures: list[object] = []
    for position, (measured_structure, structure) in enumerate(
        zip(
            _mappings(measured.get("estructuras")),
            _mappings(target.get("estructuras")),
            strict=True,
        )
    ):
        if structure.get("patron_color") is None or (only is not None and position != only):
            structures.append(structure)
            continue
        context, expansion = _expand_pattern(measured, measured_structure)
        if _armado_del_motor(measured_structure) is not None:
            structures.append(structure)
            continue
        shares = participaciones(conteo_por_instancia(context, expansion))
        synced = dict(structure)
        synced["materiales"] = [
            {**dict(material), "participacion": share}
            for material, share in zip(_mappings(structure.get("materiales")), shares, strict=True)
        ]
        structures.append(synced)
    result["estructuras"] = structures
    return result


def _ids_for_plan(
    plan: Mapping[str, object], allowlist: Sequence[PlanAllowlistEntry]
) -> tuple[list[str], list[str]]:
    product_ids: set[str] = set()
    variant_ids: set[str] = set()
    for structure in _mappings(plan.get("estructuras")):
        for material in _mappings(structure.get("materiales")):
            product_id = _text(material.get("product_id"))
            variant_id = _text(material.get("variant_id"))
            if product_id:
                product_ids.add(product_id)
            if variant_id:
                variant_ids.add(variant_id)
        for override in _mappings(structure.get("variant_overrides", [])):
            product_id = _text(override.get("product_id"))
            variant_id = _text(override.get("variant_id"))
            if product_id:
                product_ids.add(product_id)
            if variant_id:
                variant_ids.add(variant_id)
        # Los globos de las flores de la pieza (adorno): sus productos también se leen del catálogo.
        flores = structure.get("flores")
        if isinstance(flores, Mapping):
            for parte in ("petalo", "centro"):
                material = flores.get(parte)
                product_id = _text(material.get("product_id")) if isinstance(material, Mapping) else None
                if product_id:
                    product_ids.add(product_id)
    allowlist_variants = {variant for entry in allowlist for variant in entry.variant_ids}
    return sorted(product_ids), sorted(variant_ids | allowlist_variants)


def _allowlist_pairs(allowlist: Sequence[PlanAllowlistEntry]) -> set[tuple[str, str]]:
    """Return every ``(product_id, variant_id)`` pair declared by the allowlist."""
    return {
        (entry.product_id, variant_id) for entry in allowlist for variant_id in entry.variant_ids
    }


def _declared_pairs(plan: Mapping[str, object]) -> set[tuple[str, str]]:
    """Return product/variant pairs declared by materials and variant overrides.

    ``objetivo_variant_id`` has no product and is not an ownership claim.
    """
    pairs: set[tuple[str, str]] = set()
    for structure in _mappings(plan.get("estructuras")):
        items = [
            *_mappings(structure.get("materiales")),
            *_mappings(structure.get("variant_overrides", [])),
        ]
        for item in items:
            product_id = _text(item.get("product_id"))
            variant_id = _text(item.get("variant_id"))
            if product_id and variant_id:
                pairs.add((product_id, variant_id))
    return pairs


def _product_variant_mismatches(
    identity_rows: Sequence[Mapping[str, object]],
    allowlist_pairs: set[tuple[str, str]],
    declared_pairs: set[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Return pairs whose variant belongs to a different product in the snapshot.

    Allowlist pairs are strict: a known variant must belong to the entry
    product. Declared plan pairs are checked only when the declared product is a
    real product in the snapshot, preserving the tolerated confusion where a
    model repeats a variant id as ``product_id``. Unknown variants are not
    ownership errors; resolution reports them as uncovered.
    """
    owner_by_variant: dict[str, str] = {}
    known_products: set[str] = set()
    for row in identity_rows:
        product_id = _text(row.get("product_id"))
        if product_id is None:
            continue
        known_products.add(product_id)
        variant_id = _text(row.get("variant_id"))
        if variant_id is not None:
            owner_by_variant[variant_id] = product_id
    mismatches: set[tuple[str, str]] = set()
    for product_id, variant_id in allowlist_pairs:
        owner = owner_by_variant.get(variant_id)
        if owner is not None and owner != product_id:
            mismatches.add((product_id, variant_id))
    for product_id, variant_id in declared_pairs:
        owner = owner_by_variant.get(variant_id)
        if owner is not None and product_id in known_products and owner != product_id:
            mismatches.add((product_id, variant_id))
    return sorted(mismatches)


def _parabola_arc(run: float, rise: float, sag: float) -> float:
    """Length of the parabola from ``(0, 0)`` to ``(run, rise)`` that sags ``sag`` below its chord.

    ``y = rise · x / run - 4 · sag · x · (run - x) / run²``: the sag is the
    vertical gap to the straight line joining the ends, largest at mid-span.
    Its slope runs linearly from ``(rise - 4·sag) / run`` to
    ``(rise + 4·sag) / run`` with curvature ``8·sag / run²``, so the length is
    the closed form of ``∫ sqrt(1 + s²) ds`` between those slopes over that
    curvature. With ``rise = 0`` it is the level span of ``_garland_cord``.
    """

    def primitive(slope: float) -> float:
        return (slope * math.sqrt(1 + slope * slope) + math.asinh(slope)) / 2

    curvature = 8 * sag / (run * run)
    start = (rise - 4 * sag) / run
    end = (rise + 4 * sag) / run
    return (primitive(end) - primitive(start)) / curvature


def _garland_cord(length: float, armado: Mapping[str, object]) -> float:
    """Real length of a garland's cord with its assembly (ADR-0032).

    A shape with ``conCaida`` in the contract table (``u_invertida``,
    ``arco_caido``) and a ``caida_m`` hangs from its ends: each span between
    anchors is a parabolic arc of that sag, the usual approximation of a
    catenary, of length ``sqrt(a² + 4h²) + a² / (2h) · asinh(2h / a)`` with
    ``a`` half the span. For a small sag that is ``span + 8/3 · h² / span``;
    the closed form keeps a tall inverted U (1.5 m wide, 2.2 m drop) at 4.8 m
    where the series says 10.1 m. An ``arco_caido`` hung from ``n`` points
    makes ``n - 1`` swags.

    A ``desnivel_m`` (decision 27, any shape) puts the right end that much
    higher (or lower, when negative) than the left one: the anchors stand on
    the sloped line between the ends, and each span is the parabola between
    two ends at different heights with the same sag below its chord
    (``_parabola_arc``); without a sag, the sloped straight line. Without a
    ``desnivel_m`` the length is exactly the one of before (golden vectors),
    and any other shape keeps the straight length.

    An ``arqueo_m`` (decision 28, a ``curva`` in ``x-reglas-guirnalda``
    ``formasConArqueo``) bows the garland that much ABOVE the chord, like a
    roof. It is the same parabola mirrored top to bottom: arching ``a`` over
    a chord that rises ``r`` has the length of sagging ``a`` under a chord
    that rises ``-r``, so the cord is the same whichever side the bow is on.
    Without ``arqueo_m`` nothing changes.
    """
    shape = armado.get("forma")
    sag = _number(armado.get("caida_m")) or 0.0
    rise = _number(armado.get("desnivel_m")) or 0.0
    geometry = _GARLAND_SHAPES.get(shape) if isinstance(shape, str) else None
    hangs = sag > 0 and geometry is not None and geometry.get("conCaida") is True
    bow = _number(armado.get("arqueo_m")) or 0.0
    if not hangs and bow > 0 and shape in GARLAND_ARCHING_SHAPES:
        hangs, sag, rise = True, bow, -rise
    if length <= 0 or not (hangs or rise):
        return length
    if not hangs:
        return math.hypot(length, rise)
    anchors = _integer(armado.get("puntos_de_anclaje")) or 2
    spans = max(1, anchors - 1) if shape == "arco_caido" else 1
    if rise:
        return spans * _parabola_arc(length / spans, rise / spans, sag)
    half = length / spans / 2
    arc = math.sqrt(half * half + 4 * sag * sag) + half * half / (2 * sag) * math.asinh(
        2 * sag / half
    )
    return spans * arc


def _garland_profile(armado: Mapping[str, object]) -> float:
    """Band profile of a garland's shape (``factorPerfil``, ADR-0032); 1 is the full band."""
    shape = armado.get("forma")
    geometry = _GARLAND_SHAPES.get(shape) if isinstance(shape, str) else None
    factor = geometry.get("factorPerfil") if geometry is not None else None
    return float(factor) if isinstance(factor, (int, float)) else 1.0


def _eje(
    tipo: str,
    measures: Mapping[str, object],
    official: str | None = None,
    armado: Mapping[str, object] | None = None,
) -> float:
    width = _number(measures.get("ancho_m")) or 0.0
    height = _number(measures.get("alto_m")) or 0.0
    length = _number(measures.get("largo_m")) or 0.0
    if _OFFICIAL_GEOMETRY.get(official or "", {}).get("eje") == "circunferencia":
        diameter = min(width, height) if width and height else width or height
        return math.pi * diameter
    if tipo == "guirnalda" or _OFFICIAL_GEOMETRY.get(official or "", {}).get("eje") == "largo":
        # Without an assembly, exactly the length as always (golden vectors).
        return (length or width) if armado is None else _garland_cord(length or width, armado)
    if tipo == "semiarco":
        # A half arch rises ``alto`` and reaches ``ancho``: its axis is a quarter
        # ellipse (a = ancho, b = alto). The chat sends ``largo_m`` as depth, so
        # it only counts when both width and height are missing.
        if not width and not height:
            return length
        if not width or not height:
            return width or height
        root = math.sqrt(max(0.0, (3 * width + height) * (width + 3 * height)))
        return math.pi * (3 * (width + height) - root) / 4
    if tipo == "columna":
        return height
    if tipo == "arco":
        a = width / 2
        b = height
        return math.pi * (3 * (a + b) - math.sqrt(max(0.0, (3 * a + b) * (a + 3 * b)))) / 2
    if tipo == "centro_mesa":
        return max(width, height, length)
    return 0.0


def _band_profile_factor(official: str | None) -> float:
    end_width = _OFFICIAL_GEOMETRY.get(official or "", {}).get("anchoFinalBanda")
    return 1.0 if not isinstance(end_width, (int, float)) else (1 + float(end_width)) / 2


def _total_globos(
    tipo: str,
    measures: Mapping[str, object],
    density: str,
    mix: str,
    official: str | None = None,
    proportions: Sequence[tuple[int, float]] | None = None,
    *,
    armado: Mapping[str, object] | None = None,
) -> tuple[float, int]:
    """Axis and total balloon count of one structure.

    ``proportions`` is the effective mix when the customer fixed sizes: it
    decides the weighted balloon area and the dominant diameter, while the band
    width and the official structure profile still come from the plan mix.
    ``armado`` is a garland's ``armado_guirnalda`` (ADR-0032): its shape and
    drop decide the real axis (``_garland_cord``) and the band profile.
    """
    proportions = tuple(proportions) if proportions else _MIXES[mix]
    dominant = max(proportions, key=lambda item: item[1])
    dominant_diameter_cm = dominant[0] * 2.54 * 0.92
    axis = _eje(tipo, measures, official, armado)
    width = _number(measures.get("ancho_m")) or 0.0
    height = _number(measures.get("alto_m")) or 0.0
    area = (
        width * height
        if tipo == "pared"
        else axis * (_BAND_WIDTH[mix] * dominant_diameter_cm / 100) * _band_profile_factor(official)
    )
    if armado is not None and tipo != "pared":
        area *= _garland_profile(armado)
    weighted_area = sum(
        proportion * math.pi * ((diameter * 2.54 * 0.92) / 100 / 2) ** 2
        for diameter, proportion in proportions
    )
    total = math.ceil(_DENSITY_LAMBDA[density] * area / weighted_area) if weighted_area > 0 else 0
    return axis, max(0, total)


class BalloonApportionmentError(RuntimeError):
    """Broken invariant in the integer split: no made-up count is returned."""


# Quota invariant tolerance (ADR 0022); it only absorbs floating point error.
_QUOTA_TOLERANCE = 1e-6


def _hamilton(total: int, quotas: Sequence[float], tiebreaks: Sequence[float]) -> list[int]:
    """Largest remainder split.

    Ties are broken by larger remainder, larger ``tiebreak`` (the diameter on
    the size margin, 0 on the material margin) and finally lower index. The
    color name deliberately takes no part: sorting it split the same plan
    differently depending on the collation used, so the tiebreak was made to
    depend only on numbers and position.

    The quotas must add up to the total; otherwise the split would be a made-up
    count (the unrenormalized mandatory sizes case).
    """
    if not quotas:
        return []
    quota_sum = sum(quotas)
    if abs(quota_sum - total) > _QUOTA_TOLERANCE:
        raise BalloonApportionmentError(
            f"quotas add up to {quota_sum} and the total to split is {total}"
        )
    if total <= 0:
        return [0 for _quota in quotas]
    floors = [math.floor(quota) for quota in quotas]
    remaining = total - sum(floors)
    order = sorted(
        range(len(quotas)),
        key=lambda index: (-(quotas[index] - floors[index]), -tiebreaks[index], index),
    )
    for index in order:
        if remaining <= 0:
            break
        floors[index] += 1
        remaining -= 1
    return floors


def _apportion_margins(
    total: int, proportions: Sequence[tuple[int, float]], shares: Sequence[float]
) -> list[list[int]]:
    """Both-margin integer split of one instance.

    The size totals come from the effective mix and the material totals from
    ``participacion``; the size x material matrix respects both. A single
    Hamilton over the cells kept the total but not the margins: the R-18/R-24
    accents vanished when a second color was added and the color split drifted
    on small repeated pieces.

    The margins are computed here and the matrix is filled by ``_fill_margins``;
    a color pattern brings its own material margin to that same fill. The
    material margin never drops a declared color while the instance has a
    balloon for each one (``_material_totals``); when it had to reserve them,
    the fill is seeded with the reserved margin itself, since the shares would
    seed more floors than a color that gave up a balloon still has.
    """
    if not proportions or not shares:
        return []
    share_sum = sum(shares)
    # The plan schema already requires participaciones adding up to 1 (+-0.001).
    # Renormalizing here keeps the margin invariant if they arrive otherwise.
    material_quotas = (
        [share / share_sum for share in shares]
        if share_sum > 0
        else [1 / len(shares) for _share in shares]
    )
    material_totals, reserved = _material_totals(total, material_quotas)
    seed = [units / total for units in material_totals] if reserved else material_quotas
    return _fill_margins(
        total, proportions, _size_totals(total, proportions), material_totals, seed
    )


def _material_totals(total: int, quotas: Sequence[float]) -> tuple[list[int], bool]:
    """Material margin of one instance, and whether a declared color had to be reserved.

    Largest remainder over ``participacion``, as always, unless it leaves a
    color with a positive share at zero balloons while the instance has at
    least one balloon per such color: a 0.4 m centerpiece at 75/20/5 split its
    8 balloons 6/2/0, and the dorado the plan declares was neither bought nor
    mentioned. Then every color with a positive share gets one balloon reserved
    and the rest of the instance goes by largest remainder over the same
    shares (5/2/1 there). A split that already gives each of them a balloon is
    returned exactly as before, so only the plans that used to drop a color
    change their count and their ``plan_hash``. With fewer balloons than such
    colors nothing can be reserved and some color stays at zero: resolution
    reports it (``color_sin_globos``) instead of making up a balloon.

    The kit split (``_distribute_units``) keeps its own older rule, a unit taken
    from the material with the most; it is not touched here because changing
    it would move kit counts that never dropped a color.
    """
    totals = _hamilton(total, [total * quota for quota in quotas], [0.0 for _quota in quotas])
    positive = [index for index, quota in enumerate(quotas) if quota > 0]
    if all(totals[index] > 0 for index in positive) or total < len(positive):
        return totals, False
    rest = total - len(positive)
    positive_sum = sum(quotas[index] for index in positive)
    rest_totals = _hamilton(
        rest,
        [rest * quotas[index] / positive_sum for index in positive],
        [0.0 for _index in positive],
    )
    reserved = [0 for _quota in quotas]
    for index, units in zip(positive, rest_totals, strict=True):
        reserved[index] = 1 + units
    return reserved, True


def _size_totals(total: int, proportions: Sequence[tuple[int, float]]) -> list[int]:
    """Size margin of one instance: the effective mix, ties to the larger diameter."""
    return _hamilton(
        total,
        [total * proportion for _diameter, proportion in proportions],
        [float(diameter) for diameter, _proportion in proportions],
    )


def _fill_margins(
    total: int,
    proportions: Sequence[tuple[int, float]],
    size_totals: Sequence[int],
    material_totals: Sequence[int],
    material_quotas: Sequence[float],
) -> list[list[int]]:
    """Size x material matrix whose rows and columns add up to the given margins.

    The matrix is complete (every size x material cell exists) and no cell has a
    cap, so while a row and a column are both short there is a cell that can
    take the unit; both deficits, which add up to the same amount, run out
    together. The greedy sweep is therefore enough and no augmenting path is
    needed; if a deficit survived it fails instead of returning a matrix whose
    margins do not close. ``material_quotas`` only seed the floors and the
    order of the sweep; they must not exceed the material margins.
    """
    matrix = [[math.floor(units * quota) for quota in material_quotas] for units in size_totals]
    missing_rows = [units - sum(matrix[row]) for row, units in enumerate(size_totals)]
    missing_columns = [
        units - sum(row[column] for row in matrix) for column, units in enumerate(material_totals)
    ]
    cells = sorted(
        (
            (row, column)
            for row in range(len(size_totals))
            for column in range(len(material_quotas))
        ),
        key=lambda cell: (
            -(
                size_totals[cell[0]] * material_quotas[cell[1]]
                - math.floor(size_totals[cell[0]] * material_quotas[cell[1]])
            ),
            -proportions[cell[0]][0],
            cell[1],
        ),
    )
    progress = True
    while progress:
        progress = False
        for row, column in cells:
            if missing_rows[row] <= 0 or missing_columns[column] <= 0:
                continue
            matrix[row][column] += 1
            missing_rows[row] -= 1
            missing_columns[column] -= 1
            progress = True
    if any(missing_rows) or any(missing_columns):
        raise BalloonApportionmentError(f"the split matrix did not close the margins of {total}")
    return matrix


_MANDATORY_SIZE = re.compile(
    cast(str, _MIX_RULES["patron_tamano_obligatorio"]), re.IGNORECASE | re.ASCII
)
"""What counts as a mandatory size in ``restricciones.tamanos[].valor``.

That value is free text from the model: only a positive integer of up to three
digits is accepted, with "R-", "R" or no prefix. The grammar is spelled out as
a regex instead of leaning on a numeric parser because the two backends that
used to resolve plans parsed it differently -- they agreed on "R-12" and
disagreed on decimals, exponents, hexadecimal, underscores, non-ASCII digits
and the empty string -- and since the effective mix decides the TOTAL, that
disagreement moved counts, costs and ``plan_hash``. ``re.ASCII`` is what keeps
``\\d`` on ASCII digits. Anything else is ignored, never rounded and never a
plan rejection. The pattern comes from the contract (``mezclas.ts``, source
``^[ \\t\\n\\r\\f\\v]*R?-?(\\d{1,3})[ \\t\\n\\r\\f\\v]*$``); the flags are fixed on
both sides.
"""


def _required_sizes(plan: Mapping[str, object]) -> set[int]:
    restrictions = plan.get("restricciones")
    if not isinstance(restrictions, Mapping):
        return set()
    values = restrictions.get("tamanos")
    if not isinstance(values, list):
        return set()
    result: set[int] = set()
    for value in values:
        item = _mapping(value)
        if item.get("polaridad", "obligatorio") != "obligatorio":
            continue
        text = _text(item.get("valor"))
        if text is None:
            continue
        match = _MANDATORY_SIZE.match(text)
        if match is None:
            continue
        size = int(match.group(1))
        if size > 0:
            result.add(size)
    return result


def _effective_proportions(
    mix: str, sizes: set[int]
) -> tuple[tuple[tuple[int, float], ...], tuple[int, ...]]:
    """Effective mix when the customer fixes sizes.

    The customer's size restriction belongs to the whole plan, not to one
    structure: the mix sizes inside the required set, renormalized to 1, and
    equal shares between the required sizes when none of them is in the mix.
    Returns the effective mix and the required sizes it could not place.

    It used to filter without renormalizing while the total still came from the
    full mix, so an arch "solo R-12" quoted half the balloons and a size outside
    the mix multiplied the total.
    """
    proportions = _MIXES[mix]
    if not sizes:
        return proportions, ()
    filtered = tuple(item for item in proportions if item[0] in sizes)
    filtered_sum = sum(proportion for _diameter, proportion in filtered)
    if filtered and filtered_sum > 0:
        placed = {diameter for diameter, _proportion in filtered}
        unplaced = tuple(sorted(size for size in sizes if size not in placed))
        return (
            tuple((diameter, proportion / filtered_sum) for diameter, proportion in filtered),
            unplaced,
        )
    ordered = tuple(sorted(sizes))
    return tuple((size, 1.0 / len(ordered)) for size in ordered), ()


_LINEAR_STRUCTURES = frozenset({"arco", "semiarco", "guirnalda", "columna"})

#: Prefijo reservado de la puerta física dentro de ``advertencias``. El resto de
#: advertencias del plan son avisos que no bloquean (ADR-0022), así que estas
#: necesitan una marca para que Next pueda distinguirlas y rechazar el plan sin
#: convertir en bloqueante un campo declarado informativo. Detrás del prefijo va
#: la frase tal cual la lee el modelo, que no cambia al portar la regla.
PHYSICAL_GATE_PREFIX = "puerta_fisica:"


def _balloons_per_meter_factor(mix: str, proportions: Sequence[tuple[int, float]]) -> float:
    """Factor de globos por metro entre la mezcla del plan y la efectiva.

    Cuántas veces cambia el modelo los globos por metro al pasar de la mezcla
    del plan a la mezcla efectiva de ``restricciones.tamanos``. λ, el ancho de
    banda y el perfil de la estructura oficial son los mismos en las dos mezclas
    y se cancelan, así que solo queda el diámetro dominante sobre el área
    ponderada del globo. Sin tamaños obligatorios vale exactamente 1.
    """

    def por_metro(valores: Sequence[tuple[int, float]]) -> float:
        area = sum(
            proportion * math.pi * ((diameter * 2.54 * 0.92) / 100 / 2) ** 2
            for diameter, proportion in valores
        )
        if not valores or area <= 0:
            return 0.0
        dominant = max(valores, key=lambda item: item[1])
        return dominant[0] * 2.54 * 0.92 / 100 / area

    base = por_metro(_MIXES[mix])
    effective = por_metro(proportions)
    return effective / base if base > 0 and effective > 0 else 1.0


def _imputed_structure_costs(
    structures: Sequence[Mapping[str, object]], purchases: Sequence[Mapping[str, object]]
) -> list[dict[str, object]]:
    """Coste imputado a cada estructura, para la tarjeta del cliente.

    NO es un precio: los paquetes se compran una sola vez para todo el plan, así
    que repartirlos entre estructuras no reconstruye ningún cobro real. Es una
    imputación de consumo —unidades de la línea × precio del paquete ÷ unidades
    por paquete— que sirve para que el cliente vea el peso relativo de cada
    pieza. El total que se cobra es `totales.total_cop`, y no es la suma de
    estos valores.

    Lo calculaba TypeScript en la propia tarjeta (ADR-0023 §Riesgo): un número
    comercial que ningún resolutor firmaba. Ahora tiene dueño.

    `consumo_cop` es `None` cuando alguna línea de la estructura no tiene compra
    con paquete utilizable; la UI no muestra cifra en ese caso, en vez de
    enseñar una incompleta.
    """
    por_variante = {str(compra.get("variant_id")): compra for compra in purchases}
    costes: list[dict[str, object]] = []
    for structure in structures:
        total = 0.0
        completo = True
        lineas = _mappings(structure.get("lineas"))
        for line in lineas:
            compra = por_variante.get(str(line.get("variant_id")))
            unidades_paquete = _integer(compra.get("unidades_paquete")) if compra else None
            precio = _integer(compra.get("precio_paquete")) if compra else None
            if compra is None or not unidades_paquete or unidades_paquete <= 0 or precio is None:
                completo = False
                break
            total += (_integer(line.get("unidades")) or 0) * precio / unidades_paquete
        costes.append(
            {
                "estructura_id": _text(structure.get("estructura_id")),
                "consumo_cop": _round_half_up(total) if completo and lineas else None,
            }
        )
    return costes


def _physical_warnings(
    plan: Mapping[str, object], structures: Sequence[Mapping[str, object]]
) -> list[str]:
    """Puerta física del plan resuelto: globos por metro fuera de banda.

    Cada estructura lineal se compara contra su propia densidad y su propio eje
    por instancia. Los umbrales son heurísticos sin calibrar: son una
    comprobación previa transparente, no un sustituto de la calibración en
    campo, y escalan con la extensión física y la densidad en vez de fijar un
    conteo de globos para un tipo de decoración concreto.

    Están calibrados en globos por metro contra mezclas donde R-12 domina el
    volumen, así que no son comparables cuando ``restricciones.tamanos`` cambia
    el globo dominante: un arco 3 × 2,4 m "solo R-24" cuenta 52 globos correctos
    (8,4/m) donde la mezcla completa contaba 119 (19,2/m) y caía por debajo del
    mínimo, de modo que un plan válido dejaba de poder confirmarse. La banda se
    escala con el mismo modelo que produjo el conteo.
    """
    minimums = {"low": 8, "medium": 14, "high": 20}
    maximums = {"low": 48, "medium": 68, "high": 88}
    declared_by_id = {
        str(item.get("estructura_id")): item for item in _mappings(plan.get("estructuras"))
    }
    sizes = _required_sizes(plan)
    warnings: list[str] = []
    for structure in structures:
        if _text(structure.get("tipo")) not in _LINEAR_STRUCTURES:
            continue
        repeticiones = max(1, round(_number(structure.get("repeticiones")) or 0))
        extent = (_number(structure.get("eje_m")) or 0.0) * repeticiones
        if extent <= 0:
            continue
        # Solo el cuerpo: las flores (adorno) van encima de la banda y no son globos por metro de la pieza.
        balloons = sum(
            _integer(line.get("unidades")) or 0
            for line in lineas_del_cuerpo(_mappings(structure.get("lineas")))
            if _number(line.get("diam_pulg")) is not None
        )
        if balloons <= 0:
            continue
        declared = declared_by_id.get(str(structure.get("estructura_id")), {})
        density = {"sencilla": "low", "low": "low", "lujosa": "high", "high": "high"}.get(
            _text(declared.get("densidad")) or "", "medium"
        )
        mix = _text(declared.get("mezcla"))
        factor = (
            _balloons_per_meter_factor(mix, _effective_proportions(mix, sizes)[0])
            if mix in _MIXES
            else 1.0
        )
        per_meter = balloons / extent
        estructura_id = _text(structure.get("estructura_id")) or ""
        if per_meter < minimums[density] * factor * 0.6:
            warnings.append(
                f"{PHYSICAL_GATE_PREFIX}{estructura_id}: estimated material quantity appears too"
                f" low for {density} density over {extent:.2f} m ({balloons} installed balloons)"
            )
        if per_meter > maximums[density] * factor * 1.3:
            warnings.append(
                f"{PHYSICAL_GATE_PREFIX}{estructura_id}: estimated material quantity appears"
                f" unusually high for {density} density over {extent:.2f} m"
                f" ({balloons} installed balloons)"
            )
    return warnings


#: Las tres piezas que el motor del diseñador sabe armar (ADR-0034 §3): el campo
#: del plan que trae su armado, el campo del resuelto que es su eje y la lista de
#: ``plan-resuelto.v1`` donde se publica. El arco no tiene «alto» como eje —su
#: línea guía es más larga que su alto—, la columna no tiene «largo» y la
#: guirnalda lo mide sobre su tira ondulada: cada motor nombra el suyo, y por eso
#: va en la tabla en vez de deducirse del tipo en cada sitio donde se usa.
#:
#: La guirnalda entra por ``armado_guirnalda_organica`` y **no** por el
#: ``armado_guirnalda`` de ADR-0032, que sigue vivo con su editor: cuando una
#: pieza trae los dos, manda el del motor, que es el que coloca los globos de
#: verdad, y el de ADR-0032 se queda describiendo el armado por partes.
_ARMADOS_DEL_MOTOR: dict[str, tuple[str, str, str]] = {
    "arco": ("armado_arco", "largo_m", "armados_arco"),
    # El eje es el largo de la banda recorrida de punta a punta, no el ancho: con eso se cuenta.
    "arco_organico": ("armado_arco_organico", "largo_m", "armados_arco_organico"),
    "columna": ("armado_columna", "alto_total_m", "armados_columna"),
    "columna_organica": ("armado_columna_organica", "alto_m", "armados_columna_organica"),
    "guirnalda": ("armado_guirnalda_organica", "largo_m", "armados_guirnalda_organica"),
}


#: Las clases de armado que no se llaman como el tipo de la pieza que arman: la columna orgánica es una columna.
#: Cuando una pieza trae el armado clásico y el orgánico, manda el primero de la tabla (el clásico, que ya existía).
#: Quién le cuenta cada armado a los modelos de imagen (ADR-0035). Las cinco piezas del motor tienen la suya:
#: sin frase, el caption solo sabe nombrar la pieza y sus colores, y lo que calla lo inventa el LoRA con lo que
#: aprendió de su corpus — el 2026-10-04, un globo gigante coronando dos columnas que el plan no corona.
_FRASES_DE_LA_IMAGEN: dict[
    str,
    Callable[
        [Mapping[str, object], Mapping[str, object], Sequence[tuple[str, str]]], tuple[str, str]
    ],
] = {
    "arco": frases_arco,
    "arco_organico": frases_arco_organico,
    "columna": frases_columna,
    "columna_organica": frases_columna_organica,
    "guirnalda": frases_guirnalda_organica,
}


#: Qué tipos de pieza admite cada clase de armado que no se llama como el tipo que arma. Es una **tupla** por
#: clase y no un tipo suelto porque ``arco_organico`` arma dos piezas distintas: el ``arco`` que el plan
#: declara orgánico y el ``semiarco``, que lo es **siempre** —«un medio arco es este armado con
#: ``forma.corte`` menor que 1», encabezado de ``app/armado_arco_organico.py``— y no tiene ningún otro motor.
#: La columna orgánica sigue siendo solo una columna.
_TIPO_DE_CLASE: dict[str, tuple[str, ...]] = {
    "columna_organica": ("columna",),
    "arco_organico": ("arco", "semiarco"),
}


def _campos_publicados(lista: str) -> frozenset[str]:
    """Qué campos de una pieza resuelta viajan en la resolución, según el contrato.

    Se leen del esquema exportado y no se escriben a mano, igual que en
    ``plan_armado_arco.py``: el dueño es el Zod de ``src/lib/plan/`` y una lista
    a mano se desincronizaría en silencio. Lo que el motor devuelve de más —el
    dibujo (decenas de kB por pieza, se pide aparte a
    ``/api/plan-armado-arco``), el diseño saneado y el margen de compra, que el
    plan ya publica en ``totales.merma_porcentaje``— se queda fuera por no
    estar aquí, y no por una lista de exclusiones que haya que mantener.
    """
    esquema: Mapping[str, object] = contract_schema("PlanResuelto")
    for clave in ("properties", lista, "items", "properties"):
        esquema = cast(Mapping[str, object], esquema[clave])
    return frozenset(esquema)


_CAMPOS_DEL_MOTOR: dict[str, frozenset[str]] = {
    tipo: _campos_publicados(lista) for tipo, (_campo, _eje, lista) in _ARMADOS_DEL_MOTOR.items()
}

#: Cuántas piezas armadas recuerda ``_pieza_del_motor``. Un plan trae hasta 24
#: estructuras, así que con 32 entran todas las de una resolución y las de la
#: anterior; cada entrada son los globos de una pieza, sin su dibujo.
_MAX_PIEZAS_RECORDADAS = 32


@dataclass(frozen=True, slots=True)
class _ConteoDelMotor:
    """Lo que el motor contó de una pieza, en lugar de lo que la fórmula estimaba.

    El motor no estima un total y lo reparte: coloca cada globo y los cuenta,
    así que aquí no quedan cuotas que cerrar ni redondeos que repartir. Por eso
    ``celdas`` es su conteo tal cual —cuántos globos de cada tamaño lleva cada
    material de la estructura, por instancia— y el total es su suma.
    """

    eje_m: float
    celdas: tuple[tuple[int, int, int], ...]
    #: Lo que el motor avisó al armar (lo que acotó o corrigió). Solo informa a quien
    #: pregunta (``contar_pieza``); no entra en ningún conteo ni en el plan resuelto.
    avisos: tuple[str, ...] = ()
    #: La fórmula clásica ``4,8 · L / d`` que el motor del arco publica junto a su
    #: conteo; ``None`` en las piezas que no la tienen. Un ancla independiente de
    #: ``_total_globos``, solo para quien pregunta.
    formula_clasica: float | None = None

    @property
    def total(self) -> int:
        return sum(cantidad for _pulgadas, _material, cantidad in self.celdas)

    @property
    def proporciones(self) -> tuple[tuple[int, float], ...]:
        """La mezcla que el armado acabó usando, por si alguien la necesita.

        No decide nada —el reparto ya está hecho—: es la mezcla efectiva de la
        pieza para quien hoy pregunta a ``_structure_count`` si lleva un solo
        tamaño (``patron_color``), que con el motor es una respuesta observada
        y no la tabla del plan.
        """
        total = self.total
        if total <= 0:
            return ()
        por_tamano: dict[int, int] = {}
        for pulgadas, _material, cantidad in self.celdas:
            por_tamano[pulgadas] = por_tamano.get(pulgadas, 0) + cantidad
        return tuple((pulgadas, cuenta / total) for pulgadas, cuenta in sorted(por_tamano.items()))

    def sin_ubicar(self, obligatorios: Collection[int]) -> tuple[int, ...]:
        """Los tamaños obligatorios del cliente que el armado no colocó.

        La restricción de tamaños es del plan entero y el armado es de una
        pieza, así que un tamaño que el armado no usa sigue siendo un aviso
        visible, igual que cuando la mezcla no podía colocarlo.
        """
        colocados = {pulgadas for pulgadas, _material, _cantidad in self.celdas}
        return tuple(sorted(size for size in obligatorios if size not in colocados))


def _armado_del_motor(
    structure: Mapping[str, object],
) -> tuple[str, Mapping[str, object]] | None:
    """El armado del motor de esta pieza, si lo trae guardado y le corresponde por tipo.

    ``armado_arco`` solo cuenta en un arco y ``armado_columna`` solo en una
    columna: el contrato no impide el cruce, pero la puerta del motor lo
    rechaza (``no_es_arco``, ``no_es_columna``), y una pieza que no es ninguna
    de las dos se queda en el camino de siempre sin preguntar nada.

    ``armado_arco_organico`` cuenta en las **dos** piezas que ese motor arma:
    el arco declarado orgánico y el ``semiarco``, que es ese mismo armado con
    ``forma.corte`` menor que 1. Un ``semiarco`` que trajera el ``armado_arco``
    clásico no cuenta: el de patrones no sabe cortar la banda por la mitad.

    Y **el tipo no basta**: un aro circular y un techo de globos se construyen
    con ``tipo`` ``arco`` y ``guirnalda``, pero ningún motor hace un aro ni un
    techo (``OFICIALES_SIN_MOTOR``). Un armado guardado en una de esas piezas no
    la cuenta: se queda con su fórmula, que es la cifra correcta de la pieza.

    **Solo cuenta un armado guardado en la pieza.** Sin él, la pieza la cuenta
    la fórmula (ADR-0034 §3), también el arco clásico —con ``patron_color``,
    con la rejilla de su patrón— y la guirnalda orgánica. Del 2026-10-04
    (``6fc3e95``) al 2026-10-05 esas dos se armaban aquí con la receta del
    motor; el dueño lo revirtió el 2026-10-05 porque la receta no está lista
    para cotizar: por debajo de 2,6 m de ancho arma el arco en tríos (58
    globos donde la fórmula cuenta 118), reparte los colores por igual e ignora
    los tamaños que exige el cliente; la guirnalda lujosa de 2,5 m salía con
    204 globos y relleno de 5" que el catálogo puede no vender, y contar la
    foto sobre la receta corría el motor unas 217 veces por confirmación. La
    receta sigue siendo lo que la confirmación escribe en la pieza
    (``armado_estructura.completar``); ya guardada, la cuenta el motor.
    """
    if (_text(structure.get("estructura_oficial")) or "") in OFICIALES_SIN_MOTOR:
        return None
    tipo = _text(structure.get("tipo")) or ""
    for clase, (campo, _eje, _lista) in _ARMADOS_DEL_MOTOR.items():
        if tipo not in _TIPO_DE_CLASE.get(clase, (clase,)):
            continue
        armado = structure.get(campo)
        if isinstance(armado, Mapping):
            return clase, cast(Mapping[str, object], armado)
    return None


def armado_arco_de_patron(structure: Mapping[str, object]) -> dict[str, object] | None:
    """El armado del motor de un arco clásico que trae ``patron_color`` y ningún armado; ``None`` si no lo es.

    Es la receta con el patrón del plan como pista: la que la confirmación escribe en la pieza
    (``armado_estructura.completar``), con la que arranca el editor del arco (``plan_armado_arco``) y la que
    dibuja la guía de escena (``guia_piezas/clasica.py``). **No cuenta**: mientras la pieza no la traiga
    guardada en ``armado_arco``, la resolución cobra el arco con la fórmula y la rejilla de su patrón
    (``_armado_del_motor``, decisión del dueño del 2026-10-05). Derivado y determinista; recordado por pieza.
    """
    if structure.get("tipo") != "arco" or not isinstance(structure.get("patron_color"), Mapping):
        return None
    recordado = _armado_arco_de_patron(
        json.dumps(structure, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    )
    return None if recordado is None else cast(dict[str, object], json.loads(recordado))


@lru_cache(maxsize=_MAX_PIEZAS_RECORDADAS)
def _armado_arco_de_patron(estructura: str) -> str | None:
    """``armado_arco_de_patron`` sobre la pieza en JSON canónico, con el armado en JSON (inmutable en caché)."""
    # Importación diferida a propósito: ``app.armado_estructura`` importa de este módulo (``PistaPatron``,
    # ``OFICIALES_SIN_MOTOR``, ``PlanResolutionError``), así que traerla arriba sería un ciclo. Se va cuando
    # ``completar`` se mude a la resolución, como su propio encabezado ya prevé.
    from app.armado_estructura import armado_arco_de_patron as receta_del_patron

    armado = receta_del_patron(cast(Mapping[str, object], json.loads(estructura)))
    return None if armado is None else json.dumps(armado, ensure_ascii=False, sort_keys=True)


def armado_arco_de_receta(structure: Mapping[str, object]) -> dict[str, object] | None:
    """El armado del motor de un arco clásico sin armado, con o sin ``patron_color``; ``None`` si no lo es.

    Con patrón es ``armado_arco_de_patron``; sin él, la receta por número de colores
    (``armado_estructura.armado_arco_de_receta``): el arco que la confirmación escribiría. Lo dibuja la guía de
    escena (``guia_piezas/clasica.py``) para no dejar el arco fuera de la imagen; **no cuenta ni cotiza**: sin
    armado guardado, el arco lo cobra la fórmula (``_armado_del_motor``). Determinista; recordado por pieza.
    """
    if structure.get("tipo") != "arco":
        return None
    if isinstance(structure.get("patron_color"), Mapping):
        return armado_arco_de_patron(structure)
    recordado = _armado_arco_de_receta(
        json.dumps(structure, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    )
    return None if recordado is None else cast(dict[str, object], json.loads(recordado))


@lru_cache(maxsize=_MAX_PIEZAS_RECORDADAS)
def _armado_arco_de_receta(estructura: str) -> str | None:
    """``armado_arco_de_receta`` sobre la pieza en JSON canónico (inmutable en caché)."""
    # Importación diferida por el mismo ciclo que ``_armado_arco_de_patron``.
    from app.armado_estructura import armado_arco_de_receta as receta_del_arco

    armado = receta_del_arco(cast(Mapping[str, object], json.loads(estructura)))
    return None if armado is None else json.dumps(armado, ensure_ascii=False, sort_keys=True)


def pieza_del_motor_resuelta(
    structure: Mapping[str, object],
) -> tuple[str, dict[str, object]] | None:
    """La pieza que su motor arma, con cada globo colocado, o ``None`` si ningún motor la arma.

    Es la misma puerta que usa la resolución (``_armado_del_motor`` y ``_resolver_con_el_motor``, con su caché),
    así que los globos son exactamente los que se contaron y se cotizaron: solo hay pieza si trae su armado
    guardado. Devuelve la clase del motor (``arco``, ``columna``, ``arco_organico``, ``columna_organica`` o
    ``guirnalda``) y la pieza tal como la publica ``armados_*`` antes de recortarla. La lee la guía de escena
    de la imagen (``app/guia_escena.py``): derivado, fuera del snapshot y de ``plan_hash``.
    """
    entrada = _armado_del_motor(structure)
    if entrada is None:
        return None
    return entrada[0], _resolver_con_el_motor(entrada[0], entrada[1], structure)


def _armado_del_motor_error(
    estructura_id: str,
    error: ArmadoArcoInvalido
    | ArmadoArcoOrganicoInvalido
    | ArmadoColumnaInvalido
    | ArmadoColumnaOrganicaInvalido
    | ArmadoGuirnaldaOrganicaInvalido,
) -> PlanResolutionError:
    """Un armado que no se sostiene es un error del cliente, no un plan callado.

    Mismo código, estado y detalle que ``_garland_error``: el decorador tiene
    que leer qué pieza falla y por qué, y no recibir un plan resuelto con un
    conteo inventado porque alguien se tragó el fallo.
    """
    return PlanResolutionError(
        "armado_invalido",
        422,
        {"estructura_id": estructura_id, "motivo": error.motivo, "mensaje": error.mensaje},
    )


@lru_cache(maxsize=_MAX_PIEZAS_RECORDADAS)
def _pieza_del_motor(clave: str) -> dict[str, object]:
    """La pieza que el motor arma, cada globo colocado, sin su dibujo.

    ``clave`` es ``[tipo, colores, armado]`` en JSON canónico, y es todo lo que
    el motor necesita: ni las medidas del plan ni la densidad entran en un
    armado. Recordar el resultado es correcto porque el motor es determinista
    —su azar va sembrado en el armado—, y hace falta porque a la misma pieza se
    le pregunta varias veces por resolución: el despiece, lo que se publica y,
    con ``completar_conteos``, cada medida y densidad que ``conteo_foto`` prueba
    (ADR-0031). Medido sobre un arco de 84 globos: la resolución pedía 2
    armados (111 ms) y, con una cuenta de foto que no se alcanza, 9 (339 ms);
    recordándolos, 1 armado y 54 / 58 ms.

    Lanza el ``ArmadoInvalido`` del motor tal cual; quien llama es el que sabe
    de qué estructura es. ``lru_cache`` no recuerda excepciones, así que un
    armado inválido vuelve a fallar igual la próxima vez.
    """
    tipo, colores, armado = cast(
        tuple[str, list[str], Mapping[str, object]], tuple(json.loads(clave))
    )
    # El desperdicio es política del plan, no del armado (ADR-0034): el motor
    # dice cómo se arma la pieza y el plan cuánto de más se compra. La columna
    # no lo recibe porque su motor no calcula compra.
    if tipo == "arco":
        resuelto: dict[str, object] = armado_arco_resuelto(
            EstructuraArco(es_arco=True, materiales=colores), armado, MERMA
        )
    elif tipo == "guirnalda":
        resuelto = armado_guirnalda_organica_resuelto(
            EstructuraGuirnaldaOrganica(es_guirnalda=True, materiales=colores), armado, MERMA
        )
    elif tipo == "columna_organica":
        resuelto = armado_columna_organica_resuelto(
            EstructuraColumnaOrganica(es_columna=True, materiales=colores), armado, MERMA
        )
    elif tipo == "arco_organico":
        # ``es_arco`` es True también para un ``semiarco``: la puerta pregunta si la pieza se arma con este
        # motor, y un medio arco **es** este arco con ``forma.corte`` menor que 1. Quien dice que es medio es
        # el armado, no la pieza.
        resuelto = armado_arco_organico_resuelto(
            EstructuraArcoOrganico(es_arco=True, materiales=colores), armado, MERMA
        )
    else:
        resuelto = armado_columna_resuelto(
            EstructuraColumna(es_columna=True, materiales=colores), armado
        )
    return {campo: valor for campo, valor in resuelto.items() if campo in _CAMPOS_DEL_MOTOR[tipo]}


def _resolver_con_el_motor(
    tipo: str, armado: Mapping[str, object], structure: Mapping[str, object]
) -> dict[str, object]:
    """La pieza resuelta por su motor: cada globo colocado, su conteo y sus avisos.

    Es la **única** puerta por la que este resolutor habla con los motores de
    arco y de columna: el eje, el conteo y lo que se publica en
    ``armados_arco`` / ``armados_columna`` salen todos de aquí, así que no hay
    dos sitios contando la misma pieza.

    Los colores de la estructura viajan como vienen del plan. El motor solo los
    usa para pintar, y el dibujo no entra en la resolución: lo que de aquí se
    lee son índices de material, nunca tonos.
    """
    colores = [
        _text(material.get("color")) or "" for material in _mappings(structure.get("materiales"))
    ]
    clave = json.dumps(
        [tipo, colores, armado], ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    try:
        return _pieza_del_motor(clave)
    except (
        ArmadoArcoInvalido,
        ArmadoArcoOrganicoInvalido,
        ArmadoColumnaInvalido,
        ArmadoColumnaOrganicaInvalido,
        ArmadoGuirnaldaOrganicaInvalido,
    ) as error:
        raise _armado_del_motor_error(_text(structure.get("estructura_id")) or "", error) from error


def _conteo_del_motor(structure: Mapping[str, object]) -> _ConteoDelMotor | None:
    """El eje y el conteo del motor de esta pieza, o ``None`` sin armado del motor.

    La columna y la guirnalda cuentan ya por material **y por tamaño**, porque
    una apila capas de distinto globo y la otra mezcla tamaños a lo largo de la
    tira. El arco cuenta solo por material: toda su banda es del mismo globo, el
    ``nominal`` que nombra el armado.

    Lo que el motor lista aparte y aquí se suma es el acabado: la guirnalda
    separa su conteo también por acabado, pero el acabado de lo que se compra lo
    decide el material del plan, no el armado. El armado dice cómo se ve la
    pieza; el plan, qué producto la paga.

    El remate de la columna **sí** entra: el motor lo publica aparte
    (``remate.globos``, material y tamaño de cada globo) y es un globo que se
    coloca y se compra. Antes no se sumaba: el globo de 24" que corona toda
    columna clásica se dibujaba y se describía («24-inch») pero no se cotizaba, y
    la puerta de coherencia (``verificarCoherenciaPrompt``, «diámetro no
    cotizado») dejaba sin imagen a todo plan con una columna clásica (Fase 7,
    2026-10-06). Lo que sigue sin entrar es el follaje y las flores de la
    guirnalda, que no están en el catálogo de globos y viajan en
    ``armados_guirnalda_organica[].adornos`` para que nadie los olvide.
    """
    entrada = _armado_del_motor(structure)
    if entrada is None:
        return None
    tipo, armado = entrada
    resuelto = _resolver_con_el_motor(tipo, armado, structure)
    # El arco es el único cuyo conteo no dice el tamaño: es el mismo en toda la banda.
    nominal = _integer(_mapping(armado.get("globo")).get("nominal")) if tipo == "arco" else None
    por_celda: dict[tuple[int, int], int] = {}
    for linea in _mappings(resuelto.get("conteo")):
        celda = (
            nominal if nominal is not None else _integer(linea.get("tamano")) or 0,
            _integer(linea.get("material")) or 0,
        )
        por_celda[celda] = por_celda.get(celda, 0) + (_integer(linea.get("cantidad")) or 0)
    # El remate de la columna clásica: sus globos con su tamaño. Solo ella: la guirnalda publica otro `remate`.
    if tipo == "columna":
        for globo in _mappings(_mapping(resuelto.get("remate")).get("globos")):
            tamano = _integer(globo.get("tamano"))
            cantidad = _integer(globo.get("cantidad")) or 0
            if tamano and cantidad > 0:
                celda = (tamano, _integer(globo.get("material")) or 0)
                por_celda[celda] = por_celda.get(celda, 0) + cantidad
    return _ConteoDelMotor(
        eje_m=_number(resuelto.get(_ARMADOS_DEL_MOTOR[tipo][1])) or 0.0,
        # Por tamaño y, dentro de cada tamaño, por material: el mismo orden de
        # fila y columna con el que el camino viejo recorre su matriz, para que
        # las líneas de la estructura salgan en el orden de siempre.
        celdas=tuple(
            (pulgadas, material, cantidad)
            for (pulgadas, material), cantidad in sorted(por_celda.items())
        ),
        avisos=tuple(
            aviso
            for aviso in cast(Sequence[object], resuelto.get("avisos") or ())
            if isinstance(aviso, str)
        ),
        formula_clasica=_number(resuelto.get("formula_clasica")),
    )


def _structure_count(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> tuple[float, int, tuple[tuple[int, float], ...], tuple[int, ...]]:
    """Axis, balloons per instance, effective mix and unplaced mandatory sizes."""
    # ADR-0034 §3: con armado del motor cuenta el motor, que coloca cada globo.
    # Sin armado se queda la estimación de siempre, que es la que necesitan la
    # pared, el centro de mesa, el aro y la escultura, y la que mantiene quieto
    # el ``plan_hash`` de los planes ya aprobados. El semiarco salió de esa
    # lista el 2026-10-04: su armado es el del arco orgánico con ``forma.corte``
    # menor que 1 y, cuando lo trae, lo cuenta el motor como a las demás. El aro y
    # el techo se quedan: su forma no es una que un motor produzca, así que un
    # armado guardado en ellos no cuenta (``OFICIALES_SIN_MOTOR``).
    motor = _conteo_del_motor(structure)
    if motor is not None:
        return (
            motor.eje_m,
            motor.total,
            motor.proporciones,
            motor.sin_ubicar(_required_sizes(plan)),
        )
    return _formula_count(plan, structure)


def _formula_count(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> tuple[float, int, tuple[tuple[int, float], ...], tuple[int, ...]]:
    """Axis, balloons per instance, effective mix and unplaced sizes by the formula.

    Es la rama sin armado de ``_structure_count``, tal cual; está aparte para que
    ``contar_pieza`` pueda decir qué daría la fórmula de una pieza que además trae
    armado del motor, sin una segunda copia de ella.
    """
    tipo = _text(structure.get("tipo")) or ""
    density = _text(structure.get("densidad")) or "media"
    mix = _text(structure.get("mezcla")) or "organica_fina"
    measures = _mapping(structure.get("medidas"))
    proportions, unplaced = _effective_proportions(mix, _required_sizes(plan))
    if _text(structure.get("estructura_oficial")) == "racimo_pared":
        axis = max(
            _number(measures.get("ancho_m")) or 0.0,
            _number(measures.get("alto_m")) or 0.0,
            _number(measures.get("largo_m")) or 0.0,
        )
        return axis, max(0, _integer(structure.get("unidades_declaradas")) or 0), proportions, unplaced
    armado = structure.get("armado_guirnalda") if tipo == "guirnalda" else None
    axis, total = _total_globos(
        tipo,
        measures,
        density,
        mix,
        _text(structure.get("estructura_oficial")),
        proportions,
        armado=armado if isinstance(armado, Mapping) else None,
    )
    return axis, total, proportions, unplaced


def _pattern_matrix(
    plan: Mapping[str, object],
    structure: Mapping[str, object],
    proportions: Sequence[tuple[int, float]],
) -> list[list[int]]:
    """Size x material split when a color pattern decides the colors (ADR-0028 §5).

    The material margin is the grid's count (with one size the total becomes
    the whole grid); the size margin still comes from the effective mix.
    """
    context, expansion = _expand_pattern(plan, structure)
    count = conteo_por_instancia(context, expansion)
    return _fill_margins(
        count.total,
        proportions,
        _size_totals(count.total, proportions),
        count.unidades,
        count.cuotas,
    )


def _despiece_with_plan_sizes(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> tuple[float, list[dict[str, object]], tuple[int, ...]]:
    materials = _mappings(structure.get("materiales"))
    repeats = max(1, _integer(structure.get("repeticiones")) or 1)
    if _text(structure.get("estructura_oficial")) == "racimo_pared":
        axis, total, proportions, unplaced = _structure_count(plan, structure)
        matrix = _apportion_margins(
            total,
            proportions,
            [_number(material.get("participacion")) or 0.0 for material in materials],
        )
        return (
            round(axis, 2),
            [
                {
                    "tamano": f"R-{pulgadas}",
                    "pulgadas": pulgadas,
                    "color": _text(materials[material].get("color")),
                    "cantidad": cantidad,
                    "material_index": material,
                }
                for fila, (pulgadas, _proporcion) in enumerate(proportions)
                for material in range(len(materials))
                if (cantidad := matrix[fila][material]) > 0
            ],
            unplaced,
        )
    # ADR-0034 §3: con armado del motor no hay despiece que hacer. El motor ya
    # colocó cada globo, así que su conteo *es* el reparto por tamaño y por
    # material, sin cuotas, sin redondeos y sin la rejilla de ``patron_color``.
    motor = _conteo_del_motor(structure)
    if motor is not None:
        return (
            round(motor.eje_m, 2),
            [
                {
                    "tamano": f"R-{pulgadas}",
                    "pulgadas": pulgadas,
                    "color": _text(materials[material].get("color")),
                    "cantidad": cantidad * repeats,
                    "material_index": material,
                }
                for pulgadas, material, cantidad in motor.celdas
                if cantidad > 0
            ],
            motor.sin_ubicar(_required_sizes(plan)),
        )
    axis, base_total, proportions, unplaced = _structure_count(plan, structure)
    matrix = (
        _pattern_matrix(plan, structure, proportions)
        if structure.get("patron_color") is not None
        else _apportion_margins(
            base_total,
            proportions,
            [_number(material.get("participacion")) or 0.0 for material in materials],
        )
    )
    # Each cell keeps its material position: two materials of the same color
    # (reflex and pastel) are two products, not one (they used to merge by color).
    return (
        round(axis, 2),
        [
            {
                "tamano": f"R-{diameter}",
                "pulgadas": diameter,
                "color": _text(material.get("color")),
                "cantidad": matrix[row][column] * repeats,
                "material_index": column,
            }
            for row, (diameter, _proportion) in enumerate(proportions)
            for column, material in enumerate(materials)
            if matrix[row][column] * repeats > 0
        ],
        unplaced,
    )


def _admissible_substitution(requested: float, available: float) -> bool:
    if requested == available:
        return True
    try:
        requested_index = _DIAMETROS_ESTANDAR.index(int(requested))
        available_index = _DIAMETROS_ESTANDAR.index(int(available))
    except ValueError:
        return False
    return (
        abs(requested_index - available_index) == 1
        and max(requested, available) / min(requested, available) <= _MAX_SUBSTITUTION_RATIO
    )


def _compatible(
    candidates: Sequence[Candidate], diameter: float, color: str | None, exact: bool
) -> list[Candidate]:
    options = [
        candidate
        for candidate in candidates
        if candidate.shape == "redondo"
        and candidate.diameter_inches is not None
        and _admissible_substitution(diameter, candidate.diameter_inches)
        and (not exact or candidate.diameter_inches == diameter)
    ]
    if color is not None:
        options = [candidate for candidate in options if _normalize(color) in candidate.colors]
    if not options:
        return []
    distance = min(abs(cast(float, candidate.diameter_inches) - diameter) for candidate in options)
    return [
        candidate
        for candidate in options
        if abs(cast(float, candidate.diameter_inches) - diameter) == distance
    ]


def _package_cost(candidate: Candidate, quantity: int, waste: float = 0.0) -> int:
    required = math.ceil(max(0, quantity) * (1 + waste))
    return math.ceil(required / candidate.units_per_package) * candidate.price


def _optimizar_cobertura(
    unidades_objetivo: int | float,
    opciones: Sequence[Mapping[str, object]],
    merma: float = 0.0,
) -> dict[str, object] | None:
    """Cheapest mix of presentations covering the units, by bounded search."""
    candidatas: list[dict[str, object]] = []
    for option in opciones:
        variant_id = option.get("variant_id")
        units_per_package = _integer(option.get("unidades_paquete"))
        price = _number(option.get("precio"))
        if (
            not isinstance(variant_id, str)
            or units_per_package is None
            or units_per_package <= 0
            or price is None
            or price <= 0
        ):
            continue
        min_packages = _number(option.get("min_paquetes"))
        normalized_min = max(0, math.floor(min_packages or 0))
        normalized_price: int | float = int(price) if price.is_integer() else price
        candidatas.append(
            {
                "variant_id": variant_id,
                "unidades_paquete": units_per_package,
                "precio": normalized_price,
                "min_paquetes": normalized_min,
            }
        )
    candidatas.sort(key=lambda item: cast(str, item["variant_id"]))
    if unidades_objetivo <= 0 or not candidatas:
        return None

    unidades_con_merma = math.ceil(unidades_objetivo * (1 + merma))
    min_units_per_package = min(int(cast(int, item["unidades_paquete"])) for item in candidatas)
    max_paquetes = max(
        1,
        max(int(cast(int, item["min_paquetes"])) for item in candidatas),
        math.ceil(unidades_con_merma / min_units_per_package) + 2,
    )
    mejor: dict[str, object] | None = None

    def visitar(indice: int, restantes: float, elegidas: list[dict[str, object]]) -> None:
        nonlocal mejor
        if indice == len(candidatas):
            if restantes > 0:
                return
            compras = [item for item in elegidas if int(cast(int, item["paquetes"])) > 0]
            capacidad = sum(int(cast(int, item["capacidad"])) for item in compras)
            costo = sum(
                int(cast(int, item["paquetes"])) * cast(int | float, item["precio"])
                for item in compras
            )
            candidato: dict[str, object] = {
                "unidades_objetivo": unidades_objetivo,
                "unidades_con_merma": unidades_con_merma,
                "costo": costo,
                "sobrante": capacidad - unidades_objetivo,
                "paquetes": sum(int(cast(int, item["paquetes"])) for item in compras),
                "compras": compras,
            }
            if mejor is None:
                mejor = candidato
                return
            mejor_key = (
                cast(int | float, mejor["costo"]),
                cast(int | float, mejor["sobrante"]),
                cast(int, mejor["paquetes"]),
                "|".join(
                    cast(str, item["variant_id"])
                    for item in cast(list[dict[str, object]], mejor["compras"])
                ),
            )
            candidate_key = (
                cast(int | float, candidato["costo"]),
                cast(int | float, candidato["sobrante"]),
                cast(int, candidato["paquetes"]),
                "|".join(cast(str, item["variant_id"]) for item in compras),
            )
            if candidate_key < mejor_key:
                mejor = candidato
            return

        option = candidatas[indice]
        units_per_package = int(cast(int, option["unidades_paquete"]))
        min_packages = int(cast(int, option["min_paquetes"]))
        max_for_option = min(
            max_paquetes,
            max(min_packages, math.ceil(restantes / units_per_package) + 1),
        )
        for packages in range(max_for_option + 1):
            if packages > 0 and packages < min_packages:
                continue
            capacity = packages * units_per_package
            visitar(
                indice + 1,
                restantes - capacity,
                [
                    *elegidas,
                    {**option, "paquetes": packages, "capacidad": capacity},
                ],
            )

    visitar(0, float(unidades_con_merma), [])
    return mejor


def _plan_cost_optimizer_enabled() -> bool:
    """PLAN_COST_OPTIMIZER_V2 defaults ON and accepts 1/true/on."""
    raw = os.environ.get("PLAN_COST_OPTIMIZER_V2")
    return raw is None or raw == "1" or raw.lower() in {"true", "on"}


def _choose(
    candidates: Sequence[Candidate],
    diameter: float,
    color: str | None,
    quantity: int,
    exact: bool,
) -> Candidate | None:
    options = _compatible(candidates, diameter, color, exact)
    return (
        min(options, key=lambda item: (_package_cost(item, quantity), item.variant_id))
        if options
        else None
    )


def _relabelled_color(line: Mapping[str, object], requested: str | None) -> str | None:
    """The color the plan asked for when ``_line_color`` relabelled the line."""
    label = line.get("color")
    if requested and isinstance(label, str) and _normalize(requested) != _normalize(label):
        return requested
    return None


def _line_color(candidate: Candidate, color: str | None) -> str | None:
    """Color a line is labelled with.

    The requested color wins, except when it only matched a family color of the
    product (its tags) and the chosen variant has exactly one real color: the
    line then says the color the balloon actually is. Which products a color
    request accepts does not change; that is still ``_compatible``.
    """
    if not color:
        return candidate.variant_colors[0] if candidate.variant_colors else None
    if len(candidate.variant_colors) != 1 or _normalize(color) in candidate.variant_colors:
        return color
    return candidate.variant_colors[0]


def _line(
    origin_id: str,
    candidate: Candidate,
    quantity: int,
    color: str | None,
    requested_diameter: float | None = None,
) -> dict[str, object]:
    delivered_diameter = candidate.diameter_inches
    substitution: dict[str, str] | None = None
    if (
        requested_diameter is not None
        and delivered_diameter is not None
        and delivered_diameter != requested_diameter
    ):
        substitution = {
            "pedido": f"R-{_format_number(requested_diameter)}",
            "entregado": candidate.size_code or f"R-{_format_number(delivered_diameter)}",
            "motivo": f"La whitelist no tiene R-{_format_number(requested_diameter)}; se usó el diámetro más cercano disponible para {color or 'el producto'}.",
        }
    return {
        "estructura_id": origin_id,
        "origen": {"kind": "estructura", "id": origin_id},
        "product_id": candidate.product_id,
        "variant_id": candidate.variant_id,
        "sku": candidate.sku,
        "sku_original": candidate.sku_original,
        "source_snapshot_id": candidate.source_snapshot_id,
        "source_variant_id": candidate.source_variant_id,
        "inventory_quantity": candidate.inventory_quantity,
        "unidades_inferidas": candidate.unidades_inferidas,
        "titulo": candidate.title,
        "color": _line_color(candidate, color),
        "tamano_codigo": candidate.size_code,
        "diam_pulg": delivered_diameter,
        "diam_cm": round(delivered_diameter * 2.54, 1) if delivered_diameter is not None else None,
        "forma": candidate.shape,
        "acabado": candidate.finishes[0] if candidate.finishes else None,
        "unidades": quantity,
        "imagen": candidate.image,
        "sustitucion": substitution,
    }


def _distribute_units(total: int, materials: Sequence[Mapping[str, object]]) -> list[int]:
    """Split ``unidades_declaradas`` by ``participacion``.

    Largest remainder (ties by position), as before the reference audit, so a
    plan that already bought every material resolves to the same lines and
    keeps its signed ``plan_hash``. Every declared material is a purchase:
    a material left at zero takes one unit from the material with the most
    units (ties by position). A declared total below the number of materials
    resolves to one unit per material; ``validarUnidadesDeclaradas`` rejects
    that plan at confirmation.
    """
    if not materials:
        return []
    if total < len(materials):
        return [1] * len(materials)
    quotas = [total * (_number(material.get("participacion")) or 0.0) for material in materials]
    floors = [math.floor(quota) for quota in quotas]
    remaining = total - sum(floors)
    for index in sorted(
        range(len(quotas)), key=lambda item: (-(quotas[item] - floors[item]), item)
    ):
        if remaining <= 0:
            break
        floors[index] += 1
        remaining -= 1
    for index, units in enumerate(floors):
        if units > 0:
            continue
        donor = max(range(len(floors)), key=lambda item: (floors[item], -item))
        if floors[donor] <= 1:
            break
        floors[donor] -= 1
        floors[index] = 1
    return floors


def _join_colors(colors: Sequence[str]) -> str:
    if len(colors) <= 1:
        return colors[0] if colors else ""
    return f"{', '.join(colors[:-1])} y {colors[-1]}"


def _reference_color_substitutions(
    structure_id: str,
    reference_colors: object,
    line_colors: Sequence[object],
    equivalent_colors: Sequence[object] = (),
) -> list[dict[str, object]]:
    """Photo colors a structure does not buy.

    ``colores_referencia`` holds the dominant colors of the reference element the
    structure materializes, written by the Next server from the turn blueprint.
    A structure without resolved lines is reported as uncovered, not as a color
    change. ``equivalent_colors`` are the colors the plan asked for on lines that
    ``_line_color`` relabelled: they only make the comparison tolerant, and the
    customer is always told the colors the lines actually say.
    """
    delivered: list[str] = []
    for color in line_colors:
        normalized = _normalize(color) if isinstance(color, str) else ""
        if normalized and normalized not in delivered:
            delivered.append(normalized)
    if not delivered or not isinstance(reference_colors, list):
        return []
    covered = set(delivered)
    for color in equivalent_colors:
        normalized = _normalize(color) if isinstance(color, str) else ""
        if normalized:
            covered.add(normalized)
    requested: list[str] = []
    for color in reference_colors:
        normalized = _normalize(color) if isinstance(color, str) else ""
        if normalized and normalized not in requested:
            requested.append(normalized)
    substitutions: list[dict[str, object]] = []
    for color in requested:
        if color in covered:
            continue
        stand_in = purchase_color_for_unsold(color)
        if stand_in is not None and stand_in in covered:
            # Not a loss: the catalog does not sell this color ("gris") and the
            # structure carries the one it is bought as ("plateado"). It is
            # still reported -- a deliberate substitution, never a silent one.
            substitutions.append(
                {
                    "estructura_id": structure_id,
                    "pedido": color,
                    "entregado": stand_in,
                    "motivo": f"La foto de referencia muestra {color}, que el catálogo no vende: se usó {stand_in}.",
                }
            )
            continue
        substitutions.append(
            {
                "estructura_id": structure_id,
                "pedido": color,
                "entregado": ", ".join(delivered),
                "motivo": f"La foto de referencia muestra {color} y esta pieza no lo lleva: se armó con {_join_colors(delivered)}.",
            }
        )
    return substitutions


def _mix_real(all_lines: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    # La mezcla real es la del cuerpo de la pieza: los globos de sus flores (adorno) no cambian cómo está armada.
    lines = lineas_del_cuerpo(all_lines)
    total = sum(_integer(line.get("unidades")) or 0 for line in lines)
    grouped: dict[tuple[object, object], dict[str, object]] = {}
    for line in lines:
        diameter = _number(line.get("diam_pulg"))
        if diameter is None:
            continue
        key = (line.get("forma"), diameter)
        item = grouped.setdefault(
            key, {"diam_pulg": diameter, "forma": line.get("forma"), "unidades": 0}
        )
        item["unidades"] = int(cast(int, item["unidades"])) + (_integer(line.get("unidades")) or 0)
    values = sorted(
        grouped.values(),
        key=lambda item: (
            -int(cast(int, item["unidades"])),
            -float(cast(float, item["diam_pulg"])),
        ),
    )
    return [
        {
            **item,
            "pct": round((int(cast(int, item["unidades"])) / total) * 100, 2) if total else 0,
        }
        for item in values
    ]


def _format_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else str(value)


def _unique_dicts(
    items: Sequence[dict[str, object]], keys: Sequence[str]
) -> list[dict[str, object]]:
    seen: set[tuple[object, ...]] = set()
    result: list[dict[str, object]] = []
    for item in items:
        key = tuple(item.get(name) for name in keys)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def _alternatives(
    plan: Mapping[str, object],
    structures: Sequence[Mapping[str, object]],
    current_purchases: Sequence[Mapping[str, object]],
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    allowlist: Mapping[str, set[str]],
    current_total: int,
) -> list[dict[str, object]]:
    del plan
    needs: dict[tuple[str, str, float], dict[str, object]] = {}
    for structure in structures:
        for line in _mappings(structure.get("lineas")):
            diameter = _number(line.get("diam_pulg"))
            if diameter is None:
                continue
            color = _text(line.get("color"))
            raw_shape = line.get("forma")
            shape = raw_shape if isinstance(raw_shape, str) else None
            raw_finish = line.get("acabado")
            finish = raw_finish if isinstance(raw_finish, str) else None
            key = (_normalize(color or ""), shape or "", diameter)
            previous = needs.get(key)
            quantity = _integer(line.get("unidades")) or 0
            needs[key] = {
                "color": color,
                "forma": shape,
                "diam_pulg": diameter,
                "acabado": finish,
                "unidades": quantity
                + (int(cast(int, previous["unidades"])) if previous is not None else 0),
            }

    if not needs:
        return []

    non_geometric_cost = float(
        sum(
            _number(purchase.get("subtotal")) or 0
            for purchase in current_purchases
            if _number(purchase.get("diam_pulg")) is None
        )
    )
    if non_geometric_cost.is_integer():
        non_geometric_cost = int(non_geometric_cost)
    profiles: list[dict[str, object]] = []
    for product_id, candidates in candidates_by_product.items():
        permitted = allowlist.get(product_id) or set()
        selectable = [candidate for candidate in candidates if candidate.variant_id in permitted]
        purchases: list[dict[str, object]] = []
        total: int | float = non_geometric_cost
        complete = True
        for need in needs.values():
            requested_shape = cast(str | None, need["forma"]) or "redondo"
            requested_diameter = cast(float, need["diam_pulg"])
            requested_color = cast(str | None, need["color"])
            requested_finish = cast(str | None, need["acabado"])
            options = [
                candidate
                for candidate in selectable
                if candidate.shape == requested_shape
                and candidate.diameter_inches == requested_diameter
                and (not requested_color or _normalize(requested_color) in candidate.colors)
                and (not requested_finish or _normalize(requested_finish) in candidate.finishes)
            ]
            coverage = _optimizar_cobertura(
                int(cast(int, need["unidades"])),
                [
                    {
                        "variant_id": candidate.variant_id,
                        "unidades_paquete": candidate.units_per_package,
                        "precio": candidate.price,
                    }
                    for candidate in options
                ],
            )
            if coverage is None:
                complete = False
                break
            total += cast(int | float, coverage["costo"])
            for purchase in cast(list[dict[str, object]], coverage["compras"]):
                variant_id = cast(str, purchase["variant_id"])
                candidate = next(
                    (option for option in options if option.variant_id == variant_id),
                    None,
                )
                if candidate is not None:
                    purchases.append(
                        {
                            "variant_id": variant_id,
                            "paquetes": purchase["paquetes"],
                            "titulo": candidate.title.split(" — ")[0],
                        }
                    )
        if complete:
            profiles.append({"product_id": product_id, "total": total, "compras": purchases})

    profiles.sort(
        key=lambda profile: (cast(int | float, profile["total"]), str(profile["product_id"]))
    )
    seen: set[str] = set()
    alternatives: list[dict[str, object]] = []
    for index, profile in enumerate(profiles[:3]):
        product_id = str(profile["product_id"])
        if product_id in seen:
            continue
        seen.add(product_id)
        titles = list(
            dict.fromkeys(
                cast(str, purchase["titulo"])
                for purchase in cast(list[dict[str, object]], profile["compras"])
            )
        )
        total = cast(int | float, profile["total"])
        alternatives.append(
            {
                "familia_id": product_id,
                "titulo": " + ".join(titles) or product_id,
                "total_cop": total,
                "ahorro_cop": max(0, current_total - total),
                "etiqueta": (
                    "economica" if index == 0 else "equilibrada" if index == 1 else "premium"
                ),
            }
        )
    return alternatives


#: How far a color's share of what a structure buys may land from the share
#: its ``participacion`` declares before resolution says so: more than 10
#: percentage points (decision of 2026-10-05). Exactly 10 is not reported, and
#: the tolerance only absorbs float error (0.6 - 0.5 is 0.09999999999999998).
_SPLIT_DEVIATION = 0.10
_SPLIT_TOLERANCE = 1e-9


def _whole_percents(units: Sequence[float]) -> list[int]:
    """Whole percents of ``units`` adding up to 100 (largest remainder, ties to the first)."""
    total = sum(units)
    if total <= 0:
        return [0 for _unit in units]
    return _hamilton(100, [100 * unit / total for unit in units], [0.0 for _unit in units])


def _color_warnings(
    structure: Mapping[str, object],
    designed: Sequence[int],
    delivered: Sequence[int],
    *,
    covered: bool,
    balloons: bool,
) -> list[str]:
    """``color_sin_globos`` and ``reparto_distinto`` of one resolved structure.

    ``designed`` is what its count gives each material index and ``delivered``
    what its lines buy of each (the same, minus what had no coverage). Both
    went unsaid: a color the plan declares could end up without a single
    balloon (a 0.4 m centerpiece at 75/20/5 bought 6/2/0), and a piece its
    motor counts bought a split nobody declared (a classic arch at 70/20/10
    bought 30/29/29). Now:

    - ``color_sin_globos:{estructura_id}:{color}`` for each material with a
      positive share that the count leaves at zero; after
      ``_material_totals`` that only happens with fewer balloons than colors or
      when the motor places none of it.
    - ``reparto_distinto:{estructura_id}`` once, when some material's share of
      what is bought is more than ``_SPLIT_DEVIATION`` away from its declared
      share. Only for a fully covered structure: an uncovered one already says
      ``estructura_sin_cobertura`` and its split is not what will be bought.
      And only with at least ``1 / _SPLIT_DEVIATION`` (10) balloons per piece:
      below that one balloon moves the split by more than the tolerance.

    Each entry is the code, then a sentence in Spanish naming the piece, like
    the ``puerta_fisica`` ones; the declared and the bought split go in the
    order of ``materiales``. They live in ``advertencias``, which is outside the
    snapshot and ``plan_hash``: saying it changes no purchase and no signature.
    """
    materials = _mappings(structure.get("materiales"))
    if len(materials) < 2:
        return []
    structure_id = _text(structure.get("estructura_id")) or ""
    name = _text(structure.get("nombre")) or structure_id
    plain = [
        _text(material.get("color")) or f"n.º {index + 1}"
        for index, material in enumerate(materials)
    ]
    # Two materials of one color (reflex and pastel) are two purchases: the legend number tells them apart.
    colors = [
        f"{color} ({index + 1})" if plain.count(color) > 1 else color
        for index, color in enumerate(plain)
    ]
    shares = [max(0.0, _number(material.get("participacion")) or 0.0) for material in materials]
    warnings: list[str] = []
    wanted = sum(1 for share in shares if share > 0)
    per_piece = sum(designed) // max(1, _integer(structure.get("repeticiones")) or 1)
    for color, share, units in zip(colors, shares, designed, strict=True):
        if share <= 0 or units > 0:
            continue
        why = (
            f"la pieza lleva {per_piece} {'globos' if balloons else 'unidades'} y no alcanza uno"
            f" para cada uno de sus {wanted} colores"
            if per_piece < wanted
            else "su armado no le pone ninguno"
        )
        warnings.append(
            f"color_sin_globos:{structure_id}:{color}: {name}: el {color} que declara el plan se"
            f" queda sin globos y no se compra: {why}."
        )
    bought = sum(delivered)
    share_sum = sum(shares)
    if not covered or bought <= 0 or share_sum <= 0:
        return warnings
    # With fewer than 1 / _SPLIT_DEVIATION balloons per piece one balloon is worth more than the tolerance
    # itself, so the deviation is rounding, not a different split: a 4-balloon figure at 40/30/20/10 can only
    # be bought 1/1/1/1 and a 6-balloon bouquet at 70/10/10/10 only 3/1/1/1 (golden vector 14).
    repetitions = max(1, _integer(structure.get("repeticiones")) or 1)
    if (bought / repetitions) * _SPLIT_DEVIATION < 1 - _SPLIT_TOLERANCE:
        return warnings
    if all(
        abs(units / bought - share / share_sum) <= _SPLIT_DEVIATION + _SPLIT_TOLERANCE
        for units, share in zip(delivered, shares, strict=True)
    ):
        return warnings
    declared_text = _join_colors(
        [
            f"{color} {percent} %"
            for color, percent in zip(colors, _whole_percents(shares), strict=True)
        ]
    )
    bought_text = _join_colors(
        [
            f"{color} {percent} %"
            for color, percent in zip(colors, _whole_percents(delivered), strict=True)
        ]
    )
    units_text = _join_colors([str(units) for units in delivered])
    warnings.append(
        f"reparto_distinto:{structure_id}: {name}: el plan declara {declared_text}; lo que se"
        f" compra es {bought_text} ({units_text} {'globos' if balloons else 'unidades'})."
    )
    return warnings


def _flower_lines(
    structure: Mapping[str, object],
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    candidate_by_variant: Mapping[str, Candidate],
    allowlist: Mapping[str, set[str]],
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[str]]:
    """Las líneas de las flores de globo de una pieza (``flores``), lo que no se pudo cubrir y sus avisos.

    Cuántos globos lleva cada parte lo dice ``flores_pieza.partes_de_flores`` (por pieza y por repeticiones) y qué
    variante los sirve ``flores_pieza.elegir_talla``: R-5 del producto que el plan nombra, dentro de la allowlist; sin
    R-5, la talla redonda más cercana del mismo producto con ``flores_talla_sustituida`` (y la sustitución en la línea,
    como cualquier otra), y sin ninguna, ``sin_cobertura`` y ``flores_sin_cobertura``. Cada decisión queda en el
    registro (``_decidir``).
    """
    flores = structure.get("flores")
    if not isinstance(flores, Mapping):
        return [], [], []
    structure_id = _text(structure.get("estructura_id")) or ""
    name = _text(structure.get("nombre")) or structure_id
    repeats = max(1, _integer(structure.get("repeticiones")) or 1)
    lines: list[dict[str, object]] = []
    uncovered: list[dict[str, object]] = []
    warnings: list[str] = []
    decided: list[dict[str, object]] = []
    for parte in partes_de_flores(flores, repeats):
        requested_candidate = candidate_by_variant.get(parte.product_id)
        canonical_product = (
            parte.product_id
            if parte.product_id in candidates_by_product
            else requested_candidate.product_id
            if requested_candidate is not None
            else parte.product_id
        )
        permitted = allowlist.get(canonical_product) or allowlist.get(parte.product_id) or set()
        options = [
            candidate
            for candidate in candidates_by_product.get(canonical_product, ())
            if candidate.variant_id in permitted
        ]
        talla = elegir_talla(
            options,
            parte.color,
            parte.unidades,
            lambda candidate, quantity: _package_cost(candidate, quantity),
            _normalize,
        )
        if talla is None:
            uncovered.append(
                {
                    "estructura_id": structure_id,
                    "product_id": parte.product_id,
                    "tamano": f"R-{_format_number(PULGADAS_FLOR)}",
                }
            )
            warnings.append(
                f"flores_sin_cobertura:{structure_id}: {name}: el catálogo no tiene globos redondos de"
                f" {parte.color or 'ese producto'} para {'los pétalos' if parte.parte == 'petalo' else 'el centro'}"
                " de las flores; no se compran."
            )
            decided.append({"parte": parte.parte, "product_id": parte.product_id, "variant_id": None})
            continue
        line = _line(
            structure_id, talla.candidato, parte.unidades, parte.color, PULGADAS_FLOR
        )
        line["adorno"] = ADORNO_FLOR
        lines.append(line)
        if not talla.exacta:
            warnings.append(
                f"flores_talla_sustituida:{structure_id}: {name}: no hay R-{_format_number(PULGADAS_FLOR)}"
                f" de {parte.color or 'ese globo'} en el catálogo; las flores van con"
                f" {talla.candidato.size_code or 'la talla más cercana'}."
            )
        decided.append(
            {
                "parte": parte.parte,
                "product_id": parte.product_id,
                "variant_id": talla.candidato.variant_id,
                "talla": talla.candidato.size_code,
                "exacta": talla.exacta,
                "unidades": parte.unidades,
            }
        )
    _decidir(
        "plan.flores",
        "globos y talla de las flores de una pieza",
        {"estructura_id": structure_id, "partes": decided},
        "flores_pieza.partes_de_flores (por pieza y repeticiones) y elegir_talla (R-5 o la más cercana)",
        entrada={"flores": dict(flores), "repeticiones": repeats},
    )
    return lines, uncovered, warnings


def _resolve_structures(
    plan: Mapping[str, object],
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    candidate_by_variant: Mapping[str, Candidate],
    allowlist: Mapping[str, set[str]],
) -> tuple[
    list[dict[str, object]],
    list[dict[str, object]],
    list[dict[str, object]],
    list[str],
    list[dict[int, list[_BoughtLine]]],
]:
    """Lines of every structure, plus what each patterned material bought.

    The last item has one entry per structure, in plan order: for a structure
    with ``patron_color``, the lines each material index bought (replacements
    included), which is what names its pattern (``_named_by_purchase``);
    empty for the rest.
    """
    structures: list[dict[str, object]] = []
    substitutions: list[dict[str, object]] = []
    uncovered: list[dict[str, object]] = []
    warnings: list[str] = []
    bought_by_structure: list[dict[int, list[_BoughtLine]]] = []
    for raw_structure in _mappings(plan.get("estructuras")):
        structure_id = _text(raw_structure.get("estructura_id")) or ""
        structure_type = _text(raw_structure.get("tipo")) or ""
        lines: list[dict[str, object]] = []
        bought: dict[int, list[_BoughtLine]] = {}
        bought_by_structure.append(bought)
        patterned = raw_structure.get("patron_color") is not None
        # Colors the plan asked for that ``_line_color`` relabelled with the
        # variant's real color: the photo comparison still counts them as
        # delivered.
        equivalent_colors: list[str] = []
        axis: float | None = None
        before_missing = len(uncovered)
        materials = _mappings(raw_structure.get("materiales"))
        # Units per material index: what the count gives each one and what its
        # lines buy (``_color_warnings``).
        designed = [0 for _material in materials]
        delivered = [0 for _material in materials]
        # A centerpiece of a few counted balloons buys declared units, like a kit (UI-6).
        geometric = conteo_foto.es_geometrica(raw_structure) or _text(raw_structure.get("estructura_oficial")) == "racimo_pared"
        if geometric:
            axis, demands, unplaced_sizes = _despiece_with_plan_sizes(plan, raw_structure)
            # The customer's size restriction belongs to the whole plan, not to
            # one structure: a mandatory size this mix cannot place stays as a
            # visible warning (validarRestriccionesPlan does not check sizes, so
            # this is the only notice).
            for size in unplaced_sizes:
                warnings.append(f"tamano_obligatorio_sin_ubicar:{structure_id}:R-{size}")
            exact_sizes = bool(_required_sizes(plan))
            for demand in demands:
                requested_color = _text(demand.get("color"))
                material_index = _integer(demand.get("material_index")) or 0
                if 0 <= material_index < len(materials):
                    designed[material_index] += _integer(demand.get("cantidad")) or 0
                matching_material = (
                    materials[material_index]
                    if 0 <= material_index < len(materials)
                    else materials[0]
                )
                requested_product = _text(matching_material.get("product_id")) or ""
                requested_candidate = candidate_by_variant.get(requested_product)
                canonical_product = (
                    requested_product
                    if requested_product in candidates_by_product
                    else requested_candidate.product_id
                    if requested_candidate is not None
                    else requested_product
                )
                permitted = (
                    allowlist.get(canonical_product) or allowlist.get(requested_product) or set()
                )
                options = [
                    candidate
                    for candidate in candidates_by_product.get(canonical_product, ())
                    if candidate.variant_id in permitted
                ]
                acabado = _text(matching_material.get("acabado"))
                if acabado:
                    options = [
                        candidate
                        for candidate in options
                        if _normalize(acabado) in candidate.finishes
                    ]
                chosen = _choose(
                    options,
                    float(cast(float, demand["pulgadas"])),
                    requested_color,
                    int(cast(int, demand["cantidad"])),
                    exact_sizes,
                )
                override = next(
                    (
                        item
                        for item in _mappings(raw_structure.get("variant_overrides", []))
                        if item.get("objetivo_variant_id")
                        == (chosen.variant_id if chosen else None)
                    ),
                    None,
                )
                if override is not None:
                    override_variant = _text(override.get("variant_id"))
                    override_product = _text(override.get("product_id"))
                    replacement = candidate_by_variant.get(override_variant or "")
                    if (
                        replacement is None
                        or override_product is None
                        or replacement.product_id != override_product
                        or replacement.variant_id not in allowlist.get(override_product, set())
                    ):
                        chosen = None
                    else:
                        chosen = replacement
                if chosen is None:
                    uncovered.append(
                        {
                            "estructura_id": structure_id,
                            "product_id": requested_product,
                            "tamano": str(demand["tamano"]),
                        }
                    )
                    continue
                line_color = (
                    _text(override.get("color")) if override is not None else requested_color
                )
                resolved_line = _line(
                    structure_id,
                    chosen,
                    int(cast(int, demand["cantidad"])),
                    line_color,
                    float(cast(float, demand["pulgadas"])),
                )
                lines.append(resolved_line)
                if 0 <= material_index < len(materials):
                    delivered[material_index] += int(cast(int, demand["cantidad"]))
                if patterned:
                    bought.setdefault(material_index, []).append(
                        _BoughtLine(
                            replaced=override is not None,
                            color=_text(resolved_line.get("color")),
                            finish=_text(resolved_line.get("acabado")),
                        )
                    )
                relabelled = _relabelled_color(resolved_line, line_color)
                if relabelled:
                    equivalent_colors.append(relabelled)
                replacement_info = resolved_line.get("sustitucion")
                if isinstance(replacement_info, dict):
                    substitutions.append({"estructura_id": structure_id, **replacement_info})
        else:
            declared = _integer(raw_structure.get("unidades_declaradas")) or 0
            quantities = _distribute_units(declared, materials)
            designed = list(quantities)
            for index, (material, quantity) in enumerate(zip(materials, quantities, strict=True)):
                if quantity <= 0:
                    continue
                product_id = _text(material.get("product_id")) or ""
                variant_id = _text(material.get("variant_id")) or ""
                candidate = candidate_by_variant.get(variant_id)
                if (
                    candidate is None
                    or candidate.product_id != product_id
                    or variant_id not in allowlist.get(product_id, set())
                ):
                    uncovered.append(
                        {
                            "estructura_id": structure_id,
                            "product_id": product_id,
                            "tamano": variant_id or "variant_id inválido",
                        }
                    )
                    continue
                material_color = _text(material.get("color"))
                material_line = _line(structure_id, candidate, quantity, material_color)
                lines.append(material_line)
                delivered[index] = quantity
                relabelled = _relabelled_color(material_line, material_color)
                if relabelled:
                    equivalent_colors.append(relabelled)
        substitutions.extend(
            _reference_color_substitutions(
                structure_id,
                raw_structure.get("colores_referencia"),
                [line.get("color") for line in lines],
                equivalent_colors,
            )
        )
        total_units = sum(_integer(line.get("unidades")) or 0 for line in lines)
        if len(uncovered) > before_missing:
            warnings.append(f"estructura_sin_cobertura:{structure_id}")
        warnings.extend(
            _color_warnings(
                raw_structure,
                designed,
                delivered,
                covered=len(uncovered) == before_missing,
                balloons=geometric,
            )
        )
        # Flores de globo (adorno, ``app/flores_pieza.py``): sus líneas van con las del cuerpo para comprarse por
        # paquete con ellas, marcadas para que la mezcla real, la densidad y la puerta física no las cuenten.
        flower_lines, flower_uncovered, flower_warnings = _flower_lines(
            raw_structure, candidates_by_product, candidate_by_variant, allowlist
        )
        lines.extend(flower_lines)
        uncovered.extend(flower_uncovered)
        warnings.extend(flower_warnings)
        for flower_line in flower_lines:
            flower_substitution = flower_line.get("sustitucion")
            if isinstance(flower_substitution, dict):
                substitutions.append({"estructura_id": structure_id, **flower_substitution})
        total_units = sum(_integer(line.get("unidades")) or 0 for line in lines)
        raw_assumptions = plan.get("supuestos", [])
        assumptions = (
            [
                assumption
                for assumption in raw_assumptions
                if isinstance(assumption, str) and f"para {structure_type}" in assumption
            ]
            if isinstance(raw_assumptions, list)
            else []
        )
        structures.append(
            {
                "estructura_id": structure_id,
                "nombre": _text(raw_structure.get("nombre")) or structure_id,
                "tipo": structure_type,
                "ubicacion": _text(raw_structure.get("ubicacion")) or "fondo_pared",
                "repeticiones": _integer(raw_structure.get("repeticiones")) or 1,
                "eje_m": axis,
                "total_unidades": total_units,
                "lineas": lines,
                "mezcla_real": _mix_real(lines),
                "supuestos": assumptions,
            }
        )
    return structures, substitutions, uncovered, warnings, bought_by_structure


def _presentation_key(line: Mapping[str, object]) -> str:
    raw_shape = line.get("forma")
    shape = raw_shape if isinstance(raw_shape, str) else ""
    return "|".join(
        (
            str(line.get("product_id")),
            _normalize(_text(line.get("color")) or ""),
            shape,
            _format_number(float(cast(float, _number(line.get("diam_pulg"))))),
        )
    )


def _reoptimize_presentations(
    structures: Sequence[dict[str, object]],
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    allowlist: Mapping[str, set[str]],
) -> dict[str, int]:
    """Buy each product+size+color once for the whole plan.

    The need of every structure is added up and covered with the cheapest
    combination of allowlisted presentations (x12, x20, x50...). Each structure
    line is then rebuilt against the chosen purchases, in structure order, so
    every purchase keeps the structures it covers. Regression (E2E 2026-09-14):
    the same Azul Rey R-12 was bought as x12 for the arch and x20 for the
    columns, about 15 % more than one consolidated purchase. Returns the
    packages chosen per variant.
    """
    groups: dict[str, list[Mapping[str, object]]] = {}
    for structure in structures:
        for line in _mappings(structure.get("lineas")):
            if _number(line.get("diam_pulg")) is None:
                continue
            groups.setdefault(_presentation_key(line), []).append(line)
    packages: dict[str, int] = {}
    optimizations: dict[str, tuple[list[dict[str, object]], dict[str, Candidate]]] = {}
    for key, lines in groups.items():
        first = lines[0]
        product_id = str(first.get("product_id"))
        color = _text(first.get("color"))
        permitted = allowlist.get(product_id) or set()
        product_candidates = candidates_by_product.get(product_id, ())
        options = [
            candidate
            for candidate in product_candidates
            if candidate.variant_id in permitted
            and candidate.diameter_inches == _number(first.get("diam_pulg"))
            and candidate.shape == first.get("forma")
            and (not color or _normalize(color) in candidate.colors)
        ]
        coverage = _optimizar_cobertura(
            sum(_integer(line.get("unidades")) or 0 for line in lines),
            [
                {
                    "variant_id": candidate.variant_id,
                    "unidades_paquete": candidate.units_per_package,
                    "precio": candidate.price,
                }
                for candidate in options
            ],
        )
        if coverage is None:
            continue
        purchases = [dict(item) for item in cast(list[dict[str, object]], coverage["compras"])]
        for purchase in purchases:
            variant_id = str(purchase["variant_id"])
            packages[variant_id] = packages.get(variant_id, 0) + int(
                cast(int, purchase["paquetes"])
            )
        optimizations[key] = (
            purchases,
            {candidate.variant_id: candidate for candidate in product_candidates},
        )

    for structure in structures:
        new_lines: list[dict[str, object]] = []
        for line in _mappings(structure.get("lineas")):
            if _number(line.get("diam_pulg")) is None:
                new_lines.append(dict(line))
                continue
            optimization = optimizations.get(_presentation_key(line))
            if optimization is None:
                new_lines.append(dict(line))
                continue
            purchases, candidates = optimization
            remaining = _integer(line.get("unidades")) or 0
            for purchase in purchases:
                assigned = min(remaining, int(cast(int, purchase["capacidad"])))
                if assigned <= 0:
                    continue
                candidate = candidates.get(str(purchase["variant_id"]))
                if candidate is None:
                    continue
                rebuilt = _line(
                    str(structure.get("estructura_id")),
                    candidate,
                    assigned,
                    _text(line.get("color")),
                    _number(line.get("diam_pulg")),
                )
                rebuilt["sustitucion"] = line.get("sustitucion")
                if es_linea_de_flor(line):
                    rebuilt["adorno"] = ADORNO_FLOR
                new_lines.append(rebuilt)
                purchase["capacidad"] = int(cast(int, purchase["capacidad"])) - assigned
                remaining -= assigned
                if remaining <= 0:
                    break
            if remaining > 0:
                new_lines.append({**line, "unidades": remaining})
        structure["lineas"] = new_lines
        structure["total_unidades"] = sum(_integer(line.get("unidades")) or 0 for line in new_lines)
        structure["mezcla_real"] = _mix_real(new_lines)
    return packages


def _consolidate(
    structures: Sequence[Mapping[str, object]],
    candidate_by_variant: Mapping[str, Candidate],
    packages_by_variant: Mapping[str, int] | None = None,
) -> tuple[list[dict[str, object]], dict[str, int], dict[str, int]]:
    grouped: dict[str, dict[str, object]] = {}
    for structure in structures:
        for line in _mappings(structure.get("lineas")):
            variant_id = _text(line.get("variant_id"))
            if variant_id is None:
                continue
            quantity = _integer(line.get("unidades")) or 0
            current = grouped.get(variant_id)
            if current is None:
                grouped[variant_id] = {
                    "variant_id": variant_id,
                    "product_id": line.get("product_id"),
                    "sku": line.get("sku"),
                    "sku_original": line.get("sku_original"),
                    "source_snapshot_id": line.get("source_snapshot_id"),
                    "source_variant_id": line.get("source_variant_id"),
                    "inventory_quantity": line.get("inventory_quantity"),
                    "unidades_inferidas": line.get("unidades_inferidas"),
                    "titulo": line.get("titulo"),
                    "tamano_codigo": line.get("tamano_codigo"),
                    "diam_pulg": line.get("diam_pulg"),
                    "color": line.get("color"),
                    "unidades_necesarias": quantity,
                    "design_quantity": quantity,
                    "waste_reserve": 0,
                    "required_quantity": quantity,
                    "unidades_con_merma": quantity,
                    "unidades_paquete": candidate_by_variant[variant_id].units_per_package,
                    "paquetes": max(
                        1, math.ceil(quantity / candidate_by_variant[variant_id].units_per_package)
                    ),
                    "purchase_quantity": 0,
                    "used": quantity,
                    "leftover_inventory": 0,
                    "consumption_cost": 0,
                    "purchase_cost": 0,
                    "additional_package_for_waste": False,
                    "sobrante": 0,
                    "precio_paquete": candidate_by_variant[variant_id].price,
                    "subtotal": 0,
                    "estructuras": [str(structure.get("estructura_id"))],
                    "elementos_origen": [line.get("origen")],
                    "imagen": line.get("imagen"),
                }
            else:
                current["unidades_necesarias"] = (
                    int(cast(int, current["unidades_necesarias"])) + quantity
                )
                current["design_quantity"] = current["unidades_necesarias"]
                structure_id = str(structure.get("estructura_id"))
                if structure_id not in cast(list[str], current["estructuras"]):
                    cast(list[str], current["estructuras"]).append(structure_id)
                origin = line.get("origen")
                if isinstance(origin, Mapping) and origin not in cast(
                    list[object], current["elementos_origen"]
                ):
                    cast(list[object], current["elementos_origen"]).append(dict(origin))
    purchases = sorted(grouped.values(), key=lambda item: str(item["variant_id"]))
    for purchase in purchases:
        candidate = candidate_by_variant[str(purchase["variant_id"])]
        optimized = (packages_by_variant or {}).get(str(purchase["variant_id"]))
        packages = (
            optimized
            if optimized is not None
            else max(
                1,
                math.ceil(
                    int(cast(int, purchase["design_quantity"])) / candidate.units_per_package
                ),
            )
        )
        capacity = packages * candidate.units_per_package
        cost = packages * candidate.price
        purchase["paquetes"] = packages
        purchase["purchase_quantity"] = capacity
        purchase["purchase_cost"] = cost
        purchase["subtotal"] = cost
        purchase["sobrante"] = capacity - int(cast(int, purchase["design_quantity"]))
    eligible = [
        purchase for purchase in purchases if _number(purchase.get("diam_pulg")) is not None
    ]
    target_reserve = math.ceil(
        sum(int(cast(int, item["design_quantity"])) for item in eligible) * MERMA
    )
    natural_surplus = sum(
        max(0, int(cast(int, item["purchase_quantity"])) - int(cast(int, item["design_quantity"])))
        for item in eligible
    )
    groups: dict[str, int] = {}
    for purchase in eligible:
        key = f"R-{_format_number(float(cast(float, purchase['diam_pulg'])))}|{_normalize(str(purchase.get('color') or ''))}"
        groups[key] = groups.get(key, 0) + int(cast(int, purchase["sobrante"]))
    remaining = target_reserve
    covered_groups: dict[str, int] = {}
    for key, available in sorted(groups.items(), key=lambda item: (-item[1], item[0])):
        covered = min(remaining, available)
        covered_groups[key] = covered
        remaining -= covered
        if remaining <= 0:
            break
    allocations: dict[str, int] = {}
    for purchase in eligible:
        key = f"R-{_format_number(float(cast(float, purchase['diam_pulg'])))}|{_normalize(str(purchase.get('color') or ''))}"
        available = max(
            0,
            int(cast(int, purchase["purchase_quantity"]))
            - int(cast(int, purchase["design_quantity"])),
        )
        allocation = min(covered_groups.get(key, 0), available)
        if allocation:
            allocations[str(purchase["variant_id"])] = allocation
            covered_groups[key] = covered_groups.get(key, 0) - allocation
    covered_reserve = sum(allocations.values())
    remaining = max(0, target_reserve - covered_reserve)
    # When the natural surplus is not enough, buy the balloon presentation that
    # covers what is left at the lowest cost. It used to buy on the first
    # purchase by variant_id, so an 80,000 COP R-24 package could cover a
    # reserve that a 30,000 COP R-12 package covered just as well.
    reserve_candidates = [
        purchase for purchase in eligible if int(cast(int, purchase["design_quantity"])) > 0
    ]
    while remaining > 0 and reserve_candidates:
        pending = remaining
        chosen = min(
            reserve_candidates,
            key=lambda purchase: (
                math.ceil(
                    pending / candidate_by_variant[str(purchase["variant_id"])].units_per_package
                )
                * candidate_by_variant[str(purchase["variant_id"])].price,
                -int(cast(int, purchase["design_quantity"])),
                str(purchase["variant_id"]),
            ),
        )
        variant_id = str(chosen["variant_id"])
        units_per_package = candidate_by_variant[variant_id].units_per_package
        additional_packages = math.ceil(pending / units_per_package)
        additional_capacity = additional_packages * units_per_package
        additional_reserve = min(pending, additional_capacity)
        chosen["paquetes"] = int(cast(int, chosen["paquetes"])) + additional_packages
        chosen["additional_package_for_waste"] = True
        allocations[variant_id] = allocations.get(variant_id, 0) + additional_reserve
        remaining -= additional_reserve
    covered_reserve = sum(allocations.values())
    for purchase in purchases:
        design = int(cast(int, purchase["design_quantity"]))
        candidate = candidate_by_variant[str(purchase["variant_id"])]
        packages = int(cast(int, purchase["paquetes"]))
        capacity = packages * candidate.units_per_package
        cost = packages * candidate.price
        reserve = allocations.get(str(purchase["variant_id"]), 0)
        required = design + reserve
        purchase["purchase_quantity"] = capacity
        purchase["purchase_cost"] = cost
        purchase["subtotal"] = cost
        purchase["sobrante"] = capacity - design
        purchase["waste_reserve"] = reserve
        purchase["required_quantity"] = required
        purchase["unidades_con_merma"] = required
        purchase["used"] = design
        purchase["leftover_inventory"] = max(0, capacity - required)
        purchase["consumption_cost"] = _round_half_up(cost * required / capacity) if capacity else 0
    return (
        purchases,
        {
            "target_waste_reserve": target_reserve,
            "natural_package_surplus": natural_surplus,
            "covered_waste_reserve": covered_reserve,
            "uncovered_waste_reserve": max(0, target_reserve - covered_reserve),
        },
        allocations,
    )


def _waste_extra_packages(design_quantity: int, units_per_package: int, packages: int) -> int:
    """Packages bought above the design's minimum cover.

    Every package of a flagged line used to be reported as an additional waste
    package (golden 08 said 10 where 1 was added). ``design-material-estimate-v1``
    does not store the base count, so it is derived here from the line's own
    fields; golden vector 08 locks the derivation in ``test_plan_regresion.py``.
    """
    if units_per_package <= 0:
        return 0
    return max(0, packages - max(1, math.ceil(max(0, design_quantity) / units_per_package)))


def _waste_only_savings(
    design_quantity: int, units_per_package: int, packages: int, package_price: float
) -> float:
    """Saving of one purchase line against buying it with the full merma.

    The naive purchase (every line with its full merma) minus what was actually
    bought. It used to compare against the design's minimum cover and ignore the
    packages the reserve did force to buy, so it reported savings that never
    happened. The caller rounds the sum once.
    """
    if units_per_package <= 0:
        return 0.0
    naive_packages = math.ceil(math.ceil(max(0, design_quantity) * (1 + MERMA)) / units_per_package)
    return max(0.0, (naive_packages - packages) * package_price)


def _material_waste_only_savings(
    balloons: Sequence[Mapping[str, object]],
    special: Sequence[Mapping[str, object]],
    purchase_lines: Sequence[Mapping[str, object]],
) -> int:
    """Waste-only saving of the material estimate, over its purchase lines.

    MERMA models balloons bursting while inflated and mounted, so only balloon
    purchases can avoid a waste-only package. A purchase whose variant is a
    special element is never eligible; otherwise it is eligible when its variant
    or its product appears among the balloon lines. Which purchases are eligible
    is a commercial rule and this resolver is its only owner (ADR-0023).
    """
    special_variants = {line.get("variant_id") for line in special}
    balloon_variants = {line.get("variant_id") for line in balloons}
    balloon_products = {line.get("product_id") for line in balloons}
    special_variants.discard(None)
    balloon_variants.discard(None)
    balloon_products.discard(None)
    savings = 0.0
    for line in purchase_lines:
        variant_id = line.get("variant_id")
        if variant_id in special_variants:
            continue
        if variant_id not in balloon_variants and line.get("product_id") not in balloon_products:
            continue
        design_quantity = _integer(line.get("design_quantity")) or 0
        units_per_package = _integer(line.get("units_per_package")) or 0
        package_count = _integer(line.get("package_count")) or 0
        purchase_cost = _number(line.get("purchase_cost")) or 0.0
        unit_price = purchase_cost / package_count if package_count > 0 else 0.0
        savings += _waste_only_savings(
            design_quantity, units_per_package, package_count, unit_price
        )
    return _round_half_up(savings)


def _plan_density(
    plan: Mapping[str, object], structures: Sequence[Mapping[str, object]]
) -> Mapping[str, object]:
    """Plan structure that decides ``design.density`` / ``visual_density``.

    The structure with the most design balloons wins; ties keep the first one in
    plan order. The two earlier rules -- "lujosa if any structure is lujosa" and
    "whatever the first structure says" -- sent the same mixed plan to the image
    prompt with a different density, so the dominant structure decides.
    """
    inputs = _mappings(plan.get("estructuras"))
    if not inputs:
        return {}
    balloons: dict[str, int] = {}
    for structure in structures:
        balloons[str(structure.get("estructura_id"))] = sum(
            _integer(line.get("unidades")) or 0
            for line in lineas_del_cuerpo(_mappings(structure.get("lineas")))
            if _number(line.get("diam_pulg")) is not None
        )
    dominant = inputs[0]
    for candidate in inputs:
        if balloons.get(str(candidate.get("estructura_id")), 0) > balloons.get(
            str(dominant.get("estructura_id")), 0
        ):
            dominant = candidate
    return dominant


def _material_estimate(resolved: Mapping[str, object]) -> dict[str, object]:
    plan = _mapping(resolved["plan"])
    structures = _mappings(resolved["estructuras"])
    balloons: list[dict[str, object]] = []
    special: list[dict[str, object]] = []
    for structure in structures:
        for line in _mappings(structure.get("lineas")):
            target = balloons if _number(line.get("diam_pulg")) is not None else special
            target.append(
                {
                    "structure_id": structure.get("estructura_id"),
                    "product_id": line.get("product_id"),
                    "variant_id": line.get("variant_id"),
                    "color": line.get("color"),
                    "finish": line.get("acabado"),
                    "size_inches": line.get("diam_pulg"),
                    "shape": line.get("forma"),
                    "design_quantity": line.get("unidades"),
                    "waste_reserve": 0,
                    "required_quantity": line.get("unidades"),
                    "waste_adjusted_quantity": line.get("unidades"),
                }
            )
    purchases = _mappings(resolved["compras"])
    purchase_lines = [
        {
            "product_id": item.get("product_id"),
            "variant_id": item.get("variant_id"),
            "design_quantity": item.get("design_quantity"),
            "waste_reserve": item.get("waste_reserve"),
            "required_quantity": item.get("required_quantity"),
            "waste_adjusted_quantity": item.get("unidades_con_merma"),
            "units_per_package": item.get("unidades_paquete"),
            "package_count": item.get("paquetes"),
            "purchase_quantity": item.get("purchase_quantity"),
            "used": item.get("used"),
            "leftover_inventory": item.get("leftover_inventory"),
            "consumption_cost": item.get("consumption_cost"),
            "purchase_cost": item.get("purchase_cost"),
            "additional_package_for_waste": item.get("additional_package_for_waste"),
            "operational_surplus": item.get("leftover_inventory"),
            "potential_surplus": max(
                0,
                int(cast(int, item.get("purchase_quantity", 0)))
                - int(cast(int, item.get("design_quantity", 0))),
            ),
        }
        for item in purchases
    ]
    first_structure = structures[0] if structures else {}
    first_input = (
        _mappings(plan.get("estructuras"))[0] if _mappings(plan.get("estructuras")) else {}
    )
    density = _text(_plan_density(plan, structures).get("densidad")) or "media"
    total_design = sum(_integer(line.get("design_quantity")) or 0 for line in balloons + special)
    installation_length = sum(
        (_number(structure.get("eje_m")) or 0) * (_integer(structure.get("repeticiones")) or 1)
        for structure in structures
    )
    installation = installation_length if installation_length > 0 else None
    visual_density = {"sencilla": "low", "media": "medium", "lujosa": "high"}.get(density, "medium")
    extent = max(installation or 0, 0.5)
    mass = total_design / extent
    visual_scale = (
        "very_large"
        if extent >= 4 and mass >= 20
        else "large"
        if (extent >= 3 and mass >= 14) or total_design >= 120
        else "medium"
        if (extent >= 2 and mass >= 10) or (visual_density == "high" and total_design >= 70)
        else "small"
        if total_design <= 35 and extent <= 2.5
        else "small_medium"
    )
    design = {
        "type": first_structure.get("tipo") if len(structures) == 1 else "composite_installation",
        "shape": first_input.get("mezcla") if len(structures) == 1 else "coordinated structures",
        "dimensions_m": {
            "width": _number(_mapping(first_input.get("medidas")).get("ancho_m")),
            "height": _number(_mapping(first_input.get("medidas")).get("alto_m")),
            "length": _number(_mapping(first_input.get("medidas")).get("largo_m")),
        },
        "installation_length_m": installation,
        "density": density,
        "visual_density": visual_density,
        "visual_scale": visual_scale,
        "cluster_count": max(
            1, sum(_integer(structure.get("repeticiones")) or 1 for structure in structures)
        ),
    }
    target_reserve = math.ceil(
        sum(_integer(line.get("design_quantity")) or 0 for line in balloons) * MERMA
    )
    covered = sum(_integer(item.get("waste_reserve")) or 0 for item in purchases)
    required = sum(_integer(item.get("required_quantity")) or 0 for item in purchases)
    purchase_quantity = sum(_integer(item.get("purchase_quantity")) or 0 for item in purchases)
    raw_warnings = resolved.get("advertencias", [])
    warnings = (
        [item for item in raw_warnings if isinstance(item, str)]
        if isinstance(raw_warnings, list)
        else []
    )
    estimate = {
        "version": "design-material-estimate-v1",
        "design": design,
        "balloons": balloons,
        "special_elements": special,
        "purchases": purchase_lines,
        "totals": {
            "design_quantity": total_design,
            "target_waste_reserve": target_reserve,
            "covered_waste_reserve": covered,
            "uncovered_waste_reserve": max(0, target_reserve - covered),
            "natural_package_surplus": sum(
                max(
                    0,
                    (_integer(item.get("purchase_quantity")) or 0)
                    - (_integer(item.get("design_quantity")) or 0),
                )
                for item in purchases
            ),
            "required_quantity": required,
            "consumption_cost": sum(
                _integer(item.get("consumption_cost")) or 0 for item in purchases
            ),
            "purchase_cost": sum(_integer(item.get("purchase_cost")) or 0 for item in purchases),
            "waste_only_savings_cop": _material_waste_only_savings(
                balloons, special, purchase_lines
            ),
            "additional_waste_packages": sum(
                _waste_extra_packages(
                    _integer(item.get("design_quantity")) or 0,
                    _integer(item.get("units_per_package")) or 0,
                    _integer(item.get("package_count")) or 0,
                )
                for item in purchase_lines
                if item.get("additional_package_for_waste") is True
            ),
            "waste_adjusted_quantity": required,
            "purchase_quantity": purchase_quantity,
            "operational_surplus": sum(
                _integer(item.get("leftover_inventory")) or 0 for item in purchases
            ),
            "potential_surplus": sum(
                max(
                    0,
                    (_integer(item.get("purchase_quantity")) or 0)
                    - (_integer(item.get("design_quantity")) or 0),
                )
                for item in purchases
            ),
        },
        "warnings": warnings,
    }
    validated = MaterialEstimate.model_validate(estimate)
    return cast(dict[str, object], validated.model_dump(mode="json"))


def _quote(resolved: Mapping[str, object]) -> dict[str, object]:
    lines: list[dict[str, object]] = []
    for item in _mappings(resolved["compras"]):
        line: dict[str, object] = {
            "id": item.get("variant_id"),
            "product_id": item.get("product_id"),
            "variant_id": item.get("variant_id"),
            "size": item.get("tamano_codigo") or "sin tamaño aplicable",
            "required_quantity": item.get("required_quantity"),
            "structures": item.get("estructuras"),
            "origins": item.get("elementos_origen"),
            "available": True,
            "design_quantity": item.get("design_quantity"),
            "waste_reserve": item.get("waste_reserve"),
            "purchase_quantity": item.get("purchase_quantity"),
            "used": item.get("used"),
            "leftover_inventory": item.get("leftover_inventory"),
            "consumption_cost_cop": item.get("consumption_cost"),
            "purchase_cost_cop": item.get("purchase_cost"),
            "title": item.get("titulo"),
            "package_price_cop": item.get("precio_paquete"),
            "units_per_package": item.get("unidades_paquete"),
            "packages": item.get("paquetes"),
            "subtotal_cop": item.get("subtotal"),
            "surplus": item.get("sobrante"),
        }
        diameter = _number(item.get("diam_pulg"))
        if diameter is not None:
            line["diameter_inches"] = diameter
        color = _text(item.get("color"))
        if color is not None:
            line["color"] = color
        size_code = _text(item.get("tamano_codigo"))
        if size_code is not None:
            line["size_code"] = size_code
        lines.append(line)
    totals = _mapping(resolved["totales"])
    quote = {
        "schema_version": "quote.v1",
        "currency": "COP",
        "lines": lines,
        "total_cop": totals.get("total_cop"),
        "waste_percentage": totals.get("merma_porcentaje"),
        "includes_vat": totals.get("incluye_iva"),
        "supported_complements": False,
        "purchase_cost_cop": totals.get("purchase_cost"),
        "consumption_cost_cop": totals.get("consumption_cost"),
        "target_waste_reserve": totals.get("target_waste_reserve"),
        "covered_waste_reserve": totals.get("covered_waste_reserve"),
        "leftover_inventory": sum(
            _integer(item.get("leftover_inventory")) or 0 for item in _mappings(resolved["compras"])
        ),
        "plan_hash": resolved.get("plan_hash"),
    }
    validated = Quote.model_validate(quote)
    return cast(dict[str, object], validated.model_dump(mode="json"))


def _build_resolved(
    request: PlanResolutionRequest,
    plan: Mapping[str, object],
    snapshot_id: str,
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    candidate_by_variant: Mapping[str, Candidate],
    allowlist: Mapping[str, set[str]],
    completion_warnings: Sequence[str] = (),
) -> dict[str, object]:
    """The resolved plan (``plan-resuelto.v1``), signed and validated.

    ``completion_warnings`` are what completing the plan's patterns reported
    (``_complete_plan``); they go first in ``advertencias``, which, like every
    notice here, is outside the snapshot and ``plan_hash``.
    """
    structures, substitutions, uncovered, structure_warnings, bought = _resolve_structures(
        plan, candidates_by_product, candidate_by_variant, allowlist
    )
    warnings = [*completion_warnings, *structure_warnings]
    # Consolidating one product+size+color across structures is not gated by
    # PLAN_COST_OPTIMIZER_V2: "each package is bought once" is the quote the
    # customer sees. The flag only gates the commercial alternatives.
    packages = _reoptimize_presentations(structures, candidates_by_product, allowlist)
    purchases, reserve, _allocations = _consolidate(structures, candidate_by_variant, packages)
    for purchase in purchases:
        design = int(cast(int, purchase["design_quantity"]))
        candidate = candidate_by_variant[str(purchase["variant_id"])]
        package_count = int(cast(int, purchase["paquetes"]))
        # The surplus that matters here is the design purchase's, before the
        # waste reserve bought anything: a package bought on purpose for the
        # reserve is not an oversized purchase. Golden vector 24 is the case
        # that distinguishes this order from measuring the surplus afterwards.
        base_packages = package_count - _waste_extra_packages(
            design, candidate.units_per_package, package_count
        )
        base_surplus = base_packages * candidate.units_per_package - design
        if design > 0 and base_surplus / design > 0.4:
            warnings.append(f"sobrante_alto:{purchase['variant_id']}")
    if reserve["uncovered_waste_reserve"]:
        warnings.append(f"reserva_merma_no_cubierta:{reserve['uncovered_waste_reserve']}")
    # La puerta física la mide ahora el resolutor, dueño único de la regla
    # (ADR-0023 paso 4). Sale marcada con ``PHYSICAL_GATE_PREFIX`` porque, a
    # diferencia del resto de ``advertencias``, sí bloquea la confirmación: la
    # política de bloqueo sigue en Next, que es donde vive lo que se hace con
    # un plan.
    warnings.extend(_physical_warnings(plan, structures))
    lineas = [line for structure in structures for line in _mappings(structure.get("lineas"))]
    total_cop = sum(_integer(item.get("subtotal")) or 0 for item in purchases)
    base_line_cost = sum(
        _package_cost(
            candidate_by_variant[str(line["variant_id"])], _integer(line.get("unidades")) or 0
        )
        for line in lineas
        if str(line.get("variant_id")) in candidate_by_variant
    )
    # Real saving: the naive purchase (every purchase with its full merma)
    # against what was actually bought, extra reserve packages included. Same
    # rule as ``_material_waste_only_savings`` over the estimate.
    waste_only_savings = _round_half_up(
        sum(
            _waste_only_savings(
                int(cast(int, purchase["design_quantity"])),
                candidate_by_variant[str(purchase["variant_id"])].units_per_package,
                int(cast(int, purchase["paquetes"])),
                candidate_by_variant[str(purchase["variant_id"])].price,
            )
            for purchase in purchases
            if _number(purchase.get("diam_pulg")) is not None
        )
    )
    additional_waste_packages = sum(
        _waste_extra_packages(
            int(cast(int, purchase["design_quantity"])),
            candidate_by_variant[str(purchase["variant_id"])].units_per_package,
            int(cast(int, purchase["paquetes"])),
        )
        for purchase in purchases
        if purchase.get("additional_package_for_waste") is True
    )
    globos_por_tamano: dict[str, int] = {}
    for purchase in purchases:
        size = _text(purchase.get("tamano_codigo"))
        if size:
            globos_por_tamano[size] = globos_por_tamano.get(size, 0) + int(
                cast(int, purchase["design_quantity"])
            )
    budget = (
        _mapping(_mapping(plan).get("restricciones")).get("presupuesto")
        if isinstance(_mapping(plan).get("restricciones"), Mapping)
        else None
    )
    ceiling = _integer(_mapping(budget).get("techo_cop")) if isinstance(budget, Mapping) else None
    state = (
        "APROBACION_REQUERIDA"
        if ceiling is None
        else "PRESUPUESTO_EXCEDIDO"
        if total_cop > ceiling
        else "VERIFICADO"
    )
    snapshot = {
        "catalog_snapshot_id": snapshot_id,
        "estructuras": structures,
        "compras": purchases,
        "total_cop": total_cop,
    }
    canonical = json.dumps(
        # El plan cruza JavaScript entre confirmar y generar, y JavaScript no distingue 2.0 de 2: sin esto, un
        # plan cuyo conteo dejó `ancho_m: 2.0` se firmaba con «2.0» y volvía de /api/generate como «2», y el hash
        # ya no coincidía («Plan hash does not match», CASE-008 de images-judge, 2026-10-05). El snapshot no
        # cruza esa frontera (sale del catálogo en los dos lados) y no se toca.
        {"plan": _numeros_como_en_json(plan), "snapshot": snapshot},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    result: dict[str, object] = {
        "schema_version": PLAN_RESOLVED_VERSION,
        "plan": dict(plan),
        "plan_hash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "request_id": str(request.context.request_id),
        "estructuras": structures,
        "compras": purchases,
        "totales": {
            "globos_por_tamano": globos_por_tamano,
            "total_unidades": sum(
                _integer(structure.get("total_unidades")) or 0 for structure in structures
            ),
            "total_cop": total_cop,
            "design_quantity": sum(
                _integer(item.get("design_quantity")) or 0 for item in purchases
            ),
            **reserve,
            "purchase_cost": total_cop,
            "consumption_cost": sum(
                _integer(item.get("consumption_cost")) or 0 for item in purchases
            ),
            "waste_only_savings_cop": waste_only_savings,
            "additional_waste_packages": additional_waste_packages,
            "ahorro_paquetes_cop": max(0, base_line_cost - total_cop),
            "incluye_iva": True,
            "merma_porcentaje": MERMA * 100,
        },
        "comercial": {
            "estado": state,
            "delta_cop": max(0, total_cop - ceiling) if ceiling is not None else 0,
            **(
                {"techo_cop": ceiling, "procedencia": _mapping(budget).get("procedencia")}
                if ceiling is not None and isinstance(budget, Mapping)
                else {}
            ),
        },
        "alternativas": (
            _alternatives(
                plan,
                structures,
                purchases,
                candidates_by_product,
                allowlist,
                total_cop,
            )
            if _plan_cost_optimizer_enabled()
            else []
        ),
        "merma_log": f"Reserva estadística del {MERMA * 100:g}% distribuida sobre sobrantes compatibles del snapshot {snapshot_id}.",
        "sustituciones": _unique_dicts(
            substitutions, ("estructura_id", "pedido", "entregado", "motivo")
        ),
        "sin_cobertura": _unique_dicts(uncovered, ("estructura_id", "product_id", "tamano")),
        "costes_por_estructura": _imputed_structure_costs(structures, purchases),
        "advertencias": list(dict.fromkeys(warnings)),
    }
    # Derived for the editor and the assembly sheet, outside the snapshot and
    # the hash (ADR-0028 §8). Only structures that carry a pattern: a
    # suggestion here would change the output of every plan without one.
    patterns = _resolved_patterns(plan, bought)
    if patterns:
        result["patrones_color"] = patterns
    # ADR-0030: the same place and the same rule for bouquet assemblies.
    assemblies = _resolved_assemblies(plan, candidate_by_variant)
    if assemblies:
        result["armados_bouquet"] = assemblies
    # ADR-0032: and for garland assemblies, named by the structure's lines.
    garlands = _armados_guirnalda_resueltos(plan, structures)
    if garlands:
        result["armados_guirnalda"] = garlands
    # ADR-0034: y para cada arco y cada columna que trae armado, resueltos por
    # el mismo motor que los contó. Sin el dibujo (``_FUERA_DE_LA_RESOLUCION``).
    arcos = _armados_del_motor_resueltos(plan, "arco")
    if arcos:
        result["armados_arco"] = arcos
    columnas = _armados_del_motor_resueltos(plan, "columna")
    if columnas:
        result["armados_columna"] = columnas
    # El arco orgánico estaba en `_ARMADOS_DEL_MOTOR` y en el contrato (`armados_arco_organico`) desde que se
    # cableó su receta, y **nadie lo publicaba**: la resolución pedía las otras cuatro listas y esta no. El
    # motor lo contaba, pero su hoja —cada globo colocado, la compra, los avisos— no llegaba a ningún sitio
    # (2026-10-04). Portar no es cablear.
    arcos_organicos = _armados_del_motor_resueltos(plan, "arco_organico")
    if arcos_organicos:
        result["armados_arco_organico"] = arcos_organicos
    columnas_organicas = _armados_del_motor_resueltos(plan, "columna_organica")
    if columnas_organicas:
        result["armados_columna_organica"] = columnas_organicas
    organicas = _armados_del_motor_resueltos(plan, "guirnalda")
    if organicas:
        result["armados_guirnalda_organica"] = organicas
    PlanResuelto.model_validate(_compact_patterns(result))
    return result


def _compact_patterns(resolved: Mapping[str, object]) -> Mapping[str, object]:
    """``resolved`` with its patterns' grids compacted, only to validate it.

    Same verdict as validating the whole grids (``para_validar``), without
    walking thousands of balloons per wall twice per resolution.
    """
    patterns = resolved.get("patrones_color")
    if not isinstance(patterns, list):
        return resolved
    return {
        **resolved,
        "patrones_color": [
            para_validar(pattern) if isinstance(pattern, Mapping) else pattern
            for pattern in patterns
        ],
    }


def _motor_units(structure: Mapping[str, object]) -> list[int] | None:
    """Balloons per instance of each material when the motor counts the piece; ``None`` otherwise.

    It is the motor's own count (``_conteo_del_motor``), the one the
    structure's lines buy: a pattern on such a piece (one the decorator chose,
    or one an older confirmation completed) publishes it instead of its grid's
    (``patron_resuelto``'s ``unidades``), so the chart, the assembly sheet and
    the color bar say what is bought.
    """
    motor = _conteo_del_motor(structure)
    if motor is None or motor.total <= 0:
        return None
    units = [0 for _material in _mappings(structure.get("materiales"))]
    for _inches, material, count in motor.celdas:
        if 0 <= material < len(units):
            units[material] += count
    return units


def _bought_matrix(
    plan: Mapping[str, object],
    structure: Mapping[str, object],
    proportions: Sequence[tuple[int, float]],
) -> list[list[int]]:
    """Size x material matrix of what one instance buys, rows in ``proportions`` order.

    The motor's count when it counts the piece (its sizes are ``proportions``,
    from ``_structure_count``), the pattern's split otherwise
    (``_pattern_matrix``, the one ``_despiece_with_plan_sizes`` buys).
    """
    motor = _conteo_del_motor(structure)
    if motor is None:
        return _pattern_matrix(plan, structure, proportions)
    rows = {inches: row for row, (inches, _proportion) in enumerate(proportions)}
    matrix = [[0 for _material in _mappings(structure.get("materiales"))] for _row in proportions]
    for inches, material, count in motor.celdas:
        if inches in rows and 0 <= material < len(matrix[rows[inches]]):
            matrix[rows[inches]][material] += count
    return matrix


def _resolved_patterns(
    plan: Mapping[str, object], bought: Sequence[ComprasPorMaterial]
) -> list[dict[str, object]]:
    """``patrones_color``: each pattern named by what its structure buys (§9).

    ``bought`` comes from ``_resolve_structures``, one entry per structure in
    plan order. A piece its motor counts publishes the motor's count with its
    pattern (``_motor_units``), never the grid's.
    """
    resolved: list[dict[str, object]] = []
    presupuesto = PresupuestoGrafica()
    for position, structure in enumerate(_mappings(plan.get("estructuras"))):
        pattern = structure.get("patron_color")
        if pattern is None:
            continue
        context, notices = _named_by_purchase(
            _pattern_context(plan, structure), bought[position] if position < len(bought) else {}
        )
        try:
            item = patron_resuelto(
                context, _mapping(pattern), aplicado=True, unidades=_motor_units(structure)
            )
        except PatronColorInvalido as error:
            raise _pattern_error(context.estructura_id, error) from error
        if notices:
            item["avisos"] = [*cast(list[str], item["avisos"]), *notices]
        _add_silhouette(plan, structure, item, presupuesto)
        resolved.append(item)
    return resolved


def _pattern_extras(item: Mapping[str, object]) -> list[tuple[int, int]]:
    """``extras`` of an expanded pattern as ``(fila, material)`` pairs."""
    return [
        (_integer(extra.get("fila")) or 0, _integer(extra.get("material")) or 0)
        for extra in _mappings(item.get("extras"))
    ]


def _add_silhouette(
    plan: Mapping[str, object],
    structure: Mapping[str, object],
    item: dict[str, object],
    presupuesto: PresupuestoGrafica,
) -> None:
    """Adds this pattern's silhouette sketch (``posiciones``), or why there is none.

    Drawing only, and outside the snapshot: it rides in ``patrones_color[]``,
    which is added after ``plan_hash`` is signed. The quantities are not
    recomputed here -- the size x material matrix is what the piece buys
    (``_bought_matrix``: the pattern's split, the same one
    ``_despiece_with_plan_sizes`` buys, or the motor's own count when its motor
    counts it), so the silhouette gets one position per quoted balloon and the
    color count per material is the matrix's own columns. It used to take the
    grid's split for a motor piece too, which is not what that piece buys.

    Falling back to the grid is correct, but it may not be silent: without a
    sketch the pattern carries ``sin_silueta`` with the reason, which is what
    the resolver's caller logs.

    Never raises, and that is deliberate rather than defensive. Deriving the
    split calls ``_structure_count``/``_pattern_matrix``, which reject a pattern
    the structure does not admit; a resolution has already run both to buy the
    piece, so it cannot start failing here, but a preview quotes nothing and
    never ran them. A drawing must not decide whether the preview answers, so the
    rejection degrades to the grid with its reason instead of becoming a 422.
    """
    tipo = _text(structure.get("tipo")) or ""
    if not conteo_foto.es_geometrica(structure):
        item["sin_silueta"] = "tipo_sin_silueta"
        return
    celdas = item.get("celdas")
    if not isinstance(celdas, list):
        item["sin_silueta"] = "despiece_incoherente"
        return
    armado = structure.get("armado_guirnalda") if _is_garland(structure) else None
    pieza = pieza_desde_estructura(
        _text(structure.get("estructura_id")) or "",
        tipo,
        _text(structure.get("estructura_oficial")),
        _mapping(structure.get("medidas")),
        armado if isinstance(armado, Mapping) else None,
    )
    # Annotated because mypy runs with ``follow_imports = "skip"``: without it the
    # module boundary hands back ``Any`` and the declared return type is a lie.
    croquis: Croquis
    try:
        _axis, _total, proportions, _unplaced = _structure_count(plan, structure)
        matrix = _bought_matrix(plan, structure, proportions)
    except PlanResolutionError:
        croquis = Croquis(posiciones=None, motivo="despiece_incoherente")
    else:
        croquis = croquis_de_patron(
            pieza,
            cast(list[list[int]], celdas),
            matrix,
            proportions,
            presupuesto,
            _pattern_extras(item),
        )
    if croquis.posiciones is not None:
        item["posiciones"] = croquis.posiciones
    elif croquis.motivo is not None:
        item["sin_silueta"] = croquis.motivo


def _armados_del_motor_resueltos(plan: Mapping[str, object], tipo: str) -> list[dict[str, object]]:
    """``armados_arco`` / ``armados_columna``: una pieza por armado, en orden de plan.

    Fuera del snapshot y del ``plan_hash``, como los demás resueltos: es la
    hoja de armado del instalador y el dato con el que la gráfica muestra la
    pieza sin recalcularla.

    Sale de la misma puerta que la contó, así que publica exactamente los
    globos que se cotizaron, ya recortada a lo que el contrato publica. Va
    copiada porque ``_pieza_del_motor`` la recuerda: lo que se publica se
    serializa y se manosea fuera de aquí, y una pieza compartida con la memoria
    del motor acabaría contando otra cosa.
    """
    resueltos: list[dict[str, object]] = []
    for structure in _mappings(plan.get("estructuras")):
        entrada = _armado_del_motor(structure)
        if entrada is None or entrada[0] != tipo:
            continue
        resuelto = _resolver_con_el_motor(entrada[0], entrada[1], structure)
        publicado = cast(dict[str, object], json.loads(json.dumps(resuelto)))
        frases = _FRASES_DE_LA_IMAGEN.get(tipo)
        if frases is not None:
            # ADR-0035: Python cuenta el armado a los modelos de imagen. Derivado, fuera del snapshot y del hash.
            # Vacío y no `None` cuando el plan no lo dice: las cinco frases tratan la cadena vacía como «no
            # consta», y así la tabla tiene una sola firma en vez de dos.
            materiales = [
                (_text(material.get("color")) or "", _text(material.get("acabado")) or "")
                for material in _mappings(structure.get("materiales"))
            ]
            publicado["estructura_id"] = _text(structure.get("estructura_id")) or ""
            publicado["prompt_gemini"], publicado["prompt_lora"] = frases(
                entrada[1], resuelto, materiales
            )
            # Las cifras de cada color (referencia Sempertex, Pantone, color del globo inflado) ya no se pegan
            # aquí, solo a las piezas del motor: el prompt de Gemini las lleva en UN bloque para todas las
            # piezas con globos (`bloqueColoresExactos` en build-image-prompt.ts, 2026-10-04, G4).
        resueltos.append(publicado)
    return resueltos


def _plan_to_resolve(request: PlanResolutionRequest) -> tuple[dict[str, object], list[str]]:
    """The completed plan a resolution works on, validated (patterns expanded).

    With the ``advertencias`` entries that completing its patterns produced
    (``_complete_plan``), which the resolved plan reports.
    """
    warnings: list[str] = []
    raw_plan = _complete_plan(
        request.plan,
        completar_patrones=request.completar_patrones,
        pistas=[pista.model_dump(exclude_none=True) for pista in request.pistas_patron],
        tamanos=[pista.model_dump(exclude_none=True) for pista in request.pistas_tamanos],
        pistas_geometria=request.pistas_geometria,
        medidas_del_cliente=request.medidas_del_cliente,
        medidas_cliente_de=request.medidas_cliente_de or (),
        avisos=warnings,
    )
    try:
        PlanDecoracion.model_validate(raw_plan)
    except ValidationError as error:
        raise PlanResolutionError("invalid_plan", 422) from error
    return raw_plan, warnings


async def resolve_plan(
    request: PlanResolutionRequest,
    catalog_store: CatalogPlanStore,
) -> dict[str, object]:
    """Resolve a plan and validate all three domain outputs before returning.

    The CPU-bound parts (completing the plan, resolving it and validating the
    results) run in the plan's worker (``run_plan_cpu``), off the event loop;
    only the catalog round trips stay on it.
    """
    raw_plan, completion_warnings = await run_plan_cpu(_plan_to_resolve, request)
    allowlist_pairs = _allowlist_pairs(request.allowlist)
    declared_pairs = _declared_pairs(raw_plan)
    pairs = allowlist_pairs | declared_pairs
    product_ids, variant_ids = _ids_for_plan(raw_plan, request.allowlist)
    requested_snapshot = request.catalog_snapshot_id

    async def no_identity() -> Sequence[Mapping[str, object]]:
        return ()

    # Both checks only depend on the requested snapshot, so they run together:
    # each is a network round trip to the catalog database (about 250 ms from a
    # developer machine to Neon) and a card edit resolves twice. They keep their
    # order of precedence (an unpublished snapshot is reported before an
    # ownership mismatch), and the commercial rows are only read once both pass.
    published, identity = await asyncio.gather(
        catalog_store.published_snapshot(requested_snapshot),
        catalog_store.fetch_catalog_identity(
            requested_snapshot,
            sorted({product_id for product_id, _variant_id in pairs}),
            sorted({variant_id for _product_id, variant_id in pairs}),
        )
        if pairs
        else no_identity(),
        return_exceptions=True,
    )
    if isinstance(published, BaseException):
        raise published
    if published is None:
        raise PlanResolutionError("catalog_snapshot_not_found", 422)
    snapshot_id = published
    if isinstance(identity, BaseException):
        raise identity
    if pairs and _product_variant_mismatches(identity, allowlist_pairs, declared_pairs):
        raise PlanResolutionError("allowlist_product_mismatch", 422)
    rows = await catalog_store.fetch_plan_rows(
        snapshot_id,
        product_ids,
        variant_ids,
    )
    result: dict[str, object] = await run_plan_cpu(
        _resolution_result, request, raw_plan, snapshot_id, rows, completion_warnings
    )
    return result


def _bouquet_context(
    structure: Mapping[str, object], candidate_by_variant: Mapping[str, Candidate]
) -> EstructuraBouquet:
    """What the assembly rules need of one structure: its balloons and what it buys.

    The quantities are the kit branch own ones (``_distribute_units``), so an
    assembly can only arrange what the plan already buys.
    """
    materials = _mappings(structure.get("materiales"))
    classified: list[MaterialBouquet | None] = []
    for index, material in enumerate(materials):
        candidate = candidate_by_variant.get(_text(material.get("variant_id")) or "")
        if candidate is None or candidate.product_id != _text(material.get("product_id")):
            classified.append(None)
            continue
        balloon = GloboCatalogo(
            product_id=candidate.product_id,
            variant_id=candidate.variant_id,
            titulo=candidate.title,
            forma=candidate.shape,
            diam_pulg=candidate.diameter_inches,
            codigo_tamano=candidate.size_code,
            color=_line_color(candidate, _text(material.get("color"))),
            acabado=candidate.finishes[0] if candidate.finishes else None,
        )
        classified.append(clasificar(index, balloon))
    return EstructuraBouquet(
        estructura_id=_text(structure.get("estructura_id")) or "",
        es_bouquet=structure.get("tipo") == "kit"
        and structure.get("estructura_oficial") == "bouquet",
        repeticiones=_integer(structure.get("repeticiones")) or 1,
        materiales=tuple(classified),
        cantidades=tuple(
            _distribute_units(_integer(structure.get("unidades_declaradas")) or 0, materials)
        ),
    )


def _assign_assemblies(
    plan: Mapping[str, object],
    candidate_by_variant: Mapping[str, Candidate],
    pistas: Sequence[Mapping[str, object]],
    only: Collection[str] | None = None,
) -> dict[str, object]:
    """Photo reading first, recipe otherwise (ADR-0030); only bouquets without one.

    A bouquet that cannot be arranged without changing what it buys keeps its
    plain declared units. Nothing else in the plan changes. With ``only``, the
    other structures are left as they are (the re-resolution after an edit).
    """
    completed = dict(plan)
    structures: list[object] = []
    raw_assumptions = plan.get("supuestos")
    assumptions = [
        a
        for a in (raw_assumptions if isinstance(raw_assumptions, list) else [])
        if isinstance(a, str)
    ]
    changed = False
    for structure in _mappings(plan.get("estructuras")):
        item = dict(structure)
        wanted = only is None or _text(item.get("estructura_id")) in only
        if wanted and item.get("armado_bouquet") is None:
            context = _bouquet_context(item, candidate_by_variant)
            if context.es_bouquet:
                element_id = _text(item.get("referencia_element_id"))
                reading = next(
                    (
                        pista
                        for pista in pistas
                        if element_id is not None
                        and pista.get("referencia_element_id") == element_id
                        and (_number(pista.get("confianza")) or 0.0) >= CONFIANZA_MINIMA_LECTURA
                    ),
                    None,
                )
                # The photo decides what is bought (2026-09-25): count and
                # colors per balloon, when everything it read is purchasable.
                bought = compra_desde_lectura(context, reading) if reading is not None else None
                if bought is not None:
                    item, notices = _comprar_lo_leido(item, context, bought)
                    context = _bouquet_context(item, candidate_by_variant)
                    assumptions.extend(notices)
                    changed = True
                    try:
                        validar(context, _mapping(item["armado_bouquet"]))
                    except ArmadoInvalido:
                        item.pop("armado_bouquet", None)
                if item.get("armado_bouquet") is None:
                    assembly = sugerir_armado(context, reading)
                    if assembly is not None:
                        item["armado_bouquet"] = assembly
        structures.append(item)
    completed["estructuras"] = structures
    if changed:
        completed["supuestos"] = list(dict.fromkeys(assumptions))
        _validate_plan(completed)
    return completed


def _shares_of(quotas: Sequence[float]) -> list[float]:
    """Shares rounded to six decimals, the last one absorbing the rest (as ``participaciones``)."""
    rounded = [round(quota, 6) for quota in quotas[:-1]]
    return [*rounded, round(1 - sum(rounded), 6)]


def _comprar_lo_leido(
    structure: Mapping[str, object], context: EstructuraBouquet, bought: CompraLeida
) -> tuple[dict[str, object], list[str]]:
    """The bouquet as the photo shows it: units, shares and the assembly itself.

    Materials the photo does not show leave the structure (with a notice for
    the customer); the assembly's indices follow the materials that stay.
    ``unidades_declaradas`` counts every repetition, as the contract says.
    """
    materials = _mappings(structure.get("materiales"))
    kept = [index for index, units in enumerate(bought.cantidades) if units > 0]
    remap = {old: new for new, old in enumerate(kept)}
    total = bought.total
    shares = _shares_of([bought.cantidades[index] / total for index in kept])
    new_materials = [
        {**dict(materials[index]), "participacion": share}
        for index, share in zip(kept, shares, strict=True)
    ]
    if not any(material.get("rol_material") == "principal" for material in new_materials):
        new_materials[0]["rol_material"] = "principal"
    assembly = json.loads(json.dumps(bought.armado))
    for level in assembly["niveles"]:
        level["posiciones"] = [remap[index] for index in level["posiciones"]]
    if "remate" in assembly:
        assembly["remate"] = [remap[index] for index in assembly["remate"]]
    if "numero" in assembly:
        assembly["numero"]["digitos"] = [remap[index] for index in assembly["numero"]["digitos"]]
    before = _integer(structure.get("unidades_declaradas")) or 0
    reps = context.repeticiones
    name = _text(structure.get("nombre")) or "Bouquet de globos"
    notices = []
    if before != total * reps:
        notices.append(
            f"{name}: la foto muestra {total} globos por bouquet, así que la cantidad quedó en "
            f"{total * reps} (el plan decía {before})."
        )
    # A latex whose color stays in another size was not "missing from the photo".
    reasons = dict(bought.quitados)
    dropped: dict[str, list[str]] = {}
    for index, units in enumerate(bought.cantidades):
        if units:
            continue
        label = _text(materials[index].get("color")) or "un material"
        reason = reasons.get(index, "sin_color")
        classified = context.materiales[index]
        if reason != "sin_color" and classified is not None and classified.tamano_pulg:
            label = f"{label} de {classified.tamano_pulg:g} pulgadas"
        dropped.setdefault(reason, []).append(label)
    because = {
        "sin_color": "porque la foto no lo lleva",
        "otro_tamano": "porque la foto lleva ese color en otro tamaño",
        "sin_tamano": "porque la lectura de la foto no dice el tamaño de ese color",
    }
    for reason, labels in dropped.items():
        notices.append(f"{name}: se quitó {', '.join(labels)} {because[reason]}.")
    return (
        {
            **dict(structure),
            "unidades_declaradas": total * reps,
            "materiales": new_materials,
            "armado_bouquet": assembly,
        },
        notices,
    )


def _resolved_assemblies(
    plan: Mapping[str, object], candidate_by_variant: Mapping[str, Candidate]
) -> list[dict[str, object]]:
    """``armados_bouquet``: one per structure that carries an assembly."""
    resolved: list[dict[str, object]] = []
    for structure in _mappings(plan.get("estructuras")):
        assembly = structure.get("armado_bouquet")
        if assembly is None:
            continue
        context = _bouquet_context(structure, candidate_by_variant)
        try:
            resolved.append(armado_resuelto(context, _mapping(assembly)))
        except ArmadoInvalido as error:
            raise PlanResolutionError(
                "armado_invalido",
                422,
                {
                    "estructura_id": context.estructura_id,
                    "motivo": error.motivo,
                    "mensaje": error.mensaje,
                },
            ) from error
    return resolved


def contexto_bouquet_de_globos(
    structure: Mapping[str, object], globos: Sequence[Mapping[str, object]] | None
) -> EstructuraBouquet:
    """The assembly context of one structure without a catalog (ADR-0030, second delivery).

    ``globos`` are what the browser holds of the structure's resolved lines
    (``plan_resuelto.estructuras[].lineas``: title, shape, size, color, finish),
    reduced to what ``clasificar`` reads; each material is matched by its
    ``variant_id`` and, failing that, by product and color. They only classify:
    the quantities are the plan's own (``_distribute_units``), never the lines'
    units. Without ``globos`` every material is unclassified, which is enough
    to check an assembly's shape and counts (``validar``); the helium rule and
    the resolved sheet need the catalog facts and are checked at resolution.
    """
    materials = _mappings(structure.get("materiales"))
    lines = list(globos or [])
    classified: list[MaterialBouquet | None] = []
    for index, material in enumerate(materials):
        product_id = _text(material.get("product_id")) or ""
        variant_id = _text(material.get("variant_id")) or ""
        line = next(
            (
                g
                for g in lines
                if g.get("variant_id") == variant_id and g.get("product_id") == product_id
            ),
            None,
        ) or next(
            (
                g
                for g in lines
                if g.get("product_id") == product_id
                and _text(g.get("color")) == _text(material.get("color"))
            ),
            None,
        )
        if line is None:
            classified.append(None)
            continue
        balloon = GloboCatalogo(
            product_id=product_id,
            variant_id=_text(line.get("variant_id")) or variant_id,
            titulo=_text(line.get("titulo")) or "",
            forma=_text(line.get("forma")),
            diam_pulg=_number(line.get("diam_pulg")),
            codigo_tamano=_text(line.get("tamano_codigo")),
            color=_text(line.get("color")),
            acabado=_text(line.get("acabado")),
        )
        classified.append(clasificar(index, balloon))
    return EstructuraBouquet(
        estructura_id=_text(structure.get("estructura_id")) or "",
        es_bouquet=structure.get("tipo") == "kit"
        and structure.get("estructura_oficial") == "bouquet",
        repeticiones=_integer(structure.get("repeticiones")) or 1,
        materiales=tuple(classified),
        cantidades=tuple(
            _distribute_units(_integer(structure.get("unidades_declaradas")) or 0, materials)
        ),
    )


def _assembly_error(estructura_id: str, error: ArmadoInvalido) -> PlanResolutionError:
    return PlanResolutionError(
        "armado_invalido",
        422,
        {"estructura_id": estructura_id, "motivo": error.motivo, "mensaje": error.mensaje},
    )


@dataclass(frozen=True, slots=True)
class VistaPreviaArmado:
    """One bouquet's resolved assembly and what the editor may offer for it."""

    armado: dict[str, object]
    variantes_admitidas: list[str]
    disposiciones_admitidas: list[str]


def vista_previa_de_armado(
    plan: Mapping[str, object],
    estructura_id: str,
    armado: Mapping[str, object] | None,
    globos: Sequence[Mapping[str, object]],
    *,
    variante: str | None = None,
    disposicion: str | None = None,
) -> VistaPreviaArmado:
    """Resolved assembly of one bouquet, without a catalog (ADR-0030, second delivery).

    ``armado`` replaces the structure's own ``armado_bouquet`` and comes back
    resolved with the same function resolution uses (``armado_resuelto``):
    legend, levels, supplies, steps and prompts. ``None`` asks for the recipe
    (``sugerir_armado``), with ``variante`` and ``disposicion`` when the
    decorator chose a style or where the numbers go; the photo reading is not
    consulted here (the editor starts from what the plan carries). ``globos``
    classify each material (``contexto_bouquet_de_globos``); the counts are the
    plan's. Raises ``PlanResolutionError``: ``estructura_no_encontrada`` (404),
    ``invalid_plan`` (422) or ``armado_invalido`` (422, with ``motivo`` and
    ``mensaje``; ``sin_armado_posible`` when no recipe fits the purchase).
    """
    _validate_plan(plan)
    structure = _mappings(plan.get("estructuras"))[_structure_index(plan, estructura_id)]
    context = contexto_bouquet_de_globos(structure, globos)
    if not context.es_bouquet:
        raise _assembly_error(
            estructura_id,
            ArmadoInvalido("no_es_bouquet", "Solo un bouquet puede tener armado por niveles."),
        )
    try:
        if armado is None:
            chosen = sugerir_armado(context, variante=variante, disposicion=disposicion)
            if chosen is None:
                raise ArmadoInvalido(
                    "sin_armado_posible",
                    "Con estos globos no se puede armar el bouquet sin cambiar la compra.",
                )
        else:
            chosen = dict(armado)
        resolved = armado_resuelto(context, chosen)
    except ArmadoInvalido as error:
        raise _assembly_error(estructura_id, error) from error
    return VistaPreviaArmado(
        armado=resolved,
        variantes_admitidas=variantes_admitidas(context),
        disposiciones_admitidas=disposiciones_admitidas(context),
    )


def opciones_de_armado(
    plan: Mapping[str, object], estructura_id: str, globos: Sequence[Mapping[str, object]]
) -> tuple[list[str], list[str]]:
    """``(variantes_admitidas, disposiciones_admitidas)`` of one bouquet, for a rejected preview.

    The empty pair when the plan or the structure cannot be read: the editor
    then offers nothing rather than something the purchase forbids.
    """
    try:
        _validate_plan(plan)
        structure = _mappings(plan.get("estructuras"))[_structure_index(plan, estructura_id)]
    except PlanResolutionError:
        return [], []
    context = contexto_bouquet_de_globos(structure, globos)
    return variantes_admitidas(context), disposiciones_admitidas(context)


def validar_armado_sin_catalogo(
    structure: Mapping[str, object], armado: Mapping[str, object]
) -> None:
    """Shape and counts of an assembly against the plan alone (the edit, ADR-0030).

    The helium rule needs the catalog and is checked again at resolution.
    Raises ``PlanResolutionError`` ``armado_invalido``.
    """
    context = contexto_bouquet_de_globos(structure, None)
    try:
        validar(context, armado)
    except ArmadoInvalido as error:
        raise _assembly_error(context.estructura_id, error) from error


def _resolution_result(
    request: PlanResolutionRequest,
    raw_plan: Mapping[str, object],
    snapshot_id: str,
    rows: Sequence[Mapping[str, object]],
    completion_warnings: Sequence[str] = (),
) -> dict[str, object]:
    """``plan-resolution-result.v1`` from the catalog rows, validated (CPU only).

    ``completion_warnings`` come from ``_plan_to_resolve`` and end up in ``advertencias``.
    """
    allowlist = {entry.product_id: set(entry.variant_ids) for entry in request.allowlist}
    candidates_by_product: dict[str, list[Candidate]] = {}
    candidate_by_variant: dict[str, Candidate] = {}
    for row in rows:
        candidate = _candidate(row, snapshot_id)
        if candidate is None:
            continue
        candidates_by_product.setdefault(candidate.product_id, []).append(candidate)
        candidate_by_variant[candidate.variant_id] = candidate
    assembly_hints = [pista.model_dump(exclude_none=True) for pista in request.pistas_armado]
    photo_counts: list[dict[str, object]] = []
    if request.completar_conteos:
        # Count first, then the bouquet and garland recipes: they see the final density and measures.
        # ADR-0031: the count decides how many balloons a piece has and the
        # assemblies only arrange them; it counts with _structure_count, so a
        # hanging garland (ADR-0032) is compared by its cord. It rewrites the
        # bouquet assembly hints it rescaled or discarded.
        raw_plan, assembly_hints, photo_counts = _aplicar_conteos(
            request,
            raw_plan,
            candidates_by_product,
            candidate_by_variant,
            allowlist,
            assembly_hints,
        )
    if request.completar_armados:
        # Needs the catalog (balloon kind and size), so it happens here and not
        # in _complete_plan; before _build_resolved, because the assembly is
        # part of the signed plan.
        raw_plan = _assign_assemblies(
            raw_plan,
            candidate_by_variant,
            assembly_hints,
            only=(
                None if request.completar_armados_de is None else set(request.completar_armados_de)
            ),
        )
    if request.completar_armados_guirnalda:
        # ADR-0032: the recipe needs no catalog, only the completed plan; it
        # goes here, next to the bouquets, before _build_resolved signs it. A
        # pattern this confirmation completed is suggested again by cluster
        # once the garland has its assembly (decision 20).
        raw_plan = _completar_armados_guirnalda(
            raw_plan,
            only=(
                None if request.completar_armados_de is None else set(request.completar_armados_de)
            ),
            pistas=request.pistas_guirnalda,
            patrones_completados=_patterns_completed(request),
            pistas_patron=[pista.model_dump(exclude_none=True) for pista in request.pistas_patron],
        )
    resolved = _build_resolved(
        request,
        raw_plan,
        snapshot_id,
        candidates_by_product,
        candidate_by_variant,
        allowlist,
        completion_warnings,
    )
    if photo_counts:
        # Derived, outside the snapshot and the hash (ADR-0031), like armados_bouquet.
        resolved["conteos_referencia"] = photo_counts
    garland_readings = _garland_readings(raw_plan, request.pistas_guirnalda)
    if garland_readings:
        # Outside the hash too (ADR-0032): Next sends them back when an edit
        # re-resolves the plan, so a re-suggested assembly keeps the photo's
        # support and shape (review finding 32), as the counts do.
        resolved["lecturas_guirnalda"] = garland_readings
    estimate = _material_estimate(resolved)
    quote = _quote(resolved)
    result: dict[str, object] = {
        "operation_schema_version": PLAN_RESOLUTION_RESULT_VERSION,
        "catalog_snapshot_id": snapshot_id,
        "plan_resuelto": resolved,
        "material_estimate": estimate,
        "quote": quote,
    }
    PlanResolutionResult.model_validate({**result, "plan_resuelto": _compact_patterns(resolved)})
    return result


def _patterns_completed(request: PlanResolutionRequest) -> set[str]:
    """Structures whose ``patron_color`` this resolution completed (``completar_patrones``).

    The ones the request's plan brings without a pattern; a pattern the
    decorator or the chat declared is not suggested again.
    """
    if not request.completar_patrones:
        return set()
    return {
        str(structure.get("estructura_id"))
        for structure in _mappings(request.plan.get("estructuras"))
        if structure.get("patron_color") is None
    }


def _garland_readings(
    plan: Mapping[str, object], hints: Sequence[Mapping[str, object]]
) -> list[dict[str, object]]:
    """The request's garland readings that belong to a garland of the plan, as received.

    What ``lecturas_guirnalda`` returns (review finding 32): the photo does
    not travel with an edit, so these are what lets the next re-resolution
    suggest the assembly from it again. Only readings whose reference element
    is a garland of the plan; the confidence rule is applied where they are
    used (``sugerir_armado``), not here.
    """
    garlands = {
        _text(structure.get("referencia_element_id"))
        for structure in _mappings(plan.get("estructuras"))
        if _is_garland(structure)
    } - {None}
    return [dict(hint) for hint in hints if _text(hint.get("referencia_element_id")) in garlands]


def _validate_plan(plan: Mapping[str, object]) -> None:
    try:
        PlanDecoracion.model_validate(plan)
    except ValidationError as error:
        raise PlanResolutionError("invalid_plan", 422) from error


# --- Conteo de la foto (ADR-0031) -------------------------------------------------
# The rules live in app/conteo_foto.py; this only hands them what they need from
# the resolver (count, physical gate, mix coverage, kit context) and never
# changes how any of those is computed.


def _mix_covered(
    structure: Mapping[str, object],
    mix: str,
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    allowlist: Mapping[str, set[str]],
) -> bool:
    """Every size of ``mix`` has a sellable round balloon for every material of the structure."""
    for material in _mappings(structure.get("materiales")):
        product_id = _text(material.get("product_id")) or ""
        options = [
            candidate
            for candidate in candidates_by_product.get(product_id, ())
            if candidate.variant_id in allowlist.get(product_id, set())
        ]
        color = _text(material.get("color"))
        if any(not _compatible(options, diameter, color, False) for diameter, _p in _MIXES[mix]):
            return False
    return True


def _gate_warnings(
    plan: Mapping[str, object], structure: Mapping[str, object], total: int
) -> list[str]:
    """``_physical_warnings`` on one instance with ``total`` balloons."""
    axis = _structure_count(plan, structure)[0]
    probe = {
        "estructura_id": _text(structure.get("estructura_id")) or "",
        "tipo": _text(structure.get("tipo")) or "",
        "repeticiones": 1,
        "eje_m": axis,
        "lineas": [{"unidades": total, "diam_pulg": 12}],
    }
    return _physical_warnings(
        {"estructuras": [structure], "restricciones": plan.get("restricciones")}, [probe]
    )


def _within_physical_gate(
    plan: Mapping[str, object], structure: Mapping[str, object], total: int
) -> bool:
    """``_physical_warnings`` on one instance with ``total`` balloons: no warning, inside the gate."""
    return not _gate_warnings(plan, structure, total)


def _resynced_pattern(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> dict[str, object] | None:
    """The structure with ``participacion`` rewritten from its new grid, or ``None`` if the pattern no longer fits."""
    single = {**dict(plan), "estructuras": [dict(structure)]}
    try:
        synced = _sync_participations(single, single, only=0)
    except PlanResolutionError:
        return None
    return dict(_mappings(synced.get("estructuras"))[0])


# --- Estimar el conteo (solo lectura) -----------------------------------------------
# ``app/estimar_conteo.py`` responde a la herramienta de la IA cuántos globos
# cobraría una pieza y qué mando la acerca a un objetivo. Aquí solo se abre, sin
# escribir nada ni duplicar nada, lo que ya decide el conteo: la fórmula, el motor
# y la puerta física. Ninguna función de esta sección toca un plan resuelto, un token ni
# ``plan_hash``.


def _plan_de_estimacion(
    structure: Mapping[str, object], tamanos_obligatorios: Collection[int]
) -> dict[str, object]:
    """El plan mínimo que ``_structure_count`` y la puerta física leen: la pieza y los tamaños fijos."""
    return {
        "estructuras": [dict(structure)],
        "restricciones": {
            "tamanos": [
                {"valor": f"R-{pulgadas}", "polaridad": "obligatorio"}
                for pulgadas in sorted(set(tamanos_obligatorios))
            ]
        },
    }


def con_medidas_por_defecto(structure: Mapping[str, object]) -> tuple[dict[str, object], bool]:
    """La pieza con las medidas que el plan le asumiría si le faltan, y si asumió alguna.

    Es ``_complete_measures``, la misma que corre al confirmar: un arco sin medidas se cuenta
    con las de por defecto, no se rechaza. Sin el tipo de espacio no se sabe si es exterior,
    así que se asume interior, como el plan cuando el espacio no lo dice.
    """
    completo = _complete_measures({"espacio": {}, "estructuras": [dict(structure)]})
    return dict(_mappings(completo.get("estructuras"))[0]), bool(completo.get("supuestos"))


@dataclass(frozen=True, slots=True)
class PiezaContada:
    """Lo que cuenta una pieza por instancia: la fórmula, el motor y el que se cobraría.

    ``total_vigente`` es el que ``resolve_plan`` cobraría: el del motor si la pieza
    trae su armado, si no el de la fórmula. ``total_formula`` se calcula siempre, para
    poder decir cuánto se aleja el motor de ella; con armado, la fórmula **no** manda.
    """

    eje_m: float
    total_vigente: int
    fuente: Literal["formula", "motor"]
    total_formula: int
    total_motor: int | None
    #: Pulgadas y cantidad del conteo vigente, de menor a mayor tamaño.
    reparto_por_tamano: tuple[tuple[int, int], ...]
    #: Tamaños obligatorios del cliente que la mezcla o el armado no colocaron.
    tamanos_sin_ubicar: tuple[int, ...]
    avisos_motor: tuple[str, ...]
    #: ``4,8 · L / d`` del motor del arco: un ancla independiente de ``total_formula``.
    formula_clasica: float | None
    avisos_puerta: tuple[str, ...]


def contar_pieza(
    structure: Mapping[str, object], tamanos_obligatorios: Collection[int] = ()
) -> PiezaContada:
    """Cuenta una pieza (``estructuras[]`` del plan) por instancia, como la contaría ``resolve_plan``.

    Es de solo lectura y pura CPU. Con armado del motor lo cuenta el motor (que ignora
    medidas, densidad y mezcla del plan); un armado que no se sostiene lanza
    ``PlanResolutionError("armado_invalido")``, igual que la resolución.
    """
    plan = _plan_de_estimacion(structure, tamanos_obligatorios)
    eje_formula, total_formula, proportions, sin_ubicar = _formula_count(plan, structure)
    motor = _conteo_del_motor(structure)
    if motor is None:
        reparto = tuple(
            (pulgadas, cantidad)
            for (pulgadas, _proporcion), cantidad in zip(
                proportions, _size_totals(total_formula, proportions), strict=True
            )
            if cantidad > 0
        )
        total, eje, fuente = total_formula, eje_formula, "formula"
    else:
        por_tamano: dict[int, int] = {}
        for pulgadas, _material, cantidad in motor.celdas:
            por_tamano[pulgadas] = por_tamano.get(pulgadas, 0) + cantidad
        reparto = tuple(sorted((pulgadas, cantidad) for pulgadas, cantidad in por_tamano.items()))
        total, eje, fuente = motor.total, motor.eje_m, "motor"
        sin_ubicar = motor.sin_ubicar(_required_sizes(plan))
    return PiezaContada(
        eje_m=eje,
        total_vigente=total,
        fuente=cast(Literal["formula", "motor"], fuente),
        total_formula=total_formula,
        total_motor=None if motor is None else motor.total,
        reparto_por_tamano=reparto,
        tamanos_sin_ubicar=tuple(sin_ubicar),
        avisos_motor=() if motor is None else motor.avisos,
        formula_clasica=None if motor is None else motor.formula_clasica,
        avisos_puerta=tuple(_gate_warnings(plan, structure, total)),
    )


def puerto_de_conteo(tamanos_obligatorios: Collection[int] = ()) -> conteo_foto.PuertoPlan:
    """El ``PuertoPlan`` de ``conteo_foto`` para piezas contadas por la fórmula, sin catálogo.

    Lo usa la estimación para reutilizar la búsqueda de ``conteo_foto`` (la que corre al
    confirmar un plan con la foto) en vez de duplicarla. Cuenta con la fórmula y mide la
    puerta física con la del plan; no hay catálogo, así que no puede afirmar que una mezcla
    esté cubierta (``mezcla_cubierta`` es falsa y la mezcla nunca cambia) ni hay kits ni
    patrones de color que sincronizar.
    """
    tamanos = frozenset(tamanos_obligatorios)

    def sin_kits(_structure: Mapping[str, object]) -> EstructuraBouquet:
        raise PlanResolutionError("invalid_plan", 422)

    return conteo_foto.PuertoPlan(
        contar=lambda structure: _formula_count(_plan_de_estimacion(structure, tamanos), structure)[
            1
        ],
        dentro_de_puerta=lambda structure, total: not _gate_warnings(
            _plan_de_estimacion(structure, tamanos), structure, total
        ),
        mezcla_cubierta=lambda _structure, _mix: False,
        contexto_kit=sin_kits,
        sincronizar_patron=lambda structure: dict(structure),
        mezclas=_MIXES,
        tamanos_obligatorios=bool(tamanos),
        densidades_admitidas=_admitted_densities,
    )


def _ids_medidas_fijas_en_conteo(
    plan: Mapping[str, object],
    pistas_geometria: Sequence[Mapping[str, object]],
    medidas_cliente_de: Sequence[str] | None,
    medidas_del_cliente: bool,
) -> set[str]:
    """Las piezas cuyas medidas no mueve el conteo de la foto: las que dio el cliente y las que su caja ancló.

    Una pista de geometría no fija nada por existir: Next la manda para toda pieza con referencia. Solo fija la
    pieza cuya caja ``_medir_desde_cajas`` usó de verdad (``anclados``), con las mismas entradas con las que
    ``_complete_plan`` midió el plan. Una caja cortada por un borde, poco confiable o en una foto sin pieza que
    dé escala deja medidas supuestas, y esas sí las puede mover el conteo dentro de la puerta física. Hasta el
    2026-10-07 bastaba la pista: las dos columnas de la foto de ejemplo 01 (caja cortada arriba y ninguna pieza
    que escale) se quedaban en 44 globos con unos 75 en la foto, «con las medidas físicas fijas», con la altura
    estándar de 1,8 m (S1 del comparador 130).
    """
    ids_por_referencia = {
        _text(pista.get("referencia_element_id"))
        for pista in pistas_geometria
        if _text(pista.get("referencia_element_id"))
    }
    if medidas_cliente_de is not None or ids_por_referencia:
        anclados: set[str] = set()
        _medir_desde_cajas(
            plan,
            pistas_geometria,
            medidas_del_cliente=medidas_del_cliente,
            medidas_cliente_de=medidas_cliente_de or (),
            anclados=anclados,
        )
        return set(medidas_cliente_de or ()) | anclados
    # Compatibilidad con llamadas anteriores al contrato por pieza.
    return (
        {
            _text(structure.get("estructura_id")) or ""
            for structure in _mappings(plan.get("estructuras"))
            if any(
                _number(_mapping(structure.get("medidas") or {}).get(key)) is not None
                for key in ("ancho_m", "alto_m", "largo_m")
            )
        }
        if medidas_del_cliente
        else set()
    )


def _aplicar_conteos(
    request: PlanResolutionRequest,
    plan: Mapping[str, object],
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    candidate_by_variant: Mapping[str, Candidate],
    allowlist: Mapping[str, set[str]],
    assembly_hints: Sequence[Mapping[str, object]],
) -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]]]:
    """The plan adjusted to the photo's counts (ADR-0031), the assembly hints to use and ``conteos_referencia``."""
    medidas_fijas = _ids_medidas_fijas_en_conteo(
        request.plan, request.pistas_geometria, request.medidas_cliente_de, request.medidas_del_cliente
    )
    # A garland this confirmation assembles from its photo reading is counted
    # with the drop and tilt that reading will give it (decision 27).
    counted = _counted_with_read_geometry(request)
    port = conteo_foto.PuertoPlan(
        contar=lambda structure: _structure_count(plan, counted(structure))[1],
        dentro_de_puerta=lambda structure, total: _within_physical_gate(
            plan, counted(structure), total
        ),
        mezcla_cubierta=lambda structure, mix: _mix_covered(
            structure, mix, candidates_by_product, allowlist
        ),
        contexto_kit=lambda structure: _bouquet_context(structure, candidate_by_variant),
        sincronizar_patron=lambda structure: _resynced_pattern(plan, structure),
        mezclas=_MIXES,
        tamanos_obligatorios=bool(_required_sizes(plan)),
        densidades_admitidas=_admitted_densities,
        medidas_del_cliente=lambda structure: (_text(structure.get("estructura_id")) or "")
        in medidas_fijas,
        variantes_redondas=lambda product_id: _round_variants(
            product_id, candidates_by_product, allowlist
        ),
        cuenta_el_motor=lambda structure: _armado_del_motor(structure) is not None,
        recetas_del_motor=_recetas_del_motor_por_densidad,
    )
    # The size reading owns the mix (``_assign_mixes``, and the motor arms with it): the count's
    # per-size split, which also sees a column's crown, does not move it again.
    read_mixes = {
        pista.referencia_element_id
        for pista in request.pistas_tamanos
        if mezcla_del_motor(pista.model_dump(exclude_none=True), []) is not None
    }
    adjusted, hints, counts = conteo_foto.aplicar(
        plan,
        request.pistas_conteo,
        assembly_hints,
        usar_armados=request.completar_armados,
        solo=None if request.completar_conteos_de is None else set(request.completar_conteos_de),
        puerto=port,
        mezclas_leidas=read_mixes,
    )
    if any(count["decision"] == "ajustado" for count in counts):
        adjusted = _garland_assemblies_after_count(adjusted, counts, request.pistas_guirnalda)
        _validate_plan(adjusted)
    if counts:
        _decidir(
            "regla:conteo_referencia",
            "qué hace el plan con los globos que cuenta la foto en cada pieza",
            [
                {
                    "estructura_id": count["estructura_id"],
                    "decision": count["decision"],
                    "globos_foto": count["globos_foto"],
                    "globos_antes": count["globos_antes"],
                    "globos_despues": count["globos_despues"],
                    "cambios": count["cambios"],
                    "motivo": count["motivo"],
                }
                for count in counts
            ],
            "conteo_foto.aplicar: las medidas solo quedan fijas si las dio el cliente o si la caja de la foto"
            " ancló de verdad la escala; una pieza con armado del motor la cuenta su armado, y al confirmar"
            " se queda la receta del motor (por densidad) más cercana a la foto",
            entrada={
                "medidas_fijas": sorted(medidas_fijas),
                "medidas_cliente_de": request.medidas_cliente_de,
                "piezas_con_pista_de_geometria": sorted(
                    {
                        _text(pista.get("referencia_element_id")) or ""
                        for pista in request.pistas_geometria
                    }
                ),
            },
        )
        recalibradas = [
            {
                "estructura_id": count["estructura_id"],
                "armado": entrada[0],
                "densidad_antes": next(
                    (c["antes"] for c in count["cambios"] if c.get("campo") == "densidad"), None
                ),
                "densidad_despues": structure.get("densidad"),
                "globos_foto": count["globos_foto"],
                "globos_antes": count["globos_antes"],
                "globos_despues": count["globos_despues"],
            }
            for count in counts
            if count["decision"] == "ajustado"
            for structure in _mappings(adjusted.get("estructuras"))
            if structure.get("estructura_id") == count["estructura_id"]
            and (entrada := _armado_del_motor(structure)) is not None
        ]
        if recalibradas:
            _decidir(
                "regla:armado",
                "qué receta del motor arma cada pieza que la foto contó",
                recalibradas,
                "conteo_foto._con_armado_del_motor: fuera de la tolerancia se elige, entre las densidades"
                " admitidas, la receta del motor que más se acerca a la foto y pasa la puerta física; el"
                " armado conserva lo que la foto leyó (armado_estructura.armado_con_densidad)",
            )
    return adjusted, hints, counts


def _recetas_del_motor_por_densidad(structure: Mapping[str, object]) -> list[dict[str, object]]:
    """La pieza con cada otra densidad que admite y su armado del motor con el volumen de esa densidad.

    Son las candidatas con que el conteo de la foto calibra una pieza que trae armado del motor
    (``conteo_foto._con_armado_del_motor``). El armado lo rehace ``armado_estructura.armado_con_densidad``, que
    conserva lo que la foto leyó; una densidad que no arma un armado válido del mismo motor no es candidata.
    """
    entrada = _armado_del_motor(structure)
    if entrada is None:
        return []
    # Importación diferida por el mismo ciclo que ``_armado_arco_de_patron``.
    from app.armado_estructura import armado_con_densidad

    clase, armado = entrada
    campo = _ARMADOS_DEL_MOTOR[clase][0]
    actual = _text(structure.get("densidad")) or "media"
    candidatas: list[dict[str, object]] = []
    for densidad in _admitted_densities(structure):
        if densidad == actual:
            continue
        otro = armado_con_densidad(structure, armado, densidad)
        if otro is not None and otro != armado:
            candidatas.append({**structure, "densidad": densidad, campo: otro})
    return candidatas


def _decidir(
    quien: str, que: str, resultado: object, motivo: str, *, entrada: object = None
) -> None:
    """Una decisión de la resolución en el registro del servicio (``app/registro.py``, evento ``decision``).

    Con la forma del ``decidir`` de Next (``quien``, ``que``, ``resultado``, ``motivo``, ``entrada``), para que
    la línea de tiempo de una conversación las lea igual. El registro nunca lanza: si falla se pierde la línea.
    """
    datos: dict[str, object] = {"quien": quien, "que": que, "resultado": resultado, "motivo": motivo}
    if entrada is not None:
        datos["entrada"] = entrada
    registrar_evento("decision", datos=datos)


def _numeros_como_en_json(valor: object) -> object:
    """El mismo valor con cada float entero (2.0) escrito como entero (2), como lo deja JavaScript.

    Es la forma con la que ``plan_hash`` firma el plan: un número no puede cambiar el hash según qué lado de la
    frontera lo escribió. ``bool`` es subclase de ``int`` y no es un float, así que no se toca.
    """
    if isinstance(valor, float) and valor.is_integer():
        return int(valor)
    if isinstance(valor, Mapping):
        return {clave: _numeros_como_en_json(v) for clave, v in valor.items()}
    if isinstance(valor, list):
        return [_numeros_como_en_json(v) for v in valor]
    return valor


def _round_variants(
    product_id: str,
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    allowlist: Mapping[str, set[str]],
) -> tuple[tuple[str, float], ...]:
    """The round variants of a product this turn may buy, as ``(variant_id, inches)``, sorted."""
    allowed = allowlist.get(product_id, set())
    return tuple(
        sorted(
            (candidate.variant_id, float(candidate.diameter_inches))
            for candidate in candidates_by_product.get(product_id, ())
            if candidate.variant_id in allowed
            and candidate.diameter_inches is not None
            and candidate.diameter_inches > 0
            and candidate.shape == "redondo"
        )
    )


def _counted_with_read_geometry(
    request: PlanResolutionRequest,
) -> Callable[[Mapping[str, object]], Mapping[str, object]]:
    """How the photo count sees a garland this confirmation assembles from its reading.

    ADR-0032, decision 27. The assemblies are completed after the count, and
    the reading's drop and tilt become the assembly's ``caida_m`` and
    ``desnivel_m``, which lengthen the cord that is bought. So a garland
    without an assembly that this resolution will assemble
    (``completar_armados_guirnalda``, within ``completar_armados_de``) is
    counted with the geometry its reading gives over the measures being tried
    (``geometria_de_lectura``, the same function the assembly uses): the
    count compares the photo with that cord, not with the straight length.
    Only for counting; nothing of it is written into the plan. Without a
    reading that brings a drop or a tilt, every structure counts as always.
    """
    if not request.completar_armados_guirnalda or not request.pistas_guirnalda:
        return lambda structure: structure
    only = None if request.completar_armados_de is None else set(request.completar_armados_de)
    readings: dict[str, Mapping[str, object]] = {}
    for hint in request.pistas_guirnalda:
        # The first one of an element, as _completar_armados_guirnalda takes it.
        readings.setdefault(_text(hint.get("referencia_element_id")) or "", hint)

    def counted(structure: Mapping[str, object]) -> Mapping[str, object]:
        if structure.get("armado_guirnalda") is not None or not _is_garland(structure):
            return structure
        if only is not None and _text(structure.get("estructura_id")) not in only:
            return structure
        reading = readings.get(_text(structure.get("referencia_element_id")) or "")
        if reading is None:
            return structure
        measures = _mapping(structure.get("medidas"))
        length = _number(measures.get("largo_m")) or _number(measures.get("ancho_m")) or 0.0
        geometry = geometria_de_lectura_guirnalda(reading, length)
        if not geometry:
            return structure
        anchors = reading.get("puntos_de_anclaje")
        if isinstance(anchors, int) and not isinstance(anchors, bool):
            geometry["puntos_de_anclaje"] = anchors
        return {**structure, "armado_guirnalda": geometry}

    return counted


def _garland_assemblies_after_count(
    plan: dict[str, object],
    counts: Sequence[Mapping[str, object]],
    readings: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    """A garland the count adjusted keeps its assembly only if it still fits (review 4).

    The count changes density or measures, and so what is bought; an assembly
    that fitted before (a topper needs a big balloon of its color) may not fit
    any more. It is suggested again from the photo reading or the recipe over
    the new purchase, or dropped when nothing fits, with a notice; never a 422.
    """
    adjusted = {str(count["estructura_id"]) for count in counts if count["decision"] == "ajustado"}
    structures = [dict(item) for item in _mappings(plan.get("estructuras"))]
    assumptions = [a for a in cast(list[object], plan.get("supuestos") or []) if isinstance(a, str)]
    changed = False
    for index, item in enumerate(structures):
        assembly = item.get("armado_guirnalda")
        if assembly is None or (_text(item.get("estructura_id")) or "") not in adjusted:
            continue
        current = {**plan, "estructuras": structures}
        try:
            validar_armado_guirnalda(_garland_context(current, item), _mapping(assembly))
            continue
        except (ArmadoGuirnaldaInvalido, PlanResolutionError):
            pass
        bare = _without(item, "armado_guirnalda")
        element_id = _text(item.get("referencia_element_id"))
        reading = next(
            (
                r
                for r in readings
                if element_id is not None and r.get("referencia_element_id") == element_id
            ),
            None,
        )
        again = _with_garland_assembly(current, index, bare, reading)
        structures[index] = bare if again is None else again
        agregar_supuesto(
            assumptions,
            supuesto(
                _text(item.get("nombre")) or "Guirnalda",
                "con la cantidad de la foto el armado anterior ya no cabía: "
                + ("se volvió a sugerir." if again is not None else "queda sin armado."),
            ),
        )
        changed = True
    if not changed:
        return plan
    return {**plan, "estructuras": structures, "supuestos": assumptions}


def _structure_index(plan: Mapping[str, object], estructura_id: str) -> int:
    for index, structure in enumerate(_mappings(plan.get("estructuras"))):
        if structure.get("estructura_id") == estructura_id:
            return index
    raise PlanResolutionError("estructura_no_encontrada", 404)


def compras_de_estructura(
    plan: Mapping[str, object],
    estructura_id: str,
    lineas: Sequence[Mapping[str, object]],
) -> ComprasPorMaterial:
    """What each material of one structure buys, read back from its resolved lines.

    For the catalog-less preview (ADR-0028 §10), so it names each color of the
    pattern by what is bought, exactly as resolution does (§8,
    ``_named_by_purchase``). ``lineas`` are the structure's lines of the
    resolution the browser holds (``plan_resuelto.estructuras[].lineas``) and
    ``plan`` the plan that resolution echoed. The structure's demands are the
    ones resolution covered (``_despiece_with_plan_sizes`` over the plan as it
    is, with its own pattern), in the same order; ``_read_back_purchases``
    matches them with the lines and ``_replaced_line`` tells which line a
    replacement bought. The lines only name: they never count or price. A
    material whose lines cannot tell (its own product relabelled, or replaced
    by that same product) is left out and keeps its declared name.

    Empty — the preview names what ``materiales`` declares, as before — when
    nothing can be renamed (no ``variant_overrides``, not a geometric piece,
    no lines) or the lines cannot be read back: the plan or its own pattern no
    longer resolves, or the lines are not this plan's (another resolution, an
    uncovered demand). Never raises for the lines: the preview goes on with
    the declared names and resolution names the purchase again.
    """
    raw_structures = plan.get("estructuras")
    structure = next(
        (
            item
            for item in (raw_structures if isinstance(raw_structures, list) else [])
            if isinstance(item, Mapping) and item.get("estructura_id") == estructura_id
        ),
        None,
    )
    if structure is None or not lineas or not structure.get("variant_overrides"):
        return {}
    try:
        _validate_plan(plan)
        measured = _complete_measures(plan)
        completed = _mappings(measured.get("estructuras"))[
            _structure_index(measured, estructura_id)
        ]
        if not conteo_foto.es_geometrica(completed):
            return {}
        _axis, demands, _unplaced = _despiece_with_plan_sizes(measured, completed)
    except PlanResolutionError:
        return {}
    # Las líneas de las flores (adorno) no son de ninguna demanda del cuerpo: se leerían como «línea sobrante».
    return _read_back_purchases(completed, demands, lineas_del_cuerpo(lineas))


@dataclass(frozen=True, slots=True)
class VistaPreviaPatron:
    """One structure's expanded pattern and the styles the editor may offer for it."""

    patron: dict[str, object]
    modos_admitidos: list[dict[str, object]]


def vista_previa_de_estructura(
    plan: Mapping[str, object],
    estructura_id: str,
    patron: Mapping[str, object] | None,
    *,
    modo: str | None = None,
    desde: Mapping[str, object] | None = None,
    compras: ComprasPorMaterial | None = None,
) -> VistaPreviaPatron:
    """Expanded color pattern of one structure, without a catalog (ADR-0028 §10).

    The structure is completed as ``resolve_plan`` completes it (without
    ``completar_patrones``), so the grid and the counts are the ones the next
    resolution will quote; the other structures' patterns are not expanded.
    Each color is named by what the structure buys, with the same function
    resolution uses (``_named_by_purchase``, §8): ``compras`` is what each
    material buys, read back from the browser's resolved lines
    (``compras_de_estructura``); without it (or with it empty) each color is
    named as ``materiales`` declares it. The names reach every text of the
    preview (the count, the texts, the prompts, the notices and a rejection's
    sentence), never the grid or the counts; a partial replacement's notice
    goes last, as in resolution. ``patron`` replaces the structure's own
    ``patron_color`` and comes back with ``aplicado: true``; ``None`` asks for
    the preset, computed without the structure's current pattern, and comes
    back with ``aplicado: false`` — the structure's preset, or with ``modo``
    the starting point of that style (``sugerir_patron_modo``), keeping from
    the draft ``desde`` what that style admits; what it had to drop is
    prepended to the pattern's ``avisos``.

    ``modos_admitidos`` come from the same completed structure: the plan is
    validated twice (as received and once completed) and completed once.

    Raises ``PlanResolutionError``: ``estructura_no_encontrada`` (404),
    ``patron_invalido`` (422, with ``estructura_id``/``motivo``/``mensaje``)
    or ``invalid_plan`` (422, the plan, the pattern or ``desde`` breaks the
    contract).
    """
    index = _structure_index(plan, estructura_id)
    if desde is not None and not forma_valida(desde):
        raise PlanResolutionError("invalid_plan", 422)
    structures = [dict(structure) for structure in _mappings(plan.get("estructuras"))]
    if patron is None:
        structures[index].pop("patron_color", None)
    else:
        structures[index]["patron_color"] = json.loads(json.dumps(patron))
    candidate = {**dict(plan), "estructuras": structures}
    _validate_plan(candidate)
    # Completed as ``resolve_plan`` completes it, but only this structure's
    # grid is expanded: the other pieces do not change this one (§10).
    measured = _complete_measures(candidate)
    completed = _sync_participations(measured, measured, only=index)
    _validate_plan(completed)
    declared = _pattern_context(completed, _mappings(completed.get("estructuras"))[index])
    admitted: list[dict[str, object]] = modos_admitidos(declared)
    context, purchase_notices = _named_by_purchase(declared, compras or {})
    notices: tuple[str, ...] = ()
    try:
        if patron is not None:
            chosen = dict(patron)
        elif modo is not None:
            start = sugerir_patron_modo(context, modo, desde)
            chosen, notices = start.patron, start.avisos
        else:
            chosen = sugerir_patron(context)
        # The structure carries the pattern that is actually expanded -- the
        # decorator's or the suggested one: a piece its motor counts with the
        # pattern as its hint (the classic arch) counts what this one places.
        patterned = {**_mappings(completed.get("estructuras"))[index], "patron_color": chosen}
        resolved: dict[str, object] = patron_resuelto(
            context, chosen, aplicado=patron is not None, unidades=_motor_units(patterned)
        )
    except PatronColorInvalido as error:
        raise _pattern_error(estructura_id, error) from error
    if notices or purchase_notices:
        resolved["avisos"] = [*notices, *cast(list[str], resolved["avisos"]), *purchase_notices]
    # The editor draws the same piece the proposal draws (ADR-0028 decision 5),
    # so the split the sketch is laid on is the one this preview counted. One
    # budget per preview: a preview is one piece, so only the per-piece limit
    # applies. The silhouette itself is remembered per request
    # (``silueta_patron._disponer_recordado``): a touch changes the colors, not
    # the piece, so it is not built again.
    _add_silhouette(completed, patterned, resolved, PresupuestoGrafica())
    return VistaPreviaPatron(patron=resolved, modos_admitidos=admitted)


def patron_resuelto_de_estructura(
    plan: Mapping[str, object],
    estructura_id: str,
    patron: Mapping[str, object] | None,
    *,
    modo: str | None = None,
) -> dict[str, object]:
    """Only the expanded pattern of ``vista_previa_de_estructura`` (same errors)."""
    return vista_previa_de_estructura(plan, estructura_id, patron, modo=modo).patron


def modos_admitidos_de_estructura(
    plan: Mapping[str, object], estructura_id: str
) -> list[dict[str, object]]:
    """Styles the pattern editor offers for one structure (``modos_admitidos``).

    For a rejected preview, which has no completed plan to read them from.
    They depend on the type and the number of materials only, so the plan is
    validated and measured but its patterns are not expanded: a pattern that
    breaks a rule does not hide the styles. Raises ``PlanResolutionError``
    (``estructura_no_encontrada`` or ``invalid_plan``).
    """
    _validate_plan(plan)
    index = _structure_index(plan, estructura_id)
    measured = _complete_measures(plan)
    context = _pattern_context(measured, _mappings(measured.get("estructuras"))[index])
    admitidos: list[dict[str, object]] = modos_admitidos(context)
    return admitidos


def sincronizar_participaciones(
    plan: Mapping[str, object], estructura_id: str | None = None
) -> dict[str, object]:
    """``plan`` with ``participacion`` rewritten for every structure with a pattern.

    Only ``participacion`` changes: measures are completed to size each grid,
    but the returned plan keeps the caller's own. This is what a plan edit
    must call after touching a pattern or the materials of a patterned
    structure, so the edited plan already says what resolution will count.
    With ``estructura_id``, only that structure (the one an edit touched; the
    others keep what their last resolution wrote). Raises
    ``PlanResolutionError`` (``invalid_plan``, ``patron_invalido`` or
    ``estructura_no_encontrada``).
    """
    _validate_plan(plan)
    only = None if estructura_id is None else _structure_index(plan, estructura_id)
    return _sync_participations(_complete_measures(plan), plan, only=only)


def sugerir_patron_para_estructura(
    plan: Mapping[str, object], estructura_id: str
) -> dict[str, object] | None:
    """Preset ``patron_color`` for one structure (ADR-0028 §6), or ``None``.

    ``None`` when the structure admits no pattern: not geometric, a single
    material, a grid too small for every color of the preset, or a piece its
    motor counts (the same rule as ``_suggested_pattern``: an edit does not
    put on it the grid a confirmation no longer does). Raises
    ``PlanResolutionError`` (``estructura_no_encontrada`` or ``invalid_plan``).
    """
    _validate_plan(plan)
    index = _structure_index(plan, estructura_id)
    measured = _complete_measures(plan)
    structure = _mappings(measured.get("estructuras"))[index]
    if _armado_del_motor(structure) is not None:
        return None
    context = _pattern_context(measured, structure)
    try:
        return cast(dict[str, object], sugerir_patron(context))
    except PatronColorInvalido:
        return None


# --- Guirnaldas por partes (ADR-0032) -------------------------------------------------

_CEILING_PLACEMENTS = frozenset({"techo", "techo_multipunto"})


def _is_garland(structure: Mapping[str, object]) -> bool:
    """A garland built by clusters: not a ceiling installation (``techo_globos``)."""
    return (
        _text(structure.get("tipo")) == "guirnalda"
        and _text(structure.get("estructura_oficial")) in (None, "guirnalda")
        and _text(structure.get("ubicacion")) not in _CEILING_PLACEMENTS
    )


def _garland_context(
    plan: Mapping[str, object],
    structure: Mapping[str, object],
    lines: Sequence[Mapping[str, object]] | None = None,
) -> EstructuraGuirnalda:
    """What the garland assembly rules need of one structure (ADR-0032).

    ``plan`` has its measures completed and ``structure`` carries the assembly
    being checked, if any: a hanging one changes the axis and so the count.
    The balloons are this resolver's own split (``_despiece_with_plan_sizes``)
    per instance, so an assembly can only arrange what the plan buys.
    ``lines`` (the structure's resolved lines, from resolution or from the
    browser) only name each material and size by what is bought, read back in
    demand order as the pattern preview does; when they do not correspond,
    each one is named as ``materiales`` declares it.
    """
    structure_id = _text(structure.get("estructura_id")) or ""
    materials = _mappings(structure.get("materiales"))
    repeats = max(1, _integer(structure.get("repeticiones")) or 1)
    measures = _mapping(structure.get("medidas"))
    length = _number(measures.get("largo_m")) or _number(measures.get("ancho_m")) or 0.0
    garland = _is_garland(structure)
    balloons: list[GloboGuirnalda] = []
    cord = length
    rows: tuple[tuple[int, ...], ...] | None = None
    rows_by_cluster: Callable[[int], tuple[tuple[int, ...], ...] | None] | None = None
    if garland:
        # ADR-0034: con el armado del motor, la cuerda es el largo real de la
        # tira que el motor armó, no la curva que dedujo ``_garland_cord`` del
        # armado por partes. Hay un solo largo para la pieza: el de quien
        # colocó los globos. De él salen la tira y la cuerda que se piden en
        # ``insumos``, que son metros de verdad.
        motor = _conteo_del_motor(structure)
        armado = structure.get("armado_guirnalda")
        cord = (
            motor.eje_m
            if motor is not None
            else _eje(
                "guirnalda",
                measures,
                _text(structure.get("estructura_oficial")),
                armado if isinstance(armado, Mapping) else None,
            )
        )
        _axis, demands, _unplaced = _despiece_with_plan_sizes(plan, structure)
        runs = _runs_by_demand(demands, lines) if lines else None
        for position, demand in enumerate(demands):
            index = _integer(demand.get("material_index")) or 0
            line = runs[position][0] if runs is not None else None
            source = line if line is not None else materials[index]
            balloons.append(
                GloboGuirnalda(
                    material=index,
                    tamano_pulg=float(cast(float, demand["pulgadas"])),
                    por_instancia=(_integer(demand.get("cantidad")) or 0) // repeats,
                    color=_text(source.get("color")),
                    acabado=_text(source.get("acabado")),
                    product_id=_text(line.get("product_id")) if line is not None else None,
                    variant_id=_text(line.get("variant_id")) if line is not None else None,
                    tamano_codigo=_text(line.get("tamano_codigo")) if line is not None else None,
                    diam_entregado=_number(line.get("diam_pulg")) if line is not None else None,
                )
            )
        if structure.get("patron_color") is not None:
            pattern_context, expansion = _expand_pattern(plan, structure)
            if expansion.geometria == "racimos":
                rows = expansion.celdas
                # E5: the pattern laid over the clusters actually built.
                rows_by_cluster = partial(
                    filas_de_racimos, pattern_context, _mapping(structure.get("patron_color"))
                )
    return EstructuraGuirnalda(
        estructura_id=structure_id,
        nombre=_text(structure.get("nombre")) or structure_id,
        es_guirnalda=garland,
        ubicacion=_text(structure.get("ubicacion")) or "",
        densidad=_text(structure.get("densidad")) or "media",
        mezcla=_text(structure.get("mezcla")) or "organica_fina",
        repeticiones=repeats,
        largo_m=length,
        largo_cuerda_m=cord,
        materiales=tuple(
            MaterialPatron(
                color=_text(material.get("color")),
                acabado=_text(material.get("acabado")),
                participacion=_number(material.get("participacion")) or 0.0,
            )
            for material in materials
        ),
        globos=tuple(balloons),
        otras=tuple(
            OtraEstructura(
                estructura_id=_text(other.get("estructura_id")) or "",
                tipo=_text(other.get("tipo")) or "",
                nombre=_text(other.get("nombre")) or _text(other.get("estructura_id")) or "",
                referencia_element_id=_text(other.get("referencia_element_id")),
            )
            for other in _mappings(plan.get("estructuras"))
            if _text(other.get("estructura_id")) != structure_id
        ),
        filas_patron=rows,
        filas_de_racimos=rows_by_cluster,
    )


def _garland_error(estructura_id: str, error: ArmadoGuirnaldaInvalido) -> PlanResolutionError:
    return PlanResolutionError(
        "armado_invalido",
        422,
        {"estructura_id": estructura_id, "motivo": error.motivo, "mensaje": error.mensaje},
    )


def _with_structure(
    plan: Mapping[str, object], index: int, structure: Mapping[str, object]
) -> dict[str, object]:
    structures = list(_mappings(plan.get("estructuras")))
    structures[index] = structure
    return {**dict(plan), "estructuras": structures}


def _without(structure: Mapping[str, object], key: str) -> dict[str, object]:
    return {name: value for name, value in structure.items() if name != key}


def _without_read_geometry(reading: Mapping[str, object] | None) -> Mapping[str, object] | None:
    """The reading without its bow, drop and tilt: the assembly as before decisions 27 and 28."""
    if reading is None:
        return None
    return {
        key: value
        for key, value in reading.items()
        if key not in ("caida_relativa", "sentido_curva", "flecha_relativa", "desnivel_relativo")
    }


def _suggest_garland_assembly(
    plan: Mapping[str, object],
    index: int,
    structure: Mapping[str, object],
    reading: Mapping[str, object] | None,
) -> dict[str, object] | None:
    """``sugerir_armado`` over what the suggested assembly itself buys (decision 27).

    ``structure`` carries no assembly. The photo's drop and tilt lengthen the
    cord, and the cord decides the count: suggested over the straight
    purchase, such an assembly would split balloons that are not bought. So
    it is suggested again over the purchase of its own cord and kept when it
    keeps that cord; otherwise the reading without its geometry decides, as
    before. Without a drop or a tilt this is exactly ``sugerir_armado`` over
    ``structure``.

    A garland without the motor's assembly, organic included, is counted by
    the formula over this cord (``_eje``), so comparing cords is comparing
    what it buys. From 2026-10-04 to 2026-10-05 an organic one was counted by
    its motor recipe, whose line follows the shape, and this compared
    purchases instead; the owner reverted that counting on 2026-10-05.
    """
    context = _garland_context(_with_structure(plan, index, structure), structure)
    first: dict[str, object] | None = sugerir_armado_guirnalda(context, reading)
    if first is None or _garland_cord(context.largo_m, first) == context.largo_m:
        return first
    placed = {**structure, "armado_guirnalda": first}
    again: dict[str, object] | None = sugerir_armado_guirnalda(
        _garland_context(_with_structure(plan, index, placed), placed), reading
    )
    if again is not None and _garland_cord(context.largo_m, again) == _garland_cord(
        context.largo_m, first
    ):
        return again
    flat: dict[str, object] | None = sugerir_armado_guirnalda(
        context, _without_read_geometry(reading)
    )
    return flat


def _with_garland_assembly(
    plan: Mapping[str, object],
    index: int,
    structure: Mapping[str, object],
    reading: Mapping[str, object] | None,
) -> dict[str, object] | None:
    """``structure`` (without an assembly) with the one suggested for it, or ``None``.

    Suggested over what it buys (``_suggest_garland_assembly``). When the
    photo's drop or tilt changed the cord, the count changed with it: a color
    pattern gets its shares synced to the new grid (the signed plan says what
    is built and resolving it again is a fixed point), and if the pattern no
    longer fits, the reading's geometry is left out (the count as before)
    instead of failing.
    """
    assembly = _suggest_garland_assembly(plan, index, structure, reading)
    if assembly is None:
        return None
    placed = {**structure, "armado_guirnalda": assembly}
    measures = _mapping(structure.get("medidas"))
    length = _number(measures.get("largo_m")) or _number(measures.get("ancho_m")) or 0.0
    if structure.get("patron_color") is None or _garland_cord(length, assembly) == length:
        return placed
    candidate = _with_structure(plan, index, placed)
    try:
        return dict(
            _mappings(_sync_participations(candidate, candidate, only=index).get("estructuras"))[
                index
            ]
        )
    except PlanResolutionError:
        flat = sugerir_armado_guirnalda(
            _garland_context(_with_structure(plan, index, structure), structure),
            _without_read_geometry(reading),
        )
        return None if flat is None else {**structure, "armado_guirnalda": flat}


def _assembly_with_pattern_by_cluster(
    plan: Mapping[str, object],
    index: int,
    structure: Mapping[str, object],
    reading: Mapping[str, object] | None,
    pattern_hints: Sequence[Mapping[str, object]],
) -> tuple[dict[str, object] | None, bool]:
    """A garland whose pattern this confirmation completed: recipe, pattern by cluster, recipe.

    ADR-0032, decision 20. The pattern completed in ``_complete_plan`` did not
    know the assembly (a mix of sizes got confetti in quartets), so: (1) the
    recipe or the photo reading without that pattern (the unit by density or
    by the photo); (2) the pattern again with that assembly, which goes by its
    clusters (``_preset_por_racimo``: spiral or rings, ``k`` = its unit), and
    the shares synced to it; (3) the recipe again over the synced purchase, so
    every topper has its big balloon in the colors the new split buys. Returns
    the structure with its pattern and assembly, checked as resolution checks
    it; ``(None, False)`` when the garland admits no assembly at all (as
    before), ``(None, True)`` when the assembly fits but not the pattern by
    cluster over it.
    """
    bare = _without(_without(structure, "patron_color"), "armado_guirnalda")
    first = _suggest_garland_assembly(plan, index, bare, reading)
    if first is None:
        return None, False
    assembled = {**bare, "armado_guirnalda": first}
    pattern = _suggested_pattern(_with_structure(plan, index, assembled), assembled, pattern_hints)
    if pattern is None:
        return None, True
    candidate = _with_structure(plan, index, {**assembled, "patron_color": pattern})
    try:
        synced = _mappings(
            _sync_participations(candidate, candidate, only=index).get("estructuras")
        )[index]
    except PlanResolutionError:
        return None, True
    patterned = _without(synced, "armado_guirnalda")
    second = _suggest_garland_assembly(plan, index, patterned, reading)
    if second is None:
        return None, True
    final = {**patterned, "armado_guirnalda": second}
    try:
        validar_armado_guirnalda(
            _garland_context(_with_structure(plan, index, final), final), second
        )
    except (ArmadoGuirnaldaInvalido, PlanResolutionError):
        return None, True
    return final, False


def _completar_armados_guirnalda(
    plan: Mapping[str, object],
    only: Collection[str] | None = None,
    pistas: Sequence[Mapping[str, object]] = (),
    *,
    patrones_completados: Collection[str] = (),
    pistas_patron: Sequence[Mapping[str, object]] = (),
) -> dict[str, object]:
    """Photo reading first, recipe otherwise, for every garland without an assembly.

    ``completar_armados_guirnalda`` (ADR-0032). The reading of the garland's
    reference element (``pistas_guirnalda``, E4, confidence at least 0.5)
    decides its support, shape, unit, filler and toppers; the recipe never
    declares a drop, so without a reading the count and the total balloons
    stay as they were. Since decision 27 the reading may bring the drop and
    the tilt of the photo: then the cord, and what is bought, follow them
    (``_with_garland_assembly``), as the photo count already did
    (``_counted_with_read_geometry``). A garland neither can arrange keeps no
    assembly. With
    ``only``, the other structures are left as they are (the re-resolution
    after an edit). A plan without garlands comes back as it was.

    ``patrones_completados`` are the structures whose pattern this same
    confirmation completed (``completar_patrones``): for those, recipe →
    pattern by cluster → recipe (``_assembly_with_pattern_by_cluster``,
    decision 20). If that does not fit, the garland keeps the completed
    pattern and gets the assembly of its unit, with a notice in ``supuestos``;
    never an error.
    """
    structures: list[dict[str, object]] = [
        dict(item) for item in _mappings(plan.get("estructuras"))
    ]
    raw_assumptions = plan.get("supuestos")
    assumptions = [
        a
        for a in (raw_assumptions if isinstance(raw_assumptions, list) else [])
        if isinstance(a, str)
    ]
    changed = False
    notice = False
    for index, item in enumerate(structures):
        structure_id = _text(item.get("estructura_id"))
        wanted = only is None or structure_id in only
        if not wanted or item.get("armado_guirnalda") is not None or not _is_garland(item):
            continue
        element_id = _text(item.get("referencia_element_id"))
        reading = next(
            (
                pista
                for pista in pistas
                if element_id is not None and pista.get("referencia_element_id") == element_id
            ),
            None,
        )
        current = {**dict(plan), "estructuras": structures}
        if structure_id in patrones_completados and item.get("patron_color") is not None:
            by_cluster, degraded = _assembly_with_pattern_by_cluster(
                current, index, item, reading, pistas_patron
            )
            if by_cluster is not None:
                structures[index] = by_cluster
                changed = True
                continue
        else:
            degraded = False
        if degraded:
            notice = True
            name = _text(item.get("nombre")) or "Guirnalda"
            # Within the contract's maxLength and maxItems (review finding 31).
            agregar_supuesto(
                assumptions,
                supuesto(
                    name,
                    "el patrón por racimos no cabe en lo que se compra; queda el patrón"
                    " sugerido y el armado de sus racimos.",
                ),
            )
        placed = _with_garland_assembly(current, index, item, reading)
        if placed is not None:
            structures[index] = placed
            changed = True
    if not changed and not notice:
        return dict(plan)
    completed: dict[str, object] = {**dict(plan), "estructuras": structures}
    if notice:
        completed["supuestos"] = list(dict.fromkeys(assumptions))
    _validate_plan(completed)
    return completed


def _armados_guirnalda_resueltos(
    plan: Mapping[str, object], resolved_structures: Sequence[Mapping[str, object]]
) -> list[dict[str, object]]:
    """``armados_guirnalda``: one per structure that carries an assembly."""
    lines = {
        _text(structure.get("estructura_id")): lineas_del_cuerpo(_mappings(structure.get("lineas")))
        for structure in resolved_structures
    }
    resolved: list[dict[str, object]] = []
    for structure in _mappings(plan.get("estructuras")):
        assembly = structure.get("armado_guirnalda")
        if assembly is None:
            continue
        structure_id = _text(structure.get("estructura_id")) or ""
        context = _garland_context(plan, structure, lines.get(structure_id))
        try:
            resolved.append(armado_guirnalda_resuelto(context, _mapping(assembly)))
        except ArmadoGuirnaldaInvalido as error:
            raise _garland_error(structure_id, error) from error
    return resolved


def _garland_context_with(
    plan: Mapping[str, object],
    estructura_id: str,
    armado: Mapping[str, object] | None,
    lines: Sequence[Mapping[str, object]] | None,
) -> EstructuraGuirnalda:
    """One garland's context with ``armado`` in place, completed as resolution completes it.

    Measures are completed and the structure's pattern shares resynced (a
    drop changes the count, and a pattern grid is sized from it). Raises
    ``estructura_no_encontrada`` (404) or ``invalid_plan`` (422).
    """
    index = _structure_index(plan, estructura_id)
    structures = [dict(structure) for structure in _mappings(plan.get("estructuras"))]
    if armado is None:
        structures[index].pop("armado_guirnalda", None)
    else:
        structures[index]["armado_guirnalda"] = json.loads(json.dumps(armado))
    # As the edit does: a pattern mirrored for a U does not survive another
    # shape or the recipe (review 5), or the preview would reject the draft.
    quitar_espejo_sin_u(structures[index], armado)
    candidate = {**dict(plan), "estructuras": structures}
    _validate_plan(candidate)
    measured = _complete_measures(candidate)
    completed = _sync_participations(measured, measured, only=index)
    return _garland_context(completed, _mappings(completed.get("estructuras"))[index], lines)


@dataclass(frozen=True, slots=True)
class VistaPreviaArmadoGuirnalda:
    """One garland's resolved assembly and what the editor may offer for it."""

    armado: dict[str, object]
    opciones: dict[str, object]


def vista_previa_de_armado_guirnalda(
    plan: Mapping[str, object],
    estructura_id: str,
    armado: Mapping[str, object] | None,
    lineas: Sequence[Mapping[str, object]] | None = None,
) -> VistaPreviaArmadoGuirnalda:
    """Resolved assembly of one garland, without a catalog (ADR-0032).

    ``armado`` replaces the structure's own ``armado_guirnalda`` and comes back
    resolved with the function resolution uses; ``None`` asks for the recipe.
    ``lineas`` (the structure's resolved lines the browser holds) name each
    code by what is bought, as at resolution. Raises ``PlanResolutionError``:
    ``estructura_no_encontrada`` (404), ``invalid_plan`` (422) or
    ``armado_invalido`` (422, with ``motivo`` and ``mensaje``;
    ``sin_armado_posible`` when not even the recipe fits the purchase).
    """
    context = _garland_context_with(plan, estructura_id, armado, lineas)
    try:
        if not context.es_guirnalda:
            raise ArmadoGuirnaldaInvalido(
                "no_es_guirnalda", "Solo una guirnalda se arma por racimos."
            )
        chosen = dict(armado) if armado is not None else sugerir_armado_guirnalda(context)
        if chosen is None:
            raise ArmadoGuirnaldaInvalido(
                "sin_armado_posible",
                "Con estos globos no se puede armar la guirnalda sin cambiar la compra.",
            )
        resolved = armado_guirnalda_resuelto(context, chosen)
    except ArmadoGuirnaldaInvalido as error:
        raise _garland_error(estructura_id, error) from error
    return VistaPreviaArmadoGuirnalda(armado=resolved, opciones=opciones_armado_guirnalda(context))


def validar_armado_guirnalda_sin_catalogo(
    plan: Mapping[str, object], estructura_id: str, armado: Mapping[str, object]
) -> None:
    """A garland assembly against the plan alone (the edit, ADR-0032).

    Everything a garland assembly checks is known without the catalog.
    Raises ``PlanResolutionError`` ``armado_invalido`` (or the plan errors).
    """
    vista_previa_de_armado_guirnalda(plan, estructura_id, armado)


LISTA_MATERIALES_RESULT_VERSION = "lista-materiales-result.v1"


class CatalogMaterialQuoteStore(Protocol):
    async def fetch_current_material_rows(
        self, variant_ids: Sequence[str]
    ) -> Sequence[Mapping[str, object]]: ...


async def cotizar_lista_materiales(
    request: ListaMaterialesPayload, catalog: CatalogMaterialQuoteStore
) -> dict[str, object]:
    """Cotiza variantes fijas; precio, paquetes cerrados e IVA viven aquí."""
    payload = ListaMaterialesPayload.model_validate(request)
    lineas_solicitadas = cast(list[dict[str, object]], payload.materiales)
    ids = [cast(str, linea["variant_id"]) for linea in lineas_solicitadas]
    filas = await catalog.fetch_current_material_rows(ids)
    por_id = {cast(str, fila["variant_id"]): fila for fila in filas}
    if len(por_id) != len(ids):
        raise PlanResolutionError("material_no_disponible", 422)
    lineas: list[dict[str, object]] = []
    total = 0
    for solicitada in lineas_solicitadas:
        variant_id = cast(str, solicitada["variant_id"])
        cantidad = cast(int, solicitada["cantidad"])
        fila = por_id[variant_id]
        unidades = _integer(fila.get("unidades_paq"))
        precio = _price(fila.get("precio"))
        if unidades is None or unidades <= 0 or precio is None or precio <= 0:
            raise PlanResolutionError("material_no_disponible", 422)
        paquetes = math.ceil(cantidad / unidades)
        subtotal = paquetes * precio
        if subtotal > MAX_SAFE_INTEGER - total:
            raise PlanResolutionError("cotizacion_fuera_de_rango", 422)
        total += subtotal
        lineas.append(
            {
                "variant_id": variant_id,
                "nombre": str(fila.get("nombre") or variant_id),
                "cantidad_necesaria": cantidad,
                "unidades_paquete": unidades,
                "paquetes": paquetes,
                "precio_paquete": precio,
                "subtotal": subtotal,
                "sobrante": paquetes * unidades - cantidad,
            }
        )
    resultado = {
        "operation_schema_version": LISTA_MATERIALES_RESULT_VERSION,
        "currency": "COP",
        "incluye_iva": True,
        "lineas": lineas,
        "total": total,
    }
    return ListaMaterialesResult.model_validate(resultado).model_dump()


__all__ = [
    "armado_arco_de_patron",
    "armado_arco_de_receta",
    "pieza_del_motor_resuelta",
    "CatalogPlanStore",
    "CatalogMaterialQuoteStore",
    "ListaMaterialesPayload",
    "LISTA_MATERIALES_RESULT_VERSION",
    "ComprasPorMaterial",
    "MERMA",
    "PLAN_RESOLUTION_SCOPE",
    "PistaPatron",
    "PistaTamanos",
    "PlanAllowlistEntry",
    "PlanResolutionError",
    "PlanResolutionRequest",
    "PiezaContada",
    "VistaPreviaArmado",
    "VistaPreviaArmadoGuirnalda",
    "VistaPreviaPatron",
    "compras_de_estructura",
    "con_medidas_por_defecto",
    "contar_pieza",
    "cotizar_lista_materiales",
    "contexto_bouquet_de_globos",
    "modos_admitidos_de_estructura",
    "opciones_de_armado",
    "patron_resuelto_de_estructura",
    "puerto_de_conteo",
    "resolve_plan",
    "sincronizar_participaciones",
    "sugerir_patron_para_estructura",
    "validar_armado_guirnalda_sin_catalogo",
    "validar_armado_sin_catalogo",
    "vista_previa_de_armado",
    "vista_previa_de_armado_guirnalda",
    "vista_previa_de_estructura",
]
