import { z } from "zod";
import { CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { allowlistDesdeMapa, crearTokenPlan } from "@/lib/plan/aprobacion";
import { ADORNO_FLOR } from "@/lib/plan/flores-pieza";
import { claveCruce } from "./crosswalk-variantes";
import { FORMATOS_GLOBO } from "../formatos";
import type { CompraMotor, CotizacionDelMotor } from "./cotizar-bom";
import type { AsignacionPieza } from "./plan-de-compra";
import type { EspecClienteV1 } from "./espec-cliente-v1";
import { lineasDeFlores } from "./flores-espec";
import { planActualDesdeEspec } from "./plan-actual-espec";
import { MERMA_PORCENTAJE } from "./merma";
import { datosDeLinea, proyectarPlan, type ConceptoPlan } from "./proyeccion-plan";
import type { BomLinea, ResultadoMotorV1 } from "./resultado-motor-v1";

/**
 * **El sobre del plan del motor 3D**: lo que `/api/guiada/motor/plan` devuelve y la tarjeta de «Tu plan» entiende sin
 * saber qué motor lo armó. Es un `PlanGuiado` válido (`PlanGuiadoSchema`) con una proyección `PlanDecoracion`, las
 * líneas por pieza y variante (`estructuras[].lineas`), las compras por variante, `plan_hash = especHash`, un token de
 * aprobación con backend `globos3d` y, aparte, el motor y la espec que lo produjeron. Las cantidades salen de la lista de
 * materiales del motor; los precios, de Python (`cotizar-bom.ts`).
 */
export type PlanGuiadoMotor = z.infer<typeof PlanGuiadoSchema>;

export const SobreMotorSchema = PlanGuiadoSchema.and(z.object({
  motor: z.object({ id: z.literal("globos3d"), version: z.string().min(1) }).strict(),
  espec: z.unknown(),
  avisos: z.array(z.string()),
}).passthrough());

export type EntradaSobre = {
  espec: EspecClienteV1;
  resultado: ResultadoMotorV1;
  cotizacion: CotizacionDelMotor;
  concepto: ConceptoPlan;
  requestId: string;
  /** Huella del navegador que pidió el plan: el token queda atado a él (un token copiado a otro navegador no sirve). */
  navegador?: string;
  /** La hora del primer plan de esta línea (la del plan base al cambiarlo o sumarle algo; ahora si es nuevo): va al token. */
  origenEn?: number;
};

export type SobreDelMotor = { ok: true; plan: PlanGuiadoMotor; cotizacion: CotizacionDelMotor["cotizacion"] } | { ok: false; motivo: string };

const FORMA_POR_TIPO = { redondo: "redondo", link: "link", tubito: "modelar", corazon: "corazon" } as const;
const PULGADAS_POR_CM = 2.54;

/** Un UUID estable derivado del hash de la espec: el mismo plan tiene siempre el mismo `plan_id`. */
export function uuidDeHash(hash: string): string {
  const hex = hash.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "89ab"[Number.parseInt(hex[16]!, 16) % 4]!;
  const plano = hex.join("");
  return `${plano.slice(0, 8)}-${plano.slice(8, 12)}-${plano.slice(12, 16)}-${plano.slice(16, 20)}-${plano.slice(20, 32)}`;
}

function lineaDePieza(piezaId: string, compra: CompraMotor, unidades: number, flor: boolean) {
  const formato = FORMATOS_GLOBO.find((f) => f.id === compra.formatoId);
  const { color, acabado } = datosDeLinea(compra);
  return {
    estructura_id: piezaId,
    origen: { kind: "estructura" as const, id: piezaId },
    product_id: compra.variante.productId,
    variant_id: compra.variante.variantId,
    sku: null,
    titulo: `${compra.variante.titulo} — ${compra.variante.tituloVariante}`,
    color,
    tamano_codigo: compra.formatoId,
    ...(formato ? { diam_pulg: Math.round(formato.diametroMaxCm / PULGADAS_POR_CM), diam_cm: formato.diametroMaxCm, forma: FORMA_POR_TIPO[formato.tipo] } : {}),
    acabado,
    unidades,
    sustitucion: null,
    ...(flor ? { adorno: ADORNO_FLOR } : {}),
  };
}

/**
 * Las líneas de una pieza: los globos del cuerpo y, aparte y marcados como adorno, los de sus flores. Una pieza puede llevar
 * globos de un mismo color y talla en más de una variante (la combinación de paquetes más barata): cada una es su línea.
 */
function lineasResueltas(piezaId: string, asignaciones: readonly AsignacionPieza<CompraMotor>[], flores: readonly BomLinea[]) {
  const deFlorPorClave = new Map(flores.map((l) => [claveCruce(l.formatoId, l.codigo), l.cantidad]));
  return asignaciones.flatMap(({ compra, cantidad }) => {
    const enFlor = Math.min(cantidad, deFlorPorClave.get(compra.clave) ?? 0);
    deFlorPorClave.set(compra.clave, (deFlorPorClave.get(compra.clave) ?? 0) - enFlor);
    return [
      ...(cantidad - enFlor > 0 ? [lineaDePieza(piezaId, compra, cantidad - enFlor, false)] : []),
      ...(enFlor > 0 ? [lineaDePieza(piezaId, compra, enFlor, true)] : []),
    ];
  });
}

/** Los productos que se compran y, de cada uno, las variantes (tallas y paquetes) elegidas: lo que el token deja firmado. */
function variantesPorProducto(compras: readonly CompraMotor[]): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const compra of compras) mapa.set(compra.variante.productId, new Set([...(mapa.get(compra.variante.productId) ?? []), compra.variante.variantId]));
  return mapa;
}

