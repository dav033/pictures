"""Red de seguridad del reparto de globos por tamaño y material.

Puerto caso por caso de ``scripts/test-geometria-plan.ts`` (paso 5 del
ADR 0023): cuando se borre ``src/lib/medidas/geometria.ts`` se irá con él ese
script, que hoy es la única prueba del motor geométrico. Los números esperados
son los que afirma el test de TypeScript, no lo que devuelve Python.

Diferencias de firma frente a las funciones gemelas de TypeScript, adaptadas en
la llamada (``app/plan.py`` no se toca):

* ``_required_sizes`` recibe el plan entero y devuelve un ``set``, mientras que
  ``tamanosObligatorios`` recibe ``restricciones`` y devuelve una lista ordenada.
* ``_despiece_with_plan_sizes`` recibe ``(plan, estructura)`` con las claves del
  contrato (``ancho_m``, ``alto_m``, ``largo_m``) en vez del input plano de
  ``calcularDespieceEstructura``, y devuelve ``(eje, lineas, sin_ubicar)`` sin
  un campo ``totalGlobos``: el total es la suma de las líneas.
* ``_despiece_with_plan_sizes`` **omite las celdas vacías**, mientras que
  ``calcularDespieceEstructura`` devuelve la matriz completa con líneas de
  cantidad 0. Donde el test de TypeScript cuenta líneas, aquí se comprueba la
  celda a celda sobre los tamaños de la mezcla.
"""

from __future__ import annotations

import math
from typing import Mapping, Sequence, cast

import pytest

from app.plan import (
    BalloonApportionmentError,
    _BAND_WIDTH,
    _DENSITY_LAMBDA,
    _MIXES,
    _apportion_margins,
    _despiece_with_plan_sizes,
    _effective_proportions,
    _eje,
    _hamilton,
    _required_sizes,
    _total_globos,
)


ARCO = {"ancho_m": 3, "alto_m": 2.4}
UN_MATERIAL: list[dict[str, object]] = [{"participacion": 1.0}]
DOS_MATERIALES: list[dict[str, object]] = [
    {"color": "rojo", "participacion": 0.6},
    {"color": "dorado", "participacion": 0.4},
]


def _estructura(
    tipo: str,
    medidas: dict[str, float],
    materiales: Sequence[dict[str, object]],
    *,
    repeticiones: int = 1,
    densidad: str = "media",
    mezcla: str = "organica_fina",
) -> dict[str, object]:
    """Estructura mínima del plan; la geometría no lee nada más."""
    return {
        "tipo": tipo,
        "medidas": dict(medidas),
        "densidad": densidad,
        "mezcla": mezcla,
        "repeticiones": repeticiones,
        "materiales": [dict(material) for material in materiales],
    }


def _plan_con_tamanos(*tamanos: int) -> dict[str, object]:
    """Plan con ``restricciones.tamanos`` obligatorios (ADR 0022)."""
    return {
        "restricciones": {
            "tamanos": [
                {"valor": f"R-{tamano}", "polaridad": "obligatorio", "procedencia": "explicito"}
                for tamano in tamanos
            ]
        }
    }


def _lineas(
    estructura: dict[str, object], plan: Mapping[str, object] | None = None
) -> list[dict[str, object]]:
    lineas: list[dict[str, object]] = _despiece_with_plan_sizes(
        plan if plan is not None else {}, estructura
    )[1]
    return lineas


def _total(lineas: Sequence[dict[str, object]]) -> int:
    return sum(cast(int, linea["cantidad"]) for linea in lineas)


def _agrupar(lineas: Sequence[dict[str, object]], clave: str) -> dict[int, int]:
    totales: dict[int, int] = {}
    for linea in lineas:
        indice = cast(int, linea[clave])
        totales[indice] = totales.get(indice, 0) + cast(int, linea["cantidad"])
    return totales


def test_las_tablas_de_la_mezcla_son_las_mismas_que_en_typescript() -> None:
    # Cuando geometria.ts desaparezca estas constantes solo vivirán aquí: son
    # MEZCLAS, LAMBDA_POR_DENSIDAD y ANCHO_BANDA_POR_MEZCLA, valor a valor.
    assert _MIXES == {
        "clasica": ((12, 1.0),),
        "organica_fina": ((5, 0.21), (9, 0.18), (12, 0.54), (18, 0.05), (24, 0.02)),
        "organica_gruesa": ((9, 0.25), (12, 0.45), (18, 0.2), (24, 0.1)),
        "solo_grandes": ((18, 0.6), (24, 0.4)),
    }
    assert _DENSITY_LAMBDA == {"sencilla": 2.8, "media": 3.6, "lujosa": 4.5}
    assert _BAND_WIDTH == {
        "clasica": 1.3,
        "organica_fina": 1.02,
        "organica_gruesa": 1.3,
        "solo_grandes": 1.3,
    }


