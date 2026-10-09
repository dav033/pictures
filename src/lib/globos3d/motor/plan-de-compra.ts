import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { FORMATOS_GLOBO } from "../formatos";
import { claveCruce, elegirVariante, presentaciones, type Crosswalk, type EntradaCrosswalk, type MotivoSinCobertura, type VarianteElegida } from "./crosswalk-variantes";
import { MERMA, cantidadConMerma } from "./merma";
import type { BomLinea } from "./resultado-motor-v1";

/**
 * **Qué se compra** para la lista de materiales del motor 3D: variantes (paquetes) y cuántos de cada una, más la reserva
 * por globos que se revientan. Es la decisión que Python toma al resolver un plan (`plan.py`: `_optimizar_cobertura`,
 * `_reoptimize_presentations` y `_consolidate`), llevada al motor para que el precio sea el mismo que daría Python. Aquí no
 * se cobra nada: el precio y los paquetes cerrados los cotiza `lista-materiales` de Python con lo que sale de aquí.
 *
 * Dos políticas, detrás de UNA constante (`POLITICA_PAQUETES`, decisión pendiente del dueño, P-035):
 * - `python` (por defecto, ruling Q1 «como Python»): por cada producto y talla, la combinación de presentaciones más barata
 *   que cubre lo que cuenta el motor; UNA reserva de `ceil(Σ × 0,08)` para todo el plan, cubierta primero con los globos que
 *   sobran de los paquetes ya comprados (por talla y color) y, si no alcanza, con el paquete más barato que la cubra;
 * - `mas_barato`: cada línea con su propia merma (`ceil(n × 1,08)`) y la presentación que cuesta menos para esa cantidad.
 */
export const POLITICAS_PAQUETES = ["python", "mas_barato"] as const;
export type PoliticaPaquetes = (typeof POLITICAS_PAQUETES)[number];
export const POLITICA_PAQUETES: PoliticaPaquetes = "python";

export type CompraPlaneada = {
  clave: string;
  formatoId: string;
  codigo: string;
  variante: VarianteElegida;
  /** Lo que cuenta el motor para esta variante, sin reserva. */
  cantidad: number;
  /** Globos de reserva que esta compra cubre. */
  reserva: number;
  paquetes: number;
  unidadesPaquete: number;
};

export type ReservaPlan = { objetivo: number; cubierta: number; sinCubrir: number; excedenteNatural: number };

export type FaltanteCruce = { formatoId: string; codigo: string; motivo: MotivoSinCobertura | "desconocida" };

export type PlanDeCompra = { politica: PoliticaPaquetes; compras: CompraPlaneada[]; reserva: ReservaPlan };

export const pulgadasDeFormato = (formatoId: string): number => Math.round((FORMATOS_GLOBO.find((f) => f.id === formatoId)?.diametroMaxCm ?? 0) / 2.54);

/** El color de una línea de compra como lo dice el catálogo (la familia: «azul»), o el nombre de la lámina. */
export function colorDeCompra(variante: Pick<VarianteElegida, "color">, codigo: string): string {
  return variante.color ?? referenciaPorCodigo(codigo)?.nombre.toLowerCase() ?? "otro color";
}

const normalizar = (texto: string): string => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const porId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// --- La combinación de presentaciones más barata (`_optimizar_cobertura` de Python, sin merma) -------------------------

type Opcion = { variantId: string; unidades: number; precio: number };
type Cobertura = { compras: Array<Opcion & { paquetes: number }> };

export function optimizarCobertura(objetivo: number, opciones: readonly Opcion[]): Cobertura | null {
  const candidatas = [...opciones].filter((o) => o.unidades > 0 && o.precio > 0).sort((a, b) => porId(a.variantId, b.variantId));
  if (objetivo <= 0 || !candidatas.length) return null;
  const minUnidades = Math.min(...candidatas.map((o) => o.unidades));
  const maxPaquetes = Math.max(1, Math.ceil(objetivo / minUnidades) + 2);
  const estado: { mejor: { clave: [number, number, number, string]; compras: Array<Opcion & { paquetes: number }> } | null } = { mejor: null };
  const menor = (a: [number, number, number, string], b: [number, number, number, string]): boolean => {
    for (let k = 0; k < 3; k += 1) if (a[k] !== b[k]) return (a[k] as number) < (b[k] as number);
    return a[3] < b[3];
  };
  const visitar = (indice: number, restantes: number, elegidas: Array<Opcion & { paquetes: number }>): void => {
    if (indice === candidatas.length) {
      if (restantes > 0) return;
      const compras = elegidas.filter((e) => e.paquetes > 0);
      const capacidad = compras.reduce((suma, e) => suma + e.paquetes * e.unidades, 0);
      const costo = compras.reduce((suma, e) => suma + e.paquetes * e.precio, 0);
      const clave: [number, number, number, string] = [costo, capacidad - objetivo, compras.reduce((suma, e) => suma + e.paquetes, 0), compras.map((e) => e.variantId).join("|")];
      if (estado.mejor === null || menor(clave, estado.mejor.clave)) estado.mejor = { clave, compras };
      return;
    }
    const opcion = candidatas[indice]!;
    const maxOpcion = Math.min(maxPaquetes, Math.max(0, Math.ceil(restantes / opcion.unidades) + 1));
    for (let paquetes = 0; paquetes <= maxOpcion; paquetes += 1) visitar(indice + 1, restantes - paquetes * opcion.unidades, [...elegidas, { ...opcion, paquetes }]);
  };
  visitar(0, objetivo, []);
  return estado.mejor === null ? null : { compras: estado.mejor.compras };
}

