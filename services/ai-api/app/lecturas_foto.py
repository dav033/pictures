"""Las cuatro lecturas de la foto, validadas sobre la salida del análisis.

Vive fuera de ``app/amaterasu/`` a propósito: aquí no se llama a ningún
proveedor. Amaterasu es la IA que mira fotos, y ``app/amaterasu/`` es donde
viven sus llamadas; validar y repartir lo que una llamada devolvió no es mirar
una foto. (Los validadores que esto reutiliza siguen hoy dentro de
``app/amaterasu/`` junto a la llamada de cada lectura; moverlos es trabajo
aparte y no hacía falta para esto.)

Variante nueva del reconocedor (``v17-lectura-unica``, bandera
``LECTURA_UNICA_REFERENCIA_ENABLED``): la **única** llamada que mira la foto es
el análisis, y su herramienta devuelve además, por elemento, lo que hoy piden
cuatro llamadas de visión aparte -- el patrón de color (ADR-0028 §11, ADR-0036,
ADR-0039), el conteo de globos (ADR-0031), el armado del bouquet (ADR-0030) y el
armado de la guirnalda (ADR-0032, E4). Aquí no se llama a ningún proveedor: esta
operación solo **valida** esos cuatro bloques con los mismos validadores que
usan las lecturas de producción, así que lo que llega al blueprint tiene
exactamente la forma de siempre.

Un solo dueño por lectura: cada bloque pasa por el validador de su módulo
(``patron_referencia.validar_pistas``, ``conteo_referencia.validar_lecturas``,
``estructuras/bouquet.validar_lecturas_con_descartes`` y
``guirnalda_referencia.validar_lecturas``). Si una regla cambia allá, cambia
aquí sin tocar este archivo.

La foto viaja para una sola cosa: ``tamano_imagen`` necesita su cabecera para
convertir los tres puntos de ``linea_central`` en curvatura y desnivel
(ADR-0032, decisión 29). Sin ella esos tres campos quedan en ``null``, igual
que en la lectura de producción.

El prompt de producción (``VARIANTE_PRODUCCION = "v16"``) y las cuatro lecturas
de ``vision_estructurada.leer_foto`` no se tocan: siguen siendo el camino con la
bandera apagada (ADR-0029).
"""

from __future__ import annotations

import base64
import logging
from typing import Literal

from pydantic import Field, model_validator

from app.amaterasu.conteo_referencia import TextoTipo
from app.amaterasu.conteo_referencia import validar_lecturas as validar_conteos
from app.amaterasu.estructuras.bouquet import validar_lecturas_con_descartes
from app.amaterasu.guirnalda_referencia import validar_lecturas as validar_guirnaldas
from app.amaterasu.patron_referencia import (
    PALETA,
    ElementoReferencia,
    ImagenReferencia,
    TextoCorto,
    validar_pistas,
)
from app.tamano_imagen import tamano_imagen
from app.amaterasu.vision_estructurada import LecturaFotoError
from app.operational_models import ContractModel, OperationalRequest

logger = logging.getLogger(__name__)

LECTURA_UNICA_SCOPE = "ia.lectura_unica"
LECTURA_UNICA_SCHEMA_VERSION = "lectura-unica.v1"
LECTURA_UNICA_RESULT_VERSION = "lectura-unica-result.v1"
#: El mismo tope por foto que las cuatro lecturas que sustituye.
MAX_ELEMENTOS = 12
#: Versión de esta validación. No es la versión de un prompt: el prompt de la
#: variante vive en TypeScript (`src/lib/ia/referencia/lectura-unica.ts`) y su
#: hash viaja en `system_prompt_hash` del análisis, como el de cualquier otra
#: variante. Esto solo identifica qué validadores se aplicaron.
VALIDADOR_VERSION = "lectura-unica.v1"


class LecturaUnicaError(LecturaFotoError):
    """Stable domain error translated by the HTTP boundary."""


class ElementoLecturaUnica(ContractModel):
    """Un elemento del análisis con los cuatro bloques crudos que escribió el modelo.

    Los bloques llegan **sin validar**, tal cual salieron de la herramienta del
    análisis; cada uno es opcional porque la variante solo pide los que
    corresponden al tipo de pieza (el armado del bouquet solo a las piezas
    compactas, el de la guirnalda solo a guirnaldas, arcos y semiarcos).

    No lleva caja, colores observados ni piezas: ninguna de las cuatro
    validaciones los mira (son datos del prompt, y el prompt ya los vio en la
    misma llamada). Un campo aquí exige un consumidor.
    """

    element_id: TextoCorto
    #: Tipo de estructura del plan (`visual_semantics.structure_type`) o
    #: "desconocido". Lo lee `validar_pistas` para quedarse con el remate solo
    #: en una columna; es el único dato del elemento que una validación usa.
    tipo: TextoTipo
    #: Otra pieza de la foto que puede sostener una guirnalda (`sobre_estructura`).
    anfitriona_posible: bool = False
    patron: dict[str, object] | None = None
    conteo: dict[str, object] | None = None
    armado_bouquet: dict[str, object] | None = None
    armado_guirnalda: dict[str, object] | None = None


class LecturaUnicaRequest(OperationalRequest):
    """Authenticated operation body: one reference photo and the elements the
    reference analysis returned for it (1..12), each with the raw readings the
    same call wrote. No provider call is made for this operation."""

    schema_version: Literal["lectura-unica.v1"]
    imagen: ImagenReferencia
    elementos: list[ElementoLecturaUnica] = Field(min_length=1, max_length=MAX_ELEMENTOS)

    @model_validator(mode="after")
    def reject_duplicate_element_ids(self) -> "LecturaUnicaRequest":
        ids = [elemento.element_id for elemento in self.elementos]
        if len(ids) != len(set(ids)):
            raise ValueError("element ids must be unique")
        return self