def test_cada_tamano_se_reparte_entre_los_dos_materiales_y_escala_con_las_repeticiones() -> None:
    uno = _lineas(_estructura("arco", ARCO, DOS_MATERIALES))
    seis = _lineas(_estructura("arco", ARCO, DOS_MATERIALES, repeticiones=6))
    # 5 tamaños × 2 materiales, y con este total ninguna celda queda vacía.
    assert len(uno) == 10
    for pulgadas in {cast(int, linea["pulgadas"]) for linea in uno}:
        colores = {linea["color"] for linea in uno if linea["pulgadas"] == pulgadas}
        assert colores == {"rojo", "dorado"}
    _eje_m, total_base = _total_globos("arco", ARCO, "media", "organica_fina")
    assert _total(uno) == total_base
    assert [linea["cantidad"] for linea in seis] == [
        cast(int, linea["cantidad"]) * 6 for linea in uno
    ]


def test_ninguna_participacion_pierde_globos_en_el_reparto() -> None:
    # 200 repartos rojo/dorado: la matriz cierra el total en todos.
    _eje_m, total_base = _total_globos("arco", ARCO, "media", "organica_fina")
    for indice in range(200):
        rojo = (indice + 1) / 201
        materiales: list[dict[str, object]] = [
            {"color": "rojo", "participacion": rojo},
            {"color": "dorado", "participacion": 1 - rojo},
        ]
        assert _total(_lineas(_estructura("arco", ARCO, materiales))) == total_base


def test_el_reparto_es_estable_entre_dos_llamadas_iguales() -> None:
    materiales: list[dict[str, object]] = [
        {"color": "rojo", "participacion": 0.7},
        {"color": "dorado", "participacion": 0.3},
    ]
    estructura = _estructura("arco", ARCO, materiales, repeticiones=2)
    assert _despiece_with_plan_sizes({}, estructura) == _despiece_with_plan_sizes({}, estructura)


def test_los_conteos_de_referencia_de_un_arco_y_dos_columnas_siguen_en_rango() -> None:
    arco = _lineas(_estructura("arco", {"ancho_m": 3, "alto_m": 2.5}, UN_MATERIAL))
    columnas = _lineas(_estructura("columna", {"alto_m": 1.5}, UN_MATERIAL, repeticiones=2))
    total_arco = _total(arco)
    total_columnas = _total(columnas)
    assert 110 <= total_arco <= 140
    assert 25 <= total_columnas / 2 <= 32
    assert 166 <= total_arco + total_columnas <= 217
    por_tamano = _agrupar([*arco, *columnas], "pulgadas")
    assert 35 <= por_tamano.get(5, 0) <= 50
    assert 30 <= por_tamano.get(9, 0) <= 40
    assert 90 <= por_tamano.get(12, 0) <= 110
    assert 8 <= por_tamano.get(18, 0) <= 12
    assert 3 <= por_tamano.get(24, 0) <= 5


def test_el_eje_del_semiarco_es_un_cuarto_de_elipse_que_usa_el_alto() -> None:
    # Regresión: el eje era `largo || ancho` e ignoraba el alto, así que un
    # semiarco alto de 1,2 × 2,2 m contaba menos globos que una columna de 1,8 m.
    alto = _eje("semiarco", {"ancho_m": 1.2, "alto_m": 2.2})
    assert alto == pytest.approx(2.7284, abs=1e-3)
    assert _eje("semiarco", {"ancho_m": 1.2, "alto_m": 3.0}) > alto
    # El chat manda largo_m como profundidad; con ancho y alto manda la elipse.
    assert _eje("semiarco", {"ancho_m": 1.2, "alto_m": 2.2, "largo_m": 0.5}) == pytest.approx(alto)
    assert _eje("semiarco", {"largo_m": 3.0}) == 3.0
    assert _eje("semiarco", {"ancho_m": 2.4}) == 2.4
    assert _eje("guirnalda", {"largo_m": 2.5, "alto_m": 2.2}) == 2.5
    eje_semiarco, semiarco = _despiece_with_plan_sizes(
        {}, _estructura("semiarco", {"ancho_m": 1.2, "alto_m": 2.2}, UN_MATERIAL)
    )[:2]
    eje_columna, columna = _despiece_with_plan_sizes(
        {}, _estructura("columna", {"alto_m": 1.8}, UN_MATERIAL)
    )[:2]
    assert eje_semiarco > eje_columna
    assert _total(semiarco) > _total(columna)


