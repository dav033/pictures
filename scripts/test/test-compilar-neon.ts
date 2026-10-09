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
import { armarEscena } from "@/lib/globos3d/escena";
import { centroDe } from "@/lib/globos3d/letras";

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

prueba("un fondo de foto fijo (sin opciones) llega a FLUX con sus colores, no solo con su nombre", () => {
  const frase = (pieza: LecturaFoto["piezas"][number]) => {
    const nodo = compilarLectura({ ...base, piezas: [pieza] }).escena.nodos[0]!;
    return fraseDeEscenografia(nodo.pieza as Parameters<typeof fraseDeEscenografia>[0]) ?? "";
  };
  const panel = frase({ tipo: "fondo", id: "panel_redondo", x: 0.5, yBase: 0.8, ancho: 0.4, alto: 0.4, colores: [{ nombre: "crema", hex: "#f3e7cf", peso: 60, acabado: "mate" }, { nombre: "dorado", hex: "#d8b25a", peso: 40, acabado: "cromado" }] });
  assert.match(panel, /^round backdrop panel in .+ and .+/, panel);
  assert.ok(!/gray|grey/i.test(panel), `el pie del panel no es un color principal: ${panel}`);
  assert.match(frase(lentejuelas), /^sequin wall panel in /);
  assert.match(frase({ tipo: "fondo", id: "mesa_mantel", x: 0.5, yBase: 0.8, ancho: 0.4, alto: 0.2, colores: [BLANCO] }), /^table with a floor-length tablecloth in /);
});

prueba("un tablero leído «transparente» se queda de acrílico transparente (no blanco mate) y la luz va con su color leído", () => {
  const leido = { ...neon, colorTexto: undefined, colores: [{ nombre: "transparente", hex: "#ffffff", peso: 20, acabado: "mate" as const }, { nombre: "amarillo neon", hex: "#ffff99", peso: 80, acabado: "brillante" as const }] };
  const { nodo, opciones } = opcionesDe({ ...base, piezas: [leido] }, "neon_cursiva");
  const catalogo = muebleDe("neon_cursiva")!;
  assert.equal(opciones.colores[0], catalogo.colores[0], "el tablero, el de catálogo");
  assert.equal(opciones.colores[1]?.toLowerCase(), "#ffff99");
  assert.equal((opciones as { acabado?: string }).acabado, undefined, "sin el mate del «transparente»");
  const frase = fraseDeEscenografia(nodo.pieza as Parameters<typeof fraseDeEscenografia>[0]);
  assert.match(frase ?? "", /clear acrylic/);
});

prueba("un nombre de acrílico con una guirnalda que le pasa por detrás va delante de los globos que se le cruzan", () => {
  const ROSA = { nombre: "rosado", hex: "#f4b6c8", peso: 100, acabado: "mate" as const };
  const rotulo = { tipo: "fondo" as const, id: "rotulo_acrilico", x: 0.5, yBase: 0.32, ancho: 0.22, alto: 0.08, texto: "Isabella", colorTexto: "dorado", acabadoTexto: "cromado", colores: [{ nombre: "dorado", hex: "#d6b45a", peso: 100, acabado: "cromado" as const }] };
  const guirnalda = { tipo: "guirnalda_organica" as const, puntos: [{ x: 0.25, y: 0.28, grosor: 0.14 }, { x: 0.5, y: 0.27, grosor: 0.14 }, { x: 0.75, y: 0.28, grosor: 0.14 }], tamanos: {}, racimos: 0.6, colores: [ROSA] };
  const { escena, notas } = compilarLectura({ ...base, piezas: [rotulo, guirnalda] });
  const armada = armarEscena(escena);
  const letrero = armada.porNodo.find((n) => n.id.startsWith("rotulo-acrilico"))!;
  const cruzan = armada.porNodo.filter((n) => n.id.startsWith("guirnalda")).flatMap((n) => n.globos).filter((g) => {
    const c = centroDe(g), r = g.infladoCm / 2;
    return c.x + r > letrero.caja.min.x && c.x - r < letrero.caja.max.x && c.y + r > letrero.caja.min.y && c.y - r < letrero.caja.max.y;
  });
  assert.ok(cruzan.length > 0, "la guirnalda le pasa por detrás");
  assert.ok(cruzan.every((g) => centroDe(g).z + g.infladoCm / 2 <= letrero.caja.min.z + 0.5), "ningún globo de los que se le cruzan queda delante");
  assert.ok(notas.some((n) => /va delante de ellos/.test(n)), notas.join(" | "));
  assert.ok(!compilarLectura({ ...base, piezas: [rotulo] }).notas.some((n) => /va delante de ellos/.test(n)), "sin globos se queda donde estaba");
});

prueba("sin panel delante, lo colgado sigue en la pared", () => {
  const { nodo } = opcionesDe({ ...base, piezas: [neon] }, "neon_cursiva");
  assert.equal(nodo.colocacion.en, "pared");
});

if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
console.log("\nTodas las pruebas pasaron.");
