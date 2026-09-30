"""El croquis de un patrón no mueve ni un globo del conteo.

``app.silueta_patron`` reparte el color del patrón sobre las posiciones reales de
la pieza. Lo que se vigila aquí es lo único que no se negocia: las cantidades por
color y por tamaño son exactamente las de la matriz del despiece de ``plan.py``
—el color se reasigna de sitio, nunca de cantidad—, más que la degradación sea
silenciosa y que el dibujo sea determinista.
"""

from __future__ import annotations

import dataclasses
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

import pytest

from app.plan import PlanResolutionRequest, resolve_plan
from app.silueta_patron import (
    MAX_GLOBOS_PIEZA,
    MotivoSinSilueta,
    PiezaSilueta,
    PresupuestoGrafica,
    _disponer_recordado,
    croquis_de_patron,
    pieza_desde_estructura,
)

# Una rejilla de damero de 12 filas × 4 posiciones con dos colores, y la matriz
# tamaño × material que le corresponde: dos tamaños, cuyas filas suman 24 globos
# de cada uno y cuyas columnas suman los 24 globos de cada color. Las dos sumas
# son las que el resolutor compra.
CELDAS_DAMERO: list[list[int]] = [
    [0, 1, 0, 1] if fila % 2 == 0 else [1, 0, 1, 0] for fila in range(12)
]
MATRIZ_DOS_TAMANOS: list[list[int]] = [[14, 10], [10, 14]]
PROPORCIONES_DOS_TAMANOS: list[tuple[int, float]] = [(12, 0.7), (5, 0.3)]

PARED = PiezaSilueta(
    estructura_id="E1", tipo="pared", estructura_oficial="pared_densa", ancho_m=2.0, alto_m=1.5
)
PARED_ORGANICA = PiezaSilueta(
    estructura_id="E2", tipo="pared", estructura_oficial="pared_organica", ancho_m=2.4, alto_m=2.4
)
ARCO = PiezaSilueta(estructura_id="E3", tipo="arco", ancho_m=3.0, alto_m=2.4)
SEMIARCO = PiezaSilueta(estructura_id="E4", tipo="semiarco", ancho_m=1.6, alto_m=2.4)
COLUMNA = PiezaSilueta(estructura_id="E5", tipo="columna", ancho_m=0.45, alto_m=2.2)
GUIRNALDA = PiezaSilueta(
    estructura_id="E6", tipo="guirnalda", largo_m=5.0, forma_guirnalda="curva"
)
GUIRNALDA_COLGADA = PiezaSilueta(
    estructura_id="E7",
    tipo="guirnalda",
    largo_m=6.0,
    forma_guirnalda="u_invertida",
    caida_m=1.2,
    anclajes=2,
)
TODAS = (PARED, PARED_ORGANICA, ARCO, SEMIARCO, COLUMNA, GUIRNALDA, GUIRNALDA_COLGADA)


def _armar(
    pieza: PiezaSilueta,
    celdas: Sequence[Sequence[int]] = tuple(tuple(fila) for fila in CELDAS_DAMERO),
    matriz: Sequence[Sequence[int]] = tuple(tuple(fila) for fila in MATRIZ_DOS_TAMANOS),
    proporciones: Sequence[tuple[int, float]] = tuple(PROPORCIONES_DOS_TAMANOS),
    presupuesto: PresupuestoGrafica | None = None,
    extras: Sequence[tuple[int, int]] = (),
) -> list[dict[str, object]]:
    croquis = croquis_de_patron(pieza, celdas, matriz, proporciones, presupuesto, extras)
    assert croquis.posiciones is not None, f"{pieza.tipo} sin silueta: {croquis.motivo}"
    assert croquis.motivo is None, "un croquis armado no lleva motivo"
    return croquis.posiciones


@pytest.mark.parametrize("pieza", TODAS, ids=[pieza.estructura_id for pieza in TODAS])
def test_cada_color_recibe_exactamente_los_globos_de_la_matriz(pieza: PiezaSilueta) -> None:
    """Las columnas de la matriz son ``conteo_por_instancia``: no se mueven."""
    posiciones = _armar(pieza)
    por_color = Counter(cast(int, posicion["material"]) for posicion in posiciones)
    esperado = {
        material: sum(fila[material] for fila in MATRIZ_DOS_TAMANOS)
        for material in range(len(MATRIZ_DOS_TAMANOS[0]))
    }
    assert dict(por_color) == esperado