function mezclaReal(lineas: ReadonlyArray<{ diam_pulg?: number; forma?: string; unidades: number }>) {
  const porTamano = new Map<string, { diam_pulg: number; forma: string | null; unidades: number }>();
  for (const linea of lineas) {
    const clave = `${linea.diam_pulg ?? 0}|${linea.forma ?? ""}`;
    const previa = porTamano.get(clave);
    porTamano.set(clave, { diam_pulg: linea.diam_pulg ?? 0, forma: linea.forma ?? null, unidades: (previa?.unidades ?? 0) + linea.unidades });
  }
  const total = lineas.reduce((suma, linea) => suma + linea.unidades, 0) || 1;
  return [...porTamano.values()].map((t) => ({ ...t, pct: Math.round((t.unidades / total) * 1000) / 10 })).sort((a, b) => a.diam_pulg - b.diam_pulg);
}

export function sobreDelMotor(entrada: EntradaSobre): SobreDelMotor {
  const { espec, resultado, cotizacion, concepto, requestId } = entrada;
  // Una compra por cada (formato, color) para nombrar productos y colores; las cantidades salen de las asignaciones por pieza.
  const compras = new Map<string, CompraMotor>();
  for (const compra of cotizacion.compras) if (!compras.has(compra.clave)) compras.set(compra.clave, compra);
  if (resultado.bom.total.some((linea) => !compras.has(claveCruce(linea.formatoId, linea.codigo)))) return { ok: false, motivo: "La cotización no cubre todas las líneas del motor." };
  const plan = proyectarPlan({ espec, porPieza: resultado.bom.porPieza, compras, concepto, avisos: resultado.avisos, planId: uuidDeHash(resultado.especHash) });
  if (!plan.ok) return { ok: false, motivo: plan.motivo };

  const estructuras = espec.piezas.map((pieza) => {
    const lineas = lineasResueltas(pieza.id, cotizacion.porPieza[pieza.id] ?? [], pieza.flores ? lineasDeFlores(pieza.flores, []) : []);
    const proyectada = plan.plan.estructuras.find((e) => e.estructura_id === pieza.id)!;
    return {
      estructura_id: pieza.id, nombre: proyectada.nombre, tipo: proyectada.tipo, ubicacion: proyectada.ubicacion, repeticiones: 1, eje_m: null,
      total_unidades: lineas.reduce((suma, linea) => suma + linea.unidades, 0), lineas, mezcla_real: mezclaReal(lineas), supuestos: [] as string[],
    };
  });

  const piezasPorVariante = new Map<string, string[]>();
  for (const [piezaId, asignaciones] of Object.entries(cotizacion.porPieza)) for (const { compra } of asignaciones) {
    piezasPorVariante.set(compra.variante.variantId, [...new Set([...(piezasPorVariante.get(compra.variante.variantId) ?? []), piezaId])]);
  }
  const comprasEnvoltura = cotizacion.compras.map((compra) => {
    const piezas = piezasPorVariante.get(compra.variante.variantId) ?? [];
    const { color } = datosDeLinea(compra);
    const formato = FORMATOS_GLOBO.find((f) => f.id === compra.formatoId);
    return {
      variant_id: compra.variante.variantId, product_id: compra.variante.productId, sku: null,
      titulo: `${compra.variante.titulo} — ${compra.variante.tituloVariante}`, tamano_codigo: compra.formatoId,
      diam_pulg: formato ? Math.round(formato.diametroMaxCm / PULGADAS_POR_CM) : null, color,
      unidades_necesarias: compra.cantidad, design_quantity: compra.cantidad, waste_reserve: compra.reserva,
      required_quantity: compra.cantidadConMerma, unidades_con_merma: compra.cantidadConMerma, unidades_paquete: compra.unidadesPaquete, paquetes: compra.paquetes,
      purchase_quantity: compra.paquetes * compra.unidadesPaquete, used: compra.cantidad, leftover_inventory: Math.max(0, compra.paquetes * compra.unidadesPaquete - compra.cantidadConMerma),
      consumption_cost: Math.round((compra.cantidad * compra.precioPaquete) / compra.unidadesPaquete), purchase_cost: compra.subtotal,
      additional_package_for_waste: false, sobrante: compra.sobrante, precio_paquete: compra.precioPaquete, subtotal: compra.subtotal,
      estructuras: piezas, elementos_origen: piezas.map((id) => ({ kind: "estructura" as const, id })),
    };
  });

  const diseno = cotizacion.compras.reduce((suma, c) => suma + c.cantidad, 0);
  const { reserva } = cotizacion;
  const porTamano: Record<string, number> = {};
  for (const compra of cotizacion.compras) porTamano[compra.formatoId] = (porTamano[compra.formatoId] ?? 0) + compra.cantidad;
  const approval_token = crearTokenPlan({
    planHash: resultado.especHash,
    requestId,
    backend: "globos3d",
    catalogSnapshotId: cotizacion.snapshot,
    allowlist: allowlistDesdeMapa(variantesPorProducto(cotizacion.compras)),
    ...(entrada.navegador ? { navegador: entrada.navegador } : {}),
    ...(entrada.origenEn === undefined ? {} : { origenEn: entrada.origenEn }),
  });

  const sobre = {
    plan: plan.plan,
    plan_hash: resultado.especHash,
    approval_token,
    request_id: requestId,
    estructuras,
    compras: comprasEnvoltura,
    totales: {
      globos_por_tamano: porTamano, total_unidades: diseno, total_cop: cotizacion.total, design_quantity: diseno,
      target_waste_reserve: reserva.objetivo, covered_waste_reserve: reserva.cubierta, uncovered_waste_reserve: reserva.sinCubrir,
      natural_package_surplus: reserva.excedenteNatural,
      purchase_cost: cotizacion.total, consumption_cost: comprasEnvoltura.reduce((suma, c) => suma + c.consumption_cost, 0),
      waste_only_savings_cop: 0, additional_waste_packages: 0, ahorro_paquetes_cop: 0, incluye_iva: true, merma_porcentaje: MERMA_PORCENTAJE,
    },
    comercial: { estado: "VERIFICADO" as const, delta_cop: 0 },
    alternativas: [],
    merma_log: `Reserva del ${MERMA_PORCENTAJE}% sobre lo que cuenta el motor (política de paquetes «${cotizacion.politica}»), snapshot de precios ${cotizacion.snapshot}.`,
    sustituciones: [],
    sin_cobertura: [],
    advertencias: [],
    costes_por_estructura: espec.piezas.map((pieza) => ({ estructura_id: pieza.id, consumo_cop: null })),
    motor: resultado.motor,
    espec,
    avisos: resultado.avisos,
    // El plan tal como lo ve el modelo del chat: exacto, de la espec (no una lectura aproximada del plan de Python).
    planActual: planActualDesdeEspec(espec, { totalGlobos: resultado.bom.total.reduce((suma, linea) => suma + linea.cantidad, 0) }),
  };
  const valido = SobreMotorSchema.safeParse(sobre);
  if (!valido.success) return { ok: false, motivo: `El sobre del plan no cumple el contrato: ${valido.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacion.cotizacion);
  if (!precio.success) return { ok: false, motivo: "La cotización del motor no cumple el contrato." };
  return { ok: true, plan: valido.data as PlanGuiadoMotor, cotizacion: precio.data };
}
