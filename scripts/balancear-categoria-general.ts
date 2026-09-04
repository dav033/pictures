// Promueve fotos de "no_asignada" a "general" (la base del LoRA) buscando que los acabados
// Sempertex realmente visibles queden lo más parejos posible entre sí -- en vez de aceptar todo
// lo disponible (que arrastraría el mismo desbalance que ya hay en el dataset), se limita cada
// acabado a un tope fijo (TARGET_POR_ACABADO). Los acabados escasos (menos oferta que el tope)
// aportan todo lo que tienen igual; los abundantes se recortan hasta el tope. Lo que sobra de
// acabados abundantes se queda en "no_asignada", disponible para revisión temática o para una
// futura pasada con más margen.
//
// El primer intento usó un tope automático = oferta del acabado más escaso entre candidatas,
// pero con CRISTAL/SILK teniendo 2-3 fotos en todo el dataset eso dejaba "general" en 13 fotos
// -- muy poco volumen. Con tope fijo, los acabados escasos igual aportan todo lo que tienen (no
// se recortan a la baja), solo se recorta lo abundante.
//
// Candidatas: feedback.categoria === "no_asignada" && feedback.aptoParaEntrenamiento === true.
// Fotos candidatas sin ningún acabado Sempertex reconocido (globo sin match de acabado, o sin
// productos representados) no se tocan -- no aportan ni restan al balance, quedan para que el
// panel las categorice a mano.
//
// Idempotente en el sentido de que correrlo dos veces seguidas no debería promover casi nada
// la segunda vez (el cupo ya estaría lleno), pero no es no-op puro: agregar fotos nuevas al
// dataset y volver a correrlo puede promover más si abre cupo en un acabado antes agotado.

// AÑADIDO (auditoría de píxeles): el balance por acabado no sirve de nada si las fotos que
// entran son inservibles técnicamente. fal.ai pide "Minimum 1024x1024px" para entrenar; por
// debajo de eso la foto se reescala hacia arriba e inventa detalle, que es exactamente lo
// contrario de enseñar un estilo. Ver la nota de MIN_PX para por qué el umbral no es 1024.
//
// El script ahora hace dos cosas, en este orden (importa: si una foto inservible ocupa cupo en
// "general", el tope se calcula mal):
//   1. PURGA: las que ya están en "general" por debajo del mínimo pasan a apto=false con nota.
//   2. PROMOCIÓN: se rellena desde "no_asignada" respetando el tope por acabado, saltando las
//      que no llegan al mínimo.
//
// Uso: npx tsx scripts/balancear-categoria-general.ts [--tope=N] [--min-px=N] [--dry-run]
//                                                     [--incluir-sin-acabado]

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FeedbackFoto } from "../src/lib/ordenes/tipos";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

function argNum(nombre: string, defecto: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return m ? Number(m.split("=")[1]) : defecto;
}

const TARGET_POR_ACABADO = argNum("tope", 30);
// 800 y no 1024 ni 900. 1024 tiraría las 154 fotos que miden exactamente 1000px (las del blog,
// tamaño web estándar), que están 2,4% por debajo -- invisible. 900 tampoco sirve: dejaba fuera
// dos fotos de 899px, a 1px del corte, cuando subir 899->1024 es un 14% de reescalado que no se
// nota. 800 separa limpio el grupo real de recortes de teléfono (<=720px, donde el reescalado ya
// es del 40%+) de todo lo demás.
const MIN_PX = argNum("min-px", 800);
const DRY_RUN = process.argv.includes("--dry-run");
const INCLUIR_SIN_ACABADO = process.argv.includes("--incluir-sin-acabado");

/** Lado corto en píxeles de la foto asociada a un feedback, o null si no se puede leer. */
async function ladoCorto(carpetaOrden: string, indice: number): Promise<number | null> {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const ruta = path.join(carpetaOrden, `foto-${indice}.${ext}`);
    try {
      const meta = await sharp(await readFile(ruta)).metadata();
      if (meta.width && meta.height) return Math.min(meta.width, meta.height);
    } catch {
      // siguiente extensión
    }
  }
  return null;
}

// Mismo vocabulario y mismo filtro anti-falsos-positivos que src/app/api/admin/ordenes/estadisticas/route.ts --
// si diverge de ahí, el conteo que ve el panel de Estadísticas y lo que hizo este script dejan de coincidir.
const ACABADO_REGEX =
  /\b(PASTEL MATE|PASTEL DUSK|LINK-O-LOON|2 CARAS|FASHION|REFLEX|METALIZADO|INFINITY|SATIN|SILK|CRISTAL)\b/i;

function acabadoDe(nombreProducto: string): string | null {
  if (!/\bGLOBO\b/i.test(nombreProducto)) return null;
  const m = nombreProducto.match(ACABADO_REGEX);
  return m ? m[1].toUpperCase() : null;
}

