"""Las propiedades de una pieza que su fórmula lee: densidad y medidas (edición ``propiedades``).

Una pieza que **ningún motor arma** —la pared, el aro circular, el techo de globos, el centro de mesa— se
cuenta con la fórmula de ``plan.py`` (``_formula_count``): el eje o el área salen de ``medidas`` y cuántos
globos caben, de ``densidad``. Su editor («Editar pared», «Editar aro»…) cambia esos campos y la forma
elegida (``formas-pieza.ts``) en **una** edición, así que la propuesta se vuelve a resolver y a firmar una sola
vez (nuevo ``plan_hash``, un solo «Deshacer»). Aquí no se cuenta nada: se escriben los campos y la
re-resolución de siempre los cuenta.

Reglas:

- **La densidad es una de las que admite su estructura oficial** (``densidad_invalida``, 422, con las
  admitidas): una ``pared_densa`` es media o lujosa, la no densa es sencilla. La tabla es la del contrato
  (``plan._admitted_densities``, que la lee de las reglas ``allOf`` exportadas): no se repite aquí.
- **Las medidas se mezclan con las que ya trae**: el editor manda solo las que cambió.
- **Una pieza armada por un motor no las cambia** (los ``sin_armado_*`` de cada motor, 409): su cuenta es la
  del armado, que pone sus propias medidas, así que aceptarlas solo movería el ``plan_hash`` con el mismo
  total. Un armado viejo guardado en una pieza sin motor (``OFICIALES_SIN_MOTOR``) no cuenta y no estorba.

Puro y sin catálogo.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import cast

from app.plan import OFICIALES_SIN_MOTOR, PlanResolutionError, _admitted_densities

#: Los campos de ``medidas`` que el contrato admite (``MedidasSchema`` en ``src/lib/plan/tipos.ts``).
CAMPOS_MEDIDAS = ("ancho_m", "alto_m", "largo_m")


def sin_motor(estructura: Mapping[str, object]) -> bool:
    """Si la pieza es de las que ningún motor arma, aunque guarde un armado viejo."""
    oficial = estructura.get("estructura_oficial")
    return isinstance(oficial, str) and oficial in OFICIALES_SIN_MOTOR


def fijar_propiedades(
    estructura: dict[str, object],
    *,
    densidad: str | None,
    medidas: Mapping[str, float] | None,
    estructura_id: str,
    guardias: Sequence[Callable[[Mapping[str, object]], None]] = (),
) -> None:
    """Escribe la densidad y las medidas de la pieza, comprobando la densidad contra su oficial.

    ``guardias`` son los ``sin_armado_*`` de los motores: rechazan el cambio si un armado cuenta la pieza.
    No corren en una pieza sin motor, donde un armado guardado no cuenta.
    """
    if densidad is None and not medidas:
        return
    if not sin_motor(estructura):
        for guardia in guardias:
            guardia(estructura)
    if densidad is not None:
        admitidas = _admitted_densities(estructura)
        if densidad not in admitidas:
            raise PlanResolutionError(
                "densidad_invalida",
                422,
                {
                    "estructura_id": estructura_id,
                    "densidad": densidad,
                    "densidades_admitidas": list(admitidas),
                },
            )
        estructura["densidad"] = densidad
    if medidas:
        actuales = estructura.get("medidas")
        estructura["medidas"] = {
            **(cast(Mapping[str, object], actuales) if isinstance(actuales, Mapping) else {}),
            **{campo: medidas[campo] for campo in CAMPOS_MEDIDAS if campo in medidas},
        }


__all__ = ["CAMPOS_MEDIDAS", "fijar_propiedades", "sin_motor"]
