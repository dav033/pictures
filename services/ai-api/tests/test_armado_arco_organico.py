"""La receta del arco orgánico: la pieza que el plan sabía resolver y nadie construía.

El contrato (``armado-arco-organico.v1``), la puerta (``app/armado_arco_organico.py``) y la resolución
(``plan.py``, ``_ARMADOS_DEL_MOTOR["arco_organico"]``) existían desde la migración del motor del diseñador.
Lo que no existía era el principio del camino: ``_receta`` nunca construía uno, así que **ninguna pieza
llegaba a tener un arco orgánico** y un arco declarado orgánico salía armado con un patrón de bandas, que es
otra técnica de montaje (2026-10-03). Portar no es cablear.

Lo que se prueba aquí es el enrutado y lo que la receta pone, no cómo el motor coloca los globos: eso es de
``tests/test_formas_listas.py`` y de los vectores de oro del motor.
"""

from __future__ import annotations

import hashlib
from typing import Any, cast

import pytest

from app.armado_estructura import (
    OMOIKANE_ARMADO_SCOPE,
    ArmadoEstructuraRequest,
    resolver_armado_estructura,
)
from app.armado_estructura import FORMA_SEMIARCO
from app.organico.formas import FORMAS_LISTAS

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000e1",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffffe",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [OMOIKANE_ARMADO_SCOPE],
    "body_sha256": hashlib.sha256(b"arco-organico").hexdigest(),
}


def _completar(
    mezcla: str,
    *,
    pista: dict[str, object] | None = None,
    inclinacion: float | None = None,
    tipo: str = "arco",
) -> dict[str, Any]:
    plan: dict[str, Any] = {
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": [
            {
                "estructura_id": "EST_01_ARCO",
                "nombre": "Arco",
                "tipo": tipo,
                "densidad": "media",
                "mezcla": mezcla,
                "repeticiones": 1,
                "referencia_element_id": "REF_01_E01",
                "medidas": {"ancho_m": 3.6, "alto_m": 2.6},
                "materiales": [
                    {"color": "dorado", "acabado": "cromado", "participacion": 60},
                    {"color": "blanco", "acabado": "mate", "participacion": 40},
                ],
            }
        ],
    }
    cuerpo: dict[str, Any] = {
        "context": CONTEXTO,
        "schema_version": "omoikane-armado-estructura.v1",
        "accion": "completar",
        "plan": plan,
    }
    if pista is not None:
        cuerpo["pistas"] = [pista]
    if inclinacion is not None:
        cuerpo["inclinaciones"] = [
            {"referencia_element_id": "REF_01_E01", "inclinacion": inclinacion}
        ]
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(ArmadoEstructuraRequest.model_validate(cuerpo))["armados"],
    )
    return armados[0]


def test_la_mezcla_del_plan_decide_que_motor_arma_el_arco() -> None:
    """Es la misma regla que en la columna: lo decide ``mezcla``, no el tipo."""
    organico = _completar("organica_gruesa")
    assert organico["clave"] == "armado_arco_organico"
    assert organico["armado"]["version"] == "armado-arco-organico.v1"

    clasico = _completar("clasica")
    assert clasico["clave"] == "armado_arco"
    assert clasico["armado"]["version"] == "armado-arco.v1"


def test_el_arco_organico_toma_las_medidas_de_la_pieza_y_su_paleta() -> None:
    armado = cast(dict[str, Any], _completar("organica_fina")["armado"])
    forma = cast(dict[str, Any], armado["forma"])
    assert (forma["anchoM"], forma["altoM"]) == (3.6, 2.6)
    # `carga` y `espejo` **sí** viajan en este contrato, al contrario que en la columna: son lo que hace que
    # un lado pese más y por dónde se corta un medio arco.
    assert "carga" in forma and "espejo" in forma
    paleta = cast(list[dict[str, Any]], cast(dict[str, Any], armado["colores"])["paleta"])
    assert [color["material"] for color in paleta] == [0, 1]
    # El acabado sale del material del plan: el dorado de la pieza es cromado.
    assert paleta[0]["acabado"] == "cromado"