type Candidata = { numero: string; indice: number; rutaArchivo: string; feedback: FeedbackFoto; acabados: Set<string> };

async function main(): Promise<void> {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const candidatas: Candidata[] = [];
  const purgadas: Array<Candidata & { px: number }> = [];
  let descartadasPorPx = 0;
  const baseline = new Map<string, number>(); // acabados ya presentes en "general" (apta), sin tocar

  for (const numero of carpetas) {
    const carpetaOrden = path.join(RUTA_ORDENES, numero);
    const archivos = await readdir(carpetaOrden).catch(() => [] as string[]);
    const indices = archivos
      .map((f) => f.match(/^feedback-(\d+)\.json$/)?.[1])
      .filter((x): x is string => Boolean(x))
      .map(Number);

    for (const indice of indices) {
      const rutaArchivo = path.join(carpetaOrden, `feedback-${indice}.json`);
      let feedback: FeedbackFoto;
      try {
        feedback = JSON.parse(await readFile(rutaArchivo, "utf-8"));
      } catch {
        continue;
      }
      if (!feedback.aptoParaEntrenamiento) continue;

      const acabados = new Set<string>();
      for (const pr of feedback.productosRepresentados ?? []) {
        if (!pr.representado) continue;
        const acabado = acabadoDe(pr.producto);
        if (acabado) acabados.add(acabado);
      }

      const px = await ladoCorto(carpetaOrden, indice);
      const suficiente = px === null || px >= MIN_PX;

      if (feedback.categoria === "general") {
        if (!suficiente) {
          purgadas.push({ numero, indice, rutaArchivo, feedback, acabados, px: px! });
          continue; // no cuenta para el baseline: deja de ocupar cupo
        }
        for (const a of acabados) baseline.set(a, (baseline.get(a) ?? 0) + 1);
      } else if (feedback.categoria === "no_asignada") {
        if (!suficiente) {
          descartadasPorPx += 1;
          continue;
        }
        candidatas.push({ numero, indice, rutaArchivo, feedback, acabados });
      }
    }
  }

  console.log(`Umbral de resolución: lado corto >= ${MIN_PX}px   |   tope por acabado: ${TARGET_POR_ACABADO}`);
  console.log(`\n--- 1. purga de "general" por resolución ---`);
  if (purgadas.length === 0) {
    console.log("  nada que purgar.");
  } else {
    for (const p of purgadas) {
      console.log(`  ${p.numero}/foto-${p.indice} (${p.px}px) -> apto=false`);
      if (DRY_RUN) continue;
      const nota = `Descartada del entrenamiento por resolución: lado corto ${p.px}px, por debajo del mínimo de ${MIN_PX}px. Reescalar hacia arriba inventa detalle. La marca es reversible y el archivo no se borró.`;
      const actualizado: FeedbackFoto = {
        ...p.feedback,
        aptoParaEntrenamiento: false,
        notas: p.feedback.notas ? `${p.feedback.notas}\n${nota}` : nota,
        revisadoEn: new Date().toISOString(),
      };
      await writeFile(p.rutaArchivo, JSON.stringify(actualizado, null, 2), "utf-8");
    }
  }
  console.log(`  purgadas: ${purgadas.length}`);
  console.log(`  candidatas de no_asignada descartadas por resolución: ${descartadasPorPx}`);
  console.log(`\n--- 2. promoción de no_asignada -> general ---`);

  const conAcabado = candidatas.filter((c) => c.acabados.size > 0);
  const sinAcabado = candidatas.filter((c) => c.acabados.size === 0);

  // Oferta total por acabado entre las candidatas (cuántas fotos no_asignada distintas lo traen).
  const ofertaTotal = new Map<string, number>();
  for (const c of conAcabado) for (const a of c.acabados) ofertaTotal.set(a, (ofertaTotal.get(a) ?? 0) + 1);

  const acabadosConOferta = [...ofertaTotal.keys()];
  if (acabadosConOferta.length === 0) {
    console.log("No hay candidatas con acabado reconocido -- nada para balancear.");
    return;
  }

  const cap = TARGET_POR_ACABADO;

  const necesita = new Map<string, number>();
  for (const a of acabadosConOferta) necesita.set(a, Math.max(0, cap - (baseline.get(a) ?? 0)));

  // Oferta restante (sin reclamar) por acabado, para ir descartando candidatas ya usadas.
  const ofertaRestante = new Map<string, Candidata[]>();
  for (const a of acabadosConOferta) ofertaRestante.set(a, conAcabado.filter((c) => c.acabados.has(a)));

  const usadas = new Set<Candidata>();
  const seleccionadas: Candidata[] = [];

  for (;;) {
    const pendientes = acabadosConOferta.filter((a) => (necesita.get(a) ?? 0) > 0 && ofertaRestante.get(a)!.some((c) => !usadas.has(c)));
    if (pendientes.length === 0) break;

    // Atacar primero el acabado más apretado (menos necesidad pendiente) para no dejarlo corto.
    pendientes.sort((a, b) => necesita.get(a)! - necesita.get(b)!);
    const acabadoObjetivo = pendientes[0];

    const disponibles = ofertaRestante.get(acabadoObjetivo)!.filter((c) => !usadas.has(c));
    // Entre las disponibles para ese acabado, preferir la que además cubre más acabados
    // todavía pendientes (dos pájaros de un tiro), y como desempate la más "pura" (menos
    // acabados en total) para no gastar de más en otros que no lo necesitan.
    disponibles.sort((x, y) => {
      const pendientesX = [...x.acabados].filter((a) => (necesita.get(a) ?? 0) > 0).length;
      const pendientesY = [...y.acabados].filter((a) => (necesita.get(a) ?? 0) > 0).length;
      if (pendientesX !== pendientesY) return pendientesY - pendientesX;
      if (x.acabados.size !== y.acabados.size) return x.acabados.size - y.acabados.size;
      return x.numero.localeCompare(y.numero) || x.indice - y.indice;
    });

    const elegida = disponibles[0];
    usadas.add(elegida);
    seleccionadas.push(elegida);
    for (const a of elegida.acabados) necesita.set(a, Math.max(0, (necesita.get(a) ?? 0) - 1));
  }

  // Las candidatas SIN acabado reconocido no entran al balanceo (no hay cupo que ocupar), pero
  // eso no las hace inútiles: casi todas son arcos, guirnaldas y paredes de globos a 1200px, que
  // es exactamente lo que el LoRA base necesita. No tienen acabado porque su pedido no traía un
  // producto que matchear (varias son inscripciones a cursos). Con --incluir-sin-acabado se
  // promueven también, filtrando por que el elemento principal nombre una estructura de GLOBOS
  // -- si no, entrarían cosas como "guirnalda de banderolas" o "mesa de dulces", que son
  // decoración pero no enseñan el estilo de globos.
  if (INCLUIR_SIN_ACABADO) {
    const conGlobos = sinAcabado.filter((c) => /globo/i.test(c.feedback.elementoPrincipal ?? ""));
    const descartadas = sinAcabado.filter((c) => !/globo/i.test(c.feedback.elementoPrincipal ?? ""));
    console.log(`\n  --- sin acabado reconocido, promovidas por nombrar estructura de globos: ${conGlobos.length} ---`);
    for (const c of conGlobos) {
      console.log(`  ${c.numero}/feedback-${c.indice}.json -> general (sin acabado: "${c.feedback.elementoPrincipal}")`);
      seleccionadas.push(c);
    }
    for (const c of descartadas) {
      console.log(`  (se queda en no_asignada: ${c.numero}/foto-${c.indice} -- "${c.feedback.elementoPrincipal}" no es estructura de globos)`);
    }
  }

  for (const c of seleccionadas) {
    if (!DRY_RUN) console.log(`  ${c.numero}/feedback-${c.indice}.json -> general (${[...c.acabados].join(", ") || "sin acabado"})`);
    if (DRY_RUN) continue;
    const actualizado: FeedbackFoto = { ...c.feedback, categoria: "general", revisadoEn: new Date().toISOString() };
    await writeFile(c.rutaArchivo, JSON.stringify(actualizado, null, 2), "utf-8");
  }
  if (DRY_RUN) console.log(`\nDRY-RUN: no se escribió nada. Volvé a correr sin --dry-run para aplicar.`);

  const totalGeneralPorAcabado = new Map<string, number>();
  for (const a of acabadosConOferta) totalGeneralPorAcabado.set(a, (baseline.get(a) ?? 0) + seleccionadas.filter((c) => c.acabados.has(a)).length);

  console.log(`\nCandidatas con acabado reconocido: ${conAcabado.length}`);
  const promovidasConAcabado = seleccionadas.filter((c) => c.acabados.size > 0).length;
  const promovidasSinAcabado = seleccionadas.length - promovidasConAcabado;
  console.log(
    `Candidatas sin acabado reconocido: ${sinAcabado.length}` +
      (INCLUIR_SIN_ACABADO ? ` (${promovidasSinAcabado} promovidas, ${sinAcabado.length - promovidasSinAcabado} retenidas por no ser estructura de globos)` : ` (sin tocar, siguen en no_asignada)`),
  );
  console.log(`Tope fijo por acabado: ${cap}`);
  console.log(`Promovidas a general: ${seleccionadas.length}`);
  console.log(`Quedan en no_asignada (con acabado, no promovidas): ${conAcabado.length - promovidasConAcabado}`);
  console.log(`\nDistribución final en "general" por acabado:`);
  for (const a of acabadosConOferta.sort()) {
    console.log(`  ${a}: ${totalGeneralPorAcabado.get(a)} (oferta total entre candidatas era ${ofertaTotal.get(a)})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
