"""Datos compartidos de las pruebas de guirnaldas por partes (ADR-0032).

Un catálogo de látex redondo en tres colores (rosado, blanco, dorado) y los
cinco diámetros estándar, y una guirnalda de 2,5 m en ``fondo_pared``,
``media``, ``organica_fina`` en rosado y blanco: 48 globos por instancia
(5" 10, 9" 9, 12" 26, 18" 2, 24" 1).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from app.plan import PlanResolutionRequest, resolve_plan

SNAPSHOT = "products_catalog:guirnalda"
COLORES = ("rosado", "blanco", "dorado")
DIAMETROS = (5, 9, 12, 18, 24)
GUIRNALDA = "EST_01_GUIRNALDA"


def _row(color: str, diametro: int) -> dict[str, object]:
    return {
        "product_id": f"prod-{color}",
        "variant_id": f"var-{color}-{diametro}",
        "sku": f"{color.upper()}-{diametro}",
        "sku_original": f"{color.upper()}-{diametro}",
        "source_snapshot_id": SNAPSHOT,
        "source_variant_id": f"source-{color}-{diametro}",
        "inventory_quantity": 5000,
        "unidades_inferidas": False,
        "producto_titulo": f"Globo látex {color}",
        "variante_titulo": f"R-{diametro}",
        "precio": 1000 * diametro,
        "unidades_paq": 50,
        "disponible": True,
        "producto_disponible": True,
        "codigo_tamano": f"R-{diametro}",
        "forma": "redondo",
        "diam_pulg": diametro,
        "colores_producto": [color],
        "colores_variante": [color],
        "acabados_producto": [],
        "descripcion": f"Globo látex {color}",
        "imagen": f"https://cdn.example/{color}-{diametro}.jpg",
        "currency": "COP",
    }


ROWS = [_row(color, diametro) for color in COLORES for diametro in DIAMETROS]


class FakePlanStore:
    async def published_snapshot(self, snapshot_id: str) -> str | None:
        return SNAPSHOT if snapshot_id == SNAPSHOT else None

    async def fetch_plan_rows(
        self, snapshot_id: str, product_ids: object, variant_ids: object, lora: object = ()
    ) -> list[dict[str, object]]:
        return ROWS

    async def fetch_catalog_identity(
        self, snapshot_id: str, product_ids: object, variant_ids: object
    ) -> list[dict[str, object]]:
        return [{"product_id": r["product_id"], "variant_id": r["variant_id"]} for r in ROWS] + [
            {"product_id": f"prod-{color}", "variant_id": None} for color in COLORES
        ]

    async def check_ready(self) -> bool:
        return True


def material(color: str, participacion: float, principal: bool = False) -> dict[str, object]:
    return {
        "product_id": f"prod-{color}",
        "color": color,
        "participacion": participacion,
        "rol_material": "principal" if principal else "secundario",
    }


def guirnalda(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": GUIRNALDA,
        "nombre": "Guirnalda",
        "tipo": "guirnalda",
        "estructura_oficial": "guirnalda",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"largo_m": 2.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("rosado", 0.6, principal=True), material("blanco", 0.4)],
        "porque": "Guirnalda de prueba.",
        **extra,
    }


def arco(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": "EST_02_ARCO",
        "nombre": "Arco",
        "tipo": "arco",
        "estructura_oficial": "arco",
        "rol_escena": "focal",
        "ubicacion": "arco_central",
        "medidas": {"ancho_m": 3, "alto_m": 2.4},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("dorado", 1.0, principal=True)],
        "porque": "Arco de prueba.",
        **extra,
    }


def plan(*estructuras: dict[str, object]) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "32323232-3232-4232-8232-323232323232",
        "concepto": {"titulo": "Prueba", "descripcion": "Guirnaldas.", "paleta": ["rosado"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": list(estructuras) or [guirnalda()],
        "supuestos": [],
        "referencia_omitida": [],
    }


def allowlist_hasta(diametro_maximo: int) -> list[dict[str, object]]:
    """Las variantes del catálogo de prueba que se pueden comprar, sin las de más de ``diametro_maximo`` pulgadas."""
    return [
        {
            "product_id": f"prod-{color}",
            "variant_ids": [f"var-{color}-{d}" for d in DIAMETROS if d <= diametro_maximo],
        }
        for color in COLORES
    ]


def request(plan_: Mapping[str, object], **extra: object) -> PlanResolutionRequest:
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000032",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": plan_,
            "allowlist": allowlist_hasta(max(DIAMETROS)),
            "catalog_snapshot_id": SNAPSHOT,
            **extra,
        }
    )


async def resolver(plan_: Mapping[str, object], **extra: object) -> dict[str, object]:
    result = await resolve_plan(request(plan_, **extra), FakePlanStore())  # type: ignore[arg-type]
    return cast(dict[str, object], result["plan_resuelto"])


def estructura_del_plan(resuelto: Mapping[str, object], indice: int = 0) -> dict[str, object]:
    plan_ = cast(dict[str, object], resuelto["plan"])
    return cast(list[dict[str, object]], plan_["estructuras"])[indice]


def lineas(resuelto: Mapping[str, object], indice: int = 0) -> list[dict[str, object]]:
    estructuras = cast(list[dict[str, object]], resuelto["estructuras"])
    return cast(list[dict[str, object]], estructuras[indice]["lineas"])
