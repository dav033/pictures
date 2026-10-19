import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { armarDesdeEspec, crosswalkIncluido, planearCompra, type BomLinea, type PoliticaPaquetes } from "../../src/lib/globos3d/motor/v1";
import { casosIdeas } from "../lib/casos-motor-guiada";

/**
 * Informe de paridad (REQ-007 fase 6, solo información): por cada una de las 28 ideas guardadas, lo que cuenta Python de
 * tres maneras (líneas del plan resuelto guardado, sus `compras`, y el `armado_*` si la pieza lo trae) contra lo que cuenta
 * el motor 3D, por formato, tamaño y color, con las medidas de cada lado; y el precio descompuesto con el MISMO snapshot:
 * precio guardado de Python, las cuentas de Python compradas con las dos políticas del motor (sin la allowlist), el valor de
 * consumo (globos x precio unitario más barato) de cada lado y el motor con las dos políticas. Sin red y sin coste.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/motor/paridad-ideas.ts <salida.json>
 */
const RAIZ = path.resolve(__dirname, "..", "..");
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
const cruce = crosswalkIncluido();

/** variant_id de la tienda -> (formato, código Sempertex) del cruce, y el precio unitario más barato de ese globo. */
const porVariante = new Map<string, { formatoId: string; codigo: string }>();
const unitario = new Map<string, number>();
for (const [clave, entrada] of Object.entries(cruce.entradas)) {
  const [formatoId, codigo] = clave.split("|") as [string, string];
  for (const v of entrada.variantes) porVariante.set(v.variantId, { formatoId, codigo });
  unitario.set(clave, Math.min(...entrada.variantes.map((v) => v.precio / v.unidadesPaq)));
}

type LineaPy = { variant_id: string; tamano_codigo: string; color: string; unidades: number; forma: string; acabado?: string };
type EstructuraPy = { estructura_id: string; eje_m?: number | null; total_unidades: number; lineas: LineaPy[] };
type CompraPy = { variant_id: string; tamano_codigo: string; color: string; unidades_necesarias: number; paquetes: number; unidades_paquete: number; precio_paquete: number; subtotal: number };
type Analisis = { plan_resuelto: { totales: { total_unidades: number; purchase_cost: number; consumption_cost: number; globos_por_tamano: Record<string, number> }; estructuras: EstructuraPy[]; compras: CompraPy[] }; material_estimate?: { balloons?: Array<{ size_inches: number; design_quantity: number }> } };

const sumar = (m: Record<string, number>, k: string, n: number) => { m[k] = (m[k] ?? 0) + n; };
const nombre = (codigo: string) => referenciaPorCodigo(codigo)?.nombre ?? codigo;

function costoPlan(bom: readonly BomLinea[], politica: PoliticaPaquetes): number | string {
  const plan = planearCompra(bom, cruce, politica);
  if (!plan.ok) return `sin tienda: ${plan.faltantes.map((f) => `${f.formatoId} ${f.codigo}`).join(", ")}`;
  return plan.compras.reduce((s, c) => s + c.paquetes * c.variante.precio, 0);
}

const valorConsumo = (bom: readonly BomLinea[]) => Math.round(bom.reduce((s, l) => s + l.cantidad * (unitario.get(`${l.formatoId}|${l.codigo}`) ?? Number.NaN), 0));

/** El conteo de un `armado_columna` por capas: globos por capa x capas + remate (como lo arma `armado_columna.py`). */
function conteoArmado(estructura: Record<string, unknown>): { modelo: string; total: number; detalle: string } | null {
  const armado = estructura.armado_columna as { cuerpo?: { globos_capa?: number }; capas?: Array<{ tamano: number; materiales: number[] }>; remate?: { tipo: string; tamano: number; cantidad: number } } | undefined;
  if (!armado?.capas) return null;
  const cuerpo = armado.capas.reduce((s, c) => s + c.materiales.length, 0);
  const remate = armado.remate?.tipo === "globo" ? 1 : 0;
  return { modelo: "armado_columna", total: cuerpo + remate, detalle: `${armado.capas.length} capas x ${armado.cuerpo?.globos_capa ?? 4} R-${armado.capas[0]?.tamano} + ${remate ? `1 R-${armado.remate!.tamano}` : "sin remate"}` };
}

