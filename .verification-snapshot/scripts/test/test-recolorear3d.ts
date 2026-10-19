/**
 * «Colores de la escena» (`reemplazarColor`, `coloresUsados`): cambiar un color en todo un montaje de una vez.
 * Sin coste.
 * - cambia `codigo`, `codigos` y `colores` en cualquier nivel (pared, mezcla, decoraciones);
 * - no cambia donde el color nuevo no se fabrica en ese formato, y lo avisa en `omitidos`;
 * - no toca los demás colores ni el dato original.
 */
import assert from "node:assert/strict";
import { CELEBRA_27, decorarPared } from "../../src/lib/globos3d/mezcla";
import { armarParedTrenzas, superficieFrontal } from "../../src/lib/globos3d/pared-trenzas";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { coloresUsados, reemplazarColor } from "../../src/lib/globos3d/recolorear";

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);
const escena = (pared: typeof CELEBRA_27.pared, mezcla: typeof CELEBRA_27.mezcla) => {
  const p = armarParedTrenzas(pared);
  const d = decorarPared({ anclas: p.anclas, mezcla, superficie: superficieFrontal(p.globos), limites: { minX: 0, maxX: p.anchoCm, minY: 0, maxY: p.altoCm } });
  return [...p.materiales, ...d.materiales];
};

// La pared rosada (009) pasa a Fashion Lila sin tocar las decoraciones de otros colores.
const antes = coloresUsados(escena(CELEBRA_27.pared, CELEBRA_27.mezcla));
assert.equal(antes[0]!.codigo, "009", "el color con más globos va primero");
const nuevo = coloresDelFormato("R-12").find((c) => c.codigo !== "009" && existe("R-9", c.codigo) && existe("R-5", c.codigo) && existe("T-260", c.codigo))!.codigo;
const pared = reemplazarColor(CELEBRA_27.pared, "009", nuevo);
const mezcla = reemplazarColor(CELEBRA_27.mezcla, "009", nuevo);
assert.ok(pared.cambios > 0 && mezcla.cambios > 0);
assert.deepEqual([...pared.omitidos, ...mezcla.omitidos], []);
const despues = coloresUsados(escena(pared.valor, mezcla.valor));
assert.ok(!despues.some((u) => u.codigo === "009"), "ya no queda 009");
assert.equal(despues.find((u) => u.codigo === nuevo)?.cantidad, antes.find((u) => u.codigo === "009")!.cantidad + (antes.find((u) => u.codigo === nuevo)?.cantidad ?? 0));
for (const u of antes.filter((u) => u.codigo !== "009" && u.codigo !== nuevo)) assert.equal(despues.find((d) => d.codigo === u.codigo)?.cantidad, u.cantidad, `${u.codigo} intacto`);
assert.deepEqual(CELEBRA_27.pared.colores, ["009"], "el original no se toca");

// Un color que no viene en T-260: los tubitos quedan como estaban y se avisa.
const soloRedondo = coloresDelFormato("R-5").find((c) => !existe("T-260", c.codigo))!.codigo;
const parcial = reemplazarColor(CELEBRA_27.mezcla, "012", soloRedondo);
assert.ok(parcial.omitidos.includes("T-260"), `omitidos: ${parcial.omitidos.join(", ")}`);
const usadosParcial = coloresUsados(escena(CELEBRA_27.pared, parcial.valor));
for (const u of usadosParcial) for (const f of u.formatos) assert.ok(existe(f, u.codigo), `${u.codigo} existe en ${f}`);
assert.ok(usadosParcial.some((u) => u.codigo === "012" && u.formatos.includes("T-260")), "los T-260 fucsia siguen fucsia");

console.log(`OK test-recolorear3d: Celebra ed. 27 de 009 a ${nuevo} en un paso; ${soloRedondo} (sin T-260) respeta los tubitos`);
