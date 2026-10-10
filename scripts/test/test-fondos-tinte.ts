/**
 * Fondos fijos que admiten color (`tinte` en `FONDOS_CATALOGO`): el panel redondo, la media luna, la pared de lentejuelas,
 * el tapete, la cortina y el letrero cambian su color principal con `cambiar_pieza` (colores) o al agregarlos, sin rehacer
 * el fondo. Los demás elementos (el aro, el pie) quedan. `ver_escena` dice el color. Los pedestales y los arcos (varios
 * colores) siguen sin cambiar. Sin coste: ninguna IA ni red.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-fondos-tinte.ts
 */
import assert from "node:assert/strict";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { resumenDeEscenografia } from "../../src/lib/globos3d/herramientas-escena-mobiliario";
import { elementosDeEscenografia, MuebleDePiezaSchema, piezaDeEntrada, type PiezaEscenografia } from "../../src/lib/globos3d/mobiliario-pieza";
import { armarPieza } from "../../src/lib/globos3d/piezas";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "../../src/lib/globos3d/lectura-foto";

const prueba = (nombre: string, fn: () => void) => { fn(); console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });
const entrada = (id: string) => FONDOS_CATALOGO.find((f) => f.id === id) ?? assert.fail(`falta ${id}`);

function con(id: string): { escena: Escena; pieza: PiezaEscenografia } {
  const r = aplicarHerramienta(vacia(), "agregar_mobiliario", { id });
  if (!r.ok) assert.fail(r.error);
  const pieza = r.escena.nodos[0]!.pieza;
  assert.ok(pieza.tipo === "escenografia");
  return { escena: r.escena, pieza };
}
const cambiar = (escena: Escena, args: Record<string, unknown>) => aplicarHerramienta(escena, "cambiar_pieza", args);
const hexes = (p: PiezaEscenografia) => elementosDeEscenografia(p).map((e) => e.hex);

prueba("la media luna se pone en el color pedido y se recolorea con cambiar_pieza, sin tocar el resto", () => {
  const { escena, pieza } = con("media_luna");
  const de = entrada("media_luna");
  assert.ok(de.clase === "fondo" && de.tinte === "#1c2f5e");
  assert.ok(hexes(pieza).includes("#1c2f5e"));
  const r = cambiar(escena, { id: escena.nodos[0]!.id, colores: ["#7a2e8c"] });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  const nueva = r.escena.nodos[0]!.pieza as PiezaEscenografia;
  assert.deepEqual(hexes(nueva), ["#7a2e8c"]);
  assert.equal(nueva.mueble?.tinte, "#7a2e8c");
  assert.ok(MuebleDePiezaSchema.safeParse(nueva.mueble).success, "el mueble con su tinte es un mueble válido");
  const { min, max } = armarPieza(nueva).caja;
  assert.ok(max.y - min.y > 150, "sigue siendo la media luna de 1,8 m");
});

prueba("el panel redondo recolorea su cara y deja el aro dorado; dos cambios seguidos parten del último", () => {
  const { escena, pieza } = con("panel_redondo");
  const antes = hexes(pieza);
  assert.ok(antes.includes("#d8b25a") && antes.includes("#f3e7cf"), "lleva aro y cara");
  const uno = cambiar(escena, { id: escena.nodos[0]!.id, colores: ["#2a9d8f"] });
  assert.ok(uno.ok, uno.ok ? "" : uno.error);
  if (!uno.ok) return;
  const h1 = hexes(uno.escena.nodos[0]!.pieza as PiezaEscenografia);
  assert.ok(h1.includes("#2a9d8f") && h1.includes("#d8b25a") && !h1.includes("#f3e7cf"), `aro intacto: ${h1.join(",")}`);
  assert.ok(!h1.includes("#cfc6b8"), "el pie de metal sigue a la cara");
  const dos = cambiar(uno.escena, { id: uno.escena.nodos[0]!.id, colores: ["#ffffff"] });
  assert.ok(dos.ok, dos.ok ? "" : dos.error);
  if (!dos.ok) return;
  const h2 = hexes(dos.escena.nodos[0]!.pieza as PiezaEscenografia);
  assert.ok(h2.includes("#ffffff") && !h2.includes("#2a9d8f") && h2.includes("#d8b25a"));
});

prueba("agregar_mobiliario con colores pone el fondo ya recoloreado", () => {
  const r = aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "tapete_redondo", colores: ["#222222"] });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.ok(hexes(r.escena.nodos[0]!.pieza as PiezaEscenografia).includes("#222222"));
});

