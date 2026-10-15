/**
 * Integración offline de las ediciones del cliente sobre las 28 ideas guardadas y las propuestas (REQ-014 T47, W7): cada caso se
 * arma por `armarDesdeEspec`, recibe cada una de las 12 operaciones de edición (datos de `lib-espec-aleatoria.ts`, semilla fija)
 * y se vuelve a armar y a cotizar con la política de Python (`planearCompra(..., "python")`: réplica local, sin red ni Python vivo).
 *   - la edición no muta la espec de entrada y la lista y el precio de la espec original siguen iguales después de todas;
 *   - editar es determinista: dos veces dan la misma lista y el mismo precio;
 *   - la lista de las piezas que la edición no tocó es idéntica; quitar una pieza no sube los globos y agregar una no los baja;
 *   - lo que no se puede hacer dice «No pude: …» y deja la espec, la lista y el precio como estaban;
 *   - las piezas que el motor no representa (caen a Python) siguen dichas como no representables si la edición no las tocó,
 *     y ninguna edición las arma por su cuenta ni cambia lo que Python cuenta del caso (la espec original no cambia).
 * Cada fallo imprime el caso, la operación y la semilla (`PROPIEDADES_SEMILLA`).
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-integracion-ideas.ts
 */
import assert from "node:assert/strict";
import { casosIdeas, type CasoMotor } from "../lib/casos-motor-guiada";
import {
  aplicarEdicion, armarDesdeEspec, crosswalkIncluido, especDesdePropuesta, planearCompra, PREFIJO_NO_PUDE,
  type BomLinea, type EdicionEspecV1, type EspecClienteV1, type ResultadoMotorV1,
} from "../../src/lib/globos3d/motor/v1";
import { Azar } from "./lib-semilla";
import { configPropiedades, semillaDeCaso } from "./lib-config-propiedades";
import { edicionAleatoria, OPERACIONES_ALEATORIAS } from "./lib-espec-aleatoria";

const { semilla: SEMILLA } = configPropiedades();
const cruce = crosswalkIncluido();

const PROPUESTAS = [
  { frase: "Te propongo un arco y dos columnas.", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] },
  { frase: "Mejor un arco y una guirnalda.", colores: ["rosado", "blanco"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "guirnalda", cantidad: 1 }] },
  { frase: "Un semiarco con un bouquet.", colores: ["verde", "dorado", "blanco"], piezas: [{ estructura: "semiarco", cantidad: 1 }, { estructura: "bouquet", cantidad: 1 }] },
] as const;

const ideas = casosIdeas();
const propuestas: CasoMotor[] = PROPUESTAS.map((p, i) => {
  const { espec, avisos } = especDesdePropuesta({ frase: p.frase, colores: [...p.colores], piezas: p.piezas.map((x) => ({ ...x })) });
  return { id: `propuesta-${i + 1}`, espec, avisosDeConversion: avisos };
});
const casos: CasoMotor[] = [...ideas, ...propuestas];
/** El generador pide `idea-1`..`idea-9`: se resuelven a las ideas guardadas por posición; un id que no existe devuelve null (la ruta real). */
const ideaDe = (ideaId: string): EspecClienteV1 | null => {
  const real = ideas.find((k) => k.id === `idea-${ideaId}`);
  if (real) return real.espec;
  const posicion = /^idea-([1-9])$/.exec(ideaId);
  return posicion ? ideas[Number(posicion[1]) - 1]?.espec ?? null : null;
};

const unidades = (lineas: readonly BomLinea[]) => lineas.reduce((s, l) => s + l.cantidad, 0);

/** Precio con la política de Python, o el motivo de que no cotice (líneas sin cobertura). */
function precioDe(bom: readonly BomLinea[]): { precio: number } | { sinCobertura: number } {
  const plan = planearCompra(bom, cruce, "python");
  return plan.ok ? { precio: Math.round(plan.compras.reduce((s, c) => s + c.paquetes * c.variante.precio, 0)) } : { sinCobertura: plan.faltantes.length };
}

const resumen = (r: ResultadoMotorV1) => ({ hash: r.especHash, globos: unidades(r.bom.total), total: r.bom.total, porPieza: r.bom.porPieza, noRep: r.noRepresentable.map((n) => n.piezaId), precio: precioDe(r.bom.total) });

{
  const base = casos[0]!.espec;
  const rechazo = aplicarEdicion(base, { op: "agregar_idea", ideaId: "idea-que-no-existe" }, { idea: ideaDe });
  assert.ok(rechazo.noAplicado?.startsWith(PREFIJO_NO_PUDE), `agregar_idea con un id desconocido no se rechazó con «No pude:» (${rechazo.noAplicado})`);
  assert.deepEqual(rechazo.espec, base, "agregar_idea con un id desconocido cambió la espec");
}

assert.equal(ideas.length, 28, `las ideas guardadas son ${ideas.length} y se esperaban 28`);

const cuentas = { ediciones: 0, aplicadas: 0, rechazadas: 0, noRepresentablesQueSiguen: 0, repreciadas: 0, sinCambioDePrecio: 0 };
const porOperacion: Record<string, number> = {};

