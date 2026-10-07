import assert from "node:assert/strict";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";
import { PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { WidgetGuiadoSchema } from "@/lib/ia/guiado/widgets";

const propuesta = normalizarPropuestaComposicion({
  frase: "Te propongo dos columnas y un arco en rosa y dorado.",
  colores: ["rosado", "dorado"],
  piezas: [{ estructura: "columna_asimetrica", cantidad: 2 }, { estructura: "arco_asimetrico", cantidad: 1 }],
});
assert.equal(propuesta.piezas[0]?.nombre, "Columna orgánica");
assert.equal(propuesta.piezas[1]?.nombre, "Arco orgánico");
assert.equal(propuesta.colores.length, 2);
assert.equal(propuesta.frase, "Te propongo dos columnas orgánicas y un arco orgánico en rosado y dorado.");
const frase = (piezas: Array<{ estructura: string; cantidad: number }>, colores: string[]) => normalizarPropuestaComposicion({ frase: "x", colores, piezas }).frase;
assert.equal(frase([{ estructura: "arco_asimetrico", cantidad: 1 }, { estructura: "columna", cantidad: 2 }], ["azul", "blanco", "dorado"]), "Te propongo un arco orgánico y dos columnas en azul, blanco y dorado.");
assert.equal(frase([{ estructura: "guirnalda", cantidad: 1 }], ["lila"]), "Te propongo una guirnalda en lila.");
assert.equal(frase([{ estructura: "figura", cantidad: 1 }, { estructura: "centro_mesa", cantidad: 6 }, { estructura: "pared_organica", cantidad: 1 }], ["negro", "dorado"]), "Te propongo una figura con globos, 6 centros de mesa con globos y una pared orgánica en negro y dorado.");
assert.equal(WidgetGuiadoSchema.safeParse({ tipo: "propuesta", propuesta }).success, true);
assert.equal(WidgetGuiadoSchema.safeParse({ tipo: "propuesta", propuesta, sku: "interno" }).success, false);
assert.equal(PropuestaComposicionSchema.safeParse({ frase: "", colores: ["rosa magenta inventado"], piezas: [{ estructura: "pieza_falsa", cantidad: 1 }] }).success, false);
assert.equal(PropuestaComposicionSchema.safeParse({ frase: "Idea", colores: ["rosado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 1 }, { estructura: "guirnalda", cantidad: 1 }, { estructura: "bouquet", cantidad: 1 }] }).success, false);
console.log("test-propuesta-composicion-guiada: solo estructuras oficiales, colores permitidos y 1-3 piezas");
