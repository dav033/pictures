"""El racimo de pared en la guía de escena (estructura oficial ``racimo_pared``, aprobada el 2026-10-06).

Un grupo orgánico de globos de varios tamaños fijado a la pared, sin base, sin peso y sin cintas (foto 3 de la
Fase 7). Antes solo existía «bouquet» y la imagen salía como un ramo de helio con cintas. No tiene armado: se
dibuja como la figura sin forma conocida (``figura._ovalo``), con los globos que se compran
(``unidades_declaradas`` entre ``repeticiones``), los tamaños de la ``mezcla_real`` y la proporción de la caja de
la foto. Va **anclado a la pared**: la guía lo centra en su caja, sin poste ni base.

Todo es determinista: sin azar, sin reloj y sin catálogo.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from app.guia_piezas import ContextoPieza, PiezaDePlugin
from app.guia_piezas.figura import _aspecto_ovalo, _cantidades, _ovalo, _texto, _unidades
from app.plan_armado_comun import materiales_de

ID_OFICIAL = "racimo_pared"


def es_racimo_pared(estructura: Mapping[str, object]) -> bool:
    """Si la estructura es un racimo de pared: solo por el campo declarado (no hay planes de antes con él)."""
    return bool(_texto(estructura.get("estructura_oficial")) == ID_OFICIAL)


def pieza_de(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> PiezaDePlugin | None:
    """Los globos de un racimo de pared, anclados a la pared; ``None`` si la estructura no es uno."""
    if not es_racimo_pared(estructura) or not colores:
        return None
    cuantos = min(len(colores), len(materiales_de(estructura)))
    if cuantos == 0:
        return None
    unidades = _unidades(
        _cantidades(estructura, cuantos), colores, estructura.get("mezcla"), contexto
    )
    return PiezaDePlugin(_ovalo(unidades, _aspecto_ovalo(contexto)), anclaje="pared")