prueba("ver_escena dice el color del fondo que lo admite, y el de partida si no lo cambiaron", () => {
  const { pieza } = con("cortina_luces");
  assert.match(resumenDeEscenografia(pieza)?.colores ?? "", /#f6f4ef/);
  const cambiada = { ...pieza, mueble: { id: "cortina_luces", tinte: "#101820" } } as PiezaEscenografia;
  assert.match(resumenDeEscenografia(cambiada)?.colores ?? "", /#101820/);
});

prueba("los fondos sin color (pedestales, arcos) siguen sin cambiar y lo dicen", () => {
  const { escena } = con("pedestales");
  const r = cambiar(escena, { id: escena.nodos[0]!.id, colores: ["#ff0000"] });
  assert.ok(!r.ok, "un fondo sin tinte no cambia de color");
  assert.equal((entrada("pedestales") as { tinte?: string }).tinte, undefined);
});

prueba("el aro del panel redondo sigue siendo un elemento aparte (piezaDeEntrada lo deja con su color de partida)", () => {
  const p = piezaDeEntrada(entrada("panel_redondo"));
  assert.ok(p.tipo === "escenografia" && p.mueble?.tinte === undefined && hexes(p).includes("#d8b25a"));
});

const COLOR_FOTO = (hex: string, nombre = "color") => ({ nombre, hex, peso: 100, acabado: "mate" as const });
const leer = (piezas: unknown[]) => compilarLectura(LecturaFotoSchema.parse({ resumen: "fondos leídos", aspecto: 1.5, escala: { altoImagenCm: 250, referencia: "x" }, pisoY: 0.9, sala: { pared: "#ffffff", piso: "#cccccc" }, piezas }));
const fondoLeido = (id: string, colores: ReturnType<typeof COLOR_FOTO>[]) => ({ tipo: "fondo", id, x: 0.5, yBase: 0.6, ancho: 0.3, alto: 0.3, colores });
const nodoDe = (escena: Escena, id: string) => escena.nodos.find((n) => n.pieza.tipo === "escenografia" && n.pieza.mueble?.id === id) ?? assert.fail(`falta ${id}`);

// Un panel y una media luna leídos de una foto (con el color de la foto, no el de catálogo) se recolorean.
const panelLeido = nodoDe(leer([fondoLeido("panel_redondo", [COLOR_FOTO("#112233"), COLOR_FOTO("#998877", "aro")])]).escena, "panel_redondo");
const pl = panelLeido.pieza as PiezaEscenografia;
assert.equal(pl.mueble?.tinte, "#112233", "la foto deja su color principal");
const escenaPanel: Escena = { ...vacia(), nodos: [{ ...panelLeido, id: "panel-leido" }] };
const cambioPanel = cambiar(escenaPanel, { id: "panel-leido", colores: ["#2a9d8f"] });
assert.ok(cambioPanel.ok, cambioPanel.ok ? "" : cambioPanel.error);
if (cambioPanel.ok) {
  const h = hexes(cambioPanel.escena.nodos[0]!.pieza as PiezaEscenografia);
  assert.ok(h.includes("#2a9d8f") && !h.includes("#112233") && h.includes("#998877"), `panel de la foto recoloreado, aro intacto: ${h.join(",")}`);
}
console.log("  ✓ un panel leído de la foto cambia su color principal (el aro queda)");

const lunaLeida = nodoDe(leer([fondoLeido("media_luna", [COLOR_FOTO("#334455")])]).escena, "media_luna");
const escenaLuna: Escena = { ...vacia(), nodos: [{ ...lunaLeida, id: "luna-leida" }] };
const cambioLuna = cambiar(escenaLuna, { id: "luna-leida", colores: ["#ffffff"] });
assert.ok(cambioLuna.ok && hexes(cambioLuna.escena.nodos[0]!.pieza as PiezaEscenografia).join() === "#ffffff", cambioLuna.ok ? "la media luna leída cambia" : cambioLuna.error);
console.log("  ✓ una media luna leída de la foto cambia su color");

// Sin ninguna parte de ese color, dice que no pudo (no finge).
const sinColor: Escena = { ...vacia(), nodos: [{ id: "x", nombre: "Media luna", pieza: { ...(piezaDeEntrada(FONDOS_CATALOGO.find((f) => f.id === "media_luna")!) as PiezaEscenografia), mueble: { id: "media_luna", tinte: "#999999" } }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
const nopudo = cambiar(sinColor, { id: "x", colores: ["#ffffff"] });
assert.ok(!nopudo.ok && /No pude/.test(nopudo.error), nopudo.ok ? "debía fallar" : nopudo.error);
console.log("  ✓ sin parte de ese color, dice «No pude» y no cambia nada");

// El color y el texto de un mismo cambio: el tinte sobrevive al rótulo.
const ambos = cambiar(escenaPanel, { id: "panel-leido", colores: ["#2a9d8f"], texto: "Hola" });
assert.ok(ambos.ok, ambos.ok ? "" : ambos.error);
if (ambos.ok) {
  const q = ambos.escena.nodos[0]!.pieza as PiezaEscenografia;
  assert.equal(q.mueble?.tinte, "#2a9d8f", "el color se queda al poner el texto");
  assert.equal(q.mueble?.rotulo?.texto, "Hola", "el texto se pone");
}
const soloTexto = cambiar(cambioPanel.ok ? cambioPanel.escena : escenaPanel, { id: "panel-leido", texto: "Adiós" });
assert.ok(soloTexto.ok && (soloTexto.escena.nodos[0]!.pieza as PiezaEscenografia).mueble?.tinte === "#2a9d8f", "el texto no borra el color");
console.log("  ✓ color y texto en una llamada, y el texto no borra el color");

console.log("test-fondos-tinte: ok");
