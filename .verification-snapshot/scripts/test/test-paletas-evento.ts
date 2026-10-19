/**
 * Colores sugeridos por tipo de celebración (`paletasSugeridasDe`): cada evento tiene sus paletas típicas, todas con
 * decoraciones para ese evento (nunca un color sin fotos). Sin coste: solo la biblioteca.
 */
import assert from "node:assert/strict";
import { paletasSugeridasDe, tematicasDisponibles } from "../../src/lib/biblioteca-sempertex/biblioteca";

const eventos = ["boda", "quince años", "Baby shower", "revelación de género", "bautizo", "grado", "aniversario", "evento de empresa", "cumpleaños", "cumpleaños infantil", "navidad"];
for (const evento of eventos) {
  const paletas = paletasSugeridasDe(evento);
  console.log(`${evento} => ${paletas.join(" | ")}`);
  assert.ok(paletas.length >= 1, `${evento} debe tener colores sugeridos`);
  const conDecoraciones = new Set(tematicasDisponibles(evento));
  for (const paleta of paletas) assert.ok(conDecoraciones.has(paleta), `${paleta} debe tener decoraciones para ${evento}`);
}
assert.deepEqual(paletasSugeridasDe("quince años")[0], "Rosa y dorado", "quince va antes que cumpleaños");
assert.deepEqual(paletasSugeridasDe(undefined), []);
assert.deepEqual(paletasSugeridasDe("fiesta de disfraces"), []);
console.log("OK test-paletas-evento: cada celebración tiene sus colores sugeridos, todos con decoraciones");
