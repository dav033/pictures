"""Qué promete el motor de silueta (``app/silueta.py``).

Las pruebas miran el comportamiento que otra parte del sistema va a dar por
supuesto —las cantidades son las que le pasaron, nada se sale de las medidas,
la misma semilla da la misma salida, cada tipo de estructura tiene su forma—,
no cómo está escrito por dentro.

Las medidas y los totales de ``PIEZAS`` son de oficio: un arco de 3 × 2,4 m con
una banda de 0,9 m y alrededor de 120 globos, una pared de 2,4 × 2,4 m con 380.
Los sesgos del motor (los grandes hacia la base, hacia los extremos) son
estadísticos, así que se comprueban sobre varias semillas juntas y no sobre una
sola: con una sola, la prueba mediría el sorteo, no el sesgo.
"""

from __future__ import annotations

import math
import random
from collections import Counter

import pytest

from app.generated_models import contract_schema
from app.silueta import (
    MAX_GLOBOS,
    Cupo,
    Estilo,
    GloboSilueta,
    Medidas,
    Peticion,
    Silueta,
    SiluetaInvalida,
    _Azar,
    crear_silueta,
    cupos_desde_mezcla,
    diametro_inflado_m,
    disponer,
    disponer_en,
    mezcla_del_contrato,
)

MEZCLA = mezcla_del_contrato("organica_fina")
#: Con más globos grandes, el sesgo por tamaño se mide sin depender de cinco R-24.
MEZCLA_GRUESA = mezcla_del_contrato("organica_gruesa")

#: ``(medidas, grosor de banda, grosor en la punta, globos)`` de una pieza
#: corriente de cada tipo.
PIEZAS: dict[str, tuple[Medidas, float | None, float | None, int]] = {
    "arco": (Medidas(ancho_m=3.0, alto_m=2.4), 0.9, 0.62, 120),
    "semiarco": (Medidas(ancho_m=1.6, alto_m=2.2), 0.8, 0.45, 60),
    "columna": (Medidas(ancho_m=0.6, alto_m=2.0), 0.6, 0.4, 40),
    "guirnalda": (Medidas(largo_m=4.0), 0.5, 0.65, 80),
    "pared_densa": (Medidas(ancho_m=2.4, alto_m=2.4), None, None, 380),
    "pared_organica": (Medidas(ancho_m=2.4, alto_m=2.4), None, None, 380),
}
TIPOS = tuple(PIEZAS)
SEMILLAS = (1, 7, 42, 100)


def peticion(tipo: str, **cambios: object) -> Peticion:
    """Una pieza corriente de ese tipo, con lo que se le quiera cambiar."""
    medidas, grosor, punta, total = PIEZAS[tipo]
    campos: dict[str, object] = {
        "tipo": tipo,
        "medidas": medidas,
        "cupos": cupos_desde_mezcla(
            cambios.pop("mezcla", MEZCLA),  # type: ignore[arg-type]
            int(cambios.pop("total", total)),  # type: ignore[call-overload]
        ),
        "grosor_m": grosor,
        "grosor_punta_m": punta,
        "semilla": 7,
    }
    campos.update(cambios)
    return Peticion(**campos)  # type: ignore[arg-type]


def _huella(globos: tuple[GloboSilueta, ...]) -> list[tuple[float, float, float, int, int]]:
    return [(g.x, g.y, g.r, g.capa, g.nominal) for g in globos]


def _cabe(globo: GloboSilueta, silueta: Silueta) -> bool:
    x0, y0, x1, y1 = silueta.caja
    margen = 1e-6
    return (
        globo.x - globo.r >= x0 - margen
        and globo.x + globo.r <= x1 + margen
        and globo.y - globo.r >= y0 - margen
        and globo.y + globo.r <= y1 + margen
    )


def _promedio(valores: list[float]) -> float:
    return sum(valores) / len(valores)


# --- Determinismo -------------------------------------------------------------


