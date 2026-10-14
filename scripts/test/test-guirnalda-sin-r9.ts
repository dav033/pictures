/**
 * La guirnalda orgánica de colores sin R-9 (13 de ~80 códigos: 056, 909, 932...; P-087). Sin coste y sin red.
 *   npx tsx --conditions=react-server scripts/test/test-guirnalda-sin-r9.ts
 * - la herramienta del Taller (`crearEstructura`) nunca da menos globos que antes del relleno compensado y un color sin R-9 queda a menos de un 5 % de uno con R-9;
 * - el R-12 de 18 cm solo sustituye al R-9 cuando ningún color lo fabrica (570 en 35 cm de grosor o con `tamanos` R-12 y R-5 queda como antes);
 * - un R-18 nunca hace de relleno (a 18 cm sería un globo medio vacío).
 */
import assert from "node:assert/strict";
import { crearEstructura } from "../../src/lib/globos3d/herramientas-escena-estructuras";
import { armarOrganico, type OpcionesOrganico } from "../../src/lib/globos3d/organico";

const guirnalda = (codigo: string, largoCm: number, grosorCm: number, tamanos?: string[]): OpcionesOrganico => {
  const { pieza } = crearEstructura("guirnalda_organica", { colores: [codigo], ancho_cm: largoCm, grosor_cm: grosorCm, ...(tamanos ? { tamanos } : {}) }, []);
  assert.equal(pieza.tipo, "organico");
  return (pieza as Extract<typeof pieza, { tipo: "organico" }>).opciones;
};
const globos = (o: OpcionesOrganico) => armarOrganico(o).conteo.total;
const relleno = (o: OpcionesOrganico) => o.relleno.map((r) => `${r.formatoId}@${r.infladoCm}`);
/** Lo que armaba antes del relleno compensado: el relleno sin el R-12 de 18 cm. */
const comoAntes = (o: OpcionesOrganico): OpcionesOrganico => ({ ...o, relleno: o.relleno.filter((r) => r.formatoId === "R-5") });

// La malla: de 30 a 55 cm de grosor (a 60 cm el 570 salta de 133 a 174 globos con 55 → 60 cm y ningún color sin R-9 lo alcanza ni antes: queda dicho en P-087).
let celdas = 0;
for (const grosor of [30, 35, 40, 45, 50, 55]) {
  for (const largo of [150, 300, 500]) {
    const conR9 = globos(guirnalda("570", largo, grosor));
    for (const codigo of ["932", "056"]) {
      const o = guirnalda(codigo, largo, grosor);
      const ahora = globos(o);
      const antes = globos(comoAntes(o));
      assert.ok(ahora >= antes, `${codigo} de ${largo} cm y ${grosor} de grosor: ${ahora} globos, antes ${antes}`);
      assert.ok(ahora >= 0.95 * conR9, `${codigo} de ${largo} cm y ${grosor} de grosor: ${ahora} globos contra ${conR9} de un color con R-9`);
      celdas += 1;
    }
  }
}
assert.equal(celdas, 36);

// El R-12 sustituye al R-9 solo si ningún color lo fabrica.
assert.deepEqual(relleno(guirnalda("932", 300, 45)), ["R-5@12", "R-12@18"], "sin R-9 en ningún color, el R-12 tapa el hueco de 18 cm después de los tríos");
assert.deepEqual(relleno(guirnalda("570", 300, 45)), ["R-9@18", "R-5@12"], "con R-9, el relleno es el de siempre");
assert.deepEqual(relleno(guirnalda("570", 300, 35)), ["R-9@18", "R-5@12"], "570 en 35 cm de grosor (sin R-18 por el grosor) queda como antes");
const pedidos = guirnalda("570", 300, 45, ["R-12", "R-5"]);
assert.deepEqual(relleno(pedidos), ["R-5@12"], "570 con tamanos R-12 y R-5: el R-9 se quitó por pedido, no porque no se fabrique");
assert.equal(globos(pedidos), globos(comoAntes(pedidos)));

// Ningún R-18 hace de relleno.
const grandes = guirnalda("932", 300, 45, ["R-18", "R-24", "R-5"]);
assert.deepEqual(relleno(grandes), ["R-5@12"], "con R-18 y R-24 no hay sustituto válido: queda el relleno de siempre");
assert.equal(globos(grandes), globos(comoAntes(grandes)));

console.log(`test-guirnalda-sin-r9: ok (${celdas} celdas de la herramienta, 5 casos de relleno)`);
