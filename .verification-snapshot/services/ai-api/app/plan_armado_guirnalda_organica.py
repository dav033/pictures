"""Vista previa del editor de guirnaldas orgánicas, con su dibujo (ADR-0034).

``POST /internal/v1/plan/armado-guirnalda-organica`` resuelve el armado que manda el editor, o da la receta de
la pieza con ``armado_guirnalda_organica: null``, y devuelve **la guirnalda resuelta y su SVG**. Es el gemelo
de la vista previa del arco (``app/plan_armado_arco.py``): sin catálogo, sin E/S, sin reloj y sin escribir
nada; el plan llega en el cuerpo y de él sale todo.

**No reemplaza a ``/internal/v1/plan/armado-guirnalda``** (ADR-0032: racimos, relleno y remates). Son dos
cosas distintas sobre la misma pieza y conviven: aquella describe cómo se agrupa la compra en racimos, esta
describe la tira que el motor del diseñador coloca globo a globo. Los nombres de ruta, de scope y de contrato
llevan ``-organica`` para que no haya duda de cuál es cuál.

Vive en su propio módulo y no dentro de ``plan_edicion.py`` porque no comparte nada con la edición del plan:
no muta el plan, no toca participaciones ni patrones y su único dueño de reglas es
``app/armado_guirnalda_organica.py``, la puerta del motor migrado.

**Aquí no se calcula nada del armado.** Cuántos globos lleva la tira, de qué color y tamaño es cada uno, qué
se compra y cómo se dibuja lo decide el motor; este módulo solo traduce entre el plan y
``EstructuraGuirnalda``, elige la receta cuando no llega armado y recorta la respuesta a lo que publican los
contratos.

El SVG es derivado: no entra en el plan, ni en el snapshot, ni en ``plan_hash`` (ADR-0034, consecuencia 2).
Viaja solo por esta ruta. Su lienzo **no es cuadrado** (760 × 440), así que la gráfica lleva ``ancho`` y
``alto`` por separado y no un solo lado como la del arco.

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

from app.armado_guirnalda_organica_prompt import frases_guirnalda_organica
from app.armado_guirnalda_organica import (
    MAX_MATERIALES,
    VERSION,
    ArmadoInvalido,
    EstructuraGuirnalda,
    armado_resuelto,
    avisos_colores_sin_uso,
    limites_de,
    opciones_admitidas,
)
from app.color_catalogo import acabado_del_motor
from app.generated_models import contract_schema
from app.guirnalda.tipos import config_inicial
from app.operational_models import OperationalRequest
from app.plan import MERMA, PlanResolutionError

# La frontera comparte con la del otro motor la lectura del plan y la política del gris neutro
# (``app/plan_armado_comun.py``). Los tres ``X as X`` son re-exportaciones deliberadas: el aviso, el tono y el
# tope de colores se siguen leyendo desde este módulo (lo hacen sus pruebas y ``__all__``), pero su dueño es
# uno solo.
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

PLAN_ARMADO_GUIRNALDA_ORGANICA_SCOPE = "plan.armado_guirnalda_organica"
PLAN_ARMADO_GUIRNALDA_ORGANICA_REQUEST_VERSION = "plan-armado-guirnalda-organica.v1"
PLAN_ARMADO_GUIRNALDA_ORGANICA_RESULT_VERSION = "plan-armado-guirnalda-organica-result.v1"

#: El tipo de pieza que arma este motor. ADR-0034 le da el arco, la columna y la guirnalda.
TIPO_GUIRNALDA = "guirnalda"

#: Mandos del motor que ``config_inicial()`` trae y ``armado-guirnalda-organica.v1`` no publica: el espejo de
#: la línea vive dentro del motor (la puerta lo repone al armar) y ``real`` es política de compra, que entra
#: por el parámetro ``desperdicio``. Copiarlos en la receta la haría incumplir su propio contrato, que es
#: estricto.
_FORMA_SOLO_DEL_MOTOR = frozenset({"espejo"})


#: La forma de ``armado-guirnalda-organica.v1`` la valida el contrato exportado, igual que en la puerta: la
#: frontera no repite las reglas cruzadas, que son del motor.
_FORMA_ARMADO = Draft7Validator(
    sub_esquema(ESTRUCTURA_SCHEMA, "properties", "armado_guirnalda_organica")
)
#: Lo que se devuelve como ``guirnalda`` es exactamente ``plan_resuelto.armados_guirnalda_organica[]``.
_ESQUEMA_GUIRNALDA = sub_esquema(
    contract_schema("PlanResuelto"), "properties", "armados_guirnalda_organica", "items"
)
_GUIRNALDA_RESUELTA = Draft7Validator(_ESQUEMA_GUIRNALDA)
#: Los campos de la guirnalda resuelta, en el orden del contrato: el motor devuelve además el dibujo, que no
#: es parte de ``armados_guirnalda_organica[]``.
_CAMPOS_GUIRNALDA: tuple[str, ...] = tuple(sub_esquema(_ESQUEMA_GUIRNALDA, "properties"))
#: Tope de avisos. No coincide con el de ``armados_arco[]``, así que lo lee cada caso de uso de su propio
#: contrato: lo común es dónde va el aviso, no cuántos caben.
MAX_AVISOS: int = tope(sub_esquema(_ESQUEMA_GUIRNALDA, "properties", "avisos"), "maxItems")
#: Peso máximo de un color de la paleta, que es la escala en la que se expresa una participación.
_PESO_MAXIMO: int = tope(
    sub_esquema(
        ESTRUCTURA_SCHEMA,
        "properties",
        "armado_guirnalda_organica",
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
#: «metalizado» del catálogo no se traduce aquí: resolverlo es del catálogo, y adivinarlo sería una tabla
#: nueva con un dueño nuevo. El decorador lo cambia en el editor con lo que ``opciones`` le ofrece.
ACABADO_POR_DEFECTO = "mate"
#: Papel de un color de la receta: todos normales. Un acento es una decisión de diseño, no un valor por
#: defecto que se pueda deducir de la pieza.
ROL_POR_DEFECTO = "normal"


class PlanArmadoGuirnaldaOrganicaRequest(OperationalRequest):
    """``plan-armado-guirnalda-organica.v1``: resolver el armado de una guirnalda (o, con ``None``, su receta).

    Sin catálogo: el plan dice qué pieza es y qué colores lleva. ``colores`` son los tonos ``#rrggbb`` de
    ``materiales`` **en su orden**, tal como los tiene el navegador después de que el catálogo los resolvió;
    es lo mismo que hacen las ``lineas`` de la vista previa por racimos (nombrar lo que Python no puede saber
    sin catálogo) y, como ellas, es opcional: sin ellos el motor dibuja en su gris neutro y lo avisa.
    """

    schema_version: Literal["plan-armado-guirnalda-organica.v1"]
    plan: dict[str, object]
    estructura_id: Identificador
    armado_guirnalda_organica: dict[str, object] | None
    colores: list[ColorHex] | None = Field(default=None, max_length=MAX_MATERIALES_PIEZA)

    @field_validator("armado_guirnalda_organica")
    @classmethod
    def validar_forma(cls, valor: dict[str, object] | None) -> dict[str, object] | None:
        if valor is not None and next(_FORMA_ARMADO.iter_errors(valor), None) is not None:
            raise ValueError("armado_guirnalda_organica no cumple armado-guirnalda-organica.v1")
        return valor


def _eje_de(estructura: Mapping[str, object]) -> float | None:
    """El largo de la tira que declara el plan.

    ``largo_m`` y, si no lo trae, ``ancho_m``: es la misma lectura del eje de una guirnalda que hace la
    resolución, no una interpretación nueva de las medidas. Cuánto cuelga sobre el piso no se deduce de aquí
    —es una decisión de montaje que el plan no declara—, así que la altura se queda en la del motor.
    """
    medidas = estructura.get("medidas")
    medidas = medidas if isinstance(medidas, Mapping) else {}
    largo: float | None = medida(medidas.get("largo_m"))
    ancho: float | None = medida(medidas.get("ancho_m"))
    return largo if largo is not None else ancho


def _peso_de(material: Mapping[str, object]) -> int:
    """La participación del material como peso de la paleta.

    ``participacion`` es la proporción del color en la pieza y ``peso`` la proporción del color en la tira:
    es el mismo dato en otra escala, así que la receta no reparte a ciegas. El motor normaliza los pesos, de
    modo que el redondeo de aquí no mueve ninguna cantidad.
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
    """La mezcla del motor con las claves del contrato: la pulgada en texto, y sin los tamaños que no se usan.

    ``config_inicial()`` nombra los tamaños con enteros y deja en cero los que no entran; el contrato los
    nombra con texto y admite solo los que la guirnalda usa de verdad.
    """
    return {
        str(tamano): float(cast(float, peso))
        for tamano, peso in mezcla.items()
        if isinstance(peso, (int, float)) and not isinstance(peso, bool) and peso > 0
    }