for (const c of casos) {
  const original = structuredClone(c.espec);
  const base = armarDesdeEspec(c.espec);
  const antes = resumen(base);
  assert.deepEqual(resumen(armarDesdeEspec(structuredClone(c.espec))), antes, `${c.id}: armar dos veces da otra cosa`);

  for (let op = 0; op < OPERACIONES_ALEATORIAS; op += 1) {
    const edicion: EdicionEspecV1 = edicionAleatoria(new Azar(semillaDeCaso(SEMILLA, `integracion-ideas|${c.id}`, op)), c.espec, op);
    const donde = `${c.id} ${edicion.op} (PROPIEDADES_SEMILLA=${SEMILLA}, operación ${op}, ${JSON.stringify(edicion)})`;
    cuentas.ediciones += 1;
    const res = aplicarEdicion(c.espec, edicion, { idea: ideaDe });
    assert.deepEqual(c.espec, original, `${donde}: la edición mutó la espec de entrada`);

    if (res.noAplicado) {
      cuentas.rechazadas += 1;
      assert.ok(res.noAplicado.startsWith(PREFIJO_NO_PUDE), `${donde}: rechazo sin «No pude:» (${res.noAplicado})`);
      assert.deepEqual(res.espec, c.espec, `${donde}: un rechazo cambió la espec`);
      assert.deepEqual(resumen(armarDesdeEspec(res.espec)), antes, `${donde}: un rechazo cambió la lista o el precio`);
      continue;
    }
    cuentas.aplicadas += 1;
    porOperacion[edicion.op] = (porOperacion[edicion.op] ?? 0) + 1;

    const editada = armarDesdeEspec(res.espec);
    const despues = resumen(editada);
    assert.deepEqual(resumen(armarDesdeEspec(structuredClone(res.espec))), despues, `${donde}: editar y armar dos veces da otra lista o otro precio`);
    assert.ok("precio" in despues.precio || despues.precio.sinCobertura > 0, `${donde}: el precio ni cotiza ni dice qué línea no cubre`);
    if ("precio" in despues.precio) cuentas.repreciadas += 1;
    if (JSON.stringify(despues.precio) === JSON.stringify(antes.precio)) cuentas.sinCambioDePrecio += 1;

    const tocadas = new Set(res.tocadas);
    for (const [id, lineas] of Object.entries(base.bom.porPieza)) {
      if (tocadas.has(id) || !res.espec.piezas.some((p) => p.id === id)) continue;
      assert.deepEqual(editada.bom.porPieza[id], lineas, `${donde}: cambió la lista de ${id}, que la edición no tocó`);
    }
    for (const id of antes.noRep) {
      if (tocadas.has(id) || !res.espec.piezas.some((p) => p.id === id)) continue;
      assert.ok(despues.noRep.includes(id), `${donde}: ${id} no representable y sin tocar pasó a armarse`);
      cuentas.noRepresentablesQueSiguen += 1;
    }
    for (const n of editada.noRepresentable) assert.ok(n.motivo.length > 10, `${donde}: un no representable sin motivo`);

    if (edicion.op === "quitar_pieza") assert.ok(despues.globos <= antes.globos, `${donde}: quitar una pieza subió los globos (${antes.globos} a ${despues.globos})`);
    if (edicion.op === "agregar_pieza" || edicion.op === "agregar_idea") assert.ok(despues.globos >= antes.globos, `${donde}: sumar piezas bajó los globos (${antes.globos} a ${despues.globos})`);
  }

  assert.deepEqual(c.espec, original, `${c.id}: tras todas las ediciones la espec original cambió`);
  assert.deepEqual(resumen(armarDesdeEspec(c.espec)), antes, `${c.id}: tras todas las ediciones, la lista o el precio de la espec original cambió`);
}

assert.ok(cuentas.aplicadas >= casos.length * 4, `solo ${cuentas.aplicadas} ediciones aplicadas en ${cuentas.ediciones}: la integración queda en vacío`);
assert.ok(cuentas.repreciadas > 0 && cuentas.noRepresentablesQueSiguen > 0, "ninguna edición se volvió a cotizar o ninguna idea no representable se ejerció");
const operacionesSin = ["reemplazar_color", "agregar_color", "quitar_color", "proporcion_color", "mas_menos_color", "tamano_pieza", "tamano_globos", "lado", "quitar_pieza", "agregar_pieza", "agregar_idea", "flores"].filter((op) => !porOperacion[op]);
assert.deepEqual(operacionesSin, [], `operaciones que nunca se aplicaron: ${operacionesSin.join(", ")}`);
console.log(`test-motor-guiada-integracion-ideas: ok (${casos.length} casos = 28 ideas + ${propuestas.length} propuestas; ${cuentas.ediciones} ediciones: ${cuentas.aplicadas} aplicadas, ${cuentas.rechazadas} con «No pude»; ${cuentas.repreciadas} recotizadas, ${cuentas.sinCambioDePrecio} sin cambio de precio; ${cuentas.noRepresentablesQueSiguen} no representables que siguen cayendo a Python)`);
