import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { armarDesdeEspec, crosswalkIncluido, planearCompra, type BomLinea } from "../../src/lib/globos3d/motor/v1";
import { presentaciones, type Crosswalk } from "../../src/lib/globos3d/motor/crosswalk-variantes";
import { colorDeCompra, pulgadasDeFormato } from "../../src/lib/globos3d/motor/plan-de-compra";
import { casosIdeas, DIRECTORIO_DORADO } from "./casos-motor-guiada";

/**
 * La fixture compartida de la cotización única (D-038): listas de materiales con las presentaciones que la tienda vende
 * de cada globo y lo que se compra y cuesta con la regla única (`planearCompra`, política `python`). La leen la prueba
 * de paridad de TypeScript (`test-cotizacion-unica.ts`: cada superficie da este total) y la de Python
 * (`services/ai-api/tests/test_cotizacion_unica.py`: el resolutor compra lo mismo con la allowlist reducida a un
 * paquete). Sin red ni coste. Se regenera con `scripts/motor/generar-cotizacion-unica.ts`.
 */
const RAIZ = path.resolve(__dirname, "..", "..");
export const DIRECTORIO_COTIZACION_UNICA = path.join(path.dirname(DIRECTORIO_DORADO), "cotizacion-unica");
/** Ideas de la biblioteca de la muestra: arcos clásicos, orgánicos, columnas, guirnalda, aro, eslabones y balones. */
export const IDEAS_MUESTRA = ["01", "02", "04", "08", "11", "28", "29", "31"] as const;

export type LineaCotizacion = {
  formatoId: string;
  codigo: string;
  cantidad: number;
  productId: string;
  /** El color con que se agrupa la reserva (`colorDeCompra`). */
  color: string;
  diamPulg: number;
  presentaciones: Array<{ variantId: string; unidadesPaq: number; precio: number }>;
};

export type CasoCotizacion = {
  caso: string;
  /** `catalogo`: listas con paquetes reales del cruce (el caso de la revisión y las aleatorias con semilla fija). */
  origen: "motor" | "python" | "sintetico" | "catalogo";
  idea: string | null;
  snapshot: string;
  lineas: LineaCotizacion[];
  esperado: {
    total: number;
    reserva: { objetivo: number; cubierta: number; sinCubrir: number; excedenteNatural: number };
    compras: Array<{ variantId: string; paquetes: number; cantidad: number; reserva: number; paraReserva: boolean }>;
  };
};

/** El cruce que describen las líneas: el mismo para el caso real (sale del incluido) y para el sintético. */
export function crosswalkDeLineas(snapshot: string, lineas: readonly LineaCotizacion[]): Crosswalk {
  return {
    version: 1, snapshot, sinCobertura: {},
    entradas: Object.fromEntries(lineas.map((l) => [`${l.formatoId}|${l.codigo}`, {
      productId: l.productId, titulo: `Globo ${l.formatoId} ${l.codigo}`, color: l.color,
      variantes: l.presentaciones.map((p) => ({ variantId: p.variantId, titulo: `${l.formatoId} / PAQUETE X ${p.unidadesPaq}`, unidadesPaq: p.unidadesPaq, precio: p.precio })),
    }])),
  };
}

/** Lo que se compra y cuesta con la regla única. */
export function esperadoDe(snapshot: string, lineas: readonly LineaCotizacion[]): CasoCotizacion["esperado"] {
  const plan = planearCompra(lineas.map((l) => ({ formatoId: l.formatoId, codigo: l.codigo, cantidad: l.cantidad })), crosswalkDeLineas(snapshot, lineas), "python");
  if (!plan.ok) throw new Error(`sin tienda: ${plan.faltantes.map((f) => `${f.formatoId} ${f.codigo}`).join(", ")}`);
  return {
    total: plan.compras.reduce((suma, c) => suma + c.paquetes * c.variante.precio, 0),
    reserva: { objetivo: plan.reserva.objetivo, cubierta: plan.reserva.cubierta, sinCubrir: plan.reserva.sinCubrir, excedenteNatural: plan.reserva.excedenteNatural },
    compras: plan.compras.map((c) => ({ variantId: c.variante.variantId, paquetes: c.paquetes, cantidad: c.cantidad, reserva: c.reserva, paraReserva: c.paraReserva })),
  };
}

