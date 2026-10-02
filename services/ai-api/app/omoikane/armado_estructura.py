"""Omoikane: las herramientas del motor del diseñador, para el agente de chat (ADR-0034 §5).

El chat no tenía ningún mando de armado: el patrón lo ponía el servidor desde la foto o desde un preset. Este
módulo le abre al modelo las mismas herramientas que usa el diseñador —los catorce patrones del arco y los
nueve de la columna, con sus mandos, rangos y mínimos de color— y es la **puerta** por la que pasa lo que el
modelo proponga.

Tres acciones, una sola operación porque son el mismo trabajo visto desde tres momentos del turno:

``catalogo``
    Lo que el modelo puede usar, sacado de ``opciones_admitidas()`` del motor. Es una consulta: así no tiene
    que adivinar un nombre de patrón ni un rango, y si allá se añade un patrón, aquí se ve sin tocar nada.

``armar``
    Un armado concreto para una pieza: el patrón, sus mandos y los índices de material. Lo valida la puerta
    del motor (``app/armado_arco.py``, ``app/armado_columna.py``) y, si se sostiene, lo resuelve para devolver
    lo que de verdad lleva —globos, conteo por material, compra y medidas— con sus avisos. Si no se sostiene,
    sale el motivo estable y el mensaje en español, nunca un armado a medias.

``completar``
    Al confirmar el plan: cada arco y cada columna sale con armado. El que el modelo armó si se sostiene
    contra la pieza de verdad (los índices de material se comprueban otra vez contra sus materiales, que es lo
    que el modelo no podía saber cuando lo armó), y si no, la **receta del motor**: ``config_inicial()`` del
    patrón que mejor encaje con lo que la pieza ya dice. Un plan no se queda sin armado por un olvido del
    modelo, igual que ``completar_armados_guirnalda`` hace con la guirnalda (ADR-0032).

**Por qué `completar` vive aquí y no dentro de `resolve_plan`.** Su sitio natural es la resolución, al lado de
``completar_armados_guirnalda``. Mientras ``app/plan.py`` esté cambiando por el conteo con motor del ADR-0034,
la frontera de Next pide la receta aquí y la escribe en el plan **antes** de resolver: el dueño de la receta
sigue siendo Python y el resultado es el mismo plan. Cuando la resolución pueda recibir el interruptor, esta
acción se mueve allá y la frontera deja de llamarla.

Nada de esto decide catálogo, precio ni aprobación: son globos colocados y aritmética del motor. El dibujo no
sale por aquí —el SVG viaja por la ruta del editor— porque el modelo no mira píxeles y pesa decenas de
kilobytes por pieza.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Mapping, Sequence, cast

from pydantic import Field, model_validator

from app.arco.limites import ALTO_MAX as ARCO_ALTO_MAX
from app.arco.limites import ALTO_MIN as ARCO_ALTO_MIN
from app.arco.limites import ANCHO_MAX as ARCO_ANCHO_MAX
from app.arco.limites import ANCHO_MIN as ARCO_ANCHO_MIN
from app.arco.patrones import PATRONES as PATRONES_ARCO
from app.arco.patrones import config_inicial as config_inicial_arco
from app.arco.patrones import globos_ancho_por_defecto
from app.arco.tipos import PATRON_IDS as PATRON_IDS_ARCO
from app.armado_arco import ArmadoInvalido as ArmadoArcoInvalido
from app.armado_arco import EstructuraArco
from app.armado_arco import MAX_MATERIALES as MAX_MATERIALES_ARCO
from app.armado_arco import VERSION as VERSION_ARMADO_ARCO
from app.armado_arco import armado_resuelto as armado_arco_resuelto
from app.armado_arco import opciones_admitidas as opciones_arco
from app.armado_arco import validar as validar_arco
from app.armado_columna import ALTO_MAX as COLUMNA_ALTO_MAX
from app.armado_columna import ALTO_MIN as COLUMNA_ALTO_MIN
from app.armado_columna import PATRONES as PATRONES_COLUMNA
from app.armado_columna import PATRON_IDS as PATRON_IDS_COLUMNA
from app.armado_columna import ArmadoInvalido as ArmadoColumnaInvalido
from app.armado_columna import EstructuraColumna
from app.armado_columna import armado_resuelto as armado_columna_resuelto
from app.armado_columna import config_inicial as config_inicial_columna
from app.armado_columna import opciones_admitidas as opciones_columna
from app.armado_columna import validar as validar_columna
from app.armado_guirnalda_organica import ArmadoInvalido as ArmadoGuirnaldaInvalido
from app.armado_guirnalda_organica import EstructuraGuirnalda
from app.armado_guirnalda_organica import ROLES as ROLES_GUIRNALDA
from app.armado_guirnalda_organica import VERSION as VERSION_ARMADO_GUIRNALDA
from app.armado_guirnalda_organica import armado_resuelto as armado_guirnalda_resuelto
from app.armado_guirnalda_organica import opciones_admitidas as opciones_guirnalda
from app.armado_guirnalda_organica import validar as validar_guirnalda
from app.guirnalda.limites import LARGO_MAX as GUIRNALDA_LARGO_MAX
from app.guirnalda.limites import LARGO_MIN as GUIRNALDA_LARGO_MIN
from app.guirnalda.tipos import config_inicial as config_inicial_guirnalda
from app.operational_models import ContractModel, OperationalRequest
from app.organico.tipos import ACABADOS, REPARTOS, TAMANOS_GLOBO
from app.plan import PlanResolutionError

OMOIKANE_ARMADO_SCOPE = "omoikane.armado_estructura"
OMOIKANE_ARMADO_SCHEMA_VERSION = "omoikane-armado-estructura.v1"
OMOIKANE_ARMADO_RESULT_VERSION = "omoikane-armado-estructura-result.v1"

#: La versión del contrato de la columna. La del arco se importa de su puerta (``armado_arco.VERSION``);
#: la de la columna la escribe su ``armado_resuelto`` y no la exporta, así que aquí está su único reflejo.
VERSION_ARMADO_COLUMNA = "armado-columna.v1"

#: La versión del contrato de la guirnalda orgánica, importada de su puerta.
VERSION_ARMADO_GUIRNALDA_ORGANICA = VERSION_ARMADO_GUIRNALDA

#: Los tres tipos de pieza con motor migrado y puerta en este repo. Las demás no tienen motor y siguen por el
#: camino de siempre.
#:
#: ``guirnalda`` es la **orgánica** del motor (``armado-guirnalda-organica.v1``). No tiene nada que ver con
#: ``armado-guirnalda.v1`` de ADR-0032 —racimos, relleno y remates—, que sigue vivo con su editor y su
#: ``completar_armados_guirnalda``: una pieza puede traer los dos y esta operación **nunca** toca el viejo.
TIPOS_CON_MOTOR = ("arco", "columna", "guirnalda")

#: Tope de piezas que una acción ``completar`` puede traer: el mismo que ``estructuras`` en el plan.
MAX_ESTRUCTURAS = 8

#: Tope de colores que nombra un armado. Los tres contratos coinciden en 8 (``materiales`` del arco y de
#: la columna, ``colores.paleta`` de la guirnalda), y lo publica la puerta de cada motor.
MAX_MATERIALES = MAX_MATERIALES_ARCO

#: Índice de material más alto que admiten los tres contratos (``IndiceMaterialSchema``).
MAX_INDICE_MATERIAL = 11

#: El campo del plan donde vive el armado de cada tipo.
CLAVE_ARMADO: dict[str, str] = {
    "arco": "armado_arco",
    "columna": "armado_columna",
    "guirnalda": "armado_guirnalda_organica",
}

#: Los acabados y los repartos que el motor admite, por su valor. No se escriben aquí: se leen del motor, como
#: los patrones, para que añadir uno allá se vea sin tocar nada.
VALORES_ACABADO = tuple(cast(str, a["valor"]) for a in ACABADOS)
VALORES_REPARTO = tuple(cast(str, r["valor"]) for r in REPARTOS)

Identificador = Annotated[str, Field(min_length=1, max_length=160)]
Tipo = Literal["arco", "columna", "guirnalda"]


class PiezaArmado(ContractModel):
    """Lo que la pieza dice de sí misma, que es de dónde sale la geometría por defecto.

    El modelo no tiene que repetir el ancho ni el alto: si la estructura del plan ya los trae, llegan aquí y
    el motor arranca con ellos. ``colores`` es cuántos materiales lleva la pieza, y es el único tope de los
    índices que el armado puede nombrar: un índice que la pieza no tiene se rechaza en el momento, no en el
    plan.
    """

    tipo: Tipo
    colores: int = Field(ge=1, le=MAX_INDICE_MATERIAL + 1)
    ancho_m: float | None = Field(default=None, gt=0, le=100)
    alto_m: float | None = Field(default=None, gt=0, le=100)
    #: El largo de la pieza, que es lo que define una guirnalda.
    largo_m: float | None = Field(default=None, gt=0, le=100)
    #: La participación de cada material de la pieza, en su orden. La paleta de la guirnalda reparte sus pesos
    #: con esto: un material que lleva la mitad de la pieza pesa el doble que uno que lleva un cuarto. El
    #: patrón del arco y de la columna no lo lee, así que en esas dos piezas no viaja.
    pesos: list[float] | None = Field(default=None, max_length=MAX_INDICE_MATERIAL + 1)
    #: El acabado que el plan declara para cada material, en su orden; ``None`` donde no dice nada.
    acabados: list[str | None] | None = Field(default=None, max_length=MAX_INDICE_MATERIAL + 1)


class ColorPedido(ContractModel):
    """Un color de la paleta de la guirnalda: qué material es y, si el modelo lo dice, cómo se ve.

    El peso, el acabado y el papel son opcionales: sin ellos salen de lo que la pieza ya dice (la
    participación del material y su acabado declarado) o del valor del motor.
    """

    material: int = Field(ge=0, le=MAX_INDICE_MATERIAL)
    peso: float | None = Field(default=None, gt=0, le=100)
    #: Un valor de los que publica ``opciones_admitidas()["acabados"]``; otro se rechaza con su motivo.
    acabado: str | None = Field(default=None, min_length=1, max_length=40)
    rol: str | None = Field(default=None, min_length=1, max_length=40)


class PesoTamano(ContractModel):
    """Cuánto pesa un tamaño de globo en la mezcla. Los pesos son relativos y el motor los normaliza."""

    tamano: Literal[5, 9, 12, 18, 24, 36]
    peso: float = Field(ge=0, le=100)


class FormaPedida(ContractModel):
    """La línea de la guirnalda. Todo opcional: lo que falte sale de las medidas de la pieza o del motor."""

    largo_m: float | None = Field(default=None, gt=0, le=100)
    altura_m: float | None = Field(default=None, ge=0, le=10)
    pendiente_m: float | None = Field(default=None, ge=-5, le=5)
    onda_m: float | None = Field(default=None, ge=0, le=5)
    ondas: float | None = Field(default=None, ge=0, le=20)
    colgado_m: float | None = Field(default=None, ge=0, le=5)
    festones: int | None = Field(default=None, ge=1, le=20)
    carga: float | None = Field(default=None, ge=-1, le=1)
    suelo: bool | None = None


class VolumenPedido(ContractModel):
    """El grosor de la banda y cómo se agrupan los globos."""

    grosor_extremos_m: float | None = Field(default=None, gt=0, le=5)
    grosor_centro_m: float | None = Field(default=None, gt=0, le=5)
    irregularidad: float | None = Field(default=None, ge=0, le=1)
    relleno: float | None = Field(default=None, ge=0, le=1)
    racimo: int | None = Field(default=None, ge=1, le=20)
    salientes: float | None = Field(default=None, ge=0, le=1)


class AdornosPedidos(ContractModel):
    """Follaje y flores por metro. No se cotizan: no están en el catálogo de globos."""

    follaje: float | None = Field(default=None, ge=0, le=5)
    flores: float | None = Field(default=None, ge=0, le=5)


class GeometriaPedida(ContractModel):
    """Los ajustes de geometría que el modelo puede pedir. Todos opcionales: lo que falte lo pone el motor.

    ``forma``, ``globos_ancho``, ``suelo`` y ``tamano_globo`` son del arco; ``globos_capa``, ``abajo`` y
    ``arriba``, de la columna. El ancho y el alto valen para las dos. Lo que se salga del rango del motor se
    **acota** con un aviso en vez de rechazarse, porque es lo que hace el propio diseñador.
    """

    forma: Literal["alto", "semi", "herradura"] | None = None
    ancho_m: float | None = Field(default=None, gt=0, le=100)
    alto_m: float | None = Field(default=None, gt=0, le=100)
    globos_ancho: int | None = Field(default=None, ge=1, le=40)
    suelo: bool | None = None
    tamano_globo: Literal[5, 9, 12, 18, 24, 36] | None = None
    globos_capa: int | None = Field(default=None, ge=1, le=12)
    abajo: Literal[5, 9, 12, 18, 24, 36] | None = None
    arriba: Literal[5, 9, 12, 18, 24, 36] | None = None


class RematePedido(ContractModel):
    """El remate de una columna. Sin él, el motor pone el suyo (un globo de 24")."""

    tipo: Literal["ninguno", "globo", "racimo", "estrella", "corazon"]
    material: int | None = Field(default=None, ge=0, le=MAX_INDICE_MATERIAL)
    tamano: Literal[5, 9, 12, 18, 24, 36] | None = None
    cantidad: int | None = Field(default=None, ge=3, le=5)
    foil_m: float | None = Field(default=None, gt=0, le=4)


class ArmadoPropuesto(ContractModel):
    """Un armado que el modelo ya armó en este turno, para validarlo contra la pieza de verdad."""

    estructura_id: Identificador
    tipo: Tipo
    armado: dict[str, Any]


class ArmadoEstructuraRequest(OperationalRequest):
    """``omoikane-armado-estructura.v1``: las tres acciones de la herramienta del agente.

    Un solo modelo con ``accion`` y un validador que exige lo de cada una, en vez de tres operaciones con tres
    ámbitos: es el mismo trabajo (el motor del diseñador sobre una pieza) y comparten los dos tipos, la
    geometría y la forma del armado.
    """

    schema_version: Literal["omoikane-armado-estructura.v1"]
    accion: Literal["catalogo", "armar", "completar"]
    tipo: Tipo | None = None
    # --- `armar` ---
    estructura_id: Identificador | None = None
    pieza: PiezaArmado | None = None
    patron: str | None = Field(default=None, min_length=1, max_length=40)
    materiales: list[int] | None = Field(default=None, min_length=1, max_length=MAX_MATERIALES)
    opciones: dict[str, float] | None = Field(default=None, max_length=24)
    geometria: GeometriaPedida | None = None
    remate: RematePedido | None = None
    # --- `armar`, solo la guirnalda orgánica: no tiene patrón, la definen estos bloques ---
    paleta: list[ColorPedido] | None = Field(default=None, min_length=1, max_length=MAX_MATERIALES)
    reparto: str | None = Field(default=None, min_length=1, max_length=40)
    mezcla_colores: float | None = Field(default=None, ge=0, le=1)
    forma: FormaPedida | None = None
    volumen: VolumenPedido | None = None
    tamanos: list[PesoTamano] | None = Field(
        default=None, min_length=1, max_length=len(TAMANOS_GLOBO)
    )
    adornos: AdornosPedidos | None = None
    # --- `completar` ---
    plan: dict[str, Any] | None = None
    armados: list[ArmadoPropuesto] | None = Field(default=None, max_length=MAX_ESTRUCTURAS)

    @model_validator(mode="after")
    def exigir_lo_de_cada_accion(self) -> "ArmadoEstructuraRequest":
        if self.accion == "catalogo" and self.tipo is None:
            raise ValueError("catalogo necesita tipo")
        if self.accion == "armar":
            if self.pieza is None:
                raise ValueError("armar necesita pieza")
            # Una guirnalda orgánica no tiene patrón: lo que la define es su paleta, con el acabado y el papel
            # de cada color. El arco y la columna sí, y sin él no hay nada que armar.
            if self.pieza.tipo == "guirnalda":
                if self.paleta is None:
                    raise ValueError("armar una guirnalda necesita paleta")
            elif self.patron is None or self.materiales is None:
                raise ValueError("armar un arco o una columna necesita patron y materiales")
        if self.accion == "completar" and self.plan is None:
            raise ValueError("completar necesita plan")
        if self.materiales is not None and any(
            indice < 0 or indice > MAX_INDICE_MATERIAL for indice in self.materiales
        ):
            raise ValueError("un indice de material no cabe en el contrato")
        return self


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return min(maximo, max(minimo, valor))


def _numero(valor: object) -> float | None:
    """Un número finito, o nada. Un booleano no es un número (``True`` no es un ancho)."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor) if valor == valor and valor not in (float("inf"), float("-inf")) else None


# ---------------------------------------------------------------------------
# El catálogo: lo que el modelo puede usar
# ---------------------------------------------------------------------------


def catalogo_de(tipo: str) -> dict[str, Any]:
    """``opciones_admitidas()`` del tipo que se pregunte, tal cual sale del motor."""
    if tipo == "arco":
        return dict(opciones_arco())
    if tipo == "columna":
        return dict(opciones_columna())
    return dict(opciones_guirnalda())


# ---------------------------------------------------------------------------
# Los mandos del patrón: lo que el modelo pide, acotado por el motor
# ---------------------------------------------------------------------------


def _controles_arco(patron: str) -> dict[str, tuple[float, float, float]]:
    return {
        cast(str, c["clave"]): (
            float(cast(float, c["min"])),
            float(cast(float, c["max"])),
            float(cast(float, c["def_"])),
        )
        for c in PATRONES_ARCO[patron].controles
    }


def _controles_columna(patron: str) -> dict[str, tuple[float, float, float]]:
    return {
        c.clave: (float(c.minimo), float(c.maximo), float(c.defecto))
        for c in PATRONES_COLUMNA[patron].controles
    }


def _opciones_del_patron(
    controles: Mapping[str, tuple[float, float, float]],
    pedidas: Mapping[str, float] | None,
    avisos: list[str],
) -> dict[str, float]:
    """Los mandos del patrón: el valor por defecto del motor, y el pedido cuando cabe en su rango.

    Un valor fuera de rango se **acota** (es lo que hace el diseñador al mover el control a su tope) y un
    mando que ese patrón no usa se deja fuera: el aviso lo dice, para que el modelo no crea que se aplicó.
    """
    salida = {clave: defecto for clave, (_, _, defecto) in controles.items()}
    for clave, valor in (pedidas or {}).items():
        rango = controles.get(clave)
        if rango is None:
            avisos.append(f"El patron no usa el mando «{clave}»; se ignoro.")
            continue
        minimo, maximo, _ = rango
        acotado = _acotar(float(valor), minimo, maximo)
        if acotado != float(valor):
            avisos.append(
                f"«{clave}» se acoto a {acotado:g} (su rango es {minimo:g} a {maximo:g})."
            )
        salida[clave] = acotado
    return salida


# ---------------------------------------------------------------------------
# Armar un arco
# ---------------------------------------------------------------------------


def _geometria_arco(
    pieza: PiezaArmado, pedida: GeometriaPedida | None, patron: str, colores: int, avisos: list[str]
) -> dict[str, Any]:
    """La geometría del arco: la del motor, con las medidas de la pieza y lo que el modelo ajuste encima."""
    base = config_inicial_arco()
    inicial = dict(base["geometria"])
    ancho = (pedida.ancho_m if pedida else None) or pieza.ancho_m or float(inicial["anchoM"])
    alto = (pedida.alto_m if pedida else None) or pieza.alto_m or float(inicial["altoM"])
    acotado_ancho = _acotar(ancho, ARCO_ANCHO_MIN, ARCO_ANCHO_MAX)
    acotado_alto = _acotar(alto, ARCO_ALTO_MIN, ARCO_ALTO_MAX)
    if acotado_ancho != ancho:
        avisos.append(
            f"El ancho se acoto a {acotado_ancho:g} m (el motor arma de {ARCO_ANCHO_MIN:g} a {ARCO_ANCHO_MAX:g} m)."
        )
    if acotado_alto != alto:
        avisos.append(
            f"El alto se acoto a {acotado_alto:g} m (el motor arma de {ARCO_ALTO_MIN:g} a {ARCO_ALTO_MAX:g} m)."
        )
    # Los globos a lo ancho los decide el motor por patrón (el arcoíris quiere uno por banda de color); el
    # modelo puede subirlos o bajarlos, y el saneado de la puerta recorta lo que no cabe en la banda.
    # `globos_ancho_por_defecto` solo mira cuántos colores tiene el patrón, así que basta con una lista de ese
    # largo: los tonos no deciden geometría.
    cfg = dict(base)
    cfg["colores"] = {**base["colores"], patron: ["#ffffff"] * max(1, colores)}
    por_defecto = globos_ancho_por_defecto(patron, cast(Any, cfg))
    globos_ancho = (pedida.globos_ancho if pedida else None) or por_defecto
    return {
        "forma": (pedida.forma if pedida else None) or inicial["forma"],
        "anchoM": acotado_ancho,
        "altoM": acotado_alto,
        "globosAncho": int(_acotar(globos_ancho, 2, 16)),
        "suelo": inicial["suelo"] if pedida is None or pedida.suelo is None else pedida.suelo,
    }


def _armado_arco(
    pieza: PiezaArmado,
    patron: str,
    materiales: Sequence[int],
    opciones: Mapping[str, float] | None,
    geometria: GeometriaPedida | None,
    avisos: list[str],
) -> dict[str, Any]:
    """Un ``armado-arco.v1`` con la receta del motor debajo y lo que el modelo pidió encima."""
    if patron not in PATRON_IDS_ARCO:
        raise ArmadoArcoInvalido(
            "patron_desconocido",
            f"«{patron}» no es un patron de arco. Los que hay: {', '.join(PATRON_IDS_ARCO)}.",
        )
    base = config_inicial_arco()
    globo = dict(base["globo"])
    if geometria is not None and geometria.tamano_globo is not None:
        globo["nominal"] = geometria.tamano_globo
    return {
        "version": VERSION_ARMADO_ARCO,
        "origen": "sugerido",
        "patron": patron,
        "opciones": _opciones_del_patron(_controles_arco(patron), opciones, avisos),
        "geometria": _geometria_arco(pieza, geometria, patron, len(materiales), avisos),
        "globo": globo,
        "capas": [],
        "secciones": [],
        "materiales": list(materiales),
    }


# ---------------------------------------------------------------------------
# Armar una columna
# ---------------------------------------------------------------------------


def _armado_columna(
    pieza: PiezaArmado,
    patron: str,
    materiales: Sequence[int],
    opciones: Mapping[str, float] | None,
    geometria: GeometriaPedida | None,
    remate: RematePedido | None,
    avisos: list[str],
) -> dict[str, Any]:
    """Un ``armado-columna.v1`` con la receta del motor debajo y lo que el modelo pidió encima."""
    if patron not in PATRON_IDS_COLUMNA:
        raise ArmadoColumnaInvalido(
            "patron_desconocido",
            f"«{patron}» no es un patron de columna. Los que hay: {', '.join(PATRON_IDS_COLUMNA)}.",
        )
    base = config_inicial_columna()
    cuerpo_motor = base.columna
    inflado_motor = base.globo
    remate_motor = base.remate
    alto = (geometria.alto_m if geometria else None) or pieza.alto_m or float(cuerpo_motor.alto_m)
    acotado = _acotar(alto, COLUMNA_ALTO_MIN, COLUMNA_ALTO_MAX)
    if acotado != alto:
        avisos.append(
            f"El alto se acoto a {acotado:g} m (el motor arma de {COLUMNA_ALTO_MIN:g} a {COLUMNA_ALTO_MAX:g} m)."
        )
    return {
        "version": VERSION_ARMADO_COLUMNA,
        "origen": "sugerido",
        # Por altura: se pide un alto y el patrón decide el tamaño y el color de cada capa. Dictar las capas
        # una por una es trabajo del editor, no de una frase del cliente.
        "modo": "altura",
        "patron": patron,
        "opciones": _opciones_del_patron(_controles_columna(patron), opciones, avisos),
        "cuerpo": {
            "alto_m": acotado,
            "globos_capa": int(
                _acotar(
                    (geometria.globos_capa if geometria else None) or cuerpo_motor.globos_capa, 3, 6
                )
            ),
            "abajo": (geometria.abajo if geometria else None) or cuerpo_motor.abajo,
            "arriba": (geometria.arriba if geometria else None) or cuerpo_motor.arriba,
            "escalonado": cuerpo_motor.escalonado,
            "base": cuerpo_motor.base,
        },
        "inflado": {
            "inflado": inflado_motor.inflado,
            "tamano": inflado_motor.tamano,
            "compresion": inflado_motor.compresion,
            "variacion_tam": inflado_motor.variacion_tam,
            "variacion_tono": inflado_motor.variacion_tono,
            "desorden": inflado_motor.desorden,
            "semilla": inflado_motor.semilla,
        },
        "remate": {
            "tipo": remate.tipo if remate else remate_motor.tipo,
            "tamano": (remate.tamano if remate else None) or remate_motor.tamano,
            "cantidad": (remate.cantidad if remate else None) or remate_motor.cantidad,
            "foil_m": (remate.foil_m if remate else None) or remate_motor.foil_m,
            # El remate apunta a un material de la pieza; sin indicación, al principal.
            "material": (
                remate.material if remate and remate.material is not None else materiales[0]
            ),
        },
        "capas": [],
        "materiales": list(materiales),
    }


# ---------------------------------------------------------------------------
# Armar una guirnalda orgánica
# ---------------------------------------------------------------------------


def _acabado_de(declarado: str | None, pedido: str | None, avisos: list[str]) -> str:
    """El acabado de un color: el que pide el modelo, el que declara el plan, o mate.

    Lo que el plan escribe de un material es la palabra del catálogo, y el motor solo conoce cuatro acabados.
    Se acepta **solo** cuando coincide con uno de ellos: traducir «reflex» o «cristal» a un acabado del motor
    sería una equivalencia de vocabulario comercial escrita aquí, es decir un segundo dueño. Lo que el motor
    no reconoce es mate, que es el látex normal, y el aviso lo dice.
    """
    if pedido is not None:
        limpio = pedido.strip().lower()
        if limpio not in VALORES_ACABADO:
            raise ArmadoGuirnaldaInvalido(
                "acabado_desconocido",
                f"«{pedido}» no es un acabado. Los que hay: {', '.join(VALORES_ACABADO)}.",
            )
        return limpio
    if declarado is not None:
        limpio = declarado.strip().lower()
        if limpio in VALORES_ACABADO:
            return limpio
        avisos.append(f"El acabado «{declarado}» no es uno del motor; ese color va mate.")
    return "mate"


def _rol_de(pedido: str | None) -> str:
    """El papel de un color: normal, o un acento repartido suelto entre los demás."""
    if pedido is None:
        return "normal"
    limpio = pedido.strip().lower()
    if limpio not in ROLES_GUIRNALDA:
        raise ArmadoGuirnaldaInvalido(
            "rol_desconocido",
            f"«{pedido}» no es un papel. Los que hay: {', '.join(ROLES_GUIRNALDA)}.",
        )
    return limpio


def _peso_de(pieza: PiezaArmado, indice: int, pedido: float | None) -> float:
    """El peso de un color: el que pide el modelo o el que sale de la participación del material en la pieza.

    La participación va de 0 a 1 y el peso del motor de 1 a 100, así que se escala; un material sin
    participación conocida pesa lo mismo que los demás, que es el reparto neutro.
    """
    if pedido is not None:
        return pedido
    pesos = pieza.pesos or []
    participacion = pesos[indice] if 0 <= indice < len(pesos) else None
    if participacion is None or participacion <= 0:
        return max(1.0, round(100 / max(1, pieza.colores), 2))
    return _acotar(round(participacion * 100, 2), 1, 100)


def _mezcla_tamanos(pedidos: Sequence[PesoTamano] | None) -> dict[str, float]:
    """La mezcla de tamaños con las claves del contrato (la pulgada como texto), solo los que se usan."""
    if not pedidos:
        inicial = cast(Mapping[str, Any], config_inicial_guirnalda()["tamanos"])["mezcla"]
        return {
            str(t): float(p) for t, p in cast(Mapping[Any, Any], inicial).items() if float(p) > 0
        }
    return {str(peso.tamano): float(peso.peso) for peso in pedidos if peso.peso > 0}


def _forma_guirnalda(
    pieza: PiezaArmado, pedida: FormaPedida | None, avisos: list[str]
) -> dict[str, Any]:
    """La línea de la guirnalda: la del motor, con el largo de la pieza y lo que el modelo ajuste encima."""
    inicial = cast(Mapping[str, Any], config_inicial_guirnalda()["forma"])
    largo = (pedida.largo_m if pedida else None) or pieza.largo_m or float(inicial["largoM"])
    acotado = _acotar(largo, GUIRNALDA_LARGO_MIN, GUIRNALDA_LARGO_MAX)
    if acotado != largo:
        avisos.append(
            f"El largo se acoto a {acotado:g} m "
            f"(el motor arma de {GUIRNALDA_LARGO_MIN:g} a {GUIRNALDA_LARGO_MAX:g} m)."
        )

    def elegir(clave: str, valor: object) -> Any:
        """El valor del motor cuando el modelo no dice nada."""
        return inicial[clave] if valor is None else valor

    # Solo las claves del contrato: `config_inicial` trae además `espejo`, que
    # `armado-guirnalda-organica.v1` no publica y la puerta rellena desde el motor.
    return {
        "largoM": acotado,
        "alturaM": elegir("alturaM", pedida.altura_m if pedida else None),
        "pendienteM": elegir("pendienteM", pedida.pendiente_m if pedida else None),
        "ondaM": elegir("ondaM", pedida.onda_m if pedida else None),
        "ondas": elegir("ondas", pedida.ondas if pedida else None),
        "colgadoM": elegir("colgadoM", pedida.colgado_m if pedida else None),
        "festones": elegir("festones", pedida.festones if pedida else None),
        "carga": elegir("carga", pedida.carga if pedida else None),
        "suelo": elegir("suelo", pedida.suelo if pedida else None),
        "persona": inicial["persona"],
    }


def _armado_guirnalda(
    pieza: PiezaArmado,
    paleta: Sequence[ColorPedido],
    request: ArmadoEstructuraRequest,
    avisos: list[str],
) -> dict[str, Any]:
    """Un ``armado-guirnalda-organica.v1`` con la receta del motor debajo y lo que el modelo pidió encima.

    **No hay patrón.** Lo que define una guirnalda es su línea, su volumen, su mezcla de tamaños y su paleta
    —con el acabado y el papel de cada color—, así que cada bloque se compone igual que los mandos de un
    patrón de arco: el valor del motor, y el pedido cuando viene.
    """
    inicial = config_inicial_guirnalda()
    volumen_motor = cast(Mapping[str, Any], inicial["volumen"])
    tamanos_motor = cast(Mapping[str, Any], inicial["tamanos"])
    colores_motor = cast(Mapping[str, Any], inicial["colores"])
    adornos_motor = cast(Mapping[str, Any], inicial["adornos"])
    pedido_volumen = request.volumen
    pedido_adornos = request.adornos
    acabados = pieza.acabados or []
    reparto = (
        colores_motor["reparto"] if request.reparto is None else request.reparto.strip().lower()
    )
    if reparto not in VALORES_REPARTO:
        raise ArmadoGuirnaldaInvalido(
            "reparto_desconocido",
            f"«{request.reparto}» no es un reparto. Los que hay: {', '.join(VALORES_REPARTO)}.",
        )

    def de_volumen(clave: str, valor: object) -> Any:
        return volumen_motor[clave] if valor is None else valor

    return {
        "version": VERSION_ARMADO_GUIRNALDA_ORGANICA,
        "origen": "sugerido",
        "forma": _forma_guirnalda(pieza, request.forma, avisos),
        "volumen": {
            "grosorPatasM": de_volumen(
                "grosorPatasM", pedido_volumen.grosor_extremos_m if pedido_volumen else None
            ),
            "grosorCimaM": de_volumen(
                "grosorCimaM", pedido_volumen.grosor_centro_m if pedido_volumen else None
            ),
            "irregularidad": de_volumen(
                "irregularidad", pedido_volumen.irregularidad if pedido_volumen else None
            ),
            "relleno": de_volumen("relleno", pedido_volumen.relleno if pedido_volumen else None),
            "racimo": de_volumen("racimo", pedido_volumen.racimo if pedido_volumen else None),
            "salientes": de_volumen(
                "salientes", pedido_volumen.salientes if pedido_volumen else None
            ),
        },
        "tamanos": {
            "mezcla": _mezcla_tamanos(request.tamanos),
            "grandesAbajo": tamanos_motor["grandesAbajo"],
            "inflado": tamanos_motor["inflado"],
            "variacion": tamanos_motor["variacion"],
        },
        "colores": {
            "paleta": [
                {
                    "material": color.material,
                    "peso": _peso_de(pieza, color.material, color.peso),
                    "acabado": _acabado_de(
                        acabados[color.material] if 0 <= color.material < len(acabados) else None,
                        color.acabado,
                        avisos,
                    ),
                    "rol": _rol_de(color.rol),
                }
                for color in paleta
            ],
            "reparto": reparto,
            "mezcla": colores_motor["mezcla"]
            if request.mezcla_colores is None
            else request.mezcla_colores,
        },
        "adornos": {
            "follaje": adornos_motor["follaje"]
            if pedido_adornos is None or pedido_adornos.follaje is None
            else pedido_adornos.follaje,
            "flores": adornos_motor["flores"]
            if pedido_adornos is None or pedido_adornos.flores is None
            else pedido_adornos.flores,
        },
        # El aspecto es pantalla (brillo, sombra, contorno, profundidad) y la semilla hace al motor
        # determinista: ninguno de los dos es una decisión del modelo, van tal cual los trae el motor.
        "aspecto": dict(cast(Mapping[str, Any], inicial["aspecto"])),
    }


# ---------------------------------------------------------------------------
# La receta: el patrón que mejor encaja con lo que la pieza ya dice
# ---------------------------------------------------------------------------


def _patron_arco_para(colores: int) -> str:
    """El patrón del arco que encaja con esos colores, con el del diseñador como preferido.

    Un color solo se puede pintar sólido. Con dos a cuatro va el patrón con el que arranca el diseñador (la
    espiral, que es la técnica más usada en un arco). Con cinco o más, el único que reparte tantas bandas es
    el arcoíris; cualquier otro dejaría colores de la pieza sin usar.
    """
    if colores <= 1:
        return "solido"
    maximo_espiral = PATRONES_ARCO["espiral"].lista["max"]
    inicial = cast(str, config_inicial_arco()["patron"])
    if colores <= int(cast(int, maximo_espiral)):
        return inicial
    return "arcoiris"


def _patron_columna_para(colores: int) -> str:
    """Lo mismo en la columna: sólido con un color, el del diseñador con dos, y el ombré de tres en adelante.

    El ombré es el único de los nueve que pide tres colores, así que es el que no deja ninguno fuera.
    """
    if colores <= 1:
        return "solido"
    if colores >= PATRONES_COLUMNA["ombre"].min_colores:
        return "ombre"
    return str(config_inicial_columna().patron)


#: Una petición vacía con la que la receta compone la guirnalda: sin nada pedido, cada bloque sale del motor.
#: Se construye una vez porque es inmutable y no lleva contexto operativo que mirar.
_PETICION_RECETA = ArmadoEstructuraRequest.model_construct(
    accion="armar", schema_version=OMOIKANE_ARMADO_SCHEMA_VERSION
)


def _receta(pieza: PiezaArmado, avisos: list[str]) -> dict[str, Any]:
    """La receta del motor para la pieza: lo que mejor encaja con lo que ya dice, y el motor para lo demás."""
    if pieza.tipo == "arco":
        patron = _patron_arco_para(pieza.colores)
        cuantos = min(
            pieza.colores,
            int(cast(int, PATRONES_ARCO[patron].lista["max"]))
            if PATRONES_ARCO[patron].lista
            else len(PATRONES_ARCO[patron].colores),
        )
        return _armado_arco(pieza, patron, list(range(cuantos)), None, None, avisos)
    if pieza.tipo == "columna":
        patron = _patron_columna_para(pieza.colores)
        cuantos = min(pieza.colores, MAX_MATERIALES)
        return _armado_columna(pieza, patron, list(range(cuantos)), None, None, None, avisos)
    # La guirnalda no tiene patrón que elegir: su receta es `config_inicial()` con el largo de la pieza y una
    # paleta con todos sus colores repartidos por participación, al azar, que es el reparto del diseñador.
    cuantos = min(pieza.colores, MAX_MATERIALES)
    paleta = [ColorPedido(material=indice) for indice in range(cuantos)]
    return _armado_guirnalda(pieza, paleta, _PETICION_RECETA, avisos)


# ---------------------------------------------------------------------------
# La puerta: validar y resolver
# ---------------------------------------------------------------------------


def _estructura_arco(colores: int, es_arco: bool = True) -> EstructuraArco:
    """La pieza como la ve el motor del arco.

    Los tonos son **marcadores**, no los colores que se compran: esta operación no dibuja nada y el plan es el
    dueño de qué color va en cada índice. El conteo y la compra salen por índice de material igual (el motor se
    alimenta de colores testigo propios, ``armado_arco._testigos``), así que nada de lo que se devuelve
    depende de estos tonos. El SVG con los colores de verdad lo emite la ruta del editor.
    """
    return EstructuraArco(es_arco=es_arco, materiales=[f"#{i + 1:06x}" for i in range(colores)])


def _estructura_columna(colores: int, es_columna: bool = True) -> EstructuraColumna:
    """Lo mismo para la columna, cuyo motor nunca mira estos tonos (ni dibuja)."""
    return EstructuraColumna(
        es_columna=es_columna, materiales=[f"#{i + 1:06x}" for i in range(colores)]
    )


def _estructura_guirnalda(colores: int, es_guirnalda: bool = True) -> EstructuraGuirnalda:
    """La pieza como la ve el motor de la guirnalda. Mismos tonos marcadores, por lo mismo que el arco."""
    return EstructuraGuirnalda(
        es_guirnalda=es_guirnalda, materiales=[f"#{i + 1:06x}" for i in range(colores)]
    )


def _resumen_arco(resuelto: Mapping[str, Any]) -> dict[str, Any]:
    """Lo que el modelo necesita saber del arco resuelto. Sin globos y sin SVG: no mira píxeles."""
    return {
        "total_globos": len(cast(Sequence[object], resuelto["globos"])),
        "filas": resuelto["filas"],
        "columnas": resuelto["columnas"],
        "largo_m": resuelto["largo_m"],
        "ancho_m": resuelto["ancho_m"],
        "alto_m": resuelto["alto_m"],
        "grosor_m": resuelto["grosor_m"],
        "globos_por_metro": resuelto["globos_por_metro"],
        "conteo": resuelto["conteo"],
        "compra": resuelto["compra"],
        "total_comprar": resuelto["total_comprar"],
    }


def _resumen_columna(resuelto: Mapping[str, Any]) -> dict[str, Any]:
    """Lo que el modelo necesita saber de la columna resuelta."""
    return {
        "total_globos": len(cast(Sequence[object], resuelto["globos"])),
        "capas": resuelto["capas"],
        "alto_cuerpo_m": resuelto["alto_cuerpo_m"],
        "alto_total_m": resuelto["alto_total_m"],
        "diametro_m": resuelto["diametro_m"],
        "conteo": resuelto["conteo"],
        "remate": cast(Mapping[str, Any], resuelto["remate"])["descripcion"],
    }


def _resumen_guirnalda(resuelto: Mapping[str, Any]) -> dict[str, Any]:
    """Lo que el modelo necesita saber de la guirnalda resuelta. Sin globos y sin SVG."""
    return {
        "total_globos": len(cast(Sequence[object], resuelto["globos"])),
        "capas": resuelto["capas"],
        "largo_m": resuelto["largo_m"],
        "ancho_m": resuelto["ancho_m"],
        "alto_m": resuelto["alto_m"],
        "grosor_extremos_m": resuelto["grosor_extremos_m"],
        "grosor_centro_m": resuelto["grosor_centro_m"],
        "globos_por_metro": resuelto["globos_por_metro"],
        # Globos que no tocan a ningún otro: con el motor bien puesto es 0, y si no lo es, se ve.
        "sueltos": resuelto["sueltos"],
        "conteo": resuelto["conteo"],
        "compra": resuelto["compra"],
        "total_comprar": resuelto["total_comprar"],
        # El follaje y las flores no se cotizan: van para que nadie los olvide al montar.
        "adornos": resuelto["adornos"],
    }


def _motivo(motivo: str, mensaje: str, estructura_id: str | None) -> PlanResolutionError:
    """Un armado que no se sostiene: motivo estable y mensaje en español, nunca un éxito a medias."""
    detalles: dict[str, object] = {"motivo": motivo, "mensaje": mensaje}
    if estructura_id is not None:
        detalles["estructura_id"] = estructura_id
    return PlanResolutionError("armado_invalido", 422, detalles)


#: Las tres puertas lanzan la misma excepción con distinto nombre; se atrapan juntas.
_INVALIDOS = (ArmadoArcoInvalido, ArmadoColumnaInvalido, ArmadoGuirnaldaInvalido)


def _rechazo(
    error: ArmadoArcoInvalido | ArmadoColumnaInvalido | ArmadoGuirnaldaInvalido,
    estructura_id: str | None,
) -> PlanResolutionError:
    """Lo que dijo la puerta del motor, traducido al error estable de la frontera."""
    return _motivo(error.motivo, error.mensaje, estructura_id)


def armar(request: ArmadoEstructuraRequest) -> dict[str, Any]:
    """Un armado concreto, validado por la puerta del motor y resuelto para decir qué lleva de verdad."""
    pieza = cast(PiezaArmado, request.pieza)
    avisos: list[str] = []
    if pieza.tipo == "guirnalda":
        paleta = cast("list[ColorPedido]", request.paleta)
        materiales = [color.material for color in paleta]
    else:
        paleta = []
        materiales = cast("list[int]", request.materiales)
    fuera = [indice for indice in materiales if indice >= pieza.colores]
    if fuera:
        # Un índice que la pieza no tiene se rechaza aquí y no en el plan: es el único dato de la pieza que el
        # modelo no puede comprobar solo, y llega como `colores`.
        raise _motivo(
            "material_fuera_de_rango",
            f"La pieza lleva {pieza.colores} colores y el armado nombra el indice {fuera[0]}.",
            request.estructura_id,
        )
    patron = cast(str, request.patron) if pieza.tipo != "guirnalda" else ""
    try:
        if pieza.tipo == "arco":
            armado = _armado_arco(
                pieza, patron, materiales, request.opciones, request.geometria, avisos
            )
            resuelto = armado_arco_resuelto(_estructura_arco(pieza.colores), armado)
            resumen = _resumen_arco(resuelto)
        elif pieza.tipo == "columna":
            armado = _armado_columna(
                pieza,
                patron,
                materiales,
                request.opciones,
                request.geometria,
                request.remate,
                avisos,
            )
            resuelto = cast(
                "dict[str, Any]",
                armado_columna_resuelto(_estructura_columna(pieza.colores), armado),
            )
            resumen = _resumen_columna(resuelto)
        else:
            armado = _armado_guirnalda(pieza, paleta, request, avisos)
            resuelto = armado_guirnalda_resuelto(_estructura_guirnalda(pieza.colores), armado)
            resumen = _resumen_guirnalda(resuelto)
    except _INVALIDOS as error:
        raise _rechazo(error, request.estructura_id) from None
    return {
        "operation_schema_version": OMOIKANE_ARMADO_RESULT_VERSION,
        "accion": "armar",
        "tipo": pieza.tipo,
        **({"estructura_id": request.estructura_id} if request.estructura_id is not None else {}),
        "armado": armado,
        "resumen": resumen,
        "avisos": [*avisos, *cast("list[str]", resuelto["avisos"])],
    }


# ---------------------------------------------------------------------------
# Completar: ningún arco ni ninguna columna del plan se queda sin armado
# ---------------------------------------------------------------------------


def _pieza_del_plan(estructura: Mapping[str, Any]) -> PiezaArmado | None:
    """La pieza vista desde su estructura del plan, o nada si no tiene motor o no lleva materiales."""
    tipo = estructura.get("tipo")
    if tipo not in TIPOS_CON_MOTOR:
        return None
    materiales = estructura.get("materiales")
    if (
        not isinstance(materiales, Sequence)
        or isinstance(materiales, (str, bytes))
        or not materiales
    ):
        return None
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    cuantos = min(len(materiales), MAX_INDICE_MATERIAL + 1)
    crudos = cast(Sequence[Mapping[str, object]], materiales)[:cuantos]
    # La participación y el acabado que el plan declara de cada material solo los lee la paleta de la
    # guirnalda; el patrón del arco y de la columna no, así que no se arrastran por su rama.
    de_paleta: dict[str, Any] = (
        {
            "pesos": [_numero(m.get("participacion")) or 0.0 for m in crudos],
            "acabados": [
                m.get("acabado") if isinstance(m.get("acabado"), str) else None for m in crudos
            ],
        }
        if tipo == "guirnalda"
        else {}
    )
    return PiezaArmado(
        tipo=cast(Tipo, tipo),
        colores=cuantos,
        ancho_m=_numero(medidas.get("ancho_m")),
        alto_m=_numero(medidas.get("alto_m")),
        largo_m=_numero(medidas.get("largo_m")),
        **de_paleta,
    )


def _valida(pieza: PiezaArmado, armado: Mapping[str, Any]) -> str | None:
    """``None`` si el armado se sostiene contra la pieza; si no, el motivo estable del motor."""
    try:
        if pieza.tipo == "arco":
            validar_arco(_estructura_arco(pieza.colores), armado)
        elif pieza.tipo == "columna":
            validar_columna(_estructura_columna(pieza.colores), armado)
        else:
            validar_guirnalda(_estructura_guirnalda(pieza.colores), armado)
    except _INVALIDOS as error:
        return str(error.motivo)
    return None


def completar(request: ArmadoEstructuraRequest) -> dict[str, Any]:
    """El armado de cada arco y cada columna del plan: el del modelo si se sostiene, y si no la receta.

    Lo que el modelo armó durante el turno llega en ``armados``, y lo que escribió directamente en el plan
    llega dentro de la estructura. Las dos cosas se vuelven a validar aquí **contra la pieza de verdad**: es el
    único momento en el que se sabe cuántos materiales tiene y, por tanto, si un índice existe. Lo que no se
    sostiene se reemplaza por la receta con su motivo, nunca se cuela.
    """
    plan = cast("dict[str, Any]", request.plan)
    estructuras = plan.get("estructuras")
    if not isinstance(estructuras, Sequence) or isinstance(estructuras, (str, bytes)):
        raise PlanResolutionError("invalid_plan", 422)
    propuestos = {propuesto.estructura_id: propuesto for propuesto in (request.armados or [])}
    salida: list[dict[str, Any]] = []
    for cruda in cast(Sequence[object], estructuras)[:MAX_ESTRUCTURAS]:
        if not isinstance(cruda, Mapping):
            continue
        estructura = cast(Mapping[str, Any], cruda)
        pieza = _pieza_del_plan(estructura)
        if pieza is None:
            continue
        estructura_id = estructura.get("estructura_id")
        if not isinstance(estructura_id, str) or not estructura_id:
            continue
        # El campo del plan de ESTE tipo. En una guirnalda es `armado_guirnalda_organica`: el
        # `armado_guirnalda` de ADR-0032 es otro contrato, con su propio dueño, y esta operación no lo lee ni
        # lo escribe nunca —una pieza puede traer los dos y entonces manda el del motor—.
        clave = CLAVE_ARMADO[pieza.tipo]
        candidatos: list[tuple[str, Mapping[str, Any]]] = []
        del_plan = estructura.get(clave)
        if isinstance(del_plan, Mapping):
            candidatos.append(("plan", cast(Mapping[str, Any], del_plan)))
        propuesto = propuestos.get(estructura_id)
        if propuesto is not None and propuesto.tipo == pieza.tipo:
            candidatos.append(("herramienta", propuesto.armado))
        elegido: dict[str, Any] | None = None
        avisos: list[str] = []
        for procedencia, candidato in candidatos:
            motivo = _valida(pieza, candidato)
            if motivo is None:
                elegido = dict(candidato)
                break
            avisos.append(
                f"El armado que venia de la {procedencia} no se sostiene ({motivo}); va la receta."
            )
        origen = "modelo"
        if elegido is None:
            origen = "receta"
            elegido = _receta(pieza, avisos)
            motivo = _valida(pieza, elegido)
            if motivo is not None:  # pragma: no cover - la receta del motor siempre se sostiene
                raise PlanResolutionError(
                    "armado_invalido", 422, {"estructura_id": estructura_id, "motivo": motivo}
                )
        salida.append(
            {
                "estructura_id": estructura_id,
                "tipo": pieza.tipo,
                "clave": clave,
                "origen": origen,
                "armado": elegido,
                "avisos": avisos,
            }
        )
    return {
        "operation_schema_version": OMOIKANE_ARMADO_RESULT_VERSION,
        "accion": "completar",
        "armados": salida,
    }


def resolver_armado_estructura(request: ArmadoEstructuraRequest) -> dict[str, Any]:
    """La puerta de la operación: despacha la acción. CPU puro, sin catálogo y sin efecto."""
    if request.accion == "catalogo":
        tipo = cast(str, request.tipo)
        return {
            "operation_schema_version": OMOIKANE_ARMADO_RESULT_VERSION,
            "accion": "catalogo",
            "tipo": tipo,
            "opciones": catalogo_de(tipo),
        }
    if request.accion == "armar":
        return armar(request)
    return completar(request)


__all__ = [
    "CLAVE_ARMADO",
    "MAX_ESTRUCTURAS",
    "MAX_MATERIALES",
    "OMOIKANE_ARMADO_RESULT_VERSION",
    "OMOIKANE_ARMADO_SCHEMA_VERSION",
    "OMOIKANE_ARMADO_SCOPE",
    "TIPOS_CON_MOTOR",
    "VERSION_ARMADO_GUIRNALDA_ORGANICA",
    "AdornosPedidos",
    "ArmadoEstructuraRequest",
    "ArmadoPropuesto",
    "ColorPedido",
    "FormaPedida",
    "GeometriaPedida",
    "PesoTamano",
    "PiezaArmado",
    "RematePedido",
    "VolumenPedido",
    "armar",
    "catalogo_de",
    "completar",
    "resolver_armado_estructura",
]
