/** Regression checks for the three real-library plans corrected in REQ-014 T12. */
import assert from "node:assert/strict";
import planesRaw from "@/lib/biblioteca-sempertex/planes-ideas.json";
import { detalleDeIdea } from "@/lib/biblioteca-sempertex/detalle-idea";
import { PlanesIdeasArchivoSchema } from "@/lib/plan/plan-de-idea";

const { ideas } = PlanesIdeasArchivoSchema.parse(planesRaw);

function savedPlan(id: string) {
  const idea = ideas[id];
  assert.ok(idea, `missing saved plan for ${id}`);
  return idea.plan;
}

const idea29 = savedPlan("deco-real-29-arco-link-o-loon-fucsia-tulipanes");
const arches29 = idea29.estructuras.filter((structure) => structure.estructura_oficial === "arco");
assert.equal(arches29.length, 1, "idea 29 must contain one arch");
assert.equal(arches29[0]?.tipo, "arco", "idea 29 arch must use arch geometry");
assert.equal(
  arches29[0]?.materiales.some((material) => material.product_id === "8634219561255"),
  true,
  "idea 29 arch must retain its Link-O-Loon product",
);
assert.equal(
  idea29.estructuras.some((structure) => structure.estructura_oficial?.includes("columna")),
  false,
  "idea 29 must not encode the arch as columns",
);

const idea30 = savedPlan("deco-real-30-columna-balon-futbol");
const footballFigures = idea30.estructuras.filter((structure) => structure.estructura_oficial === "figura");
assert.equal(footballFigures.length, 1, "idea 30 must retain its separate football figure");
assert.equal(footballFigures[0]?.tipo, "kit", "the football figure must use the non-geometric kit type");
assert.equal(footballFigures[0]?.repeticiones, 1, "idea 30 must contain one football figure");
assert.equal(footballFigures[0]?.unidades_declaradas, 104, "the figure must keep its 104 photo-estimated balloons");
assert.deepEqual(
  footballFigures[0]?.materiales.map((material) => material.variant_id).sort(),
  ["46594221146407", "46594221343015", "46594235040039"],
  "the football figure must keep its black and white balloon variants",
);
assert.equal(ideas["deco-real-30-columna-balon-futbol"]?.globos, 164, "the exact plan must include the column and the football figure");

const detail30 = detalleDeIdea("deco-real-30-columna-balon-futbol");
assert.ok(detail30, "idea 30 must retain its material detail");
assert.ok(detail30.piezas.some((piece) => piece.id === "PIEZA_02_FIGURA"), "idea 30 detail must retain the separate football figure");
assert.equal(
  detail30.lineasSinPieza?.reduce((total, line) => total + line.unidades, 0),
  164,
  "when photo variants cannot be attributed to Python pieces, the whole decoration remains visible instead of inventing a per-piece split",
);

const idea31 = savedPlan("deco-real-31-arco-futbol-balones-gigantes");
const asymmetricArches31 = idea31.estructuras.filter((structure) => structure.estructura_oficial === "arco_asimetrico");
assert.equal(asymmetricArches31.length, 1, "idea 31 must contain one asymmetric arch");
assert.equal(asymmetricArches31[0]?.tipo, "arco", "idea 31 must use arch geometry");
assert.equal(
  idea31.estructuras.some((structure) => structure.tipo === "semiarco"),
  false,
  "idea 31 must not be stored as a half-arch",
);

console.log("test-planes-ideas-29-31: OK");
