"""Los mandos del armado del motor que ``estimar_conteo`` puede mover, y los valores que prueba de cada uno.

No hay aquí ninguna regla de conteo: solo qué mando tiene cada motor, dónde vive en el armado y en qué orden se
prueban sus valores (del más cercano al actual al más lejano, medido en escalones). Los rangos salen del propio
motor (``limites_de`` del arco, las constantes de la columna); un valor que el motor corrija o rechace lo descarta
quien los prueba (``estimar_conteo_sugerencia``), no esta tabla.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from app import conteo_foto
from app.arco.tipos import TAMANOS_GLOBO as TAMANOS_ARCO
from app.armado_arco import EstructuraArco
from app.armado_arco import limites_de as limites_de_arco
from app.armado_columna import ALTO_MAX as COLUMNA_ALTO_MAX
from app.armado_columna import ALTO_MIN as COLUMNA_ALTO_MIN
from app.armado_columna import GLOBOS_CAPA_MAX, GLOBOS_CAPA_MIN
from app.armado_columna import TAMANOS_GLOBO as TAMANOS_COLUMNA

#: Paso de las medidas del armado que se prueban, dentro de la misma ventana que usa ``conteo_foto`` (±35 %).
PASO_MEDIDA_MOTOR = 0.05


@dataclass(frozen=True)
class Mando:
    """Un mando del armado: dónde vive, su valor actual y los valores a probar, del más cercano al más lejano."""

    campo: str
    bloque: str
    clave: str
    actual: object
    #: ``(pasos desde el valor actual, valor)``; se prueban de menor a mayor número de pasos.
    valores: tuple[tuple[int, object], ...]


def con_valor(armado: Mapping[str, object], mando: Mando, valor: object) -> dict[str, object]:
    bloque = cast(Mapping[str, object], armado[mando.bloque])
    return {**armado, mando.bloque: {**bloque, mando.clave: valor}}


def _por_pasos(actual: int, lista: Sequence[int]) -> tuple[tuple[int, object], ...]:
    """Los valores de una escala entera, por cercanía a ``actual`` medida en escalones de la lista."""
    ordenada = sorted(set(lista))
    centro = min(range(len(ordenada)), key=lambda i: (abs(ordenada[i] - actual), ordenada[i]))
    return tuple(
        sorted(
            (
                (max(1, abs(i - centro)), valor)
                for i, valor in enumerate(ordenada)
                if valor != actual
            ),
            key=lambda par: (par[0], cast(int, par[1])),
        )
    )


def _escalones_de_medida(
    actual: float, minimo: float, maximo: float
) -> tuple[tuple[int, object], ...]:
    """La medida del armado escalada a pasos de ``PASO_MEDIDA_MOTOR`` dentro de la ventana de ``conteo_foto``."""
    pasos = round(conteo_foto.VENTANA_EJE / PASO_MEDIDA_MOTOR)
    valores: dict[float, int] = {}
    for escalon in range(1, pasos + 1):
        for signo in (-1, 1):
            valor = round(
                min(maximo, max(minimo, actual * (1 + signo * escalon * PASO_MEDIDA_MOTOR))), 2
            )
            if valor != actual:
                valores.setdefault(valor, escalon)
    return tuple(
        sorted(((paso, valor) for valor, paso in valores.items()), key=lambda p: (p[0], p[1]))
    )


def mandos_de_arco(
    estructura: Mapping[str, object], armado: Mapping[str, object]
) -> tuple[list[Mando], list[Mando]]:
    """Arco: el tamaño del globo y cuántos van a lo ancho; después, el ancho de la banda."""
    geometria = cast(Mapping[str, object], armado["geometria"])
    globo = cast(Mapping[str, object], armado["globo"])
    limites = limites_de_arco(
        armado, EstructuraArco(es_arco=True, materiales=marcadores(estructura))
    )
    n_actual = cast(int, geometria["globosAncho"])
    n_paso = max(1, int(limites["nPaso"]))
    n_valores = list(range(int(limites["nMin"]), int(limites["nMax"]) + 1, n_paso))
    ancho = cast(float, geometria["anchoM"])
    return (
        [
            Mando(
                "tamano_globo",
                "globo",
                "nominal",
                globo["nominal"],
                _por_pasos(cast(int, globo["nominal"]), list(TAMANOS_ARCO)),
            ),
            Mando(
                "globos_ancho",
                "geometria",
                "globosAncho",
                n_actual,
                tuple(
                    (max(1, round(abs(n - n_actual) / n_paso)), n)
                    for n in sorted(n_valores, key=lambda n: (abs(n - n_actual), n))
                    if n != n_actual
                ),
            ),
        ],
        [
            Mando(
                "ancho_m",
                "geometria",
                "anchoM",
                ancho,
                _escalones_de_medida(ancho, limites["anchoMin"], limites["anchoMax"]),
            )
        ],
    )


def mandos_de_columna(armado: Mapping[str, object]) -> tuple[list[Mando], list[Mando]]:
    """Columna: globos por capa y tamaño de la primera y la última capa; después, su alto."""
    cuerpo = cast(Mapping[str, object], armado["cuerpo"])
    tamanos = list(TAMANOS_COLUMNA)
    por_capa = cast(int, cuerpo["globos_capa"])
    alto = cast(float, cuerpo["alto_m"])
    return (
        [
            Mando(
                "globos_capa",
                "cuerpo",
                "globos_capa",
                por_capa,
                tuple(
                    (abs(n - por_capa), n)
                    for n in sorted(
                        range(GLOBOS_CAPA_MIN, GLOBOS_CAPA_MAX + 1),
                        key=lambda n: (abs(n - por_capa), n),
                    )
                    if n != por_capa
                ),
            ),
            Mando(
                "abajo",
                "cuerpo",
                "abajo",
                cuerpo["abajo"],
                _por_pasos(cast(int, cuerpo["abajo"]), tamanos),
            ),
            Mando(
                "arriba",
                "cuerpo",
                "arriba",
                cuerpo["arriba"],
                _por_pasos(cast(int, cuerpo["arriba"]), tamanos),
            ),
        ],
        [
            Mando(
                "alto_m",
                "cuerpo",
                "alto_m",
                alto,
                _escalones_de_medida(alto, COLUMNA_ALTO_MIN, COLUMNA_ALTO_MAX),
            )
        ],
    )


def marcadores(estructura: Mapping[str, object]) -> list[str]:
    return [f"#{i + 1:06x}" for i in range(len(cast(Sequence[object], estructura["materiales"])))]


__all__ = ["Mando", "con_valor", "mandos_de_arco", "mandos_de_columna", "marcadores"]