@pytest.mark.parametrize("tipo", TIPOS)
def test_la_misma_peticion_y_semilla_dan_exactamente_la_misma_salida(tipo: str) -> None:
    p = peticion(tipo)
    assert _huella(disponer(p).globos) == _huella(disponer(p).globos)


def test_la_salida_no_depende_del_azar_global_del_proceso() -> None:
    """``random.seed`` no puede mover un globo: el motor trae su generador."""
    random.seed(1)
    primero = _huella(disponer(peticion("arco")).globos)
    random.seed(999)
    for _ in range(50):
        random.random()
    assert _huella(disponer(peticion("arco")).globos) == primero


def test_el_generador_da_la_misma_secuencia_en_cualquier_maquina() -> None:
    """El determinismo cruza procesos y versiones, no solo dos llamadas seguidas.

    Si estas cifras cambian, la misma propuesta deja de dibujarse igual entre
    dos despliegues; es justo lo que hay que notar.
    """
    assert round(_Azar(0)(), 12) == 0.266429208685
    azar = _Azar(11)
    assert [round(azar(), 12) for _ in range(4)] == [
        0.511587048648,
        0.529946408235,
        0.608118564123,
        0.590157635976,
    ]


def test_otra_semilla_mueve_los_globos_pero_no_cambia_las_cantidades() -> None:
    uno = disponer(peticion("arco", semilla=1))
    otro = disponer(peticion("arco", semilla=2))
    assert _huella(uno.globos) != _huella(otro.globos)
    assert Counter(g.nominal for g in uno.globos) == Counter(g.nominal for g in otro.globos)


# --- El motor no decide cantidades --------------------------------------------


@pytest.mark.parametrize("tipo", TIPOS)
def test_coloca_exactamente_los_globos_de_cada_cupo(tipo: str) -> None:
    """La cantidad la decide quien la cotiza; el motor no inventa ni pierde globos."""
    p = peticion(tipo, total=137)
    colocados = Counter(g.nominal for g in disponer(p).globos)
    assert colocados == Counter({c.pulgadas: c.cantidad for c in p.cupos if c.cantidad})
    assert sum(colocados.values()) == 137


def test_un_cupo_de_un_solo_tamano_sale_entero_de_ese_tamano() -> None:
    globos = disponer(peticion("columna", cupos=(Cupo(pulgadas=12, cantidad=40),))).globos
    assert len(globos) == 40
    assert {g.nominal for g in globos} == {12}
    inflado = diametro_inflado_m(12) / 2
    assert all(0.85 * inflado <= g.r <= inflado + 1e-9 for g in globos)


# --- La silueta respeta las medidas pedidas -----------------------------------


@pytest.mark.parametrize("tipo", TIPOS)
def test_ningun_globo_se_sale_de_la_silueta(tipo: str) -> None:
    disposicion = disponer(peticion(tipo))
    assert all(_cabe(g, disposicion.silueta) for g in disposicion.globos)


@pytest.mark.parametrize("tipo", ("arco", "semiarco", "pared_densa", "pared_organica"))
def test_la_caja_es_la_medida_que_pidio_el_cliente(tipo: str) -> None:
    silueta = crear_silueta(peticion(tipo))
    assert silueta.caja[:2] == (0.0, 0.0)
    assert silueta.caja[2] == pytest.approx(silueta.medidas.ancho_m)
    assert silueta.caja[3] == pytest.approx(silueta.medidas.alto_m)


def test_el_alto_de_una_guirnalda_lo_pone_lo_que_cuelga_no_el_plan() -> None:
    """El plan no mide el alto de una guirnalda: lo ponen su banda y su caída."""
    recta = crear_silueta(peticion("guirnalda", forma="recta"))
    caida = crear_silueta(peticion("guirnalda", forma="arco_caido", caida_m=0.6, anclajes=3))
    assert caida.caja[3] > recta.caja[3] + 0.5
    assert caida.caja[2] == pytest.approx(4.0)


# --- Cada tipo tiene su forma -------------------------------------------------


