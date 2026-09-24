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
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from math import isfinite
from typing import Literal, Protocol, cast
from urllib.parse import urlparse

from pydantic import ConfigDict, Field, ValidationError, field_validator, model_validator

from app.generated_models import (
    contract_schema,
    MaterialEstimate,
    PlanDecoracion,
    PlanResolutionResult,
    PlanResuelto,
    Quote,
)
from app.catalog import purchase_color_for_unsold
from app.operational_models import ContractModel, OperationalRequest
from app.patron_color import (
    CONFIANZA_MINIMA_PISTA,
    EstructuraPatron,
    Expansion,
    MaterialPatron,
    PatronColorInvalido,
    conteo_por_instancia,
    modos_admitidos,
    participaciones,
    patron_desde_pista,
    patron_resuelto,
    sugerir_patron,
    sugerir_patron_modo,
    validar_y_expandir,
)


PLAN_RESOLUTION_SCOPE = "plan.resolve"
PLAN_RESOLUTION_REQUEST_VERSION = "plan-resolution.v1"
PLAN_RESOLUTION_RESULT_VERSION = "plan-resolution-result.v1"
PLAN_RESOLVED_VERSION = "plan-resuelto.v1"
MERMA = 0.08
MAX_SAFE_INTEGER = 9_007_199_254_740_991
# Mirrors PLAN_RESOLUTION_MAX_LORA_VARIANTS (domain-v1.ts) and the recommendations
# bound: the same LoRA dataset pool reaches both. 2048 ids x 17 bytes (14-digit
# id, quotes, comma) is about 34.8 KB of the 64 KB body limit; 4096 would not fit.
MAX_PLAN_LORA_VARIANTS = 2048

_EXTERIOR = re.compile(r"jard[ií]n|exterior|terraza|playa|patio|campo", re.IGNORECASE)
_GEOMETRIC_TYPES = {"arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"}
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
        lora_variant_ids: Sequence[str] = (),
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


class PistaPatron(ContractModel):
    """Color pattern read in the reference photo (``PistaPatronSchema``, ADR-0028 §7)."""

    model_config = ConfigDict(extra="forbid", strict=True)

    referencia_element_id: str = Field(min_length=1, max_length=80)
    modo: Literal["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero"]
    colores: list[str] = Field(min_length=1, max_length=12)
    globos_por_racimo: int | None = Field(default=None, ge=1, le=8)
    pesos: list[int] | None = Field(default=None, max_length=12)
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


class PlanResolutionRequest(OperationalRequest):
    """Strict request carried inside the operational envelope."""

    schema_version: Literal["plan-resolution.v1"]
    plan: dict[str, object]
    allowlist: list[PlanAllowlistEntry] = Field(max_length=256)
    catalog_snapshot_id: str = Field(min_length=1, max_length=160)
    lora_variant_ids: list[str] = Field(default_factory=list, max_length=MAX_PLAN_LORA_VARIANTS)
    # ADR-0028 §7: Next asks for patterns once, when the plan is confirmed.
    # Later re-resolutions keep what the plan already declares.
    completar_patrones: bool = Field(default=False, strict=True)
    pistas_patron: list[PistaPatron] = Field(default_factory=list, max_length=16)

    @field_validator("catalog_snapshot_id")
    @classmethod
    def normalize_snapshot_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("catalog_snapshot_id must not be blank")
        return value

    @field_validator("lora_variant_ids")
    @classmethod
    def normalize_lora_variant_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("lora_variant_ids must not contain blanks")
        if len(normalized) != len(set(normalized)):
            raise ValueError("lora_variant_ids must be unique")
        return normalized

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


def _product_colors(title: str, colors: Sequence[str]) -> tuple[str, ...]:
    """Real colors of a catalog product.

    The derived catalog colors file grey balloons under "plateado" (Fashion
    Gris), but grey is not silver: a product whose title names "gris" and not
    silver has "gris" instead of "plateado" (E2E 2026-09-15, ejemplo-07).
    """
    folded = tuple(dict.fromkeys(_normalize(color) for color in colors if _normalize(color)))
    folded_title = _normalize(title)
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


def _complete_measures(raw_plan: Mapping[str, object]) -> dict[str, object]:
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
            values = [
                str(measures[key]) + " m"
                for key in ("ancho_m", "alto_m", "largo_m")
                if key in measures
            ]
            assumptions.append(
                f"medidas asumidas para {structure_type}: {' × '.join(values)} — no nos diste el tamaño del espacio"
            )
        structure["medidas"] = measures
        structures.append(structure)
    plan["estructuras"] = structures
    plan["supuestos"] = list(dict.fromkeys(assumptions))
    return plan


