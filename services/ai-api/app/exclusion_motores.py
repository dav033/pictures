"""Un solo trabajo de motor a la vez en todo ai-api, sin cola.

Las vistas previas y las ediciones que colocan globos (arco, columna, columna orgánica, guirnalda orgánica) corren en el
hilo único del plan (``plan_worker``, ``PLAN_CPU_WORKERS = 1``) y ``asyncio.wait_for`` no corta un hilo en marcha. Una
vista previa grande tarda varios segundos; si el plazo de la edición (5 s) vence, Next da la petición por perdida y
libera su contador, pero el hilo sigue trabajando: con un contador por ruta caben cuatro dibujos por ruta (16 en total)
contra un solo hilo, y todo lo demás del plan (la resolución, la confirmación) espera detrás.

Aquí hay un cupo **global**: quien no lo consigue recibe ``motor_ocupado`` (HTTP 429) al instante y reintenta. La
reserva se toma antes de encolar el trabajo y la suelta el propio hilo al terminar (aunque su petición ya se haya
cancelado); si el trabajo se canceló en la cola sin llegar a correr, la suelta quien lo canceló. Una reserva que nadie
soltó (el hilo murió) vence a los 30 s. Es el mismo patrón de ``estimar_conteo.ExclusionDeEstimacion``, que sigue siendo
suyo: la estimación tiene su propia reserva y su propio código.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import ParamSpec, TypeVar

from app.plan import PlanResolutionError
from app.plan_worker import run_plan_cpu

P = ParamSpec("P")
T = TypeVar("T")

#: Una reserva que nadie soltó se da por vencida pasado este tiempo, para que un trabajo perdido no deje los motores
#: ocupados para siempre.
RESERVA_MAXIMA_S = 30.0

CODIGO_OCUPADO = "motor_ocupado"

#: Las ediciones del plan que colocan los globos de un motor y por eso comparten el cupo con las vistas previas.
ACCIONES_DE_MOTOR = frozenset(
    {"armado_arco", "armado_columna", "armado_columna_organica", "armado_guirnalda_organica"}
)


class Reserva:
    """El derecho de correr un trabajo de motor; ``iniciada`` dice si su hilo llegó a empezar."""

    def __init__(self) -> None:
        self.iniciada = False


class ExclusionDeMotores:
    """A lo sumo un trabajo de motor a la vez, sin cola."""

    def __init__(self, reloj: Callable[[], float] = time.monotonic) -> None:
        self._candado = threading.Lock()
        self._reloj = reloj
        self._reserva: Reserva | None = None
        self._desde = 0.0

    def reservar(self) -> Reserva | None:
        with self._candado:
            vencida = self._reserva is not None and self._reloj() - self._desde > RESERVA_MAXIMA_S
            if self._reserva is not None and not vencida:
                return None
            self._reserva, self._desde = Reserva(), self._reloj()
            return self._reserva

    def soltar(self, reserva: Reserva) -> None:
        with self._candado:
            if self._reserva is reserva:
                self._reserva = None

    def soltar_si_no_inicio(self, reserva: Reserva) -> None:
        if not reserva.iniciada:
            self.soltar(reserva)

    def ejecutar(
        self, reserva: Reserva, funcion: Callable[P, T], *args: P.args, **kwargs: P.kwargs
    ) -> T:
        """El trabajo que corre en el hilo del plan: marca que empezó y suelta la reserva al terminar."""
        reserva.iniciada = True
        try:
            return funcion(*args, **kwargs)
        finally:
            self.soltar(reserva)


MOTORES = ExclusionDeMotores()


async def correr_motor(funcion: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    """``funcion`` en el hilo del plan si hay cupo; si no, ``PlanResolutionError("motor_ocupado", 429)`` al instante."""
    reserva = MOTORES.reservar()
    if reserva is None:
        raise PlanResolutionError(CODIGO_OCUPADO, 429)
    try:
        resultado: T = await run_plan_cpu(MOTORES.ejecutar, reserva, funcion, *args, **kwargs)
        return resultado
    except BaseException:
        # Cancelada o vencida en la cola sin haber corrido: nadie más soltaría la reserva.
        MOTORES.soltar_si_no_inicio(reserva)
        raise


__all__ = [
    "ACCIONES_DE_MOTOR",
    "CODIGO_OCUPADO",
    "MOTORES",
    "RESERVA_MAXIMA_S",
    "ExclusionDeMotores",
    "Reserva",
    "correr_motor",
]
