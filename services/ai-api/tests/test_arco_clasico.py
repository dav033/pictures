"""Qué promete el motor del arco clásico (``app/arco_clasico.py``).

El motor está porteado entero de ``clasificador-decoraciones``
(``src/lib/arco/motor.ts``), y «entero» incluye el conteo: **coloca los globos y
cuenta los que colocó**. De ahí sale la promesa que el resto del sistema da por
supuesta — la gráfica tiene exactamente los globos que se cobran — sin ninguna
reconciliación entre dos modelos.

La pasada anterior sí tenía dos modelos (la colocación de ellos, el conteo mío)
y todos sus defectos salieron de esa costura: la banda aplastada, la espiral que
se dibujaba como damero. Varias de las pruebas de aquí abajo son la regresión de
esos defectos y dicen cuál.

Los tamaños de ``CASOS`` son de catálogo: los arcos que la gente pide.
"""

from __future__ import annotations

import dataclasses
import math

import pytest

from app.arco_clasico import (
    MAX_GLOBOS_ANCHO,
    MIN_GLOBOS_ANCHO,
    SOLAPE,
    Arco,
    ArcoArmado,
    ArcoInvalido,
    GloboArco,
    arco_de_densidad,
    armar,
    cabe_como_arco,
    carril_de,
    contar,
    grosor_banda_m,
    paso_columna_m,
    vano_m,
)
from app.silueta import MAX_GLOBOS, diametro_inflado_m

#: Arcos de catálogo (m).
CASOS: tuple[tuple[float, float], ...] = ((2.5, 2.2), (3.0, 2.4), (4.0, 2.5), (6.0, 3.0))

DENSIDADES = ("sencilla", "media", "lujosa")

#: Lo que da cada densidad en el arco estándar de 4 × 2,5 m. Congela la
#: calibración: si se mueve, el precio de un arco clásico se movió.
#:
#: El motor anterior cotizaba 120/145/186 en este arco. El porteado da
#: 123/147/186 porque su calibración se ajustó contra SEIS tamaños a la vez y no
#: solo contra este: así la peor desviación del precio en todo el catálogo es
#: del 3,1 % en vez del 8,7 % que salía ajustando aquí. La diferencia se aceptó
#: a propósito al cambiar de motor (ver `mezclas.ts`).
TOTALES_ESTANDAR: dict[str, int] = {"sencilla": 123, "media": 147, "lujosa": 186}

DIAMETRO = diametro_inflado_m(12)


def arco(ancho_m: float, alto_m: float, densidad: str = "media") -> Arco:
    return arco_de_densidad(ancho_m, alto_m, densidad)


def filas_de(armado: ArcoArmado) -> list[list[GloboArco]]:
    """Los globos agrupados por fila, cada una en orden de carril."""
    por_fila: dict[int, list[GloboArco]] = {}
    for globo in armado.globos:
        por_fila.setdefault(globo.fila, []).append(globo)
    return [sorted(por_fila[i], key=lambda globo: globo.carril) for i in sorted(por_fila)]


def _unitario(x: float, y: float) -> tuple[float, float]:
    largo = math.hypot(x, y)
    assert largo > 0
    return x / largo, y / largo


# --- El conteo es el dibujo ---------------------------------------------------


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
@pytest.mark.parametrize("densidad", DENSIDADES)
def test_hay_una_posicion_por_globo_contado(ancho_m: float, alto_m: float, densidad: str) -> None:
    """La razón de ser del motor: lo que se cobra es lo que se dibuja.

    Aquí es por construcción y no por reconciliación, porque el total ES la
    cantidad de globos colocados.
    """
    try:
        armado = armar(arco(ancho_m, alto_m, densidad))
    except ArcoInvalido as error:
        pytest.skip(f"ese arco no se arma en {densidad}: {error.motivo}")
    assert armado.total == len(armado.globos)
    assert contar(arco(ancho_m, alto_m, densidad)) == armado.total


@pytest.mark.parametrize("densidad,esperado", sorted(TOTALES_ESTANDAR.items()))
def test_la_calibracion_de_cada_densidad_esta_congelada(densidad: str, esperado: int) -> None:
    assert contar(arco(4.0, 2.5, densidad)) == esperado


def test_mas_densidad_son_mas_globos() -> None:
    totales = [contar(arco(4.0, 2.5, densidad)) for densidad in DENSIDADES]
    assert totales == sorted(totales), "las densidades no van de menos a más"


