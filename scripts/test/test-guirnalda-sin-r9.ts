/**
 * La guirnalda orgánica de colores sin R-9 (13 de ~80 códigos: 056, 909, 932...; P-087). Sin coste y sin red.
 *   npx tsx --conditions=react-server scripts/test/test-guirnalda-sin-r9.ts
 * - la herramienta del Taller (`crearEstructura`) nunca da menos globos que antes del relleno compensado y un color sin R-9 queda a menos de un 5 % de uno con R-9;
 * - el R-12 de 18 cm solo sustituye al R-9 cuando ningún color lo fabrica (570 en 35 cm de grosor o con `tamanos` R-12 y R-5 queda como antes);
 * - un R-18 nunca hace de relleno (a 18 cm sería un globo medio vacío).
 */
import assert from "node:assert/strict";
import { ajustarOrganico, crearEstructura } from "../../src/lib/globos3d/herramientas-escena-estructuras";
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

// Size edits preserve compensated fill, and each palette resolves it from the resulting colours.
const ajustar = (o: OpcionesOrganico, pedido: Parameters<typeof ajustarOrganico>[1]) => ajustarOrganico({ tipo: "organico", opciones: o, flores: null }, pedido, []).opciones;
const sinR9Ajustada = ajustar(guirnalda("932", 300, 45), { tamanos: ["R-12", "R-5"] });
assert.deepEqual(relleno(sinR9Ajustada), ["R-5@12", "R-12@18"], "932 editada con tamanos R-12 y R-5 conserva el R-12 de relleno");
assert.ok(globos(sinR9Ajustada) >= globos(comoAntes(sinR9Ajustada)), "y nunca da menos globos que sin él");
assert.deepEqual(relleno(ajustar(guirnalda("932", 300, 45), { colores: ["570"], tamanos: ["R-12", "R-9", "R-5"] })), ["R-9@18", "R-5@12"], "932 pasada a 570 con tamanos: el relleno de un color con R-9, no el R-12 de 18 cm");
assert.deepEqual(relleno(ajustar(guirnalda("570", 300, 45), { colores: ["932"], tamanos: ["R-12", "R-9", "R-5"] })), ["R-5@12", "R-12@18"], "570 pasada a 932 con tamanos: el R-12 sustituye al R-9 que ya no se fabrica");
assert.deepEqual(relleno(ajustar(guirnalda("932", 300, 45), { colores: ["570"] })), ["R-5@12"], "un cambio solo de color quita el R-12 compensado y conserva los tamaños de la pieza");
assert.deepEqual(relleno(ajustar(guirnalda("570", 300, 45), { colores: ["932"] })), ["R-5@12", "R-12@18"], "un cambio solo de color sustituye el R-9 por R-12 cuando ningún color lo fabrica");
// An organic column without R-9 is not a garland: its filler is unchanged.
const columna = crearEstructura("columna_organica", { colores: ["932"], alto_cm: 200 }, []).pieza;
assert.equal(columna.tipo, "organico");
assert.deepEqual(relleno(ajustarOrganico(columna as Extract<typeof columna, { tipo: "organico" }>, { tamanos: ["R-12", "R-5"] }, []).opciones), ["R-5@12"], "la columna sin R-9 no recibe el relleno de la guirnalda");
const columnaSinCambios = ajustarOrganico(columna as Extract<typeof columna, { tipo: "organico" }>, { colores: ["570"] }, []);
assert.deepEqual(relleno(columnaSinCambios.opciones), relleno((columna as Extract<typeof columna, { tipo: "organico" }>).opciones), "un cambio de color en una columna no usa el relleno especial de las guirnaldas");

console.log(`test-guirnalda-sin-r9: ok (${celdas} celdas de la herramienta, 12 casos de relleno)`);
