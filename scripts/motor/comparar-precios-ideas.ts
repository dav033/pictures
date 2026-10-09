import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido, type PoliticaPaquetes } from "../../src/lib/globos3d/motor/v1";
import { casosIdeas } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

/**
 * Informe (solo información, sin compuerta): el precio de las 28 ideas guardadas con el motor de Python contra el del
 * motor 3D. El de Python es el del plan resuelto guardado (`data/biblioteca-real/analisis/*.plan.json`, snapshot
 * `products_catalog:13a9…`); el del 3D, la lista del motor con las dos políticas de paquetes (`python`: la combinación de presentaciones y la
 * reserva única del plan como Python; `mas_barato`: merma por línea y el paquete más barato) sobre los precios del MISMO
 * snapshot, con la aritmética de `cotizar_lista_materiales` (doble sin red: no llama al servicio de precios).
 *
 *   npx tsx --conditions=react-server scripts/motor/comparar-precios-ideas.ts
 */
const RAIZ = path.resolve(__dirname, "..", "..");
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
const cruce = crosswalkIncluido();
const pesos = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

async function precio(resultado: ReturnType<typeof armarDesdeEspec>, politica: PoliticaPaquetes): Promise<{ total: number } | { falla: string }> {
  const cot = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista, politica });
  if (cot.ok) return { total: cot.total };
  return { falla: cot.razon === "sin_cobertura" ? `sin tienda: ${cot.faltantes.map((f) => `${f.formatoId} ${f.codigo}`).join(", ")}` : cot.razon };
}

async function main(): Promise<void> {
  const filas: string[] = [];
  const suma = { python: 0, py: 0, barato: 0, n: 0 };
  for (const caso of casosIdeas()) {
    const ideaId = caso.id.replace(/^idea-/, "");
    const idea = planes.ideas[ideaId]!;
    const analisis = path.join(RAIZ, "data", "biblioteca-real", "analisis", idea.archivo);
    const python = existsSync(analisis) ? JSON.parse(readFileSync(analisis, "utf8")) as { plan_resuelto?: { totales?: { total_cop?: number; total_unidades?: number } } } : null;
    const totalPython = python?.plan_resuelto?.totales?.total_cop ?? null;
    const globosPython = python?.plan_resuelto?.totales?.total_unidades ?? idea.globos;
    const resultado = armarDesdeEspec(caso.espec);
    const globosMotor = resultado.bom.total.reduce((s, l) => s + l.cantidad, 0);
    let camino = "3D";
    let a: number | null = null, b: number | null = null;
    if (resultado.noRepresentable.length) camino = `Python (${resultado.noRepresentable.map((n) => n.piezaId).join(", ")})`;
    else {
      const [pp, pb] = [await precio(resultado, "python"), await precio(resultado, "mas_barato")];
      if ("total" in pp && "total" in pb) { a = pp.total; b = pb.total; } else camino = `Python (${"falla" in pp ? pp.falla : ""})`;
    }
    if (a !== null && b !== null && totalPython !== null) { suma.python += totalPython; suma.py += a; suma.barato += b; suma.n += 1; }
    const razon = (x: number | null) => (x !== null && totalPython ? (x / totalPython).toFixed(2) : "—");
    const moneda = (x: number | null) => (x === null ? "—" : `$${pesos.format(x)}`);
    filas.push(`| ${ideaId.slice(10, 12)} | ${ideaId.slice(13, 40)} | ${globosPython} | ${resultado.noRepresentable.length ? "—" : globosMotor} | ${moneda(totalPython)} | ${moneda(a)} | ${razon(a)} | ${moneda(b)} | ${razon(b)} | ${camino} |`);
  }
  console.log("| # | Idea | Globos Python | Globos motor | Precio Python | Motor «python» | Razón | Motor «mas_barato» | Razón | Camino |" + String.fromCharCode(10) + "|---|---|---|---|---|---|---|---|---|---|");
  console.log(filas.join(String.fromCharCode(10)));
  console.log(`${String.fromCharCode(10)}Comparables: ${suma.n} de 28. Suma Python $${pesos.format(suma.python)}; motor «python» $${pesos.format(suma.py)} (${(suma.py / suma.python).toFixed(2)}); motor «mas_barato» $${pesos.format(suma.barato)} (${(suma.barato / suma.python).toFixed(2)}).`);
}

void main();
