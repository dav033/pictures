"""Lo que una edición del plan le hace al armado de la guirnalda del motor (ADR-0034).

``armado_guirnalda_organica`` nombra los colores de la pieza por índice (``colores.paleta[].material``) y la
compra de una guirnalda armada sale de lo que el motor coloca. Tres cosas para ``plan_edicion.py``, que
son las mismas que ya tiene el arco (``armado_arco``, ADR-0035) y viven aquí en un módulo propio para no
mezclar motores en el mismo archivo:

- **Fijar o quitar el armado** (``fijar_armado_guirnalda_organica``): se valida contra la pieza **sin catálogo** con
  la misma puerta que la vista previa y la resolución (``armado_guirnalda_organica.armado_resuelto``), así que guardar
  no acepta lo que luego la resolución rechazaría. **El largo lo pone el armado**: una guirnalda armada mide lo que el
  motor dice que mide, no lo que el plan declaraba, o la tarjeta, el cálculo y la imagen hablarían de dos guirnaldas.

- **Reparto y mezcla no se editan** en una guirnalda armada (``sin_armado_guirnalda_organica``): la cuenta es
  la del motor, así que ni ``participacion`` ni ``mezcla`` cambian cuántos globos se compran; aceptarlos solo
  movería el ``plan_hash`` con el mismo total y diría «listo» sin cambiar nada.
- **Cambiar los colores de la pieza revalida el armado** (``revisar_armado_guirnalda_organica``): quitar un
  color deja índices que apuntan a otro color o a ninguno, y nunca se guarda así.

Puro y sin catálogo: el plan llega en el cuerpo y solo se mira el armado de la pieza.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import cast

from app.armado_guirnalda_organica import (
    ArmadoInvalido,
    EstructuraGuirnalda,
    armado_resuelto,
    avisos_colores_sin_uso,
    validar,
)
from app.plan import MERMA, PlanResolutionError
from app.plan_armado_comun import TONO_NEUTRO

CLAVE_ARMADO = "armado_guirnalda_organica"

AVISO_COLORES = (
    "Quitaste un color: la paleta de la guirnalda se ajustó a los colores que quedan. "
    "Revisa la paleta del armado."
)
AVISO_PALETA_NUEVA = (
    "Quitaste el color que usaba la guirnalda: ahora lleva el primer color de la pieza. "
    "Revisa la paleta del armado."
)
AVISO_COLOR_NUEVO = (
    "Agregaste un color: la guirnalda no lo usa todavía. Agrégalo a la paleta del armado."
)

_Identidad = tuple[object, object, object]


def _materiales(estructura: Mapping[str, object]) -> list[Mapping[str, object]]:
    crudos = estructura.get("materiales")
    if not isinstance(crudos, Sequence) or isinstance(crudos, str):
        return []
    return [m for m in cast(Sequence[object], crudos) if isinstance(m, Mapping)]


def identidades(estructura: Mapping[str, object]) -> list[_Identidad]:
    """Quién es cada color de la pieza, en su orden: lo que cambia cuando se agrega o se quita uno."""
    return [
        (m.get("product_id"), m.get("variant_id"), m.get("color")) for m in _materiales(estructura)
    ]


def _indice_quitado(antes: Sequence[_Identidad], despues: Sequence[_Identidad]) -> int | None:
    """La posición del material que una edición quitó, o ``None`` si no se quitó ninguno."""
    if len(despues) != len(antes) - 1:
        return None
    return next(
        (i for i, previo in enumerate(antes) if i >= len(despues) or despues[i] != previo), None
    )


def _armado(estructura: Mapping[str, object]) -> dict[str, object] | None:
    armado = estructura.get(CLAVE_ARMADO)
    return cast(dict[str, object], armado) if isinstance(armado, dict) else None


def colores_sin_uso(estructura: Mapping[str, object]) -> list[str]:
    """Los colores de la pieza que la paleta del armado no toma, como avisos para el decorador."""
    armado = _armado(dict(estructura))
    if armado is None:
        return []
    paleta = cast(
        Sequence[Mapping[str, object]], cast(Mapping[str, object], armado["colores"])["paleta"]
    )
    sin_uso: list[str] = avisos_colores_sin_uso(
        [str(m.get("color") or "") for m in _materiales(estructura)],
        [cast(int, color["material"]) for color in paleta],
    )
    return sin_uso


def fijar_armado_guirnalda_organica(
    estructura: dict[str, object], armado: Mapping[str, object] | None, estructura_id: str
) -> list[str]:
    """Fija o quita el armado de una guirnalda; lo comprueba contra la pieza sin catálogo (``armado_invalido``).

    Lo que el motor exige del armado —que la pieza sea una guirnalda, que haya una mezcla de tamaños y que cada
    índice de la paleta exista en ``materiales``— se sabe sin catálogo. Lo demás (el grosor que cabe en el largo,
    los tamaños que caben en la banda, los festones que se sostienen) el motor lo corrige al resolver y lo cuenta
    en los avisos; no se rechaza. Los colores no importan aquí, solo cuántos son. Devuelve los avisos de lo que
    guardar deja sin comprar (un color de la pieza que la paleta no toma).
    """
    if armado is None:
        estructura.pop(CLAVE_ARMADO, None)
        return []
    propio = copy.deepcopy(dict(armado))
    pieza = EstructuraGuirnalda(
        es_guirnalda=estructura.get("tipo") == "guirnalda",
        materiales=[TONO_NEUTRO] * len(_materiales(estructura)),
    )
    try:
        resuelto = armado_resuelto(pieza, propio, MERMA)
    except ArmadoInvalido as error:
        raise PlanResolutionError(
            "armado_invalido",
            422,
            {"estructura_id": estructura_id, "motivo": error.motivo, "mensaje": error.mensaje},
        ) from error
    estructura[CLAVE_ARMADO] = propio
    medidas = estructura.get("medidas")
    estructura["medidas"] = {
        **(cast(Mapping[str, object], medidas) if isinstance(medidas, Mapping) else {}),
        "largo_m": round(float(cast(float, resuelto["largo_m"])), 2),
        "alto_m": round(float(cast(float, resuelto["alto_m"])), 2),
        "ancho_m": round(float(cast(float, resuelto["ancho_m"])), 2),
    }
    return colores_sin_uso(estructura)


def sin_armado_guirnalda_organica(estructura: Mapping[str, object]) -> None:
    """El reparto y la mezcla no se editan en una guirnalda armada: la compra sale de su armado."""
    if estructura.get(CLAVE_ARMADO) is not None:
        raise PlanResolutionError("armado_guirnalda_organica_activo", 409)


def revisar_armado_guirnalda_organica(
    estructura: dict[str, object], antes: Sequence[_Identidad]
) -> list[str]:
    """Una guirnalda armada vuelve a validarse contra los colores que la pieza lleva ahora.

    - **Quitar un color**: las entradas de la paleta que lo usaban se descartan y los índices mayores se
      corren. Si la paleta se queda vacía, la guirnalda pasa al primer color de la pieza y se dice. Si el color
      que sale es posterior a todos los que usa la paleta, no hay nada que mover.
    - **Agregar un color**: los índices no se mueven y el armado vale tal cual; el color nuevo no se usa hasta
      que el decorador lo agregue a la paleta, y se avisa.
    - Reemplazar o repartir no cambian cuántos son ni su orden: nada que revisar.
    """
    armado = _armado(estructura)
    if armado is None:
        return []
    despues = identidades(estructura)
    if len(despues) == len(antes) + 1:
        return [AVISO_COLOR_NUEVO]
    quitado = _indice_quitado(antes, despues)
    if quitado is None:
        return []
    colores = cast(dict[str, object], armado["colores"])
    paleta = cast(list[dict[str, object]], colores["paleta"])
    if all(cast(int, color["material"]) < quitado for color in paleta):
        return []
    quedan = [
        {
            **color,
            "material": cast(int, color["material"])
            - (1 if cast(int, color["material"]) > quitado else 0),
        }
        for color in paleta
        if color["material"] != quitado
    ]
    nueva_paleta = quedan or [{**paleta[0], "material": 0, "rol": "normal"}]
    ajustado = {
        **armado,
        "origen": "decorador",
        "colores": {**colores, "paleta": nueva_paleta},
    }
    pieza = EstructuraGuirnalda(es_guirnalda=True, materiales=[TONO_NEUTRO] * len(despues))
    try:
        validar(pieza, ajustado)
    except ArmadoInvalido as error:
        # Un armado que ya no se sostiene con lo que queda no se guarda a medias: el cambio se rechaza con
        # la frase del motor, igual que cualquier otro armado inválido.
        raise PlanResolutionError(
            "armado_invalido",
            422,
            {
                "estructura_id": str(estructura.get("estructura_id") or ""),
                "motivo": error.motivo,
                "mensaje": error.mensaje,
            },
        ) from error
    estructura[CLAVE_ARMADO] = ajustado
    sin_uso = avisos_colores_sin_uso(
        [str(m.get("color") or "") for m in _materiales(estructura)],
        [cast(int, color["material"]) for color in nueva_paleta],
    )
    return [AVISO_PALETA_NUEVA if not quedan else AVISO_COLORES, *sin_uso]


__all__ = [
    "AVISO_COLORES",
    "AVISO_COLOR_NUEVO",
    "AVISO_PALETA_NUEVA",
    "colores_sin_uso",
    "fijar_armado_guirnalda_organica",
    "identidades",
    "revisar_armado_guirnalda_organica",
    "sin_armado_guirnalda_organica",
]