const salida = casosIdeas().map((caso) => {
  const ideaId = caso.id.replace(/^idea-/, "");
  const idea = planes.ideas[ideaId]!;
  const rutaAnalisis = path.join(RAIZ, "data", "biblioteca-real", "analisis", idea.archivo);
  const analisis = existsSync(rutaAnalisis) ? (JSON.parse(readFileSync(rutaAnalisis, "utf8")) as Analisis) : null;
  const pr = analisis?.plan_resuelto;
  const resultado = armarDesdeEspec(caso.espec);

  const estructurasPlan = idea.plan.estructuras as unknown as Array<Record<string, unknown>>;
  const python = {
    globosPlanesIdeas: idea.globos,
    totalResuelto: pr?.totales.total_unidades ?? null,
    globosPorTamano: pr?.totales.globos_por_tamano ?? {},
    estructuras: (pr?.estructuras ?? []).map((s) => {
      const decl = estructurasPlan.find((e) => e.estructura_id === s.estructura_id) ?? {};
      const porTamano: Record<string, number> = {};
      const porColor: Record<string, number> = {};
      for (const l of s.lineas) { sumar(porTamano, l.tamano_codigo + (l.forma !== "redondo" ? `/${l.forma}` : ""), l.unidades); sumar(porColor, `${l.color} ${l.tamano_codigo}`, l.unidades); }
      return { id: s.estructura_id, oficial: decl.estructura_oficial, tipo: decl.tipo, medidas: decl.medidas, repeticiones: decl.repeticiones, densidad: decl.densidad, mezcla: decl.mezcla, ejeM: s.eje_m ?? null, total: s.total_unidades, porTamano, porColor, armado: conteoArmado(decl) };
    }),
    compras: (() => {
      const porTamano: Record<string, number> = {};
      for (const c of pr?.compras ?? []) sumar(porTamano, c.tamano_codigo, c.unidades_necesarias);
      return { total: (pr?.compras ?? []).reduce((s, c) => s + c.unidades_necesarias, 0), porTamano, lineas: (pr?.compras ?? []).length, paquetes: (pr?.compras ?? []).reduce((s, c) => s + c.paquetes, 0) };
    })(),
    materialEstimate: (analisis?.material_estimate?.balloons ?? []).reduce((s, b) => s + b.design_quantity, 0),
  };

  // Las cuentas de Python como una lista del motor (formato + código), para comprarlas con las políticas del motor.
  const bomPython: BomLinea[] = [];
  const sinCruce: string[] = [];
  for (const s of pr?.estructuras ?? []) for (const l of s.lineas) {
    const x = porVariante.get(l.variant_id);
    if (!x) { sinCruce.push(`${l.tamano_codigo} ${l.color}`); continue; }
    const previa = bomPython.find((b) => b.formatoId === x.formatoId && b.codigo === x.codigo);
    if (previa) previa.cantidad += l.unidades; else bomPython.push({ formatoId: x.formatoId, codigo: x.codigo, cantidad: l.unidades });
  }

  const cajas = new Map(resultado.armada.piezas.map((p) => [p.id, p.caja]));
  const motor = {
    noRepresentable: resultado.noRepresentable.map((n) => n.piezaId),
    total: resultado.bom.total.reduce((s, l) => s + l.cantidad, 0),
    porFormato: resultado.bom.total.reduce<Record<string, number>>((m, l) => (sumar(m, l.formatoId, l.cantidad), m), {}),
    piezas: caso.espec.piezas.map((p) => {
      const lineas = resultado.bom.porPieza[p.id] ?? [];
      const porFormato: Record<string, number> = {};
      const porColor: Record<string, number> = {};
      for (const l of lineas) { sumar(porFormato, l.formatoId, l.cantidad); sumar(porColor, `${nombre(l.codigo)} ${l.formatoId}`, l.cantidad); }
      return { id: p.id, oficial: p.oficial, medidas: p.medidas, densidad: p.densidad, tamanos: p.tamanos, total: lineas.reduce((s, l) => s + l.cantidad, 0), porFormato, porColor, caja: cajas.get(p.id) ?? null, extras: { remate: (p as { remate?: unknown }).remate ?? null, flores: (p as { flores?: unknown }).flores ?? null } };
    }),
  };

  const completo = motor.noRepresentable.length === 0;
  const precios = {
    pythonGuardado: pr?.totales.purchase_cost ?? null,
    pythonConsumoGuardado: pr?.totales.consumption_cost ?? null,
    pythonValorUnitario: sinCruce.length ? null : valorConsumo(bomPython),
    pythonConPoliticaPython: sinCruce.length ? null : costoPlan(bomPython, "python"),
    pythonConMasBarato: sinCruce.length ? null : costoPlan(bomPython, "mas_barato"),
    motorValorUnitario: completo ? valorConsumo(resultado.bom.total) : null,
    motorPython: completo ? costoPlan(resultado.bom.total, "python") : null,
    motorMasBarato: completo ? costoPlan(resultado.bom.total, "mas_barato") : null,
    sinCruce,
  };
  return { id: ideaId, titulo: idea.plan.concepto.titulo, python, motor, precios };
});

const destino = process.argv[2];
if (destino) writeFileSync(destino, JSON.stringify(salida, null, 1), "utf8");
else console.log(JSON.stringify(salida, null, 1));
