from __future__ import annotations

import asyncio
from typing import Mapping, Sequence, cast

import pytest

from app.generated_models import ListaMaterialesRequest
from app.plan import CatalogMaterialQuoteStore, PlanResolutionError, cotizar_lista_materiales, validar_variant_ids_unicos


class CatalogoFalso:
    def __init__(self, rows: Sequence[Mapping[str, object]]) -> None:
        self.rows = rows

    async def fetch_current_material_rows(self, variant_ids: Sequence[str]) -> Sequence[Mapping[str, object]]:
        return [row for row in self.rows if row["variant_id"] in variant_ids]


def test_cotiza_paquetes_iva_y_sobrante_desde_catalogo() -> None:
    solicitud = ListaMaterialesRequest.model_validate(
        {
            "schema_version": "lista-materiales.v1",
            "materiales": [{"variant_id": "v-a", "cantidad": 51}],
        }
    )
    catalog = cast(
        CatalogMaterialQuoteStore,
        CatalogoFalso(
            [
                {
                    "variant_id": "v-a",
                    "nombre": "Globo ejemplo",
                    "precio": 12500,
                    "unidades_paq": 50,
                }
            ]
        ),
    )
    resultado = asyncio.run(cotizar_lista_materiales(solicitud, catalog))
    assert resultado["total"] == 25000
    assert resultado["incluye_iva"] is True
    assert resultado["lineas"] == [{"variant_id": "v-a", "nombre": "Globo ejemplo", "cantidad_necesaria": 51, "unidades_paquete": 50, "paquetes": 2, "precio_paquete": 12500, "subtotal": 25000, "sobrante": 49}]


def test_rechaza_variante_que_no_esta_en_el_catalogo_actual() -> None:
    solicitud = ListaMaterialesRequest.model_validate(
        {
            "schema_version": "lista-materiales.v1",
            "materiales": [{"variant_id": "v-missing", "cantidad": 1}],
        }
    )
    with pytest.raises(PlanResolutionError, match="material_no_disponible"):
        asyncio.run(cotizar_lista_materiales(solicitud, cast(CatalogMaterialQuoteStore, CatalogoFalso([]))))


def test_rechaza_variant_id_duplicado_como_entrada_invalida() -> None:
    with pytest.raises(ValueError, match="variant_id debe ser único"):
        validar_variant_ids_unicos(["v-a", "v-a"])
