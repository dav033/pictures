import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DecoracionSempertexSchema, type DecoracionSempertex } from "../../src/lib/biblioteca-sempertex/esquemas";
import { PlanesIdeasArchivoSchema, unirAllowlist, type PlanIdeaGuardado } from "../../src/lib/plan/plan-de-idea";
import { PlanDecoracionSchema } from "../../src/lib/plan/tipos";
import { floresDeIdea } from "../../src/lib/plan/flores-pieza";

/**
 * Regenera `src/lib/biblioteca-sempertex/planes-ideas.json`: el plan EXACTO de cada idea visible de la biblioteca (la
 * entrada que Python resolvió para su `.plan.json`, sin las referencias a la foto de la biblioteca) con su snapshot y
 * sus productos. Con él, «Crear mi plan con esta idea» y «Agregar a mi plan» resuelven con Python las mismas piezas,
 * medidas, productos Sempertex y tamaños que muestra la idea (`src/lib/plan/plan-de-idea.ts`, `/api/plan-idea`).
 *
 *   npx tsx scripts/biblioteca/precomputar-planes-ideas.ts           # escribe el archivo (sin red, sin Python, sin coste)
 *   npx tsx scripts/biblioteca/precomputar-planes-ideas.ts --check   # solo compara; sale con 1 si está desfasado
 *   npx tsx --env-file=.env.local --conditions=react-server scripts/biblioteca/precomputar-planes-ideas.ts --verificar
 *       # además vuelve a resolver cada plan con el Python local (sin modelo, sin coste) y compara sus compras
 *
 * Córrelo cada vez que cambien `decoraciones.json` o los `.plan.json` (tras `construir-biblioteca-real.ts`).
 */

const RAIZ = path.resolve(__dirname, "..", "..");
export const RUTA_PLANES = path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json");
const RUTA_DECORACIONES = path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "decoraciones.json");
const RUTA_ANALISIS = path.join(RAIZ, "data", "biblioteca-real", "analisis");

// Las mismas reglas que `detalles-ideas.ts` (archivoPlanDe, leerDecoraciones), sin importarlo: ese módulo arrastra
// componentes de React y no carga con `--conditions=react-server`, que hace falta para `--verificar`.
function archivoPlanDe(decoracion: DecoracionSempertex): string | null {
  const foto = /\/referencias\/(real-\d{2}-[^/]+)\.jpg$/.exec(decoracion.fotos[0]?.url ?? "")?.[1];
  if (foto) return `${foto}.plan.json`;
  const citados = new Set(decoracion.materiales.flatMap((material) => {
    const cita = /\[data\/biblioteca-real\/analisis\/([\w.-]+\.plan\.json)\]/.exec(material.detalleCantidad ?? "")?.[1];
    return cita ? [cita] : [];
  }));
  return citados.size === 1 ? [...citados][0]! : null;
}

async function leerDecoraciones(): Promise<DecoracionSempertex[]> {
  const crudas = JSON.parse(await readFile(RUTA_DECORACIONES, "utf8")) as unknown;
  if (!Array.isArray(crudas)) throw new Error("decoraciones.json no es una lista.");
  return crudas.map((dato) => DecoracionSempertexSchema.parse(dato));
}

const MaterialSchema = z.object({ product_id: z.string(), variant_id: z.string().optional(), color: z.string().optional() }).passthrough();
const OverrideSchema = z.object({ objetivo_variant_id: z.string(), product_id: z.string(), variant_id: z.string(), color: z.string().optional() }).passthrough();
const PlanArchivoSchema = z.object({
  estado: z.string(),
  snapshot: z.string().optional(),
  plan_declarado: z.object({ estructuras: z.array(z.object({ materiales: z.array(MaterialSchema) }).passthrough()) }).passthrough().optional(),
  plan_resuelto: z.object({
    plan: z.object({ estructuras: z.array(z.object({ materiales: z.array(MaterialSchema), variant_overrides: z.array(OverrideSchema).optional() }).passthrough()) }).passthrough(),
    compras: z.array(z.object({ product_id: z.string(), variant_id: z.string(), unidades_necesarias: z.number() }).passthrough()),
  }).passthrough().optional(),
}).passthrough();

type PlanArchivo = z.infer<typeof PlanArchivoSchema>;

