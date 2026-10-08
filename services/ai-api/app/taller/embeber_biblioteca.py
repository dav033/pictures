"""Embeddings por lotes de la biblioteca del taller (REQ-002, paso 3): texto de la ficha, foto y render del item.

Seco por omision: ``python -m app.taller.embeber_biblioteca`` solo cuenta y estima. Una corrida real exige
``--ejecutar --tope-usd N``; se rechaza si lo pendiente estimado pasa el tope y se detiene sola si el gasto
corriente lo alcanzaria. Cache incremental en ``data/taller/embeddings/`` (ver ``cache_vectores.py``) y registro
de gasto en ``data/taller/gasto-embeddings.jsonl``. La clave de Gemini sale de ``GEMINI_API_KEY`` y nunca se imprime.

    python -m app.taller.embeber_biblioteca                                   # seco: conteos y USD estimados
    python -m app.taller.embeber_biblioteca --ejecutar --tope-usd 0.50 --modalidades texto
    python -m app.taller.embeber_biblioteca --ejecutar --tope-usd 2 --descargar --fotos-dir <lote-01>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sys
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.taller.cache_vectores import MODALIDADES, CacheVectores
from app.taller.cliente_embeddings import DIMENSIONES, MODELO, ClienteEmbeddings, ClienteGemini
from app.taller.costo_embeddings import Presupuesto, RegistroGasto
from app.taller.insumos_biblioteca import descargar_foto, leer_fichas, leer_manifest_renders, preparar_imagen
from app.taller.plan_embeddings import Plan, Tarea, construir_plan, formatear_plan

RAIZ_REPO = Path(__file__).resolve().parents[4]
DATOS = RAIZ_REPO / "data" / "taller"
VOLCAR_CADA = 100


@dataclass
class ResultadoCorrida:
    exitos: int = 0
    fallos: list[dict[str, str]] = field(default_factory=list)
    gastado_usd: float = 0.0
    detenida_por_tope: bool = False
    por_modalidad: dict[str, int] = field(default_factory=lambda: defaultdict(int))


async def ejecutar_plan(
    plan: Plan,
    cliente: ClienteEmbeddings,
    cache: CacheVectores,
    presupuesto: Presupuesto,
    registro: RegistroGasto,
    concurrencia: int = 4,
    carpeta_descargas: Path | None = None,
    http: httpx.AsyncClient | None = None,
) -> ResultadoCorrida:
    resultado = ResultadoCorrida()
    cola: asyncio.Queue[Tarea] = asyncio.Queue()
    for tarea in plan.tareas:
        cola.put_nowait(tarea)
    sin_volcar: dict[str, list[float]] = defaultdict(lambda: [0, 0.0])
    unidad_de: dict[str, str] = {}

    def volcar() -> None:
        for modalidad, (unidades, usd) in sin_volcar.items():
            registro.registrar(modalidad, int(unidades), usd, unidad_de[modalidad])
        sin_volcar.clear()

    async def trabajador() -> None:
        while not cola.empty() and not resultado.detenida_por_tope:
            tarea = cola.get_nowait()
            if not presupuesto.reservar(tarea.usd):
                resultado.detenida_por_tope = True
                return
            try:
                vector = await _embeber(tarea, cliente, carpeta_descargas, http)
                cache.agregar(tarea.id, tarea.modalidad, plan.modelo, plan.dims, tarea.hash_entrada, vector)
            except Exception as error:
                presupuesto.liberar(tarea.usd)
                resultado.fallos.append({"id": tarea.id, "modalidad": tarea.modalidad, "error": _mensaje(error)})
                continue
            presupuesto.confirmar(tarea.usd)
            resultado.exitos += 1
            resultado.por_modalidad[tarea.modalidad] += 1
            unidad_de[tarea.modalidad] = tarea.unidad
            acumulado = sin_volcar[tarea.modalidad]
            acumulado[0] += tarea.unidades
            acumulado[1] += tarea.usd
            if resultado.exitos % VOLCAR_CADA == 0:
                volcar()

    try:
        await asyncio.gather(*(trabajador() for _ in range(max(1, concurrencia))))
    finally:
        volcar()
    resultado.gastado_usd = presupuesto.gastado_usd
    return resultado


async def _embeber(
    tarea: Tarea, cliente: ClienteEmbeddings, carpeta_descargas: Path | None, http: httpx.AsyncClient | None
) -> Sequence[float]:
    if tarea.texto is not None:
        vector_texto: Sequence[float] = await cliente.embeber_texto(tarea.texto)
        return vector_texto
    if tarea.render is not None:
        datos = tarea.render.read_bytes()
    elif tarea.foto is not None and tarea.foto.clase == "archivo":
        datos = Path(tarea.foto.valor).read_bytes()
    elif tarea.foto is not None and http is not None and carpeta_descargas is not None:
        datos = await descargar_foto(tarea.foto.valor, carpeta_descargas, http)
    else:
        raise RuntimeError("FOTO_SIN_FORMA_DE_OBTENERLA")
    imagen, mime = await asyncio.to_thread(preparar_imagen, datos)
    vector: Sequence[float] = await cliente.embeber_imagen(imagen, mime)
    return vector


def _mensaje(error: Exception) -> str:
    return f"{type(error).__name__}: {error}"[:300]


def _parsear(argv: Sequence[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Embeddings de la biblioteca del taller (seco por omision).")
    p.add_argument("--fichas", type=Path, default=DATOS / "fichas.jsonl")
    p.add_argument("--manifest-renders", type=Path, default=DATOS / "renders" / "manifest.json")
    p.add_argument("--salida", type=Path, default=DATOS / "embeddings", help="carpeta de la cache de vectores")
    p.add_argument("--gasto-log", type=Path, default=DATOS / "gasto-embeddings.jsonl")
    p.add_argument("--fotos-dir", type=Path, default=None, help="carpeta de fotos locales (fotos del dueno: NN-*.jpg)")
    p.add_argument("--descargar", action="store_true", help="permite bajar las fotos que son URL (por omision se omiten)")
    p.add_argument("--modalidades", default=",".join(MODALIDADES), help="lista separada por comas")
    p.add_argument("--limite", type=int, default=None, help="maximo de llamadas por modalidad (pruebas de humo)")
    modo = p.add_mutually_exclusive_group()
    modo.add_argument("--dry-run", action="store_true", help="(por omision) solo cuenta y estima")
    modo.add_argument("--ejecutar", action="store_true", help="llama a Gemini de verdad (exige --tope-usd)")
    p.add_argument("--tope-usd", type=float, default=None, help="tope duro de gasto estimado de esta corrida")
    p.add_argument("--concurrencia", type=int, default=4)
    return p.parse_args(argv)


def main(argv: Sequence[str] | None = None, cliente: ClienteEmbeddings | None = None) -> int:
    args = _parsear(argv)
    modalidades = [m.strip() for m in args.modalidades.split(",") if m.strip()]
    desconocidas = sorted(set(modalidades) - set(MODALIDADES))
    if desconocidas:
        print(f"Modalidades desconocidas: {', '.join(desconocidas)}. Validas: {', '.join(MODALIDADES)}", file=sys.stderr)
        return 2
    if args.ejecutar and (args.tope_usd is None or args.tope_usd <= 0):
        print("Una corrida real exige --tope-usd N (N > 0).", file=sys.stderr)
        return 2
    if not args.fichas.exists():
        print(f"No existe {args.fichas}. Generalo con scripts/taller/extraer-biblioteca.ts.", file=sys.stderr)
        return 2

    cache = CacheVectores(args.salida)
    renders = leer_manifest_renders(args.manifest_renders)
    fichas = leer_fichas(args.fichas)
    print(f"{len(fichas)} fichas, {len(renders)} renders en el manifest, {len(cache)} vectores en la cache.")
    plan = construir_plan(
        fichas, renders, cache, MODELO, DIMENSIONES, modalidades,
        fotos_dir=args.fotos_dir, descargar=args.descargar, limite=args.limite,
    )
    print(formatear_plan(plan, args.tope_usd))

    if not args.ejecutar:
        print("Seco: no se llamo a ningun modelo. Para ejecutar: --ejecutar --tope-usd N.")
        return 0
    if plan.usd_total > args.tope_usd:
        print(
            f"Rechazado: lo pendiente cuesta ~{plan.usd_total:.4f} USD y el tope es {args.tope_usd:.4f}. "
            "Sube el tope o acota con --modalidades / --limite.",
            file=sys.stderr,
        )
        return 3
    if not plan.tareas:
        print("Nada pendiente.")
        return 0
    if cliente is None:
        llave = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
        if not llave.strip():
            print("Falta GEMINI_API_KEY (o GOOGLE_API_KEY) en el entorno.", file=sys.stderr)
            return 2
        cliente = ClienteGemini(llave)
    return asyncio.run(_correr(plan, cliente, cache, args))


async def _correr(plan: Plan, cliente: ClienteEmbeddings, cache: CacheVectores, args: argparse.Namespace) -> int:
    run_id = f"emb-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{secrets.token_hex(2)}"
    print(f"Corrida {run_id}: {len(plan.tareas)} llamadas, concurrencia {args.concurrencia}, tope {args.tope_usd} USD.")
    registro = RegistroGasto(args.gasto_log, run_id, plan.modelo)
    async with httpx.AsyncClient() as http:
        resultado = await ejecutar_plan(
            plan, cliente, cache, Presupuesto(args.tope_usd), registro, args.concurrencia,
            carpeta_descargas=args.salida / "descargas", http=http,
        )
    print(f"Listo: {resultado.exitos} vectores nuevos {dict(resultado.por_modalidad)}, gasto estimado {resultado.gastado_usd:.4f} USD.")
    if resultado.detenida_por_tope:
        print("Detenida porque el siguiente paso pasaba el tope; vuelve a correr con otro tope para seguir (la cache retoma).")
    if resultado.fallos:
        ruta = args.salida / "fallos.jsonl"
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text("".join(json.dumps(f, ensure_ascii=False) + "\n" for f in resultado.fallos), encoding="utf-8")
        print(f"{len(resultado.fallos)} fallos (ver {ruta}); se reintentan al volver a correr.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    getattr(sys.stdout, "reconfigure", lambda **_: None)(encoding="utf-8")
    raise SystemExit(main())
