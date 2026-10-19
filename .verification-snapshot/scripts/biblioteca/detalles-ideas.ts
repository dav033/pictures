import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { lineaGlobo, productoSempertex } from "../../src/components/guiado/piezas-vista";
import { DecoracionSempertexSchema, type DecoracionSempertex } from "../../src/lib/biblioteca-sempertex/esquemas";
import { DetalleIdeaSchema, DetallesIdeasArchivoSchema, type DetalleIdea, type LineaIdea, type PiezaIdea } from "../../src/lib/biblioteca-sempertex/detalle-idea-esquema";
import { ESTRUCTURAS_OFICIALES, esEstructuraOficialId, type EstructuraOficialId } from "../../src/lib/plan/estructuras-oficiales";
import { ladoDeUbicacion, nombresIndividuales } from "../../src/lib/plan/piezas-individuales";
import { clasificarColores, PALETA_COLORES_V2 } from "../../src/lib/rag/taxonomy/v2";

/**
 * El detalle de cada idea de la biblioteca (`src/lib/biblioteca-sempertex/detalles-ideas.json`): sus piezas y sus
 * globos Sempertex por producto y tamaño. Determinista, sin red, sin Python y sin modelo: lee `decoraciones.json` y,
 * si la idea tiene plan resuelto, su `data/biblioteca-real/analisis/*.plan.json`.
 *
 * Reglas (nunca se inventa una cantidad):
 * - Toda línea es un material de la decoración (su producto, su variante y su cantidad). La suma del detalle es la
 *   suma de los materiales; si no, error.
 * - Python separa por piezas solo si su plan cuadra con los materiales, variante por variante (lo de Python igual a
 *   lo de Python; lo contado en la foto aparte) y sus piezas son las de la decoración. Si no cuadra (p. ej. tras
 *   corregir la biblioteca sin re-resolver), la idea se muestra entera, sin repartir.
 * - Una pieza repetida (`repeticiones` N) se parte en N piezas individuales («Columna izquierda / derecha») solo si
 *   cada cantidad de Python es divisible entre N; si no, queda como pareja «(iguales)» con el total de Python.
 * - Lo contado a mano en la foto va a la pieza si la idea tiene una sola, o a la única pieza que Python no modeló;
 *   si no, queda «sin pieza».
 */

const RAIZ = process.cwd();
export const RUTA_DECORACIONES = path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "decoraciones.json");
export const RUTA_DETALLES = path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "detalles-ideas.json");
export const RUTA_ANALISIS = path.join(RAIZ, "data", "biblioteca-real", "analisis");
const GENERADO = "npx tsx scripts/biblioteca/precomputar-detalles-ideas.ts (no editar a mano; --check detecta el desfase)";

type Paleta = (typeof PALETA_COLORES_V2)[number];
type Material = DecoracionSempertex["materiales"][number];
type Medidas = PiezaIdea["medidas"];

const LineaPlanSchema = z.object({ variant_id: z.string().min(1), unidades: z.number(), color: z.string().nullish() }).passthrough();
const MedidasPlanSchema = z.object({ ancho_m: z.number().nullish(), alto_m: z.number().nullish(), largo_m: z.number().nullish() }).passthrough();
/** Lo mínimo que se usa de un `.plan.json` resuelto; el resto pasa sin leerse. */
export const PlanArchivoSchema = z.object({
  estado: z.string(),
  plan_resuelto: z.object({
    plan_hash: z.string().optional(),
    plan: z.object({
      estructuras: z.array(z.object({
        estructura_id: z.string().min(1),
        estructura_oficial: z.string().nullish(),
        repeticiones: z.number().int().positive().default(1),
        ubicacion: z.string().nullish(),
        medidas: MedidasPlanSchema.nullish(),
      }).passthrough()),
    }).passthrough(),
    estructuras: z.array(z.object({ estructura_id: z.string().min(1), lineas: z.array(LineaPlanSchema).default([]) }).passthrough()),
  }).passthrough(),
}).passthrough();
export type PlanArchivo = z.infer<typeof PlanArchivoSchema>;