/** Productos y variantes que el plan necesita: las compras, los materiales, y cada sustitución por color en ambos sentidos. */
function allowlistDe(archivo: PlanArchivo): PlanIdeaGuardado["allowlist"] {
  const resuelto = archivo.plan_resuelto!;
  const entradas: Array<{ product_id: string; variant_ids: string[] }> = resuelto.compras.map((compra) => ({ product_id: compra.product_id, variant_ids: [compra.variant_id] }));
  for (const estructura of [...resuelto.plan.estructuras, ...(archivo.plan_declarado?.estructuras ?? [])]) {
    for (const material of estructura.materiales) if (material.variant_id) entradas.push({ product_id: material.product_id, variant_ids: [material.variant_id] });
  }
  for (const estructura of resuelto.plan.estructuras) {
    for (const cambio of estructura.variant_overrides ?? []) {
      entradas.push({ product_id: cambio.product_id, variant_ids: [cambio.variant_id] });
      // La variante que se sustituye es del producto del material de ese color: Python la busca en la lista.
      const material = estructura.materiales.find((candidato) => candidato.color === cambio.color);
      if (material) entradas.push({ product_id: material.product_id, variant_ids: [cambio.objetivo_variant_id] });
    }
  }
  return unirAllowlist(entradas);
}

/** La entrada del plan resuelto, lista para resolver en una conversación nueva: título de la idea y sin la foto de la biblioteca. */
function planLimpio(decoracion: DecoracionSempertex, archivo: PlanArchivo) {
  // El plan se valida entero al final (`PlanDecoracionSchema.parse`); aquí solo se quitan campos de la copia.
  const crudo = structuredClone(archivo.plan_resuelto!.plan) as unknown as Record<string, unknown> & { estructuras: Array<Record<string, unknown>>; concepto: Record<string, unknown> };
  for (const estructura of crudo.estructuras) {
    // Los elementos de la foto de la biblioteca no son de esta conversación (y con un plan de foto chocarían ids).
    delete estructura.referencia_element_id;
    delete estructura.colores_referencia;
  }
  crudo.referencia_omitida = [];
  // El título interno era el id del análisis («real-08-images-23»): la tarjeta de «Tu plan» lo mostraría.
  crudo.concepto = { ...crudo.concepto, titulo: decoracion.titulo.slice(0, 160), descripcion: `Plan de la decoración «${decoracion.titulo.slice(0, 120)}» con sus globos Sempertex.`.slice(0, 320) };
  crudo.supuestos = [`Piezas, medidas y globos de la decoración «${decoracion.titulo.slice(0, 120)}» del catálogo.`.slice(0, 240)];
  // Las flores de globo que la foto de la idea muestra (`piezas[].flores`, flores-pieza.ts): la primera estructura de
  // esa oficial que aún no las lleva, armadas con sus propios globos. Python las cuenta y cotiza al resolver la idea.
  for (const pieza of decoracion.piezas) {
    if (!pieza.flores) continue;
    const estructura = crudo.estructuras.find((item) => item.estructura_oficial === pieza.estructura && item.flores === undefined);
    const materiales = Array.isArray(estructura?.materiales) ? (estructura.materiales as Array<{ product_id: string; color?: string }>) : [];
    const flores = estructura ? floresDeIdea(materiales, pieza.flores) : null;
    if (!estructura || !flores) throw new Error(`${decoracion.id}: las flores de ${pieza.estructura} no encuentran su pieza o el globo ${pieza.flores.color_petalo} de sus pétalos.`);
    estructura.flores = flores;
  }
  return PlanDecoracionSchema.parse(crudo);
}

export async function construirPlanesIdeas(decoraciones: readonly DecoracionSempertex[], carpeta = RUTA_ANALISIS): Promise<{ ideas: Record<string, PlanIdeaGuardado>; avisos: string[] }> {
  const ideas: Record<string, PlanIdeaGuardado> = {};
  const avisos: string[] = [];
  for (const decoracion of decoraciones) {
    if (decoracion.origen === "ejemplo") continue;
    const nombre = archivoPlanDe(decoracion);
    if (!nombre) { avisos.push(`${decoracion.id}: sin .plan.json (va por el camino del modelo)`); continue; }
    const ruta = path.join(carpeta, nombre);
    if (!existsSync(ruta)) { avisos.push(`${decoracion.id}: falta ${nombre}`); continue; }
    const archivo = PlanArchivoSchema.parse(JSON.parse(await readFile(ruta, "utf8")));
    if (archivo.estado !== "resuelto" || !archivo.plan_resuelto || !archivo.snapshot) { avisos.push(`${decoracion.id}: ${nombre} no está resuelto`); continue; }
    ideas[decoracion.id] = {
      snapshot: archivo.snapshot,
      archivo: nombre,
      plan: planLimpio(decoracion, archivo),
      allowlist: allowlistDe(archivo),
      globos: archivo.plan_resuelto.compras.reduce((suma, compra) => suma + compra.unidades_necesarias, 0),
    };
  }
  return { ideas, avisos };
}

