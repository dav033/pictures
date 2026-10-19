"""El cupo global de los motores (ALTO-3): un solo trabajo que coloca globos a la vez en todo ai-api.

Las vistas previas del arco, la columna, la columna orgánica y la guirnalda orgánica, y las ediciones que guardan su
armado, corren en el hilo único del plan. Un contador por ruta en Next no lo protege (se libera al vencer el plazo
aunque el hilo siga ocupado), así que el cupo vive en Python: ``motor_ocupado`` (429) al instante, la reserva la suelta
el propio trabajo y una reserva perdida vence a los 30 s. Lo que se prueba es el transporte y el cupo; los números de
cada motor los fijan sus propias pruebas.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from typing import Any, cast

import pytest

from app.exclusion_motores import (
    ACCIONES_DE_MOTOR,
    CODIGO_OCUPADO,
    MOTORES,
    RESERVA_MAXIMA_S,
    ExclusionDeMotores,
    correr_motor,
)
from app.plan import PlanResolutionError
from tests import test_plan_armado_arco as arco
from tests import test_plan_armado_columna as columna
from tests import test_plan_armado_columna_organica as columna_organica
from tests import test_plan_armado_guirnalda_organica as guirnalda_organica
from tests import test_plan_edicion_armado_columna_organica as edicion_organica


@pytest.fixture(autouse=True)
def _cupo_libre() -> Any:
    """Cada prueba empieza con el cupo libre y lo deja libre, pase lo que pase."""
    MOTORES._reserva = None
    yield
    MOTORES._reserva = None


# --- La reserva ----------------------------------------------------------------------------------------------


def test_la_segunda_reserva_no_espera_y_la_primera_se_suelta() -> None:
    exclusion = ExclusionDeMotores()
    primera = exclusion.reservar()
    assert primera is not None
    assert exclusion.reservar() is None, "no hay cola: la segunda recibe ocupado"
    exclusion.soltar(primera)
    assert exclusion.reservar() is not None


def test_soltar_una_reserva_ajena_no_libera_la_vigente() -> None:
    exclusion = ExclusionDeMotores()
    vieja = exclusion.reservar()
    assert vieja is not None
    exclusion.soltar(vieja)
    vigente = exclusion.reservar()
    exclusion.soltar(vieja)  # una cancelación tardía de la anterior
    assert exclusion.reservar() is None, "la reserva vigente sigue siendo de su dueño"
    assert vigente is not None


def test_una_reserva_que_nadie_solto_vence_a_los_30_segundos() -> None:
    ahora = [1000.0]
    exclusion = ExclusionDeMotores(reloj=lambda: ahora[0])
    assert exclusion.reservar() is not None
    ahora[0] += RESERVA_MAXIMA_S / 2
    assert exclusion.reservar() is None
    ahora[0] += RESERVA_MAXIMA_S
    assert exclusion.reservar() is not None, (
        "el hilo murió: no deja los motores ocupados para siempre"
    )
    assert RESERVA_MAXIMA_S == 30.0


def test_el_trabajo_suelta_la_reserva_aunque_falle() -> None:
    exclusion = ExclusionDeMotores()
    reserva = exclusion.reservar()
    assert reserva is not None

    def falla() -> None:
        raise ValueError("se rompió")

    with pytest.raises(ValueError):
        exclusion.ejecutar(reserva, falla)
    assert reserva.iniciada
    assert exclusion.reservar() is not None, "el finally del hilo la soltó"


def test_cancelado_en_la_cola_sin_correr_lo_suelta_quien_lo_cancelo() -> None:
    exclusion = ExclusionDeMotores()
    reserva = exclusion.reservar()
    assert reserva is not None
    exclusion.soltar_si_no_inicio(reserva)
    assert exclusion.reservar() is not None
    # Si el hilo ya empezó, no se suelta desde fuera: lo hará él al terminar.
    otra = ExclusionDeMotores()
    iniciada = otra.reservar()
    assert iniciada is not None
    iniciada.iniciada = True
    otra.soltar_si_no_inicio(iniciada)
    assert otra.reservar() is None


# --- correr_motor --------------------------------------------------------------------------------------------


def test_correr_motor_ejecuta_y_libera_el_cupo() -> None:
    assert asyncio.run(correr_motor(lambda a, b: a + b, 2, 3)) == 5
    assert MOTORES.reservar() is not None, "el trabajo terminó y soltó el cupo"


def test_correr_motor_con_el_cupo_tomado_responde_ocupado_sin_ejecutar() -> None:
    reserva = MOTORES.reservar()
    assert reserva is not None
    llamadas: list[int] = []
    with pytest.raises(PlanResolutionError) as caso:
        asyncio.run(correr_motor(lambda: llamadas.append(1)))
    assert (caso.value.code, caso.value.status_code) == (CODIGO_OCUPADO, 429)
    assert llamadas == [], "el trabajo ni siquiera se encola"
    assert MOTORES._reserva is reserva, "el rechazado no toca la reserva de quien sí corre"


def test_un_trabajo_que_falla_libera_el_cupo_para_el_siguiente() -> None:
    def falla() -> None:
        raise RuntimeError("fallo del motor")

    with pytest.raises(RuntimeError):
        asyncio.run(correr_motor(falla))
    assert asyncio.run(correr_motor(lambda: "listo")) == "listo"


def test_con_varios_a_la_vez_corre_uno_y_los_demas_reciben_ocupado() -> None:
    async def varios() -> list[object]:
        def lento() -> str:
            import time

            time.sleep(0.2)
            return "hecho"

        return await asyncio.gather(
            *(correr_motor(lento) for _ in range(5)), return_exceptions=True
        )

    resultados = asyncio.run(varios())
    hechos = [r for r in resultados if r == "hecho"]
    ocupados = [
        r for r in resultados if isinstance(r, PlanResolutionError) and r.code == CODIGO_OCUPADO
    ]
    assert (len(hechos), len(ocupados)) == (1, 4), resultados


# --- Las rutas -----------------------------------------------------------------------------------------------


_CONTADOR = [0]


def _nonce() -> str:
    """Los nonces no se repiten (anti-replay): cada petición lleva el suyo."""
    _CONTADOR[0] += 1
    return f"00000000-0000-4000-8000-{0xE0A000 + _CONTADOR[0]:012x}"


#: Cada ruta con la función que le hace una petición válida (la receta de su pieza).
_RUTAS: dict[str, Callable[[], tuple[int, dict[str, object]]]] = {
    "arco": lambda: arco._post(arco._operacion(None), _nonce()),
    "columna": lambda: columna._post(columna._operacion(None), _nonce()),
    "columna orgánica": lambda: columna_organica._post(columna_organica._operacion(None), _nonce()),
    "guirnalda orgánica": lambda: guirnalda_organica._post(
        guirnalda_organica._operacion(None), _nonce()
    ),
}


@pytest.mark.parametrize("nombre", list(_RUTAS))
def test_cada_vista_previa_responde_429_motor_ocupado_con_el_cupo_tomado_y_200_al_soltarlo(
    nombre: str,
) -> None:
    pedir = _RUTAS[nombre]
    reserva = MOTORES.reservar()
    assert reserva is not None

    status, cuerpo = pedir()

    detalle = cast(Mapping[str, object], cuerpo["detail"])
    assert (status, detalle["code"]) == (429, CODIGO_OCUPADO), cuerpo
    MOTORES.soltar(reserva)

    status, cuerpo = pedir()
    assert status == 200, cuerpo
    assert MOTORES.reservar() is not None, "la vista previa soltó el cupo al terminar"


def test_guardar_un_armado_de_motor_comparte_el_cupo_y_otras_ediciones_no() -> None:
    reserva = MOTORES.reservar()
    assert reserva is not None
    # Guardar el armado de una columna orgánica coloca globos: con el cupo tomado, ocupado.
    status, cuerpo = edicion_organica._post(
        edicion_organica._operacion(edicion_organica.ARMADO), _nonce()
    )
    assert (status, cast(Mapping[str, object], cuerpo["detail"])["code"]) == (
        429,
        CODIGO_OCUPADO,
    ), cuerpo
    # Quitar el armado también es una edición de motor (misma acción), pero una edición barata como repartir no
    # espera al cupo: sigue su camino de siempre.
    assert "armado_columna_organica" in ACCIONES_DE_MOTOR and "repartir" not in ACCIONES_DE_MOTOR
    MOTORES.soltar(reserva)
    status, _ = edicion_organica._post(
        edicion_organica._operacion(edicion_organica.ARMADO), _nonce()
    )
    assert status == 200