def _receta(
    estructura: Mapping[str, object], opciones: Mapping[str, object], tonos: Sequence[str]
) -> dict[str, object]:
    """El armado por defecto de la pieza: el diseño inicial del motor con los datos del plan.

    ``config_inicial()`` es la guirnalda de referencia del diseñador (3 m de tira a 2,20 m, ondulación suave,
    racimos de cuatro, una mezcla de R5/R12/R18), así que una receta no es una invención de esta frontera: es
    lo que el motor abre por defecto. Solo se cambian las cosas que sí son de la pieza: el largo que declara
    el plan y la paleta, que lleva un color por material con su participación como peso. Todo lo demás —si el
    grosor cabe en ese largo, qué tamaños caben en la banda, cuántos festones se sostienen— lo corrige
    ``armado_resuelto`` y lo cuenta en ``avisos``.
    """
    inicial = config_inicial()
    forma = {
        clave: valor
        for clave, valor in cast(Mapping[str, object], inicial["forma"]).items()
        if clave not in _FORMA_SOLO_DEL_MOTOR
    }
    largo_m = cast(Mapping[str, Mapping[str, float]], opciones)["largo_m"]
    forma["largoM"] = acotar(
        _eje_de(estructura) or float(cast(float, forma["largoM"])),
        largo_m["min"],
        largo_m["max"],
    )
    tamanos = cast(Mapping[str, object], inicial["tamanos"])
    colores_motor = cast(Mapping[str, object], inicial["colores"])
    admitidos = [
        str(cast(Mapping[str, object], acabado)["valor"])
        for acabado in cast(Sequence[object], opciones["acabados"])
    ]
    materiales = materiales_de(estructura)[: min(len(tonos), MAX_MATERIALES)]
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