def test_la_densidad_aprieta_las_filas_y_no_ensancha_la_banda() -> None:
    """Es la decisión que deja que un arco de 3 m siga cabiendo en lujosa.

    Hacer que la densidad ensanchara el arco (4, 5 y 6 globos a lo ancho)
    engordaba la banda hasta 1,48 m y dejaba un arco de 3 m sin vano. Lo que
    llena la pieza es la separación entre filas, como en el motor de referencia.
    """
    armados = [armar(arco(3.0, 2.4, densidad)) for densidad in DENSIDADES]
    assert len({armado.grosor_m for armado in armados}) == 1, "la banda cambió de ancho"
    assert [armado.filas for armado in armados] == sorted(
        armado.filas for armado in armados
    ), "las filas no se aprietan al subir la densidad"
    for armado in armados:
        assert vano_m(3.0, DIAMETRO, armado.globos_ancho) >= 0.30


def test_un_arco_mas_grande_lleva_mas_globos() -> None:
    assert contar(arco(6.0, 3.0)) > contar(arco(4.0, 2.5)) > contar(arco(2.5, 2.2))


def test_la_misma_peticion_da_el_mismo_arco() -> None:
    """Sin azar: dos armados de la misma petición son idénticos."""
    uno, otro = armar(arco(4.0, 2.5)), armar(arco(4.0, 2.5))
    assert uno == otro