/** Códigos de tamaño del catálogo que la biblioteca anota tras el título: R-12, T260, LOL6, C-12, 18 IN. */
const CODIGO = /^(?:R-?\d{1,2}|T\d{3}|LOL\s?\d{1,2}|C-?\d{1,2}|\d{1,2}\s*IN)$/i;

type MaterialLeido = {
  material: Material;
  producto: string;
  titulo: string;
  codigo: string | null;
  color: string;
  paleta: Paleta | null;
  liso: boolean;
  origen: "plan_python" | "estimado_foto" | "plan_python_y_foto";
};

function enPaleta(valor: string | null | undefined): Paleta | null {
  const clave = (valor ?? "").trim().toLocaleLowerCase("es");
  return (PALETA_COLORES_V2 as readonly string[]).includes(clave) ? clave as Paleta : null;
}

/** «B2b Globo Latex Redondo Fashion Negro — R-12 / PAQUETE X 50 · R-12 · negro» → producto, código y color. */
export function leerMaterial(material: Material): MaterialLeido {
  const partes = (material.nota ?? "").split(" · ").map((parte) => parte.trim()).filter(Boolean);
  const completo = partes[0] ?? "";
  const titulo = completo.split(/\s+[—–]\s+/)[0]!.trim();
  const codigo = partes.slice(1).find((parte) => CODIGO.test(parte)) ?? null;
  const ultimo = partes.length > 1 ? partes.at(-1)! : "";
  const color = ultimo && !CODIGO.test(ultimo) ? ultimo : "otro color";
  const producto = productoSempertex(completo) ?? (titulo.replace(/^b2b\s+/i, "").trim() || `Variante ${material.variantId}`);
  const base = lineaGlobo({ color, tamano_codigo: codigo, titulo: completo, unidades: 1 });
  const paleta = enPaleta(color) ?? clasificarColores(color).values.find((valor) => valor !== "multicolor") ?? null;
  return {
    material, producto, titulo: titulo || producto, codigo, color, paleta,
    liso: base?.liso ?? false,
    origen: material.origenCantidad ?? "plan_python",
  };
}

/**
 * El `.plan.json` de una decoración: el de su foto (`/referencias/real-NN-….jpg` → `real-NN-….plan.json`) o el que
 * citan sus materiales («[data/biblioteca-real/analisis/nueva-sempertex-04.plan.json]»), si todos citan el mismo.
 */
export function archivoPlanDe(decoracion: DecoracionSempertex): string | null {
  const foto = /\/referencias\/(real-\d{2}-[^/]+)\.jpg$/.exec(decoracion.fotos[0]?.url ?? "")?.[1];
  if (foto) return `${foto}.plan.json`;
  const citados = new Set(decoracion.materiales.flatMap((material) => {
    const cita = /\[data\/biblioteca-real\/analisis\/([\w.-]+\.plan\.json)\]/.exec(material.detalleCantidad ?? "")?.[1];
    return cita ? [cita] : [];
  }));
  return citados.size === 1 ? [...citados][0]! : null;
}

/** Una pieza todavía sin nombre: una unidad del plan de Python o una pieza de la decoración que Python no modeló. */
type PiezaBorrador = {
  id: string;
  oficial: EstructuraOficialId;
  repeticiones: number;
  ubicacion: string | null;
  medidas: Medidas;
  /** Unidades de Python por variante (en el orden del plan). */
  dePlan: Array<{ variantId: string; unidades: number; paleta: Paleta | null }>;
};

function medidasDe(medidas: z.infer<typeof MedidasPlanSchema> | null | undefined): Medidas {
  const salida: Medidas = {};
  for (const clave of ["ancho_m", "alto_m", "largo_m"] as const) {
    const valor = medidas?.[clave];
    if (typeof valor === "number" && valor > 0) salida[clave] = valor;
  }
  return salida;
}

