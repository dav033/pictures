"""La puerta de entrada deja pasar TODOS los modos del contrato.

Esto ha fallado dos veces, y las dos igual: el modo estaba en el contrato,
`patron_color` sabía armarlo, y un modelo de pydantic con la lista escrita a
mano lo rechazaba. La petición entera moría con un 422 y la app lo mostraba
como «el servicio no está disponible».

* 2026-09-29/30: `zonas` (ADR-0036), un día entero.
* 2026-10-01: los nueve modos porteados del diseñador de arcos del
  clasificador, en cuanto la lectura de la foto devolvió uno.

Lo que se vigila no es una lista: es que no haya **ninguna** lista a mano. Si
mañana alguien escribe un `Literal[...]` con los modos, estas pruebas lo
encuentran el mismo día.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.patron_color import MODOS
from app.plan import PistaPatron
from app.plan_edicion import PlanPatronRequest

APP = Path(__file__).resolve().parent.parent / "app"


@pytest.mark.parametrize("modo", MODOS)
def test_una_pista_de_cualquier_modo_del_contrato_entra(modo: str) -> None:
    """La pista que devuelve la lectura de la foto, para cada modo que existe."""
    pista = PistaPatron.model_validate(
        {
            "referencia_element_id": "REF_01_E01",
            "modo": modo,
            "colores": ["blanco", "negro"],
            "confianza": 0.9,
        }
    )
    assert pista.modo == modo


@pytest.mark.parametrize("modo", MODOS)
def test_el_editor_puede_pedir_cualquier_modo_del_contrato(modo: str) -> None:
    """Pulsar un estilo en la galería del editor: `patron_color` nulo y el modo."""
    peticion = PlanPatronRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000029",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-patron.v1",
            "plan": {},
            "estructura_id": "EST_01",
            "patron_color": None,
            "modo": modo,
        }
    )
    assert peticion.modo == modo


def test_un_modo_inventado_se_rechaza_nombrando_los_que_hay() -> None:
    """Rechazar sigue siendo lo correcto; lo que cambia es que el motivo se lea."""
    with pytest.raises(ValidationError) as fallo:
        PistaPatron.model_validate(
            {
                "referencia_element_id": "REF_01_E01",
                "modo": "tornasolado",
                "colores": ["blanco"],
                "confianza": 0.5,
            }
        )
    mensaje = str(fallo.value)
    assert "tornasolado" in mensaje
    assert "espiral" in mensaje, "el error tiene que listar los estilos que sí hay"


def test_ningun_modelo_de_entrada_lleva_la_lista_de_modos_a_mano() -> None:
    """La regla de fondo: la lista vive en el contrato y en ningún otro sitio.

    Se busca un `Literal[...]` que mencione dos modos a la vez, que es la forma
    que tenían los dos que fallaron. `patron_color` queda fuera: él es quien LEE
    los modos del contrato, y sus tablas (`_MODO_ES`, `_MODOS_POR_TIPO`) son
    otra cosa —cómo se llama y dónde se arma cada uno—, no una puerta.
    """
    sospechosos: list[str] = []
    for archivo in sorted(APP.glob("*.py")):
        if archivo.name in {"patron_color.py", "generated_models.py"}:
            continue
        texto = archivo.read_text(encoding="utf-8")
        for literal in re.findall(r"Literal\[[^\]]*\]", texto, re.S):
            nombrados = [modo for modo in MODOS if f'"{modo}"' in literal]
            if len(nombrados) >= 2:
                sospechosos.append(f"{archivo.name}: {', '.join(nombrados)}")
    assert not sospechosos, (
        "un modelo volvió a llevar los modos a mano; usa `ModoPatronColor`: "
        + "; ".join(sospechosos)
    )