def test_cada_tipo_dibuja_una_silueta_distinta_con_las_mismas_medidas() -> None:
    """Es el motivo del motor: hoy una pared y una guirnalda salen de la misma rejilla."""
    medidas = Medidas(ancho_m=2.4, alto_m=2.4, largo_m=2.4)
    cupos = cupos_desde_mezcla(MEZCLA, 120)
    formas: list[list[tuple[float, float, float, int, int]]] = []
    for tipo, grosor in (
        ("arco", 0.8),
        ("guirnalda", 0.8),
        ("columna", 0.8),
        ("pared_densa", None),
    ):
        p = Peticion(tipo=tipo, medidas=medidas, cupos=cupos, grosor_m=grosor)  # type: ignore[arg-type]
        formas.append(_huella(disponer(p).globos))
    for i, una in enumerate(formas):
        for otra in formas[i + 1 :]:
            assert una != otra


def test_la_pared_organica_tiene_borde_vivo_y_la_densa_no() -> None:
    organica = crear_silueta(peticion("pared_organica"))
    densa = crear_silueta(peticion("pared_densa"))
    ancho, alto = densa.medidas.ancho_m, densa.medidas.alto_m
    assert densa.area_m2 == pytest.approx(ancho * alto, rel=1e-3)
    # El borde muerde hacia dentro: cubre menos, pero no se sale de lo pedido.
    assert organica.area_m2 < densa.area_m2 * 0.97
    assert organica.area_m2 > densa.area_m2 * 0.7
    assert all(
        -1e-9 <= x <= ancho + 1e-9 and -1e-9 <= y <= alto + 1e-9 for x, y in organica.contorno()
    )
    # Y es irregular de verdad: los cuatro lados se mueven, no solo uno.
    izquierdo = [x for x, y in organica.contorno() if x < ancho / 2]
    assert max(izquierdo) - min(izquierdo) > 0.02


def test_una_pared_sin_borde_vivo_vuelve_a_ser_el_rectangulo_limpio() -> None:
    silueta = crear_silueta(peticion("pared_organica", estilo=Estilo(borde_vivo=0.0)))
    ancho, alto = silueta.medidas.ancho_m, silueta.medidas.alto_m
    assert silueta.area_m2 == pytest.approx(ancho * alto, rel=1e-3)


@pytest.mark.parametrize("tipo", ("arco", "semiarco", "columna", "guirnalda"))
def test_la_espina_es_una_curva_medida_con_tangente_y_normal(tipo: str) -> None:
    espina = crear_silueta(peticion(tipo)).espina
    assert espina is not None
    assert espina.largo > 0
    anterior = -1.0
    for punto in espina.puntos:
        assert punto.s >= anterior - 1e-12
        anterior = punto.s
        assert math.hypot(punto.tx, punto.ty) == pytest.approx(1.0)
        assert math.hypot(punto.nx, punto.ny) == pytest.approx(1.0)
        assert punto.tx * punto.nx + punto.ty * punto.ny == pytest.approx(0.0, abs=1e-12)
    assert espina.puntos[-1].s == pytest.approx(espina.largo)


def test_un_arco_mas_ancho_tiene_una_espina_mas_larga() -> None:
    corto = crear_silueta(peticion("arco", medidas=Medidas(ancho_m=2.0, alto_m=2.4))).espina
    largo = crear_silueta(peticion("arco", medidas=Medidas(ancho_m=5.0, alto_m=2.4))).espina
    assert corto is not None and largo is not None
    assert largo.largo > corto.largo * 1.4


def test_la_banda_se_afina_donde_se_pidio_afinarla() -> None:
    espina = crear_silueta(peticion("arco")).espina
    assert espina is not None
    patas = (espina.grosor_en(0.03) + espina.grosor_en(0.97)) / 2
    assert espina.grosor_en(0.5) < patas