/** Las piezas del plan de Python, cada repetición partida solo si sus cantidades se dividen exactas. */
function unidadesDelPlan(plan: PlanArchivo): PiezaBorrador[] | null {
  const salida: PiezaBorrador[] = [];
  for (const declarada of plan.plan_resuelto.plan.estructuras) {
    if (!esEstructuraOficialId(declarada.estructura_oficial)) return null;
    const lineas = (plan.plan_resuelto.estructuras.find((resuelta) => resuelta.estructura_id === declarada.estructura_id)?.lineas ?? [])
      .filter((linea) => linea.unidades > 0)
      .map((linea) => ({ variantId: linea.variant_id, unidades: linea.unidades, paleta: enPaleta(linea.color) }));
    const veces = declarada.repeticiones;
    const base = { oficial: declarada.estructura_oficial, medidas: medidasDe(declarada.medidas) };
    if (veces > 1 && lineas.every((linea) => Number.isInteger(linea.unidades / veces))) {
      const lados = veces === 2 ? ["lateral_izquierdo", "lateral_derecho"] : [];
      for (let k = 0; k < veces; k += 1) {
        salida.push({ ...base, id: k === 0 ? declarada.estructura_id : `${declarada.estructura_id}_${"BCDEFGHIJKL"[k - 1]}`, repeticiones: 1, ubicacion: lados[k] ?? null, dePlan: lineas.map((linea) => ({ ...linea, unidades: linea.unidades / veces })) });
      }
    } else {
      salida.push({ ...base, id: declarada.estructura_id, repeticiones: veces, ubicacion: declarada.ubicacion ?? null, dePlan: lineas });
    }
  }
  return salida;
}

/** Por qué el plan no sirve para repartir por piezas (vacío: sí sirve). */
function desfasesPlan(leidos: readonly MaterialLeido[], plan: PlanArchivo): string[] {
  const enPlan = new Map<string, number>();
  for (const estructura of plan.plan_resuelto.estructuras) for (const linea of estructura.lineas) if (linea.unidades > 0) enPlan.set(linea.variant_id, (enPlan.get(linea.variant_id) ?? 0) + linea.unidades);
  const motivos: string[] = [];
  const variantes = new Set(leidos.map((leido) => leido.material.variantId));
  if (variantes.size !== leidos.length) motivos.push("dos materiales con la misma variante");
  for (const variante of enPlan.keys()) if (!variantes.has(variante)) motivos.push(`el plan usa la variante ${variante}, que no está en los materiales`);
  for (const leido of leidos) {
    const dePython = enPlan.get(leido.material.variantId) ?? 0;
    const { cantidad, variantId } = leido.material;
    if (leido.origen === "plan_python" && dePython !== cantidad) motivos.push(`${variantId}: material ${cantidad}, plan ${dePython}`);
    if (leido.origen === "plan_python_y_foto" && !(dePython > 0 && dePython <= cantidad)) motivos.push(`${variantId}: material ${cantidad} (plan + foto), plan ${dePython}`);
    if (leido.origen === "estimado_foto" && dePython > 0) motivos.push(`${variantId}: contado en la foto pero el plan lleva ${dePython}`);
  }
  return motivos;
}

function linea(leido: MaterialLeido, unidades: number, estimado: boolean, paleta: Paleta | null = null): LineaIdea {
  return {
    variantId: leido.material.variantId, producto: leido.producto, titulo: leido.titulo, codigo: leido.codigo, color: leido.color,
    paleta: paleta ?? leido.paleta, liso: leido.liso, unidades, estimado,
  };
}