function lineasDelCruce(bom: readonly BomLinea[], cruce: Crosswalk): LineaCotizacion[] {
  return bom.map((l) => {
    const hay = presentaciones(cruce, l.formatoId, l.codigo);
    if (!hay.ok) throw new Error(`${l.formatoId} ${l.codigo} sin tienda (${hay.motivo})`);
    const color = colorDeCompra(hay.entrada, l.codigo);
    return { ...l, productId: hay.entrada.productId, color, diamPulg: pulgadasDeFormato(l.formatoId), presentaciones: hay.entrada.variantes.map((v) => ({ variantId: v.variantId, unidadesPaq: v.unidadesPaq, precio: v.precio })) };
  });
}

type LineaGuardada = { variant_id: string; unidades: number };
type Analisis = { plan_resuelto?: { estructuras: Array<{ lineas: LineaGuardada[] }> } };

/** Las cuentas del plan de Python guardado de la idea como lista del motor, o null si alguna línea no está en el cruce. */
function bomDePython(archivo: string, cruce: Crosswalk): BomLinea[] | null {
  const ruta = path.join(RAIZ, "data", "biblioteca-real", "analisis", archivo);
  if (!existsSync(ruta)) return null;
  const porVariante = new Map(Object.entries(cruce.entradas).flatMap(([clave, e]) => e.variantes.map((v) => [v.variantId, clave] as const)));
  const suma = new Map<string, number>();
  for (const estructura of (JSON.parse(readFileSync(ruta, "utf8")) as Analisis).plan_resuelto?.estructuras ?? []) for (const linea of estructura.lineas) {
    const clave = porVariante.get(linea.variant_id);
    if (!clave) return null;
    suma.set(clave, (suma.get(clave) ?? 0) + linea.unidades);
  }
  return [...suma].map(([clave, cantidad]) => { const [formatoId, codigo] = clave.split("|") as [string, string]; return { formatoId, codigo, cantidad }; });
}

const presentacion = (variantId: string, unidadesPaq: number, precio: number) => ({ variantId, unidadesPaq, precio });
const SINTETICOS: Array<{ caso: string; lineas: LineaCotizacion[] }> = [
  { caso: "sintetico-diseno-y-reserva-en-una-combinacion", lineas: [
    { formatoId: "R-12", codigo: "S01", cantidad: 136, productId: "P-ROJO", color: "rojo", diamPulg: 12, presentaciones: [presentacion("V-ROJO-12-X50", 50, 12000), presentacion("V-ROJO-12-X12", 12, 3500)] },
  ] },
  { caso: "sintetico-paquete-chico-mas-barato", lineas: [
    { formatoId: "R-12", codigo: "S01", cantidad: 136, productId: "P-ROJO", color: "rojo", diamPulg: 12, presentaciones: [presentacion("V-ROJO-12-X50", 50, 12000), presentacion("V-ROJO-12-X12", 12, 2000)] },
  ] },
  { caso: "sintetico-dos-globos-cada-uno-con-su-reserva", lineas: [
    { formatoId: "R-12", codigo: "S02", cantidad: 66, productId: "P-AZUL", color: "azul", diamPulg: 12, presentaciones: [presentacion("V-AZUL-12-X12", 12, 4249), presentacion("V-AZUL-12-X20", 20, 6461)] },
    { formatoId: "R-12", codigo: "S03", cantidad: 59, productId: "P-PLATA", color: "plateado", diamPulg: 12, presentaciones: [presentacion("V-PLATA-12-X12", 12, 8832), presentacion("V-PLATA-12-X50", 50, 28977)] },
  ] },
];

