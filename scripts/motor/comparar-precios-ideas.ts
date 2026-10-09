import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido } from "../../src/lib/globos3d/motor/v1";
import { casosIdeas } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

/**
 * Informe (solo información, sin compuerta): el precio de las 28 ideas guardadas con el motor de Python contra el del
 * motor 3D. El de Python es el del plan resuelto guardado (`data/biblioteca-real/analisis/*.plan.json`, snapshot
 * `products_catalog:13a9…`); el del 3D, la lista del motor con merma 8 % y paquetes cerrados sobre los precios del MISMO
 * snapshot, con la aritmética de `cotizar_lista_materiales` (doble sin red: no llama al servicio de precios).
 *
 *   npx tsx --conditions=react-server scripts/motor/comparar-precios-ideas.ts
 */
const RAIZ = path.resolve(__dirname, "..", "..");
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
const cruce = crosswalkIncluido();
const pesos = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

async function main(): Promise<void> {
  const filas: string[] = [];
  let sumaPython = 0, sumaMotor = 0, comparables = 0;
  for (const caso of casosIdeas()) {
    const ideaId = caso.id.replace(/^idea-/, "");
    const idea = planes.ideas[ideaId]!;
    const analisis = path.join(RAIZ, "data", "biblioteca-real", "analisis", idea.archivo);
    const python = existsSync(analisis) ? JSON.parse(readFileSync(analisis, "utf8")) as { plan_resuelto?: { totales?: { total_cop?: number; total_unidades?: number } } } : null;
    const totalPython = python?.plan_resuelto?.totales?.total_cop ?? null;
    const globosPython = python?.plan_resuelto?.totales?.total_unidades ?? idea.globos;
    const resultado = armarDesdeEspec(caso.espec);
    const globosMotor = resultado.bom.total.reduce((s, l) => s + l.cantidad, 0);
    let estado = "ok", totalMotor: number | null = null;
    if (resultado.noRepresentable.length) estado = `Python (${resultado.noRepresentable.map((n) => n.piezaId).join(", ")})`;
    else {
      const cot = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
      if (cot.ok) totalMotor = cot.total; else estado = cot.razon === "sin_cobertura" ? `Python (sin tienda: ${cot.faltantes.map((f) => `${f.formatoId} ${f.codigo}`).join(", ")})` : `Python (${cot.razon})`;
    }
    if (totalMotor !== null && totalPython !== null) { sumaPython += totalPython; sumaMotor += totalMotor; comparables += 1; }
    const razon = totalMotor !== null && totalPython ? (totalMotor / totalPython).toFixed(2) : "—";
    filas.push(`| ${ideaId.slice(10, 12)} | ${ideaId.slice(13, 48)} | ${globosPython} | ${resultado.noRepresentable.length ? "—" : globosMotor} | ${totalPython === null ? "—" : `$${pesos.format(totalPython)}`} | ${totalMotor === null ? "—" : `$${pesos.format(totalMotor)}`} | ${razon} | ${estado} |`);
  }
  console.log("| # | Idea | Globos Python | Globos motor | Precio Python | Precio motor | Motor/Python | Camino |\n|---|---|---|---|---|---|---|---|");
  console.log(filas.join("\n"));
  console.log(`\nComparables: ${comparables} de 28. Suma Python $${pesos.format(sumaPython)}, suma motor $${pesos.format(sumaMotor)}, razón ${(sumaMotor / sumaPython).toFixed(2)}.`);
}

void main();