def _con_id(element_id: str, bloque: dict[str, object]) -> dict[str, object]:
    """El bloque crudo con su ``element_id``, que es como lo esperan los validadores.

    El modelo del análisis escribe cada bloque DENTRO de su elemento, así que no
    repite el id; un id que viniera en el bloque se descarta: el dueño del id es
    el elemento, no lo que el modelo escribió dentro.
    """
    return {**{k: v for k, v in bloque.items() if k != "element_id"}, "element_id": element_id}


def _pistas_patron(elementos: list[ElementoLecturaUnica]) -> list[dict[str, object]]:
    pedidos = [elemento for elemento in elementos if elemento.patron is not None]
    if not pedidos:
        return []
    referencia = [
        ElementoReferencia(element_id=elemento.element_id, tipo=elemento.tipo)
        for elemento in pedidos
    ]
    crudas = [
        _con_id(elemento.element_id, elemento.patron)
        for elemento in pedidos
        if elemento.patron is not None
    ]
    # Anotada a propósito: `follow_imports = "skip"` hace que todo lo importado
    # sea `Any` para mypy, y `warn_return_any` rechaza devolverlo sin más.
    pistas: list[dict[str, object]] = validar_pistas({"pistas": crudas}, referencia)
    return pistas


def _conteos(elementos: list[ElementoLecturaUnica]) -> list[dict[str, object]]:
    pedidos = [elemento for elemento in elementos if elemento.conteo is not None]
    if not pedidos:
        return []
    crudas = [
        _con_id(elemento.element_id, elemento.conteo)
        for elemento in pedidos
        if elemento.conteo is not None
    ]
    lecturas = validar_conteos({"lecturas": crudas}, [elemento.element_id for elemento in pedidos])
    return lecturas or []


def _armados_bouquet(elementos: list[ElementoLecturaUnica]) -> list[dict[str, object]]:
    pedidos = [elemento for elemento in elementos if elemento.armado_bouquet is not None]
    if not pedidos:
        return []
    crudas = [
        _con_id(elemento.element_id, elemento.armado_bouquet)
        for elemento in pedidos
        if elemento.armado_bouquet is not None
    ]
    validadas = validar_lecturas_con_descartes(
        {"lecturas": crudas}, [elemento.element_id for elemento in pedidos], PALETA
    )
    if validadas is None:
        return []
    if validadas.descartes:
        # Nada se descarta en silencio, igual que en la lectura de producción.
        logger.warning(
            "lectura_unica: armados de bouquet descartados",
            extra={"descartes": validadas.descartes},
        )
    lecturas: list[dict[str, object]] = validadas.lecturas
    return lecturas


def _armados_guirnalda(
    elementos: list[ElementoLecturaUnica], tamano: tuple[int, int] | None
) -> list[dict[str, object]]:
    pedidos = [elemento for elemento in elementos if elemento.armado_guirnalda is not None]
    if not pedidos:
        return []
    crudas = [
        _con_id(elemento.element_id, elemento.armado_guirnalda)
        for elemento in pedidos
        if elemento.armado_guirnalda is not None
    ]
    leidas = {elemento.element_id for elemento in pedidos}
    # Una guirnalda puede estar abrazada a otra pieza de la foto o a otra
    # guirnalda/arco que también se lee (la misma regla que el adaptador aplica
    # hoy); nunca a sí misma, lo que descarta `estructuras/guirnalda`.
    otras = [
        elemento.element_id
        for elemento in elementos
        if elemento.element_id not in leidas and elemento.anfitriona_posible
    ]
    lecturas = validar_guirnaldas(
        {"lecturas": crudas},
        [elemento.element_id for elemento in pedidos],
        otras,
        tamano,
    )
    return lecturas or []


def validar_lectura_unica(payload: LecturaUnicaRequest) -> dict[str, object]:
    """Las cuatro lecturas validadas. Sin llamada a ningún proveedor.

    Cada bloque se valida por separado y con su propio validador: uno que no se
    pueda usar deja su lista vacía y no afecta a las otras tres, igual que hoy el
    fallo de una lectura no afecta a las demás.
    """
    try:
        bytes_imagen = base64.b64decode(payload.imagen.data_base64, validate=True)
    except Exception as causa:
        raise LecturaUnicaError("lectura_unica_invalid_image", 422) from causa
    if not bytes_imagen:
        raise LecturaUnicaError("lectura_unica_invalid_image", 422)
    tamano = tamano_imagen(bytes_imagen)
    if tamano is None:
        logger.warning(
            "lectura_unica: tamaño de imagen ilegible (%s); curvatura y desnivel en null",
            payload.imagen.mime_type,
        )
    return {
        "operation_schema_version": LECTURA_UNICA_RESULT_VERSION,
        "pistas": _pistas_patron(payload.elementos),
        "conteos": _conteos(payload.elementos),
        "armados_bouquet": _armados_bouquet(payload.elementos),
        "armados_guirnalda": _armados_guirnalda(payload.elementos, tamano),
        "validador_version": VALIDADOR_VERSION,
    }


__all__ = [
    "LECTURA_UNICA_RESULT_VERSION",
    "LECTURA_UNICA_SCHEMA_VERSION",
    "LECTURA_UNICA_SCOPE",
    "MAX_ELEMENTOS",
    "VALIDADOR_VERSION",
    "ElementoLecturaUnica",
    "LecturaUnicaError",
    "LecturaUnicaRequest",
    "validar_lectura_unica",
]