# --- Cómo queda puesta la banda ----------------------------------------------


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
def test_las_filas_van_escalonadas(ancho_m: float, alto_m: float) -> None:
    """Las impares llevan un globo menos y caen en los huecos de las pares.

    Es el empaquetado hexagonal del motor de referencia, y es lo que hace que la
    banda se vea llena en vez de en columnas sueltas.
    """
    armado = armar(arco(ancho_m, alto_m))
    filas = filas_de(armado)
    assert [len(fila) for fila in filas[:4]] == [
        armado.globos_ancho,
        armado.globos_ancho - 1,
        armado.globos_ancho,
        armado.globos_ancho - 1,
    ]
    assert armado.total == sum(len(fila) for fila in filas)


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
def test_los_globos_no_quedan_aplastados_a_lo_ancho(ancho_m: float, alto_m: float) -> None:
    """Dos columnas vecinas están a un diámetro, no a medio.

    Es la regresión del defecto de la pasada anterior: metía ``k`` globos a la
    fuerza en el ancho de un racimo y las columnas quedaban a 0,40 diámetros
    contra los 0,88 del motor de referencia. Con los globos aplastados a la
    mitad, la diagonal de una espiral se comprime y se lee como alternancia
    fina en vez de como cinta.
    """
    armado = armar(arco(ancho_m, alto_m))
    paso = paso_columna_m(DIAMETRO)
    assert paso / DIAMETRO == pytest.approx(1 / SOLAPE, rel=1e-9)
    assert 0.8 <= paso / DIAMETRO <= 1.0, "los globos vecinos ya no se tocan"
    fila = filas_de(armado)[0]
    for uno, otro in zip(fila, fila[1:]):
        separacion = math.hypot(uno.x - otro.x, uno.y - otro.y)
        assert separacion == pytest.approx(paso, rel=0.02)


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
def test_la_banda_va_de_traves_del_arco_y_no_a_lo_largo(ancho_m: float, alto_m: float) -> None:
    """Los globos de una fila se reparten PERPENDICULARES a la línea del arco.

    Regresión de un defecto del motor anterior: la normal de los tramos curvos
    llevaba la ``y`` con el signo cambiado y en la cima la banda quedaba tendida
    a lo LARGO del arco. El conteo salía igual, así que ninguna prueba lo vio.
    """
    armado = armar(arco(ancho_m, alto_m))
    filas = filas_de(armado)
    centro = [
        (
            sum(globo.x for globo in fila) / len(fila),
            sum(globo.y for globo in fila) / len(fila),
        )
        for fila in filas
    ]
    desvios: list[float] = []
    for i in range(1, len(filas) - 1):
        antes = _unitario(centro[i][0] - centro[i - 1][0], centro[i][1] - centro[i - 1][1])
        despues = _unitario(centro[i + 1][0] - centro[i][0], centro[i + 1][1] - centro[i][1])
        tangente = _unitario(antes[0] + despues[0], antes[1] + despues[1])
        banda = _unitario(filas[i][-1].x - filas[i][0].x, filas[i][-1].y - filas[i][0].y)
        desvios.append(abs(tangente[0] * banda[0] + tangente[1] * banda[1]))
    desvios.sort()
    # Lo que queda es el error de ESTA estimación de la tangente en los extremos
    # y en la esquina entre la pata y la curva; el defecto que vigila llegaba a
    # 0,99 en todas las filas de la curva.
    assert desvios[len(desvios) // 2] < 0.02
    assert max(desvios) < 0.15


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
def test_la_banda_dibujada_mide_lo_que_se_midio(ancho_m: float, alto_m: float) -> None:
    """De borde a borde, el dibujo mide ``grosor_m``.

    Importa porque con ``grosor_m`` se calcularon el radio de la línea guía y el
    vano: un arco dibujado más gordo del que se cotizó se comería el hueco entre
    las patas, que el cliente sí va a ver.
    """
    armado = armar(arco(ancho_m, alto_m))
    assert armado.grosor_m == pytest.approx(
        grosor_banda_m(DIAMETRO, armado.globos_ancho), rel=1e-9
    )
    pata = [fila for fila in filas_de(armado) if all(g.y < 0.4 and g.x < 0 for g in fila)]
    if len(pata) < 2:
        pytest.skip("este arco no tiene pata recta donde medir")
    for uno, otro in zip(pata, pata[1:]):
        juntas = uno + otro
        dibujada = max(g.x + g.radio_m for g in juntas) - min(g.x - g.radio_m for g in juntas)
        assert dibujada == pytest.approx(armado.grosor_m, rel=0.08)


def test_la_curva_agranda_el_globo_de_afuera() -> None:
    """En la curva, el borde de afuera recorre más camino que el de adentro.

    Sin compensarlo la banda se abre por fuera y se amontona por dentro, que es
    lo que delata a un arco dibujado sobre una rejilla.
    """
    armado = armar(arco(3.0, 2.4))
    cima = max(filas_de(armado), key=lambda fila: max(globo.y for globo in fila))
    assert cima[0].radio_m > cima[-1].radio_m
    # En la pata recta no hay curva que compensar: dos filas de la misma
    # paridad llevan exactamente los mismos tamaños.
    rectas = [
        fila
        for fila in filas_de(armado)
        if fila[0].fila % 2 == 0 and all(g.y < 0.8 and g.x < 0 for g in fila)
    ]
    assert len(rectas) >= 2
    for uno, otro in zip(rectas, rectas[1:]):
        for globo_uno, globo_otro in zip(uno, otro):
            assert globo_uno.radio_m == pytest.approx(globo_otro.radio_m, rel=1e-9)


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
def test_el_centro_de_la_banda_va_delante_y_los_bordes_al_fondo(
    ancho_m: float, alto_m: float
) -> None:
    """La banda es un tubo: el centro tapa a los bordes, y hay fondo y frente.

    ``silueta_patron`` parte las posiciones en dos capas por el signo de
    ``profundidad``; si todas cayeran del mismo lado, el croquis sería plano.
    """
    armado = armar(arco(ancho_m, alto_m))
    for fila in filas_de(armado):
        medio = len(fila) // 2
        assert fila[medio].profundidad >= fila[0].profundidad
        assert fila[medio].profundidad >= fila[-1].profundidad
    profundidades = [globo.profundidad for globo in armado.globos]
    assert min(profundidades) < 0 < max(profundidades), "hacen falta las dos capas"


@pytest.mark.parametrize("ancho_m,alto_m", CASOS)
def test_el_arco_cabe_en_las_medidas_que_dice(ancho_m: float, alto_m: float) -> None:
    armado = armar(arco(ancho_m, alto_m))
    izquierda = min(globo.x - globo.radio_m for globo in armado.globos)
    derecha = max(globo.x + globo.radio_m for globo in armado.globos)
    arriba = max(globo.y + globo.radio_largo_m for globo in armado.globos)
    # El 5 % es la compensación de la curva, que agranda a propósito los globos
    # del borde de afuera (hasta un 35 % en una curva cerrada) para que la banda
    # se toque pareja. El motor de referencia hace lo mismo. La medida que se
    # declara es el envolvente de la banda, no el píxel más externo; medido, lo
    # que sobresale son 3 cm en el arco más cerrado de `CASOS`.
    assert derecha - izquierda <= armado.ancho_m * 1.05
    assert arriba <= armado.alto_m * 1.05
    assert all(globo.y >= -1e-9 for globo in armado.globos)


def test_cada_globo_cae_en_un_carril_de_la_rejilla() -> None:
    """El carril es la columna del patrón: nunca se sale de la rejilla."""
    armado = armar(arco(4.0, 2.5))
    assert all(0 <= globo.carril < armado.globos_ancho for globo in armado.globos)
    # En una fila no se repite carril: dos globos de la misma fila esperarían
    # el mismo color y uno de los dos se quedaría sin su celda.
    for fila in filas_de(armado):
        assert len({globo.carril for globo in fila}) == len(fila)


def test_el_carril_del_borde_va_siempre_al_mismo_lado() -> None:
    """Portado tal cual del original: bordes estables, sin motas sueltas."""
    assert carril_de(0.5, 4) == 0
    assert carril_de(3.5, 4) == 3
    # Un entero justo en la frontera: a la banda de fuera en la mitad de fuera.
    assert carril_de(1.0, 4) == 0
    assert carril_de(3.0, 4) == 3
    assert carril_de(-5.0, 4) == 0
    assert carril_de(99.0, 4) == 3


# --- La forma -----------------------------------------------------------------


def test_el_alto_decide_la_forma() -> None:
    alto = armar(arco(3.0, 2.4))
    assert alto.forma == "herradura", "con el alto por encima del radio van patas rectas"
    bajo = armar(arco(6.0, 3.0))
    assert bajo.forma == "semi"


def test_un_arco_mas_bajo_que_un_semicirculo_se_avisa_y_se_sube() -> None:
    armado = armar(arco(4.0, 1.0))
    assert armado.forma == "semi"
    assert armado.avisos and "semicírculo" in armado.avisos[0]
    assert armado.alto_m > 1.0, "el alto se subió al del semicírculo"


# --- Lo que no se puede armar -------------------------------------------------


def test_un_arco_sin_vano_no_se_arma_ni_se_ensancha_solo() -> None:
    estrecho = Arco(ancho_m=1.0, alto_m=2.0, pulgadas=12, globos_ancho=4)
    with pytest.raises(ArcoInvalido) as fallo:
        armar(estrecho)
    assert fallo.value.motivo == "arco_sin_vano"
    assert not cabe_como_arco(1.0, 12, 4)
    assert cabe_como_arco(4.0, 12, 4)


def test_el_vano_es_lo_que_queda_entre_las_patas() -> None:
    assert vano_m(4.0, DIAMETRO, 4) == pytest.approx(4.0 - 2 * grosor_banda_m(DIAMETRO, 4))
    armado = armar(arco(4.0, 2.5))
    a_la_altura = [g for g in armado.globos if 0.2 < g.y < 0.5]
    hueco = min(g.x - g.radio_m for g in a_la_altura if g.x > 0) - max(
        g.x + g.radio_m for g in a_la_altura if g.x < 0
    )
    assert hueco == pytest.approx(vano_m(4.0, DIAMETRO, armado.globos_ancho), abs=0.2)


@pytest.mark.parametrize(
    "cambio,motivo",
    [
        ({"globos_ancho": MIN_GLOBOS_ANCHO - 1}, "ancho_fuera_de_rango"),
        ({"globos_ancho": MAX_GLOBOS_ANCHO + 1}, "ancho_fuera_de_rango"),
        ({"separacion_filas": 0.1}, "separacion_fuera_de_rango"),
        ({"separacion_filas": 3.0}, "separacion_fuera_de_rango"),
        ({"pulgadas": 0}, "tamano_invalido"),
        ({"ancho_m": 0.0}, "sin_ancho"),
        ({"alto_m": 0.0}, "sin_alto"),
    ],
)
def test_lo_que_no_se_puede_armar_falla_con_motivo(
    cambio: dict[str, object], motivo: str
) -> None:
    with pytest.raises(ArcoInvalido) as fallo:
        armar(dataclasses.replace(arco(4.0, 2.5), **cambio))
    assert fallo.value.motivo == motivo


def test_un_arco_imposible_de_grande_no_se_arma() -> None:
    with pytest.raises(ArcoInvalido) as fallo:
        armar(Arco(ancho_m=60.0, alto_m=30.0, pulgadas=5, globos_ancho=9, separacion_filas=0.4))
    assert fallo.value.motivo == "demasiados_globos"
    assert str(MAX_GLOBOS) in str(fallo.value)


def test_una_densidad_que_no_existe_lo_dice() -> None:
    with pytest.raises(ArcoInvalido) as fallo:
        arco_de_densidad(4.0, 2.5, "exagerada")
    assert fallo.value.motivo == "densidad_desconocida"
    assert "sencilla" in str(fallo.value)