function varianteDe(entrada: EntradaCrosswalk, variantId: string): VarianteElegida {
  const v = entrada.variantes.find((x) => x.variantId === variantId)!;
  return { ok: true, productId: entrada.productId, variantId, titulo: entrada.titulo, tituloVariante: v.titulo, unidadesPaq: v.unidadesPaq, precio: v.precio, color: entrada.color };
}

// --- Política `python` ------------------------------------------------------------------------------------------------

function planearComoPython(lineas: ReadonlyArray<{ linea: BomLinea; entrada: EntradaCrosswalk }>): PlanDeCompra {
  const compras: CompraPlaneada[] = [];
  for (const { linea, entrada } of lineas) {
    const cobertura = optimizarCobertura(linea.cantidad, entrada.variantes.map((v) => ({ variantId: v.variantId, unidades: v.unidadesPaq, precio: v.precio })));
    let restante = linea.cantidad;
    // Las líneas de la pieza se reparten entre las compras en orden de variante, cada una hasta su capacidad (`_reoptimize_presentations`).
    for (const compra of cobertura?.compras ?? []) {
      const asignado = Math.min(restante, compra.paquetes * compra.unidades);
      if (asignado <= 0) continue;
      compras.push({ clave: claveCruce(linea.formatoId, linea.codigo), formatoId: linea.formatoId, codigo: linea.codigo, variante: varianteDe(entrada, compra.variantId), cantidad: asignado, reserva: 0, paquetes: compra.paquetes, unidadesPaquete: compra.unidades });
      restante -= asignado;
    }
  }
  compras.sort((a, b) => porId(a.variante.variantId, b.variante.variantId));
  return { politica: "python", compras, reserva: repartirReserva(compras) };
}

/** `_consolidate` de Python: una reserva para todo el plan, primero con lo que ya sobra de los paquetes y luego con el paquete más barato. */
function repartirReserva(compras: CompraPlaneada[]): ReservaPlan {
  const objetivo = Math.ceil(compras.reduce((suma, c) => suma + c.cantidad, 0) * MERMA);
  const llaveGrupo = (c: CompraPlaneada) => `R-${pulgadasDeFormato(c.formatoId)}|${normalizar(colorDeCompra(c.variante, c.codigo))}`;
  const disponible = (c: CompraPlaneada) => Math.max(0, c.paquetes * c.unidadesPaquete - c.cantidad);
  const grupos = new Map<string, number>();
  for (const c of compras) grupos.set(llaveGrupo(c), (grupos.get(llaveGrupo(c)) ?? 0) + (c.paquetes * c.unidadesPaquete - c.cantidad));
  const excedenteNatural = compras.reduce((suma, c) => suma + disponible(c), 0);
  const cubiertoPorGrupo = new Map<string, number>();
  let restante = objetivo;
  for (const [llave, libre] of [...grupos.entries()].sort(([ka, a], [kb, b]) => b - a || porId(ka, kb))) {
    const cubierto = Math.min(restante, libre);
    cubiertoPorGrupo.set(llave, cubierto);
    restante -= cubierto;
    if (restante <= 0) break;
  }
  for (const c of compras) {
    const llave = llaveGrupo(c);
    const asignado = Math.min(cubiertoPorGrupo.get(llave) ?? 0, disponible(c));
    if (asignado) { c.reserva = asignado; cubiertoPorGrupo.set(llave, (cubiertoPorGrupo.get(llave) ?? 0) - asignado); }
  }
  restante = Math.max(0, objetivo - compras.reduce((suma, c) => suma + c.reserva, 0));
  while (restante > 0 && compras.length) {
    const pendiente = restante;
    const elegida = [...compras].sort((a, b) => Math.ceil(pendiente / a.unidadesPaquete) * a.variante.precio - Math.ceil(pendiente / b.unidadesPaquete) * b.variante.precio || b.cantidad - a.cantidad || porId(a.variante.variantId, b.variante.variantId))[0]!;
    const adicionales = Math.ceil(pendiente / elegida.unidadesPaquete);
    const cubierto = Math.min(pendiente, adicionales * elegida.unidadesPaquete);
    elegida.paquetes += adicionales;
    elegida.reserva += cubierto;
    restante -= cubierto;
  }
  const cubierta = compras.reduce((suma, c) => suma + c.reserva, 0);
  return { objetivo, cubierta, sinCubrir: Math.max(0, objetivo - cubierta), excedenteNatural };
}

