"""Lo que una edición del plan le hace al armado de la columna del motor (ADR-0034, ADR-0035 paso 3).

``armado_columna`` nombra los colores de la pieza por índice (``materiales`` y ``remate.material``) y la compra de
una columna armada sale de lo que el motor coloca. Es el gemelo de lo que ya tiene el arco (``armado_arco``,
ADR-0035) en ``plan_edicion.py``; vive aquí en un módulo propio para no mezclar tres motores en el mismo archivo.
Cuatro cosas:

- **Fijar o quitar el armado** (``fijar_armado_columna``): se valida contra la pieza **sin catálogo** con la misma
  puerta que la vista previa y la resolución (``armado_columna.armado_resuelto``), así que guardar no acepta lo que
  luego la resolución rechazaría. **Las medidas las pone el armado**: una columna armada mide lo que el motor dice
  que mide, no lo que el plan declaraba, o la tarjeta, el cálculo y la imagen hablarían de dos columnas.
- **Reparto y mezcla no se editan** en una columna armada (``sin_armado_columna``): la cuenta es la del motor, así que
  ni ``participacion`` ni ``mezcla`` cambian cuántos globos se compran; aceptarlos solo movería el ``plan_hash`` con
  el mismo total y diría «listo» sin cambiar nada.
- **Cambiar los colores de la pieza revalida el armado** (``revisar_armado_columna``): quitar un color deja índices
  que apuntan a otro color o a ninguno, y nunca se guarda así.
- **Un color de la pieza que el armado no toma se avisa** (``colores_sin_uso``): no se compraría.

Puro y sin catálogo: el plan llega en el cuerpo y solo se mira el armado de la pieza.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import cast

from app.armado_columna import (
    PATRONES,
    ArmadoInvalido,
    EstructuraColumna,
    armado_resuelto,
    avisos_colores_sin_uso,
    materiales_con_globos,
    validar,
)
from app.plan import PlanResolutionError
from app.plan_armado_comun import TONO_NEUTRO

CLAVE_ARMADO = "armado_columna"
#: El otro armado posible de una columna (la columna orgánica del diseñador, ADR-0034): no conviven en la misma pieza.
CLAVE_ARMADO_ORGANICA = "armado_columna_organica"

#: El patrón al que baja una columna cuando ya no caben los colores de su patrón (un color es una columna sólida).
PATRON_SOLIDO = "solido"

AVISO_COLORES = (
    "Quitaste un color: el armado de la columna se ajustó a los colores que quedan. "
    "Revisa el patrón con «Editar columna»."
)
AVISO_SOLIDO = (
    "Quitaste un color y el patrón de la columna ya no cabe con los que quedan: la columna pasó a sólida. "
    "Elige otro patrón con «Editar columna»."
)
AVISO_COLOR_NUEVO = "Agregaste un color: la columna no lo usa todavía. Elige un patrón que lo tome con «Editar columna»."

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


def colores_sin_uso(estructura: Mapping[str, object]) -> list[str]:
    """Los colores de la pieza que el armado de la columna no toma, como avisos para el decorador."""
    armado = estructura.get(CLAVE_ARMADO)
    if not isinstance(armado, Mapping):
        return []
    # Lo que se compra de verdad, no lo que el armado declara: se resuelve con tonos neutros (el color no mueve
    # ningún globo) y se leen los materiales con globos del conteo y del remate.
    try:
        resuelto = armado_resuelto(
            EstructuraColumna(
                es_columna=True, materiales=[TONO_NEUTRO] * len(_materiales(estructura))
            ),
            armado,
        )
    except ArmadoInvalido:
        return []
    usados = materiales_con_globos(resuelto)
    return list(
        avisos_colores_sin_uso(
            [str(material.get("color") or "") for material in _materiales(estructura)], usados
        )
    )


def fijar_armado_columna(
    estructura: dict[str, object], armado: Mapping[str, object] | None, estructura_id: str
) -> list[str]:
    """Fija o quita el armado de una columna; lo comprueba contra la pieza sin catálogo (``armado_invalido``).

    Lo que el motor exige del armado —que la pieza sea una columna, que cada índice exista en ``materiales``, que no
    salgan más globos de los que el contrato publica— se sabe sin catálogo. Lo demás (el alto que cabe con el
    diámetro, el remate que guarda proporción) el motor lo corrige al resolver y lo cuenta en los avisos; no se
    rechaza. Los colores no importan aquí, solo cuántos son. Devuelve los avisos de lo que guardar deja sin comprar.
    """
    if armado is None:
        estructura.pop(CLAVE_ARMADO, None)
        return []
    # Una columna lleva UN armado: con los dos guardados el plan contaría con el clásico, publicaría solo ese y las
    # medidas serían las del último que se guardó. Quitar un armado (``None``) siempre se puede; poner uno encima del
    # otro no, y se dice cuál estorba.
    if estructura.get(CLAVE_ARMADO_ORGANICA) is not None:
        raise PlanResolutionError(
            "armado_columna_organica_presente", 409, {"estructura_id": estructura_id}
        )
    propio = copy.deepcopy(dict(armado))
    pieza = EstructuraColumna(
        es_columna=estructura.get("tipo") == "columna",
        materiales=[TONO_NEUTRO] * len(_materiales(estructura)),
    )
    try:
        resuelto = armado_resuelto(pieza, propio)
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
        "alto_m": round(float(cast(float, resuelto["alto_total_m"])), 2),
        "ancho_m": round(float(cast(float, resuelto["diametro_m"])), 2),
    }
    return colores_sin_uso(estructura)


def sin_armado_columna(estructura: Mapping[str, object]) -> None:
    """El reparto y la mezcla no se editan en una columna armada: la compra sale de su armado.

    Con ``armado_columna`` la cuenta es la del motor (cada globo colocado), así que ni ``participacion`` ni
    ``mezcla`` cambian cuántos globos se compran. Los colores y el tamaño del globo se cambian desde el armado.
    """
    if estructura.get(CLAVE_ARMADO) is not None:
        raise PlanResolutionError("armado_columna_activo", 409)


def _capas_sin_posiciones(
    capas: object, nuevas: Mapping[int, int]
) -> list[dict[str, object]] | None:
    """Las capas del armado tras quitar posiciones de ``materiales``, o ``None`` si alguna se queda sin colores.

    Los colores de cada capa (``capas[].materiales``) nombran POSICIONES de ``armado_columna.materiales``: al quitar
    una posición se descartan sus apariciones y las demás se corren. Una capa necesita de 3 a 6 colores (los globos
    del anillo): si queda con menos, ya no es una capa válida y el armado vuelve a un patrón.
    """
    salida: list[dict[str, object]] = []
    for capa in cast(Sequence[Mapping[str, object]], capas):
        quedan = [nuevas[i] for i in cast(Sequence[int], capa["materiales"]) if i in nuevas]
        if len(quedan) < 3:
            return None
        salida.append({**capa, "materiales": quedan})
    return salida


def revisar_armado_columna(estructura: dict[str, object], antes: Sequence[_Identidad]) -> list[str]:
    """Una columna armada vuelve a validarse contra los colores que la pieza lleva ahora (ADR-0035).

    ``armado_columna.materiales`` y ``remate.material`` nombran los colores de la pieza por índice, así que
    cambiar los colores de la pieza los puede dejar apuntando a otro color o a ninguno. Nunca se guarda así:

    - **Quitar un color**: los índices mayores se corren, las posiciones que lo usaban se descartan y el remate, si
      era de ese color, toma el primero que queda. Si con lo que queda el patrón sigue cabiendo se conserva y se
      avisa; si no (pide más colores de los que quedan, o una capa se queda sin colores) la columna baja a
      ``solido`` y se dice. Si el color que sale es posterior a todos los que usa el armado, no hay nada que mover.
    - **Agregar un color**: los índices no se mueven y el armado vale tal cual; el color nuevo no se usa hasta que
      el decorador elija un patrón que lo tome, y se avisa.
    - Reemplazar o repartir no cambian cuántos son ni su orden: nada que revisar.
    """
    armado = estructura.get(CLAVE_ARMADO)
    if not isinstance(armado, dict):
        return []
    despues = identidades(estructura)
    if len(despues) == len(antes) + 1:
        return [AVISO_COLOR_NUEVO]
    quitado = _indice_quitado(antes, despues)
    if quitado is None:
        return []
    usados = cast(list[int], armado["materiales"])
    remate = cast(dict[str, object], armado["remate"])
    material_remate = cast(int, remate["material"])
    if all(indice < quitado for indice in usados) and material_remate < quitado:
        return []
    posiciones = {p: i for p, i in enumerate(usados) if i != quitado}
    nuevas = {viejo: nuevo for nuevo, viejo in enumerate(posiciones)}
    materiales = [i - 1 if i > quitado else i for i in posiciones.values()]
    # El remate era de un color de la pieza: si era el que salió, toma el primero que queda; si no, se corre.
    nuevo_remate = (
        (materiales[0] if materiales else 0)
        if material_remate == quitado
        else (material_remate - 1 if material_remate > quitado else material_remate)
    )
    capas = _capas_sin_posiciones(armado["capas"], nuevas) if materiales else None
    ajustado: dict[str, object] = {
        **armado,
        "origen": "decorador",
        "materiales": materiales,
        "capas": capas if capas is not None else [],
        "remate": {**remate, "material": nuevo_remate},
    }
    pieza = EstructuraColumna(es_columna=True, materiales=[TONO_NEUTRO] * len(despues))
    cabe = (
        bool(materiales)
        and capas is not None
        and (
            ajustado["modo"] == "capas"
            or PATRONES[str(ajustado["patron"])].min_colores <= len(materiales)
        )
    )
    if cabe:
        try:
            validar(pieza, ajustado)
        except ArmadoInvalido:
            cabe = False
    if not cabe:
        estructura[CLAVE_ARMADO] = {
            **ajustado,
            "modo": "altura",
            "patron": PATRON_SOLIDO,
            "opciones": {},
            "materiales": [0],
            "capas": [],
            "remate": {
                **remate,
                "material": 0 if not materiales else min(nuevo_remate, len(despues) - 1),
            },
        }
        return [AVISO_SOLIDO, *colores_sin_uso(estructura)]
    estructura[CLAVE_ARMADO] = ajustado
    return [AVISO_COLORES, *colores_sin_uso(estructura)]


__all__ = [
    "AVISO_COLORES",
    "AVISO_COLOR_NUEVO",
    "AVISO_SOLIDO",
    "CLAVE_ARMADO",
    "colores_sin_uso",
    "fijar_armado_columna",
    "identidades",
    "revisar_armado_columna",
    "sin_armado_columna",
]