@pytest.mark.parametrize("pieza", TODAS, ids=[pieza.estructura_id for pieza in TODAS])
def test_una_posicion_por_globo_cotizado(pieza: PiezaSilueta) -> None:
    total = sum(cantidad for fila in MATRIZ_DOS_TAMANOS for cantidad in fila)
    assert len(_armar(pieza)) == total


def test_un_solo_color_recibe_todos_los_globos() -> None:
    """El caso degenerado: una matriz de una columna no puede repartir de otro modo."""
    celdas = [[0] * 4 for _ in range(6)]
    posiciones = _armar(ARCO, celdas, [[16], [8]], [(12, 0.7), (5, 0.3)])
    assert {posicion["material"] for posicion in posiciones} == {0}
    assert len(posiciones) == 24


def test_el_reparto_respeta_tambien_el_margen_por_tamano() -> None:
    """Cada tamaño entrega los globos de SU fila: el radio delata el tamaño.

    Los dos tamaños del caso (R-12 y R-5) no se solapan ni con la variación de
    inflado (±10 %), así que el radio separa las dos filas de la matriz sin
    necesidad de que el contrato cargue el tamaño de cada posición.
    """
    posiciones = _armar(PARED)
    grandes = [p for p in posiciones if cast(float, p["r"]) > 0.08]
    chicos = [p for p in posiciones if cast(float, p["r"]) <= 0.08]
    assert len(grandes) == sum(MATRIZ_DOS_TAMANOS[0])
    assert len(chicos) == sum(MATRIZ_DOS_TAMANOS[1])
    for fila, grupo in ((0, grandes), (1, chicos)):
        por_color = Counter(cast(int, p["material"]) for p in grupo)
        esperado = {m: c for m, c in enumerate(MATRIZ_DOS_TAMANOS[fila]) if c}
        assert dict(por_color) == esperado, f"el tamaño de la fila {fila} entregó otro reparto"