def vista_previa_armado_guirnalda_organica(
    request: PlanArmadoGuirnaldaOrganicaRequest,
) -> dict[str, object]:
    """``plan-armado-guirnalda-organica-result.v1``: el armado dado resuelto con su dibujo, o la receta.

    Devuelve la guirnalda tal como viajará en ``plan_resuelto.armados_guirnalda_organica[]``, su gráfica
    (``ancho``, ``alto`` y ``svg``: el lienzo del motor no es cuadrado), el armado con el que se resolvió
    —para que el editor pueda guardar la receta que pidió—, las herramientas que el motor ofrece
    (``opciones``) y los rangos que la interfaz puede mover con este armado puesto (``limites``).
    """
    validar_plan(request.plan)
    estructura = estructura_de(request.plan, request.estructura_id)
    opciones = opciones_admitidas()
    tonos, resueltos = tonos_de(estructura, request.colores)
    pieza = EstructuraGuirnalda(
        es_guirnalda=estructura.get("tipo") == TIPO_GUIRNALDA, materiales=tonos
    )
    armado = (
        dict(request.armado_guirnalda_organica)
        if request.armado_guirnalda_organica is not None
        else _receta(estructura, opciones, tonos)
    )
    try:
        # El desperdicio es política del plan, no del armado: el mismo `MERMA` con el que la resolución compra,
        # para que lo que la vista previa dice que hay que comprar sea lo que el plan cobra.
        resuelto = armado_resuelto(pieza, armado, MERMA)
        limites = limites_de(armado, pieza)
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

    # `if campo in resuelto` como en el arco: desde el 2026-10-04 el contrato publica además `estructura_id`
    # y las dos frases para la imagen, que el motor no escribe — las pone esta ruta, aquí debajo.
    guirnalda: dict[str, object] = {
        campo: resuelto[campo] for campo in _CAMPOS_GUIRNALDA if campo in resuelto
    }
    # Lo que la imagen lee de este armado: la misma frase que publicará la resolución (ADR-0035).
    guirnalda["estructura_id"] = request.estructura_id
    guirnalda["prompt_gemini"], guirnalda["prompt_lora"] = frases_guirnalda_organica(
        armado,
        resuelto,
        [
            (str(material.get("color") or ""), str(material.get("acabado") or ""))
            for material in materiales_de(estructura)
        ],
    )
    if not resueltos:
        guirnalda["avisos"] = avisos_con_tono_neutro(
            cast(Sequence[str], guirnalda["avisos"]), MAX_AVISOS
        )
    # Los colores de la pieza que la paleta no toma no se comprarían: se dice antes de guardar.
    paleta = cast(
        Sequence[Mapping[str, object]], cast(Mapping[str, object], armado["colores"])["paleta"]
    )
    sin_uso = avisos_colores_sin_uso(
        [str(material.get("color") or "") for material in materiales_de(estructura)],
        [cast(int, color["material"]) for color in paleta],
    )
    guirnalda["avisos"] = [*cast(Sequence[str], guirnalda["avisos"]), *sin_uso][:MAX_AVISOS]
    if next(_GUIRNALDA_RESUELTA.iter_errors(guirnalda), None) is not None:
        raise RuntimeError("la guirnalda resuelta no cumple plan-resuelto.v1")
    grafica = cast(Mapping[str, object], resuelto["grafica"])
    return {
        "operation_schema_version": PLAN_ARMADO_GUIRNALDA_ORGANICA_RESULT_VERSION,
        "guirnalda": guirnalda,
        # El lienzo va con ancho y alto porque no es cuadrado. El documento SVG completo que emite el motor
        # es para descargarlo, no para el editor, que lo pinta dentro de su propio `<svg>`.
        "grafica": {
            "ancho": grafica["ancho"],
            "alto": grafica["alto"],
            "svg": grafica["svg"],
        },
        "armado": armado,
        "opciones": opciones,
        "limites": limites,
    }


__all__ = [
    "ACABADO_POR_DEFECTO",
    "AVISO_SIN_COLORES",
    "MAX_MATERIALES_PIEZA",
    "PLAN_ARMADO_GUIRNALDA_ORGANICA_REQUEST_VERSION",
    "PLAN_ARMADO_GUIRNALDA_ORGANICA_RESULT_VERSION",
    "PLAN_ARMADO_GUIRNALDA_ORGANICA_SCOPE",
    "PlanArmadoGuirnaldaOrganicaRequest",
    "ROL_POR_DEFECTO",
    "TIPO_GUIRNALDA",
    "TONO_NEUTRO",
    "vista_previa_armado_guirnalda_organica",
]