function textoPlanes(ideas: Record<string, PlanIdeaGuardado>): string {
  const ordenadas = Object.fromEntries(Object.keys(ideas).sort().map((id) => [id, ideas[id]!]));
  return `${JSON.stringify(PlanesIdeasArchivoSchema.parse({ version: 1, ideas: ordenadas }))}\n`;
}

/** Vuelve a resolver cada plan con el Python local y compara las compras con las del `.plan.json` (sin modelo, sin coste). */
async function verificar(ideas: Record<string, PlanIdeaGuardado>, carpeta = RUTA_ANALISIS): Promise<number> {
  const { resolverPlan } = await import("../../src/lib/plan/resolver-backend");
  const { planConIdea } = await import("../../src/lib/plan/plan-de-idea");
  let distintas = 0;
  for (const [id, guardado] of Object.entries(ideas)) {
    const archivo = PlanArchivoSchema.parse(JSON.parse(await readFile(path.join(carpeta, guardado.archivo), "utf8")));
    const antes = new Map(archivo.plan_resuelto!.compras.map((compra) => [compra.variant_id, compra.unidades_necesarias]));
    const armado = planConIdea(guardado.plan, null);
    if (!armado.ok) { console.log(`${id}: ✗ ${armado.detalle}`); distintas += 1; continue; }
    const resolucion = await resolverPlan({ plan: armado.plan, allowlist: guardado.allowlist, catalogSnapshotId: guardado.snapshot, requestId: crypto.randomUUID(), correlationId: crypto.randomUUID() });
    const ahora = new Map(resolucion.resuelto.compras.map((compra) => [compra.variant_id, compra.unidades_necesarias]));
    const diferencias = [...new Set([...antes.keys(), ...ahora.keys()])].filter((clave) => antes.get(clave) !== ahora.get(clave));
    const total = [...ahora.values()].reduce((suma, valor) => suma + valor, 0);
    if (diferencias.length) distintas += 1;
    console.log(`${id}: ${diferencias.length ? `✗ ${diferencias.map((clave) => `${clave} ${antes.get(clave) ?? 0}→${ahora.get(clave) ?? 0}`).join(", ")}` : "="} ${guardado.globos} → ${total} globos${armado.separadas ? ` (${armado.separadas} pieza repetida separada)` : ""}`);
  }
  return distintas;
}

async function principal(): Promise<void> {
  const comprobar = process.argv.includes("--check");
  const { ideas, avisos } = await construirPlanesIdeas(await leerDecoraciones());
  for (const aviso of avisos) console.warn(`aviso: ${aviso}`);
  const texto = textoPlanes(ideas);
  const actual = existsSync(RUTA_PLANES) ? (await readFile(RUTA_PLANES, "utf8")).replace(/\r\n/g, "\n") : "";
  const desfasado = actual !== texto;
  if (comprobar) {
    if (desfasado) {
      console.error(`planes-ideas.json está desfasado con decoraciones.json y los .plan.json (${Object.keys(ideas).length} ideas). Regenera: npx tsx scripts/biblioteca/precomputar-planes-ideas.ts`);
      process.exitCode = 1;
      return;
    }
    console.log(`planes-ideas.json al día: ${Object.keys(ideas).length} ideas.`);
  } else {
    if (desfasado) await writeFile(RUTA_PLANES, texto);
    console.log(desfasado ? `Escrito ${RUTA_PLANES}: ${Object.keys(ideas).length} ideas (${(texto.length / 1024).toFixed(0)} KB).` : `Sin cambios: ${Object.keys(ideas).length} ideas.`);
  }
  if (process.argv.includes("--verificar")) {
    const distintas = await verificar(ideas);
    console.log(distintas ? `✗ ${distintas} ideas no reproducen sus compras` : "✓ todas las ideas reproducen sus compras con Python");
    if (distintas) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  void principal().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
