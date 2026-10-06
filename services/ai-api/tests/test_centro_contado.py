"""UI-6: un centro de mesa que la foto cuenta EXACTAMENTE en 1 a 3 globos se compra por globos.

Defecto (CASE-006 de images-judge, rastreo del 2026-10-05): la foto leía «1 globo, exacto, grande» con
confianza 0,9-0,95 y el plan compraba 14, 3 o 22 globos, porque el centro de mesa se cuenta con la
fórmula de banda × eje, que no baja de unos 3. Ahora ``conteo_foto`` lo declara (``unidades_declaradas``
y la variante del tamaño leído) y ``plan.py`` lo compra como un kit.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

import pytest

from app.armado_bouquet import EstructuraBouquet
from app.conteo_foto import (
    MAX_GLOBOS_CENTRO_CONTADO,
    PuertoPlan,
    aplicar,
    es_centro_contado,
    es_geometrica,
)
from app.plan import _MIXES
from tests.test_conteo_foto import FILAS, _conteo, _plan_geometrico, _resolver_geometrico

#: Globos que la fórmula de mentira da a cualquier centro de mesa (el piso real ronda los 3).
FORMULA = 14


def _centro(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": "EST_01_CENTRO",
        "nombre": "Centro de mesa",
        "tipo": "centro_mesa",
        "rol_escena": "acento",
        "ubicacion": "sobre_mesa_principal",
        "medidas": {"ancho_m": 0.4, "alto_m": 0.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "referencia_element_id": "REF_01_E01",
        "porque": "Centro de mesa de la foto.",
        "materiales": [
            {"product_id": "prod-blanco", "color": "blanco", "participacion": 0.6, "rol_material": "principal"},
            {"product_id": "prod-negro", "color": "negro", "participacion": 0.4, "rol_material": "secundario"},
        ],
        **extra,
    }


def _puerto(variantes: Mapping[str, tuple[tuple[str, float], ...]]) -> PuertoPlan:
    def sin_kits(_estructura: Mapping[str, object]) -> EstructuraBouquet:
        raise AssertionError("no hay kits en esta prueba")

    return PuertoPlan(
        contar=lambda _e: FORMULA,
        dentro_de_puerta=lambda _e, _total: True,
        mezcla_cubierta=lambda _e, _mezcla: True,
        contexto_kit=sin_kits,
        sincronizar_patron=lambda e: dict(e),
        mezclas=_MIXES,
        tamanos_obligatorios=False,
        variantes_redondas=lambda producto: variantes.get(producto, ()),
    )


VARIANTES = {
    "prod-blanco": (("var-blanco-12", 12.0), ("var-blanco-18", 18.0), ("var-blanco-24", 24.0), ("var-blanco-36", 36.0)),
    "prod-negro": (("var-negro-12", 12.0), ("var-negro-18", 18.0)),
}


def _aplicar(
    estructura: dict[str, object], lectura: dict[str, object], puerto: PuertoPlan | None = None
) -> tuple[dict[str, object], dict[str, object]]:
    plan, _armados, [conteo] = aplicar(
        _plan_geometrico(estructura),
        [lectura],
        [],
        usar_armados=False,
        solo=None,
        puerto=puerto or _puerto(VARIANTES),
    )
    return cast(list[dict[str, object]], plan["estructuras"])[0], conteo


def test_un_globo_contado_se_compra_como_un_globo_del_tamano_leido() -> None:
    lectura = _conteo(globos_visibles=1, exacto=True, por_tamano=[{"clase": "gigante", "proporcion": 1.0}], confianza=0.92)
    estructura, conteo = _aplicar(_centro(patron_color={"modo": "aleatorio"}), lectura)
    assert estructura["unidades_declaradas"] == 1
    # Un globo solo: el material que más pesa, con la mayor variante de la clase leída (24"-36").
    assert estructura["materiales"] == [
        {"product_id": "prod-blanco", "color": "blanco", "participacion": 1.0, "rol_material": "principal", "variant_id": "var-blanco-36"}
    ]
    assert "patron_color" not in estructura, "un globo no tiene racimos que pintar"
    assert es_centro_contado(estructura) and not es_geometrica(estructura)
    assert (conteo["decision"], conteo["globos_antes"], conteo["globos_despues"]) == ("ajustado", FORMULA, 1)
    assert conteo["cambios"] == [{"campo": "unidades_declaradas", "antes": FORMULA, "despues": 1}]


def test_las_repeticiones_multiplican_y_se_quedan_los_materiales_que_caben() -> None:
    lectura = _conteo(globos_visibles=2, exacto=True, por_tamano=[{"clase": "grande", "proporcion": 1.0}])
    estructura, _ = _aplicar(_centro(repeticiones=5), lectura)
    assert estructura["unidades_declaradas"] == 10
    assert [m["variant_id"] for m in cast(list[dict[str, object]], estructura["materiales"])] == ["var-blanco-18", "var-negro-18"]
    assert sum(cast(float, m["participacion"]) for m in cast(list[dict[str, object]], estructura["materiales"])) == pytest.approx(1.0, abs=0.001)


def test_sin_variante_de_la_clase_se_elige_la_mas_cercana() -> None:
    lectura = _conteo(globos_visibles=1, exacto=True, por_tamano=[{"clase": "chico", "proporcion": 1.0}])
    estructura, _ = _aplicar(_centro(), lectura)
    assert cast(list[dict[str, object]], estructura["materiales"])[0]["variant_id"] == "var-blanco-12"


@pytest.mark.parametrize(
    "lectura",
    [
        _conteo(globos_visibles=1, exacto=False, estimado_total=1),  # un estimado no es una cuenta
        _conteo(globos_visibles=MAX_GLOBOS_CENTRO_CONTADO + 1, exacto=True),  # ya es un arreglo
        _conteo(globos_visibles=1, exacto=True, confianza=0.3),  # lectura poco fiable
    ],
)
def test_fuera_del_caso_sigue_la_geometria(lectura: dict[str, object]) -> None:
    estructura, conteo = _aplicar(_centro(), lectura)
    assert "unidades_declaradas" not in estructura and es_geometrica(estructura)
    assert conteo["decision"] != "ajustado" or "unidades_declaradas" not in str(conteo["cambios"])


def test_sin_variantes_en_el_turno_no_se_inventa_una() -> None:
    lectura = _conteo(globos_visibles=1, exacto=True)
    estructura, _ = _aplicar(_centro(), lectura, _puerto({}))
    assert "unidades_declaradas" not in estructura


def test_resolver_dos_veces_es_punto_fijo() -> None:
    lectura = _conteo(globos_visibles=1, exacto=True, por_tamano=[{"clase": "gigante", "proporcion": 1.0}])
    primera, _ = _aplicar(_centro(), lectura)
    segunda, conteo = _aplicar(primera, lectura)
    assert segunda == primera and conteo["decision"] == "coincide"


@pytest.mark.anyio
async def test_la_resolucion_completa_compra_un_solo_globo() -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_centro()),
        completar_conteos=True,
        pistas_conteo=[
            _conteo(globos_visibles=1, exacto=True, por_tamano=[{"clase": "gigante", "proporcion": 1.0}], confianza=0.92)
        ],
    )
    plan = cast(dict[str, object], resolved["plan"])
    estructura = cast(list[dict[str, object]], plan["estructuras"])[0]
    assert estructura["unidades_declaradas"] == 1
    lineas = cast(list[dict[str, object]], cast(list[dict[str, object]], resolved["estructuras"])[0]["lineas"])
    # FILAS tiene R-5 a R-24: la mayor de «gigante» es la de 24".
    assert [(linea["variant_id"], linea["unidades"]) for linea in lineas] == [("var-blanco-24", 1)]
    assert any(str(fila["variant_id"]) == "var-blanco-24" for fila in FILAS)


def test_la_guia_dibuja_exactamente_los_globos_contados() -> None:
    """Auditoría de propiedades huérfanas (2026-10-05): el centro contado llegaba a la guía de escena como el
    racimo de ~16 globos del esquema ``base``, y FLUX copiaba el racimo. Ahora lleva sus globos, de su tamaño."""
    from app.dibujo_estructura import globos_de_centro_contado
    from app.guia_escena import pieza_de_guia

    uno = _centro(unidades_declaradas=1, materiales=[{"product_id": "p", "variant_id": "v", "color": "transparente", "participacion": 1, "rol_material": "principal"}])
    mezcla_uno = [{"diam_pulg": 18, "forma": "redondo", "unidades": 1, "pct": 100}]
    pieza = pieza_de_guia(uno, mezcla_uno)
    assert isinstance(pieza, dict)
    discos = cast(list[dict[str, float]], pieza["discos"])
    assert len(discos) == 1
    assert discos[0]["x_m"] == 0

    tres = _centro(unidades_declaradas=3)
    mezcla_tres = [
        {"diam_pulg": 12, "forma": "redondo", "unidades": 2, "pct": 66.67},
        {"diam_pulg": 24, "forma": "redondo", "unidades": 1, "pct": 33.33},
    ]
    globos = globos_de_centro_contado(tres, mezcla_tres)
    assert globos is not None
    assert [g.nominal for g in globos] == [24, 12, 12], "del mayor al menor, los de la compra"
    assert len({g.color for g in globos}) == 2, "los dos materiales, en turno"
    assert abs(globos[0].x + globos[-1].x) < 1e-9, "la fila centrada sobre el eje de la pieza"
    assert all(abs(g.y - g.r) < 1e-9 for g in globos), "todos apoyados en la mesa"

    # Un centro que la geometría cuenta sigue con el esquema del repo dueño.
    assert globos_de_centro_contado(_centro(), mezcla_tres) is None
