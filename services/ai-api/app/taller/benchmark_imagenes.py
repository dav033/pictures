"""Benchmark de busqueda por imagen con las 13 fotos del dueno (REQ-002, plan §7), sobre vectores ya en cache.

Consulta = el vector de la foto del dueno (modalidad ``imagen_foto`` de la escena ``referencia:*``). Acierto = cualquiera
de los vectores del item correcto (o de sus piezas derivadas ``referencia:x~...``) entre los k primeros, deduplicados
por item. La foto del dueno NO entra al conjunto de busqueda (seria un acierto trivial): el item correcto solo puede
aparecer por su render (o su ficha). Escenarios:

* ``foto -> imagenes``: fotos de todos los items + renders.
* ``foto -> render``: solo renders (dominio foto <-> 3D).
* ``foto -> texto``: fichas (cruzado, solo modelos multimodales).

    python -m app.taller.benchmark_imagenes [--modelo gemini-embedding-2] [--dims 768] [--json salida.json]

Para comparar un segundo modelo (SigLIP2, DINOv2 local) basta producir sus vectores en la MISMA cache con otro
``modelo`` (``CacheVectores.agregar(id, modalidad, "dinov2-base", 768, hash_entrada, vector)``; las dimensiones
pueden diferir porque el ``offset`` es en bytes) y correr este modulo con ``--modelo dinov2-base --dims 768``. No se
incluye ese cliente: ``torch``/``transformers`` ya estan en el proyecto, pero el modelo no esta decidido (la decision
depende de este mismo benchmark) y solo cubre imagenes, no las fichas.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.taller.cache_vectores import CacheVectores
from app.taller.cliente_embeddings import DIMENSIONES, MODELO
from app.taller.insumos_biblioteca import leer_fichas, numero_foto_dueno

RAIZ_REPO = Path(__file__).resolve().parents[4]
DATOS = RAIZ_REPO / "data" / "taller"
KS = (1, 3, 5)
ESCENARIOS: dict[str, frozenset[str]] = {
    "foto -> imagenes": frozenset({"imagen_foto", "imagen_render"}),
    "foto -> render": frozenset({"imagen_render"}),
    "foto -> texto": frozenset({"texto"}),
}


@dataclass(frozen=True, slots=True)
class VectorItem:
    item: str
    modalidad: str
    vector: np.ndarray


@dataclass
class ResultadoEscenario:
    nombre: str
    evaluadas: int = 0
    aciertos: dict[int, int] = field(default_factory=dict)
    mrr: float = 0.0
    sin_objetivo: list[str] = field(default_factory=list)
    detalle: dict[str, list[tuple[str, str, float, bool]]] = field(default_factory=dict)
    rango: dict[str, int | None] = field(default_factory=dict)

    def hit(self, k: int) -> float:
        return self.aciertos.get(k, 0) / self.evaluadas if self.evaluadas else 0.0


def _unitario(matriz: np.ndarray) -> np.ndarray:
    normas = np.linalg.norm(matriz, axis=-1, keepdims=True)
    normas[normas == 0] = 1.0
    unitaria: np.ndarray = matriz / normas
    return unitaria


def ranking_por_item(consulta: np.ndarray, pool: Sequence[VectorItem]) -> list[tuple[str, str, float]]:
    """Items ordenados por su mejor similitud coseno: ``(item, modalidad del mejor vector, similitud)``."""
    if not pool:
        return []
    similitudes = _unitario(np.stack([v.vector for v in pool])) @ _unitario(consulta)
    mejor: dict[str, tuple[float, str]] = {}
    for vector, similitud in zip(pool, similitudes, strict=True):
        actual = mejor.get(vector.item)
        if actual is None or similitud > actual[0]:
            mejor[vector.item] = (float(similitud), vector.modalidad)
    return sorted(((item, modalidad, s) for item, (s, modalidad) in mejor.items()), key=lambda f: -f[2])


def evaluar_escenario(
    nombre: str,
    consultas: Mapping[str, np.ndarray],
    pool: Sequence[VectorItem],
    verdad: Mapping[str, set[str]],
    ks: Sequence[int] = KS,
    top_detalle: int = 3,
) -> ResultadoEscenario:
    """``consultas`` y ``verdad`` van por la misma clave (p. ej. el numero de foto). Sin objetivo en el pool -> se aparta."""
    resultado = ResultadoEscenario(nombre, aciertos={k: 0 for k in ks})
    items_en_pool = {v.item for v in pool}
    for clave, consulta in consultas.items():
        correctos = verdad.get(clave, set()) & items_en_pool
        if not correctos:
            resultado.sin_objetivo.append(clave)
            continue
        ranking = ranking_por_item(consulta, pool)
        resultado.evaluadas += 1
        rango = next((i + 1 for i, (item, _, _) in enumerate(ranking) if item in correctos), None)
        resultado.rango[clave] = rango
        for k in ks:
            if rango is not None and rango <= k:
                resultado.aciertos[k] += 1
        resultado.mrr += 1.0 / rango if rango else 0.0
        resultado.detalle[clave] = [(item, mod, s, item in correctos) for item, mod, s in ranking[:top_detalle]]
    if resultado.evaluadas:
        resultado.mrr /= resultado.evaluadas
    return resultado


def verdad_del_dueno(fichas_dueno: Mapping[int, str], ids_conocidos: Sequence[str], con_derivados: bool = True) -> dict[str, set[str]]:
    """``{str(numero): {id de la escena y, si se pide, ids de sus piezas ``escena~...``}}``."""
    verdad: dict[str, set[str]] = {}
    for numero, escena in fichas_dueno.items():
        grupo = {escena}
        if con_derivados:
            grupo |= {i for i in ids_conocidos if i.startswith(escena + "~")}
        verdad[str(numero)] = grupo
    return verdad


def cargar_vectores(cache: CacheVectores, modelo: str, dims: int) -> list[VectorItem]:
    return [
        VectorItem(e.id, e.modalidad, np.asarray(cache.leer(e), dtype=np.float32))
        for e in cache.entradas(modelo, dims)
    ]


def correr(
    cache: CacheVectores, fichas_jsonl: Path, modelo: str, dims: int, con_derivados: bool = True
) -> tuple[list[ResultadoEscenario], list[str]]:
    fichas = leer_fichas(fichas_jsonl)
    escena_de = {n: f.id for f in fichas if (n := numero_foto_dueno(f)) is not None}
    ids_dueno = {f.id for f in fichas if f.fuente_tipo == "referencia-dueno"}
    todos = cargar_vectores(cache, modelo, dims)
    numero_de = {escena: numero for numero, escena in escena_de.items()}
    consultas = {
        str(numero_de[v.item]): v.vector for v in todos if v.modalidad == "imagen_foto" and v.item in numero_de
    }
    faltan = [str(n) for n in sorted(escena_de) if str(n) not in consultas]
    base = [v for v in todos if not (v.modalidad == "imagen_foto" and v.item in ids_dueno)]
    verdad = verdad_del_dueno(escena_de, [f.id for f in fichas], con_derivados)
    resultados = [
        evaluar_escenario(nombre, consultas, [v for v in base if v.modalidad in modalidades], verdad)
        for nombre, modalidades in ESCENARIOS.items()
    ]
    return resultados, faltan


def formatear(resultados: Sequence[ResultadoEscenario], faltan: Sequence[str], ks: Sequence[int] = KS) -> str:
    lineas: list[str] = []
    if faltan:
        lineas.append(
            f"Sin vector de foto para las fotos {', '.join(faltan)}: corre embeber_biblioteca con --fotos-dir "
            "(modalidad imagen_foto)."
        )
    encabezado = "".join(f"{'Hit@' + str(k):>8}" for k in ks)
    lineas.append(f"{'escenario':<20}{'consultas':>10}{encabezado}{'MRR':>8}")
    for r in resultados:
        celdas = "".join(f"{r.aciertos.get(k, 0):>5}/{r.evaluadas:<2}" for k in ks)
        lineas.append(f"{r.nombre:<20}{r.evaluadas:>10} {celdas}{r.mrr:>8.3f}")
        if r.sin_objetivo:
            lineas.append(f"  sin objetivo en el conjunto (no cuentan): fotos {', '.join(sorted(r.sin_objetivo, key=int))}")
    for r in resultados:
        if not r.detalle:
            continue
        lineas.append(f"\nConfusion {r.nombre} (top-3 por foto; * = item correcto):")
        for clave in sorted(r.detalle, key=int):
            rango = r.rango[clave]
            top = "  ".join(f"{'*' if ok else ' '}{item} [{mod}] {s:.3f}" for item, mod, s, ok in r.detalle[clave])
            lineas.append(f"  foto {clave:>2} (rango {rango if rango else '>pool'}): {top}")
    return "\n".join(lineas)


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Benchmark foto -> items con las 13 fotos del dueno.")
    p.add_argument("--cache", type=Path, default=DATOS / "embeddings")
    p.add_argument("--fichas", type=Path, default=DATOS / "fichas.jsonl")
    p.add_argument("--modelo", default=MODELO)
    p.add_argument("--dims", type=int, default=DIMENSIONES)
    p.add_argument("--sin-derivados", action="store_true", help="solo cuenta la escena, no sus piezas derivadas")
    p.add_argument("--json", type=Path, default=None, help="guarda las metricas en este archivo")
    args = p.parse_args(argv)
    if not args.fichas.exists() or not (args.cache / "indice.jsonl").exists():
        print("Falta data/taller/fichas.jsonl o la cache de vectores (embeber_biblioteca).", file=sys.stderr)
        return 2
    resultados, faltan = correr(CacheVectores(args.cache), args.fichas, args.modelo, args.dims, not args.sin_derivados)
    print(formatear(resultados, faltan))
    if args.json:
        salida = [
            {"escenario": r.nombre, "evaluadas": r.evaluadas, "hit": {str(k): r.aciertos[k] for k in r.aciertos},
             "mrr": r.mrr, "sin_objetivo": r.sin_objetivo, "rango": r.rango}
            for r in resultados
        ]
        args.json.write_text(json.dumps(salida, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    raise SystemExit(main())
