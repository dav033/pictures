/**
 * El texto de la foto con IA cuando la escena trae mesas y sillas (2026-10-09, conversación 3d-20261009-103125-92b58a): FLUX borró las
 * mesas de una boda porque el texto decía «no other furniture, tables», «all plain and empty» y las mesas iban en una cláusula lateral.
 * Sin coste: ni red ni IA.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-render-mobiliario.ts
 * - con mobiliario: mesas y sillas son lo principal (cuenta, numeración, sillas por mesa), el centro va «encima de la mesa», y se quitan
 *   «no furniture / tables», «plain and empty»;
 * - sin mobiliario: las reglas de siempre (sala vacía, sin muebles) siguen igual.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import {
  AMBIENTES_RENDER, NADA_MAS, STRENGTH_FIEL_MOBILIARIO, TAMANO_BASE_FIEL, usaCaminoFiel, NADA_MAS_CON_MOBILIARIO, PREFIJO_MOBILIARIO, descripcionRender3d, promptRender3d, promptRender3dFiel, traeMobiliario,
} from "../../src/lib/globos3d/render-ia";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const paso = (e: Escena, herramienta: string, args: Record<string, unknown>): Escena => {
  const r = aplicarHerramienta(e, herramienta, args);
  if (!r.ok) assert.fail(`${herramienta}: ${r.error}`);
  return r.escena;
};

/** Una boda como la del dueño: sala de 12 × 9 m, 6 mesas redondas (3 × 2) con 4 sillas y un centro de globos cada una. */
function boda(): Escena {
  let e: Escena = { sala: { ...SALA_INICIAL, anchoCm: 1200, fondoCm: 900 }, nodos: [] };
  const puestos = [[-350, -100], [0, -100], [350, -100], [-350, 150], [0, 150], [350, 150]] as const;
  puestos.forEach(([x, z]) => {
    e = paso(e, "agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: x, z_cm: z });
    const mesaId = e.nodos.at(-1)!.id;
    e = paso(e, "agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor", alrededor_de: mesaId });
    e = paso(e, "poner_sobre", { decoracion_id: "flor_grande", padre_id: mesaId, nombre: "Centro" });
  });
  return e;
}

const textoDe = (e: Escena) => descripcionRender3d(escenaEnIngles(e, armarEscena(e)), []);

console.log("Con mobiliario");
prueba("las mesas y sillas son lo principal, con su cuenta y su disposición; el centro va «encima de la mesa»", () => {
  const d = textoDe(boda());
  assert.ok(traeMobiliario(d));
  assert.match(d, new RegExp(`${PREFIJO_MOBILIARIO.replace(/[()]/g, "\\$&")} 6 × round banquet table with a floor-length tablecloth`));
  assert.match(d, /24 × Tiffany \(chiavari\) chair/);
  assert.match(d, /The 6 tables are numbered 1 to 6 from left to right/);
  assert.match(d, /Each table has 4 chairs evenly spaced around it, and a balloon centrepiece standing ON TOP of the table/);
  assert.doesNotMatch(d, /standing on the floor/, "el centro no está en el piso");
  assert.doesNotMatch(d, /Attached to/, "el centro no es una pieza «pegada a la estructura»");
});
prueba("no queda ninguna frase que niegue las mesas o vacíe la sala", () => {
  const d = textoDe(boda());
  assert.doesNotMatch(d, /no furniture|no other furniture|no tables|plain and empty|all empty/i, d);
  assert.ok(d.endsWith(NADA_MAS_CON_MOBILIARIO), d.slice(-160));
  for (const a of AMBIENTES_RENDER) {
    const p = promptRender3d(d, a.id);
    assert.doesNotMatch(p, /no furniture|no other furniture|no tables|plain and empty/i, `${a.id}: ${p}`);
    assert.match(p, /Keep every table, chair and centrepiece exactly as shown/);
    assert.match(p, /no extra tables or chairs/);
  }
  assert.match(promptRender3d(d, "igual_visor"), /plain walls with the furniture and decorations described below standing in it/);
  assert.doesNotMatch(promptRender3dFiel(d, "igual_visor"), /plain empty room/);
});
prueba("el mobiliario sobrevive al tope de la descripción (va antes de la lista de piezas)", () => {
  const e = paso(boda(), "agregar_pieza", { tipo: "columna", colores: ["rosa", "dorado"], donde: { en: "piso", x_cm: -500, z_cm: -300 } });
  const d = textoDe(e);
  assert.ok(d.length <= 1800);
  assert.match(d, /numbered 1 to 6/);
});
prueba("una mesa sola con sillas del conjunto cuenta sus 8 sillas", () => {
  let e: Escena = { sala: { ...SALA_INICIAL }, nodos: [] };
  e = paso(e, "agregar_mobiliario", { id: "mesa_redonda_sillas" });
  const d = textoDe(e);
  assert.match(d, /The table has 8 chairs evenly spaced around it/);
  assert.doesNotMatch(d, /ON TOP/);
});

