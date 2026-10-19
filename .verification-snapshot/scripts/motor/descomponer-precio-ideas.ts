import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { armarDesdeEspec, crosswalkIncluido, planearCompra, type BomLinea } from "../../src/lib/globos3d/motor/v1";
import { casosIdeas } from "../lib/casos-motor-guiada";

/**
 * Descompone, idea por idea, por qué las cuentas del motor 3D cuestan más que las de Python con la MISMA política de
 * paquetes y el MISMO cruce (REQ-007, D-038; sin red ni coste). La razón de precios se parte en cuatro factores cuyo
 * producto es exactamente la razón:
 *
 * - conteo: globos del motor ÷ globos de Python;
 * - talla: precio unitario de referencia por talla (el más barato de la talla en el cruce) promedio del motor ÷ el de Python;
 * - color/acabado: valor de consumo (globo x su precio unitario más barato) ÷ el valor de referencia por talla, motor ÷ Python;
 * - empaque: precio de compra ÷ valor de consumo (cuánto se paga de más por los paquetes cerrados), motor ÷ Python.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/motor/descomponer-precio-ideas.ts
 */
const RAIZ = path.resolve(__dirname, "..", "..");
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
const cruce = crosswalkIncluido();

const porVariante = new Map<string, { formatoId: string; codigo: string }>();
const unitario = new Map<string, number>();
const referenciaTalla = new Map<string, number>();
for (const [clave, entrada] of Object.entries(cruce.entradas)) {
  const [formatoId, codigo] = clave.split("|") as [string, string];
  for (const v of entrada.variantes) porVariante.set(v.variantId, { formatoId, codigo });
  const menor = Math.min(...entrada.variantes.map((v) => v.precio / v.unidadesPaq));
  unitario.set(clave, menor);
  referenciaTalla.set(formatoId, Math.min(referenciaTalla.get(formatoId) ?? Number.POSITIVE_INFINITY, menor));
}

type Medida = { globos: number; referencia: number; consumo: number; compra: number; lineas: number };

function medir(bom: readonly BomLinea[]): Medida | null {
  const plan = planearCompra(bom, cruce, "python");
  if (!plan.ok) return null;
  return {
    globos: bom.reduce((s, l) => s + l.cantidad, 0),
    referencia: bom.reduce((s, l) => s + l.cantidad * (referenciaTalla.get(l.formatoId) ?? 0), 0),
    consumo: bom.reduce((s, l) => s + l.cantidad * (unitario.get(`${l.formatoId}|${l.codigo}`) ?? 0), 0),
    compra: plan.compras.reduce((s, c) => s + c.paquetes * c.variante.precio, 0),
    lineas: bom.length,
  };
}

type LineaGuardada = { variant_id: string; unidades: number };
type Analisis = { plan_resuelto?: { totales: { purchase_cost: number }; estructuras: Array<{ lineas: LineaGuardada[] }> } };

function bomDePython(analisis: Analisis | null): BomLinea[] | null {
  const suma = new Map<string, BomLinea>();
  for (const estructura of analisis?.plan_resuelto?.estructuras ?? []) for (const linea of estructura.lineas) {
    const x = porVariante.get(linea.variant_id);
    if (!x) return null;
    const clave = `${x.formatoId}|${x.codigo}`;
    const previa = suma.get(clave);
    suma.set(clave, { ...x, cantidad: (previa?.cantidad ?? 0) + linea.unidades });
  }
  return suma.size ? [...suma.values()] : null;
}

const razon = (a: number, b: number) => (b ? a / b : Number.NaN);
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const factores = (m: Medida, p: Medida) => ({
  conteo: razon(m.globos, p.globos),
  talla: razon(m.referencia / m.globos, p.referencia / p.globos),
  color: razon(m.consumo / m.referencia, p.consumo / p.referencia),
  empaque: razon(m.compra / m.consumo, p.compra / p.consumo),
  total: razon(m.compra, p.compra),
});

const total = { m: { globos: 0, referencia: 0, consumo: 0, compra: 0, lineas: 0 }, p: { globos: 0, referencia: 0, consumo: 0, compra: 0, lineas: 0 }, guardado: 0, n: 0 };
const filas: string[] = [];
for (const caso of casosIdeas()) {
  const ideaId = caso.id.replace(/^idea-/, "");
  const idea = planes.ideas[ideaId]!;
  const ruta = path.join(RAIZ, "data", "biblioteca-real", "analisis", idea.archivo);
  const analisis = existsSync(ruta) ? (JSON.parse(readFileSync(ruta, "utf8")) as Analisis) : null;
  const resultado = armarDesdeEspec(caso.espec);
  const bomPy = bomDePython(analisis);
  const p = bomPy ? medir(bomPy) : null;
  const m = resultado.noRepresentable.length ? null : medir(resultado.bom.total);
  const guardado = analisis?.plan_resuelto?.totales.purchase_cost ?? 0;
  if (!p || !m) { filas.push(`| ${ideaId.slice(10, 12)} | ${guardado} | ${p?.compra ?? "—"} | ${m?.compra ?? "—"} | — | — | — | — | — | ${p?.lineas ?? "—"} → ${m?.lineas ?? "—"} |`); continue; }
  const x = factores(m, p);
  filas.push(`| ${ideaId.slice(10, 12)} | ${guardado} | ${p.compra} | ${m.compra} | ${f2(x.total)} | ${f2(x.conteo)} | ${f2(x.talla)} | ${f2(x.color)} | ${f2(x.empaque)} | ${p.lineas} → ${m.lineas} |`);
  for (const k of ["globos", "referencia", "consumo", "compra", "lineas"] as const) { total.m[k] += m[k]; total.p[k] += p[k]; }
  total.guardado += guardado;
  total.n += 1;
}
console.log("| # | Python guardado | Python cuentas, política python | Motor, política python | Razón | Conteo | Talla | Color/acabado | Empaque | Líneas Py → motor |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
console.log(filas.join("\n"));
const t = factores(total.m, total.p);
console.log(`\nComparables: ${total.n}. Suma guardada ${total.guardado}; Python cuentas ${total.p.compra}; motor ${total.m.compra}.`);
console.log(`Agregado: razón ${f2(t.total)} = conteo ${f2(t.conteo)} x talla ${f2(t.talla)} x color ${f2(t.color)} x empaque ${f2(t.empaque)}; líneas ${total.p.lineas} → ${total.m.lineas}; guardado ÷ Python cuentas ${f2(razon(total.guardado, total.p.compra))}.`);
