"""Estimar el conteo de globos (``estimar-conteo.v1``): lo que cobraría el plan y qué lo acerca a la foto.

La IA no tenía cómo consultar el número de globos: solo lo obtenía confirmando el plan, que fija el estado y el
token de aprobación. Esta operación se lo deja consultar, **de solo lectura**: para unos candidatos (medidas,
densidad, mezcla y, si la pieza lo trae, el armado del motor) devuelve el total que ``resolve_plan`` cobraría,
de dónde sale, cómo se reparte por tamaño, si pasa la puerta física, y —si hay un objetivo, por ejemplo el
conteo de la foto— qué tan lejos queda y cuál es la menor variación de mandos que lo acerca.

**Ningún número se calcula aquí.** Cada cifra es de quien la decide al confirmar:

- el conteo, la puerta física y el reparto por tamaño son de ``plan.contar_pieza``, que abre sin copiarlas la
  fórmula (``_total_globos``), el motor del diseñador y ``_physical_warnings``;
- la tolerancia y la búsqueda de la menor variación de densidad y medidas son las de ``conteo_foto``
  (``buscar_ajuste``, la misma que corre al confirmar con la foto);
- este módulo es la frontera (valida el contrato, arma cada candidato como la pieza del plan y da forma a la
  respuesta); la sugerencia vive en ``estimar_conteo_sugerencia`` y los mandos del armado en
  ``estimar_conteo_mandos``.

**Una pieza con armado del motor no se cuenta con la fórmula**: el motor no lee la densidad, la mezcla ni las
medidas del plan, y la sugerencia mueve entonces los mandos del armado (``nota`` y ``sugerencia.motivo`` lo dicen).

Pura CPU, sin catálogo, sin red y sin escribir nada: no toca ``planResuelto``, el token ni ``plan_hash``.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from jsonschema import Draft7Validator
from pydantic import Field, model_validator

from app import conteo_foto
from app.estimar_conteo_sugerencia import (
    COSTO_EVALUACION,
    PRESUPUESTO_EVALUACIONES,
    PRESUPUESTO_SEGUNDOS,
    Presupuesto,
    hacer_brecha,
    sugerir,
)
from app.generated_models import contract_schema
from app.armado_estructura import CLAVE_ARMADO
from app.operational_models import OperationalRequest
from app.plan import PiezaContada, PlanResolutionError, con_medidas_por_defecto, contar_pieza

ESTIMAR_CONTEO_SCOPE = "plan.estimar_conteo"
ESTIMAR_CONTEO_REQUEST_VERSION = "estimar-conteo.v1"
ESTIMAR_CONTEO_RESULT_VERSION = "estimar-conteo-result.v1"

#: Los topes de forma salen del contrato exportado (dueño: Zod, ``domain-v1.ts``); no se escriben aquí.
_PROPIEDADES = cast(
    Mapping[str, Mapping[str, object]], contract_schema("EstimarConteoRequest")["properties"]
)
MAX_CANDIDATOS = int(cast(int, _PROPIEDADES["candidatos"]["maxItems"]))
MAX_TAMANOS_OBLIGATORIOS = int(cast(int, _PROPIEDADES["tamanos_obligatorios"]["maxItems"]))

_VALIDADOR = Draft7Validator(contract_schema("EstimarConteoRequest"))

#: Cuántas guirnaldas con armado del motor admite una consulta. Contar una cuesta 0,3 a 0,9 s con el caché del
#: motor frío y no se puede negar (es lo que se pregunta); con este tope el conteo base cabe en ~2 s y el resto
#: del tope de la petición queda para buscar. Pasarse es un error estable, no una cola detrás de la resolución.
MAX_GUIRNALDAS_CON_ARMADO = 2

#: Cuánto mueve la semilla el total de una guirnalda del motor, medido el 2026-10-02: 40 semillas del mismo
#: armado a 3 m dieron de 56 a 89 globos (media 73,8): ±22 %. Es una medición de un armado y una máquina, no
#: una regla; si el motor de la guirnalda cambia, se vuelve a medir (ADR-0038).
SEMILLAS_MEDIDAS = 40
RUIDO_SEMILLA_GUIRNALDA = 0.22
GLOBOS_MINIMO_MEDIDO = 56
GLOBOS_MAXIMO_MEDIDO = 89
LARGO_DE_LA_MEDICION_M = 3

#: Los campos de armado que un candidato puede traer: el del motor de cada tipo (``CLAVE_ARMADO``, la tabla de
#: ``omoikane.armado_estructura``) y ``armado_guirnalda`` (ADR-0032), que solo decide el eje de una guirnalda
#: en la fórmula.
_TODOS_LOS_ARMADOS = (*CLAVE_ARMADO.values(), "armado_guirnalda")


def _hay_no_finitos(valor: object) -> bool:
    """Si en algún lugar del cuerpo hay un ``NaN`` o un infinito."""
    if isinstance(valor, float):
        return not math.isfinite(valor)
    if isinstance(valor, Mapping):
        return any(_hay_no_finitos(item) for item in valor.values())
    if isinstance(valor, (list, tuple)):
        return any(_hay_no_finitos(item) for item in valor)
    return False


class EstimarConteoRequest(OperationalRequest):
    """``estimar-conteo.v1``: la forma la valida el contrato exportado, no una copia a mano de sus topes."""

    schema_version: Literal["estimar-conteo.v1"]
    candidatos: list[dict[str, object]] = Field(min_length=1, max_length=MAX_CANDIDATOS)
    objetivo: dict[str, object] | None = None
    tamanos_obligatorios: list[int] = Field(
        default_factory=list, max_length=MAX_TAMANOS_OBLIGATORIOS
    )
    medidas_del_cliente: bool = Field(default=False, strict=True)

    @model_validator(mode="before")
    @classmethod
    def cumple_el_contrato(cls, valor: object) -> object:
        """El cuerpo entero (sin el contexto operativo) contra ``estimar-conteo.v1``.

        El contrato expresa la forma, la coherencia de ``estructura_oficial`` con tipo y densidad y la
        validez de cada armado; lo que no expresa lo comprueba ``estimar_conteo`` con un error estable.
        """
        if isinstance(valor, Mapping):
            cuerpo = {clave: item for clave, item in valor.items() if clave != "context"}
            if _hay_no_finitos(cuerpo):
                # El JSON estándar no los admite, pero el lector de Python sí (``NaN``, ``Infinity``) y el
                # esquema los deja pasar: una medida no finita se contaría como si faltara, sin avisar.
                raise ValueError("estimar-conteo.v1 no admite números no finitos")
            error = next(
                iter(sorted(_VALIDADOR.iter_errors(cuerpo), key=lambda e: list(e.path))), None
            )
            if error is not None:
                ruta = ".".join(str(parte) for parte in error.path) or "<raíz>"
                raise ValueError(f"estimar-conteo.v1 no cumple el contrato en {ruta}")
        return valor


def _candidato_invalido(etiqueta: str, motivo: str, mensaje: str) -> PlanResolutionError:
    """Un candidato que no se puede contar: motivo estable y frase en español, nunca un éxito a medias.

    ``estructura_id`` lleva la etiqueta del candidato: es el único nombre que la IA le dio a la pieza.
    """
    return PlanResolutionError(
        "candidato_invalido",
        422,
        {"estructura_id": etiqueta, "motivo": motivo, "mensaje": mensaje},
    )


# ---------------------------------------------------------------------------
# El candidato como la pieza del plan que cuenta ``plan.py``
# ---------------------------------------------------------------------------


def _indices_del_armado(tipo: str, armado: Mapping[str, object]) -> list[int]:
    """Los materiales que nombra un armado del motor (ninguna regla: solo leer sus índices)."""
    if tipo == "guirnalda":
        paleta = cast(Mapping[str, object], armado.get("colores") or {}).get("paleta")
        entradas = paleta if isinstance(paleta, list) else []
        return [
            int(cast(int, cast(Mapping[str, object], entrada).get("material", 0)))
            for entrada in entradas
            if isinstance(entrada, Mapping)
        ]
    materiales = armado.get("materiales")
    return [int(cast(int, valor)) for valor in materiales] if isinstance(materiales, list) else []


def _estructura(candidato: Mapping[str, object], indice: int) -> dict[str, object]:
    """La pieza del plan con lo que mueve su conteo; sin catálogo, precios ni tonos."""
    etiqueta = str(candidato["etiqueta"])
    tipo = str(candidato["tipo"])
    permitidos = {CLAVE_ARMADO.get(tipo), "armado_guirnalda" if tipo == "guirnalda" else None}
    ajenos = [
        clave
        for clave in _TODOS_LOS_ARMADOS
        if candidato.get(clave) is not None and clave not in permitidos
    ]
    if ajenos:
        raise _candidato_invalido(
            etiqueta,
            "armado_no_corresponde",
            f"El armado «{ajenos[0]}» no corresponde a un {tipo}: con ese tipo se contaría sin él y la "
            "estimación diría lo contrario de lo que pediste.",
        )
    armado = candidato.get(CLAVE_ARMADO[tipo]) if tipo in CLAVE_ARMADO else None
    necesarios = (
        max(_indices_del_armado(tipo, cast(Mapping[str, object], armado)), default=-1) + 1
        if isinstance(armado, Mapping)
        else 0
    )
    pedidos = candidato.get("colores")
    colores = pedidos if isinstance(pedidos, int) else max(1, necesarios)
    estructura: dict[str, object] = {
        "estructura_id": f"EST_{indice + 1:02d}_CANDIDATO",
        "nombre": etiqueta,
        "tipo": tipo,
        "medidas": dict(cast(Mapping[str, object], candidato.get("medidas") or {})),
        "repeticiones": int(cast(int, candidato.get("repeticiones") or 1)),
        "densidad": candidato["densidad"],
        "mezcla": candidato["mezcla"],
        # Marcadores, como ``omoikane.armado_estructura``: el conteo del motor es por índice de material y
        # nunca mira un tono.
        "materiales": [{"color": f"#{i + 1:06x}"} for i in range(colores)],
    }
    for clave in ("estructura_oficial", *_TODOS_LOS_ARMADOS):
        if candidato.get(clave) is not None:
            estructura[clave] = candidato[clave]
    return estructura


# ---------------------------------------------------------------------------
# Lo que se informa de cada candidato
# ---------------------------------------------------------------------------


def _nota(tipo: str, oficial: object, pieza: PiezaContada) -> str | None:
    """Lo que quien consulta no debe pasar por alto de una pieza que cuenta el motor."""
    if pieza.fuente != "motor":
        return None
    partes = [
        f"Esta pieza trae armado del motor: su total ({pieza.total_motor}) sale de colocar cada globo y "
        "la densidad, la mezcla y las medidas del plan NO lo mueven (la fórmula daría "
        f"{pieza.total_formula}); solo lo mueven los mandos del armado."
    ]
    if isinstance(oficial, str) and oficial != tipo:
        partes.append(
            f"El motor no distingue la forma de «{oficial}»: la cuenta como un {tipo} normal, así que el "
            "total vigente puede no corresponder a esa forma ni a la puerta física."
        )
    if tipo == "guirnalda":
        partes.append(
            "El conteo de una guirnalda depende de la semilla del armado: este total es para la semilla "
            f"fija de este armado y otra semilla lo mueve hasta ±{RUIDO_SEMILLA_GUIRNALDA:.0%} a "
            f"{LARGO_DE_LA_MEDICION_M} m ({GLOBOS_MINIMO_MEDIDO} a {GLOBOS_MAXIMO_MEDIDO} globos con "
            f"{SEMILLAS_MEDIDAS} semillas, medido); no es una cifra exacta."
        )
    return " ".join(partes)


def _medidas_asumidas(
    candidato: Mapping[str, object], estructura: Mapping[str, object], asumio: bool
) -> list[str]:
    """Qué medidas faltaban y se asumieron, como lo hace el plan al confirmar (no se rechaza la pieza)."""
    if not asumio:
        return []
    dadas = cast(Mapping[str, object], candidato.get("medidas") or {})
    puestas = [
        f"{clave} {valor} m"
        for clave, valor in cast(Mapping[str, object], estructura["medidas"]).items()
        if dadas.get(clave) is None
    ]
    return [
        f"Faltaban medidas y se asumieron las de por defecto del plan ({', '.join(puestas)}), igual que "
        "al confirmar: no son medidas del cliente."
    ]


def _avisos(pieza: PiezaContada) -> list[str]:
    avisos = [
        f"El tamaño obligatorio R-{pulgadas} no quedó colocado en la mezcla ni en el armado."
        for pulgadas in pieza.tamanos_sin_ubicar
    ]
    avisos.extend(aviso[:400] for aviso in pieza.avisos_motor)
    return avisos[:24]


# ---------------------------------------------------------------------------
# La operación
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Contado:
    """Un candidato ya contado: la pieza del plan, si se le asumieron medidas y lo que cuenta."""

    estructura: dict[str, object]
    asumio: bool
    pieza: PiezaContada


def _contar(
    candidato: Mapping[str, object],
    indice: int,
    tamanos: Sequence[int],
    presupuesto: Presupuesto,
) -> _Contado:
    """El conteo base del candidato. No se puede negar, pero cuesta y se descuenta del presupuesto."""
    etiqueta = str(candidato["etiqueta"])
    estructura, asumio = con_medidas_por_defecto(_estructura(candidato, indice))
    try:
        pieza = contar_pieza(estructura, tamanos)
    except PlanResolutionError as error:
        if error.code != "armado_invalido":
            raise
        detalles = error.details or {}
        raise PlanResolutionError(
            "armado_invalido",
            error.status_code,
            {
                "estructura_id": etiqueta,
                "motivo": detalles.get("motivo", "armado_invalido"),
                "mensaje": detalles.get("mensaje", "El armado no se sostiene."),
            },
        ) from error
    if pieza.fuente == "motor":
        presupuesto.gastar(COSTO_EVALUACION[str(candidato["tipo"])])
    return _Contado(estructura, asumio, pieza)


def _candidato(
    candidato: Mapping[str, object],
    contado: _Contado,
    objetivo: conteo_foto.Cuenta | None,
    tamanos: Sequence[int],
    medidas_del_cliente: bool,
    presupuesto: Presupuesto,
) -> dict[str, object]:
    etiqueta = str(candidato["etiqueta"])
    tipo = str(candidato["tipo"])
    estructura, asumio, pieza = contado.estructura, contado.asumio, contado.pieza
    repeticiones = int(cast(int, estructura["repeticiones"]))
    brecha = None if objetivo is None else hacer_brecha(objetivo.globos, pieza.total_vigente)
    sugerencia: dict[str, object] | None = None
    if objetivo is not None:
        sugerencia = sugerir(estructura, pieza, objetivo, tamanos, medidas_del_cliente, presupuesto)
    return {
        "etiqueta": etiqueta,
        "tipo": tipo,
        "repeticiones": repeticiones,
        "total_formula": pieza.total_formula,
        "total_motor": pieza.total_motor,
        "total_vigente": pieza.total_vigente,
        "fuente": pieza.fuente,
        "total_instalado": pieza.total_vigente * repeticiones,
        "eje_m": round(pieza.eje_m, 2),
        "globos_por_metro": (
            round(pieza.total_vigente / pieza.eje_m, 2) if pieza.eje_m > 0 else None
        ),
        "formula_clasica": (
            None if pieza.formula_clasica is None else round(pieza.formula_clasica, 1)
        ),
        "reparto_por_tamano": [
            {
                "pulgadas": pulgadas,
                "cantidad": cantidad,
                "proporcion": round(cantidad / pieza.total_vigente, 4),
            }
            for pulgadas, cantidad in pieza.reparto_por_tamano
        ],
        "puerta_fisica": {
            "dentro": not pieza.avisos_puerta,
            "avisos": [aviso[:400] for aviso in pieza.avisos_puerta[:12]],
        },
        "avisos": [*_medidas_asumidas(candidato, estructura, asumio), *_avisos(pieza)][:24],
        "nota": _nota(tipo, candidato.get("estructura_oficial"), pieza),
        "brecha": brecha,
        "sugerencia": sugerencia,
    }


def estimar_conteo(request: EstimarConteoRequest) -> dict[str, object]:
    """Los candidatos contados como los contaría ``resolve_plan``, y la menor variación hacia el objetivo.

    No escribe nada ni toca un plan resuelto, un token o ``plan_hash``; una petición con el mismo cuerpo da
    siempre el mismo resultado. Lanza ``PlanResolutionError`` con ``candidato_invalido`` o ``armado_invalido``
    (``estructura_id`` es la etiqueta del candidato).
    """
    etiquetas = [str(candidato["etiqueta"]) for candidato in request.candidatos]
    repetida = next((e for e in etiquetas if etiquetas.count(e) > 1), None)
    if repetida is not None:
        raise _candidato_invalido(
            repetida,
            "etiqueta_repetida",
            "Dos candidatos llevan la misma etiqueta: sin etiquetas distintas no se sabe cuál elegir.",
        )
    objetivo = (
        None
        if request.objetivo is None
        else conteo_foto.Cuenta(
            int(cast(int, request.objetivo["conteo"])), request.objetivo.get("exacto") is True
        )
    )
    con_guirnalda_armada = [
        str(candidato["etiqueta"])
        for candidato in request.candidatos
        if candidato.get("tipo") == "guirnalda"
        and candidato.get("armado_guirnalda_organica") is not None
    ]
    if len(con_guirnalda_armada) > MAX_GUIRNALDAS_CON_ARMADO:
        raise _candidato_invalido(
            con_guirnalda_armada[MAX_GUIRNALDAS_CON_ARMADO],
            "demasiadas_guirnaldas_con_armado",
            f"Una consulta admite hasta {MAX_GUIRNALDAS_CON_ARMADO} guirnaldas con armado del motor: contar "
            "cada una tarda hasta un segundo. Estima las demás en otra consulta.",
        )
    presupuesto = Presupuesto(PRESUPUESTO_EVALUACIONES, PRESUPUESTO_SEGUNDOS)
    # Primero se cuenta todo (lo que se pregunta y se descuenta del presupuesto) y después se busca con lo
    # que queda: así el conteo base de un candidato no se le gasta a la búsqueda de otro sin cobrarse.
    contados = [
        _contar(candidato, indice, request.tamanos_obligatorios, presupuesto)
        for indice, candidato in enumerate(request.candidatos)
    ]
    candidatos = [
        _candidato(
            candidato,
            contado,
            objetivo,
            request.tamanos_obligatorios,
            request.medidas_del_cliente,
            presupuesto,
        )
        for candidato, contado in zip(request.candidatos, contados, strict=True)
    ]
    sirven = [
        (cast(int, cast(Mapping[str, object], c["brecha"])["absoluta"]), indice, str(c["etiqueta"]))
        for indice, c in enumerate(candidatos)
        if c["brecha"] is not None
        and cast(Mapping[str, object], c["brecha"])["dentro_de_tolerancia"] is True
        and cast(Mapping[str, object], c["puerta_fisica"])["dentro"] is True
    ]
    return {
        "operation_schema_version": ESTIMAR_CONTEO_RESULT_VERSION,
        "objetivo": (
            None
            if objetivo is None
            else {
                "conteo": objetivo.globos,
                "exacto": objetivo.exacto,
                "tolerancia": round(conteo_foto.tolerancia(objetivo.globos), 2),
            }
        ),
        "candidatos": candidatos,
        "mejor": min(sirven)[2] if sirven else None,
    }


#: Una reserva que nadie soltó (el hilo murió) se da por vencida pasado este tiempo, para que una
#: estimación perdida no deje la ruta ocupada para siempre.
RESERVA_MAXIMA_S = 30.0


class Reserva:
    """El derecho de correr una estimación; ``iniciada`` dice si su hilo llegó a empezar."""

    def __init__(self) -> None:
        self.iniciada = False


class ExclusionDeEstimacion:
    """A lo sumo una estimación a la vez en la ruta, sin cola.

    El plan corre su CPU en un solo hilo (``plan_worker``) y ``asyncio.wait_for`` no corta un hilo en marcha: varias
    estimaciones simultáneas harían cola delante de ``resolve_plan``. La segunda no espera, responde ocupado
    (``estimacion_ocupada``) y quien llama reintenta. La reserva se toma antes de encolar el trabajo y la
    suelta el propio hilo al terminar (aunque su petición ya se haya cancelado); si el trabajo se canceló en la
    cola sin llegar a correr, la suelta quien lo canceló (``soltar_si_no_inicio``).
    """

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

    def estimar(self, reserva: Reserva, request: EstimarConteoRequest) -> dict[str, object]:
        """El trabajo que corre en el hilo del plan: marca que empezó y suelta la reserva al terminar."""
        reserva.iniciada = True
        try:
            return estimar_conteo(request)
        finally:
            self.soltar(reserva)


EXCLUSION = ExclusionDeEstimacion()


__all__ = [
    "EXCLUSION",
    "ESTIMAR_CONTEO_REQUEST_VERSION",
    "ESTIMAR_CONTEO_RESULT_VERSION",
    "ESTIMAR_CONTEO_SCOPE",
    "EstimarConteoRequest",
    "ExclusionDeEstimacion",
    "estimar_conteo",
]
