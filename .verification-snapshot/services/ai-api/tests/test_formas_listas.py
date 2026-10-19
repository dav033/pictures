"""Las formas listas de los cuatro motores orgánicos caben en los límites de su motor.

Una forma lista es un preset del diseñador: un arco de herradura, una guirnalda de festones, una columna
pilar, un ramo de suelo. Son las que el editor ofrece en una lista y las que la receta elige cuando la foto
no manda otra cosa, así que todas tienen que ser **diseños legales**: aplicarla y sanearla no puede cambiar
ni una cifra.

Esto no es un detalle de implementación: un preset fuera de rango se acota en silencio y lo que se arma no es
lo que la lista prometía. Al añadir el arco de herradura y el de cascada (2026-10-03) los dos salieron fuera
—`curva` 1,5 cuando el motor acota a [1,7; 3,4] y una cima de 0,5 m con patas de 1,3 m cuando no puede bajar
de la mitad de las patas— y lo único que se veía era un aviso que nadie leía. Esta prueba lo dice por su
nombre.

El dueño de los criterios es el otro repo (``clasificador-decoraciones/src/lib/*/formas.ts``): si una forma
falla aquí, se corrige **allá** y se replica, nunca al contrario.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

import pytest

from app.bouquet.formas import FORMAS_RAMO, aplicar_forma_ramo
from app.bouquet.limites import sanear as sanear_ramo
from app.bouquet.tipos import config_inicial as config_ramo
from app.columnaorg.formas import ESTILOS_COL, FORMAS_COLUMNA
from app.columnaorg.limites import sanear as sanear_col
from app.columnaorg.tipos import config_inicial as config_col
from app.guirnalda.formas import ESTILOS_GUIR, FORMAS_GUIRNALDA, aplicar_forma_guir
from app.guirnalda.limites import sanear as sanear_guir
from app.guirnalda.tipos import config_inicial as config_guir
from app.organico.formas import FORMAS_LISTAS
from app.organico.limites import sanear as sanear_org
from app.organico.tipos import config_inicial as config_org


def _aplicar_campos(base: Mapping[str, Any], forma: Any) -> dict[str, Any]:
    """La forma puesta sobre la config inicial, igual que hace el editor: copiar sus campos."""
    puesta = dict(base)
    puesta["forma"] = {**dict(base["forma"]), **dict(forma.forma)}
    puesta["volumen"] = dict(forma.volumen)
    puesta["tamanos"] = dict(forma.tamanos)
    puesta["semilla"] = forma.semilla
    return puesta


#: Un motor orgánico: cómo arranca, cómo se le pone una forma y cómo se sanea. El ramo tiene su propia
#: función de aplicar porque su forma lleva látex y especiales en vez de volumen.
_MOTORES: list[tuple[str, Sequence[Any], Callable[[Any], dict[str, Any]], Callable[..., Any]]] = [
    ("arco organico", FORMAS_LISTAS, lambda f: _aplicar_campos(config_org(), f), sanear_org),
    (
        "guirnalda",
        FORMAS_GUIRNALDA,
        lambda f: dict(aplicar_forma_guir(config_guir(), f)),
        sanear_guir,
    ),
    ("columna organica", FORMAS_COLUMNA, lambda f: _aplicar_campos(config_col(), f), sanear_col),
    ("bouquet", FORMAS_RAMO, lambda f: dict(aplicar_forma_ramo(config_ramo(), f)), sanear_ramo),
]

_CASOS = [
    pytest.param(motor, forma, aplicar, sanear, id=f"{motor}-{forma.id}")
    for motor, formas, aplicar, sanear in _MOTORES
    for forma in formas
]


@pytest.mark.parametrize(("motor", "forma", "aplicar", "sanear"), _CASOS)
def test_cada_forma_lista_es_un_diseno_legal(
    motor: str,
    forma: Any,
    aplicar: Callable[[Any], dict[str, Any]],
    sanear: Callable[..., Any],
) -> None:
    _config, avisos = sanear(aplicar(forma))
    assert avisos == [], (
        f"la forma «{forma.id}» del motor de {motor} está fuera de los límites del motor y el saneado la"
        f" cambia: {avisos}. Corrígela en clasificador-decoraciones y replica el cambio."
    )


def test_los_catalogos_no_tienen_ids_repetidos() -> None:
    """Dos formas con el mismo id hacen que el editor y la receta elijan una al azar."""
    for motor, formas, _aplicar, _sanear in _MOTORES:
        ids = [f.id for f in formas]
        assert len(ids) == len(set(ids)), f"ids repetidos en el motor de {motor}: {ids}"


def test_un_estilo_sobre_una_forma_nunca_cambia_la_pieza_en_silencio() -> None:
    """Un estilo es la otra mitad de la lista: cuánto se llena la pieza, sobre la forma ya puesta.

    Aquí el invariante no es que no cambie nada —un estilo lleno sobre una guirnalda de piso sí sube la altura
    mínima para que la banda no se hunda, y eso es correcto—, sino que **todo lo que cambie quede dicho**. Un
    ajuste callado es el fallo que `AGENTS.md` prohíbe: el respaldo tiene que ser observable.

    Pescó tres casos reales (2026-10-03): `diagonal` con cualquier estilo perdía 30 cm de pendiente sin decir
    nada, porque el acotado de `pendienteM`, `ondaM` y `colgadoM` no empujaba aviso mientras sus vecinos sí.
    """
    for nombre, formas, estilos, aplicar, sanear in (
        (
            "guirnalda",
            FORMAS_GUIRNALDA,
            ESTILOS_GUIR,
            lambda f: dict(aplicar_forma_guir(config_guir(), f)),
            sanear_guir,
        ),
        (
            "columna organica",
            FORMAS_COLUMNA,
            ESTILOS_COL,
            lambda f: _aplicar_campos(config_col(), f),
            sanear_col,
        ),
    ):
        for forma in formas:
            for estilo in estilos:
                puesto = dict(estilo.aplicar(aplicar(forma)))
                saneado, avisos = sanear(puesto)
                movidos = {
                    f"{grupo}.{clave}": (valor, saneado[grupo].get(clave))
                    for grupo in ("forma", "volumen")
                    for clave, valor in puesto[grupo].items()
                    if saneado[grupo].get(clave) != valor
                }
                assert not movidos or avisos, (
                    f"el estilo «{estilo.id}» sobre la forma «{forma.id}» de la {nombre} cambia la pieza y no"
                    f" lo dice: {movidos}"
                )