console.log("Sin mobiliario");
prueba("una escena de globos conserva sus reglas: sala vacía, sin muebles ni mesas", () => {
  const e = escenaPredefinida("arco_organico_columnas_guirnalda");
  const d = textoDe(e);
  assert.ok(!traeMobiliario(d));
  assert.match(d, /all plain and empty/);
  assert.ok(d.endsWith(NADA_MAS));
  const p = promptRender3d(d, "igual_visor");
  assert.match(p, /all plain and empty/);
  assert.match(p, /no furniture, tables, desserts/);
  assert.doesNotMatch(p, /Keep every table/);
});
prueba("la marca del mobiliario se lee en el texto, no en un nombre cualquiera", () => {
  assert.equal(traeMobiliario("A balloon arch. Nothing else is in the room: no furniture, tables"), false);
  assert.equal(traeMobiliario(`x. ${PREFIJO_MOBILIARIO} 2 × chair`), true);
});

console.log("Camino fiel");
prueba("con mobiliario y el lugar del visor la foto va por FLUX.1 imagen-a-imagen; sin mobiliario o con otro lugar, como siempre", () => {
  const d = textoDe(boda());
  assert.equal(usaCaminoFiel(d, "igual_visor"), true);
  for (const a of AMBIENTES_RENDER.filter((x) => x.id !== "igual_visor")) assert.equal(usaCaminoFiel(d, a.id), false, a.id);
  assert.equal(usaCaminoFiel(textoDe(escenaPredefinida("arco_organico_columnas_guirnalda")), "igual_visor"), false);
});
prueba("una mesa de postres sola (sin sillas) sigue por FLUX.2: el camino fiel es para salones con mesas y sillas", () => {
  const e = paso({ sala: { ...SALA_INICIAL }, nodos: [] }, "agregar_mobiliario", { id: "mesa_postres_mantel" });
  const d = textoDe(e);
  assert.ok(traeMobiliario(d));
  assert.equal(usaCaminoFiel(d, "igual_visor"), false);
});
prueba("la base de FLUX.1 cabe en 1 MP (se cobra 1 MP) con múltiplos de 8, y la ruta usa el camino fiel", () => {
  for (const [aspecto, { ancho, alto }] of Object.entries(TAMANO_BASE_FIEL)) {
    assert.ok(ancho * alto <= 1_000_000 && ancho % 8 === 0 && alto % 8 === 0, aspecto);
  }
  assert.ok(STRENGTH_FIEL_MOBILIARIO > 0.4 && STRENGTH_FIEL_MOBILIARIO < 0.7, "dentro de lo medido: más arriba cambia el arco y borra el panel");
  const ruta = readFileSync("src/app/api/render-3d-imagen/route.ts", "utf8");
  assert.match(ruta, /usaCaminoFiel\(descripcion/);
  assert.match(ruta, /generarConFluxFiel\(prompt, \{/);
  for (const aspecto of ["3:2", "1:1", "2:3", "16:9"]) assert.ok(aspecto in TAMANO_BASE_FIEL && ruta.includes(`"${aspecto}"`), aspecto);
});

console.log(`\n${pruebas} pruebas ok`);
