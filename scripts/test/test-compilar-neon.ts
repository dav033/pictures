/**
 * El color del texto leído de una foto llega al mueble aunque la foto traiga menos colores que el mueble: el neón leído con
 * un solo color y `colorTexto` («blanco cálido») encendía rosado de catálogo y pintaba el tablero con la luz (el corte de los
 * colores por los leídos perdía la tinta). Y lo colgado de la pared que un panel de fondo taparía va delante del panel.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-compilar-neon.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import type { LecturaFoto } from "@/lib/globos3d/lectura-foto";
import { muebleDe } from "@/lib/globos3d/mobiliario-catalogo";
import { fraseDeEscenografia } from "@/lib/globos3d/escenografia-ingles";

let fallos = 0;
function prueba(nombre: string, f: () => void) {
  try { f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

const BLANCO = { nombre: "blanco cálido", hex: "#fff3c4", peso: 100, acabado: "brillante" as const };
const base: Omit<LecturaFoto, "piezas"> = { resumen: "prueba", aspecto: 1, escala: { altoImagenCm: 400, referencia: "prueba" }, pisoY: 0.8, sala: { pared: "#e8e0d0", piso: "#c9b79c" } };
const neon = { tipo: "fondo" as const, id: "neon_cursiva", x: 0.52, yBase: 0.66, ancho: 0.26, alto: 0.17, texto: "Happy Birthday", colorTexto: "blanco cálido", colores: [BLANCO] };
const lentejuelas = { tipo: "fondo" as const, id: "lentejuelas", x: 0.51, yBase: 0.8, ancho: 0.42, alto: 0.6, colores: [{ nombre: "dorado", hex: "#d4a93a", peso: 100, acabado: "brillante" as const }] };
const opcionesDe = (l: LecturaFoto, id: string) => {
  const n = compilarLectura(l).escena.nodos.find((x) => x.pieza.tipo === "escenografia" && (x.pieza as { mueble?: { id: string } }).mueble?.id === id);
  assert.ok(n, `sin nodo ${id}`);
  return { nodo: n, opciones: (n.pieza as { mueble: { opciones: { colores: readonly string[] } } }).mueble.opciones };
};

prueba("un neón leído con un solo color y colorTexto enciende con ese color y deja el tablero de catálogo", () => {
  const { opciones } = opcionesDe({ ...base, piezas: [neon] }, "neon_cursiva");
  const catalogo = muebleDe("neon_cursiva")!;
  assert.equal(opciones.colores[1]?.toLowerCase(), "#f7f6f2", "la luz es el blanco leído, no el rosado de catálogo");
  assert.equal(opciones.colores[0], catalogo.colores[0], "el tablero no toma el color de la luz");
});

prueba("con tablero y luz leídos, cada uno va a su sitio y colorTexto manda en la luz", () => {
  const { opciones } = opcionesDe({ ...base, piezas: [{ ...neon, colores: [{ ...BLANCO, nombre: "negro", hex: "#111111" }, BLANCO] }] }, "neon_cursiva");
  assert.equal(opciones.colores[0], "#111111");
  assert.equal(opciones.colores[1]?.toLowerCase(), "#f7f6f2");
});

prueba("el neón sobre la pared de lentejuelas va delante del panel (antes quedaba detrás, invisible)", () => {
  const { nodo } = opcionesDe({ ...base, piezas: [lentejuelas, neon] }, "neon_cursiva");
  assert.equal(nodo.colocacion.en, "libre");
  const panel = compilarLectura({ ...base, piezas: [lentejuelas, neon] }).escena.nodos.find((x) => x.id.startsWith("lentejuelas"))!;
  assert.equal(panel.colocacion.en, "piso");
  assert.ok(nodo.colocacion.en === "libre" && panel.colocacion.en === "piso" && nodo.colocacion.zCm > panel.colocacion.zCm, "más cerca del salón que el panel");
});

prueba("el tablero de acrílico del neón llega a FLUX como «clear acrylic» (no como el casi blanco de su color)", () => {
  const { nodo } = opcionesDe({ ...base, piezas: [neon] }, "neon_cursiva");
  assert.ok(nodo.pieza.tipo === "escenografia");
  const frase = fraseDeEscenografia(nodo.pieza as Parameters<typeof fraseDeEscenografia>[0]);
  assert.match(frase ?? "", /cursive neon sign in clear acrylic and /);
});

prueba("sin panel delante, lo colgado sigue en la pared", () => {
  const { nodo } = opcionesDe({ ...base, piezas: [neon] }, "neon_cursiva");
  assert.equal(nodo.colocacion.en, "pared");
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
