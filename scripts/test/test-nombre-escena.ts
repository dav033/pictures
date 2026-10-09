/**
 * El nombre de la escena sigue a la escena que arma la IA (2026-10-09): el pie de la foto realista decía el nombre de la plantilla
 * de partida aunque la escena ya fuera otra. Sin coste: ni red ni IA.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-nombre-escena.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { ESCENAS_PREDEFINIDAS, escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { esNombreAutomatico, esNombreDePartida, nombreParaFoto, nombreQueSigue, nombreSegunEscena } from "../../src/lib/globos3d/nombre-escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const paso = (e: Escena, herramienta: string, args: Record<string, unknown>): Escena => { const r = aplicarHerramienta(e, herramienta, args); if (!r.ok) assert.fail(r.error); return r.escena; };

const PARTIDA = ESCENAS_PREDEFINIDAS[0]!;
function boda(): Escena {
  let e: Escena = { sala: { ...SALA_INICIAL, anchoCm: 1200, fondoCm: 900 }, nodos: [] };
  for (const x of [-300, 0, 300]) {
    e = paso(e, "agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: x, z_cm: 0 });
    const id = e.nodos.at(-1)!.id;
    e = paso(e, "agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor", alrededor_de: id });
    e = paso(e, "poner_sobre", { decoracion_id: "margarita", padre_id: id });
  }
  return e;
}

prueba("los nombres de plantilla y los genéricos son «de partida»; uno escrito por la persona no", () => {
  assert.ok(esNombreDePartida(PARTIDA.nombre) && esNombreDePartida("Mi escena") && esNombreDePartida("Escena nueva"));
  assert.ok(!esNombreDePartida("Boda de Ana y Luis"));
});
prueba("la escena se describe por lo que tiene", () => {
  assert.equal(nombreSegunEscena(boda()), "3 mesas con 12 sillas y 3 centros");
  assert.equal(nombreSegunEscena({ sala: SALA_INICIAL, nodos: [] }), "Escena nueva");
  assert.match(nombreSegunEscena(escenaPredefinida(PARTIDA.id)), /arco orgánico/i);
});
prueba("tras la IA, un nombre de plantilla pasa a describir la escena; el de la persona se queda", () => {
  assert.equal(nombreQueSigue(PARTIDA.nombre, boda()), "3 mesas con 12 sillas y 3 centros");
  assert.equal(nombreQueSigue("Escena nueva", boda()), "3 mesas con 12 sillas y 3 centros");
  assert.equal(nombreQueSigue("Boda de Ana y Luis", boda()), "Boda de Ana y Luis");
});
prueba("un nombre armado por el taller sigue a la escena en los turnos siguientes y al deshacer; el de la persona no", () => {
  const primero = nombreQueSigue(PARTIDA.nombre, boda());
  assert.ok(esNombreAutomatico(primero) && !esNombreAutomatico("Boda de Ana y Luis") && !esNombreAutomatico("Mesa 3 del fondo") && !esNombreAutomatico(""));
  const mas = paso(boda(), "agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: 100, z_cm: 400 });
  assert.equal(nombreQueSigue(primero, mas), "4 mesas con 12 sillas y 3 centros", "segundo turno");
  assert.match(nombreQueSigue(primero, escenaPredefinida(PARTIDA.id)), /arco orgánico/i, "deshacer a la plantilla");
  assert.equal(nombreParaFoto(primero, mas), "4 mesas con 12 sillas y 3 centros");
});
prueba("el pie de la foto no usa el nombre de la plantilla si la escena ya no es esa", () => {
  assert.equal(nombreParaFoto(PARTIDA.nombre, escenaPredefinida(PARTIDA.id)), PARTIDA.nombre, "la plantilla intacta conserva su nombre");
  assert.equal(nombreParaFoto(PARTIDA.nombre, boda()), "3 mesas con 12 sillas y 3 centros");
  assert.equal(nombreParaFoto("Boda de Ana y Luis", boda()), "Boda de Ana y Luis");
});
prueba("Taller3D conecta el nombre con la IA y con el pie de la foto", () => {
  const taller = readFileSync("src/components/tres-d/Taller3D.tsx", "utf8");
  assert.match(taller, /alAplicar: alAplicarIA/);
  assert.match(taller, /setNombreEscena\(\(actual\) => nombreQueSigue\(actual, nueva\)\)/);
  assert.match(taller, /escena=\{nombreFoto\}/);
  assert.match(readFileSync("src/components/tres-d/ia/useIATaller.ts", "utf8"), /alAplicar\?\.\(nueva\)/);
});

console.log(`\n${pruebas} pruebas ok`);
