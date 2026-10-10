"""El racimo de pared en la guía de escena (``app/guia_piezas/racimo_pared.py``, 2026-10-06).

- **Reconoce** solo la oficial ``racimo_pared``; un bouquet o una figura no son suyos.
- **Los globos** son los que se compran por instancia, en los colores de sus materiales.
- **Va en la pared**: la pieza publica ``anclaje`` «pared» (sin poste ni base), no se apoya en el piso.
"""

from __future__ import annotations

from app.guia_escena import hex_del_material, pieza_de_guia
from app.guia_piezas.racimo_pared import es_racimo_pared, pieza_de
from tests.guirnalda_datos import material


def _racimo(
    oficial: str = "racimo_pared", unidades: int = 16, repeticiones: int = 1
) -> dict[str, object]:
    return {
        "estructura_id": "EST_01_RACIMO",
        "nombre": "Racimo de pared rosa",
        "tipo": "kit",
        "estructura_oficial": oficial,
        "rol_escena": "focal",
        "ubicacion": "arco_central",
        "medidas": {"alto_m": 0.8},
        "repeticiones": repeticiones,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("rosado", 0.7, principal=True), material("blanco", 0.3)],
        "porque": "Racimo de prueba.",
        "unidades_declaradas": unidades,
    }


def test_solo_reconoce_el_racimo_de_pared() -> None:
    assert es_racimo_pared(_racimo())
    assert not es_racimo_pared(_racimo("bouquet"))
    assert not es_racimo_pared(_racimo("figura"))
    assert pieza_de(_racimo("bouquet"), ["#ff0000"]) is None


def test_dibuja_los_globos_que_se_compran_por_instancia_y_va_en_la_pared() -> None:
    pieza = pieza_de(_racimo(unidades=32, repeticiones=2), ["#ff3d8b", "#ffffff"])
    assert pieza is not None
    assert pieza.anclaje == "pared"
    assert len(pieza.globos) == 16
    assert {tono for _x, _y, _r, tono in pieza.globos} == {"#ff3d8b", "#ffffff"}


def test_la_guia_de_escena_no_lo_omite_y_lo_cuelga_de_la_pared() -> None:
    pieza = pieza_de_guia(_racimo(unidades=16), [])
    assert isinstance(pieza, dict)
    assert pieza["fuente"] == "dibujo"
    discos = pieza["discos"]
    assert isinstance(discos, list) and len(discos) == 16
    tonos = {hex_del_material(m) for m in [material("rosado", 1), material("blanco", 1)]}
    assert {d["hex"] for d in discos} == tonos
    assert pieza.get("anclaje") == "pared"
