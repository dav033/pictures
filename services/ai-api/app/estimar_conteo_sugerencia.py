"""La sugerencia de ``estimar_conteo``: la menor variación de mandos que acerca una pieza al objetivo.

Hay dos caminos, según quién cuente la pieza al confirmar:

- **Con la fórmula** (sin armado): la búsqueda de ``conteo_foto`` (``buscar_ajuste``, la misma que corre al
  confirmar con la foto) sobre densidad y medidas; sin lectura de la foto la mezcla nunca cambia.
- **Con el motor** (la pieza trae armado): el motor coloca cada globo y no lee la densidad, la mezcla ni las
  medidas del plan, así que mover esos mandos no la acerca a ningún objetivo. Lo único propio de este módulo es
  **barrer los mandos del armado** (``conteo_foto`` no sabe de motores) y preguntarle a ``plan.contar_pieza`` qué
  total da cada valor; no hay aquí ninguna regla de conteo.

  - arco: ``tamano_globo`` y ``globos_ancho`` (dentro de ``limites_de``); si no alcanzan y las medidas no son del
    cliente, ``ancho_m``;
  - columna: ``globos_capa``, ``abajo`` y ``arriba``; después ``alto_m`` (la ventana de ±35 % de ``conteo_foto`` y,
    como su tercera etapa, el alto que da la cantidad); una columna por capas no se barre: su lista de capas es
    el diseño;
  - guirnalda orgánica: solo su largo, por secante sobre su propio conteo y con pocas evaluaciones (cada una
    cuesta 0,3 a 0,9 s); su total es para la semilla fija del armado.

Una variante solo cuenta como propuesta si el motor la acepta tal cual se pidió (sin avisos nuevos: ni acotó ni
corrigió nada) y la puerta física no avisa, porque si no el total sería de otra pieza. Lo que no se barre se dice
en ``motivo``; no se finge. La tolerancia es siempre la de ``conteo_foto``.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal, cast

from app import conteo_foto
from app.armado_columna import ALTO_MAX as COLUMNA_ALTO_MAX
from app.armado_columna import ALTO_MIN as COLUMNA_ALTO_MIN
from app.armado_guirnalda_organica import EstructuraGuirnalda
from app.armado_guirnalda_organica import limites_de as limites_de_guirnalda
from app.estimar_conteo_mandos import (
    Mando,
    con_valor,
    mandos_de_arco,
    mandos_de_columna,
    marcadores,
)
from app.armado_estructura import CLAVE_ARMADO
from app.plan import PiezaContada, PlanResolutionError, contar_pieza, puerto_de_conteo

Fuente = Literal["formula", "motor"]


def hacer_brecha(objetivo: int, total: int) -> dict[str, object]:
    """Qué tan lejos queda ``total`` del objetivo, con la tolerancia de ``conteo_foto`` (no se copia)."""
    diferencia = total - objetivo
    return {
        "objetivo": objetivo,
        "diferencia": diferencia,
        "absoluta": abs(diferencia),
        "relativa": round(abs(diferencia) / objetivo, 4),
        "tolerancia": round(conteo_foto.tolerancia(objetivo), 2),
        "dentro_de_tolerancia": conteo_foto.dentro_de_tolerancia(objetivo, total),
    }


def hacer_sugerencia(
    estado: str,
    via: Fuente | None,
    motivo: str,
    *,
    cambios: Sequence[Mapping[str, object]] = (),
    total: int | None = None,
    objetivo: int | None = None,
) -> dict[str, object]:
    return {
        "estado": estado,
        "via": via,
        "cambios": [dict(cambio) for cambio in cambios],
        "total_resultante": total,
        "brecha": None if total is None or objetivo is None else hacer_brecha(objetivo, total),
        "motivo": motivo,
    }


# ---------------------------------------------------------------------------
# La sugerencia con la fórmula: la búsqueda de ``conteo_foto``, tal cual
# ---------------------------------------------------------------------------


def _sugerir_con_formula(
    estructura: Mapping[str, object],
    objetivo: conteo_foto.Cuenta,
    tamanos: Sequence[int],
    medidas_fijas: bool,
) -> dict[str, object]:
    ajuste = conteo_foto.buscar_ajuste(
        estructura, objetivo, puerto_de_conteo(tamanos), medidas_fijas=medidas_fijas
    )
    if ajuste.decision == "ajustado":
        return hacer_sugerencia(
            "propuesta",
            "formula",
            f"{ajuste.motivo} Es una propuesta: nada del plan cambia hasta confirmarlo.",
            cambios=[
                {"campo": cambio["campo"], "antes": cambio["antes"], "despues": cambio["despues"]}
                for cambio in ajuste.cambios
            ],
            total=ajuste.globos_despues,
            objetivo=objetivo.globos,
        )
    if ajuste.decision == "coincide":
        return hacer_sugerencia(
            "no_necesaria",
            None,
            "Ya está dentro de la tolerancia del objetivo.",
            total=ajuste.globos_antes,
            objetivo=objetivo.globos,
        )
    return hacer_sugerencia(
        "sin_ajuste_posible",
        "formula",
        f"{ajuste.motivo} Prueba otro candidato (otra mezcla, otra estructura o más repeticiones).",
    )


#: Cuánto cuesta una evaluación del motor, en unidades de «una evaluación de arco o de columna». La guirnalda
#: orgánica relaja colisiones y tarda 5 a 15 veces más (medido: 0,3 a 0,9 s frente a 0,06 s).
COSTO_EVALUACION: Mapping[str, int] = {"arco": 1, "columna": 1, "guirnalda": 8}
#: Segundos que se cuentan por adelantado por cada evaluación, para no empezar una que no cabe en el tiempo que
#: queda. Son el peor caso medido con el caché del motor frío (arco ~0,15 s, columna ~0,03 s, guirnalda ~1 s).
COSTO_SEGUNDOS: Mapping[str, float] = {"arco": 0.15, "columna": 0.03, "guirnalda": 1.0}
#: Evaluaciones de motor que una petición puede gastar entre todos sus candidatos, **contando** el conteo base
#: de cada uno. El plan corre en un solo hilo: sin tope, una consulta de solo lectura frenaría el resto de la CPU.
PRESUPUESTO_EVALUACIONES = 80
#: El reloj manda sobre las evaluaciones: a este tiempo total por petición (desde que empieza a contar, base
#: incluida) la búsqueda se corta y devuelve lo mejor que halló. Se comprueba entre evaluaciones; no interrumpe
#: una en marcha, por eso se cuenta por adelantado ``COSTO_SEGUNDOS``.
PRESUPUESTO_SEGUNDOS = 2.0
#: Valores del eje libre (largo de la guirnalda, alto de la columna) que se prueban hacia el objetivo.
MAX_INTENTOS_EJE_LIBRE = 5


# ---------------------------------------------------------------------------
# La sugerencia con el motor: los mandos del armado, uno a uno
# ---------------------------------------------------------------------------


@dataclass
class Presupuesto:
    """Lo que una petición puede gastar del único hilo de CPU del plan: evaluaciones y reloj.

    Las evaluaciones tienen un tope (y lo gasta también el conteo base de cada candidato, ``gastar``); el reloj
    corta la búsqueda aunque queden evaluaciones. Al cortarse se devuelve lo mejor hallado, con ``causa``
    («evaluaciones» o «tiempo»), no un error. ``reloj`` se inyecta para poder probar el corte sin esperar.
    """

    restante: int
    segundos: float = PRESUPUESTO_SEGUNDOS
    reloj: Callable[[], float] = time.monotonic
    agotado: bool = False
    causa: str | None = None
    inicio: float = field(init=False)

    def __post_init__(self) -> None:
        self.inicio = self.reloj()

    def transcurrido(self) -> float:
        return self.reloj() - self.inicio

    def gastar(self, costo: int) -> None:
        """El conteo base de un candidato: no se puede negar, pero se descuenta."""
        self.restante = max(0, self.restante - costo)

    def cobrar(self, costo: int, segundos: float) -> bool:
        """Una evaluación de la búsqueda: solo si caben en las evaluaciones y en el tiempo que quedan."""
        if self.restante < costo:
            self.agotado, self.causa = True, "evaluaciones"
            return False
        if self.transcurrido() + segundos > self.segundos:
            self.agotado, self.causa = True, "tiempo"
            return False
        self.restante -= costo
        return True


@dataclass(frozen=True)
class _Hallazgo:
    mando: Mando
    pasos: int
    valor: object
    total: int
    orden: int


def _probar(
    estructura: Mapping[str, object],
    clave_armado: str,
    armado: Mapping[str, object],
    base: PiezaContada,
    tamanos: Sequence[int],
) -> tuple[PiezaContada | None, bool]:
    """Cuenta una variante del armado: la pieza (o ``None`` si el motor la rechaza) y si se sostiene tal cual.

    Se sostiene si el motor no avisa nada que la pieza actual no avisara ya (no acotó ni corrigió el valor
    pedido) y la puerta física no avisa: si no, el total sería de otra pieza o de una que no se confirmaría.
    """
    try:
        pieza = contar_pieza({**estructura, clave_armado: armado}, tamanos)
    except PlanResolutionError as error:
        if error.code == "armado_invalido":
            return None, False
        raise
    sostenida = (
        pieza.total_vigente > 0
        and set(pieza.avisos_motor) <= set(base.avisos_motor)
        and not pieza.avisos_puerta
    )
    return pieza, sostenida


def _mejor_de_un_mando(
    mando: Mando,
    orden: int,
    estructura: Mapping[str, object],
    tipo: str,
    base: PiezaContada,
    objetivo: int,
    tamanos: Sequence[int],
    presupuesto: Presupuesto,
) -> _Hallazgo | None:
    """El valor más cercano del mando que deja la pieza dentro de la tolerancia; ``None`` si ninguno."""
    clave_armado = CLAVE_ARMADO[tipo]
    armado = cast(Mapping[str, object], estructura[clave_armado])
    encontrados: list[_Hallazgo] = []
    pasos_vigentes: int | None = None
    for pasos, valor in mando.valores:
        # Todos los valores a los mismos pasos se miran antes de elegir: no se deja uno por orden de lista.
        if pasos_vigentes is not None and pasos != pasos_vigentes and encontrados:
            break
        pasos_vigentes = pasos
        if not presupuesto.cobrar(COSTO_EVALUACION[tipo], COSTO_SEGUNDOS[tipo]):
            break
        pieza, sostenida = _probar(
            estructura, clave_armado, con_valor(armado, mando, valor), base, tamanos
        )
        if (
            pieza is not None
            and sostenida
            and conteo_foto.dentro_de_tolerancia(objetivo, pieza.total_vigente)
        ):
            encontrados.append(_Hallazgo(mando, pasos, valor, pieza.total_vigente, orden))
    if not encontrados:
        return None
    return min(encontrados, key=lambda h: (abs(h.total - objetivo), cast(float, h.valor)))


def _cambio(mando: Mando, valor: object) -> dict[str, object]:
    return {"campo": mando.campo, "antes": mando.actual, "despues": valor}


@dataclass(frozen=True)
class _BusquedaEje:
    hallazgo: _Hallazgo | None
    probados: tuple[float, ...]
    sin_presupuesto: bool


def _buscar_eje_libre(
    mando: Mando,
    minimo: float,
    maximo: float,
    estructura: Mapping[str, object],
    tipo: str,
    base: PiezaContada,
    objetivo: int,
    tamanos: Sequence[int],
    presupuesto: Presupuesto,
) -> _BusquedaEje:
    """El eje libre de la pieza (largo de la guirnalda, alto de la columna) que da el objetivo.

    Es la tercera etapa de ``conteo_foto`` (la cantidad decide el eje cuando la pieza tiene uno solo) puesta
    sobre el conteo del motor. El conteo crece con el eje pero, en la guirnalda, lleva ruido de la semilla,
    así que no se biseca: se parte del total actual, se escala el eje por ``objetivo / total`` (secante sobre
    el propio conteo del motor) y se prueba ese valor, hasta ``MAX_INTENTOS_EJE_LIBRE`` veces y dentro de los
    límites del motor. El total que sale es para la semilla fija del armado.
    """
    clave_armado = CLAVE_ARMADO[tipo]
    armado = cast(Mapping[str, object], estructura[clave_armado])
    actual = float(cast(float, mando.actual))
    probados: list[float] = []
    eje, total = actual, base.total_vigente
    for _ in range(MAX_INTENTOS_EJE_LIBRE):
        siguiente = round(min(maximo, max(minimo, eje * objetivo / max(1, total))), 2)
        if siguiente == eje or siguiente in probados or siguiente == actual:
            break
        if not presupuesto.cobrar(COSTO_EVALUACION[tipo], COSTO_SEGUNDOS[tipo]):
            return _BusquedaEje(None, tuple(probados), True)
        probados.append(siguiente)
        pieza, sostenida = _probar(
            estructura, clave_armado, con_valor(armado, mando, siguiente), base, tamanos
        )
        if pieza is None:
            break
        eje, total = siguiente, pieza.total_vigente
        if sostenida and conteo_foto.dentro_de_tolerancia(objetivo, total):
            return _BusquedaEje(_Hallazgo(mando, 1, siguiente, total, 0), tuple(probados), False)
    return _BusquedaEje(None, tuple(probados), False)


def _propuesta_del_motor(
    hallazgo: _Hallazgo, objetivo: int, *, con_ruido: bool, incompleta: bool = False
) -> dict[str, object]:
    nombre = hallazgo.mando.campo
    ruido = (
        " Con la semilla de este armado; otra semilla daría otra cifra, no es exacta."
        if con_ruido
        else ""
    )
    parcial = (
        " Se cortó por el tope de la consulta (tiempo o evaluaciones) antes de probar todos los mandos: puede haber una "
        "variación menor."
        if incompleta
        else ""
    )
    # Dónde se pide en `armar_estructura`: la guirnalda tiene su bloque `forma`; el arco y la columna, `geometria`.
    donde = "forma.largo_m" if hallazgo.mando.bloque == "forma" else f"geometria.{nombre}"
    return hacer_sugerencia(
        "propuesta",
        "motor",
        f"Moviendo {nombre} de {hallazgo.mando.actual} a {hallazgo.valor} en el armado, el motor deja "
        f"la pieza en {hallazgo.total} globos, dentro de la tolerancia del objetivo.{ruido}{parcial} Aplícalo "
        f"con armar_estructura ({donde}). Es una propuesta: ni el plan ni el armado guardado cambian.",
        cambios=[_cambio(hallazgo.mando, hallazgo.valor)],
        total=hallazgo.total,
        objetivo=objetivo,
    )


def _cortada(presupuesto: Presupuesto) -> dict[str, object]:
    """La búsqueda se cortó por el tope de la petición y no halló nada: no es un error ni «sin ajuste»."""
    causa = (
        f"el tiempo ({presupuesto.segundos:g} s por consulta)"
        if presupuesto.causa == "tiempo"
        else "el presupuesto de evaluaciones"
    )
    return hacer_sugerencia(
        "cortada_por_tope",
        "motor",
        f"Se agotó {causa} antes de probar todos los mandos del armado (el motor de la guirnalda tarda 0,3 a "
        "0,9 s por evaluación): no se sabe si existe una variación. Estima menos candidatos con armado a la vez.",
    )


def _sugerir_guirnalda(
    estructura: Mapping[str, object],
    base: PiezaContada,
    objetivo: int,
    tamanos: Sequence[int],
    medidas_fijas: bool,
    presupuesto: Presupuesto,
) -> dict[str, object]:
    """La guirnalda orgánica hacia el objetivo por su largo: el único mando que se barre."""
    if medidas_fijas:
        return hacer_sugerencia(
            "no_evaluada",
            "motor",
            "Las medidas son del cliente y el único mando que se barre en una guirnalda del motor es su "
            "largo. Cambia el armado con armar_estructura (forma, volumen, mezcla de tamaños) y vuelve a "
            "estimar.",
        )
    # Solo llega aquí una guirnalda que trae su armado: sin él la cuenta la fórmula (``plan._armado_del_motor``)
    # y la sugerencia es la de ``conteo_foto``.
    armado = cast(Mapping[str, object], estructura["armado_guirnalda_organica"])
    forma = cast(Mapping[str, object], armado["forma"])
    limites = limites_de_guirnalda(
        armado, EstructuraGuirnalda(es_guirnalda=True, materiales=marcadores(estructura))
    )
    mando = Mando("largo_m", "forma", "largoM", float(cast(float, forma["largoM"])), ())
    busqueda = _buscar_eje_libre(
        mando,
        limites["largoMin"],
        limites["largoMax"],
        estructura,
        "guirnalda",
        base,
        objetivo,
        tamanos,
        presupuesto,
    )
    if busqueda.hallazgo is not None:
        return _propuesta_del_motor(busqueda.hallazgo, objetivo, con_ruido=True)
    if busqueda.sin_presupuesto:
        return _cortada(presupuesto)
    detalle = (
        f"Se probaron los largos {', '.join(f'{valor:g}' for valor in busqueda.probados)} m"
        if busqueda.probados
        else "No hay otro largo dentro de los límites del motor que se acerque más"
    )
    return hacer_sugerencia(
        "sin_ajuste_posible",
        "motor",
        f"{detalle}: ninguno deja la guirnalda dentro de la tolerancia del objetivo sin que el motor "
        "corrija el armado o la puerta física avise. Los demás mandos del motor (grosor, relleno, mezcla "
        "de tamaños, ondas) no se barren.",
    )


def _sugerir_con_motor(
    estructura: Mapping[str, object],
    tipo: str,
    base: PiezaContada,
    objetivo: int,
    tamanos: Sequence[int],
    medidas_fijas: bool,
    presupuesto: Presupuesto,
) -> dict[str, object]:
    # «Se agotó» se dice de esta búsqueda: una anterior que no pudo con una guirnalda no condena a la siguiente.
    presupuesto.agotado = False
    if tipo == "guirnalda":
        return _sugerir_guirnalda(estructura, base, objetivo, tamanos, medidas_fijas, presupuesto)
    armado = cast(Mapping[str, object], estructura[CLAVE_ARMADO[tipo]])
    if tipo == "columna" and armado.get("modo") == "capas":
        return hacer_sugerencia(
            "no_evaluada",
            "motor",
            "La columna está armada por capas: su lista de capas es el diseño y ningún mando del cuerpo "
            "(alto, globos por capa, tamaños) la mueve. Cambia las capas del armado y vuelve a estimar.",
        )
    tiers = mandos_de_arco(estructura, armado) if tipo == "arco" else mandos_de_columna(armado)
    for indice, mandos in enumerate(tiers):
        if indice == 1 and medidas_fijas:
            break
        hallazgos = [
            hallazgo
            for orden, mando in enumerate(mandos)
            if (
                hallazgo := _mejor_de_un_mando(
                    mando, orden, estructura, tipo, base, objetivo, tamanos, presupuesto
                )
            )
        ]
        if hallazgos:
            # La menor variación: los menos pasos desde el valor actual, luego el total más cercano.
            mejor = min(hallazgos, key=lambda h: (h.pasos, abs(h.total - objetivo), h.orden))
            return _propuesta_del_motor(
                mejor, objetivo, con_ruido=False, incompleta=presupuesto.agotado
            )
    probados_eje: tuple[float, ...] = ()
    if tipo == "columna" and not medidas_fijas and not presupuesto.agotado:
        # Como en ``conteo_foto``: una pieza con un solo eje libre deja que la cantidad lo decida cuando la
        # ventana de ±35 % no alcanza. En la columna es su alto.
        busqueda = _buscar_eje_libre(
            tiers[1][0],
            COLUMNA_ALTO_MIN,
            COLUMNA_ALTO_MAX,
            estructura,
            tipo,
            base,
            objetivo,
            tamanos,
            presupuesto,
        )
        if busqueda.hallazgo is not None:
            return _propuesta_del_motor(busqueda.hallazgo, objetivo, con_ruido=False)
        probados_eje = busqueda.probados
        presupuesto.agotado = presupuesto.agotado or busqueda.sin_presupuesto
    if presupuesto.agotado:
        return _cortada(presupuesto)
    probados = ", ".join(
        mando.campo for mandos in tiers[: 1 if medidas_fijas else 2] for mando in mandos
    )
    eje = (
        f" Se probaron además los altos {', '.join(f'{valor:g}' for valor in probados_eje)} m."
        if probados_eje
        else ""
    )
    fijas = (
        " Las medidas son del cliente: no se movieron el ancho ni el alto." if medidas_fijas else ""
    )
    return hacer_sugerencia(
        "sin_ajuste_posible",
        "motor",
        f"Ningún valor de los mandos del armado ({probados}) deja la pieza dentro de la tolerancia del "
        f"objetivo sin que el motor corrija el armado o la puerta física avise.{eje}{fijas} No se "
        "barren la forma, el inflado ni los patrones; la densidad, la mezcla y las medidas del plan no "
        "mueven una pieza con armado del motor.",
    )


# ---------------------------------------------------------------------------
# La sugerencia de una pieza
# ---------------------------------------------------------------------------


def sugerir(
    estructura: Mapping[str, object],
    pieza: PiezaContada,
    objetivo: conteo_foto.Cuenta,
    tamanos: Sequence[int],
    medidas_fijas: bool,
    presupuesto: Presupuesto,
) -> dict[str, object]:
    """La sugerencia de una pieza ya contada hacia ``objetivo``: nada que hacer, la fórmula o el motor."""
    if conteo_foto.dentro_de_tolerancia(objetivo.globos, pieza.total_vigente):
        return hacer_sugerencia(
            "no_necesaria",
            None,
            "Ya está dentro de la tolerancia del objetivo: no hace falta cambiar nada.",
            total=pieza.total_vigente,
            objetivo=objetivo.globos,
        )
    if pieza.fuente == "motor":
        return _sugerir_con_motor(
            estructura,
            str(estructura["tipo"]),
            pieza,
            objetivo.globos,
            tamanos,
            medidas_fijas,
            presupuesto,
        )
    return _sugerir_con_formula(estructura, objetivo, tamanos, medidas_fijas)


__all__ = [
    "COSTO_EVALUACION",
    "PRESUPUESTO_EVALUACIONES",
    "PRESUPUESTO_SEGUNDOS",
    "Presupuesto",
    "hacer_brecha",
    "sugerir",
]
