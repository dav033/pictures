"""La figura con globos en la guía de escena (``app/guia_piezas/figura.py``).

- **Reconoce** la oficial ``figura`` (y, sin el campo, el tipo ``escultura`` o el nombre); nada más.
- **Los globos** son los que se compran por instancia, en los colores y tamaños de sus materiales y su mezcla.
- **La forma**: un número o una letra nombrados se leen (el «1» es más alto que ancho, la «H» tiene dos
  postes); lo demás es un óvalo vertical; el foil es un globo grande del color principal.
- **De punta a punta**: ``guia_escena.pieza_de_guia`` deja de omitir la figura.
"""

from __future__ import annotations

from collections import Counter

import pytest

from app.arco.tipos import INFLADO_PULG
from app.guia_escena import hex_del_material, pieza_de_guia
from app.guia_piezas import figura
from app.guia_piezas.figura import Globo, es_figura, glifos_de, globos_de
from tests.guirnalda_datos import material

ROSA = "#ff3d8b"
BLANCO = "#ffffff"


def _figura(
    nombre: str,
    *,
    unidades: int = 40,
    mezcla: str = "clasica",
    oficial: str | None = "figura",
    tipo: str = "kit",
    repeticiones: int = 1,
    participaciones: tuple[float, float] = (0.75, 0.25),
) -> dict[str, object]:
    estructura: dict[str, object] = {
        "estructura_id": "EST_04_FIGURA",
        "nombre": nombre,
        "tipo": tipo,
        "rol_escena": "focal",
        "ubicacion": "piso_frontal",
        "medidas": {"alto_m": 1.2},
        "repeticiones": repeticiones,
        "densidad": "media",
        "mezcla": mezcla,
        "materiales": [
            material("rosado", participaciones[0], principal=True),
            material("blanco", participaciones[1]),
        ],
        "porque": "Figura de prueba.",
        "unidades_declaradas": unidades,
    }
    if oficial is not None:
        estructura["estructura_oficial"] = oficial
    return estructura


def _caja(globos: list[Globo]) -> tuple[float, float]:
    ancho = max(x + r for x, _y, r, _t in globos) - min(x - r for x, _y, r, _t in globos)
    alto = max(y + r for _x, y, r, _t in globos) - min(y - r for _x, y, r, _t in globos)
    return ancho, alto


def _globos(estructura: dict[str, object]) -> list[Globo]:
    globos = globos_de(estructura, [ROSA, BLANCO])
    assert globos is not None
    return globos


def test_reconoce_solo_la_figura() -> None:
    assert es_figura(_figura("Osito"))
    assert es_figura(_figura("Escultura de oso", oficial=None, tipo="escultura"))
    assert es_figura(_figura("Figura de globos", oficial=None))
    # El campo declarado manda sobre el nombre; un bouquet nunca es figura.
    assert not es_figura(_figura("Figura de globos", oficial="centro_mesa"))
    assert not es_figura(_figura("Bouquet con figura", oficial=None))
    assert globos_de(_figura("Arco", oficial="arco", tipo="arco"), [ROSA, BLANCO]) is None
    assert globos_de(_figura("Pared", oficial=None, tipo="pared"), [ROSA, BLANCO]) is None


@pytest.mark.parametrize(
    ("texto", "glifos"),
    [
        ("Figura número 5", "5"),
        ("Números 1 y 8 de globos", "18"),
        ("Figura 18 años", "18"),
        ("Figura 3", "3"),
        ("Letra M en rosado", "M"),
        ("Iniciales A y B", "AB"),
        ("Palabra LOVE", "LOVE"),
        ("Escultura 2 osos", ""),
        ("Osito de globos", ""),
    ],
)
def test_lee_los_numeros_y_las_letras_del_nombre(texto: str, glifos: str) -> None:
    assert glifos_de(texto) == glifos


def test_los_globos_y_colores_son_los_que_se_compran_por_instancia() -> None:
    globos = _globos(_figura("Figura número 5", unidades=80, repeticiones=2))
    assert len(globos) == 40
    assert Counter(tono for *_xyr, tono in globos) == {ROSA: 30, BLANCO: 10}
    # Mezcla clásica: todos R-12, inflados según INFLADO_PULG.
    assert {round(r, 6) for _x, _y, r, _t in globos} == {round(INFLADO_PULG[12] * 0.0254 / 2, 6)}


