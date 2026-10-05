"""El dibujo esquemático de una pieza que ningún motor arma, y su ruta.

Dos cosas se prueban aquí y ninguna es el dibujo en sí: los vectores de oro de ``test_dibujos.py`` ya fijan
byte a byte lo que emiten ``dibujar_pared``, ``dibujar_circulo``, ``dibujar_techo`` y ``dibujar_centro``
contra el repo dueño. Lo que monta esta entrega es

- **el adaptador** (``app/dibujo_estructura.py``): qué dibujo le toca a cada estructura oficial, de dónde sale
  el color de cada material (la tinta de su referencia Sempertex), cómo se traduce el modo de color del plan al
  patrón del dibujo y cómo se lee la mezcla de tamaños que ya resolvió el plan;
- **el transporte** (``POST /internal/v1/plan/dibujo-estructura``): el scope, el contrato local de la petición
  y los rechazos.

Y una invariante que es el motivo de todo: **nada de aquí cuenta**. La pieza sigue valiendo lo que
``plan.py`` resolvió para ella.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.dibujo_estructura import (
    DIBUJO_POR_OFICIAL,
    FORMA_POR_OFICIAL,
    PATRON_DEL_MODO,
    colores_de,
    datos_de,
    dibujante_de,
    dibujo_de,
    forma_de,
    mezcla_de,
)
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.patron_color import MODOS
from app.plan import PlanResolutionError
from app.plan_dibujo_estructura import (
    PlanDibujoEstructuraRequest,
    vista_previa_dibujo_estructura,
)
from app.referencias.dibujos import dibujar_centro, dibujar_circulo, dibujar_pared, dibujar_techo
from tests.guirnalda_datos import material, plan

SECRET = "d" * 32
RUTA = "/internal/v1/plan/dibujo-estructura"
SCOPE = "plan.dibujo_estructura"
PARED = "EST_01_PARED"
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000d00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [SCOPE],
}

#: Una mezcla real como la publica ``plan_resuelto.estructuras[].mezcla_real``: dos tamaños redondos y un
#: corazón, que no es un globo que estos dibujos coloquen.
MEZCLA_REAL: tuple[dict[str, object], ...] = (
    {"diam_pulg": 12, "forma": "redondo", "unidades": 80, "pct": 61.54},
    {"diam_pulg": 5, "forma": "redondo", "unidades": 40, "pct": 30.77},
    {"diam_pulg": 18, "forma": "corazon", "unidades": 10, "pct": 7.69},
)


def _pieza(
    estructura_id: str,
    tipo: str,
    oficial: str,
    *,
    materiales: list[dict[str, object]] | None = None,
    **extra: object,
) -> dict[str, object]:
    return {
        "estructura_id": estructura_id,
        "nombre": "Pieza",
        "tipo": tipo,
        "estructura_oficial": oficial,
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3, "alto_m": 2.4, "largo_m": 3},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": materiales
        or [material("dorado", 0.3, principal=True), material("blanco", 0.7)],
        "porque": "Pieza de prueba.",
        **extra,
    }


def _pared(**extra: object) -> dict[str, object]:
    return _pieza(PARED, "pared", "pared_densa", **extra)


def _operacion(
    *,
    estructura_id: str = PARED,
    estructuras: tuple[dict[str, object], ...] | None = None,
    **extra: object,
) -> dict[str, object]:
    piezas = estructuras if estructuras is not None else (_pared(),)
    return {
        "schema_version": "plan-dibujo-estructura.v1",
        "plan": plan(*piezas),
        "estructura_id": estructura_id,
        "mezcla_real": [dict(linea) for linea in MEZCLA_REAL],
        **extra,
    }


def _peticion(**extra: object) -> PlanDibujoEstructuraRequest:
    return PlanDibujoEstructuraRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(**extra)}
    )


def _vista(**extra: object) -> dict[str, Any]:
    return cast(dict[str, Any], vista_previa_dibujo_estructura(_peticion(**extra)))


# --- El adaptador: de la pieza del plan a lo que pide el dibujo ----------------------------


def test_cada_modo_de_color_del_plan_tiene_su_patron_de_dibujo() -> None:
    # Si el plan gana un modo, la tabla se queda atrás en silencio y la pieza sale con los colores al azar.
    assert set(PATRON_DEL_MODO) == set(MODOS)
    # Los dos `None` son deliberados: `aleatorio` ya es el pintor por defecto y `flor` no tiene equivalente.
    assert [modo for modo, patron in PATRON_DEL_MODO.items() if patron is None] == [
        "aleatorio",
        "flor",
    ]


def test_el_dibujo_de_cada_estructura_oficial_sin_motor() -> None:
    assert dibujante_de(_pared()) is dibujar_pared
    assert dibujante_de(_pieza("E", "arco", "aro_circular")) is dibujar_circulo
    assert dibujante_de(_pieza("E", "guirnalda", "techo_globos")) is dibujar_techo
    assert dibujante_de(_pieza("E", "centro_mesa", "centro_mesa")) is dibujar_centro
    # Las tres paredes comparten dibujo.
    assert {DIBUJO_POR_OFICIAL[clave] for clave in DIBUJO_POR_OFICIAL if "pared" in clave} == {
        dibujar_pared
    }


def test_una_pieza_con_motor_o_sin_forma_fija_no_se_dibuja_aqui() -> None:
    # Un arco, una columna y una guirnalda los dibuja su motor, colocando cada globo.
    assert dibujante_de(_pieza("E", "arco", "arco")) is None
    assert dibujante_de(_pieza("E", "columna", "columna")) is None
    assert dibujante_de(_pieza("E", "guirnalda", "guirnalda")) is None
    # El bouquet tiene su propio armado y la figura no tiene forma fija.
    assert dibujante_de(_pieza("E", "kit", "bouquet")) is None
    assert dibujante_de(_pieza("E", "kit", "figura")) is None


def test_un_plan_sin_estructura_oficial_cae_en_su_tipo() -> None:
    sin_oficial = {
        clave: valor for clave, valor in _pared().items() if clave != "estructura_oficial"
    }
    assert dibujante_de(sin_oficial) is dibujar_pared
    assert dibujante_de({"tipo": "centro_mesa"}) is dibujar_centro


def test_el_color_del_dibujo_es_la_tinta_de_la_referencia_del_catalogo() -> None:
    colores = colores_de(
        [material("dorado", 0.3, principal=True), material("blanco", 0.7)],
    )
    # Del que más globos lleva al que menos: el dibujo pinta el fondo con el primero.
    assert [color["peso"] for color in colores] == [0.7, 0.3]
    assert colores[0]["hex"] == "#ffffff" and colores[0]["acabado"] == "mate"
    # `dorado` sin acabado declarado es el Fashion de la lámina, el primero del fabricante.
    assert colores[1]["hex"].startswith("#") and colores[1]["acabado"] == "mate"
    # Con el acabado que el plan declara, la referencia (y el acabado del dibujo) cambian.
    cromado = colores_de([{**material("dorado", 1.0, principal=True), "acabado": "cromado"}])
    assert cromado[0]["acabado"] == "cromado"
    assert cromado[0]["hex"] != colores[1]["hex"]


def test_un_color_que_no_esta_en_la_lamina_no_se_inventa() -> None:
    # El gris de respaldo de `hex_de`, el mismo con el que dibujan los motores sin tono resuelto.
    assert colores_de([material("verde pino", 1.0, principal=True)])[0] == {
        "hex": "#9ca3af",
        "acabado": "mate",
        "peso": 1.0,
    }


def test_la_mezcla_de_tamanos_sale_de_la_que_resolvio_el_plan() -> None:
    mezcla = mezcla_de(MEZCLA_REAL)

    # Los seis tamaños van siempre: los dibujos indexan la mezcla y un hueco sería un fallo.
    assert mezcla == {5: 40.0, 9: 0.0, 12: 80.0, 18: 0.0, 24: 0.0, 36: 0.0}
    datos = datos_de(_pared(), MEZCLA_REAL)
    assert (datos["dominante"], datos["redondos"]) == (12, 120)
    # El corazón de 18" no entra: estos dibujos solo colocan globos redondos.
    assert datos["mezcla"][18] == 0.0


def test_sin_un_solo_tamano_redondo_el_dibujo_cae_al_estandar() -> None:
    datos = datos_de(_pared(), [{"diam_pulg": 18, "forma": "corazon", "unidades": 9, "pct": 100}])

    assert (datos["dominante"], datos["redondos"]) == (12, 0)


def test_el_patron_del_dibujo_es_el_modo_del_plan_traducido() -> None:
    con_modo = _pared(patron_color={"base": {"modo": "damero"}, "direccion": "horizontal"})
    sin_patron = _pared()

    # El dibujo cambia con el patrón: es la regla que hizo nacer estos dibujos («cada forma y cada patrón
    # que se puede elegir cambia el dibujo»).
    ajedrez = dibujar_pared(forma_de(con_modo), "ajedrez", datos_de(con_modo, MEZCLA_REAL))
    assert dibujo_de(con_modo, MEZCLA_REAL) == ajedrez
    assert dibujo_de(sin_patron, MEZCLA_REAL) != ajedrez


# --- La vista previa ---------------------------------------------------------------------


def test_la_vista_previa_devuelve_solo_la_grafica() -> None:
    resultado = _vista()

    assert resultado["operation_schema_version"] == "plan-dibujo-estructura-result.v1"
    # Solo la gráfica: no hay pieza resuelta, ni armado, ni conteo, ni compra, ni opciones, ni límites.
    assert set(resultado) == {"operation_schema_version", "grafica"}
    grafica = resultado["grafica"]
    assert set(grafica) == {"ancho", "alto", "svg"}
    # El lienzo de la pared no es cuadrado, y cada dibujo tiene el suyo.
    assert (grafica["ancho"], grafica["alto"]) == (600, 560)
    assert grafica["svg"].startswith("<")


def test_cada_pieza_sin_motor_se_dibuja_con_su_propio_lienzo() -> None:
    lienzos: dict[str, tuple[float, float]] = {}
    for tipo, oficial, extra in (
        ("arco", "aro_circular", {}),
        ("guirnalda", "techo_globos", {"ubicacion": "techo"}),
        ("centro_mesa", "centro_mesa", {}),
    ):
        pieza = _pieza(PARED, tipo, oficial, **extra)
        grafica = cast(dict[str, Any], _vista(estructuras=(pieza,))["grafica"])
        lienzos[oficial] = (grafica["ancho"], grafica["alto"])
        assert grafica["svg"].startswith("<")

    assert lienzos == {
        "aro_circular": (600, 600),
        "techo_globos": (640, 420),
        "centro_mesa": (600, 600),
    }


def test_el_dibujo_usa_los_colores_del_catalogo_de_la_pieza() -> None:
    svg = _vista()["grafica"]["svg"].lower()

    assert "ffffff" in svg, "el blanco de la lámina pinta la pared"


def test_una_pieza_que_arma_un_motor_no_tiene_dibujo_esquematico() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        _vista(estructuras=(_pieza(PARED, "arco", "arco"),))

    assert (caso.value.code, caso.value.status_code) == ("estructura_sin_dibujo", 422)
    assert cast(Mapping[str, str], caso.value.details)["estructura_id"] == PARED


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        _vista(estructura_id="EST_09_OTRA")

    assert (caso.value.code, caso.value.status_code) == ("estructura_no_encontrada", 404)


def test_un_plan_que_no_cumple_su_contrato_no_se_dibuja() -> None:
    peticion = PlanDibujoEstructuraRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            **{**_operacion(), "plan": {"plan_version": "1.0"}},
        }
    )

    with pytest.raises(PlanResolutionError) as caso:
        vista_previa_dibujo_estructura(peticion)

    assert (caso.value.code, caso.value.status_code) == ("invalid_plan", 422)


def test_la_forma_de_la_mezcla_se_exige_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _peticion(mezcla_real=[{"diam_pulg": 12}])
    with pytest.raises(ValidationError):
        _peticion(mezcla_real=[{**dict(MEZCLA_REAL[0]), "sobra": 1}])


# --- El endpoint -------------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = SCOPE
) -> tuple[int, dict[str, object]]:
    context = {
        **CONTEXTO,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    body = json.dumps(
        {"context": context, **operation}, separators=(",", ":"), ensure_ascii=False
    ).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=RUTA,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[scope],
            body=body,
        ),
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post(RUTA, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_la_grafica_de_la_pieza() -> None:
    status, body = _post(_operacion(), "00000000-0000-4000-8000-000000000d01")

    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["operation_schema_version"] == "plan-dibujo-estructura-result.v1"
    assert set(payload["grafica"]) == {"ancho", "alto", "svg"}


def test_el_endpoint_exige_su_propio_scope() -> None:
    status, _ = _post(
        _operacion(), "00000000-0000-4000-8000-000000000d02", scope="plan.armado_arco"
    )

    assert status == 403


def test_cada_oficial_dibuja_su_propia_forma_y_no_la_de_por_defecto() -> None:
    """La forma sale de la oficial, y es lo que distingue una pared densa de una orgánica.

    Antes la forma iba siempre en ``None`` y las tres paredes salían idénticas. Esta prueba es la que falla si
    alguien la devuelve a ``None``: el emparejamiento está en ``FORMA_POR_OFICIAL``, sacado de la descripción
    de cada oficial contra la ayuda de cada forma en la lámina del repo dueño.
    """
    assert FORMA_POR_OFICIAL == {
        "pared_densa": "cuadriculada",
        "pared_no_densa": "cuadriculada",
        "pared_organica": "organica",
        "aro_circular": "organico",
        "techo_globos": "malla",
        "centro_mesa": "base",
    }
    # Todas las oficiales que se dibujan tienen su forma: una sin ella volvería a caer en la rama por defecto.
    assert set(FORMA_POR_OFICIAL) == set(DIBUJO_POR_OFICIAL)
    for oficial, forma in FORMA_POR_OFICIAL.items():
        assert forma_de(_pieza("EST_09_X", "pared", oficial)) == forma, oficial


def test_una_pared_densa_y_una_organica_ya_no_salen_con_el_mismo_dibujo() -> None:
    """El defecto que esto arregla, dicho en SVG.

    «Fondo completo de globos, sin huecos» contra «racimos irregulares y borde vivo»: son dos técnicas y se
    dibujaban igual, las dos con la textura de la segunda. La no densa comparte la geometría de la densa a
    propósito —la única forma ligera del dueño está hecha de globos link, un producto que el plan puede no
    llevar— y eso también queda fijado aquí.
    """
    densa = dibujo_de(_pieza(PARED, "pared", "pared_densa"), MEZCLA_REAL)
    no_densa = dibujo_de(_pieza(PARED, "pared", "pared_no_densa"), MEZCLA_REAL)
    organica = dibujo_de(_pieza(PARED, "pared", "pared_organica"), MEZCLA_REAL)

    assert densa is not None and no_densa is not None and organica is not None
    assert densa["svg"] != organica["svg"], "la densa y la orgánica son dos técnicas"
    assert densa["svg"] == no_densa["svg"], (
        "la no densa comparte la geometría de la densa, a propósito"
    )


def test_el_centro_de_mesa_sale_bajo_y_el_techo_sin_cintas() -> None:
    """Las dos ramas por defecto que contradecían a su propia oficial.

    El centro de mesa caía en ``helio``, que la lámina describe «atados a una pesa: **alto**», y su oficial
    dice «Arreglo **bajo** de globos sobre una mesa». El techo caía en ``helio``, «con cintas colgando», y su
    oficial solo dice «Globos suspendidos que cubren el techo»: unas cintas que nadie pidió son globos —o
    insumos— inventados, el mismo error que coronar una columna que nadie coronó.
    """
    centro = _pieza("EST_07_CENTRO", "centro_mesa", "centro_mesa")
    techo = _pieza("EST_08_TECHO", "guirnalda", "techo_globos")

    suyo_centro = dibujo_de(centro, MEZCLA_REAL)
    suyo_techo = dibujo_de(techo, MEZCLA_REAL)

    assert suyo_centro is not None and suyo_techo is not None
    assert suyo_centro["svg"] != dibujar_centro(None, None, datos_de(centro, MEZCLA_REAL))["svg"]
    assert suyo_techo["svg"] != dibujar_techo(None, None, datos_de(techo, MEZCLA_REAL))["svg"]


def test_la_forma_no_se_resuelve_por_tipo_porque_las_tres_paredes_son_el_mismo_tipo() -> None:
    """Sin oficial no hay forma: resolverla por ``tipo`` volvería a igualar las tres paredes."""
    sin_oficial = {
        clave: valor for clave, valor in _pared().items() if clave != "estructura_oficial"
    }

    assert forma_de(sin_oficial) is None
    # El dibujo sigue saliendo, por `DIBUJO_POR_TIPO`: lo que se pierde es cuál de las tres es.
    assert dibujo_de(sin_oficial, MEZCLA_REAL) is not None


def test_un_centro_de_mesa_sin_oficial_sale_bajo_como_el_que_la_trae() -> None:
    """El centro de mesa tiene una sola oficial, así que su tipo basta: sin ella ya no sale el bouquet alto."""
    con_oficial = _pieza("EST_07_CENTRO", "centro_mesa", "centro_mesa")
    sin_oficial = {
        clave: valor for clave, valor in con_oficial.items() if clave != "estructura_oficial"
    }

    assert forma_de(sin_oficial) == "base"
    assert dibujo_de(sin_oficial, MEZCLA_REAL) == dibujo_de(con_oficial, MEZCLA_REAL)


def test_la_densidad_del_dibujo_crece_como_la_de_la_cotizacion() -> None:
    """El dibujo y la fórmula que cotiza estas piezas usan la misma proporción de globos por área."""
    from app.plan import _DENSITY_LAMBDA
    from app.referencias.dibujos import GLOBOS_POR_AREA

    assert dict(GLOBOS_POR_AREA) == dict(_DENSITY_LAMBDA)


@pytest.mark.parametrize(
    ("tipo", "oficial", "densidades", "extra"),
    [
        ("pared", "pared_densa", ("media", "lujosa"), {}),
        ("pared", "pared_organica", ("media", "lujosa"), {}),
        ("guirnalda", "techo_globos", ("sencilla", "media", "lujosa"), {"ubicacion": "techo"}),
        ("centro_mesa", "centro_mesa", ("sencilla", "media", "lujosa"), {}),
    ],
)
def test_la_densidad_de_la_pieza_cambia_su_dibujo_y_nunca_quita_globos(
    tipo: str, oficial: str, densidades: tuple[str, ...], extra: dict[str, object]
) -> None:
    """Media es el dibujo de siempre, byte a byte; más densa lleva más globos y nunca menos (2026-10-04)."""
    from app.dibujo_estructura import globos_de

    sin_densidad = {
        clave: valor
        for clave, valor in _pieza("EST_09", tipo, oficial, **extra).items()
        if clave != "densidad"
    }
    assert dibujo_de({**sin_densidad, "densidad": "media"}, MEZCLA_REAL) == dibujo_de(
        sin_densidad, MEZCLA_REAL
    )
    cuantos = [
        len(globos_de({**sin_densidad, "densidad": densidad}, MEZCLA_REAL) or [])
        for densidad in densidades
    ]
    assert cuantos == sorted(cuantos) and len(set(cuantos)) == len(cuantos), cuantos


def test_la_pared_no_densa_deja_huecos_que_la_densa_no_deja() -> None:
    """La no densa es sencilla por contrato: su rejilla se abre y lleva menos globos que la densa media."""
    from app.dibujo_estructura import globos_de

    densa = globos_de(_pieza("EST_09", "pared", "pared_densa"), MEZCLA_REAL) or []
    ligera = (
        globos_de(_pieza("EST_09", "pared", "pared_no_densa", densidad="sencilla"), MEZCLA_REAL)
        or []
    )
    assert 0 < len(ligera) < len(densa)