/** PRNG con semilla (mulberry32): las listas aleatorias de la fixture y de la prueba de propiedad salen siempre iguales. */
export function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una lista de 1 a 6 globos del cruce, de 1 a 400 cada uno. */
export function listaAleatoria(cruce: Crosswalk, siguiente: () => number): BomLinea[] {
  const claves = Object.keys(cruce.entradas).sort();
  const elegidas = new Map<string, number>();
  const lineas = 1 + Math.floor(siguiente() * 6);
  while (elegidas.size < lineas) elegidas.set(claves[Math.floor(siguiente() * claves.length)]!, 1 + Math.floor(siguiente() * 400));
  return [...elegidas].map(([clave, cantidad]) => { const [formatoId, codigo] = clave.split("|") as [string, string]; return { formatoId, codigo, cantidad }; });
}

/** El caso de la revisión de D-038: con UNA reserva para el plan, la regla anterior compraba 200 047 contra 168 864. */
const CASO_REVISION: BomLinea[] = [{ formatoId: "R-5", codigo: "826", cantidad: 146 }, { formatoId: "R-24", codigo: "005", cantidad: 39 }];
/** Revisión 3: LOL 6 y LOL 660 miden 6″ y son del mismo producto; Python los tomaba por el mismo globo. */
const CASO_LOL_660: BomLinea[] = [{ formatoId: "LOL-660", codigo: "032", cantidad: 34 }];
const CASO_CAT3258: BomLinea[] = [
  { formatoId: "R-9", codigo: "826", cantidad: 5 }, { formatoId: "LOL-660", codigo: "032", cantidad: 34 }, { formatoId: "R-9", codigo: "074", cantidad: 21 },
  { formatoId: "T-260", codigo: "029", cantidad: 9 }, { formatoId: "LOL-6", codigo: "032", cantidad: 21 }, { formatoId: "R-12", codigo: "806", cantidad: 9 },
  { formatoId: "R-5", codigo: "071", cantidad: 17 },
];
const LISTAS_ALEATORIAS = 20;
const SEMILLA_FIXTURE = 38;

export function casosCotizacionUnica(): CasoCotizacion[] {
  const cruce = crosswalkIncluido();
  const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
  const casos: CasoCotizacion[] = SINTETICOS.map(({ caso, lineas }) => ({ caso, origen: "sintetico", idea: null, snapshot: "sintetico", lineas, esperado: esperadoDe("sintetico", lineas) }));
  const delCatalogo = (caso: string, bom: readonly BomLinea[]): CasoCotizacion => {
    const lineas = lineasDelCruce(bom, cruce);
    return { caso, origen: "catalogo", idea: null, snapshot: cruce.snapshot, lineas, esperado: esperadoDe(cruce.snapshot, lineas) };
  };
  casos.push(delCatalogo("catalogo-revision-r5-verde-r24-blanco", CASO_REVISION));
  casos.push(delCatalogo("catalogo-revision3-lol660-verde-selva", CASO_LOL_660));
  casos.push(delCatalogo("catalogo-revision3-cat3258-lol6-y-lol660", CASO_CAT3258));
  const siguiente = azar(SEMILLA_FIXTURE);
  for (let k = 1; k <= LISTAS_ALEATORIAS; k += 1) casos.push(delCatalogo(`catalogo-aleatoria-${String(k).padStart(2, "0")}`, listaAleatoria(cruce, siguiente)));
  for (const caso of casosIdeas()) {
    const idea = caso.id.replace(/^idea-/, "");
    if (!IDEAS_MUESTRA.some((n) => idea.startsWith(`deco-real-${n}-`))) continue;
    const resultado = armarDesdeEspec(caso.espec);
    if (resultado.noRepresentable.length) throw new Error(`${idea}: el motor no la arma`);
    const lineasMotor = lineasDelCruce(resultado.bom.total, cruce);
    casos.push({ caso: `${idea.slice(0, 12)}-motor`, origen: "motor", idea, snapshot: cruce.snapshot, lineas: lineasMotor, esperado: esperadoDe(cruce.snapshot, lineasMotor) });
    const bomPython = bomDePython(planes.ideas[idea]!.archivo, cruce);
    if (!bomPython) continue;
    const lineasPython = lineasDelCruce(bomPython, cruce);
    casos.push({ caso: `${idea.slice(0, 12)}-python`, origen: "python", idea, snapshot: cruce.snapshot, lineas: lineasPython, esperado: esperadoDe(cruce.snapshot, lineasPython) });
  }
  return casos;
}