def test_una_banda_pareja_no_se_afina() -> None:
    espina = crear_silueta(
        peticion("arco", grosor_m=0.8, grosor_punta_m=0.8, estilo=Estilo(irregularidad=0.0))
    ).espina
    assert espina is not None
    assert espina.grosor_en(0.5) == pytest.approx(espina.grosor_en(0.03), rel=1e-6)


# --- Formas de guirnalda (las del armado, no una lista repetida aquí) ---------

SIN_TEMBLOR = Estilo(ondulacion=0.0)


def _alturas(silueta: Silueta) -> list[float]:
    assert silueta.espina is not None
    return [punto.y for punto in silueta.espina.puntos]


def test_una_guirnalda_recta_solo_tiembla() -> None:
    alturas = _alturas(crear_silueta(peticion("guirnalda", forma="recta")))
    assert 0 < max(alturas) - min(alturas) < 0.06


def test_la_u_invertida_sube_en_el_medio_y_baja_en_los_extremos() -> None:
    alturas = _alturas(
        crear_silueta(peticion("guirnalda", forma="u_invertida", caida_m=0.8, estilo=SIN_TEMBLOR))
    )
    medio = alturas[len(alturas) // 2]
    assert medio > alturas[0] + 0.7
    assert medio > alturas[-1] + 0.7


@pytest.mark.parametrize(("anclajes", "festones"), ((2, 1), (3, 2), (5, 4)))
def test_el_arco_caido_hace_un_feston_por_tramo_entre_anclajes(
    anclajes: int, festones: int
) -> None:
    alturas = _alturas(
        crear_silueta(
            peticion(
                "guirnalda",
                forma="arco_caido",
                caida_m=0.5,
                anclajes=anclajes,
                estilo=SIN_TEMBLOR,
            )
        )
    )
    hondos = sum(
        1
        for i in range(1, len(alturas) - 1)
        if alturas[i] < alturas[i - 1] and alturas[i] <= alturas[i + 1]
    )
    assert hondos == festones


def test_la_ondulada_sube_y_baja_varias_veces() -> None:
    alturas = _alturas(crear_silueta(peticion("guirnalda", forma="ondulada", estilo=SIN_TEMBLOR)))
    vueltas = sum(
        1
        for i in range(1, len(alturas) - 1)
        if (alturas[i] - alturas[i - 1]) * (alturas[i + 1] - alturas[i]) < 0
    )
    assert vueltas >= 3


# --- Cómo quedan los globos ---------------------------------------------------


@pytest.mark.parametrize("tipo", TIPOS)
@pytest.mark.parametrize("semilla", SEMILLAS)
def test_dos_globos_de_la_misma_capa_no_quedan_uno_dentro_del_otro(tipo: str, semilla: int) -> None:
    """Solaparse da profundidad; compartir el centro en la misma capa es un borrón."""
    globos = disponer(peticion(tipo, semilla=semilla)).globos
    for i, a in enumerate(globos):
        for b in globos[i + 1 :]:
            if a.capa != b.capa:
                continue
            assert math.hypot(b.x - a.x, b.y - a.y) >= 0.5 * (a.r + b.r), (tipo, semilla, a, b)


@pytest.mark.parametrize("semilla", SEMILLAS)
def test_pedir_mas_globos_de_los_que_caben_no_hace_desaparecer_ninguno(semilla: int) -> None:
    """Cuatro veces los globos de una columna: se apretujan, pero siguen todos y se ven."""
    disposicion = disponer(peticion("columna", total=160, semilla=semilla))
    assert len(disposicion.globos) == 160
    assert disposicion.ocupacion > 3
    for i, a in enumerate(disposicion.globos):
        for b in disposicion.globos[i + 1 :]:
            if a.capa != b.capa:
                continue
            assert math.hypot(b.x - a.x, b.y - a.y) >= 0.3 * (a.r + b.r)


@pytest.mark.parametrize("tipo", TIPOS)
def test_ningun_globo_queda_flotando_solo(tipo: str) -> None:
    """Un globo despegado del resto se lee como un error de armado."""
    globos = disponer(peticion(tipo)).globos
    for i, a in enumerate(globos):
        hueco = min(
            math.hypot(b.x - a.x, b.y - a.y) - (a.r + b.r) for j, b in enumerate(globos) if j != i
        )
        assert hueco <= 0.1 * a.r, (tipo, a, hueco)


@pytest.mark.parametrize("tipo", ("arco", "pared_densa"))
def test_los_globos_grandes_tienden_a_la_base(tipo: str) -> None:
    grandes: list[float] = []
    chicos: list[float] = []
    for semilla in SEMILLAS:
        for globo in disponer(peticion(tipo, semilla=semilla)).globos:
            if globo.nominal >= 18:
                grandes.append(globo.y)
            elif globo.nominal <= 9:
                chicos.append(globo.y)
    assert _promedio(grandes) < _promedio(chicos) * 0.9


def test_en_una_guirnalda_los_grandes_tienden_a_los_extremos() -> None:
    """La «base» de una guirnalda no es el suelo: son sus dos puntas."""
    grandes: list[float] = []
    chicos: list[float] = []
    for semilla in SEMILLAS:
        p = peticion("guirnalda", mezcla=MEZCLA_GRUESA, semilla=semilla)
        medio = p.medidas.largo_m / 2
        for globo in disponer(p).globos:
            if globo.nominal >= 18:
                grandes.append(abs(globo.x - medio))
            elif globo.nominal <= 9:
                chicos.append(abs(globo.x - medio))
    assert _promedio(grandes) > _promedio(chicos) * 1.05


def test_las_capas_van_del_fondo_al_frente_y_se_usan_todas() -> None:
    disposicion = disponer(peticion("pared_densa", total=300))
    assert disposicion.capas >= 2
    assert {g.capa for g in disposicion.globos} == set(range(disposicion.capas))
    grupos = disposicion.por_capa()
    assert len(grupos) == disposicion.capas
    assert sum(len(grupo) for grupo in grupos) == len(disposicion.globos)
    assert all(globo.capa == i for i, grupo in enumerate(grupos) for globo in grupo)


def test_mas_globos_en_la_misma_pared_piden_mas_capas_de_fondo() -> None:
    pocas = disponer(peticion("pared_densa", total=120)).capas
    muchas = disponer(peticion("pared_densa", total=600)).capas
    assert muchas > pocas


def test_la_ocupacion_crece_con_los_globos_que_se_piden() -> None:
    poca = disponer(peticion("arco", total=60)).ocupacion
    mucha = disponer(peticion("arco", total=240)).ocupacion
    assert mucha > poca * 3


# --- Reutilizar una silueta ---------------------------------------------------


def test_la_misma_silueta_sirve_para_otros_cupos() -> None:
    p = peticion("arco", total=90)
    silueta = crear_silueta(p)
    otros = peticion("arco", total=150)
    una = disponer_en(silueta, p)
    otra = disponer_en(silueta, otros)
    assert len(una.globos) == 90
    assert len(otra.globos) == 150
    assert una.silueta.contorno() == otra.silueta.contorno()


# --- La mezcla viene del contrato, no de una copia -----------------------------


def test_la_tabla_de_mezclas_se_lee_del_contrato_exportado() -> None:
    """Su dueño es ``src/lib/plan/mezclas.ts``; aquí no hay una segunda copia."""
    exportada = contract_schema("PlanDecoracion")["x-reglas-mezclas"]["mezclas"]
    for nombre, tamanos in exportada.items():
        assert mezcla_del_contrato(nombre) == tuple(
            (t["pulgadas"], t["proporcion"]) for t in tamanos
        )


def test_una_mezcla_que_el_contrato_no_define_no_se_inventa() -> None:
    with pytest.raises(SiluetaInvalida) as error:
        mezcla_del_contrato("organica_gigante")
    assert error.value.motivo == "mezcla_desconocida"


def test_el_reparto_de_prueba_da_el_total_exacto_en_las_proporciones_de_la_mezcla() -> None:
    for total in (1, 7, 40, 137, 1000):
        cupos = cupos_desde_mezcla(MEZCLA, total)
        assert sum(c.cantidad for c in cupos) == total
        assert all(c.cantidad > 0 for c in cupos)
    grande = {c.pulgadas: c.cantidad for c in cupos_desde_mezcla(MEZCLA, 1000)}
    assert grande == {pulgadas: round(proporcion * 1000) for pulgadas, proporcion in MEZCLA}


# --- Entradas que no describen una silueta ------------------------------------

CUPOS = cupos_desde_mezcla(MEZCLA, 60)


def _falla(**campos: object) -> str:
    with pytest.raises(SiluetaInvalida) as error:
        crear_silueta(Peticion(**campos))  # type: ignore[arg-type]
    return error.value.motivo


def test_una_banda_sin_grosor_no_se_puede_dibujar() -> None:
    motivo = _falla(tipo="arco", medidas=Medidas(ancho_m=3, alto_m=2.4), cupos=CUPOS)
    assert motivo == "sin_grosor"


def test_una_pared_no_lleva_grosor_de_banda() -> None:
    motivo = _falla(
        tipo="pared_densa", medidas=Medidas(ancho_m=2, alto_m=2), cupos=CUPOS, grosor_m=0.5
    )
    assert motivo == "grosor_en_pared"


def test_no_se_dibuja_un_tipo_que_el_motor_no_conoce() -> None:
    motivo = _falla(tipo="escultura", medidas=Medidas(ancho_m=2, alto_m=2), cupos=CUPOS)
    assert motivo == "tipo_desconocido"


def test_un_arco_sin_medidas_no_es_un_arco() -> None:
    assert _falla(tipo="arco", medidas=Medidas(), cupos=CUPOS, grosor_m=0.8) == "sin_medidas"


def test_una_guirnalda_necesita_su_largo() -> None:
    motivo = _falla(tipo="guirnalda", medidas=Medidas(alto_m=2), cupos=CUPOS, grosor_m=0.5)
    assert motivo == "sin_largo"


def test_solo_una_guirnalda_lleva_forma_de_armado() -> None:
    motivo = _falla(
        tipo="arco",
        medidas=Medidas(ancho_m=3, alto_m=2.4),
        cupos=CUPOS,
        grosor_m=0.8,
        forma="ondulada",
    )
    assert motivo == "forma_sin_guirnalda"


def test_una_forma_de_guirnalda_que_no_existe_se_rechaza() -> None:
    motivo = _falla(
        tipo="guirnalda", medidas=Medidas(largo_m=3), cupos=CUPOS, grosor_m=0.5, forma="zigzag"
    )
    assert motivo == "forma_desconocida"


def test_una_forma_que_no_cuelga_no_tiene_caida() -> None:
    motivo = _falla(
        tipo="guirnalda",
        medidas=Medidas(largo_m=3),
        cupos=CUPOS,
        grosor_m=0.5,
        forma="ondulada",
        caida_m=0.4,
    )
    assert motivo == "caida_sin_forma_colgante"


def test_sin_globos_no_hay_nada_que_colocar() -> None:
    vacio = _falla(tipo="guirnalda", medidas=Medidas(largo_m=3), cupos=(), grosor_m=0.5)
    assert vacio == "sin_cupos"
    cero = _falla(
        tipo="guirnalda",
        medidas=Medidas(largo_m=3),
        cupos=(Cupo(pulgadas=12, cantidad=0),),
        grosor_m=0.5,
    )
    assert cero == "sin_globos"


def test_una_pieza_con_demasiados_globos_se_divide_antes_de_dibujarla() -> None:
    motivo = _falla(
        tipo="pared_densa",
        medidas=Medidas(ancho_m=6, alto_m=4),
        cupos=(Cupo(pulgadas=12, cantidad=MAX_GLOBOS + 1),),
    )
    assert motivo == "demasiados_globos"
