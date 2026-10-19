import { readFileSync } from "node:fs";
import path from "node:path";
import { PlanesIdeasArchivoSchema } from "../../src/lib/plan/plan-de-idea";
import { casosIdeas, clasificar, registroDe } from "../lib/casos-motor-guiada";

/**
 * Cómo se representa cada una de las 28 ideas guardadas en el motor 3D: representable, aproximada, declarada o
 * fallback a Python, con el motivo, y los globos del motor contra los del plan guardado (informativo).
 *
 *   npx tsx --conditions=react-server scripts/motor/mapeo-ideas.ts
 */
const planes = PlanesIdeasArchivoSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "..", "..", "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")));
const titulo = (id: string) => planes.ideas[id.replace(/^idea-/, "")]!.plan.concepto.titulo;

const filas = casosIdeas().map((caso) => {
  const { estado, razones } = clasificar(caso.espec);
  const registro = registroDe(caso);
  const sinDibujar = registro.noRepresentable.length ? ` (sin ${registro.noRepresentable.map((n) => n.piezaId).join(", ")})` : "";
  return `| ${caso.id.replace(/^idea-deco-real-/, "").slice(0, 2)} | ${titulo(caso.id)} | ${caso.espec.piezas.map((p) => p.oficial).join(", ")} | ${estado} | ${razones.join(" ") || "—"} | ${caso.globosPython} | ${registro.total.unidades}${sinDibujar} |`;
});
console.log("| # | Idea | Piezas | Estado | Motivo | Globos Python | Globos motor |\n|---|---|---|---|---|---|---|");
console.log(filas.join("\n"));
