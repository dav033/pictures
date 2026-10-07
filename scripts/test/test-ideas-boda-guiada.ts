import assert from "node:assert/strict";
import { ideasGuiadas, ideasRealesDeOpcion, ideasYaVistas, tematicaFielAlCliente } from "../../src/lib/ia/guiado/ideas-guiadas";
import { esPedidoParecidasAFoto, ideasParecidasAFoto, pedidoDeIdeas } from "../../src/lib/ia/guiado/pedido-ideas";

/**
 * Probador (2026-10-07, guiada-20261007-000432-mi8qhp): boda «elegante en blanco y dorado».
 *  1. `guardar_brief_guiado` guardó «Blanco, dorado y nude» (nude no lo pidió).
 *  2. La búsqueda dio 1 exacta y no completó con las parecidas reales de boda.
 *  3. Con la foto de una columna, «Prefiero ver ideas parecidas» devolvió el mismo aro (`conPieza: 0`).
 * Sin coste: la biblioteca real, sin modelo ni red.
 *
 *   npx tsx scripts/test/test-ideas-boda-guiada.ts
 */

const BODA = "me caso en diciembre, quiero algo elegante en blanco y dorado para la entrada del salón";

// ── 1. La temática guardada es la del cliente ───────────────────────────────────────────────────────────────────────
assert.deepEqual(tematicaFielAlCliente("Blanco, dorado y nude", [BODA]), { tematica: "Blanco y dorado", quitados: ["nude"] });
assert.deepEqual(tematicaFielAlCliente("Elegante blanco y dorado", [BODA]), { tematica: "Elegante blanco y dorado", quitados: [] }, "lo que dijo, igual");
assert.equal(tematicaFielAlCliente("Romántico rosa y dorado", [BODA]).tematica, "Romántico blanco y dorado", "el estilo queda, los colores son los suyos");
assert.equal(tematicaFielAlCliente("Unicornio rosa y lila", ["cumple de mi hija de 6, le encantan los unicornios"]).tematica, "Unicornio", "sin colores dichos, solo el motivo");
assert.equal(tematicaFielAlCliente("Rosa y azul", ["unicornio en rosa, lila, celeste y dorado"]).tematica, "Rosado, lila, celeste y dorado", "con el tono que dijo («celeste», no «azul»)");
assert.equal(tematicaFielAlCliente("Blanco, dorado y nude", ["Blanco, dorado y nude"]).tematica, "Blanco, dorado y nude", "si eligió esa temática en las opciones, es suya");

// ── 2. Menos de 3 exactas: se completa con parecidas reales del mismo evento y colores ───────────────────────────────
for (const tematica of ["Blanco y dorado", "Blanco, dorado y nude"]) {
  const resultado = ideasGuiadas({ evento: "Boda", edad: 0, tematica, ultimoUsuario: BODA });
  const titulos = resultado.ideas.map((idea) => idea.titulo);
  assert.ok(resultado.ideas.length >= 3, `${tematica}: al menos 3 ideas (${titulos.join(" | ")})`);
  assert.ok(titulos.includes("Semiarco blanco y oro rosa") && titulos.includes("Semiarco oro rosa, dorado y amarillo pastel"), `${tematica}: las parecidas de boda (${titulos.join(" | ")})`);
  for (const idea of resultado.ideas.slice(1)) assert.equal(idea.coincidencia, "cercana", `${idea.titulo}: marcada «Parecida»`);
  assert.equal(resultado.ideas[0]?.coincidencia, "exacta", "la exacta primero");
}
// Las opciones siguen contando solo exactas (las parecidas no hacen que una opción «exista»).
assert.equal(ideasRealesDeOpcion("Blanco, dorado y nude", { evento: "Boda" }), 1);
// Nunca de otros colores: «Elegante blanco y negro» en una boda solo suma ideas con blanco o negro.
for (const idea of ideasGuiadas({ evento: "Boda", edad: 0, tematica: "Elegante blanco y negro" }).ideas.filter((item) => item.coincidencia === "cercana")) {
  assert.match(`${idea.titulo} ${idea.tematica}`.toLowerCase(), /blanc|negr/, `${idea.titulo}: una parecida comparte colores`);
}

// ── 3. «Prefiero ver ideas parecidas» a la foto de una columna ───────────────────────────────────────────────────────
const FOTO = "Muéstrame ideas parecidas a mi foto: Veo una columna en blanco mate y dorado cromado. ¿Te armo el plan con estas piezas?";
assert.ok(esPedidoParecidasAFoto(FOTO));
assert.equal(esPedidoParecidasAFoto("Muéstrame otras ideas con columnas"), false);
const pedido = pedidoDeIdeas(FOTO);
assert.ok(pedido?.piezas.includes("columna"));
for (const tematica of ["Blanco, dorado y nude", "Blanco y dorado"]) {
  const vistas = ideasYaVistas({ evento: "Boda", edad: 0, tematica, mensajesPrevios: [BODA, "algo así me encanta"] });
  assert.ok(vistas.has("deco-real-28-aro-blanco-dorado-y-nude"), "el aro ya lo vio");
  const parecidas = ideasParecidasAFoto({ texto: FOTO, piezas: pedido!.piezas, evento: "Boda", edad: 0, excluir: vistas });
  const titulos = parecidas.ideas.map((idea) => idea.titulo);
  assert.ok(!parecidas.ideas.some((idea) => vistas.has(idea.id)), `${tematica}: ninguna repetida (${titulos.join(" | ")})`);
  assert.ok(parecidas.ideas.length >= 3, `${tematica}: hay ideas parecidas (${titulos.join(" | ")})`);
  assert.ok(parecidas.conPieza >= 2, `${tematica}: primero las columnas (${titulos.join(" | ")})`);
  assert.ok(parecidas.ideas[0]!.piezas.some((pieza) => pieza.estructura.startsWith("columna")), `${tematica}: la primera es una columna`);
  assert.equal(parecidas.ideas[0]!.titulo, "Columnas negras y doradas", "columna y dorado antes que una columna de otros colores");
  assert.ok(!titulos.includes("Columna arcoíris con cinta dorada"), "una columna infantil no es parecida para una boda");
  if (vistas.has("deco-real-01-305")) assert.ok(!titulos.includes("Arco de entrada blanco y negro"), "ni el gemelo de una idea ya vista («Arco de entrada en blanco y negro»)");
  assert.equal(titulos[1], "Dos columnas rosa, lila y dorado", "las dos columnas con dorado antes que el semiarco lila sin dorado");
  assert.ok(parecidas.ideas.every((idea) => idea.coincidencia === "cercana"), "todas «Parecida»");
}

console.log("test-ideas-boda-guiada: temática fiel al cliente (sin «nude»), ≥3 ideas de boda con parecidas marcadas, parecidas a la foto sin repetir y con su estructura primero.");