/** Junta las líneas de la misma variante (una pieza puede llevar parte de Python y parte de la foto). */
function juntar(lineas: readonly LineaIdea[]): LineaIdea[] {
  const porVariante = new Map<string, LineaIdea>();
  for (const actual of lineas) {
    const previa = porVariante.get(actual.variantId);
    if (previa) porVariante.set(actual.variantId, { ...previa, unidades: previa.unidades + actual.unidades, estimado: previa.estimado || actual.estimado });
    else porVariante.set(actual.variantId, { ...actual });
  }
  return [...porVariante.values()];
}

/** Colores lisos de la paleta, del más usado al menos (sin «multicolor» ni «transparente»), como mucho 5. */
function coloresDe(lineas: readonly LineaIdea[]): Paleta[] {
  const porColor = new Map<Paleta, number>();
  for (const actual of lineas) if (actual.liso && actual.paleta && actual.paleta !== "multicolor" && actual.paleta !== "transparente") porColor.set(actual.paleta, (porColor.get(actual.paleta) ?? 0) + actual.unidades);
  return [...porColor].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, 5);
}

const suma = (lineas: readonly LineaIdea[]) => lineas.reduce((total, actual) => total + actual.unidades, 0);

/** Nombres individuales: «Columna izquierda / derecha» (por su lado en el plan), «Bouquet de globos 1, 2», «Semiarco». */
function nombrar(borradores: readonly PiezaBorrador[]): string[] {
  const nombres = borradores.map((borrador) => borrador.repeticiones > 1 ? `${ESTRUCTURAS_OFICIALES[borrador.oficial].nombre} (iguales)` : "");
  const porOficial = new Map<EstructuraOficialId, number[]>();
  for (const [indice, borrador] of borradores.entries()) if (borrador.repeticiones === 1) porOficial.set(borrador.oficial, [...(porOficial.get(borrador.oficial) ?? []), indice]);
  for (const [oficial, indices] of porOficial) {
    const lados = indices.map((indice) => ladoDeUbicacion(borradores[indice]!.ubicacion ?? undefined));
    const par = indices.length === 2 && lados[0] && lados[1] && lados[0] !== lados[1] ? [lados[0], lados[1]] as const : undefined;
    const propios = nombresIndividuales(oficial, indices.length, par);
    for (const [posicion, indice] of indices.entries()) nombres[indice] = propios[posicion]!;
  }
  return nombres;
}

export type ResultadoDetalle = { detalle: DetalleIdea | null; avisos: string[] };

