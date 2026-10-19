import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { FORMATOS_GLOBO } from "../formatos";
import { claveCruce, elegirVariante, presentaciones, type Crosswalk, type EntradaCrosswalk, type MotivoCruce, type VarianteElegida } from "./crosswalk-variantes";
import { MERMA, cantidadConMerma } from "./merma";
import type { BomLinea } from "./resultado-motor-v1";

/**
 * **Qué se compra** para la lista de materiales del motor 3D: variantes (paquetes) y cuántos de cada una, más la reserva
 * por globos que se revientan. Es la decisión que Python toma al resolver un plan (`presentaciones.py` y `plan.py`:
 * `_reoptimize_presentations` y `_consolidate`), con las mismas reglas para que la misma lista cueste lo mismo en todas
 * las superficies (D-038; la fixture `contracts/domain/v1/golden/cotizacion-unica/` ata los dos lados). Aquí no se cobra
 * nada: el precio y los paquetes cerrados los cotiza `lista-materiales` de Python con lo que sale de aquí.
 *
 * Dos políticas, detrás de UNA constante (`POLITICA_PAQUETES`):
 * - `python` (por defecto, D-026 y D-038): por cada globo (producto, talla y color) su propia reserva de `ceil(n × 0,08)`
 *   (a quien se le revienta un rojo le hace falta un rojo) y la combinación más barata de TODAS las presentaciones que vende
 *   la tienda que cubre el diseño y la reserva de una vez, si los repuestos no cuestan de más (`comprarGlobo`);
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
  /** La reserva le hizo subir los paquetes (`additional_package_for_waste` de Python). */
  paraReserva: boolean;
};

export type ReservaPlan = { objetivo: number; cubierta: number; sinCubrir: number; excedenteNatural: number };

export type FaltanteCruce = { formatoId: string; codigo: string; motivo: MotivoCruce };

export type PlanDeCompra = { politica: PoliticaPaquetes; compras: CompraPlaneada[]; reserva: ReservaPlan };

export const pulgadasDeFormato = (formatoId: string): number => Math.round((FORMATOS_GLOBO.find((f) => f.id === formatoId)?.diametroMaxCm ?? 0) / 2.54);

/** El color de una línea de compra como lo dice el catálogo (la familia: «azul»), o el nombre de la lámina. */
export function colorDeCompra(variante: Pick<VarianteElegida, "color">, codigo: string): string {
  return variante.color ?? referenciaPorCodigo(codigo)?.nombre.toLowerCase() ?? "otro color";
}

const porId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// --- La combinación de presentaciones más barata (`_optimizar_cobertura` de Python, sin merma) -------------------------

type Opcion = { variantId: string; unidades: number; precio: number };
type Cobertura = { compras: Array<Opcion & { paquetes: number }> };

/** Con `necesidad` (los globos del diseño de la línea), como mucho esa cantidad de presentaciones: cada una lleva un globo del diseño. */
export function optimizarCobertura(objetivo: number, opciones: readonly Opcion[], necesidad?: number): Cobertura | null {
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
      if (necesidad !== undefined && compras.length > necesidad) return;
      const capacidad = compras.reduce((suma, e) => suma + e.paquetes * e.unidades, 0);
      const costo = compras.reduce((suma, e) => suma + e.paquetes * e.precio, 0);
      const clave: [number, number, number, string] = [costo, capacidad - objetivo, compras.reduce((suma, e) => suma + e.paquetes, 0), compras.map((e) => e.variantId).join("|")];
      if (estado.mejor === null || menor(clave, estado.mejor.clave)) estado.mejor = { clave, compras };
      return;
    }
    const opcion = candidatas[indice]!;
    const maxOpcion = Math.min(maxPaquetes, Math.max(0, Math.ceil(restantes / opcion.unidades) + 1));
    if (indice === candidatas.length - 1) {
      // En la última presentación, más paquetes que los que faltan solo suben el costo: basta el mínimo que cubre. Mismo
      // resultado que recorrerlos todos, sin el costo cúbico en cantidades grandes (igual en `optimizar_cobertura`).
      const minimo = Math.max(0, Math.ceil(restantes / opcion.unidades));
      if (minimo <= maxOpcion) visitar(indice + 1, restantes - minimo * opcion.unidades, [...elegidas, { ...opcion, paquetes: minimo }]);
      return;
    }
    for (let paquetes = 0; paquetes <= maxOpcion; paquetes += 1) visitar(indice + 1, restantes - paquetes * opcion.unidades, [...elegidas, { ...opcion, paquetes }]);
  };
  visitar(0, objetivo, []);
  return estado.mejor === null ? null : { compras: estado.mejor.compras };
}

const costoDe = (cobertura: Cobertura): number => cobertura.compras.reduce((suma, c) => suma + c.paquetes * c.precio, 0);

export type CompraDeGlobo = {
  /** La combinación (`compras` en orden de variante). */
  cobertura: Cobertura;
  /** Globos del diseño que lleva cada variante: todas llevan al menos uno. */
  diseno: Map<string, number>;
  /** Globos de reserva que cubre cada variante. */
  reserva: Map<string, number>;
  /** Variantes con más paquetes que los que pedía el diseño solo (`additional_package_for_waste` de Python). */
  paraReserva: Set<string>;
  /** La reserva del globo: `ceil(necesidad × MERMA)`. */
  objetivoReserva: number;
};

/** Lo que se paga de más por los repuestos de un globo: hasta 10 000 COP, o hasta el 10 % de lo que cuesta su diseño. */
export const TOPE_RESERVA_COP = 10_000;
export const TOPE_RESERVA_PARTES = 10;

