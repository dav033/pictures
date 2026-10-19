"""Vista previa del editor de columnas orgánicas, con su dibujo (ADR-0034).

``POST /internal/v1/plan/armado-columna-organica`` resuelve el armado que manda el editor, o da la receta de
la pieza con ``armado_columna_organica: null``, y devuelve **la columna resuelta y su SVG**. Es el gemelo de la
vista previa de la guirnalda orgánica (``app/plan_armado_guirnalda_organica.py``): sin catálogo, sin E/S, sin
reloj y sin escribir nada; el plan llega en el cuerpo y de él sale todo.

**No reemplaza a ``/internal/v1/plan/armado-columna``**, la columna clásica de anillos y patrones. Son dos
cosas distintas sobre el mismo tipo de pieza y conviven: aquella describe una torre de cuartetos; esta, la pila
irregular de globos de varios tamaños que el motor del diseñador coloca globo a globo. Los nombres de ruta, de
scope y de contrato llevan ``-organica`` para que no haya duda de cuál es cuál.

**Aquí no se calcula nada del armado.** Cuántos globos lleva la columna, de qué color y tamaño es cada uno, qué
se compra y cómo se dibuja lo decide el motor; este módulo solo traduce entre el plan y
``EstructuraColumnaOrganica``, elige la receta cuando no llega armado y recorta la respuesta a lo que publican
los contratos.

El SVG es derivado: no entra en el plan, ni en el snapshot, ni en ``plan_hash`` (ADR-0034, consecuencia 2).
Viaja solo por esta ruta. Su lienzo **no es cuadrado** (600 × 720), así que la gráfica lleva ``ancho`` y
``alto`` por separado.

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

from app.armado_columna_organica_prompt import frases_columna_organica
from app.armado_columna_organica import (
    MAX_MATERIALES,
    VERSION,
    ArmadoInvalido,
    EstructuraColumnaOrganica,
    armado_resuelto,
    avisos_colores_sin_uso,
    indices_usados,
    limites_de,
    opciones_admitidas,
)
from app.columnaorg.tipos import config_inicial
from app.color_catalogo import acabado_del_motor
from app.generated_models import contract_schema
from app.operational_models import OperationalRequest
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

PLAN_ARMADO_COLUMNA_ORGANICA_SCOPE = "plan.armado_columna_organica"
PLAN_ARMADO_COLUMNA_ORGANICA_REQUEST_VERSION = "plan-armado-columna-organica.v1"
PLAN_ARMADO_COLUMNA_ORGANICA_RESULT_VERSION = "plan-armado-columna-organica-result.v1"

#: El tipo de pieza que arma este motor.
TIPO_COLUMNA = "columna"

#: Mandos del motor que ``config_inicial()`` trae y ``armado-columna-organica.v1`` no publica: la carga y el
#: espejo son del motor compartido (una columna no los usa) y ``real`` es política de compra, que entra por el
#: parámetro ``desperdicio``. Copiarlos en la receta la haría incumplir su propio contrato, que es estricto.
_FORMA_SOLO_DEL_MOTOR = frozenset({"carga", "espejo"})

#: La forma de ``armado-columna-organica.v1`` la valida el contrato exportado, igual que en la puerta: la frontera
#: no repite las reglas cruzadas, que son del motor.
_FORMA_ARMADO = Draft7Validator(
    sub_esquema(ESTRUCTURA_SCHEMA, "properties", "armado_columna_organica")
)
#: Lo que se devuelve como ``columna`` es exactamente ``plan_resuelto.armados_columna_organica[]``.
_ESQUEMA_COLUMNA = sub_esquema(
    contract_schema("PlanResuelto"), "properties", "armados_columna_organica", "items"
)
_COLUMNA_RESUELTA = Draft7Validator(_ESQUEMA_COLUMNA)
#: Los campos de la columna resuelta, en el orden del contrato: el motor devuelve además el dibujo, que no es
#: parte de ``armados_columna_organica[]``.
_CAMPOS_COLUMNA: tuple[str, ...] = tuple(sub_esquema(_ESQUEMA_COLUMNA, "properties"))
#: Tope de avisos; lo lee cada caso de uso de su propio contrato.
MAX_AVISOS: int = tope(sub_esquema(_ESQUEMA_COLUMNA, "properties", "avisos"), "maxItems")
#: Peso máximo de un color de la paleta, que es la escala en la que se expresa una participación.
_PESO_MAXIMO: int = tope(
    sub_esquema(
        ESTRUCTURA_SCHEMA,
        "properties",
        "armado_columna_organica",
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


class PlanArmadoColumnaOrganicaRequest(OperationalRequest):
    """``plan-armado-columna-organica.v1``: resolver el armado de una columna orgánica (o, con ``None``, su receta).

    Sin catálogo: el plan dice qué pieza es y qué colores lleva. ``colores`` son los tonos ``#rrggbb`` de
    ``materiales`` **en su orden**, tal como los tiene el navegador después de que el catálogo los resolvió; es
    opcional: sin ellos el motor dibuja en su gris neutro y lo avisa.
    """

    schema_version: Literal["plan-armado-columna-organica.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_columna_organica: dict[str, object] | None
    colores: list[ColorHex] | None = Field(default=None, max_length=MAX_MATERIALES_PIEZA)

    @field_validator("armado_columna_organica")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_FORMA_ARMADO.iter_errors(valor), None) is not None:
            raise ValueError("armado_columna_organica no cumple armado-columna-organica.v1")
        return valor


def _peso_de(material: Mapping[str, object]) -> int:
    """La participación del material como peso de la paleta.

    ``participacion`` es la proporción del color en la pieza y ``peso`` la proporción del color en la columna: es
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

    ``config_inicial()`` es la columna de referencia del diseñador (2,20 m, base de 85 cm y punta de 45 cm, una
    mezcla de R5/R12/R18/R24), así que una receta no es una invención de esta frontera: es lo que el motor abre
    por defecto. Solo se cambian las cosas que sí son de la pieza: el alto que declara el plan y la paleta, que
    lleva un color por material con su participación como peso. Todo lo demás —si el grosor cabe en ese alto,
    qué tamaños caben en la banda, qué globo guarda proporción con la punta— lo corrige ``armado_resuelto`` y lo
    cuenta en ``avisos``.
    """
    inicial = config_inicial()
    forma = {
        clave: valor
        for clave, valor in cast(Mapping[str, object], inicial["forma"]).items()
        if clave not in _FORMA_SOLO_DEL_MOTOR
    }
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    alto_m = cast(Mapping[str, float], opciones["alto_m"])
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
    corona = cast(Mapping[str, object], inicial["corona"])
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
        # El globo grande de arriba arranca quitado, como en el diseñador; el decorador lo pone con un interruptor.
        "corona": {"activa": corona["activa"], "tamano": corona["tamano"], "material": 0},
    }


def vista_previa_armado_columna_organica(
    request: PlanArmadoColumnaOrganicaRequest,
) -> dict[str, object]:
    """``plan-armado-columna-organica-result.v1``: el armado dado resuelto con su dibujo, o la receta con ``None``.

    Devuelve la columna tal como viajará en ``plan_resuelto.armados_columna_organica[]``, su gráfica (``ancho``,
    ``alto`` y ``svg``), el armado con el que se resolvió —para que el editor pueda guardar la receta que
    pidió—, las herramientas que el motor ofrece (``opciones``) y los rangos que la interfaz puede mover con este
    armado puesto (``limites``).
    """
    validar_plan(request.plan)
    estructura = estructura_de(request.plan, request.estructura_id)
    opciones = opciones_admitidas()
    tonos, resueltos = tonos_de(estructura, request.colores)
    pieza = EstructuraColumnaOrganica(
        es_columna=estructura.get("tipo") == TIPO_COLUMNA, materiales=tonos
    )
    armado = (
        dict(request.armado_columna_organica)
        if request.armado_columna_organica is not None
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

    # `if campo in resuelto` como en el arco y en la guirnalda: desde el 2026-10-04 el contrato publica
    # ademas `estructura_id` y las dos frases para la imagen, que el motor no escribe — las pone esta ruta.
    columna: dict[str, object] = {
        campo: resuelto[campo] for campo in _CAMPOS_COLUMNA if campo in resuelto
    }
    avisos = cast(Sequence[str], columna["avisos"])
    if not resueltos:
        avisos = avisos_con_tono_neutro(avisos, MAX_AVISOS)
    # Los colores de la pieza que el armado no toma no se comprarían: se dice antes de guardar.
    sin_uso = avisos_colores_sin_uso(
        [str(material.get("color") or "") for material in materiales_de(estructura)], usados
    )
    # Lo que la imagen lee de este armado: la misma frase que publicara la resolucion (ADR-0035).
    columna["estructura_id"] = request.estructura_id
    columna["prompt_gemini"], columna["prompt_lora"] = frases_columna_organica(
        armado,
        resuelto,
        [
            (str(material.get("color") or ""), str(material.get("acabado") or ""))
            for material in materiales_de(estructura)
        ],
    )
    columna["avisos"] = [*avisos, *sin_uso][:MAX_AVISOS]
    if next(_COLUMNA_RESUELTA.iter_errors(columna), None) is not None:
        raise RuntimeError("la columna orgánica resuelta no cumple plan-resuelto.v1")
    grafica = cast(Mapping[str, object], resuelto["grafica"])
    return {
        "operation_schema_version": PLAN_ARMADO_COLUMNA_ORGANICA_RESULT_VERSION,
        "columna": columna,
        # El lienzo va con ancho y alto porque no es cuadrado. El documento SVG completo que emite el motor es
        # para descargarlo, no para el editor, que lo pinta dentro de su propio `<svg>`.
        "grafica": {"ancho": grafica["ancho"], "alto": grafica["alto"], "svg": grafica["svg"]},
        "armado": armado,
        "opciones": opciones,
        "limites": limites,
    }


__all__ = [
    "ACABADO_POR_DEFECTO",
    "AVISO_SIN_COLORES",
    "MAX_MATERIALES_PIEZA",
    "PLAN_ARMADO_COLUMNA_ORGANICA_REQUEST_VERSION",
    "PLAN_ARMADO_COLUMNA_ORGANICA_RESULT_VERSION",
    "PLAN_ARMADO_COLUMNA_ORGANICA_SCOPE",
    "PlanArmadoColumnaOrganicaRequest",
    "ROL_POR_DEFECTO",
    "TIPO_COLUMNA",
    "TONO_NEUTRO",
    "vista_previa_armado_columna_organica",
]