def test_la_mezcla_declarada_da_los_tamanos() -> None:
    globos = _globos(_figura("Osito", unidades=100, mezcla="organica_fina"))
    radios = Counter(round(r / 0.0254 * 2, 3) for _x, _y, r, _t in globos)
    assert radios == {
        INFLADO_PULG[5]: 21,
        INFLADO_PULG[9]: 18,
        INFLADO_PULG[12]: 54,
        INFLADO_PULG[18]: 5,
        INFLADO_PULG[24]: 2,
    }


def test_el_uno_es_mas_alto_que_ancho_y_el_cero_mas_ancho_que_el_uno() -> None:
    ancho_uno, alto_uno = _caja(_globos(_figura("Figura número 1")))
    ancho_cero, alto_cero = _caja(_globos(_figura("Figura número 0")))
    assert alto_uno > 2 * ancho_uno
    assert alto_cero > ancho_cero
    assert ancho_cero / alto_cero > ancho_uno / alto_uno


def test_la_h_tiene_dos_postes_y_un_hueco() -> None:
    globos = _globos(_figura("Letra H", unidades=60))
    ancho, alto = _caja(globos)
    izquierda = min(x for x, *_resto in globos)
    # Por encima del travesaño, el centro de la letra queda vacío entre los dos postes.
    centro = izquierda + (ancho - 2 * globos[0][2]) / 2 + globos[0][2]
    altos = [g for g in globos if g[1] > 0.75 * alto]
    assert altos and all(abs(x - centro) > r for x, _y, r, _t in altos)


def test_varias_cifras_van_una_tras_otra() -> None:
    ancho_uno, _ = _caja(_globos(_figura("Figura número 5", unidades=40)))
    ancho_dos, _ = _caja(_globos(_figura("Figura número 55", unidades=80)))
    assert ancho_dos > 1.8 * ancho_uno


def test_sin_forma_conocida_es_un_ovalo_vertical() -> None:
    globos = _globos(_figura("Osito de globos", unidades=60))
    ancho, alto = _caja(globos)
    assert len(globos) == 60
    assert 1.1 < alto / ancho < 1.8


def test_mas_globos_hacen_una_figura_mas_grande() -> None:
    _, pequena = _caja(_globos(_figura("Unicornio", unidades=30)))
    _, grande = _caja(_globos(_figura("Unicornio", unidades=120)))
    assert grande > 1.5 * pequena


def test_el_foil_es_un_globo_grande_del_color_principal() -> None:
    solo = _globos(_figura("Figura foil de estrella", unidades=1, participaciones=(1.0, 1.0)))
    # Con un material de más, cada material compra al menos uno: un globo al pie, detrás, y el foil delante.
    assert len(solo) == 2
    assert solo[-1] == (0.0, 0.6, 0.6, ROSA)
    assert solo[0][3] == BLANCO
    numero = _globos(_figura("Número 5 metalizado", unidades=20))
    del_foil = [g for g in numero if g[2] == pytest.approx(0.09 * 1.2)]
    assert del_foil and {g[3] for g in del_foil} == {ROSA}
    assert numero[-len(del_foil) :] == del_foil
    ancho, alto = _caja(del_foil)
    assert alto == pytest.approx(1.2)
    assert ancho < alto
    assert len(numero) - len(del_foil) == 19


def test_es_determinista() -> None:
    estructura = _figura("Figura número 7", unidades=50, mezcla="organica_gruesa")
    assert globos_de(estructura, [ROSA, BLANCO]) == globos_de(estructura, [ROSA, BLANCO])


def test_todos_los_glifos_tienen_esqueleto() -> None:
    assert set(figura.TRAZOS) == set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    for glifo in figura.TRAZOS:
        assert (
            len(_globos(_figura(f"Letra {glifo}" if glifo.isalpha() else f"Número {glifo}"))) == 40
        )


def test_la_guia_de_escena_ya_no_omite_la_figura() -> None:
    estructura = _figura("Figura número 1", unidades=30)
    pieza = pieza_de_guia(estructura, [])
    assert isinstance(pieza, dict)
    assert pieza["fuente"] == "dibujo"
    discos = pieza["discos"]
    assert isinstance(discos, list) and len(discos) == 30
    tonos = {hex_del_material(m) for m in [material("rosado", 1), material("blanco", 1)]}
    assert {d["hex"] for d in discos} == tonos
    assert float(str(pieza["alto_m"])) > 2 * float(str(pieza["ancho_m"]))