def test_dos_materiales_del_mismo_color_son_dos_productos() -> None:
    # Regresión I12: cada línea conserva su material, antes se unían por color.
    materiales: list[dict[str, object]] = [
        {"color": "azul", "participacion": 0.6},
        {"color": "azul", "participacion": 0.4},
    ]
    lineas = _lineas(
        _estructura("columna", {"alto_m": 1.8}, materiales, mezcla="clasica"),
    )
    por_material = _agrupar(lineas, "material_index")
    assert por_material[0] > por_material[1] > 0
    assert por_material[0] + por_material[1] == _total(lineas)


def test_los_tamanos_obligatorios_renormalizan_la_mezcla_y_el_total() -> None:
    # La mezcla efectiva son los tamaños de la mezcla dentro del conjunto
    # pedido, renormalizados a 1; si ninguno está, partes iguales entre los
    # pedidos. El total sale de esa mezcla efectiva, así que el arco deja de
    # cotizarse a la mitad (R-12 solo) y un tamaño fuera de la mezcla deja de
    # multiplicarlo.
    def total(mezcla: str, *tamanos: int) -> int:
        estructura = _estructura("arco", ARCO, UN_MATERIAL, mezcla=mezcla)
        return _total(_lineas(estructura, _plan_con_tamanos(*tamanos)))

    assert total("organica_fina") == 119
    assert total("organica_fina", 12) == 104, "antes 65: el total salía de la mezcla completa"
    assert total("organica_fina", 12, 18) == 94, "antes 71"
    assert total("clasica", 18, 24) == 64, "antes 264: proporción 1 por tamaño"
    assert total("organica_fina", 36) == 35, "antes 119 globos de 36 pulgadas"
    # Un tamaño pedido que la mezcla no puede ubicar queda visible, no se pierde.
    _eje_m, lineas, sin_ubicar = _despiece_with_plan_sizes(
        _plan_con_tamanos(12, 36), _estructura("arco", ARCO, UN_MATERIAL)
    )
    assert sin_ubicar == (36,)
    assert [linea["pulgadas"] for linea in lineas] == [12]
    assert (
        _despiece_with_plan_sizes(_plan_con_tamanos(36), _estructura("arco", ARCO, UN_MATERIAL))[2]
        == ()
    ), "sin tamaños de la mezcla se reparten por partes iguales"
    # El conteo baja al crecer el diámetro exigido: es el mismo modelo de área.
    totales = [total("organica_fina", pulgadas) for pulgadas in (5, 9, 12, 18, 24)]
    assert all(
        actual < totales[indice - 1] for indice, actual in enumerate(totales) if indice > 0
    ), totales


def test_un_reparto_imposible_lanza_el_error_tipado() -> None:
    # `calcularMedidas` con proporciones que no suman 1 (el caso de los tamaños
    # obligatorios sin renormalizar): las cuotas no suman el total y se falla en
    # vez de inventar un conteo.
    proporciones = ((12, 0.5),)
    _eje_m, total = _total_globos("arco", ARCO, "media", "organica_fina", None, proporciones)
    with pytest.raises(BalloonApportionmentError):
        _apportion_margins(total, proporciones, [1.0])
    with pytest.raises(BalloonApportionmentError):
        _hamilton(10, [3.0, 3.0], [0.0, 0.0])


