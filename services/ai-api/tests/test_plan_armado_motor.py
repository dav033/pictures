"""El motor del diseñador cuenta el arco, la columna y la guirnalda (ADR-0034 §3).

Lo que se comprueba aquí es la frontera de la decisión, no el motor: el motor ya
tiene sus vectores de oro (``test_arco.py``, ``test_armado_columna.py``,
``test_guirnalda.py``) y no se vuelve a verificar su aritmética.

- **Sin armado**, la pieza cuenta con la estimación de siempre, globo por globo:
  los números están congelados a mano para que un camino nuevo que se active
  donde no debía se vea aquí y no en un vector de oro.
- **Con armado**, la pieza cuenta lo que el motor colocó: el total y el reparto
  se comparan contra ``armado_resuelto``, que es el dueño.
- Un armado que no se sostiene **rompe el plan** con ``armado_invalido`` (422),
  no se traga el fallo ni cotiza un conteo inventado.
- Una guirnalda puede traer los dos armados: el de ADR-0032 (racimos, relleno y
  remates, con su editor vivo) y el del motor. Cuando están los dos **manda el
  del motor**, que es el que coloca los globos de verdad.

El catálogo y el armazón de la resolución son los de ``guirnalda_datos``: látex
redondo en rosado, blanco y dorado en los cinco diámetros estándar. Se reutiliza
en vez de duplicarse; de guirnaldas solo tiene el nombre.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any, cast

import pytest

from app.armado_arco import EstructuraArco
from app.armado_arco import armado_resuelto as armado_arco_resuelto
from app.armado_columna import EstructuraColumna
from app.armado_columna import armado_resuelto as armado_columna_resuelto
from app.armado_guirnalda_organica import EstructuraGuirnalda
from app.armado_guirnalda_organica import armado_resuelto as armado_organico_resuelto
from app.plan import (
    MERMA,
    PlanResolutionError,
    armado_arco_de_patron,
    armado_arco_de_receta,
    contar_pieza,
    pieza_del_motor_resuelta,
)
from app.armado_estructura import globos_del_remate
from tests.guirnalda_datos import (
    GUIRNALDA,
    estructura_del_plan,
    guirnalda,
    material,
    plan,
    resolver,
)


ARCO = "EST_01_ARCO"

#: Contexto operacional minimo para pedirle una receta a la puerta del motor (`armado-estructura.v1`).
CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000f7",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffff7",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["omoikane.armado_estructura"],
    "body_sha256": hashlib.sha256(b"arco-organico-hoja").hexdigest(),
}
COLUMNA = "EST_02_COLUMNA"

#: Los colores de cada pieza, en el orden en que el armado los nombra por índice:
#: ``materiales: [0, 1]`` es dorado y blanco en el arco. La guirnalda es la de
#: ``guirnalda_datos`` (2,5 m, rosado y blanco, 48 globos sin armado).
COLORES_ARCO = ("dorado", "blanco")
COLORES_COLUMNA = ("rosado", "blanco")
COLORES_GUIRNALDA = ("rosado", "blanco")


def arco(**extra: object) -> dict[str, object]:
    """Un arco de 3 × 2,4 m en dorado y blanco, mitad y mitad."""
    return {
        "estructura_id": ARCO,
        "nombre": "Arco",
        "tipo": "arco",
        "estructura_oficial": "arco",
        "rol_escena": "focal",
        "ubicacion": "arco_central",
        "medidas": {"ancho_m": 3, "alto_m": 2.4},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [
            material(COLORES_ARCO[0], 0.5, principal=True),
            material(COLORES_ARCO[1], 0.5),
        ],
        "porque": "Arco de prueba.",
        **extra,
    }


def columna(**extra: object) -> dict[str, object]:
    """Una columna de 1,6 m en rosado y blanco, mitad y mitad."""
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "estructura_oficial": "columna",
        "rol_escena": "soporte",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 1.6},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [
            material(COLORES_COLUMNA[0], 0.5, principal=True),
            material(COLORES_COLUMNA[1], 0.5),
        ],
        "porque": "Columna de prueba.",
        **extra,
    }


def armado_arco(**cambios: object) -> dict[str, object]:
    """Espiral de dos colores sobre un arco alto de 3 × 2,4 m con globo R-12."""
    return {
        "version": "armado-arco.v1",
        "origen": "decorador",
        "patron": "espiral",
        "opciones": {"ancho": 2, "inclinacion": 2, "inversion": 0, "espejo": 0},
        "geometria": {
            "forma": "alto",
            "anchoM": 3.0,
            "altoM": 2.4,
            "globosAncho": 4,
            "suelo": True,
        },
        "globo": {
            "nominal": 12,
            "inflado": 1,
            "tamano": 1.14,
            "ovalo": 1.06,
            "separacion": 1,
            "compensacion": 0.85,
            "variacionTam": 0,
            "variacionTono": 0.03,
            "desorden": 0,
            "brillo": 0.6,
            "sombra": 0.17,
            "contorno": 1,
            "profundidad": 0.8,
            "semilla": 7,
        },
        "capas": [],
        "secciones": [],
        "materiales": [0, 1],
        **cambios,
    }


def armado_columna(**cambios: object) -> dict[str, object]:
    """Espiral de dos colores por altura, con remate de un globo R-24."""
    return {
        "version": "armado-columna.v1",
        "origen": "decorador",
        "modo": "altura",
        "patron": "espiral",
        "opciones": {"vueltas": 2, "inclinacion": 1},
        "cuerpo": {
            "alto_m": 1.6,
            "globos_capa": 4,
            "abajo": 12,
            "arriba": 12,
            "escalonado": True,
            "base": True,
        },
        "inflado": {
            "inflado": 1,
            "tamano": 1.14,
            "compresion": 0.8,
            "variacion_tam": 0,
            "variacion_tono": 0.03,
            "desorden": 0,
            "semilla": 7,
        },
        "remate": {"tipo": "globo", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 1},
        "capas": [],
        "materiales": [0, 1],
        **cambios,
    }


def armado_organico(**cambios: object) -> dict[str, object]:
    """La guirnalda del motor sobre la pieza de 2,5 m: rosado mate y blanco cromado."""
    return {
        "version": "armado-guirnalda-organica.v1",
        "origen": "decorador",
        "forma": {
            "largoM": 2.5,
            "alturaM": 2.2,
            "pendienteM": 0,
            "ondaM": 0.12,
            "ondas": 1.5,
            "colgadoM": 0,
            "festones": 1,
            "carga": 0,
            "suelo": True,
            "persona": False,
        },
        "volumen": {
            "grosorPatasM": 0.4,
            "grosorCimaM": 0.62,
            "irregularidad": 0.4,
            "relleno": 0.72,
            "racimo": 4,
            "salientes": 0.35,
        },
        "tamanos": {
            "mezcla": {"5": 32, "12": 45, "18": 18},
            "grandesAbajo": 0.3,
            "inflado": 1,
            "variacion": 0.1,
        },
        "colores": {
            "paleta": [
                {"material": 0, "peso": 40, "acabado": "mate", "rol": "normal"},
                {"material": 1, "peso": 40, "acabado": "cromado", "rol": "normal"},
            ],
            "reparto": "azar",
            "mezcla": 0.5,
        },
        # Follaje y flores: no están en el catálogo de globos y no se cotizan.
        "adornos": {"follaje": 0.5, "flores": 1.0},
        "aspecto": {
            "brillo": 0.6,
            "sombra": 0.2,
            "contorno": 0.8,
            "profundidad": 0.5,
            "semilla": 11,
        },
        **cambios,
    }


def armado_por_partes(**cambios: object) -> dict[str, object]:
    """El ``armado_guirnalda`` de ADR-0032: racimos, relleno y remates."""
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": None,
        "remates": [],
        **cambios,
    }


#: Lo que el resuelto del motor lleva y la resolución **no** publica, escrito a
#: mano a propósito: el resolutor recorta por los campos que el contrato declara
#: y esta lista dice, desde fuera, cuáles son los que sobran. Si el motor
#: empieza a devolver algo más, una de las dos listas lo nota.
SOLO_DEL_MOTOR = ("grafica", "config_saneada", "desperdicio")


def estructura(resuelto: Mapping[str, object], estructura_id: str) -> dict[str, object]:
    estructuras = cast(list[dict[str, object]], resuelto["estructuras"])
    return next(item for item in estructuras if item["estructura_id"] == estructura_id)


def unidades_por_tamano_y_color(pieza: Mapping[str, object]) -> dict[tuple[float, str], int]:
    """Cuántos globos de cada diámetro y color compra la pieza resuelta."""
    totales: dict[tuple[float, str], int] = {}
    for linea in cast(list[dict[str, Any]], pieza["lineas"]):
        clave = (float(linea["diam_pulg"]), str(linea["color"]))
        totales[clave] = totales.get(clave, 0) + int(linea["unidades"])
    return totales


def conteo_del_motor(
    resuelto_motor: Mapping[str, object], colores: tuple[str, ...]
) -> dict[tuple[float, str], int]:
    """El conteo del motor leído como lo lee el plan: por diámetro y color.

    El arco cuenta solo por material porque toda su banda es del mismo globo; la
    columna y la guirnalda cuentan por material y tamaño, y la guirnalda además
    separa por acabado. Aquí se igualan las tres formas —sumando los acabados,
    porque el acabado de lo que se compra lo decide el material del plan— para
    poder comparar con lo que la pieza resuelta compró.
    """
    totales: dict[tuple[float, str], int] = {}
    # El remate de la columna también se compra desde el 2026-10-06 (`plan._conteo_del_motor`).
    remate = cast(dict[str, Any], resuelto_motor.get("remate") or {})
    for entrada in [*cast(list[dict[str, Any]], resuelto_motor["conteo"]), *cast(list[dict[str, Any]], remate.get("globos") or [])]:
        nominal = entrada.get("tamano")
        diametro = float(cast(float, nominal)) if nominal is not None else 12.0
        clave = (diametro, colores[int(entrada["material"])])
        totales[clave] = totales.get(clave, 0) + int(entrada["cantidad"])
    return totales


# --- Sin armado: el camino de siempre, intacto -------------------------------------------------


@pytest.mark.anyio
async def test_un_arco_sin_armado_cuenta_con_la_formula_de_siempre() -> None:
    """Los números congelados del arco 3 × 2,4 m ``media`` / ``organica_fina``.

    Si esto se mueve, el camino del motor se activó donde no había armado: el
    arreglo está en el resolutor, no en estos números.
    """
    resuelto = await resolver(plan(arco()))
    pieza = estructura(resuelto, ARCO)
    assert pieza["eje_m"] == 6.21
    assert pieza["total_unidades"] == 119
    assert unidades_por_tamano_y_color(pieza) == {
        (5.0, "dorado"): 13,
        (5.0, "blanco"): 12,
        (9.0, "dorado"): 11,
        (9.0, "blanco"): 11,
        (12.0, "dorado"): 32,
        (12.0, "blanco"): 32,
        (18.0, "dorado"): 3,
        (18.0, "blanco"): 3,
        (24.0, "dorado"): 1,
        (24.0, "blanco"): 1,
    }
    assert "armados_arco" not in resuelto


@pytest.mark.anyio
async def test_una_columna_sin_armado_cuenta_con_la_formula_de_siempre() -> None:
    resuelto = await resolver(plan(columna()))
    pieza = estructura(resuelto, COLUMNA)
    assert (pieza["eje_m"], pieza["total_unidades"]) == (1.6, 31)
    assert unidades_por_tamano_y_color(pieza) == {
        (5.0, "rosado"): 3,
        (5.0, "blanco"): 3,
        (9.0, "rosado"): 3,
        (9.0, "blanco"): 3,
        (12.0, "rosado"): 8,
        (12.0, "blanco"): 9,
        (18.0, "rosado"): 1,
        (24.0, "rosado"): 1,
    }
    assert "armados_columna" not in resuelto


@pytest.mark.anyio
async def test_una_guirnalda_sin_armado_cuenta_con_la_formula_de_siempre() -> None:
    """Los 48 globos de la guirnalda de 2,5 m que fijan las pruebas de ADR-0032."""
    resuelto = await resolver(plan(guirnalda()))
    pieza = estructura(resuelto, GUIRNALDA)
    assert (pieza["eje_m"], pieza["total_unidades"]) == (2.5, 48)
    assert unidades_por_tamano_y_color(pieza) == {
        (5.0, "rosado"): 6,
        (5.0, "blanco"): 4,
        (9.0, "rosado"): 5,
        (9.0, "blanco"): 4,
        (12.0, "rosado"): 16,
        (12.0, "blanco"): 10,
        (18.0, "rosado"): 1,
        (18.0, "blanco"): 1,
        (24.0, "rosado"): 1,
    }
    assert "armados_guirnalda_organica" not in resuelto


# --- Con armado: cuenta el motor ---------------------------------------------------------------


@pytest.mark.anyio
async def test_un_arco_con_armado_cuenta_los_globos_que_el_motor_coloco() -> None:
    """El eje es el largo real de la línea guía y el total, los globos colocados."""
    armado = armado_arco()
    del_motor = armado_arco_resuelto(
        EstructuraArco(es_arco=True, materiales=COLORES_ARCO), armado, MERMA
    )
    resuelto = await resolver(plan(arco(armado_arco=armado)))
    pieza = estructura(resuelto, ARCO)

    assert pieza["eje_m"] == round(cast(float, del_motor["largo_m"]), 2)
    assert pieza["total_unidades"] == len(cast(list[object], del_motor["globos"]))
    assert unidades_por_tamano_y_color(pieza) == conteo_del_motor(del_motor, COLORES_ARCO)
    # Toda la banda es del mismo globo: el ``nominal`` que nombra el armado.
    assert {float(linea["diam_pulg"]) for linea in cast(list[dict[str, Any]], pieza["lineas"])} == {
        12.0
    }
    # Y no queda nada de la estimación: el eje del arco 3 × 2,4 m era 6,21 m.
    assert pieza["eje_m"] != 6.21 and pieza["total_unidades"] != 119


# --- Un arco clásico sin armado: la fórmula; con el armado de su receta, el motor -------------------
#
# Del 2026-10-04 (``6fc3e95``) al 2026-10-05 la resolución armaba con la receta del motor el arco clásico que
# llegaba sin ``armado_arco`` y cobraba lo que esa receta colocaba. El dueño lo revirtió el 2026-10-05: por
# debajo de 2,6 m de ancho la receta arma el arco en tríos (58 globos donde la fórmula cuenta 118), reparte
# los colores por igual e ignora los tamaños que exige el cliente. Sin armado guardado vuelve la fórmula (con
# ``patron_color``, la rejilla de su patrón), como en producción (``c0ebd23``). La receta sigue siendo lo que
# la confirmación escribe y de donde arrancan el editor y la guía; guardada en la pieza, la cuenta el motor.


def patron_anillos(*secuencia: int) -> dict[str, object]:
    return {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "anillos", "secuencia": list(secuencia), "largo": 1},
    }


@pytest.mark.anyio
async def test_un_arco_clasico_con_patron_y_sin_armado_cuenta_con_la_rejilla_de_su_patron() -> None:
    """Sin ``armado_arco`` se cobra la fórmula con la rejilla del patrón; guardando la receta, el motor.

    3 × 2,4 m clásico en media son 132 globos por la fórmula, los de producción (``c0ebd23``): la rejilla de
    anillos de dos colores los reparte 68/64. La receta del patrón (``armado_arco_de_patron``) coloca 88: es lo
    que la confirmación escribe en la pieza y, ya guardada, lo que se cobra.
    """
    pieza_plan = arco(mezcla="clasica", patron_color=patron_anillos(0, 1))

    resuelto = await resolver(plan(pieza_plan))
    pieza = estructura(resuelto, ARCO)

    assert (pieza["eje_m"], pieza["total_unidades"]) == (6.21, 132)
    assert unidades_por_tamano_y_color(pieza) == {(12.0, "dorado"): 68, (12.0, "blanco"): 64}
    [publicado] = cast(list[dict[str, Any]], resuelto["patrones_color"])
    assert {fila["color"]: fila["unidades_total"] for fila in publicado["conteo"]} == {
        "dorado": 68,
        "blanco": 64,
    }
    # Nada del motor: ni pieza para la guía por la puerta de la resolución, ni hoja del instalador.
    assert pieza_del_motor_resuelta(pieza_plan) is None
    assert "armados_arco" not in resuelto
    assert "armado_arco" not in estructura_del_plan(resuelto)

    # La receta del patrón sigue ahí, y con ella guardada en la pieza cuenta el motor.
    armado = armado_arco_de_patron(pieza_plan)
    assert armado is not None and armado["materiales"] == [0, 1]
    del_motor = armado_arco_resuelto(
        EstructuraArco(es_arco=True, materiales=COLORES_ARCO), armado, MERMA
    )
    con_armado = await resolver(plan({**pieza_plan, "armado_arco": armado}))
    armada = estructura(con_armado, ARCO)
    assert armada["total_unidades"] == len(cast(list[object], del_motor["globos"])) == 88
    assert unidades_por_tamano_y_color(armada) == conteo_del_motor(del_motor, COLORES_ARCO)
    assert armada["eje_m"] == round(cast(float, del_motor["largo_m"]), 2)
    publicados = cast(list[dict[str, Any]], con_armado["armados_arco"])
    assert [item["estructura_id"] for item in publicados] == [ARCO]
    assert sum(int(item["cantidad"]) for item in publicados[0]["conteo"]) == 88


#: Lo que la fórmula cobra por un arco clásico de 3 × 2,4 m por densidad, sin armado: los números de producción
#: (``c0ebd23``), escritos a mano. Con la receta guardada el motor coloca 68 / 88 / 88 (``DENSIDAD_DEL_ARCO``).
FORMULA_DEL_ARCO_CLASICO = {"sencilla": 103, "media": 132, "lujosa": 165}


@pytest.mark.anyio
@pytest.mark.parametrize("densidad", ["sencilla", "media", "lujosa"])
@pytest.mark.parametrize("colores", [1, 2, 3])
async def test_un_arco_clasico_sin_patron_ni_armado_cuenta_con_la_formula(
    densidad: str, colores: int
) -> None:
    """Sin patrón y sin armado, la fórmula; la receta por número de colores es lo que escribe la confirmación.

    Con esa receta guardada en ``armado_arco`` la pieza la cuenta el motor, y la cotización, la hoja del
    instalador y la guía salen de ese armado. Sin ella, el arco no es del motor: ni lo cuenta ni lo publica.
    """
    tres = [material("dorado", 0.5, principal=True), material("blanco", 0.3)]
    tres.append(material("rosado", 0.2))
    pieza_plan = arco(mezcla="clasica", densidad=densidad, materiales=tres[:colores])
    assert "patron_color" not in pieza_plan and "armado_arco" not in pieza_plan

    (confirmado,) = completados(pieza_plan)
    armado = armado_arco_de_receta(pieza_plan)
    assert confirmado["clave"] == "armado_arco" and confirmado["armado"] == armado

    contada = contar_pieza(pieza_plan)
    assert (contada.fuente, contada.total_motor) == ("formula", None)
    assert contada.total_vigente == FORMULA_DEL_ARCO_CLASICO[densidad]
    resuelto = await resolver(plan(pieza_plan))
    assert estructura(resuelto, ARCO)["total_unidades"] == FORMULA_DEL_ARCO_CLASICO[densidad]
    assert pieza_del_motor_resuelta(pieza_plan) is None
    assert "armados_arco" not in resuelto

    con_armado = {**pieza_plan, "armado_arco": confirmado["armado"]}
    de_la_guia = pieza_del_motor_resuelta(con_armado)
    assert de_la_guia is not None and de_la_guia[0] == "arco"
    armado_resuelto = await resolver(plan(con_armado))
    total = estructura(armado_resuelto, ARCO)["total_unidades"]
    assert (
        total
        == len(cast(list[object], de_la_guia[1]["globos"]))
        == contar_pieza(con_armado).total_vigente
    )
    publicados = cast(list[dict[str, Any]], armado_resuelto["armados_arco"])
    assert sum(int(item["cantidad"]) for item in publicados[0]["conteo"]) == total


def test_el_arco_sin_patron_que_no_es_clasico_sigue_sin_receta() -> None:
    """La receta sin patrón es solo del arco clásico: el orgánico, el asimétrico y el aro siguen como estaban."""
    assert armado_arco_de_receta(arco()) is None  # mezcla orgánica: la fórmula, como antes
    assert (
        armado_arco_de_receta(arco(mezcla="clasica", estructura_oficial="arco_asimetrico")) is None
    )
    assert armado_arco_de_receta(arco(mezcla="clasica", estructura_oficial="aro_circular")) is None
    assert armado_arco_de_receta(arco(mezcla="clasica", armado_arco=armado_arco())) is None


@pytest.mark.anyio
async def test_el_arco_de_patron_reparte_los_colores_en_el_orden_del_patron() -> None:
    """La receta del patrón, guardada como la escribe la confirmación, sigue el orden del patrón."""
    tres = ("dorado", "blanco", "rosado")
    materiales = [material(tres[0], 0.34, principal=True), material(tres[1], 0.33)]
    materiales.append(material(tres[2], 0.33))
    cuentas: dict[tuple[int, ...], dict[tuple[float, str], int]] = {}
    for secuencia in ((0, 1, 2), (2, 0, 1)):
        pieza_plan = arco(
            mezcla="clasica", materiales=materiales, patron_color=patron_anillos(*secuencia)
        )
        armado = armado_arco_de_patron(pieza_plan)
        assert armado is not None and armado["materiales"] == list(secuencia)
        del_motor = armado_arco_resuelto(
            EstructuraArco(es_arco=True, materiales=tres), armado, MERMA
        )
        cuentas[secuencia] = unidades_por_tamano_y_color(
            estructura(await resolver(plan({**pieza_plan, "armado_arco": armado})), ARCO)
        )
        assert cuentas[secuencia] == conteo_del_motor(del_motor, tres)
    # El color que abre el patrón es el que más globos lleva: el primer anillo y cada tercero.
    assert max(cuentas[(0, 1, 2)], key=cuentas[(0, 1, 2)].__getitem__) == (12.0, "dorado")
    assert max(cuentas[(2, 0, 1)], key=cuentas[(2, 0, 1)].__getitem__) == (12.0, "rosado")


#: Globos a lo ancho de la banda del arco de patrones por densidad, y los globos que coloca el motor, en tres
#: arcos con globo R-12. Escritos a mano: ``media`` es el arco de siempre (4 a lo ancho, que en 2 m el motor
#: recorta a 3), y las otras dos mueven una capa dentro de lo que la banda admite (``RAZON_GROSOR_MAX``): en
#: 3 m y en 2 m no cabe una quinta / cuarta capa sin tapar la abertura, así que ``lujosa`` queda como ``media``.
DENSIDAD_DEL_ARCO = {
    (3.0, 2.4): {"sencilla": (3, 68), "media": (4, 88), "lujosa": (4, 88)},
    (2.0, 2.0): {"sencilla": (2, 33), "media": (4, 50), "lujosa": (3, 50)},
    (4.0, 3.0): {"sencilla": (3, 88), "media": (4, 119), "lujosa": (5, 144)},
}


@pytest.mark.anyio
@pytest.mark.parametrize("medidas", list(DENSIDAD_DEL_ARCO))
async def test_la_densidad_del_arco_de_patron_mueve_sus_globos_a_lo_ancho(
    medidas: tuple[float, float],
) -> None:
    """Sencilla ≤ media ≤ lujosa en la receta del patrón; ya guardada la cuenta el motor, y la guía la dibuja.

    La densidad del arco clásico es «globos por capa» (``investigacion-arcos.md`` del clasificador): una capa
    menos o una más que ``media``, que es el arco de siempre. Sin el armado guardado el arco lo cuenta la
    fórmula (``test_un_arco_clasico_con_patron_y_sin_armado_cuenta_con_la_rejilla_de_su_patron``).
    """
    ancho, alto = medidas
    totales: list[int] = []
    for densidad, (globos_ancho, globos) in DENSIDAD_DEL_ARCO[medidas].items():
        pieza_plan = arco(
            mezcla="clasica",
            densidad=densidad,
            medidas={"ancho_m": ancho, "alto_m": alto},
            patron_color=patron_anillos(0, 1),
        )
        armado = armado_arco_de_patron(pieza_plan)
        assert armado is not None
        assert cast(Mapping[str, object], armado["geometria"])["globosAncho"] == globos_ancho
        assert contar_pieza(pieza_plan).fuente == "formula"
        con_armado = {**pieza_plan, "armado_arco": armado}
        contada = contar_pieza(con_armado)
        assert contada.fuente == "motor"
        assert contada.total_vigente == globos != contada.total_formula
        pieza = estructura(await resolver(plan(con_armado)), ARCO)
        assert pieza["total_unidades"] == globos
        de_la_guia = pieza_del_motor_resuelta(con_armado)
        assert de_la_guia is not None
        assert len(cast(list[object], de_la_guia[1]["globos"])) == globos
        totales.append(globos)
    assert totales == sorted(totales)


@pytest.mark.anyio
async def test_los_globos_por_racimo_del_patron_mandan_sobre_la_densidad() -> None:
    """Un patrón que dice cuántos globos lleva cada racimo ya dijo el ancho de la banda: la densidad no lo mueve."""
    patron = {**patron_anillos(0, 1), "globos_por_racimo": 3}
    for densidad in ("sencilla", "lujosa"):
        armado = armado_arco_de_patron(
            arco(
                mezcla="clasica",
                densidad=densidad,
                medidas={"ancho_m": 4, "alto_m": 3},
                patron_color=patron,
            )
        )
        assert armado is not None
        assert cast(Mapping[str, object], armado["geometria"])["globosAncho"] == 3


def completados(*estructuras: dict[str, object]) -> list[dict[str, Any]]:
    """Lo que la confirmación pide a la puerta del motor (``completar``), sin pistas de la foto."""
    from app.armado_estructura import ArmadoEstructuraRequest, resolver_armado_estructura

    return cast(
        list[dict[str, Any]],
        resolver_armado_estructura(
            ArmadoEstructuraRequest.model_validate(
                {
                    "context": CONTEXTO,
                    "schema_version": "omoikane-armado-estructura.v1",
                    "accion": "completar",
                    "plan": plan(*estructuras),
                }
            )
        )["armados"],
    )


@pytest.mark.anyio
@pytest.mark.parametrize("densidad", ["sencilla", "media", "lujosa"])
async def test_la_confirmacion_arma_el_arco_de_patron_con_la_receta_del_patron(
    densidad: str,
) -> None:
    """Sin foto, la confirmación usa el ``patron_color`` del plan como pista: la receta del editor y la guía.

    Armaba por el número de colores (la espiral del diseñador) y escribía en el plan un arco distinto del que
    la rejilla de patrón enseñaba y del que el editor y la guía de escena parten (``armado_arco_de_patron``).
    Lo que se cobra cambia al escribirlo: sin él, la fórmula con la rejilla del patrón; con él, el motor.
    """
    secuencia = (1, 0, 0)
    pieza_plan = arco(
        mezcla="clasica",
        densidad=densidad,
        medidas={"ancho_m": 4, "alto_m": 3},
        patron_color=patron_anillos(*secuencia),
    )
    del_patron = armado_arco_de_patron(pieza_plan)
    assert del_patron is not None and del_patron["patron"] != "espiral"
    (completado,) = completados(pieza_plan)
    assert completado["clave"] == "armado_arco"
    assert completado["armado"] == del_patron

    sin_armado = await resolver(plan(pieza_plan))
    assert "armados_arco" not in sin_armado
    assert contar_pieza(pieza_plan).fuente == "formula"
    con_armado = estructura(
        await resolver(plan({**pieza_plan, "armado_arco": completado["armado"]})), ARCO
    )
    del_motor = armado_arco_resuelto(
        EstructuraArco(es_arco=True, materiales=COLORES_ARCO), del_patron, MERMA
    )
    assert unidades_por_tamano_y_color(con_armado) == conteo_del_motor(del_motor, COLORES_ARCO)


def test_un_arco_asimetrico_lo_arma_el_organico_con_las_patas_distintas() -> None:
    """``arco_asimetrico`` es la forma lista ``asimetrico`` del orgánico: el arco de patrones solo es simétrico.

    Con mezcla clásica también: el de patrones no tiene una pata distinta de la otra, y antes lo armaba
    simétrico. Las medidas siguen siendo las del plan.
    """
    from app.armado_arco_organico import EstructuraArcoOrganico
    from app.armado_arco_organico import armado_resuelto as armado_arco_organico_resuelto

    lados: dict[str, tuple[int, int]] = {}
    for oficial in ("arco", "arco_asimetrico"):
        (completado,) = completados(arco(estructura_oficial=oficial))
        assert completado["clave"] == "armado_arco_organico"
        forma = cast(Mapping[str, float], completado["armado"]["forma"])
        assert (forma["anchoM"], forma["altoM"]) == (3, 2.4)
        globos = cast(
            list[Mapping[str, float]],
            armado_arco_organico_resuelto(
                EstructuraArcoOrganico(es_arco=True, materiales=list(COLORES_ARCO)),
                completado["armado"],
                MERMA,
            )["globos"],
        )
        centro = sum(g["x"] for g in globos) / len(globos)
        lados[oficial] = (
            sum(1 for g in globos if g["x"] < centro),
            sum(1 for g in globos if g["x"] >= centro),
        )
        if oficial == "arco_asimetrico":
            assert forma["corte"] < 1, "una pata termina antes del suelo"
    izquierda, derecha = lados["arco_asimetrico"]
    assert abs(izquierda - derecha) > abs(lados["arco"][0] - lados["arco"][1])

    clasico = arco(
        mezcla="clasica", estructura_oficial="arco_asimetrico", patron_color=patron_anillos(0, 1)
    )
    assert armado_arco_de_patron(clasico) is None
    (completado,) = completados(clasico)
    assert completado["clave"] == "armado_arco_organico"
    assert cast(Mapping[str, float], completado["armado"]["forma"])["corte"] < 1


def test_la_densidad_del_arco_organico_es_el_estilo_del_disenador() -> None:
    """Sencilla y lujosa son los estilos «ligero» y «lleno» del diseñador; media, el volumen de siempre."""
    from app.organico.tipos import config_inicial as config_inicial_organico

    relleno = {}
    for densidad in ("sencilla", "media", "lujosa"):
        (completado,) = completados(arco(densidad=densidad))
        relleno[densidad] = cast(Mapping[str, float], completado["armado"]["volumen"])["relleno"]
    assert relleno == {
        "sencilla": 0.5,
        "media": config_inicial_organico()["volumen"]["relleno"],
        "lujosa": 0.9,
    }


@pytest.mark.anyio
async def test_lo_que_no_es_un_arco_clasico_de_patron_sigue_en_su_camino() -> None:
    patron = patron_anillos(0, 1)
    # Mezcla orgánica: la arma el otro motor solo cuando trae su armado; sin él, la fórmula.
    organico = arco(patron_color=patron)
    # Un aro se construye con tipo arco, pero ningún motor hace un aro.
    aro = arco(mezcla="clasica", estructura_oficial="aro_circular", patron_color=patron)
    # Con su propio armado manda ese armado, no la receta.
    propio = arco(mezcla="clasica", patron_color=patron, armado_arco=armado_arco())
    assert armado_arco_de_patron(organico) is None
    assert armado_arco_de_patron(propio) is None
    assert pieza_del_motor_resuelta(aro) is None
    for pieza_plan in (organico, aro):
        assert "armados_arco" not in await resolver(plan(pieza_plan))
    con_su_armado = await resolver(plan(propio))
    del_motor = armado_arco_resuelto(
        EstructuraArco(es_arco=True, materiales=COLORES_ARCO), armado_arco(), MERMA
    )
    assert estructura(con_su_armado, ARCO)["total_unidades"] == len(
        cast(list[object], del_motor["globos"])
    )


@pytest.mark.anyio
async def test_una_columna_con_armado_cuenta_los_globos_que_el_motor_coloco() -> None:
    """El eje es la altura total del motor, remate incluido; la compra, también con su remate.

    El remate es un globo aparte que la hoja de armado describe en su ``remate``. Hasta el 2026-10-06 no se
    compraba: el globo de 24" se describía en el prompt y la puerta de coherencia («diámetro no cotizado»)
    dejaba sin imagen a toda columna clásica (Fase 7). Ahora se compra.
    """
    armado = armado_columna()
    del_motor = armado_columna_resuelto(
        EstructuraColumna(es_columna=True, materiales=COLORES_COLUMNA), armado
    )
    resuelto = await resolver(plan(columna(armado_columna=armado)))
    pieza = estructura(resuelto, COLUMNA)

    assert pieza["eje_m"] == round(cast(float, del_motor["alto_total_m"]), 2)
    assert pieza["total_unidades"] == len(cast(list[object], del_motor["globos"])) + globos_del_remate(del_motor)
    assert globos_del_remate(del_motor) == 1, "el remate por defecto es un globo"
    assert unidades_por_tamano_y_color(pieza) == conteo_del_motor(del_motor, COLORES_COLUMNA)
    assert pieza["eje_m"] != 1.6 and pieza["total_unidades"] != 31


@pytest.mark.anyio
async def test_una_columna_por_capas_reparte_cada_tamano_como_el_motor() -> None:
    """Una columna mezcla tamaños, y el reparto por tamaño sale de su conteo."""
    armado = armado_columna(
        modo="capas",
        capas=[
            {"tamano": 18, "materiales": [0, 1, 0, 1]},
            {"tamano": 12, "materiales": [1, 0, 1]},
        ],
    )
    del_motor = armado_columna_resuelto(
        EstructuraColumna(es_columna=True, materiales=COLORES_COLUMNA), armado
    )
    pieza = estructura(await resolver(plan(columna(armado_columna=armado))), COLUMNA)
    comprado = unidades_por_tamano_y_color(pieza)
    assert comprado == conteo_del_motor(del_motor, COLORES_COLUMNA)
    # 12 y 18 de las capas; 24, el globo de remate por defecto (se compra desde el 2026-10-06).
    assert {diametro for diametro, _color in comprado} == {12.0, 18.0, 24.0}


@pytest.mark.anyio
async def test_una_guirnalda_con_armado_cuenta_los_globos_que_el_motor_coloco() -> None:
    """El eje es el largo real de la tira ondulada, más largo que la medida del plan."""
    armado = armado_organico()
    del_motor = armado_organico_resuelto(
        EstructuraGuirnalda(es_guirnalda=True, materiales=COLORES_GUIRNALDA), armado, MERMA
    )
    resuelto = await resolver(plan(guirnalda(armado_guirnalda_organica=armado)))
    pieza = estructura(resuelto, GUIRNALDA)

    assert pieza["eje_m"] == round(cast(float, del_motor["largo_m"]), 2)
    assert pieza["total_unidades"] == len(cast(list[object], del_motor["globos"]))
    assert unidades_por_tamano_y_color(pieza) == conteo_del_motor(del_motor, COLORES_GUIRNALDA)
    # La tira ondulada es más larga que los 2,5 m de la medida, y lleva más globos.
    assert cast(float, pieza["eje_m"]) > 2.5
    assert pieza["total_unidades"] != 48


@pytest.mark.anyio
async def test_los_acabados_del_motor_se_suman_en_la_linea_de_su_material() -> None:
    """El armado dice cómo se ve la pieza; el plan, qué producto la paga.

    El motor separa su conteo por acabado, así que el mismo material en dos
    acabados sale dos veces. Lo que se compra es del material del plan: las dos
    entradas son una sola línea del mismo tamaño y color, no dos repetidas.
    """
    armado = armado_organico(
        colores={
            "paleta": [
                {"material": 0, "peso": 40, "acabado": "mate", "rol": "normal"},
                {"material": 0, "peso": 40, "acabado": "cromado", "rol": "normal"},
            ],
            "reparto": "azar",
            "mezcla": 0.5,
        }
    )
    del_motor = armado_organico_resuelto(
        EstructuraGuirnalda(es_guirnalda=True, materiales=COLORES_GUIRNALDA), armado, MERMA
    )
    acabados = {
        str(entrada["acabado"]) for entrada in cast(list[dict[str, Any]], del_motor["conteo"])
    }
    assert acabados == {"mate", "cromado"}, "el caso solo prueba algo con dos acabados"

    pieza = estructura(await resolver(plan(guirnalda(armado_guirnalda_organica=armado))), GUIRNALDA)
    lineas = cast(list[dict[str, Any]], pieza["lineas"])
    # Un solo material, así que una línea por tamaño y ninguna repetida.
    claves = [(float(linea["diam_pulg"]), str(linea["color"])) for linea in lineas]
    assert len(claves) == len(set(claves))
    assert {color for _diametro, color in claves} == {"rosado"}
    assert unidades_por_tamano_y_color(pieza) == conteo_del_motor(del_motor, COLORES_GUIRNALDA)


@pytest.mark.anyio
async def test_con_los_dos_armados_de_guirnalda_manda_el_del_motor() -> None:
    """ADR-0034: el del motor coloca los globos; el de ADR-0032 los describe.

    El viejo no desaparece —sigue publicando su hoja por partes, con su editor
    vivo— pero deja de decidir cuántos globos lleva la pieza y cuánto mide su
    cuerda: hay un solo largo, el de quien colocó los globos.
    """
    solo_motor = await resolver(plan(guirnalda(armado_guirnalda_organica=armado_organico())))
    solo_partes = await resolver(plan(guirnalda(armado_guirnalda=armado_por_partes())))
    los_dos = await resolver(
        plan(
            guirnalda(
                armado_guirnalda=armado_por_partes(),
                armado_guirnalda_organica=armado_organico(),
            )
        )
    )
    pieza = estructura(los_dos, GUIRNALDA)
    assert (pieza["eje_m"], pieza["total_unidades"]) == (
        estructura(solo_motor, GUIRNALDA)["eje_m"],
        estructura(solo_motor, GUIRNALDA)["total_unidades"],
    )
    assert pieza["lineas"] == estructura(solo_motor, GUIRNALDA)["lineas"]
    assert pieza["total_unidades"] != estructura(solo_partes, GUIRNALDA)["total_unidades"]

    # Y la hoja de ADR-0032 sigue ahí, describiendo la pieza que el motor armó.
    hoja = cast(list[dict[str, Any]], los_dos["armados_guirnalda"])[0]
    assert hoja["globos_por_instancia"] == pieza["total_unidades"]
    assert hoja["largo_cuerda_m"] == pieza["eje_m"]
    assert "armados_guirnalda_organica" in los_dos


@pytest.mark.anyio
async def test_los_adornos_de_la_guirnalda_no_se_cotizan() -> None:
    """El follaje y las flores no están en el catálogo de globos.

    Viajan en el resuelto para que nadie los olvide al montar, pero no son una
    demanda: ni una línea, ni una compra, ni un globo del total.
    """
    armado = armado_organico()
    del_motor = armado_organico_resuelto(
        EstructuraGuirnalda(es_guirnalda=True, materiales=COLORES_GUIRNALDA), armado, MERMA
    )
    resuelto = await resolver(plan(guirnalda(armado_guirnalda_organica=armado)))
    adornos = cast(
        dict[str, int],
        cast(list[dict[str, Any]], resuelto["armados_guirnalda_organica"])[0]["adornos"],
    )
    assert adornos == del_motor["adornos"]
    assert adornos["ramas"] > 0 and adornos["flores"] > 0, (
        "el caso necesita adornos para probar algo"
    )
    # El total es exactamente lo que el motor contó: los adornos no entran.
    pieza = estructura(resuelto, GUIRNALDA)
    assert pieza["total_unidades"] == sum(
        int(entrada["cantidad"]) for entrada in cast(list[dict[str, Any]], del_motor["conteo"])
    )


@pytest.mark.anyio
async def test_el_armado_de_una_pieza_no_toca_la_pieza_de_al_lado() -> None:
    """Una columna sin armado sigue en la fórmula aunque el arco traiga la suya."""
    resuelto = await resolver(plan(arco(armado_arco=armado_arco()), columna()))
    assert estructura(resuelto, COLUMNA)["total_unidades"] == 31
    assert estructura(resuelto, ARCO)["total_unidades"] != 119


@pytest.mark.anyio
async def test_un_armado_de_arco_en_una_columna_no_la_cuenta_con_el_motor() -> None:
    """``armado_arco`` solo cuenta en un arco, y al revés.

    El contrato no impide el cruce, así que la decisión es explícita: una pieza
    que no es la del armado se queda en el camino de siempre en vez de romper
    un plan por un campo que no le corresponde.
    """
    resuelto = await resolver(plan(columna(armado_arco=armado_arco())))
    assert estructura(resuelto, COLUMNA)["total_unidades"] == 31
    assert "armados_arco" not in resuelto


@pytest.mark.anyio
async def test_un_aro_circular_con_armado_de_arco_sigue_contando_con_su_formula() -> None:
    """Una oficial que ningún motor arma se queda en la fórmula, aunque traiga un armado guardado.

    El aro circular se construye con ``tipo`` ``arco`` y ningún motor mira ``estructura_oficial``, así que un
    ``armado_arco`` guardado antes de la puerta del 2026-10-04 lo contaba y lo publicaba como un arco: la
    banda de un arco donde la pieza es un aro cerrado. Su cifra es la de la fórmula —el eje es la
    circunferencia, ``x-geometria-estructuras-oficiales``—, y es la que se queda.
    """
    aro = arco(estructura_oficial="aro_circular", nombre="Aro circular")

    sin_armado = await resolver(plan(aro))
    con_armado = await resolver(plan({**aro, "armado_arco": armado_arco()}))

    pieza = estructura(con_armado, ARCO)
    # 7,54 m es el perímetro del círculo inscrito en 3 × 2,4 m, no los 6,21 m de la banda de un arco.
    assert (pieza["eje_m"], pieza["total_unidades"]) == (7.54, 145)
    assert pieza["total_unidades"] == estructura(sin_armado, ARCO)["total_unidades"]
    assert "armados_arco" not in con_armado, "no hay arco que publicar: la pieza es un aro"


# --- Lo que se publica -------------------------------------------------------------------------


@pytest.mark.anyio
async def test_los_armados_resueltos_se_publican_sin_el_dibujo() -> None:
    """Las tres listas de resueltos, fuera del snapshot y sin el SVG.

    El dibujo son decenas de kB por pieza y se pide aparte a
    ``/api/plan-armado-arco``: meterlo aquí engordaría todas las respuestas.
    """
    armado_de_arco = armado_arco()
    armado_de_columna = armado_columna()
    armado_de_guirnalda = armado_organico()
    resuelto = await resolver(
        plan(
            arco(armado_arco=armado_de_arco),
            columna(armado_columna=armado_de_columna),
            guirnalda(armado_guirnalda_organica=armado_de_guirnalda),
        )
    )
    del_arco = armado_arco_resuelto(
        EstructuraArco(es_arco=True, materiales=COLORES_ARCO), armado_de_arco, MERMA
    )
    del_columna = armado_columna_resuelto(
        EstructuraColumna(es_columna=True, materiales=COLORES_COLUMNA), armado_de_columna
    )
    del_guirnalda = armado_organico_resuelto(
        EstructuraGuirnalda(es_guirnalda=True, materiales=COLORES_GUIRNALDA),
        armado_de_guirnalda,
        MERMA,
    )
    # Las CINCO piezas del motor publican lo que la imagen lee de su armado (ADR-0035, completado el
    # 2026-10-04): derivado, lo escribe la resolucion y no el motor. El resto es exactamente lo que el motor
    # conto. Sin esto el caption solo sabia nombrar la pieza y sus colores, y lo que callaba lo inventaba el
    # LoRA: dos columnas salieron coronadas por un globo gigante que el plan apaga a proposito.
    for lista, suya, cabecera, del_motor in (
        ("armados_arco", ARCO, "ARCH ASSEMBLY", del_arco),
        ("armados_columna", COLUMNA, "COLUMN ASSEMBLY", del_columna),
        ("armados_guirnalda_organica", GUIRNALDA, "GARLAND ASSEMBLY", del_guirnalda),
    ):
        publicado = cast(dict[str, object], cast(list[object], resuelto[lista])[0])
        derivados = {
            clave: publicado.pop(clave)
            for clave in ("estructura_id", "prompt_gemini", "prompt_lora")
        }
        assert [publicado] == [
            {clave: valor for clave, valor in del_motor.items() if clave not in SOLO_DEL_MOTOR}
        ], lista
        assert derivados["estructura_id"] == suya
        assert str(derivados["prompt_gemini"]).startswith(cabecera)
        assert str(derivados["prompt_lora"]).isascii() and str(derivados["prompt_lora"]).strip()
        # Las cifras de cada color (referencia, Pantone, globo inflado) ya no van pegadas a la frase de la
        # pieza: el prompt de Gemini las lleva en un bloque para todas las piezas (2026-10-04, G4).
        gemini = str(derivados["prompt_gemini"])
        assert "Exact colors" not in gemini and "PANTONE" not in gemini, lista
        # Al caption LoRA no llega NADA de eso, y no es un olvido: medido sobre las 345 captions de
        # `data/staging/lora-v007`, su corpus no tiene ni un hexadecimal, ni un «pantone», ni un «pms». Un
        # codigo ahi es una secuencia que el modelo no vio nunca.
        lora = str(derivados["prompt_lora"])
        assert "Sempertex" not in lora and "PANTONE" not in lora, lista
        assert "#" not in lora and "Exact colors" not in lora, lista
    # Fuera del snapshot que firma ``plan_hash``: ni las estructuras ni las
    # compras los llevan dentro.
    listas = {"armados_arco", "armados_columna", "armados_guirnalda_organica"}
    for pieza in cast(list[dict[str, object]], resuelto["estructuras"]):
        assert not listas & set(pieza)


@pytest.mark.anyio
async def test_un_tamano_obligatorio_que_el_armado_no_coloca_sigue_avisando() -> None:
    """La restricción de tamaños es del plan y el armado es de una pieza.

    El armado decide el globo, así que un tamaño obligatorio que no usa no
    cambia el conteo; sigue siendo un aviso visible, como cuando era la mezcla
    la que no podía colocarlo.
    """
    con_tamanos = plan(arco(armado_arco=armado_arco()))
    con_tamanos["restricciones"] = {
        "estructuras": [],
        "colores": [],
        "acabados": [],
        "tamanos": [
            {
                "valor": "R-24",
                "polaridad": "obligatorio",
                "procedencia": "explicito",
                "texto_original": "solo globos R-24",
            }
        ],
    }
    resuelto = await resolver(con_tamanos)
    assert f"tamano_obligatorio_sin_ubicar:{ARCO}:R-24" in cast(list[str], resuelto["advertencias"])
    assert {
        float(linea["diam_pulg"])
        for linea in cast(list[dict[str, Any]], estructura(resuelto, ARCO)["lineas"])
    } == {12.0}


# --- Un armado que no se sostiene rompe el plan ------------------------------------------------


@pytest.mark.anyio
async def test_un_armado_de_arco_que_nombra_un_color_que_el_arco_no_lleva_rompe_el_plan() -> None:
    malo = armado_arco(materiales=[0, 2])
    with pytest.raises(PlanResolutionError) as error:
        await resolver(plan(arco(armado_arco=malo)))
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    detalles = cast(dict[str, object], error.value.details)
    assert (detalles["estructura_id"], detalles["motivo"]) == (ARCO, "material_fuera_de_rango")


@pytest.mark.anyio
async def test_un_armado_de_columna_que_nombra_un_color_que_no_lleva_rompe_el_plan() -> None:
    malo = armado_columna(materiales=[0, 3])
    with pytest.raises(PlanResolutionError) as error:
        await resolver(plan(columna(armado_columna=malo)))
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    detalles = cast(dict[str, object], error.value.details)
    assert (detalles["estructura_id"], detalles["motivo"]) == (COLUMNA, "material_fuera_de_rango")


@pytest.mark.anyio
async def test_un_armado_de_guirnalda_que_nombra_un_color_que_no_lleva_rompe_el_plan() -> None:
    malo = armado_organico(
        colores={
            "paleta": [
                {"material": 0, "peso": 40, "acabado": "mate", "rol": "normal"},
                {"material": 4, "peso": 40, "acabado": "mate", "rol": "normal"},
            ],
            "reparto": "azar",
            "mezcla": 0.5,
        }
    )
    with pytest.raises(PlanResolutionError) as error:
        await resolver(plan(guirnalda(armado_guirnalda_organica=malo)))
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    detalles = cast(dict[str, object], error.value.details)
    assert (detalles["estructura_id"], detalles["motivo"]) == (GUIRNALDA, "material_fuera_de_rango")


@pytest.mark.anyio
async def test_un_remate_de_columna_de_un_color_que_no_lleva_rompe_el_plan() -> None:
    """El remate también nombra un material de la pieza, y también se valida."""
    malo = armado_columna(
        remate={"tipo": "globo", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 7}
    )
    with pytest.raises(PlanResolutionError) as error:
        await resolver(plan(columna(armado_columna=malo)))
    assert error.value.code == "armado_invalido"
    assert cast(dict[str, object], error.value.details)["motivo"] == "material_fuera_de_rango"


@pytest.mark.anyio
async def test_la_guirnalda_armada_le_cuenta_su_linea_a_los_modelos_de_imagen() -> None:
    """ADR-0035, extendido a la guirnalda del motor orgánico (2026-10-03).

    Sin esto el caption del LoRA solo sabía decir «an organic balloon garland ... against the rear wall», y
    en el vocabulario de v004 esa es la frase del arco («organic balloon garland arch») a una palabra: la
    imagen salía como un arco de pie con dos patas en el piso. La decisión 28 de ADR-0032 ya había anotado el
    mismo fallo y su cura, pero su frase solo viaja con el armado de ADR-0032, detrás de una bandera apagada.

    La frase es **derivada**: viaja fuera del snapshot, así que no mueve `plan_hash`. Lo que se prueba aquí
    es que llega, que dice la línea que el motor armó y que no nombra un arco ni patas, nunca su redacción
    exacta palabra por palabra.
    """
    armado = armado_organico()
    forma = cast(dict[str, Any], armado["forma"])
    # Alta en la pared, arqueada hacia arriba y con el extremo derecho más bajo: la pieza de la foto.
    armado = {
        **armado,
        "forma": {**forma, "alturaM": 2.2, "colgadoM": -0.25, "pendienteM": -0.6},
    }
    resuelto = await resolver(plan(guirnalda(armado_guirnalda_organica=armado)))
    hoja = cast(list[dict[str, Any]], resuelto["armados_guirnalda_organica"])[0]

    assert hoja["estructura_id"] == GUIRNALDA
    lora = cast(str, hoja["prompt_lora"])
    gemini = cast(str, hoja["prompt_gemini"])

    # El soporte, la curva, el desnivel y el racimo, en el vocabulario de la decisión 28.
    assert "mounted flat high on the wall" in lora
    assert "curving gently upward along the top" in lora
    assert "higher on the left and lower at the right end" in lora
    assert "both ends free" in lora
    # Lo que el LoRA no puede leer: un arco, patas o soportes, y cifras.
    assert not re.search(r"\barch(es)?\b|\bstands?\b|\blegs?\b|\bframe\b", lora), lora
    assert lora.isascii() and not any(c.isdigit() for c in lora), lora
    # No empieza por el sustantivo: es un modificador de la guirnalda que el caption ya nombró.
    assert not lora.lower().startswith(("a ", "an ")), lora

    # Gemini sí lee cifras, y le toca además el cierre contra las patas.
    assert "GARLAND ASSEMBLY" in gemini
    assert "0.6 m lower" in gemini, gemini
    assert "no stands, no legs, no poles and no frame reaching the floor" in gemini

    # En el piso no hay extremos en alto ni cierre contra las patas.
    en_piso = await resolver(
        plan(
            guirnalda(
                armado_guirnalda_organica={
                    **armado,
                    "forma": {**cast(dict[str, Any], armado["forma"]), "alturaM": 0.0},
                }
            )
        )
    )
    piso = cast(list[dict[str, Any]], en_piso["armados_guirnalda_organica"])[0]
    assert "resting on the floor along the front" in cast(str, piso["prompt_lora"])
    assert "both ends free" not in cast(str, piso["prompt_lora"])
    assert "no stands, no legs" not in cast(str, piso["prompt_gemini"])

    # Derivada: vive en la hoja publicada y **no** dentro de la estructura, que es lo que firma `plan_hash`.
    del_plan = cast(list[dict[str, Any]], resuelto["estructuras"])[0]
    assert "prompt_lora" not in cast(
        dict[str, Any], del_plan.get("armado_guirnalda_organica") or {}
    )
    assert "armados_guirnalda_organica" not in del_plan


@pytest.mark.anyio
async def test_el_arco_organico_tambien_publica_su_hoja() -> None:
    """Estaba en `_ARMADOS_DEL_MOTOR` y en el contrato, y la resolucion no lo pedia (2026-10-04).

    El motor lo contaba —las medidas y los globos del plan salian de el— pero su hoja resuelta no llegaba a
    `plan_resuelto`: ni cada globo colocado, ni la compra, ni los avisos, ni el dibujo del editor. Las otras
    cuatro piezas con motor si se publicaban. Portar no es cablear.
    """
    # La receta del motor para un arco organico, pedida a su propia puerta: este archivo no tiene fixture
    # suya y copiarla a mano seria inventar un armado que el motor no firma.
    from app.armado_estructura import ArmadoEstructuraRequest, resolver_armado_estructura

    base = plan(arco())
    recetado = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(
            ArmadoEstructuraRequest.model_validate(
                {
                    "context": CONTEXTO,
                    "schema_version": "omoikane-armado-estructura.v1",
                    "accion": "completar",
                    "plan": {
                        **base,
                        "estructuras": [
                            {**e, "mezcla": "organica_gruesa"}
                            for e in cast(list[dict[str, Any]], base["estructuras"])
                        ],
                    },
                }
            )
        )["armados"],
    )
    assert recetado[0]["clave"] == "armado_arco_organico"
    armado = cast(dict[str, Any], recetado[0]["armado"])
    resuelto = await resolver(plan(arco(mezcla="organica_gruesa", armado_arco_organico=armado)))
    hoja = cast(list[dict[str, Any]], resuelto["armados_arco_organico"])[0]
    assert len(cast(list[object], hoja["globos"])) > 0, (
        "la hoja trae los globos que el motor coloco"
    )
    # Fuera del snapshot que firma `plan_hash`, como las otras cuatro.
    for pieza in cast(list[dict[str, object]], resuelto["estructuras"]):
        assert "armados_arco_organico" not in pieza


@pytest.mark.anyio
async def test_un_semiarco_cuenta_y_publica_como_arco_organico() -> None:
    """Un medio arco es el arco orgánico con `forma.corte` menor que 1, y nada más (2026-10-04).

    El tipo `semiarco` del plan no tenía motor: `_structure_count` lo nombraba entre las piezas que cuenta
    la fórmula y `_armado_del_motor` solo aceptaba `arco_organico` sobre un `arco`, así que un medio arco se
    cobraba a ojo y se dibujaba con la rejilla de patrones del arco completo. Aquí se comprueban las dos
    puntas del cableado: que el motor lo cuenta (la hoja trae sus globos colocados) y que la frase derivada
    que lee la imagen dice que **no** apoya las dos patas en el suelo.

    Como el armado vive dentro de `estructuras`, esto **mueve el `plan_hash`** de un plan con medio arco. Es
    inherente a la capacidad nueva, igual que cuando se cableó el arco orgánico: antes la pieza no tenía
    armado ninguno.
    """
    from app.armado_estructura import ArmadoEstructuraRequest, resolver_armado_estructura

    def medio(**extra: object) -> dict[str, object]:
        return arco(
            estructura_id="EST_01_SEMIARCO",
            nombre="Semiarco",
            tipo="semiarco",
            estructura_oficial="semiarco",
            **extra,
        )

    # La receta se la pide su propia puerta: el armado de un medio arco lo firma el motor, no este archivo.
    # Y se pide con la mezcla `clasica` a propósito: un semiarco es orgánico pase lo que pase.
    recetado = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(
            ArmadoEstructuraRequest.model_validate(
                {
                    "context": CONTEXTO,
                    "schema_version": "omoikane-armado-estructura.v1",
                    "accion": "completar",
                    "plan": plan(medio(mezcla="clasica")),
                }
            )
        )["armados"],
    )
    assert recetado[0]["tipo"] == "semiarco"
    assert recetado[0]["clave"] == "armado_arco_organico"
    armado = cast(dict[str, Any], recetado[0]["armado"])
    assert cast(dict[str, Any], armado["forma"])["corte"] < 1

    resuelto = await resolver(plan(medio(mezcla="clasica", armado_arco_organico=armado)))
    hoja = cast(list[dict[str, Any]], resuelto["armados_arco_organico"])[0]
    assert hoja["estructura_id"] == "EST_01_SEMIARCO"
    assert len(cast(list[object], hoja["globos"])) > 0, (
        "la hoja del medio arco trae los globos que el motor coloco"
    )
    # Las dos frases derivadas (ADR-0035) salen con la pieza y dicen que es medio arco.
    assert "on both legs" not in cast(str, hoja["prompt_gemini"])
    assert "free in the air" in cast(str, hoja["prompt_gemini"])
    assert "free in the air" in cast(str, hoja["prompt_lora"])
    # El conteo de la pieza es el del motor y no el de la fórmula: coincide con los globos colocados.
    pieza = cast(list[dict[str, Any]], resuelto["estructuras"])[0]
    assert pieza["total_unidades"] == len(cast(list[object], hoja["globos"]))
    # Y la hoja vive fuera del snapshot que firma `plan_hash`, como las otras cinco.
    assert "armados_arco_organico" not in pieza