def test_el_patron_de_la_foto_le_da_el_reparto_y_lo_marca_como_referencia() -> None:
    """Un arco orgánico no tiene patrón que elegir: tiene reparto, como la guirnalda."""
    con_foto = _completar(
        "organica_gruesa",
        pista={
            "referencia_element_id": "REF_01_E01",
            "modo": "bloques",
            "colores": ["dorado", "blanco"],
            "confianza": 0.8,
        },
    )
    assert con_foto["origen"] == "referencia"
    assert cast(dict[str, Any], con_foto["armado"]["colores"])["reparto"] == "tramos"

    sin_foto = _completar("organica_gruesa")
    assert sin_foto["origen"] == "receta"


def test_la_inclinacion_leida_carga_un_lado_y_corre_la_cima() -> None:
    """En un arco la inclinación no es una medida que mover: es qué lado pesa más.

    Desplazar una pata dejaría de ser un arco, así que la lectura va a ``carga`` (de −1 a +1) y corre la cima
    hacia ese lado dentro de lo que el contrato admite.
    """
    derecha = cast(dict[str, Any], _completar("organica_gruesa", inclinacion=0.45)["armado"])
    izquierda = cast(dict[str, Any], _completar("organica_gruesa", inclinacion=-0.45)["armado"])
    assert cast(dict[str, Any], derecha["forma"])["carga"] == pytest.approx(0.45)
    assert cast(dict[str, Any], izquierda["forma"])["carga"] == pytest.approx(-0.45)
    assert (
        cast(dict[str, Any], derecha["forma"])["cima"]
        > cast(dict[str, Any], izquierda["forma"])["cima"]
    )
    # Y nunca fuera del rango del contrato, por grande que sea la lectura.
    for extremo in (1.0, -1.0):
        forma = cast(
            dict[str, Any],
            cast(dict[str, Any], _completar("organica_gruesa", inclinacion=extremo)["armado"])[
                "forma"
            ],
        )
        assert -1.0 <= forma["carga"] <= 1.0
        assert 0.3 <= forma["cima"] <= 0.7


def test_el_contrato_nombra_las_mismas_formas_que_publica_el_motor() -> None:
    """Las dos copias del vocabulario de formas tienen que decir lo mismo.

    El motor vive en Python (``app/organico/formas.py``, puerto del repo dueño) y la lista que la interfaz y
    el chat nombran vive en TypeScript (``armado-arco-organico.ts``). No comparten ningún otro artefacto, así
    que la lista viaja por el contrato como ``x-formas-arco-organico`` —el mismo patrón que
    ``x-reglas-mezclas`` y ``x-paleta-colores``— y aquí se comparan. Sin esto, el motor podía ganar una forma
    y la interfaz no poder ofrecerla, sin que nada fallara.
    """
    from app.generated_models import contract_schema

    del_contrato = cast(list[str], contract_schema("PlanDecoracion")["x-formas-arco-organico"])
    del_motor = [f.id for f in FORMAS_LISTAS]
    assert sorted(del_contrato) == sorted(del_motor), (
        "el contrato y el motor no nombran las mismas formas de arco orgánico."
        " Ajusta FORMAS_LISTAS_ARCO_ORGANICO en src/lib/plan/armado-arco-organico.ts y regenera el contrato."
    )