def test_la_mezcla_efectiva_cierra_en_todos_los_subconjuntos_de_tamanos() -> None:
    pedidos = (5, 9, 12, 18, 24, 36)
    materiales: list[dict[str, object]] = [
        {"color": "rojo", "participacion": 0.7},
        {"color": "azul", "participacion": 0.3},
    ]
    for mezcla in _MIXES:
        for mascara in range(1, 2 ** len(pedidos)):
            tamanos = [
                pulgadas for indice, pulgadas in enumerate(pedidos) if (mascara >> indice) & 1
            ]
            etiqueta = f"{mezcla} {tamanos}"
            proporciones, sin_ubicar = _effective_proportions(mezcla, set(tamanos))
            suma = sum(proporcion for _pulgadas, proporcion in proporciones)
            assert abs(suma - 1) < 1e-9, f"{etiqueta}: las proporciones suman {suma}"
            assert all(pulgadas in tamanos for pulgadas, _proporcion in proporciones), (
                f"{etiqueta}: tamaño fuera de lo pedido"
            )
            en_mezcla = [
                pulgadas for pulgadas, _proporcion in _MIXES[mezcla] if pulgadas in tamanos
            ]
            assert list(sin_ubicar) == (
                [pulgadas for pulgadas in tamanos if pulgadas not in en_mezcla] if en_mezcla else []
            )
            _eje_m, lineas, _sin_ubicar = _despiece_with_plan_sizes(
                _plan_con_tamanos(*tamanos),
                _estructura("arco", ARCO, materiales, mezcla=mezcla),
            )
            _eje_base, total_base = _total_globos("arco", ARCO, "media", mezcla, None, proporciones)
            assert _total(lineas) == total_base, etiqueta
            assert all(cast(int, linea["pulgadas"]) in tamanos for linea in lineas), (
                f"{etiqueta}: línea fuera de lo pedido"
            )


def test_el_parseo_de_los_tamanos_obligatorios_es_identico_al_de_typescript() -> None:
    # El valor es texto libre del modelo: TypeScript lo leía con Number() y
    # Python con int(), así que los dos aceptaban "R-12" y diferían en
    # decimales, exponentes, hexadecimal, subrayados, dígitos no ASCII y la
    # cadena vacía. Como la mezcla efectiva decide el TOTAL, esa diferencia
    # cambiaba conteos, costos y plan_hash entre backends.
    def tamanos(*valores: str) -> set[int]:
        plan: dict[str, object] = {
            "restricciones": {"tamanos": [{"valor": valor} for valor in valores]}
        }
        pulgadas: set[int] = _required_sizes(plan)
        return pulgadas

    assert tamanos("R-12", "r12", "18", " R-24 ", "R-12") == {12, 18, 24}
    assert (
        tamanos(
            "R-12.5",
            "R-0x0C",
            "R-1e1",
            "R-",
            "R-1_0",
            "R-١٢",
            "R-0",
            "R-1234",
            "grandes",
        )
        == set()
    ), "antes: 12.5, 12, 10 y 0 pulgadas en TypeScript; 10 pulgadas en Python"
    assert _required_sizes(
        {
            "restricciones": {
                "tamanos": [
                    {"valor": "R-12", "polaridad": "prohibido"},
                    {"valor": "R-18", "polaridad": "obligatorio"},
                ]
            }
        }
    ) == {18}
    assert _required_sizes({}) == set()
    # "R-" daba 0 pulgadas: área ponderada 0 y un arco entero sin un solo globo.
    plan: dict[str, object] = {"restricciones": {"tamanos": [{"valor": "R-"}]}}
    assert _total(_lineas(_estructura("arco", ARCO, UN_MATERIAL), plan)) == 119, "antes 0 globos"


def _diametro_efectivo_m(pulgadas: float) -> float:
    """Diámetro inflado al 92%, en metros (F_INFLADO de geometria.ts)."""
    return pulgadas * 2.54 * 0.92 / 100


def _globos_por_metro(proporciones: Sequence[tuple[int, float]]) -> float:
    area = sum(
        proporcion * math.pi * (_diametro_efectivo_m(pulgadas) / 2) ** 2
        for pulgadas, proporcion in proporciones
    )
    if not proporciones or area <= 0:
        return 0.0
    dominante = max(proporciones, key=lambda item: item[1])
    return _diametro_efectivo_m(dominante[0]) / area


def _factor_globos_por_metro(mezcla: str, proporciones: Sequence[tuple[int, float]]) -> float:
    """Réplica local de ``factorGlobosPorMetro``; ``app/plan.py`` no tiene espejo.

    λ, el ancho de banda y el perfil de la estructura oficial son los mismos en
    las dos mezclas y se cancelan, así que solo queda el diámetro dominante
    sobre el área ponderada del globo.
    """
    base = _globos_por_metro(_MIXES[mezcla])
    efectivo = _globos_por_metro(proporciones)
    return efectivo / base if base > 0 and efectivo > 0 else 1.0