def _complete_plan(
    raw_plan: Mapping[str, object],
    *,
    completar_patrones: bool = False,
    pistas: Sequence[Mapping[str, object]] = (),
) -> dict[str, object]:
    """Fill default measures and make every color pattern authoritative.

    With ``completar_patrones`` a geometric structure without ``patron_color``
    gets the pattern of its photo hint, or else its preset (ADR-0028 §7).
    Then every structure with a pattern gets ``participacion`` rewritten from
    its grid, so the echoed plan says what is built and resolving the result
    again is a fixed point. A plan without patterns is returned exactly as
    before, which keeps its ``plan_hash``.
    """
    plan = _complete_measures(raw_plan)
    if completar_patrones:
        _assign_patterns(plan, pistas)
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
    if tipo in _GEOMETRIC_TYPES:
        _axis, total, proportions, _unplaced = _structure_count(plan, structure)
        single_size = len(proportions) == 1
    measures = _mapping(structure.get("medidas"))
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
    )


def _expand_pattern(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> tuple[EstructuraPatron, Expansion]:
    context = _pattern_context(plan, structure)
    try:
        return context, validar_y_expandir(context, _mapping(structure.get("patron_color")))
    except PatronColorInvalido as error:
        raise _pattern_error(context.estructura_id, error) from error


def _assign_patterns(plan: dict[str, object], pistas: Sequence[Mapping[str, object]]) -> None:
    """Photo hint first, preset otherwise (ADR-0028 §7); in place on a completed plan."""
    for structure in cast(list[dict[str, object]], plan["estructuras"]):
        if structure.get("patron_color") is not None:
            continue
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
        pattern = patron_desde_pista(context, hint) if hint is not None else None
        if pattern is None:
            try:
                pattern = sugerir_patron(context)
            except PatronColorInvalido:
                # Not geometric, a single color, or a grid too small for the
                # preset: the structure keeps today's organic distribution.
                continue
        structure["patron_color"] = pattern


def _sync_participations(
    measured: Mapping[str, object], target: Mapping[str, object]
) -> dict[str, object]:
    """``target`` with ``participacion`` rewritten from each pattern's grid (§5).

    ``measured`` is the same plan with its measures completed, which is what
    the grid is sized from; ``target`` may be that plan or the caller's own.
    """
    result = dict(target)
    structures: list[object] = []
    for measured_structure, structure in zip(
        _mappings(measured.get("estructuras")), _mappings(target.get("estructuras")), strict=True
    ):
        if structure.get("patron_color") is None:
            structures.append(structure)
            continue
        context, expansion = _expand_pattern(measured, measured_structure)
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


def _eje(tipo: str, measures: Mapping[str, object], official: str | None = None) -> float:
    width = _number(measures.get("ancho_m")) or 0.0
    height = _number(measures.get("alto_m")) or 0.0
    length = _number(measures.get("largo_m")) or 0.0
    if _OFFICIAL_GEOMETRY.get(official or "", {}).get("eje") == "circunferencia":
        diameter = min(width, height) if width and height else width or height
        return math.pi * diameter
    if tipo == "guirnalda":
        return length or width
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
) -> tuple[float, int]:
    """Axis and total balloon count of one structure.

    ``proportions`` is the effective mix when the customer fixed sizes: it
    decides the weighted balloon area and the dominant diameter, while the band
    width and the official structure profile still come from the plan mix.
    """
    proportions = tuple(proportions) if proportions else _MIXES[mix]
    dominant = max(proportions, key=lambda item: item[1])
    dominant_diameter_cm = dominant[0] * 2.54 * 0.92
    axis = _eje(tipo, measures, official)
    width = _number(measures.get("ancho_m")) or 0.0
    height = _number(measures.get("alto_m")) or 0.0
    area = (
        width * height
        if tipo == "pared"
        else axis * (_BAND_WIDTH[mix] * dominant_diameter_cm / 100) * _band_profile_factor(official)
    )
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
    a color pattern brings its own material margin to that same fill.
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
    material_totals = _hamilton(
        total, [total * quota for quota in material_quotas], [0.0 for _quota in material_quotas]
    )
    return _fill_margins(
        total, proportions, _size_totals(total, proportions), material_totals, material_quotas
    )


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
        balloons = sum(
            _integer(line.get("unidades")) or 0
            for line in _mappings(structure.get("lineas"))
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


def _structure_count(
    plan: Mapping[str, object], structure: Mapping[str, object]
) -> tuple[float, int, tuple[tuple[int, float], ...], tuple[int, ...]]:
    """Axis, balloons per instance, effective mix and unplaced mandatory sizes."""
    tipo = _text(structure.get("tipo")) or ""
    density = _text(structure.get("densidad")) or "media"
    mix = _text(structure.get("mezcla")) or "organica_fina"
    measures = _mapping(structure.get("medidas"))
    proportions, unplaced = _effective_proportions(mix, _required_sizes(plan))
    axis, total = _total_globos(
        tipo, measures, density, mix, _text(structure.get("estructura_oficial")), proportions
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
    axis, base_total, proportions, unplaced = _structure_count(plan, structure)
    materials = _mappings(structure.get("materiales"))
    matrix = (
        _pattern_matrix(plan, structure, proportions)
        if structure.get("patron_color") is not None
        else _apportion_margins(
            base_total,
            proportions,
            [_number(material.get("participacion")) or 0.0 for material in materials],
        )
    )
    repeats = max(1, _integer(structure.get("repeticiones")) or 1)
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


def _mix_real(lines: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
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


def _resolve_structures(
    plan: Mapping[str, object],
    candidates_by_product: Mapping[str, Sequence[Candidate]],
    candidate_by_variant: Mapping[str, Candidate],
    allowlist: Mapping[str, set[str]],
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]], list[str]]:
    structures: list[dict[str, object]] = []
    substitutions: list[dict[str, object]] = []
    uncovered: list[dict[str, object]] = []
    warnings: list[str] = []
    for raw_structure in _mappings(plan.get("estructuras")):
        structure_id = _text(raw_structure.get("estructura_id")) or ""
        structure_type = _text(raw_structure.get("tipo")) or ""
        lines: list[dict[str, object]] = []
        # Colors the plan asked for that ``_line_color`` relabelled with the
        # variant's real color: the photo comparison still counts them as
        # delivered.
        equivalent_colors: list[str] = []
        axis: float | None = None
        before_missing = len(uncovered)
        materials = _mappings(raw_structure.get("materiales"))
        if structure_type in _GEOMETRIC_TYPES:
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
                relabelled = _relabelled_color(resolved_line, line_color)
                if relabelled:
                    equivalent_colors.append(relabelled)
                replacement_info = resolved_line.get("sustitucion")
                if isinstance(replacement_info, dict):
                    substitutions.append({"estructura_id": structure_id, **replacement_info})
        else:
            declared = _integer(raw_structure.get("unidades_declaradas")) or 0
            quantities = _distribute_units(declared, materials)
            for material, quantity in zip(materials, quantities, strict=True):
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
    return structures, substitutions, uncovered, warnings


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
            for line in _mappings(structure.get("lineas"))
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
) -> dict[str, object]:
    structures, substitutions, uncovered, warnings = _resolve_structures(
        plan, candidates_by_product, candidate_by_variant, allowlist
    )
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
        {"plan": plan, "snapshot": snapshot},
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
    patterns = _resolved_patterns(plan)
    if patterns:
        result["patrones_color"] = patterns
    PlanResuelto.model_validate(result)
    return result