def test_el_patron_se_lee_sobre_la_silueta() -> None:
    """Un patrón por bloques se sigue viendo: el color no queda revuelto.

    Con la mitad de arriba de un color y la de abajo de otro, la mitad alta de la
    pared tiene que salir mayoritariamente del primero. No es una prueba de la
    implementación: es lo único que distingue dibujar el patrón de repartir los
    mismos globos al azar.
    """
    filas = 12
    celdas = [[0] * 4 if fila < filas // 2 else [1] * 4 for fila in range(filas)]
    posiciones = _armar(PARED, celdas, [[24, 24]], [(12, 1.0)])
    alto = max(cast(float, p["y"]) for p in posiciones)
    arriba = [p for p in posiciones if cast(float, p["y"]) > alto / 2]
    del_primero = sum(1 for p in arriba if p["material"] == 0)
    assert del_primero / len(arriba) > 0.75


def test_el_croquis_es_determinista() -> None:
    """Armarlo de cero dos veces da lo mismo: sin el recuerdo de por medio."""
    primero = _armar(ARCO)
    _disponer_recordado.cache_clear()
    assert primero == _armar(ARCO)


# --- La misma pieza con otro color no se vuelve a armar ------------------------


def test_otro_patron_sobre_la_misma_pieza_no_rearma_la_silueta() -> None:
    """Es lo que hace posible que el editor dibuje la pieza real.

    La vista previa vuelve a pedir la MISMA pieza con otro patrón en cada toque
    del decorador. Las posiciones no dependen del color —el motor solo mira tipo,
    medidas y cupos—, así que se recuerdan: sin esto, cada toque pagaba el precio
    entero de armar la silueta y el editor se quedó con la rejilla genérica.
    """
    otro = [[1, 0, 1, 0] if fila % 3 else [0, 1, 0, 1] for fila in range(12)]
    _disponer_recordado.cache_clear()
    primero = _armar(ARCO)
    armadas = _disponer_recordado.cache_info().misses
    segundo = _armar(ARCO, otro)
    assert _disponer_recordado.cache_info().misses == armadas, "se rearmó la misma silueta"
    # Mismo croquis, otro reparto de color: eso es "repintar solo el color".
    assert [(p["x"], p["y"], p["r"], p["capa"]) for p in segundo] == [
        (p["x"], p["y"], p["r"], p["capa"]) for p in primero
    ]
    assert [p["material"] for p in segundo] != [p["material"] for p in primero]


def test_otras_medidas_si_rearman_la_silueta() -> None:
    """El recuerdo es por petición: otra pieza es otra silueta, no la de antes."""
    _disponer_recordado.cache_clear()
    _armar(ARCO)
    armadas = _disponer_recordado.cache_info().misses
    _armar(dataclasses.replace(ARCO, ancho_m=4.0))
    assert _disponer_recordado.cache_info().misses == armadas + 1


# --- El centro de una flor va en medio de su flor ------------------------------


def test_el_centro_de_la_flor_queda_en_el_corazon_de_su_racimo() -> None:
    """Un ``extra`` no ocupa celda, pero sí tiene que verse donde va.

    El modo ``flor`` cuelga el centro de la fila de su flor sin darle posición en
    el racimo. Su globo existe igual (la matriz cuenta celdas más extras), pero
    hasta que alguien lo pidió caía donde lo dejara el reparto de sobrantes, así
    que las flores salían sin corazón y el color del centro aparecía al final de
    la pieza. Aquí se comprueba lo que se ve: el globo del centro está más cerca
    del centro de su racimo que el pétalo medio de ese racimo.
    """
    filas = 9
    # Tres flores: dos filas de fondo (0) y una de pétalo (1) con su centro (2).
    celdas = [[1 if fila % 3 == 2 else 0] * 4 for fila in range(filas)]
    extras = [(fila, 2) for fila in range(filas) if fila % 3 == 2]
    # Un solo tamaño y una columna por color: 36 celdas + 3 centros.
    matriz = [[24, 9, 3]]
    posiciones = _armar(COLUMNA, celdas, matriz, [(11, 1.0)], extras=extras)
    centros = [p for p in posiciones if p["material"] == 2]
    assert len(centros) == len(extras), "el cupo del centro no se movió"
    petalos = [p for p in posiciones if p["material"] == 1]
    assert petalos, "la flor tiene pétalos"
    # El eje de la columna es x = ancho/2: un corazón está más cerca de él que el
    # promedio de los pétalos, que rodean el racimo.
    eje = COLUMNA.ancho_m / 2
    distancia_centros = sum(abs(cast(float, p["x"]) - eje) for p in centros) / len(centros)
    distancia_petalos = sum(abs(cast(float, p["x"]) - eje) for p in petalos) / len(petalos)
    assert distancia_centros < distancia_petalos, "el centro no quedó dentro de su flor"


def test_los_extras_no_mueven_ni_un_globo_del_conteo() -> None:
    """Pedir el centro es una preferencia más: las cantidades son las de la matriz."""
    filas = 9
    celdas = [[1 if fila % 3 == 2 else 0] * 4 for fila in range(filas)]
    extras = [(fila, 2) for fila in range(filas) if fila % 3 == 2]
    matriz = [[24, 9, 3]]
    for pieza in (COLUMNA, ARCO, GUIRNALDA):
        posiciones = _armar(pieza, celdas, matriz, [(11, 1.0)], extras=extras)
        por_color = Counter(cast(int, p["material"]) for p in posiciones)
        assert dict(por_color) == {0: 24, 1: 9, 2: 3}, pieza.estructura_id


@pytest.mark.parametrize(
    ("pieza", "motivo"),
    [
        (PiezaSilueta(estructura_id="X1", tipo="centro_mesa", ancho_m=0.4, alto_m=0.6),
         "tipo_sin_silueta"),
        (PiezaSilueta(estructura_id="X2", tipo="backdrop", ancho_m=2.0, alto_m=2.0),
         "tipo_sin_silueta"),
        (PiezaSilueta(estructura_id="X3", tipo="arco", estructura_oficial="aro_circular",
                      ancho_m=1.2, alto_m=1.2), "tipo_sin_silueta"),
        (PiezaSilueta(estructura_id="X4", tipo="arco", ancho_m=0.0, alto_m=0.0),
         "medidas_incompletas"),
        (PiezaSilueta(estructura_id="X5", tipo="pared", ancho_m=2.0, alto_m=0.0),
         "medidas_incompletas"),
        (PiezaSilueta(estructura_id="X6", tipo="guirnalda"), "medidas_incompletas"),
    ],
    ids=["centro_mesa", "backdrop", "aro_circular", "arco_sin_medidas", "pared_sin_alto",
         "guirnalda_sin_largo"],
)
def test_sin_silueta_no_falla_y_la_grafica_sigue_con_su_rejilla(
    pieza: PiezaSilueta, motivo: MotivoSinSilueta
) -> None:
    """La degradación es correcta, pero dice por qué: nunca es silenciosa."""
    croquis = croquis_de_patron(
        pieza, CELDAS_DAMERO, MATRIZ_DOS_TAMANOS, PROPORCIONES_DOS_TAMANOS
    )
    assert croquis.posiciones is None
    assert croquis.motivo == motivo


def test_una_pieza_mas_grande_que_el_presupuesto_se_queda_con_la_rejilla() -> None:
    globos = MAX_GLOBOS_PIEZA + 1
    celdas = [[0, 1] for _ in range(globos // 2)]
    croquis = croquis_de_patron(PARED, celdas, [[globos - 1, 1]], [(12, 1.0)])
    assert croquis.posiciones is None
    assert croquis.motivo == "pieza_muy_grande"


def test_el_presupuesto_de_una_resolucion_se_reparte_en_orden() -> None:
    """Las primeras piezas se dibujan y las que ya no caben vuelven a la rejilla."""
    presupuesto = PresupuestoGrafica(globos=60)
    primera = croquis_de_patron(
        PARED, CELDAS_DAMERO, MATRIZ_DOS_TAMANOS, PROPORCIONES_DOS_TAMANOS, presupuesto
    )
    assert primera.posiciones is not None
    assert presupuesto.restante == 12
    segunda = croquis_de_patron(
        ARCO, CELDAS_DAMERO, MATRIZ_DOS_TAMANOS, PROPORCIONES_DOS_TAMANOS, presupuesto
    )
    assert segunda.posiciones is None
    # No es la pieza: es lo que ya se gastaron las anteriores. Son dos motivos
    # distintos porque se arreglan de dos maneras distintas.
    assert segunda.motivo == "presupuesto_agotado"


def test_una_matriz_que_no_cuadra_con_sus_proporciones_no_dibuja() -> None:
    for celdas, matriz, proporciones in (
        (CELDAS_DAMERO, MATRIZ_DOS_TAMANOS, [(12, 1.0)]),
        (CELDAS_DAMERO, [], PROPORCIONES_DOS_TAMANOS),
        ([], MATRIZ_DOS_TAMANOS, PROPORCIONES_DOS_TAMANOS),
        (CELDAS_DAMERO, [[0, 0], [0, 0]], PROPORCIONES_DOS_TAMANOS),
    ):
        croquis = croquis_de_patron(PARED, celdas, matriz, proporciones)
        assert croquis.posiciones is None
        assert croquis.motivo == "despiece_incoherente"


def test_las_posiciones_van_del_fondo_al_frente() -> None:
    capas = [cast(int, posicion["capa"]) for posicion in _armar(PARED_ORGANICA)]
    assert capas == sorted(capas)
    assert min(capas) == 0


def test_ningun_globo_se_sale_de_las_medidas_de_la_pared() -> None:
    """El croquis de una pared cabe en lo que pidió el cliente, globo y radio incluidos."""
    for posicion in _armar(PARED):
        x, y, r = (cast(float, posicion[clave]) for clave in ("x", "y", "r"))
        assert -1e-6 <= x - r and x + r <= PARED.ancho_m + 1e-6
        assert -1e-6 <= y - r and y + r <= PARED.alto_m + 1e-6


def test_cada_globo_de_una_pared_lleva_el_color_de_SU_sitio() -> None:
    """Una mancha se dibuja donde el patrón la puso, no corrida.

    `_lectura_pared` mapeaba la rejilla sobre los globos por PUESTO dentro de una
    banda, no por posición: en una pared orgánica las filas de arriba tienen
    menos globos y la banda se estiraba igual sobre todo el ancho, así que el
    color de un sitio se pintaba en otro. Medido el 2026-09-30 sobre 483 globos:
    solo el 72 % recibía el color de su propia celda, y eso deshacía las manchas.

    Aquí se usa un damero de bloques grandes —mitad izquierda un color, mitad
    derecha el otro—, que es lo que deja ver un corrimiento a simple vista: cada
    globo de la izquierda tiene que salir del color de la izquierda.
    """
    filas, columnas = 12, 4
    izquierda_derecha = tuple(
        tuple(0 if columna < columnas // 2 else 1 for columna in range(columnas))
        for _fila in range(filas)
    )
    posiciones = _armar(PARED_ORGANICA, celdas=izquierda_derecha)
    assert posiciones, "la pared tiene croquis"

    xs = [cast(float, posicion["x"]) for posicion in posiciones]
    medio = (min(xs) + max(xs)) / 2
    correctos = sum(
        1
        for posicion in posiciones
        if (cast(int, posicion["material"]) == 0) == (cast(float, posicion["x"]) <= medio)
    )
    fidelidad = correctos / len(posiciones)
    # 0,85 y no 1,0 a propósito: el resto son conflictos REALES entre el sitio y
    # la matriz tamaño × material. Si a la mitad izquierda le toca un globo de un
    # tamaño que a su color ya no le queda, `_materiales` lo sustituye — el color
    # se mueve de sitio, nunca de cantidad. Cerrar ese hueco pide decidir el
    # tamaño y el color JUNTOS (el modelo de capas de `clasificador-decoraciones`,
    # `src/lib/organico/capas.ts`), que es otro trabajo. Con el mapeo por puesto
    # esto daba 0,72; el umbral protege la mejora sin fingir que es perfecta.
    assert fidelidad >= 0.85, (
        f"solo el {fidelidad:.0%} de los globos lleva el color de su mitad;"
        " las manchas se están dibujando corridas de donde el patrón las puso"
    )


def test_pieza_desde_estructura_lee_el_armado_de_una_guirnalda() -> None:
    pieza = pieza_desde_estructura(
        "E9",
        "guirnalda",
        "guirnalda",
        {"largo_m": 4.5, "ancho_m": None},
        {"forma": "arco_caido", "caida_m": 0.8, "puntos_de_anclaje": 3},
    )
    assert (pieza.largo_m, pieza.forma_guirnalda, pieza.caida_m, pieza.anclajes) == (
        4.5,
        "arco_caido",
        0.8,
        3,
    )
    assert pieza.ancho_m == 0.0


# --- El croquis no toca la firma del plan --------------------------------------

ROOT = Path(__file__).resolve().parents[3]
VECTOR_PARED = (
    ROOT / "contracts" / "domain" / "v1" / "golden" / "plan-resolution"
    / "31-pared-damero-dos-colores.json"
)


class _StoreDeVector:
    def __init__(self, rows: Sequence[Mapping[str, object]], snapshot: str) -> None:
        self.rows = [dict(row) for row in rows]
        self.snapshot = snapshot

    async def published_snapshot(self, snapshot_id: str) -> str | None:
        return self.snapshot if snapshot_id == self.snapshot else None

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
        lora_variant_ids: Sequence[str] = (),
    ) -> Sequence[Mapping[str, object]]:
        return self.rows

    async def fetch_catalog_identity(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[Mapping[str, object]]:
        identidad: list[dict[str, object]] = [
            {"product_id": row["product_id"], "variant_id": row["variant_id"]}
            for row in self.rows
        ]
        identidad.extend(
            {"product_id": product_id, "variant_id": None}
            for product_id in dict.fromkeys(str(row["product_id"]) for row in self.rows)
        )
        return identidad


@pytest.mark.anyio
async def test_el_croquis_no_cambia_plan_hash_ni_el_conteo_por_color() -> None:
    """Resolver el vector 31 da el ``plan_hash`` congelado, con posiciones y todo.

    Es la prueba de que ``patrones_color`` está fuera del snapshot: el vector
    dorado no lleva ``posiciones`` y su ``plan_hash`` sigue siendo el mismo. Y el
    conteo por color de la respuesta cuadra globo a globo con las posiciones.
    """
    vector = cast(dict[str, Any], json.loads(VECTOR_PARED.read_text(encoding="utf-8")))
    peticion = PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000101",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": vector["plan"],
            "allowlist": vector["allowlist"],
            "catalog_snapshot_id": vector["catalog_snapshot_id"],
            "lora_variant_ids": vector.get("lora_variant_ids") or [],
        }
    )
    esperado = vector["expected_python"]["plan_resuelto"]
    assert "posiciones" not in esperado["patrones_color"][0]

    resuelto = cast(
        dict[str, Any],
        (await resolve_plan(peticion, _StoreDeVector(vector["catalog_rows"],
                                                     vector["catalog_snapshot_id"])))[
            "plan_resuelto"
        ],
    )
    patron = resuelto["patrones_color"][0]
    assert resuelto["plan_hash"] == esperado["plan_hash"]
    assert patron["conteo"] == esperado["patrones_color"][0]["conteo"]
    assert patron["globos_por_instancia"] == esperado["patrones_color"][0]["globos_por_instancia"]

    posiciones = patron["posiciones"]
    por_color = Counter(int(posicion["material"]) for posicion in posiciones)
    for linea in patron["conteo"]:
        assert por_color[int(linea["material"])] == int(linea["unidades_por_instancia"])
    assert len(posiciones) == patron["globos_por_instancia"]
