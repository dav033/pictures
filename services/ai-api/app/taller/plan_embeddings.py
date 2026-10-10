"""Plan de embeddings de la biblioteca: qué hay, qué ya está en la caché y qué costaría llamar. No llama a nadie."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from app.taller.cache_vectores import MODALIDADES, CacheVectores
from app.taller.costo_embeddings import USD_POR_IMAGEN, tokens_estimados, usd_de_tokens
from app.taller.insumos_biblioteca import (
    Ficha,
    FotoRef,
    hash_entrada_archivo,
    hash_entrada_texto,
    hash_entrada_url,
    resolver_foto,
)

TAREA_DOCUMENTO = "RETRIEVAL_DOCUMENT"
OMITIDO_URL_SIN_DESCARGA = "url_sin_--descargar"


@dataclass(frozen=True, slots=True)
class Tarea:
    id: str
    modalidad: str
    hash_entrada: str
    usd: float
    unidades: int
    unidad: str
    texto: str | None = None
    foto: FotoRef | None = None
    render: Path | None = None


@dataclass
class ResumenModalidad:
    modalidad: str
    total: int = 0
    en_cache: int = 0
    pendientes: list[Tarea] = field(default_factory=list)
    omitidos: Counter[str] = field(default_factory=Counter)
    potencial_url: list[Tarea] = field(default_factory=list)

    @property
    def con_insumo(self) -> int:
        return self.en_cache + len(self.pendientes)

    @property
    def usd_pendiente(self) -> float:
        return sum(t.usd for t in self.pendientes)

    @property
    def unidades_pendientes(self) -> int:
        return sum(t.unidades for t in self.pendientes)


@dataclass
class Plan:
    modelo: str
    dims: int
    por_modalidad: dict[str, ResumenModalidad]

    @property
    def tareas(self) -> list[Tarea]:
        return [
            t
            for m in MODALIDADES
            if m in self.por_modalidad
            for t in self.por_modalidad[m].pendientes
        ]

    @property
    def usd_total(self) -> float:
        return sum(r.usd_pendiente for r in self.por_modalidad.values())


def construir_plan(
    fichas: Sequence[Ficha],
    renders: dict[str, Path],
    cache: CacheVectores,
    modelo: str,
    dims: int,
    modalidades: Sequence[str] = MODALIDADES,
    fotos_dir: Path | None = None,
    descargar: bool = False,
    limite: int | None = None,
) -> Plan:
    plan = Plan(modelo, dims, {m: ResumenModalidad(m) for m in MODALIDADES if m in modalidades})
    for ficha in fichas:
        if "texto" in plan.por_modalidad:
            _planear_texto(plan.por_modalidad["texto"], ficha, cache, modelo, dims)
        if "imagen_render" in plan.por_modalidad:
            _planear_render(
                plan.por_modalidad["imagen_render"], ficha, renders, cache, modelo, dims
            )
        if "imagen_foto" in plan.por_modalidad:
            _planear_foto(
                plan.por_modalidad["imagen_foto"], ficha, fotos_dir, descargar, cache, modelo, dims
            )
    if limite is not None:
        for resumen in plan.por_modalidad.values():
            del resumen.pendientes[limite:]
    return plan


def _planear_texto(
    resumen: ResumenModalidad, ficha: Ficha, cache: CacheVectores, modelo: str, dims: int
) -> None:
    resumen.total += 1
    if not ficha.texto.strip():
        resumen.omitidos["ficha_vacia"] += 1
        return
    hash_entrada = hash_entrada_texto(ficha.texto, TAREA_DOCUMENTO)
    if cache.acierto(ficha.id, "texto", modelo, dims, hash_entrada):
        resumen.en_cache += 1
        return
    tokens = tokens_estimados(ficha.texto)
    resumen.pendientes.append(
        Tarea(
            ficha.id,
            "texto",
            hash_entrada,
            usd_de_tokens(tokens),
            tokens,
            "tokens_est",
            texto=ficha.texto,
        )
    )


def _planear_render(
    resumen: ResumenModalidad,
    ficha: Ficha,
    renders: dict[str, Path],
    cache: CacheVectores,
    modelo: str,
    dims: int,
) -> None:
    resumen.total += 1
    ruta = renders.get(ficha.id)
    if ruta is None:
        resumen.omitidos["sin_render_en_manifest"] += 1
        return
    if not ruta.is_file():
        resumen.omitidos["archivo_de_render_inexistente"] += 1
        return
    hash_entrada = hash_entrada_archivo(ruta)
    if cache.acierto(ficha.id, "imagen_render", modelo, dims, hash_entrada):
        resumen.en_cache += 1
        return
    resumen.pendientes.append(
        Tarea(ficha.id, "imagen_render", hash_entrada, USD_POR_IMAGEN, 1, "imagen", render=ruta)
    )


def _planear_foto(
    resumen: ResumenModalidad,
    ficha: Ficha,
    fotos_dir: Path | None,
    descargar: bool,
    cache: CacheVectores,
    modelo: str,
    dims: int,
) -> None:
    resumen.total += 1
    foto = resolver_foto(ficha, fotos_dir)
    if foto is None:
        resumen.omitidos["archivo_de_foto_inexistente" if ficha.foto else "sin_foto"] += 1
        return
    hash_entrada = (
        hash_entrada_url(foto.valor)
        if foto.clase == "url"
        else hash_entrada_archivo(Path(foto.valor))
    )
    if cache.acierto(ficha.id, "imagen_foto", modelo, dims, hash_entrada):
        resumen.en_cache += 1
        return
    tarea = Tarea(ficha.id, "imagen_foto", hash_entrada, USD_POR_IMAGEN, 1, "imagen", foto=foto)
    if foto.clase == "url" and not descargar:
        resumen.omitidos[OMITIDO_URL_SIN_DESCARGA] += 1
        resumen.potencial_url.append(tarea)
        return
    resumen.pendientes.append(tarea)


def formatear_plan(plan: Plan, tope_usd: float | None = None) -> str:
    lineas = [
        f"Modelo {plan.modelo} @ {plan.dims} dims, coseno.",
        f"{'modalidad':<14}{'total':>7}{'en caché':>10}{'pendientes':>12}{'omitidos':>10}{'unidades':>11}{'USD est.':>11}",
    ]
    for resumen in plan.por_modalidad.values():
        omitidos = sum(resumen.omitidos.values())
        unidad = "tok" if resumen.modalidad == "texto" else "img"
        lineas.append(
            f"{resumen.modalidad:<14}{resumen.total:>7}{resumen.en_cache:>10}{len(resumen.pendientes):>12}"
            f"{omitidos:>10}{resumen.unidades_pendientes:>8} {unidad}{resumen.usd_pendiente:>11.4f}"
        )
    lineas.append(
        f"{'TOTAL':<14}{'':>7}{'':>10}{len(plan.tareas):>12}{'':>10}{'':>12}{plan.usd_total:>11.4f}"
    )
    for resumen in plan.por_modalidad.values():
        for motivo, cantidad in sorted(resumen.omitidos.items()):
            lineas.append(f"  omitidos en {resumen.modalidad}: {motivo} = {cantidad}")
        if resumen.potencial_url:
            extra = sum(t.usd for t in resumen.potencial_url)
            lineas.append(
                f"  con --descargar se sumarían {len(resumen.potencial_url)} llamadas de {resumen.modalidad} (USD {extra:.4f})"
            )
    if tope_usd is not None:
        veredicto = (
            "dentro del tope" if plan.usd_total <= tope_usd else "EXCEDE el tope: no se ejecutaría"
        )
        lineas.append(f"Tope {tope_usd:.4f} USD: {veredicto}.")
    return "\n".join(lineas)
