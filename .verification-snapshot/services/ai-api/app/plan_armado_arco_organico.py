"""Vista previa del editor de arcos orgánicos, con su dibujo (ADR-0034).

``POST /internal/v1/plan/armado-arco-organico`` resuelve el armado que manda el editor, o da la receta de la
pieza con ``armado_arco_organico: null``, y devuelve **el arco resuelto y su SVG**. Es el gemelo de la vista
previa de la columna orgánica (``app/plan_armado_columna_organica.py``): sin catálogo, sin E/S, sin reloj y sin
escribir nada; el plan llega en el cuerpo y de él sale todo.

**No reemplaza a ``/internal/v1/plan/armado-arco``**, el arco clásico de la rejilla de patrones (sólido,
espiral, chevrón…). Son dos cosas distintas sobre el mismo tipo de pieza y conviven: aquella describe capas y
secciones de cuartetos; esta, la banda irregular de racimos que el motor del diseñador coloca globo a globo.
Los nombres de ruta, de scope y de contrato llevan ``-organico`` para que no haya duda de cuál es cuál.

**Un medio arco se dibuja por aquí**: es este armado con ``forma.corte`` menor que 1 (y ``forma.espejo`` para
el que sube por el otro lado), porque la taxonomía retiró ``semiarco`` y todo medio arco es orgánico.

**Aquí no se calcula nada del armado.** Cuántos globos lleva el arco, de qué color y tamaño es cada uno, qué se
compra y cómo se dibuja lo decide el motor; este módulo solo traduce entre el plan y
``EstructuraArcoOrganico``, elige la receta cuando no llega armado y recorta la respuesta a lo que publican los
contratos.

El SVG es derivado: no entra en el plan, ni en el snapshot, ni en ``plan_hash`` (ADR-0034, consecuencia 2).
Viaja solo por esta ruta. Su lienzo **sí es cuadrado** (``LIENZO`` × ``LIENZO``), al contrario que el de la
columna (600 × 720) y el de la guirnalda (760 × 440), pero la gráfica sigue llevando ``ancho`` y ``alto``: son
los dos lados que el motor publica, y cambiarlos por un solo número sería inventar un campo que el motor no
escribe.

Errores de dominio, como ``PlanResolutionError`` (la frontera HTTP los traduce con ``details``):

| Código | HTTP |
| --- | ---: |
| ``estructura_no_encontrada`` | 404 |
| ``invalid_plan`` (el plan recibido incumple plan-decoracion.v1) | 422 |
| ``armado_invalido`` (``estructura_id``, ``motivo``, ``mensaje``) | 422 |
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal, cast

from jsonschema import Draft7Validator
from pydantic import Field, field_validator

from app.armado_arco_organico_prompt import frases_arco_organico
from app.armado_arco_organico import (
    MAX_MATERIALES,
    VERSION,
    ArmadoInvalido,
    EstructuraArcoOrganico,
    armado_resuelto,
    avisos_colores_sin_uso,
    indices_usados,
    limites_de,
    opciones_admitidas,
)
from app.color_catalogo import acabado_del_motor
from app.generated_models import contract_schema
from app.operational_models import OperationalRequest
from app.armado_estructura import armado_semiarco_de_receta
from app.organico.tipos import config_inicial
from app.plan import MERMA, PlanResolutionError

# La frontera comparte con los otros motores la lectura del plan y la política del gris neutro
# (``app/plan_armado_comun.py``). Los ``X as X`` son re-exportaciones deliberadas: el aviso, el tono y el tope
# de colores se siguen leyendo desde este módulo, pero su dueño es uno solo.
from app.plan_armado_comun import (
    AVISO_SIN_COLORES as AVISO_SIN_COLORES,
    ESTRUCTURA_SCHEMA,
    MAX_MATERIALES_PIEZA as MAX_MATERIALES_PIEZA,
    TONO_NEUTRO as TONO_NEUTRO,
    ColorHex,
    Identificador,
    acotar,
    avisos_con_tono_neutro,
    estructura_de,
    materiales_de,
    medida,
    sub_esquema,
    tonos_de,
    tope,
    validar_plan,
)

PLAN_ARMADO_ARCO_ORGANICO_SCOPE = "plan.armado_arco_organico"
PLAN_ARMADO_ARCO_ORGANICO_REQUEST_VERSION = "plan-armado-arco-organico.v1"
PLAN_ARMADO_ARCO_ORGANICO_RESULT_VERSION = "plan-armado-arco-organico-result.v1"

#: El tipo de pieza que arma este motor.
TIPO_ARCO = "arco"

#: Los tipos de pieza que este motor arma. Un ``semiarco`` también: un medio arco **es** este armado con
#: ``forma.corte`` menor que 1 (encabezado de ``app/armado_arco_organico.py``) y no tiene ningún otro motor,
#: así que su dibujo, su conteo y su compra salen de esta misma vista previa. Sin él en la lista, el editor
#: pedía el dibujo de un medio arco y la puerta contestaba ``no_es_arco`` (422).
TIPOS_ARCO: tuple[str, ...] = (TIPO_ARCO, "semiarco")

#: La forma de ``armado-arco-organico.v1`` la valida el contrato exportado, igual que en la puerta: la frontera
#: no repite las reglas cruzadas, que son del motor.
_FORMA_ARMADO = Draft7Validator(
    sub_esquema(ESTRUCTURA_SCHEMA, "properties", "armado_arco_organico")
)
#: Lo que se devuelve como ``arco`` es exactamente ``plan_resuelto.armados_arco_organico[]``.
_ESQUEMA_ARCO = sub_esquema(
    contract_schema("PlanResuelto"), "properties", "armados_arco_organico", "items"
)
_ARCO_RESUELTO = Draft7Validator(_ESQUEMA_ARCO)
#: Los campos del arco resuelto, en el orden del contrato: el motor devuelve además el dibujo, que no es parte
#: de ``armados_arco_organico[]``.
_CAMPOS_ARCO: tuple[str, ...] = tuple(sub_esquema(_ESQUEMA_ARCO, "properties"))
#: Tope de avisos; lo lee cada caso de uso de su propio contrato.
MAX_AVISOS: int = tope(sub_esquema(_ESQUEMA_ARCO, "properties", "avisos"), "maxItems")
#: Peso máximo de un color de la paleta, que es la escala en la que se expresa una participación.
_PESO_MAXIMO: int = tope(
    sub_esquema(
        ESTRUCTURA_SCHEMA,
        "properties",
        "armado_arco_organico",
        "properties",
        "colores",
        "properties",
        "paleta",
        "items",
        "properties",
        "peso",
    ),
    "maximum",
)

#: El acabado con el que arranca la receta cuando el plan no nombra uno del motor. Un «perlado» o un
#: «metalizado» del catálogo no se traduce aquí: resolverlo es del catálogo, y adivinarlo sería una tabla nueva
#: con un dueño nuevo. El decorador lo cambia en el editor con lo que ``opciones`` le ofrece.
ACABADO_POR_DEFECTO = "mate"
#: Papel de un color de la receta: todos normales. Un acento es una decisión de diseño, no un valor por defecto.
ROL_POR_DEFECTO = "normal"


class PlanArmadoArcoOrganicoRequest(OperationalRequest):
    """``plan-armado-arco-organico.v1``: resolver el armado de un arco orgánico (o, con ``None``, su receta).

    Sin catálogo: el plan dice qué pieza es y qué colores lleva. ``colores`` son los tonos ``#rrggbb`` de
    ``materiales`` **en su orden**, tal como los tiene el navegador después de que el catálogo los resolvió; es
    opcional: sin ellos el motor dibuja en su gris neutro y lo avisa.
    """

    schema_version: Literal["plan-armado-arco-organico.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_arco_organico: dict[str, object] | None
    colores: list[ColorHex] | None = Field(default=None, max_length=MAX_MATERIALES_PIEZA)

    @field_validator("armado_arco_organico")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_FORMA_ARMADO.iter_errors(valor), None) is not None:
            raise ValueError("armado_arco_organico no cumple armado-arco-organico.v1")
        return valor


def _peso_de(material: Mapping[str, object]) -> int:
    """La participación del material como peso de la paleta.

    ``participacion`` es la proporción del color en la pieza y ``peso`` la proporción del color en el arco: es
    el mismo dato en otra escala, así que la receta no reparte a ciegas. El motor normaliza los pesos, de modo
    que el redondeo de aquí no mueve ninguna cantidad.
    """
    parte = material.get("participacion")
    if isinstance(parte, bool) or not isinstance(parte, (int, float)):
        return _PESO_MAXIMO
    return int(acotar(round(float(parte) * _PESO_MAXIMO), 1, _PESO_MAXIMO))


def _acabado_de(material: Mapping[str, object], admitidos: Sequence[str]) -> str:
    """El acabado del material en el motor: el del plan si el motor lo llama igual; si no, el de su familia.

    La palabra del catálogo («reflex», «cristal») pasa por ``acabado_del_motor``, la tabla del repo dueño, y no
    cae a mate (auditoría 2026-10-04, M3). Un acabado que el motor no admita aquí es el de por defecto.
    """
    acabado = material.get("acabado")
    if isinstance(acabado, str) and acabado in admitidos:
        return acabado
    color = material.get("color")
    traducido = acabado_del_motor(
        color if isinstance(color, str) else None, acabado if isinstance(acabado, str) else None
    )
    return traducido if traducido in admitidos else ACABADO_POR_DEFECTO


def _mezcla_de_tamanos(mezcla: Mapping[object, object]) -> dict[str, float]:
    """La mezcla del motor con las claves del contrato: la pulgada en texto, y sin los tamaños que no se usan."""
    return {
        str(tamano): float(cast(float, peso))
        for tamano, peso in mezcla.items()
        if isinstance(peso, (int, float)) and not isinstance(peso, bool) and peso > 0
    }


def _receta(
    estructura: Mapping[str, object], opciones: Mapping[str, object], cuantos_colores: int
) -> dict[str, object]:
    """El armado por defecto de la pieza: el diseño inicial del motor con los datos del plan.

    ``config_inicial()`` es el arco de referencia del diseñador (4 m de pata a pata, 2,60 m de alto, la cima
    corrida, racimos de cuatro y una mezcla de R5/R12/R18/R24), así que una receta no es una invención de esta
    frontera: es lo que el motor abre por defecto. Solo se cambian las cosas que sí son de la pieza: el ancho y
    el alto que declara el plan y la paleta, que lleva un color por material con su participación como peso.
    Todo lo demás —si el grosor cabe en esa abertura, qué alto admite ese ancho, qué tamaños caben en la
    banda— lo corrige ``armado_resuelto`` y lo cuenta en ``avisos``.

    A diferencia de la columna y de la guirnalda orgánicas, aquí no hay mandos del motor que haya que quitar:
    ``armado-arco-organico.v1`` publica la forma y el volumen **enteros** —``carga`` y ``espejo`` incluidos,
    porque un medio arco se arma con ellos—, así que la receta copia ``config_inicial()`` tal cual. Lo único
    que el contrato no publica es ``real``, que es política de compra y entra por el parámetro ``desperdicio``.
    """
    if estructura.get("tipo") == "semiarco":
        # Un semiarco tiene UNA receta, la del plan (``armado_estructura.armado_semiarco_de_receta``: la forma
        # lista de medio arco entera, del lado de su ubicación, con el ancho que se ve y el alto del plan y su
        # densidad). Esta tenía la suya —el arco inicial del diseñador con solo el corte— y «Volver a la receta»
        # devolvía un arco de 3,68 × 2,61 m que se leía entero para un semiarco de 1,2 × 2,2 m (2026-10-04).
        sin_armado = {
            clave: valor for clave, valor in estructura.items() if clave != "armado_arco_organico"
        }
        del_plan = armado_semiarco_de_receta(sin_armado)
        if del_plan is not None:
            return cast(dict[str, object], del_plan)
    inicial = config_inicial()
    forma = dict(cast(Mapping[str, object], inicial["forma"]))
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    ancho_m = cast(Mapping[str, float], opciones["ancho_m"])
    alto_m = cast(Mapping[str, float], opciones["alto_m"])
    forma["anchoM"] = acotar(
        medida(medidas.get("ancho_m")) or float(cast(float, forma["anchoM"])),
        ancho_m["min"],
        ancho_m["max"],
    )
    forma["altoM"] = acotar(
        medida(medidas.get("alto_m")) or float(cast(float, forma["altoM"])),
        alto_m["min"],
        alto_m["max"],
    )
    tamanos = cast(Mapping[str, object], inicial["tamanos"])
    colores_motor = cast(Mapping[str, object], inicial["colores"])
    admitidos = [
        str(cast(Mapping[str, object], acabado)["valor"])
        for acabado in cast(Sequence[object], opciones["acabados"])
    ]
    materiales = materiales_de(estructura)[: min(cuantos_colores, MAX_MATERIALES)]
    return {
        "version": VERSION,
        "origen": "sugerido",
        "forma": forma,
        "volumen": dict(cast(Mapping[str, object], inicial["volumen"])),
        "tamanos": {
            "mezcla": _mezcla_de_tamanos(cast(Mapping[object, object], tamanos["mezcla"])),
            "grandesAbajo": tamanos["grandesAbajo"],
            "inflado": tamanos["inflado"],
            "variacion": tamanos["variacion"],
        },
        "colores": {
            # Un color por material de la pieza, en su orden: el primero es el principal.
            "paleta": [
                {
                    "material": indice,
                    "peso": _peso_de(material),
                    "acabado": _acabado_de(material, admitidos),
                    "rol": ROL_POR_DEFECTO,
                }
                for indice, material in enumerate(materiales)
            ],
            "reparto": colores_motor["reparto"],
            "mezcla": colores_motor["mezcla"],
        },
        "adornos": dict(cast(Mapping[str, object], inicial["adornos"])),
        "aspecto": dict(cast(Mapping[str, object], inicial["aspecto"])),
    }


def vista_previa_armado_arco_organico(
    request: PlanArmadoArcoOrganicoRequest,
) -> dict[str, object]:
    """``plan-armado-arco-organico-result.v1``: el armado dado resuelto con su dibujo, o la receta con ``None``.

    Devuelve el arco tal como viajará en ``plan_resuelto.armados_arco_organico[]``, su gráfica (``ancho``,
    ``alto`` y ``svg``), el armado con el que se resolvió —para que el editor pueda guardar la receta que
    pidió—, las herramientas que el motor ofrece (``opciones``) y los rangos que la interfaz puede mover con
    este armado puesto (``limites``).
    """
    validar_plan(request.plan)
    estructura = estructura_de(request.plan, request.estructura_id)
    opciones = opciones_admitidas()
    tonos, resueltos = tonos_de(estructura, request.colores)
    pieza = EstructuraArcoOrganico(es_arco=estructura.get("tipo") in TIPOS_ARCO, materiales=tonos)
    armado = (
        dict(request.armado_arco_organico)
        if request.armado_arco_organico is not None
        else _receta(estructura, opciones, len(tonos))
    )
    try:
        # El desperdicio es política del plan, no del armado: el mismo `MERMA` con el que la resolución compra,
        # para que lo que la vista previa dice que hay que comprar sea lo que el plan cobra.
        resuelto = armado_resuelto(pieza, armado, MERMA)
        limites = limites_de(armado, pieza)
        usados = indices_usados(armado)
    except ArmadoInvalido as error:
        raise PlanResolutionError(
            "armado_invalido",
            422,
            {
                "estructura_id": request.estructura_id,
                "motivo": error.motivo,
                "mensaje": error.mensaje,
            },
        ) from error

    # `if campo in resuelto` como en la columna y en la guirnalda: desde el 2026-10-04 el contrato publica
    # ademas `estructura_id` y las dos frases para la imagen, que el motor no escribe — las pone esta ruta.
    arco: dict[str, object] = {
        campo: resuelto[campo] for campo in _CAMPOS_ARCO if campo in resuelto
    }
    avisos = cast(Sequence[str], arco["avisos"])
    if not resueltos:
        avisos = avisos_con_tono_neutro(avisos, MAX_AVISOS)
    # Los colores de la pieza que el armado no toma no se comprarían: se dice antes de guardar.
    sin_uso = avisos_colores_sin_uso(
        [str(material.get("color") or "") for material in materiales_de(estructura)], usados
    )
    # Lo que la imagen lee de este armado: la misma frase que publicara la resolucion (ADR-0035).
    arco["estructura_id"] = request.estructura_id
    arco["prompt_gemini"], arco["prompt_lora"] = frases_arco_organico(
        armado,
        resuelto,
        [
            (str(material.get("color") or ""), str(material.get("acabado") or ""))
            for material in materiales_de(estructura)
        ],
    )
    arco["avisos"] = [*avisos, *sin_uso][:MAX_AVISOS]
    if next(_ARCO_RESUELTO.iter_errors(arco), None) is not None:
        raise RuntimeError("el arco orgánico resuelto no cumple plan-resuelto.v1")
    grafica = cast(Mapping[str, object], resuelto["grafica"])
    return {
        "operation_schema_version": PLAN_ARMADO_ARCO_ORGANICO_RESULT_VERSION,
        "arco": arco,
        # El lienzo del arco es cuadrado, pero van sus dos lados porque son los dos que el motor publica. Lo
        # que se deja fuera es el documento SVG completo, que es para descargarlo y no para el editor, que lo
        # pinta dentro de su propio `<svg>`.
        "grafica": {"ancho": grafica["ancho"], "alto": grafica["alto"], "svg": grafica["svg"]},
        "armado": armado,
        "opciones": opciones,
        "limites": limites,
    }


__all__ = [
    "ACABADO_POR_DEFECTO",
    "AVISO_SIN_COLORES",
    "MAX_MATERIALES_PIEZA",
    "PLAN_ARMADO_ARCO_ORGANICO_REQUEST_VERSION",
    "PLAN_ARMADO_ARCO_ORGANICO_RESULT_VERSION",
    "PLAN_ARMADO_ARCO_ORGANICO_SCOPE",
    "PlanArmadoArcoOrganicoRequest",
    "ROL_POR_DEFECTO",
    "TIPOS_ARCO",
    "TIPO_ARCO",
    "TONO_NEUTRO",
    "vista_previa_armado_arco_organico",
]
