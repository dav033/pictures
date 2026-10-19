"""La pista de patrón de la foto casa sus colores como compra el catálogo (2026-10-05).

Antes cada color de la pista se casaba solo con un material, con un radio ΔE de 25 escrito a mano, y
la pista era todo o nada. Una foto burdeos que el catálogo compró en rojo (ΔE 40,9, dentro de su radio
de sustitución de 45) perdía la pista entera; un acento que el plan no compró, también; y un lila leído
podía caer en el material rosado (ΔE 24) aunque otro color de la misma lectura fuera ese rosado. Ahora:

- (a) el color exacto; si no, (b) el material de tono más cercano dentro del radio del catálogo,
  leído del contrato, y solo si es recíproco: ese material no tiene otro color de la lectura más cerca;
- un acento sin material se descarta él solo, con aviso, y el patrón sigue con el resto; si el que falta
  es el dominante (o un puesto de la flor), la pista cae al preset como antes.

Las distancias de los comentarios son las de la tabla LAB del contrato (``x-tonos-colores-catalogo``).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

import pytest

from app.catalog import _DELTA_E_MAX
from app.generated_models import contract_schema
from app.patron_color import (
    DELTA_E_SUSTITUCION,
    EstructuraPatron,
    MaterialPatron,
    material_de_color,
    materiales_de_colores,
    patron_desde_pista,
)
from tests.guirnalda_datos import material, plan, resolver


def _estructura(
    colores: Sequence[str],
    *,
    tipo: str = "columna",
    total: int = 48,
    partes: Sequence[float] | None = None,
    ancho: float | None = None,
    alto: float | None = None,
) -> EstructuraPatron:
    partes = partes or [1 / len(colores)] * len(colores)
    return EstructuraPatron(
        estructura_id="EST_01",
        tipo=tipo,
        total=total,
        un_tamano=True,
        ancho_m=ancho,
        alto_m=alto,
        repeticiones=1,
        materiales=tuple(
            MaterialPatron(color=color, acabado=None, participacion=parte)
            for color, parte in zip(colores, partes, strict=True)
        ),
    )


def _pista(modo: str, colores: Sequence[str], **extra: object) -> dict[str, object]:
    return {
        "referencia_element_id": "REF_E1",
        "modo": modo,
        "colores": list(colores),
        "confianza": 0.9,
        **extra,
    }


def _base(patron: Mapping[str, object] | None) -> dict[str, object]:
    assert patron is not None
    return cast(dict[str, object], patron["base"])


def test_el_radio_es_el_de_sustitucion_del_catalogo() -> None:
    tonos = cast(Mapping[str, object], contract_schema("CatalogSearch")["x-tonos-colores-catalogo"])
    assert DELTA_E_SUSTITUCION == tonos["delta_e_maximo"] == _DELTA_E_MAX


def test_burdeos_comprado_en_rojo_conserva_la_pista() -> None:
    # burdeos -> rojo: ΔE 40,9 < 45, el mismo cambio que hace el catálogo al comprar. Antes (radio 25)
    # la pista entera caía al preset.
    estructura = _estructura(["rojo", "blanco", "dorado"])
    avisos: list[str] = []

    patron = patron_desde_pista(
        estructura, _pista("espiral", ["burdeos", "blanco", "dorado"]), avisos
    )

    # Racimo de 4 con los tres colores en orden: [0, 1, 2, 0].
    assert _base(patron) == {"modo": "espiral", "racimo": [0, 1, 2, 0], "trazo": "espiral"}
    assert avisos == []
    assert material_de_color(estructura.materiales, "burdeos") == 0


def test_un_color_solo_usa_el_mismo_radio() -> None:
    lejos = _estructura(["rojo", "azul"])
    assert material_de_color(lejos.materiales, "verde") is None  # ΔE 110 y 119
    assert material_de_color(lejos.materiales, "Rojo") == 0  # igualdad normalizada


def test_un_tono_cercano_no_le_quita_el_material_a_otro_color_leido() -> None:
    # rosado -> lila: ΔE 24. Pero el lila de la pieza es del lila leído (ΔE 0): el rosado se queda sin
    # material en vez de pintarse de lila, y el blanco va a lo suyo.
    estructura = _estructura(["lila", "blanco"])
    assert materiales_de_colores(estructura.materiales, ["rosado", "lila", "blanco"]) == [
        None,
        0,
        1,
    ]
    # Solo, el rosado sí casa con el lila: no hay otro color leído que reclame ese material.
    assert material_de_color(estructura.materiales, "rosado") == 0


def test_un_lila_leido_nunca_cae_en_el_rosado_si_la_pieza_lleva_lila() -> None:
    estructura = _estructura(["rosado", "lila", "blanco"])
    assert materiales_de_colores(estructura.materiales, ["lila", "rosado"]) == [1, 0]

    patron = patron_desde_pista(estructura, _pista("anillos", ["lila", "blanco"]))

    # Anillos lila y blanco; el rosado de la pieza, que la foto no nombró, va de acento.
    assert _base(patron) == {"modo": "anillos", "secuencia": [1, 2], "largo": 1}
    assert patron is not None and [acento["material"] for acento in patron["acentos"]] == [0]  # type: ignore[attr-defined]


def test_sin_reciprocidad_el_dominante_tumba_la_pista_como_antes() -> None:
    # El lila (dominante) está a ΔE 24 del rosado, pero el rosado leído es del rosado: el lila no tiene
    # material y, al ser el primero, la pista cae al preset.
    estructura = _estructura(["rosado", "blanco"])
    avisos: list[str] = []
    assert patron_desde_pista(estructura, _pista("anillos", ["lila", "rosado"]), avisos) is None
    assert avisos == [], "sin patrón no hay nada que avisar: quien llama dice la caída"


def test_un_acento_que_no_se_compro_se_descarta_solo_y_se_dice() -> None:
    estructura = _estructura(["rosado", "blanco", "dorado"])
    avisos: list[str] = []

    patron = patron_desde_pista(
        estructura, _pista("anillos", ["rosado", "blanco", "dorado", "negro"]), avisos
    )

    assert _base(patron) == {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}
    assert len(avisos) == 1 and "negro" in avisos[0]


def test_los_pesos_de_los_bloques_siguen_a_sus_colores() -> None:
    # El negro (30) no es de la pieza: quedan rosado 60 y blanco 10, en la misma proporción.
    estructura = _estructura(["rosado", "blanco"])
    patron = patron_desde_pista(
        estructura, _pista("bloques", ["rosado", "negro", "blanco"], pesos=[60, 30, 10])
    )

    assert _base(patron) == {
        "modo": "bloques",
        "bloques": [{"material": 0, "peso": 60}, {"material": 1, "peso": 10}],
    }


def test_una_mancha_de_un_color_ajeno_se_queda_fuera_sola() -> None:
    pared = _estructura(
        ["blanco", "negro", "azul"],
        tipo="pared",
        total=180,
        partes=(0.6, 0.3, 0.1),
        ancho=3,
        alto=2,
    )
    avisos: list[str] = []
    pista = _pista(
        "zonas",
        ["blanco", "negro", "azul"],
        zonas=[
            {"color": "negro", "ancla": "superior_derecha", "extension": 15},
            {"color": "verde", "ancla": "centro", "extension": 20},
            {"color": "azul", "ancla": "media_izquierda", "extension": 10},
        ],
    )

    base = _base(patron_desde_pista(pared, pista, avisos))

    assert base["fondo"] == 0
    zonas = cast(list[dict[str, object]], base["zonas"])
    assert [(zona["material"], zona["ancla"]) for zona in zonas] == [
        (1, "superior_derecha"),
        (2, "media_izquierda"),
    ]
    assert len(avisos) == 1 and "verde" in avisos[0]


def test_a_una_flor_no_le_puede_faltar_un_puesto() -> None:
    estructura = _estructura(["blanco", "rosado", "amarillo"])
    # El pétalo negro no es de la pieza: fondo, pétalo y centro son puestos, no acentos.
    assert patron_desde_pista(estructura, _pista("flor", ["blanco", "negro", "amarillo"])) is None
    # Un cuarto color sí es un acento y se descarta solo.
    avisos: list[str] = []
    patron = patron_desde_pista(
        estructura, _pista("flor", ["blanco", "rosado", "amarillo", "negro"]), avisos
    )
    base = _base(patron)
    assert (base["fondo"], base["petalo"], base["centro"]) == (0, 1, 2)
    assert len(avisos) == 1 and "negro" in avisos[0]


@pytest.mark.anyio
async def test_la_resolucion_dice_el_color_de_la_foto_que_quedo_fuera() -> None:
    pared = {
        "estructura_id": "EST_01_PARED",
        "nombre": "Pared",
        "tipo": "pared",
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 2.0, "alto_m": 1.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "referencia_element_id": "REF_E1",
        "materiales": [material("rosado", 0.6, principal=True), material("blanco", 0.4)],
        "porque": "Pared de prueba.",
    }

    resuelto = await resolver(
        plan(pared),
        completar_patrones=True,
        pistas_patron=[_pista("anillos", ["rosado", "blanco", "negro"])],
    )

    estructura = cast(
        list[dict[str, object]], cast(dict[str, object], resuelto["plan"])["estructuras"]
    )[0]
    patron = cast(dict[str, object], estructura["patron_color"])
    assert patron["origen"] == "referencia"
    assert patron["base"] == {"modo": "anillos", "secuencia": [0, 1], "largo": 1}
    avisos = [
        aviso
        for aviso in cast(list[str], resuelto["advertencias"])
        if aviso.startswith("pista_patron_incompleta:EST_01_PARED: Pared: ")
    ]
    assert len(avisos) == 1 and "negro" in avisos[0]