def _resolved_patterns(plan: Mapping[str, object]) -> list[dict[str, object]]:
    resolved: list[dict[str, object]] = []
    for structure in _mappings(plan.get("estructuras")):
        pattern = structure.get("patron_color")
        if pattern is None:
            continue
        context = _pattern_context(plan, structure)
        try:
            resolved.append(patron_resuelto(context, _mapping(pattern), aplicado=True))
        except PatronColorInvalido as error:
            raise _pattern_error(context.estructura_id, error) from error
    return resolved


async def resolve_plan(
    request: PlanResolutionRequest,
    catalog_store: CatalogPlanStore,
) -> dict[str, object]:
    """Resolve a plan and validate all three domain outputs before returning."""
    raw_plan = _complete_plan(
        request.plan,
        completar_patrones=request.completar_patrones,
        pistas=[pista.model_dump(exclude_none=True) for pista in request.pistas_patron],
    )
    try:
        PlanDecoracion.model_validate(raw_plan)
    except ValidationError as error:
        raise PlanResolutionError("invalid_plan", 422) from error
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
        request.lora_variant_ids,
    )
    allowlist = {entry.product_id: set(entry.variant_ids) for entry in request.allowlist}
    candidates_by_product: dict[str, list[Candidate]] = {}
    candidate_by_variant: dict[str, Candidate] = {}
    for row in rows:
        candidate = _candidate(row, snapshot_id)
        if candidate is None:
            continue
        if request.lora_variant_ids and candidate.variant_id not in set(request.lora_variant_ids):
            continue
        candidates_by_product.setdefault(candidate.product_id, []).append(candidate)
        candidate_by_variant[candidate.variant_id] = candidate
    resolved = _build_resolved(
        request,
        raw_plan,
        snapshot_id,
        candidates_by_product,
        candidate_by_variant,
        allowlist,
    )
    estimate = _material_estimate(resolved)
    quote = _quote(resolved)
    result: dict[str, object] = {
        "operation_schema_version": PLAN_RESOLUTION_RESULT_VERSION,
        "catalog_snapshot_id": snapshot_id,
        "plan_resuelto": resolved,
        "material_estimate": estimate,
        "quote": quote,
    }
    PlanResolutionResult.model_validate(result)
    return result