def test_la_mezcla_del_plan_decide_de_que_tamanos_son_los_globos() -> None:
    """Lo que el plan declara en ``mezcla`` tiene que ser lo que el motor dibuja.

    Hasta el 2026-10-03 las dos piezas orgánicas se armaban **siempre** con la mezcla del diseño de partida
    del diseñador: una `organica_fina` y una `solo_grandes` salían con exactamente los mismos globos, y lo
    que se dibujaba no era lo que se cobraba. Como el único sitio donde el tamaño vive en el plan es
    ``mezcla``, eso dejaba además sin efecto cualquier lectura de tamaños de la foto, por bien leída que
    estuviera: no había por dónde entrar.

    Las proporciones son las del contrato (``x-reglas-mezclas``), las mismas con las que `plan.py` cuenta.
    """
    from app.plan import proporciones_de_mezcla

    for mezcla in ("organica_fina", "organica_gruesa", "solo_grandes"):
        armado = cast(dict[str, Any], _completar(mezcla)["armado"])
        esperada = {
            str(pulgadas): round(proporcion * 100, 4)
            for pulgadas, proporcion in proporciones_de_mezcla(mezcla) or ()
        }
        puesta = cast(dict[str, Any], armado["tamanos"])["mezcla"]
        assert {t: p for t, p in puesta.items() if p} == esperada, mezcla

    # Y la foto de globos casi todos gigantes llega hasta aquí: `casi_todos_gigantes` es `solo_grandes`
    # (`MEZCLA_DE_TAMANOS`), que tiene que seguir siendo una pieza ORGÁNICA. Si no, leer «gigantes» en la
    # foto terminaba armando la pieza en anillos, que es lo contrario de lo que la foto dice.
    gigantes = _completar("solo_grandes")
    assert gigantes["clave"] == "armado_arco_organico"


#: El ``corte`` de cada forma lista del motor, por su id: aquí tampoco se escribe ninguna cifra del diseño.
_CORTE = {forma.id: forma.forma["corte"] for forma in FORMAS_LISTAS}


def test_un_semiarco_sale_con_el_arco_organico_y_cortado() -> None:
    """Un medio arco **es** este armado con ``forma.corte`` menor que 1, y nada más.

    El tipo ``semiarco`` del plan no tenía motor: caía al final de ``_receta``, que le elegía un patrón del
    arco clásico por el número de colores, y lo que se dibujaba era una rejilla de bandas completa — la pieza
    que el plan llama medio arco salía entera (2026-10-04). La taxonomía del motor retiró ``semiarco`` porque
    todo medio arco es orgánico, así que aquí no hay nada que elegir: su única puerta es ``armado_arco_organico``.
    """
    semiarco = _completar("organica_gruesa", tipo="semiarco")
    assert semiarco["tipo"] == "semiarco"
    assert semiarco["clave"] == "armado_arco_organico"
    armado = cast(dict[str, Any], semiarco["armado"])
    assert armado["version"] == "armado-arco-organico.v1"
    forma = cast(dict[str, Any], armado["forma"])
    assert forma["corte"] < 1, "un medio arco se corta antes de bajar por la otra pata"
    # El corte es el de la forma lista del motor, no un número escrito en la puerta.
    assert forma["corte"] == _CORTE[FORMA_SEMIARCO]
    # El lado todavía no se decide aquí: `PiezaArmado` no trae `ubicacion` y lo voltea el editor.
    assert forma["espejo"] is False
    # Y lo demás es lo mismo que un arco orgánico: las medidas y la paleta de la pieza, con su acabado.
    assert (forma["anchoM"], forma["altoM"]) == (3.6, 2.6)
    paleta = cast(list[dict[str, Any]], cast(dict[str, Any], armado["colores"])["paleta"])
    assert [color["material"] for color in paleta] == [0, 1]
    assert paleta[0]["acabado"] == "cromado"


def test_un_semiarco_no_depende_de_la_mezcla_que_el_plan_declare() -> None:
    """Al contrario que el arco y la columna, que tienen dos motores y es la mezcla la que elige.

    Un medio arco solo tiene el orgánico: declararlo ``clasica`` no lo convierte en una rejilla de patrones,
    que además no sabe cortarse por la mitad.
    """
    for mezcla in ("clasica", "organica_fina", "organica_gruesa", "solo_grandes"):
        armado = cast(dict[str, Any], _completar(mezcla, tipo="semiarco")["armado"])
        assert armado["version"] == "armado-arco-organico.v1", mezcla
        assert cast(dict[str, Any], armado["forma"])["corte"] < 1, mezcla

    # Y el arco entero sigue decidiéndose por la mezcla, que es la regla de siempre.
    assert _completar("clasica")["clave"] == "armado_arco"