def test_el_factor_de_globos_por_metro_vale_1_sin_tamanos_obligatorios() -> None:
    # La puerta física de estimacion.ts tiene umbrales calibrados con mezclas
    # dominadas por R-12: sin tamaños obligatorios la mezcla efectiva ES la del
    # plan (factor 1 exacto) y la puerta no cambia para los planes de siempre.
    for mezcla in _MIXES:
        proporciones, sin_ubicar = _effective_proportions(mezcla, set())
        assert proporciones == _MIXES[mezcla], mezcla
        assert sin_ubicar == ()
        assert _factor_globos_por_metro(mezcla, proporciones) == 1.0, mezcla
        for tamanos in ([5], [9], [12], [18], [24], [36], [12, 18], [18, 24], [5, 9, 12]):
            efectivas, _sin_ubicar = _effective_proportions(mezcla, set(tamanos))
            factor = _factor_globos_por_metro(mezcla, efectivas)
            completo = _total(_lineas(_estructura("arco", ARCO, UN_MATERIAL, mezcla=mezcla)))
            restringido = _total(
                _lineas(
                    _estructura("arco", ARCO, UN_MATERIAL, mezcla=mezcla),
                    _plan_con_tamanos(*tamanos),
                )
            )
            assert factor > 0, f"{mezcla} {tamanos}: factor {factor}"
            assert abs(restringido - completo * factor) <= 1 + factor, (
                f"{mezcla} {tamanos}: {restringido} globos frente a {completo} × {factor}"
            )


FIGURAS: list[tuple[str, dict[str, float], int]] = [
    ("arco", {"ancho_m": 3, "alto_m": 2.4}, 1),
    ("columna", {"alto_m": 1.8}, 3),
    ("guirnalda", {"largo_m": 2.5}, 2),
    ("centro_mesa", {"ancho_m": 0.4, "alto_m": 0.5}, 10),
    ("pared", {"ancho_m": 2.4, "alto_m": 2.4}, 1),
]
REPARTOS: list[list[float]] = [
    [1.0],
    [0.5, 0.5],
    [0.6, 0.4],
    [0.7, 0.2, 0.1],
    [0.34, 0.33, 0.33],
    [0.4, 0.3, 0.2, 0.1],
    [0.97, 0.01, 0.01, 0.01],
]
DENSIDADES = ("sencilla", "media", "lujosa")


@pytest.mark.parametrize("tipo, medidas, repeticiones", FIGURAS)
def test_los_dos_margenes_cierran_exactos_en_cada_figura(
    tipo: str, medidas: dict[str, float], repeticiones: int
) -> None:
    # El total por tamaño no depende de cuántos colores tenga la estructura
    # (antes un segundo color borraba el acento R-24) y el total por material se
    # queda a menos de una unidad de su participación en cada instancia.
    for mezcla in _MIXES:
        for densidad in DENSIDADES:
            referencia = _lineas(
                _estructura(tipo, medidas, UN_MATERIAL, densidad=densidad, mezcla=mezcla)
            )
            referencia_por_tamano = _agrupar(referencia, "pulgadas")
            total_referencia = _total(referencia)
            for participaciones in REPARTOS:
                materiales: list[dict[str, object]] = [
                    {"color": f"color-{indice}", "participacion": participacion}
                    for indice, participacion in enumerate(participaciones)
                ]
                etiqueta = f"{tipo}/{mezcla}/{densidad}/{len(participaciones)} materiales"
                lineas = _lineas(
                    _estructura(
                        tipo,
                        medidas,
                        materiales,
                        repeticiones=repeticiones,
                        densidad=densidad,
                        mezcla=mezcla,
                    )
                )
                # TypeScript devuelve la matriz completa con celdas en 0; Python
                # omite las vacías, así que se comprueba celda a celda.
                celdas = [(linea["pulgadas"], linea["material_index"]) for linea in lineas]
                assert len(celdas) == len(set(celdas)), etiqueta
                assert len(celdas) <= len(_MIXES[mezcla]) * len(participaciones), etiqueta
                assert all(cast(int, linea["cantidad"]) > 0 for linea in lineas), etiqueta
                assert _total(lineas) == total_referencia * repeticiones, etiqueta
                por_tamano = _agrupar(lineas, "pulgadas")
                por_material = _agrupar(lineas, "material_index")
                for pulgadas, _proporcion in _MIXES[mezcla]:
                    assert (
                        por_tamano.get(pulgadas, 0)
                        == referencia_por_tamano.get(pulgadas, 0) * repeticiones
                    ), f"{etiqueta}: R-{pulgadas} depende del número de colores"
                for indice, participacion in enumerate(participaciones):
                    cantidad = por_material.get(indice, 0)
                    esperado = total_referencia * participacion
                    assert abs(cantidad / repeticiones - esperado) < 1, (
                        f"{etiqueta}: material {indice} con {cantidad / repeticiones}"
                        f" frente a {esperado}"
                    )