// --- Política `mas_barato` --------------------------------------------------------------------------------------------

function planearMasBarato(lineas: ReadonlyArray<{ linea: BomLinea; entrada: EntradaCrosswalk }>, crosswalk: Crosswalk): PlanDeCompra {
  const compras: CompraPlaneada[] = lineas.map(({ linea }) => {
    const conMerma = cantidadConMerma(linea.cantidad);
    const v = elegirVariante(crosswalk, linea.formatoId, linea.codigo, conMerma) as VarianteElegida;
    return { clave: claveCruce(linea.formatoId, linea.codigo), formatoId: linea.formatoId, codigo: linea.codigo, variante: v, cantidad: linea.cantidad, reserva: conMerma - linea.cantidad, paquetes: Math.ceil(conMerma / v.unidadesPaq), unidadesPaquete: v.unidadesPaq };
  }).sort((a, b) => porId(a.variante.variantId, b.variante.variantId));
  const reserva = compras.reduce((suma, c) => suma + c.reserva, 0);
  return { politica: "mas_barato", compras, reserva: { objetivo: reserva, cubierta: reserva, sinCubrir: 0, excedenteNatural: compras.reduce((suma, c) => suma + Math.max(0, c.paquetes * c.unidadesPaquete - c.cantidad - c.reserva), 0) } };
}

export type ResultadoPlaneo = ({ ok: true } & PlanDeCompra) | { ok: false; faltantes: FaltanteCruce[] };

export function planearCompra(bom: readonly BomLinea[], crosswalk: Crosswalk, politica: PoliticaPaquetes = POLITICA_PAQUETES): ResultadoPlaneo {
  const faltantes: FaltanteCruce[] = [];
  const lineas: Array<{ linea: BomLinea; entrada: EntradaCrosswalk }> = [];
  for (const linea of bom) {
    const hay = presentaciones(crosswalk, linea.formatoId, linea.codigo);
    if (hay.ok) lineas.push({ linea, entrada: hay.entrada });
    else faltantes.push({ formatoId: linea.formatoId, codigo: linea.codigo, motivo: hay.motivo });
  }
  if (faltantes.length) return { ok: false, faltantes };
  return { ok: true, ...(politica === "python" ? planearComoPython(lineas) : planearMasBarato(lineas, crosswalk)) };
}

// --- A qué pieza va cada compra ---------------------------------------------------------------------------------------

export type AsignacionPieza<C extends CompraPlaneada = CompraPlaneada> = { compra: C; cantidad: number };

/** Reparte las compras entre las piezas, en orden de pieza y de línea, cada compra hasta lo que cubre (como reconstruye Python las líneas). */
export function repartirPorPieza<C extends CompraPlaneada>(porPieza: Readonly<Record<string, readonly BomLinea[]>>, compras: readonly C[]): Record<string, AsignacionPieza<C>[]> {
  const libre = new Map<C, number>(compras.map((c) => [c, c.cantidad]));
  const delGrupo = (clave: string) => compras.filter((c) => c.clave === clave);
  const salida: Record<string, AsignacionPieza<C>[]> = {};
  for (const [piezaId, lineas] of Object.entries(porPieza)) {
    salida[piezaId] = [];
    for (const linea of lineas) {
      let restante = linea.cantidad;
      for (const compra of delGrupo(claveCruce(linea.formatoId, linea.codigo))) {
        const asignado = Math.min(restante, libre.get(compra) ?? 0);
        if (asignado <= 0) continue;
        salida[piezaId]!.push({ compra, cantidad: asignado });
        libre.set(compra, (libre.get(compra) ?? 0) - asignado);
        restante -= asignado;
        if (restante <= 0) break;
      }
    }
  }
  return salida;
}