/** El detalle de una decoración con (o sin) su plan resuelto. */
export function construirDetalleIdea(decoracion: DecoracionSempertex, plan: PlanArchivo | null): ResultadoDetalle {
  const avisos: string[] = [];
  const leidos = decoracion.materiales.map(leerMaterial);
  const totalMateriales = decoracion.materiales.reduce((total, material) => total + material.cantidad, 0);
  const pedidas = decoracion.piezas.flatMap((pieza) => Array.from({ length: pieza.cantidad }, () => pieza.estructura));
  if (!pedidas.length || totalMateriales <= 0) return { detalle: null, avisos: [`${decoracion.id}: sin piezas o sin materiales; no tiene detalle`] };

  let planUsable = plan !== null && plan.estado === "resuelto";
  if (plan && planUsable) {
    const motivos = desfasesPlan(leidos, plan);
    if (motivos.length) {
      planUsable = false;
      avisos.push(`${decoracion.id}: el plan no cuadra con los materiales (${motivos.slice(0, 3).join("; ")}); se muestra sin repartir por pieza`);
    }
  }
  // Cuánto de cada material resolvió Python (solo si el plan cuadra) y cuánto se contó en la foto.
  const dePython = new Map<string, number>();
  if (plan && planUsable) for (const estructura of plan.plan_resuelto.estructuras) for (const actual of estructura.lineas) if (actual.unidades > 0) dePython.set(actual.variant_id, (dePython.get(actual.variant_id) ?? 0) + actual.unidades);
  const deFoto = leidos.flatMap((leido) => {
    const resto = planUsable ? leido.material.cantidad - (dePython.get(leido.material.variantId) ?? 0) : leido.origen === "plan_python" ? 0 : leido.material.cantidad;
    return resto > 0 ? [linea(leido, resto, true)] : [];
  });
  const todas = juntar(leidos.map((leido) => {
    const foto = deFoto.find((actual) => actual.variantId === leido.material.variantId)?.unidades ?? 0;
    return linea(leido, leido.material.cantidad, foto > 0);
  }));
  const porVariante = new Map(leidos.map((leido) => [leido.material.variantId, leido]));

  // ¿Las piezas de Python son las de la decoración?
  const unidades = plan && planUsable ? unidadesDelPlan(plan) : null;
  if (plan && planUsable && !unidades) avisos.push(`${decoracion.id}: el plan trae una pieza sin estructura oficial; se muestra sin repartir por pieza`);
  let borradores: PiezaBorrador[] = [];
  let encaja = false;
  if (unidades?.length) {
    const libres = [...pedidas];
    encaja = unidades.every((unidad) => {
      for (let vez = 0; vez < unidad.repeticiones; vez += 1) {
        const posicion = libres.indexOf(unidad.oficial);
        if (posicion < 0) return false;
        libres.splice(posicion, 1);
      }
      return true;
    });
    if (encaja) {
      borradores = [...unidades, ...libres.map((oficial, indice) => ({ id: `PIEZA_${String(indice + 1).padStart(2, "0")}_${oficial.toUpperCase()}`, oficial, repeticiones: 1, ubicacion: null, medidas: {}, dePlan: [] }))];
    } else {
      avisos.push(`${decoracion.id}: las piezas del plan (${unidades.map((unidad) => unidad.oficial).join(", ")}) no son las de la decoración (${pedidas.join(", ")}); se muestra sin repartir por pieza`);
    }
  }
  if (!encaja) {
    borradores = pedidas.map((oficial, indice) => ({ id: `PIEZA_${String(indice + 1).padStart(2, "0")}_${oficial.toUpperCase()}`, oficial, repeticiones: 1, ubicacion: null, medidas: {}, dePlan: [] }));
  }

  const nombres = nombrar(borradores);
  let lineasPorPieza: LineaIdea[][];
  let lineasSinPieza: LineaIdea[] = [];
  if (encaja) {
    lineasPorPieza = borradores.map((borrador) => borrador.dePlan.map((actual) => linea(porVariante.get(actual.variantId)!, actual.unidades, false, actual.paleta)));
    const sinPlan = borradores.flatMap((borrador, indice) => borrador.dePlan.length === 0 ? [indice] : []);
    // Lo contado en la foto: a la única pieza, o a la única que Python no modeló; si no, sin pieza.
    const destino = borradores.length === 1 ? 0 : sinPlan.length === 1 ? sinPlan[0]! : null;
    if (destino !== null) lineasPorPieza[destino] = [...lineasPorPieza[destino]!, ...deFoto];
    else lineasSinPieza = deFoto;
    lineasPorPieza = lineasPorPieza.map(juntar);
  } else if (borradores.length === 1) {
    lineasPorPieza = [todas];
  } else {
    lineasPorPieza = borradores.map(() => []);
    lineasSinPieza = todas;
  }

  const coloresIdea = coloresDe(todas);
  const piezas: PiezaIdea[] = borradores.map((borrador, indice) => {
    const lineas = lineasPorPieza[indice]!;
    return {
      id: borrador.id, nombre: nombres[indice]!, estructura: borrador.oficial, repeticiones: borrador.repeticiones, medidas: borrador.medidas,
      lineas, total: suma(lineas), colores: lineas.length ? coloresDe(lineas) : coloresIdea,
    };
  });
  const total = piezas.reduce((acumulado, pieza) => acumulado + pieza.total, 0) + suma(lineasSinPieza);
  if (total !== totalMateriales) throw new Error(`${decoracion.id}: el detalle suma ${total} y los materiales ${totalMateriales}.`);
  const estimado = todas.some((actual) => actual.estimado);
  const detalle = DetalleIdeaSchema.parse({
    fuente: estimado ? "estimado" : "plan",
    ...(encaja && plan?.plan_resuelto.plan_hash && /^[0-9a-f]{64}$/.test(plan.plan_resuelto.plan_hash) ? { planHash: plan.plan_resuelto.plan_hash } : {}),
    total,
    piezas,
    ...(lineasSinPieza.length ? { lineasSinPieza } : {}),
  });
  return { detalle, avisos };
}