/**
 * D-038: el diseño y los repuestos de ESTE globo (talla y color), sin pagar de más por los repuestos. La reserva es de
 * cada globo, `ceil(n × MERMA)`, no una para el plan. Se busca la combinación que cubre `n + reserva` de una vez y se
 * compra si cuesta sobre el diseño solo como mucho `max(10 000 COP, 10 % del diseño)`; si cuesta más (un ×25 entero para
 * dos repuestos de 24″), se compra el diseño solo, la reserva usa lo que sobre de sus paquetes y lo que falte queda dicho
 * (`sinCubrir`). Cada variante lleva primero un globo del diseño y el resto del diseño se reparte en orden de variante; la
 * reserva cubre lo que queda. Mismo algoritmo que `comprar_globo` de `services/ai-api/app/presentaciones.py` (la fixture
 * `cotizacion-unica` los ata).
 */
export function comprarGlobo(necesidad: number, opciones: readonly Opcion[]): CompraDeGlobo | null {
  if (necesidad <= 0) return null;
  const objetivoReserva = Math.ceil(necesidad * MERMA);
  const soloDiseno = optimizarCobertura(necesidad, opciones);
  if (!soloDiseno) return null;
  let cobertura = soloDiseno;
  const conReserva = optimizarCobertura(necesidad + objetivoReserva, opciones, necesidad);
  if (conReserva) {
    const extra = costoDe(conReserva) - costoDe(soloDiseno);
    if (extra <= TOPE_RESERVA_COP || extra * TOPE_RESERVA_PARTES <= costoDe(soloDiseno)) cobertura = conReserva;
  }
  const antes = new Map(soloDiseno.compras.map((c) => [c.variantId, c.paquetes]));
  const diseno = new Map<string, number>();
  let resto = necesidad - cobertura.compras.length;
  for (const c of cobertura.compras) {
    const extra = Math.min(resto, c.paquetes * c.unidades - 1);
    diseno.set(c.variantId, 1 + extra);
    resto -= extra;
  }
  const reserva = new Map<string, number>();
  let pendiente = objetivoReserva;
  for (const c of cobertura.compras) {
    const cubierta = Math.min(pendiente, c.paquetes * c.unidades - diseno.get(c.variantId)!);
    reserva.set(c.variantId, cubierta);
    pendiente -= cubierta;
  }
  const paraReserva = new Set(cobertura.compras.filter((c) => c.paquetes > (antes.get(c.variantId) ?? 0)).map((c) => c.variantId));
  return { cobertura, diseno, reserva, paraReserva, objetivoReserva };
}

function varianteDe(entrada: EntradaCrosswalk, variantId: string): VarianteElegida {
  const v = entrada.variantes.find((x) => x.variantId === variantId)!;
  return { ok: true, productId: entrada.productId, variantId, titulo: entrada.titulo, tituloVariante: v.titulo, unidadesPaq: v.unidadesPaq, precio: v.precio, color: entrada.color };
}

// --- Política `python` ------------------------------------------------------------------------------------------------

function planearComoPython(lineas: ReadonlyArray<{ linea: BomLinea; entrada: EntradaCrosswalk }>): PlanDeCompra {
  const compras: CompraPlaneada[] = [];
  let objetivo = 0;
  for (const { linea, entrada } of lineas) {
    const comprada = comprarGlobo(linea.cantidad, entrada.variantes.map((v) => ({ variantId: v.variantId, unidades: v.unidadesPaq, precio: v.precio })));
    if (!comprada) continue;
    objetivo += comprada.objetivoReserva;
    for (const c of comprada.cobertura.compras) {
      compras.push({
        clave: claveCruce(linea.formatoId, linea.codigo), formatoId: linea.formatoId, codigo: linea.codigo, variante: varianteDe(entrada, c.variantId),
        cantidad: comprada.diseno.get(c.variantId)!, reserva: comprada.reserva.get(c.variantId)!, paquetes: c.paquetes, unidadesPaquete: c.unidades, paraReserva: comprada.paraReserva.has(c.variantId),
      });
    }
  }
  compras.sort((a, b) => porId(a.variante.variantId, b.variante.variantId));
  // Los paquetes que la reserva hizo comprar no son sobrante natural (`_waste_extra_packages` de Python).
  const deMas = (c: CompraPlaneada) => (c.paraReserva ? Math.max(0, c.paquetes - Math.max(1, Math.ceil(c.cantidad / c.unidadesPaquete))) : 0);
  const excedenteNatural = compras.reduce((suma, c) => suma + Math.max(0, (c.paquetes - deMas(c)) * c.unidadesPaquete - c.cantidad), 0);
  const cubierta = compras.reduce((suma, c) => suma + c.reserva, 0);
  return { politica: "python", compras, reserva: { objetivo, cubierta, sinCubrir: Math.max(0, objetivo - cubierta), excedenteNatural } };
}

// --- Política `mas_barato` --------------------------------------------------------------------------------------------

function planearMasBarato(lineas: ReadonlyArray<{ linea: BomLinea; entrada: EntradaCrosswalk }>, crosswalk: Crosswalk): PlanDeCompra {
  const compras: CompraPlaneada[] = lineas.map(({ linea }) => {
    const conMerma = cantidadConMerma(linea.cantidad);
    const v = elegirVariante(crosswalk, linea.formatoId, linea.codigo, conMerma) as VarianteElegida;
    return { clave: claveCruce(linea.formatoId, linea.codigo), formatoId: linea.formatoId, codigo: linea.codigo, variante: v, cantidad: linea.cantidad, reserva: conMerma - linea.cantidad, paquetes: Math.ceil(conMerma / v.unidadesPaq), unidadesPaquete: v.unidadesPaq, paraReserva: false };
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
