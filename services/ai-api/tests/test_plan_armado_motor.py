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

from collections.abc import Mapping
from typing import Any, cast

import pytest

from app.armado_arco import EstructuraArco
from app.armado_arco import armado_resuelto as armado_arco_resuelto
from app.armado_columna import EstructuraColumna
from app.armado_columna import armado_resuelto as armado_columna_resuelto
from app.armado_guirnalda_organica import EstructuraGuirnalda
from app.armado_guirnalda_organica import armado_resuelto as armado_organico_resuelto
from app.plan import MERMA, PlanResolutionError
from tests.guirnalda_datos import GUIRNALDA, guirnalda, material, plan, resolver


ARCO = "EST_01_ARCO"
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


def conteo_del_motor(resuelto_motor: Mapping[str, object], colores: tuple[str, ...]) -> dict[tuple[float, str], int]:
    """El conteo del motor leído como lo lee el plan: por diámetro y color.

    El arco cuenta solo por material porque toda su banda es del mismo globo; la
    columna y la guirnalda cuentan por material y tamaño, y la guirnalda además
    separa por acabado. Aquí se igualan las tres formas —sumando los acabados,
    porque el acabado de lo que se compra lo decide el material del plan— para
    poder comparar con lo que la pieza resuelta compró.
    """
    totales: dict[tuple[float, str], int] = {}
    for entrada in cast(list[dict[str, Any]], resuelto_motor["conteo"]):
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


@pytest.mark.anyio
async def test_una_columna_con_armado_cuenta_los_globos_que_el_motor_coloco() -> None:
    """El eje es la altura total del motor, remate incluido; el conteo, sin remate.

    El remate es un globo aparte que la hoja de armado describe en su ``remate``,
    y por eso no está en el conteo del motor ni en lo que la pieza compra.
    """
    armado = armado_columna()
    del_motor = armado_columna_resuelto(
        EstructuraColumna(es_columna=True, materiales=COLORES_COLUMNA), armado
    )
    resuelto = await resolver(plan(columna(armado_columna=armado)))
    pieza = estructura(resuelto, COLUMNA)

    assert pieza["eje_m"] == round(cast(float, del_motor["alto_total_m"]), 2)
    assert pieza["total_unidades"] == len(cast(list[object], del_motor["globos"]))
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
    assert {diametro for diametro, _color in comprado} == {12.0, 18.0}


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
    acabados = {str(entrada["acabado"]) for entrada in cast(list[dict[str, Any]], del_motor["conteo"])}
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
    assert adornos["ramas"] > 0 and adornos["flores"] > 0, "el caso necesita adornos para probar algo"
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
    assert resuelto["armados_arco"] == [
        {clave: valor for clave, valor in del_arco.items() if clave not in SOLO_DEL_MOTOR}
    ]
    assert resuelto["armados_columna"] == [del_columna]
    assert resuelto["armados_guirnalda_organica"] == [
        {clave: valor for clave, valor in del_guirnalda.items() if clave not in SOLO_DEL_MOTOR}
    ]
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
    assert f"tamano_obligatorio_sin_ubicar:{ARCO}:R-24" in cast(
        list[str], resuelto["advertencias"]
    )
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