/** Lee y valida el plan de una decoración; null si no tiene o no está resuelto. */
export async function leerPlanDe(decoracion: DecoracionSempertex, carpeta = RUTA_ANALISIS): Promise<{ plan: PlanArchivo | null; aviso?: string }> {
  const archivo = archivoPlanDe(decoracion);
  if (!archivo) return { plan: null };
  const ruta = path.join(carpeta, archivo);
  if (!existsSync(ruta)) return { plan: null, aviso: `${decoracion.id}: no existe ${archivo}` };
  const leido = PlanArchivoSchema.safeParse(JSON.parse(await readFile(ruta, "utf8")) as unknown);
  if (!leido.success) return { plan: null, aviso: `${decoracion.id}: ${archivo} con forma inesperada (${leido.error.issues[0]?.message ?? "?"})` };
  if (leido.data.estado !== "resuelto") return { plan: null, aviso: `${decoracion.id}: ${archivo} en estado «${leido.data.estado}»` };
  return { plan: leido.data };
}

/** Todas las ideas visibles (todas menos las de ejemplo), ordenadas por id. */
export async function construirDetalles(decoraciones: readonly DecoracionSempertex[], leerPlan: (decoracion: DecoracionSempertex) => Promise<{ plan: PlanArchivo | null; aviso?: string }> = leerPlanDe): Promise<{ ideas: Record<string, DetalleIdea>; avisos: string[] }> {
  const ideas: Record<string, DetalleIdea> = {};
  const avisos: string[] = [];
  for (const decoracion of [...decoraciones].filter((item) => item.origen !== "ejemplo").sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    const { plan, aviso } = await leerPlan(decoracion);
    if (aviso) avisos.push(aviso);
    const resultado = construirDetalleIdea(decoracion, plan);
    avisos.push(...resultado.avisos);
    if (resultado.detalle) ideas[decoracion.id] = resultado.detalle;
  }
  return { ideas, avisos };
}

export function textoDetalles(ideas: Record<string, DetalleIdea>): string {
  const archivo = DetallesIdeasArchivoSchema.parse({ generado: GENERADO, ideas });
  return `${JSON.stringify(archivo, null, 2)}\n`;
}

export async function leerDecoraciones(ruta = RUTA_DECORACIONES): Promise<DecoracionSempertex[]> {
  const crudas = JSON.parse(await readFile(ruta, "utf8")) as unknown;
  if (!Array.isArray(crudas)) throw new Error("decoraciones.json no es una lista.");
  return crudas.map((dato) => DecoracionSempertexSchema.parse(dato));
}

/**
 * Regenera `detalles-ideas.json` (o, con `comprobar`, solo compara). `desfasado` dice si el archivo no coincide con
 * lo que sale de la biblioteca actual.
 */
export async function escribirDetallesIdeas({ comprobar = false } = {}): Promise<{ desfasado: boolean; ideas: number; avisos: string[] }> {
  const { ideas, avisos } = await construirDetalles(await leerDecoraciones());
  const texto = textoDetalles(ideas);
  const actual = existsSync(RUTA_DETALLES) ? await readFile(RUTA_DETALLES, "utf8") : "";
  const desfasado = actual.replace(/\r\n/g, "\n") !== texto;
  if (!comprobar && desfasado) await writeFile(RUTA_DETALLES, texto);
  return { desfasado, ideas: Object.keys(ideas).length, avisos };
}
