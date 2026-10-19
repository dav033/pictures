"""Lo que una edición del plan le hace al armado del arco orgánico del motor (ADR-0034, ADR-0035).

``armado_arco_organico`` arma **dos piezas**: el arco orgánico (o asimétrico) y el ``semiarco``, que es ese
mismo armado con ``forma.corte`` menor que 1 (encabezado de ``app/armado_arco_organico.py``). Nombra los
colores de la pieza por índice (``colores.paleta[].material``) y la compra de un arco armado sale de lo que el
motor coloca. Tres cosas para ``plan_edicion.py``, las mismas que ya tienen la columna orgánica y la guirnalda
del motor, en un módulo propio para no mezclar motores en el mismo archivo:

- **Fijar o quitar el armado** (``fijar_armado_arco_organico``): se valida contra la pieza **sin catálogo** con
  la misma puerta que la vista previa y la resolución (``armado_arco_organico.armado_resuelto``), así que guardar
  no acepta lo que luego la resolución rechazaría. **El ancho y el alto los pone el armado**: un arco armado
  mide lo que el motor dice que mide, no lo que el plan declaraba, o la tarjeta, el cálculo y la imagen
  hablarían de dos arcos. Un arco que ya trae el armado clásico (``armado_arco``) no recibe este encima: con
  los dos, el plan contaría con el clásico y este quedaría guardado sin contarse (``armado_arco_presente``).
- **Reparto, mezcla, densidad y medidas no se editan** en un arco armado (``sin_armado_arco_organico``): la
  cuenta es la del motor, así que aceptarlos solo movería el ``plan_hash`` con el mismo total.
- **Cambiar los colores de la pieza revalida el armado** (``revisar_armado_arco_organico``): quitar un color
  deja índices que apuntan a otro color o a ninguno, y nunca se guarda así.

Puro y sin catálogo: el plan llega en el cuerpo y solo se mira el armado de la pieza.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import cast

from app.armado_arco_organico import (
    ArmadoInvalido,
    EstructuraArcoOrganico,
    armado_resuelto,
    avisos_colores_sin_uso,
    indices_usados,
    validar,
)
from app.plan import MERMA, OFICIALES_SIN_MOTOR, PlanResolutionError
from app.plan_armado_comun import TONO_NEUTRO

CLAVE_ARMADO = "armado_arco_organico"
#: El otro armado posible de un arco (la rejilla de patrones): en un ``arco`` manda él si están los dos.
CLAVE_ARMADO_CLASICO = "armado_arco"
#: Las piezas que este motor arma: el arco y el medio arco (``plan._TIPO_DE_CLASE["arco_organico"]``).
TIPOS_ARCO_ORGANICO = frozenset({"arco", "semiarco"})

AVISO_COLORES = (
    "Quitaste un color: la paleta del arco se ajustó a los colores que quedan. "
    "Revisa la paleta del armado."
)
AVISO_PALETA_NUEVA = (
    "Quitaste el color que usaba el arco: ahora lleva el primer color de la pieza. "
    "Revisa la paleta del armado."
)
AVISO_COLOR_NUEVO = (
    "Agregaste un color: el arco no lo usa todavía. Agrégalo a la paleta del armado."
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


def _es_del_motor(estructura: Mapping[str, object]) -> bool:
    """Si este motor arma la pieza: un arco o un semiarco que no es un aro (``OFICIALES_SIN_MOTOR``)."""
    oficial = estructura.get("estructura_oficial")
    if isinstance(oficial, str) and oficial in OFICIALES_SIN_MOTOR:
        return False
    return estructura.get("tipo") in TIPOS_ARCO_ORGANICO


def colores_sin_uso(estructura: Mapping[str, object]) -> list[str]:
    """Los colores de la pieza que la paleta del armado no toma, como avisos para el decorador."""
    armado = _armado(dict(estructura))
    if armado is None:
        return []
    sin_uso: list[str] = avisos_colores_sin_uso(
        [str(m.get("color") or "") for m in _materiales(estructura)], indices_usados(armado)
    )
    return sin_uso


def fijar_armado_arco_organico(
    estructura: dict[str, object], armado: Mapping[str, object] | None, estructura_id: str
) -> list[str]:
    """Fija o quita el armado del arco orgánico; lo comprueba contra la pieza sin catálogo (``armado_invalido``).

    Lo que el motor exige —que la pieza sea un arco o un semiarco, que haya una mezcla de tamaños, que cada
    índice de la paleta exista en ``materiales`` y que el arco quepa en el tope de globos— se sabe sin
    catálogo. Lo demás (el grosor que cabe en el ancho, los tamaños que caben en la banda) el motor lo corrige
    al resolver y lo cuenta en los avisos; no se rechaza. Devuelve los avisos de lo que guardar deja sin
    comprar (un color de la pieza que la paleta no toma).
    """
    if armado is None:
        estructura.pop(CLAVE_ARMADO, None)
        return []
    # En un `arco` con el clásico guardado, el plan cuenta con el clásico: poner este encima lo dejaría sin
    # contarse ni publicarse. Un `semiarco` no cuenta nunca con el clásico (no sabe cortarse), así que ahí no
    # estorba. Quitar un armado (``None``) siempre se puede.
    if estructura.get("tipo") == "arco" and estructura.get(CLAVE_ARMADO_CLASICO) is not None:
        raise PlanResolutionError("armado_arco_presente", 409, {"estructura_id": estructura_id})
    propio = copy.deepcopy(dict(armado))
    pieza = EstructuraArcoOrganico(
        es_arco=_es_del_motor(estructura),
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
        "ancho_m": round(float(cast(float, resuelto["ancho_m"])), 2),
        "alto_m": round(float(cast(float, resuelto["alto_m"])), 2),
    }
    return colores_sin_uso(estructura)


def sin_armado_arco_organico(estructura: Mapping[str, object]) -> None:
    """Reparto, mezcla, densidad y medidas no se editan en un arco armado: la compra sale de su armado.

    Solo cuando el armado **cuenta**: en un aro circular (``OFICIALES_SIN_MOTOR``) un armado viejo guardado no
    cuenta, y la pieza sigue con su fórmula, que sí lee esos campos.
    """
    if estructura.get(CLAVE_ARMADO) is not None and _es_del_motor(estructura):
        raise PlanResolutionError("armado_arco_organico_activo", 409)


def revisar_armado_arco_organico(
    estructura: dict[str, object], antes: Sequence[_Identidad]
) -> list[str]:
    """Un arco armado vuelve a validarse contra los colores que la pieza lleva ahora.

    - **Quitar un color**: las entradas de la paleta que lo usaban se descartan y los índices mayores se
      corren. Si la paleta se queda vacía, el arco pasa al primer color de la pieza y se dice. Si el color que
      sale es posterior a todos los que usa la paleta, no hay nada que mover.
    - **Agregar un color**: los índices no se mueven y el armado vale tal cual; el color nuevo no se usa hasta
      que el decorador lo agregue a la paleta, y se avisa.
    - Reemplazar no cambia cuántos son ni su orden: nada que revisar.
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
    ajustado = {**armado, "origen": "decorador", "colores": {**colores, "paleta": nueva_paleta}}
    pieza = EstructuraArcoOrganico(es_arco=True, materiales=[TONO_NEUTRO] * len(despues))
    try:
        validar(pieza, ajustado)
    except ArmadoInvalido as error:
        # Un armado que ya no se sostiene con lo que queda no se guarda a medias: el cambio se rechaza con la
        # frase del motor, igual que cualquier otro armado inválido.
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
        [str(m.get("color") or "") for m in _materiales(estructura)], indices_usados(ajustado)
    )
    return [AVISO_PALETA_NUEVA if not quedan else AVISO_COLORES, *sin_uso]


__all__ = [
    "AVISO_COLORES",
    "AVISO_COLOR_NUEVO",
    "AVISO_PALETA_NUEVA",
    "colores_sin_uso",
    "fijar_armado_arco_organico",
    "identidades",
    "revisar_armado_arco_organico",
    "sin_armado_arco_organico",
]
