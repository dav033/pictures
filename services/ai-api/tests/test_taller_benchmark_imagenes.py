import json
from pathlib import Path

import numpy as np
import pytest

from app.taller.benchmark_imagenes import (
    VectorItem,
    correr,
    evaluar_escenario,
    formatear,
    ranking_por_item,
    verdad_del_dueno,
)
from app.taller.cache_vectores import CacheVectores

DIMS = 8


def vec(pesos: dict[int, float]) -> np.ndarray:
    v = np.zeros(DIMS, dtype=np.float32)
    for j, peso in pesos.items():
        v[j] = peso
    return v


def eje(i: int, mezcla: dict[int, float] | None = None) -> np.ndarray:
    return vec({i: 1.0, **(mezcla or {})})


def test_ranking_por_item_deduplica_por_el_mejor_vector() -> None:
    pool = [
        VectorItem("a", "imagen_foto", eje(0, {1: 1.0})),
        VectorItem("a", "imagen_render", eje(0)),
        VectorItem("b", "imagen_foto", eje(1)),
    ]

    ranking = ranking_por_item(eje(0), pool)

    assert [r[0] for r in ranking] == ["a", "b"]
    assert ranking[0][1] == "imagen_render"
    assert ranking[0][2] == pytest.approx(1.0)


def test_metricas_hit_at_k_y_mrr_sobre_vectores_sinteticos() -> None:
    pool = [VectorItem(f"i{n}", "imagen_render", eje(n)) for n in range(6)]
    consultas = {
        "1": vec({0: 1.0, 5: 0.1}),  # el correcto es i0 y va primero
        "2": vec({2: 0.8, 3: 1.0}),  # el correcto es i2 pero i3 lo supera: rango 2
        "3": vec({4: 0.5, 0: 0.9, 1: 0.8, 2: 0.7}),  # el correcto es i4: rango 4
        "4": vec({1: 0.1, 0: 2.0, 2: 1.9, 3: 1.8, 4: 1.7, 5: 1.6}),  # i1 queda último: rango 6
    }
    verdad = {"1": {"i0"}, "2": {"i2"}, "3": {"i4"}, "4": {"i1"}}

    r = evaluar_escenario("sintetico", consultas, pool, verdad, ks=(1, 3, 5))

    assert r.evaluadas == 4
    assert r.rango == {"1": 1, "2": 2, "3": 4, "4": 6}
    assert r.aciertos == {1: 1, 3: 2, 5: 3}
    assert r.mrr == pytest.approx((1 + 1 / 2 + 1 / 4 + 1 / 6) / 4)
    assert r.hit(3) == pytest.approx(0.5)
    assert [fila[0] for fila in r.detalle["2"]][:2] == ["i3", "i2"]
    assert [fila[3] for fila in r.detalle["2"]] == [False, True, False]


def test_un_grupo_de_items_correctos_cuenta_el_mejor_y_lo_que_no_esta_en_el_pool_se_aparta() -> None:
    pool = [VectorItem("esc", "imagen_render", eje(3)), VectorItem("otro", "imagen_render", eje(0))]
    consultas = {"1": eje(3), "2": eje(0)}
    verdad = {"1": {"esc", "esc~pieza"}, "2": {"sin-render"}}

    r = evaluar_escenario("grupo", consultas, pool, verdad)

    assert r.evaluadas == 1 and r.aciertos[1] == 1
    assert r.sin_objetivo == ["2"]


def test_verdad_del_dueno_incluye_o_no_las_piezas_derivadas() -> None:
    ids = ["referencia:x", "referencia:x~g", "referencia:xy", "otro"]
    assert verdad_del_dueno({1: "referencia:x"}, ids) == {"1": {"referencia:x", "referencia:x~g"}}
    assert verdad_del_dueno({1: "referencia:x"}, ids, con_derivados=False) == {"1": {"referencia:x"}}


def test_correr_usa_la_foto_del_dueno_como_consulta_y_la_excluye_del_conjunto(tmp_path: Path) -> None:
    fichas = tmp_path / "fichas.jsonl"
    registros = [
        {"id": "referencia:x", "ficha": "f", "fuente": {"tipo": "referencia-dueno", "titulo": "foto 1 del lote 1", "foto": None}},
        {"id": "referencia:x~g", "ficha": "f", "fuente": {"tipo": "referencia-dueno", "titulo": "foto 1 del lote 1", "foto": None}},
        {"id": "idea:a", "ficha": "f", "fuente": {"tipo": "idea-sempertex", "titulo": "t", "foto": "https://x/a.jpg"}},
        {"id": "idea:b", "ficha": "f", "fuente": {"tipo": "idea-sempertex", "titulo": "t", "foto": "https://x/b.jpg"}},
    ]
    fichas.write_text("".join(json.dumps(r) + "\n" for r in registros), encoding="utf-8")
    cache = CacheVectores(tmp_path / "emb")
    foto_dueno = eje(0, {1: 0.3})
    cache.agregar("referencia:x", "imagen_foto", "m", DIMS, "h", foto_dueno.tolist())  # consulta; no puede ganarse a sí misma
    cache.agregar("referencia:x~g", "imagen_render", "m", DIMS, "h", eje(0).tolist())
    cache.agregar("idea:a", "imagen_foto", "m", DIMS, "h", eje(1).tolist())
    cache.agregar("idea:b", "imagen_foto", "m", DIMS, "h", eje(2).tolist())
    cache.agregar("idea:a", "texto", "m", DIMS, "h", eje(3).tolist())

    resultados, faltan = correr(cache, fichas, "m", DIMS)

    por_nombre = {r.nombre: r for r in resultados}
    assert faltan == []
    imagenes = por_nombre["foto -> imagenes"]
    assert imagenes.evaluadas == 1 and imagenes.rango == {"1": 1}
    assert imagenes.detalle["1"][0][:2] == ("referencia:x~g", "imagen_render")
    assert por_nombre["foto -> render"].aciertos[1] == 1
    assert por_nombre["foto -> texto"].sin_objetivo == ["1"]  # ninguna ficha del dueño en el conjunto de texto
    reporte = formatear(resultados, faltan)
    assert "Hit@1" in reporte and "Confusion foto -> imagenes" in reporte and "*referencia:x~g" in reporte


def test_correr_avisa_de_las_fotos_sin_vector(tmp_path: Path) -> None:
    fichas = tmp_path / "fichas.jsonl"
    fichas.write_text(
        json.dumps({"id": "referencia:x", "ficha": "f", "fuente": {"tipo": "referencia-dueno", "titulo": "foto 3 del lote 1"}}) + "\n",
        encoding="utf-8",
    )
    cache = CacheVectores(tmp_path / "emb")

    resultados, faltan = correr(cache, fichas, "m", DIMS)

    assert faltan == ["3"]
    assert all(r.evaluadas == 0 for r in resultados)
    assert "Sin vector de foto para las fotos 3" in formatear(resultados, faltan)
