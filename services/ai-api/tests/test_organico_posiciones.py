"""Dónde va cada cosa en las piezas orgánicas (guirnalda, arco y medio arco, columna) cuando la foto lo leyó.

El caso que lo abrió (2026-10-05): «el mismo problema que con los colores, pero con las posiciones». La lectura de la
foto ya decía dónde iba cada color y la receta lo perdía:

- unos bloques blanco | dorado | blanco salían de blanco a dorado (globos por quinto del largo: blanco
  [16, 22, 14, 1, 0], dorado [0, 0, 5, 13, 18]): la lista de colores se quedaba sin repetidos y sin el espejo, y
  un dorado leído en el centro acababa en un extremo;
- el difuminado era siempre 0,5, así que unos bloques y un degradé salían iguales;
- los globos por racimo leídos no llegaban al motor;
- una guirnalda de piso o de mesa se armaba y se contaba como una de pared, a 2,2 m;
- el desnivel de los extremos que leía la foto no llegaba (regresión del arreglo del 2026-09-28);
- un medio arco derecho ponía la pata gruesa y los globos grandes en su punta libre.

Y la regla que no se mueve: **una pieza sin lectura de la foto sale igual que antes**, porque es lo que la
confirmación sin foto le escribe y, ya guardado, lo que cuenta y firma la resolución: un cambio ahí movería el conteo
y el ``plan_hash`` de los planes nuevos. (Del 2026-10-04 al 2026-10-05 la resolución contaba además con esta receta
las guirnaldas orgánicas sin armado; el dueño lo revirtió el 2026-10-05 y hoy esas las cuenta la fórmula.) Esa parte
se comprueba contra lo que armaba el código anterior (abajo, ``ANTES``).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest

from app.armado_estructura import (
    ALTURA_MESA_M,
    OMOIKANE_ARMADO_SCOPE,
    ArmadoEstructuraRequest,
    PiezaArmado,
    _receta,
    armado_guirnalda_de_receta,
    completar,
)
from app.armado_guirnalda import geometria_de_lectura, linea_de_lectura, linea_del_motor
from app.armado_guirnalda_organica import _config_desde_armado
from app.armado_guirnalda_organica_prompt import frases_guirnalda_organica
from app.armado_arco_organico_prompt import frases_arco_organico
from app.armado_columna_organica_prompt import frases_columna_organica
from app.guirnalda.formas import FORMAS_GUIRNALDA
from app.guirnalda.motor import disposicion_guir
from app.patron_de_la_foto import RACIMO_MAX_MOTOR, RACIMO_MIN_MOTOR
from app.plan import pieza_del_motor_resuelta

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000d5",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffff5",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [OMOIKANE_ARMADO_SCOPE],
    "body_sha256": hashlib.sha256(b"organico-posiciones").hexdigest(),
}
ELEMENTO = "REF_01_E01"


def material(
    color: str, participacion: float, principal: bool = False, acabado: str | None = None
) -> dict[str, object]:
    return {
        "product_id": f"prod-{color}",
        "color": color,
        "participacion": participacion,
        "rol_material": "principal" if principal else "secundario",
        **({"acabado": acabado} if acabado else {}),
    }


TRES = [
    material("rosado", 0.5, principal=True),
    material("blanco", 0.3),
    material("dorado", 0.2, acabado="cromado"),
]
BLANCO_DORADO = [material("blanco", 0.6, principal=True), material("dorado", 0.4)]


def pieza(
    estructura_id: str,
    tipo: str,
    oficial: str,
    ubicacion: str,
    medidas: dict[str, float],
    mezcla: str = "organica_fina",
    densidad: str = "media",
    materiales: Sequence[dict[str, object]] = TRES,
    **extra: object,
) -> dict[str, object]:
    return {
        "estructura_id": estructura_id,
        "nombre": "Pieza",
        "tipo": tipo,
        "estructura_oficial": oficial,
        "rol_escena": "focal",
        "ubicacion": ubicacion,
        "medidas": medidas,
        "repeticiones": 1,
        "densidad": densidad,
        "mezcla": mezcla,
        "materiales": list(materiales),
        "porque": "Pieza de prueba.",
        **extra,
    }


def completados(
    estructuras: Sequence[dict[str, object]], **lecturas: object
) -> list[dict[str, Any]]:
    peticion = ArmadoEstructuraRequest.model_validate(
        {
            "context": CONTEXTO,
            "schema_version": "omoikane-armado-estructura.v1",
            "accion": "completar",
            "plan": {"estructuras": list(estructuras)},
            **lecturas,
        }
    )
    return cast(list[dict[str, Any]], completar(peticion)["armados"])


def resuelta(estructura: Mapping[str, object], salida: Mapping[str, Any]) -> dict[str, Any]:
    """La pieza armada por la misma puerta que la cuenta y la cotiza (``plan.pieza_del_motor_resuelta``)."""
    del_motor = pieza_del_motor_resuelta({**estructura, salida["clave"]: salida["armado"]})
    assert del_motor is not None
    return cast(dict[str, Any], del_motor[1])


def por_quintos(globos: Sequence[Mapping[str, Any]], eje: str = "x") -> dict[int, list[int]]:
    """Globos de cada material por quinto de la pieza a lo largo de ``eje`` (de izquierda a derecha, o de abajo arriba)."""
    valores = [float(globo[eje]) for globo in globos]
    desde, hasta = min(valores), max(valores)
    filas: dict[int, list[int]] = {}
    for globo, valor in zip(globos, valores, strict=True):
        quinto = min(4, int(5 * (valor - desde) / (hasta - desde)))
        filas.setdefault(int(globo["material"]), [0] * 5)[quinto] += 1
    return filas


def pesos_por_material(armado: Mapping[str, Any]) -> dict[int, float]:
    total: dict[int, float] = {}
    for color in cast(list[dict[str, Any]], armado["colores"]["paleta"]):
        total[color["material"]] = total.get(color["material"], 0.0) + float(color["peso"])
    return total


def pista(modo: str, colores: list[str], **extra: object) -> dict[str, object]:
    return {
        "referencia_element_id": ELEMENTO,
        "modo": modo,
        "colores": colores,
        "confianza": 0.9,
        **extra,
    }


def guirnalda_leida(
    lectura: dict[str, object],
    ubicacion: str = "fondo_pared",
    materiales: Sequence[dict[str, object]] = BLANCO_DORADO,
    largo: float = 3.0,
) -> tuple[dict[str, object], dict[str, Any]]:
    estructura = pieza(
        "EST_01_GUIRNALDA",
        "guirnalda",
        "guirnalda",
        ubicacion,
        {"largo_m": largo},
        materiales=materiales,
        referencia_element_id=ELEMENTO,
    )
    [salida] = completados([estructura], **lectura)
    return estructura, salida


# --- Sin lectura, lo de antes ---------------------------------------------------------------------

#: Lo que armaba la receta **antes de este cambio** (``main`` 1b7c29b), sin ninguna lectura de la foto: el
#: sha256 (16 primeros) del JSON canónico del armado y los globos que el motor le coloca. Capturado con el código
#: anterior, no con el que se prueba; es un oráculo congelado: si cambia, cambió lo que se cobra de una pieza sin
#: lectura y eso no es de este frente. La guirnalda de piso (G2) da el mismo armado que la de pared (G1): sin
#: lectura la ubicación no mueve la línea. El medio arco derecho no está: su carga se arregló a propósito (abajo).
ANTES: dict[str, tuple[str, int]] = {
    "G1": ("98ee234ccdc7fe3e", 89),
    "G2": ("98ee234ccdc7fe3e", 89),
    "G3": ("eaf758a27d125590", 200),
    "G4": ("7e4732eb3a5bfdc8", 69),
    "G5": ("24e7cd4fc995f3ee", 97),
    "A1": ("02f83ae5e0c4a4c1", 263),
    "A2": ("6fa4462deba0a64b", 101),
    "C1": ("33e253ae9a817a81", 89),
    "S1": ("be5e4fc2f92f15d2", 61),
}

SIN_LECTURA = [
    pieza("G1", "guirnalda", "guirnalda", "fondo_pared", {"largo_m": 3}),
    pieza("G2", "guirnalda", "guirnalda", "piso_frontal", {"largo_m": 3}),
    pieza(
        "G3", "guirnalda", "guirnalda", "sobre_mesa_principal", {"largo_m": 2.4}, densidad="lujosa"
    ),
    pieza("G4", "guirnalda", "guirnalda", "fondo_pared", {"largo_m": 4}, densidad="sencilla"),
    pieza(
        "G5",
        "guirnalda",
        "guirnalda",
        "fondo_pared",
        {"largo_m": 3},
        armado_guirnalda={
            "version": "armado-guirnalda.v1",
            "origen": "sugerido",
            "soporte": "pared",
            "forma": "curva",
            "arqueo_m": 0.3,
            "desnivel_m": -0.5,
            "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
            "relleno": None,
            "remates": [],
        },
    ),
    pieza("A1", "arco", "arco", "arco_central", {"ancho_m": 3, "alto_m": 2.4}),
    pieza(
        "A2",
        "arco",
        "arco_asimetrico",
        "arco_central",
        {"ancho_m": 3, "alto_m": 2.4},
        mezcla="organica_gruesa",
    ),
    pieza("C1", "columna", "columna", "lateral_izquierdo", {"alto_m": 2.0}),
    pieza("S1", "semiarco", "semiarco", "lateral_izquierdo", {"ancho_m": 1.2, "alto_m": 2.2}),
]


def _huella(armado: Mapping[str, Any]) -> str:
    texto = json.dumps(armado, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(texto.encode()).hexdigest()[:16]


@pytest.mark.parametrize("estructura", SIN_LECTURA, ids=lambda e: str(e["estructura_id"]))
def test_sin_lectura_la_receta_arma_cuenta_y_firma_lo_de_antes(
    estructura: dict[str, object],
) -> None:
    """El mismo armado (byte a byte) y los mismos globos que antes, por las dos puertas de la receta.

    ``completar`` es lo que se escribe al confirmar; ``armado_guirnalda_de_receta`` es la misma receta fuera de la
    confirmación. Mismo armado y mismos globos es mismo conteo, misma compra y mismo ``plan_hash`` una vez
    guardado (sin armado guardado, la guirnalda la cuenta la fórmula).
    """
    [salida] = completados([estructura])
    huella, globos = ANTES[str(estructura["estructura_id"])]
    assert salida["origen"] == "receta"
    assert _huella(salida["armado"]) == huella, salida["armado"]
    assert len(resuelta(estructura, salida)["globos"]) == globos
    if estructura["tipo"] == "guirnalda":
        assert armado_guirnalda_de_receta(estructura) == salida["armado"]


# --- Los colores donde la foto los vio ------------------------------------------------------------


def test_bloques_con_un_color_repetido_van_en_su_sitio_y_compran_lo_declarado() -> None:
    """Blanco | dorado | blanco: dos tramos de blanco en los extremos, el dorado en el centro."""
    estructura, salida = guirnalda_leida(
        {
            "pistas": [
                pista("bloques", ["blanco", "dorado", "blanco"], pesos=[30, 40, 30]),
            ]
        }
    )
    armado = salida["armado"]
    assert salida["origen"] == "referencia"
    assert [(c["material"], c["peso"], c["rol"]) for c in armado["colores"]["paleta"]] == [
        (0, 30.0, "normal"),
        (1, 40.0, "normal"),
        (0, 30.0, "normal"),
    ]
    assert armado["colores"]["reparto"] == "tramos"
    assert armado["colores"]["mezcla"] == pytest.approx(0.05)
    # Lo que se compra de cada color sigue siendo lo que el plan declara (60 / 40).
    assert pesos_por_material(armado) == {0: 60.0, 1: 40.0}
    quintos = por_quintos(resuelta(estructura, salida)["globos"])
    blanco, dorado = quintos[0], quintos.get(1, [0] * 5)
    assert blanco[0] > dorado[0] and blanco[4] > dorado[4], quintos
    assert dorado[2] > blanco[2], quintos


def test_el_degradado_en_espejo_vuelve_al_color_del_comienzo_y_se_funde() -> None:
    _estructura, salida = guirnalda_leida(
        {"pistas": [pista("degradado", ["blanco", "dorado"], simetria="espejo")]},
        materiales=[material("blanco", 0.5, principal=True), material("dorado", 0.5)],
    )
    colores = salida["armado"]["colores"]
    assert [(c["material"], c["peso"]) for c in colores["paleta"]] == [
        (0, 25.0),
        (1, 50.0),
        (0, 25.0),
    ]
    assert colores["mezcla"] == pytest.approx(0.9)


@pytest.mark.parametrize(
    ("ancla", "quinto_del_dorado"),
    [("centro", 2), ("media_derecha", 4), ("superior_izquierda", 0)],
)
def test_una_mancha_de_zonas_cae_en_su_ancla(ancla: str, quinto_del_dorado: int) -> None:
    estructura, salida = guirnalda_leida(
        {
            "pistas": [
                pista(
                    "zonas",
                    ["blanco"],
                    zonas=[{"color": "dorado", "ancla": ancla, "extension": 25}],
                )
            ]
        },
        materiales=[material("blanco", 0.75, principal=True), material("dorado", 0.25)],
    )
    armado = salida["armado"]
    assert pesos_por_material(armado) == pytest.approx({0: 75.0, 1: 25.0})
    dorado = por_quintos(resuelta(estructura, salida)["globos"])[1]
    assert max(range(5), key=lambda quinto: dorado[quinto]) == quinto_del_dorado, dorado


def test_un_color_que_la_foto_no_pone_en_ningun_tramo_va_de_acento() -> None:
    """Antes iba de tramo al final: un tercer color pintaba un extremo que la foto no tiene."""
    estructura, salida = guirnalda_leida(
        {"pistas": [pista("bloques", ["blanco", "dorado"])]},
        materiales=[
            material("blanco", 0.45, principal=True),
            material("dorado", 0.35),
            material("rosado", 0.2),
        ],
    )
    paleta = salida["armado"]["colores"]["paleta"]
    assert [(c["material"], c["rol"]) for c in paleta] == [
        (0, "normal"),
        (1, "normal"),
        (2, "acento"),
    ]
    rosado = por_quintos(resuelta(estructura, salida)["globos"])[2]
    assert all(cuantos > 0 for cuantos in rosado), rosado


@pytest.mark.parametrize(
    ("modo", "colores", "mezcla"),
    [
        ("bloques", ["blanco", "dorado"], 0.05),
        ("zonas", ["blanco"], 0.05),
        ("degradado", ["blanco", "dorado"], 0.9),
        ("anillos", ["blanco", "dorado"], 0.0),
        ("aleatorio", ["blanco", "dorado"], 0.5),
    ],
)
def test_el_difuminado_es_el_del_modo_leido(modo: str, colores: list[str], mezcla: float) -> None:
    extra: dict[str, object] = (
        {"zonas": [{"color": "dorado", "ancla": "centro", "extension": 20}]}
        if modo == "zonas"
        else {}
    )
    _estructura, salida = guirnalda_leida({"pistas": [pista(modo, colores, **extra)]})
    assert salida["armado"]["colores"]["mezcla"] == pytest.approx(mezcla)


def test_demasiados_tramos_vuelven_al_orden_de_la_foto_con_aviso() -> None:
    alternados = ["blanco", "dorado"] * 5
    _estructura, salida = guirnalda_leida({"pistas": [pista("bloques", alternados)]})
    assert len(salida["armado"]["colores"]["paleta"]) == 2
    assert any("tramos de color" in aviso for aviso in salida["avisos"]), salida["avisos"]


def test_un_patron_a_lo_ancho_no_se_inventa_tramos_a_lo_largo() -> None:
    _estructura, salida = guirnalda_leida(
        {
            "pistas": [
                pista("bloques", ["blanco", "dorado", "blanco"], direccion="transversal"),
            ]
        }
    )
    assert len(salida["armado"]["colores"]["paleta"]) == 2
    assert any("a lo ancho" in aviso for aviso in salida["avisos"]), salida["avisos"]


# --- Los globos por racimo -------------------------------------------------------------------------


@pytest.mark.parametrize(("leidos", "armados"), [(3, 3), (5, 5), (1, 2), (8, 6)])
def test_los_globos_por_racimo_leidos_llegan_acotados_al_motor(leidos: int, armados: int) -> None:
    for estructura in (
        pieza(
            "EST_01_GUIRNALDA",
            "guirnalda",
            "guirnalda",
            "fondo_pared",
            {"largo_m": 3},
            referencia_element_id=ELEMENTO,
        ),
        pieza(
            "EST_02_ARCO",
            "arco",
            "arco",
            "arco_central",
            {"ancho_m": 3, "alto_m": 2.4},
            referencia_element_id=ELEMENTO,
        ),
        pieza(
            "EST_03_COLUMNA",
            "columna",
            "columna",
            "lateral_izquierdo",
            {"alto_m": 2.0},
            referencia_element_id=ELEMENTO,
        ),
    ):
        [salida] = completados(
            [estructura],
            pistas=[pista("anillos", ["rosado", "blanco"], globos_por_racimo=leidos)],
        )
        assert salida["armado"]["volumen"]["racimo"] == armados, estructura["tipo"]
        acotado = any("racimos de" in aviso for aviso in salida["avisos"])
        assert acotado == (leidos != armados), salida["avisos"]


def test_el_rango_del_racimo_que_dice_la_frase_es_el_que_arma_el_motor() -> None:
    """«4 balloons per cluster (3 to 5 in each)»: medido sobre la disposición del motor, no supuesto."""
    for racimo in range(RACIMO_MIN_MOTOR, RACIMO_MAX_MOTOR + 1):
        p = PiezaArmado(
            tipo="guirnalda",
            colores=2,
            largo_m=3.0,
            pesos=[0.5, 0.5],
            tonos=["blanco", "dorado"],
            mezcla="organica_fina",
        )
        armado = _receta(p, [], pista("anillos", ["blanco", "dorado"], globos_por_racimo=racimo))
        cfg, _cambios = _config_desde_armado(armado, ["#ffffff", "#d4af37"])
        miembros: dict[int, int] = {}
        for globo in disposicion_guir(cfg).bs:
            miembros[globo.racimo] = miembros.get(globo.racimo, 0) + 1
        de, a = min(miembros.values()), max(miembros.values())
        gemini, _lora = frases_guirnalda_organica(
            armado, {}, [("blanco", "mate"), ("dorado", "mate")]
        )
        assert f"{racimo} balloons per cluster ({de} to {a} in each)" in gemini, (racimo, gemini)


# --- La línea que midió la foto --------------------------------------------------------------------

#: La lectura v4 de la foto del 2026-09-28 (``SEGUIMIENTO-guirnaldas.md``), como la manda ``pistasCurvaDelPlan``.
LINEA_DE_LA_FOTO: dict[str, object] = {
    "referencia_element_id": ELEMENTO,
    "soporte": "pared",
    "forma": "curva",
    "confianza": 0.92,
    "puntos_de_anclaje": 3,
    "sentido": "arriba",
    "flecha": 0.107,
    "desnivel": -0.335,
}


def test_el_desnivel_de_la_foto_llega_al_motor() -> None:
    """La regresión del 2026-09-28: curva hacia arriba 0,107 y el extremo derecho 0,335 del largo más bajo.

    En 3 m eso son 1,01 m de desnivel y el motor no arma más del 25 % del largo (0,75 m): el armado guarda lo
    que se arma, y se dice.
    """
    estructura, salida = guirnalda_leida({"curvas": [LINEA_DE_LA_FOTO]})
    forma = salida["armado"]["forma"]
    assert forma["pendienteM"] == pytest.approx(-0.75)
    assert forma["colgadoM"] == pytest.approx(-0.32)
    assert forma["alturaM"] == pytest.approx(2.2)
    assert any("-1.01" in aviso and "-0.75" in aviso for aviso in salida["avisos"]), salida[
        "avisos"
    ]

    def caida(estructura: Mapping[str, object], salida: Mapping[str, Any]) -> float:
        """Cuánto más alto queda el extremo izquierdo que el derecho (los diez globos de cada punta)."""
        globos = resuelta(estructura, salida)["globos"]
        izquierda = sorted(globos, key=lambda g: g["x"])[:10]
        derecha = sorted(globos, key=lambda g: -g["x"])[:10]
        return (sum(g["y"] for g in izquierda) - sum(g["y"] for g in derecha)) / 10

    # La misma guirnalda con la pista de antes (solo la curva) sale nivelada; con el desnivel, cae a la derecha.
    nivelada = guirnalda_leida(
        {"curvas": [{"referencia_element_id": ELEMENTO, "sentido": "arriba", "flecha": 0.107}]}
    )
    assert abs(caida(*nivelada)) < 0.2, caida(*nivelada)
    assert caida(estructura, salida) > 0.4, caida(estructura, salida)
    gemini, lora = frases_guirnalda_organica(
        salida["armado"], resuelta(estructura, salida), [("blanco", ""), ("dorado", "")]
    )
    # La frase cuenta lo que se armó (0,75 m), no lo que se midió.
    assert "right end hangs about 0.8 m lower" in gemini, gemini
    assert "higher on the left and lower at the right end" in lora, lora


def test_las_dos_guirnaldas_traducen_la_misma_lectura_igual() -> None:
    """Una sola traducción: la línea de la orgánica es la del armado por partes con la misma lectura."""
    lectura = {
        "soporte": "pared",
        "forma": "curva",
        "puntos_de_anclaje": 3,
        "sentido_curva": "arriba",
        "flecha_relativa": 0.107,
        "desnivel_relativo": -0.335,
        "confianza": 0.92,
    }
    por_partes = linea_del_motor({**geometria_de_lectura(lectura, 3.0), "puntos_de_anclaje": 3})
    assert linea_de_lectura(lectura, 3.0) == por_partes == {"pendienteM": -1.01, "colgadoM": -0.32}
    # Una U colgada de tres puntos son dos festones, como en el armado por partes.
    colgada = {
        **lectura,
        "soporte": "colgada",
        "forma": "arco_caido",
        "sentido_curva": "abajo",
        "desnivel_relativo": None,
    }
    assert linea_de_lectura(colgada, 4.0) == {"colgadoM": 0.43, "festones": 2.0}
    # Sin desnivel leído no hay pendiente: un cero pisaría la de otra lectura.
    assert "pendienteM" not in linea_de_lectura({**lectura, "desnivel_relativo": None}, 3.0)
    # Una lectura dudosa no mueve nada.
    assert linea_de_lectura({**lectura, "confianza": 0.4}, 3.0) == {}


def test_una_pista_de_antes_solo_con_sentido_y_flecha_se_lee_como_entonces() -> None:
    _estructura, salida = guirnalda_leida(
        {"curvas": [{"referencia_element_id": ELEMENTO, "sentido": "arriba", "flecha": 0.107}]}
    )
    forma = salida["armado"]["forma"]
    assert forma["colgadoM"] == pytest.approx(-0.32)
    assert forma["pendienteM"] == 0
    assert forma["alturaM"] == pytest.approx(2.2)


def test_una_linea_que_el_motor_no_arma_se_acota_una_vez_y_se_dice() -> None:
    """Un desnivel de 4,2 m en 7 m pasa del contrato (±2 m) y del motor (25 % del largo): queda en 1,75 m."""
    _estructura, salida = guirnalda_leida(
        {"curvas": [{**LINEA_DE_LA_FOTO, "desnivel": -0.6}]}, largo=7.0
    )
    assert salida["armado"]["forma"]["pendienteM"] == pytest.approx(-1.75)
    del_desnivel = [aviso for aviso in salida["avisos"] if "pendienteM" in aviso]
    assert len(del_desnivel) == 1, salida["avisos"]
    # Una U de seis anclajes en 3 m: el motor arma tres festones como mucho, con su colgado.
    _estructura, colgada = guirnalda_leida(
        {
            "curvas": [
                {
                    "referencia_element_id": ELEMENTO,
                    "soporte": "colgada",
                    "forma": "arco_caido",
                    "puntos_de_anclaje": 6,
                    "sentido": "abajo",
                    "flecha": 0.5,
                    "confianza": 0.9,
                }
            ]
        }
    )
    forma = colgada["armado"]["forma"]
    assert (forma["festones"], forma["colgadoM"]) == (3, pytest.approx(0.3))
    assert sum("festones" in aviso or "colgadoM" in aviso for aviso in colgada["avisos"]) == 2


# --- Dónde se apoya la guirnalda -------------------------------------------------------------------

_LINEA_DE_PISO = next(forma for forma in FORMAS_GUIRNALDA if forma.id == "piso").forma


@pytest.mark.parametrize(
    ("ubicacion", "lectura", "altura"),
    [
        # Con una lectura del patrón, la altura sale de la ubicación del plan.
        ("piso_frontal", {"pistas": [pista("aleatorio", ["blanco", "dorado"])]}, "piso"),
        ("sobre_mesa_principal", {"pistas": [pista("aleatorio", ["blanco", "dorado"])]}, "mesa"),
        ("fondo_pared", {"pistas": [pista("aleatorio", ["blanco", "dorado"])]}, "pared"),
        # El soporte que vio la foto manda sobre el del plan.
        (
            "fondo_pared",
            {
                "curvas": [
                    {
                        "referencia_element_id": ELEMENTO,
                        "soporte": "piso",
                        "forma": "recta",
                        "confianza": 0.9,
                    }
                ]
            },
            "piso",
        ),
        # Una lectura dudosa no es una lectura: la guirnalda queda como sin lectura.
        (
            "piso_frontal",
            {
                "curvas": [
                    {
                        "referencia_element_id": ELEMENTO,
                        "soporte": "piso",
                        "forma": "recta",
                        "confianza": 0.3,
                    }
                ]
            },
            "pared",
        ),
    ],
)
def test_con_lectura_la_altura_de_la_linea_es_la_de_su_soporte(
    ubicacion: str, lectura: dict[str, object], altura: str
) -> None:
    estructura, salida = guirnalda_leida(lectura, ubicacion=ubicacion)
    forma = salida["armado"]["forma"]
    esperada = {
        "piso": float(_LINEA_DE_PISO["alturaM"]),
        "mesa": ALTURA_MESA_M,
        "pared": 2.2,
    }[altura]
    assert forma["alturaM"] == pytest.approx(esperada)
    if altura == "piso":
        assert forma["ondaM"] == pytest.approx(float(_LINEA_DE_PISO["ondaM"]))
    gemini, lora = frases_guirnalda_organica(
        salida["armado"], resuelta(estructura, salida), [("blanco", ""), ("dorado", "")]
    )
    soporte = {
        "piso": "resting on the floor along the front",
        "mesa": "running along the table edge",
        "pared": "mounted flat high on the wall",
    }[altura]
    assert lora.startswith(soporte), lora
    # «both ends free» es lo que TypeScript lee para saber que la guirnalda va en alto.
    assert ("both ends free" in lora) == (altura == "pared"), lora
    assert ("no stands, no legs" in gemini) == (altura == "pared"), gemini


# --- Lo que dice la frase de la imagen -------------------------------------------------------------


def _frases_de(
    lectura: dict[str, object], materiales: Sequence[tuple[str, str]]
) -> tuple[str, str]:
    estructura, salida = guirnalda_leida(lectura)
    return frases_guirnalda_organica(salida["armado"], resuelta(estructura, salida), materiales)


def test_la_frase_dice_los_tramos_en_su_orden_y_sus_bordes() -> None:
    gemini, lora = _frases_de(
        {"pistas": [pista("bloques", ["blanco", "dorado", "blanco"], pesos=[30, 40, 30])]},
        [("blanco", "mate"), ("dorado", "cromado")],
    )
    assert "from the left end to the right end: matte white, then" in gemini, gemini
    assert "then matte white, with clean edges between sections." in gemini, gemini
    assert "color-blocked in sections of white, then gold, then white along its length" in lora
    assert lora.isascii() and not any(c.isdigit() for c in lora), lora


def test_la_frase_distingue_el_degradado_los_racimos_y_los_acentos() -> None:
    materiales = [("blanco", "mate"), ("dorado", "mate")]
    degradado, degradado_lora = _frases_de(
        {"pistas": [pista("degradado", ["blanco", "dorado"])]}, materiales
    )
    assert "each blending gradually into the next" in degradado, degradado
    assert "in an ombre gradient from white to gold" in degradado_lora, degradado_lora
    racimos, racimos_lora = _frases_de(
        {"pistas": [pista("anillos", ["blanco", "dorado"])]}, materiales
    )
    assert "Each cluster is a single solid color" in racimos, racimos
    assert "each cluster one solid color" in racimos_lora, racimos_lora
    con_motas, motas_lora = _frases_de(
        {"pistas": [pista("aleatorio", ["blanco"], motas=["dorado"])]}, materiales
    )
    assert "Scatter single matte gold balloons over the whole garland as accents" in con_motas
    assert "with scattered single gold accent balloons" in motas_lora, motas_lora
    # La mezcla pareja no se adorna: es la que el caption ya da por hecha.
    pareja, pareja_lora = _frases_de(
        {"pistas": [pista("aleatorio", ["blanco", "dorado"])]}, materiales
    )
    assert "sections" not in pareja and "single solid color" not in pareja, pareja
    assert pareja_lora.endswith("in clusters of four"), pareja_lora


def test_la_frase_dice_donde_quedaron_los_globos_grandes() -> None:
    """Se mira la pieza armada: con el volumen de partida los grandes no caben en los extremos delgados."""
    estructura, salida = guirnalda_leida({"pistas": [pista("aleatorio", ["blanco", "dorado"])]})
    resuelto = resuelta(estructura, salida)
    grandes = [g for g in resuelto["globos"] if g["tamano"] >= 18]
    assert len(grandes) >= 2, "la mezcla orgánica fina lleva globos de 18 pulgadas"
    gemini, _lora = frases_guirnalda_organica(
        salida["armado"], resuelto, [("blanco", ""), ("dorado", "")]
    )
    assert "The large balloons (18 inches and up) " in gemini, gemini
    # Sin la pieza armada (una frase pedida antes de colocar los globos) no se inventa dónde van.
    sin_globos, _ = frases_guirnalda_organica(
        salida["armado"], {}, [("blanco", ""), ("dorado", "")]
    )
    assert "large balloons" not in sin_globos


# --- El medio arco derecho -------------------------------------------------------------------------


@pytest.mark.parametrize("oficial", ["semiarco", "semiarco_asimetrico"])
def test_el_medio_arco_derecho_carga_su_pata_y_no_su_punta(oficial: str) -> None:
    """La carga se voltea con la pieza: la pata gruesa y los globos grandes van abajo, en el suelo."""
    izquierdo = pieza(
        "EST_01", "semiarco", oficial, "lateral_izquierdo", {"ancho_m": 1.2, "alto_m": 2.2}
    )
    derecho = pieza(
        "EST_02", "semiarco", oficial, "lateral_derecho", {"ancho_m": 1.2, "alto_m": 2.2}
    )
    salida_izquierda, salida_derecha = completados([izquierdo, derecho])
    carga_izquierda = salida_izquierda["armado"]["forma"]["carga"]
    carga_derecha = salida_derecha["armado"]["forma"]["carga"]
    assert carga_izquierda < 0 < carga_derecha
    assert carga_derecha == pytest.approx(-carga_izquierda)
    # Mismo medio arco a cada lado: la misma pieza volteada (el ruido del motor no es simétrico, así que no
    # son los mismos globos, pero sí el mismo ancho del arco completo).
    assert (
        salida_derecha["armado"]["forma"]["anchoM"] == salida_izquierda["armado"]["forma"]["anchoM"]
    )
    globos = resuelta(derecho, salida_derecha)["globos"]
    pata = sorted(globos, key=lambda g: g["y"])[: max(5, len(globos) // 8)]
    grandes = [g for g in globos if g["tamano"] >= 18]
    assert sum(g["x"] for g in pata) / len(pata) > 0, (
        "la pata del medio arco derecho está a la derecha"
    )
    assert sum(g["x"] for g in grandes) / len(grandes) > 0, "y los globos grandes, con ella"
    _gemini, lora = frases_arco_organico(
        salida_derecha["armado"],
        resuelta(derecho, salida_derecha),
        [("rosado", ""), ("blanco", "")],
    )
    assert "heavier and thicker on the right" in lora, lora


def test_con_inclinacion_leida_el_medio_arco_sigue_cargando_su_pata() -> None:
    """La inclinación de un medio arco es hacia su punta; no se lleva allí los globos grandes."""
    for ubicacion, inclinacion, signo in (
        ("lateral_izquierdo", 0.45, -1.0),
        ("lateral_derecho", -0.45, 1.0),
    ):
        estructura = pieza(
            "EST_01",
            "semiarco",
            "semiarco",
            ubicacion,
            {"ancho_m": 1.2, "alto_m": 2.2},
            referencia_element_id=ELEMENTO,
        )
        [salida] = completados(
            [estructura],
            inclinaciones=[{"referencia_element_id": ELEMENTO, "inclinacion": inclinacion}],
        )
        forma = salida["armado"]["forma"]
        assert forma["carga"] * signo > 0, (ubicacion, forma)
        # La cima se corre hacia donde va la pieza, en el medio arco sin voltear.
        assert forma["cima"] == pytest.approx(0.59), (ubicacion, forma)


def test_los_tramos_de_un_medio_arco_volteado_empiezan_en_su_pata() -> None:
    """La foto lee el medio arco desde su pata; el motor recorre el volteado desde su punta."""
    medias: dict[str, dict[int, float]] = {}
    for ubicacion in ("lateral_izquierdo", "lateral_derecho"):
        estructura = pieza(
            "EST_01",
            "semiarco",
            "semiarco",
            ubicacion,
            {"ancho_m": 1.2, "alto_m": 2.2},
            materiales=BLANCO_DORADO,
            referencia_element_id=ELEMENTO,
        )
        [salida] = completados([estructura], pistas=[pista("bloques", ["blanco", "dorado"])])
        globos = resuelta(estructura, salida)["globos"]
        medias[ubicacion] = {
            material: sum(g["x"] for g in globos if g["material"] == material)
            / max(1, sum(1 for g in globos if g["material"] == material))
            for material in (0, 1)
        }
        gemini, lora = frases_arco_organico(
            salida["armado"], resuelta(estructura, salida), [("blanco", ""), ("dorado", "")]
        )
        assert "from its foot up to its free end: white, then gold" in gemini, gemini
        assert "color-blocked in sections of white, then gold from the base to the open tip" in lora
    # El blanco (el primer tramo de la foto) va del lado de la pata en los dos.
    assert medias["lateral_izquierdo"][0] < medias["lateral_izquierdo"][1]
    assert medias["lateral_derecho"][0] > medias["lateral_derecho"][1]


# --- La columna -------------------------------------------------------------------------------------


def test_la_columna_reparte_sus_tramos_de_la_base_a_la_punta() -> None:
    estructura = pieza(
        "EST_01",
        "columna",
        "columna",
        "lateral_izquierdo",
        {"alto_m": 2.2},
        materiales=BLANCO_DORADO,
        referencia_element_id=ELEMENTO,
    )
    [salida] = completados([estructura], pistas=[pista("bloques", ["blanco", "dorado", "blanco"])])
    armado = salida["armado"]
    assert [c["material"] for c in armado["colores"]["paleta"]] == [0, 1, 0]
    assert pesos_por_material(armado) == {0: 60.0, 1: 40.0}
    quintos = por_quintos(resuelta(estructura, salida)["globos"], eje="y")
    blanco, dorado = quintos[0], quintos[1]
    assert blanco[0] > dorado[0] and blanco[4] > dorado[4], quintos
    assert dorado[2] > blanco[2], quintos
    gemini, _lora = frases_columna_organica(
        armado, resuelta(estructura, salida), [("blanco", ""), ("dorado", "")]
    )
    assert "Its colors run in sections from the base to the top: white, then gold, then white" in (
        gemini
    ), gemini


def test_una_paleta_con_un_material_repetido_avisa_su_acabado_una_sola_vez() -> None:
    """Dos tramos del mismo material no repiten el aviso de un acabado que el motor no tiene («perlado»)."""
    con_acabado = [
        material("blanco", 0.6, principal=True, acabado="perlado"),
        material("dorado", 0.4),
    ]
    _estructura, salida = guirnalda_leida(
        {"pistas": [pista("bloques", ["blanco", "dorado", "blanco"])]}, materiales=con_acabado
    )
    assert [c["material"] for c in salida["armado"]["colores"]["paleta"]] == [0, 1, 0]
    del_acabado = [aviso for aviso in salida["avisos"] if "perlado" in aviso]
    assert len(del_acabado) == 1, salida["avisos"]