def _validate_plan(plan: Mapping[str, object]) -> None:
    try:
        PlanDecoracion.model_validate(plan)
    except ValidationError as error:
        raise PlanResolutionError("invalid_plan", 422) from error


def _structure_index(plan: Mapping[str, object], estructura_id: str) -> int:
    for index, structure in enumerate(_mappings(plan.get("estructuras"))):
        if structure.get("estructura_id") == estructura_id:
            return index
    raise PlanResolutionError("estructura_no_encontrada", 404)


def patron_resuelto_de_estructura(
    plan: Mapping[str, object],
    estructura_id: str,
    patron: Mapping[str, object] | None,
    *,
    modo: str | None = None,
) -> dict[str, object]:
    """Expanded color pattern of one structure, without a catalog (ADR-0028 §10).

    The plan is completed as ``resolve_plan`` completes it (without
    ``completar_patrones``), so the grid, the counts and the texts are the ones
    the next resolution will quote. ``patron`` replaces the structure's own
    ``patron_color`` and comes back with ``aplicado: true``; ``None`` asks for
    the preset, computed without the structure's current pattern, and comes
    back with ``aplicado: false`` — the structure's preset, or with ``modo``
    the starting point of that style (``sugerir_patron_modo``).

    Raises ``PlanResolutionError``: ``estructura_no_encontrada`` (404),
    ``patron_invalido`` (422, with ``estructura_id``/``motivo``/``mensaje``)
    or ``invalid_plan`` (422, the plan or the pattern breaks the contract).
    """
    index = _structure_index(plan, estructura_id)
    structures = [dict(structure) for structure in _mappings(plan.get("estructuras"))]
    if patron is None:
        structures[index].pop("patron_color", None)
    else:
        structures[index]["patron_color"] = json.loads(json.dumps(patron))
    candidate = {**dict(plan), "estructuras": structures}
    _validate_plan(candidate)
    completed = _complete_plan(candidate)
    _validate_plan(completed)
    context = _pattern_context(completed, _mappings(completed.get("estructuras"))[index])
    try:
        chosen = (
            dict(patron)
            if patron is not None
            else sugerir_patron_modo(context, modo)
            if modo is not None
            else sugerir_patron(context)
        )
        resolved = patron_resuelto(context, chosen, aplicado=patron is not None)
    except PatronColorInvalido as error:
        raise _pattern_error(estructura_id, error) from error
    return cast(dict[str, object], resolved)


def modos_admitidos_de_estructura(
    plan: Mapping[str, object], estructura_id: str
) -> list[dict[str, object]]:
    """Styles the pattern editor offers for one structure (``modos_admitidos``).

    Raises ``PlanResolutionError`` (``estructura_no_encontrada`` or ``invalid_plan``).
    """
    _validate_plan(plan)
    index = _structure_index(plan, estructura_id)
    completed = _complete_plan(plan)
    context: EstructuraPatron = _pattern_context(
        completed, _mappings(completed.get("estructuras"))[index]
    )
    admitidos: list[dict[str, object]] = modos_admitidos(context)
    return admitidos


def sincronizar_participaciones(plan: Mapping[str, object]) -> dict[str, object]:
    """``plan`` with ``participacion`` rewritten for every structure with a pattern.

    Only ``participacion`` changes: measures are completed to size each grid,
    but the returned plan keeps the caller's own. This is what a plan edit
    must call after touching a pattern or the materials of a patterned
    structure, so the edited plan already says what resolution will count.
    Raises ``PlanResolutionError`` (``invalid_plan`` or ``patron_invalido``).
    """
    _validate_plan(plan)
    return _sync_participations(_complete_measures(plan), plan)


def sugerir_patron_para_estructura(
    plan: Mapping[str, object], estructura_id: str
) -> dict[str, object] | None:
    """Preset ``patron_color`` for one structure (ADR-0028 §6), or ``None``.

    ``None`` when the structure admits no pattern: not geometric, a single
    material, or a grid too small for every color of the preset. Raises
    ``PlanResolutionError`` (``estructura_no_encontrada`` or ``invalid_plan``).
    """
    _validate_plan(plan)
    index = _structure_index(plan, estructura_id)
    measured = _complete_measures(plan)
    context = _pattern_context(measured, _mappings(measured.get("estructuras"))[index])
    try:
        return cast(dict[str, object], sugerir_patron(context))
    except PatronColorInvalido:
        return None


__all__ = [
    "CatalogPlanStore",
    "MERMA",
    "PLAN_RESOLUTION_SCOPE",
    "PistaPatron",
    "PlanAllowlistEntry",
    "PlanResolutionError",
    "PlanResolutionRequest",
    "patron_resuelto_de_estructura",
    "resolve_plan",
    "sincronizar_participaciones",
    "sugerir_patron_para_estructura",
]
