/**
 * Los componentes de la calificación de la IA (REQ-010) dibujados a HTML estático, sin red ni DOM:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-feedback-ia-componentes.ts
 * - la escala 1 a 10: grupo de opciones con nombre, una sola parada de Tab, aria-checked, etiquetas «n de 10», diez columnas fijas;
 * - la línea de estado (ocupa siempre una línea): invitación, guardando, «Gracias», deshecho, error con «Reintentar»;
 * - el «por qué»: motivos del contrato como casillas, comentario con tope, y abierto en el estado «deshecho»;
 * - cada superficie: el Taller (bajo la tarjeta, no en turnos que fallaron), el chat guiado y el clásico (solo respuestas de la IA).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalificacionIA, VistaCalificacion, textoEstado } from "../../src/components/feedback-ia/CalificacionIA";
import type { EstadoCalificacion } from "../../src/components/feedback-ia/controlador-calificacion";
import { MOTIVOS } from "../../src/lib/feedback-ia/motivos";
import { CalificacionGuiada, esTurnoGuiadoCalificable, estadoGuiadoDelMensaje, type MensajeGuiadoCalificable } from "../../src/components/guiado/CalificacionGuiada";
import { CalificacionClasica } from "../../src/components/ui/shell/CalificacionClasica";
import { CalificacionTurno, turnoCalificable, turnoDeshecho } from "../../src/components/tres-d/ia/CalificacionTurno";
import { PanelIA } from "../../src/components/tres-d/ia/PanelIA";
import type { AsistenteIA } from "../../src/components/tres-d/ia/useAsistenteIA";
import { estadoDeTurno } from "../../src/lib/globos3d/deshacer-turno";
import { diffEscenas } from "../../src/lib/globos3d/diff-escenas";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena } from "../../src/lib/globos3d/escena";
import type { TurnoPanel } from "../../src/lib/globos3d/turnos-ia";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const sin = () => undefined;
const gestos = { calificar: sin, alternarPorQue: sin, alternarMotivo: sin, escribirComentario: sin, enviarPorQue: sin, reintentar: sin };
const inicial: EstadoCalificacion = { nota: null, motivos: [], comentario: "", porQueAbierto: false, deshecho: false, fase: "libre", gracias: false };
const vista = (estado: Partial<EstadoCalificacion> = {}, tema: "taller" | "cliente" = "taller") =>
  html(createElement(VistaCalificacion, { tema, estado: { ...inicial, ...estado }, gestos }));
const botonesNota = (h: string) => [...h.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);

const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const alta: Escena = { ...base, nodos: base.nodos.map((n) => (n.id === "columna-izq" && n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 220, colores: ["570"] } } : n)) };
const turno = (numero: number, cambios: Partial<TurnoPanel> = {}): TurnoPanel => ({
  id: `t${numero}`, numero, pedido: `Hazla de 2,2 m ${numero}`, contexto: "escena entera", ambito: "escena", clave: "e1", foto: false, respuesta: "Subí la columna a 2,2 m.",
  pasos: [{ herramienta: "cambiar_pieza", resumen: "alto 220 cm", consulta: false }],
  diff: diffEscenas(base, alta), pregunta: null, costeUsd: 0.0031, ms: 12_000, estado: "aplicado", nota: null, ...cambios,
});
const iaFalsa = (turnos: TurnoPanel[]): AsistenteIA => ({
  turnos, enCurso: null, refinando: null, ocupado: false, enviar: async () => true, detener: sin, deshacer: sin, rehacer: sin, verAntes: sin, antesId: null, escenaAntes: null,
  borrar: sin, preguntaPendiente: null, estados: Object.fromEntries(turnos.filter((t) => t.diff).map((t) => [t.id, estadoDeTurno(alta, t.diff!)])), avisos: {},
  datosFeedback: () => undefined, marcas: [], apuntar: sin, tiempo: "unos 12 s", costeTotalUsd: 0.0031,
});

console.log("La escala");
prueba("diez opciones con nombre, una sola parada de Tab y ninguna elegida al principio", () => {
  const h = vista();
  assert.match(h, /role="radiogroup"[^>]*aria-labelledby="[^"]+"/);
  const botones = botonesNota(h);
  assert.equal(botones.length, 10);
  botones.forEach((b, i) => assert.ok(b.includes(`aria-label="${i + 1} de 10"`), b));
  assert.equal(botones.filter((b) => b.includes('tabindex="0"')).length, 1);
  assert.ok(botones[0]!.includes('tabindex="0"'), "sin nota, la parada es el 1");
  assert.equal(botones.filter((b) => b.includes('aria-checked="true"')).length, 0);
  assert.ok(h.includes("grid-cols-10"), "diez columnas fijas: no se mueve nada al elegir");
});
prueba("con nota: esa es la elegida y la parada de Tab; se puede cambiar", () => {
  const botones = botonesNota(vista({ nota: 7 }));
  assert.ok(botones[6]!.includes('aria-checked="true"') && botones[6]!.includes('tabindex="0"'));
  assert.equal(botones.filter((b) => b.includes('tabindex="0"')).length, 1);
  assert.equal(botones.filter((b) => b.includes("disabled")).length, 0, "nunca se desactiva: la nota siempre se puede editar");
});
prueba("casillas de al menos 36 px en el teléfono", () => {
  assert.ok(botonesNota(vista()).every((b) => b.includes("h-9")));
});

console.log("La línea de estado");
prueba("invita, guarda, agradece (sin quitar la edición), dice lo del deshacer y el error con «Reintentar»", () => {
  assert.equal(textoEstado(inicial).texto, "1 = muy mal · 10 = excelente");
  assert.equal(textoEstado({ ...inicial, nota: 5, fase: "enviando" }).texto, "Guardando…");
  assert.equal(textoEstado({ ...inicial, nota: 5, fase: "enviado", gracias: true }).texto, "Gracias. Puedes cambiar tu nota.");
  assert.match(textoEstado({ ...inicial, deshecho: true, fase: "enviado" }).texto, /qué falló/);
  assert.deepEqual(textoEstado({ ...inicial, fase: "error" }), { texto: "No se pudo guardar.", error: true });
  assert.ok(vista({ fase: "error" }).includes("Reintentar"));
  assert.ok(!vista({ fase: "enviado", gracias: true, nota: 5 }).includes("Reintentar"));
  assert.match(vista(), /role="status"[^>]*aria-live="polite"[^>]*min-h-5|min-h-5[^>]*aria-live="polite"/, "una línea reservada y anunciada");
});

console.log("El «por qué»");
prueba("cerrado por defecto: solo «Contar por qué», que dice si está expandido", () => {
  const h = vista();
  assert.ok(!h.includes("<form"));
  assert.match(h, /aria-expanded="false"/);
  assert.ok(h.includes("Contar por qué"));
});
prueba("abierto: todos los motivos del contrato como casillas, el comentario con tope y «Enviar»", () => {
  const h = vista({ porQueAbierto: true, motivos: ["colores", "lento"], comentario: "falta la guirnalda" });
  assert.match(h, /aria-expanded="true"/);
  const casillas = [...h.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.equal(casillas.length, MOTIVOS.length);
  assert.equal(casillas.filter((c) => c.includes("checked")).length, 2);
  for (const m of MOTIVOS) assert.ok(h.includes(m.etiqueta), m.etiqueta);
  assert.match(h, /<textarea[^>]*maxLength="2000"/);
  assert.ok(h.includes("falta la guirnalda"));
  assert.ok(h.includes("Enviar") && h.includes("Cerrar"));
  assert.ok(h.includes("¿Qué pasó?"));
});
prueba("deshecho: se abre con la pregunta de qué falló", () => {
  const h = vista({ deshecho: true, porQueAbierto: true });
  assert.ok(h.includes("¿Qué falló?"));
  assert.ok(h.includes("Lo deshiciste"));
});
prueba("cada superficie con su paleta", () => {
  assert.ok(vista({}, "taller").includes("taller-"));
  const cliente = vista({}, "cliente");
  assert.ok(cliente.includes("borde-suave") && !cliente.includes("taller-"));
});
prueba("el componente completo se dibuja en el servidor sin tocar la red ni dejar nada elegido", () => {
  const llamadas: string[] = [];
  const h = html(createElement(CalificacionIA, { tema: "cliente", config: { producto: "cliente", turnoId: "m1", datos: () => ({}), buscar: async (u) => { llamadas.push(String(u)); return Response.json({}); } } }));
  assert.equal(botonesNota(h).length, 10);
  assert.deepEqual(llamadas, []);
});

console.log("Taller");
prueba("solo los turnos con respuesta de la IA se califican", () => {
  assert.equal(turnoCalificable(turno(1)), true);
  assert.equal(turnoCalificable(turno(1, { estado: "sin_cambios", diff: null })), true);
  assert.equal(turnoCalificable(turno(1, { estado: "error" })), false);
  assert.equal(turnoCalificable(turno(1, { estado: "detenido" })), false);
});
prueba("«deshecho» es lo que hay hoy en la escena: ya se pudo deshacer y se puede rehacer", () => {
  const t = turno(1);
  assert.equal(turnoDeshecho(estadoDeTurno(alta, t.diff!)), false);
  assert.equal(turnoDeshecho(estadoDeTurno(base, t.diff!)), true);
  assert.equal(turnoDeshecho(undefined), false);
});
prueba("el panel pone la fila bajo la tarjeta de cada turno con respuesta, y no bajo uno que falló", () => {
  const h = html(createElement(PanelIA, { ia: iaFalsa([turno(1), turno(2, { estado: "error", diff: null, respuesta: "" })]), escena: alta, seleccion: null, alFotoRealista: sin, alElegirPieza: sin }));
  assert.equal(h.split("¿Qué tal quedó?").length - 1, 1);
  assert.ok(h.indexOf("Turno 1") < h.indexOf("¿Qué tal quedó?") && h.indexOf("¿Qué tal quedó?") < h.indexOf("Turno 2"));
  assert.equal(botonesNota(h).length, 10);
});
prueba("en el teléfono (hoja) la fila también está", () => {
  const h = html(createElement(PanelIA, { ia: iaFalsa([turno(1)]), escena: alta, seleccion: null, enHoja: true, alFotoRealista: sin, alElegirPieza: sin }));
  assert.ok(h.includes("¿Qué tal quedó?"));
});
prueba("la tarjeta suelta se dibuja con el tema del taller", () => {
  const h = html(createElement(CalificacionTurno, { turno: turno(1), estado: undefined, datos: () => undefined, compacta: false }));
  assert.ok(h.includes("taller-") && h.includes("¿Qué tal quedó?"));
});

console.log("Chat guiado");
const guiado = (extra: Partial<MensajeGuiadoCalificable> & { id: string }): MensajeGuiadoCalificable => ({ role: "assistant", content: "Aquí tienes una idea.", ...extra });
prueba("califica respuestas de la IA; no saludos guionados, preguntas fijas con chips, enlaces de compra ni fallos vacíos", () => {
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a" })), true);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", content: "", widgets: [{ tipo: "plan" }] })), true);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", content: "", widgets: [{ tipo: "propuesta" }] })), true);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", rapidas: ["Boda"] })), false);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", pregunta: "ciudad-decorador" })), false);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", widgets: [{ tipo: "pregunta-propuesta" }] })), false);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", widgets: [{ tipo: "comprar" }] })), false);
  assert.equal(esTurnoGuiadoCalificable(guiado({ id: "a", content: "  ", widgets: [] })), false);
  assert.equal(esTurnoGuiadoCalificable({ id: "u", role: "user", content: "hola" }), false);
});
prueba("el plan del mensaje es su «escena» (o la propuesta mientras no hay plan)", () => {
  assert.deepEqual(estadoGuiadoDelMensaje({ id: "a", role: "assistant", content: "", widgets: [{ tipo: "plan", plan: { piezas: 2 } } as { tipo: string }] }), { plan: { piezas: 2 } });
  assert.deepEqual(estadoGuiadoDelMensaje({ id: "a", role: "assistant", content: "", widgets: [{ tipo: "propuesta", propuesta: { frase: "x" } } as { tipo: string }] }), { propuesta: { frase: "x" } });
  assert.equal(estadoGuiadoDelMensaje(guiado({ id: "a" })), undefined);
});
prueba("la fila sale bajo la respuesta terminada y no mientras llega", () => {
  const mensajes = [{ id: "u1", role: "user" as const, content: "Quiero un arco" }, guiado({ id: "a1" })];
  const con = html(createElement(CalificacionGuiada, { mensajes, indice: 1, listo: true }));
  assert.ok(con.includes("¿Qué tal quedó?") && con.includes("pl-11"));
  assert.equal(html(createElement(CalificacionGuiada, { mensajes, indice: 1, listo: false })), "");
  assert.equal(html(createElement(CalificacionGuiada, { mensajes, indice: 0, listo: true })), "");
  assert.equal(html(createElement(CalificacionGuiada, { mensajes: [...mensajes, { id: "u2", role: "user" as const, content: "Gracias" }], indice: 3, listo: true })), "");
});

console.log("Chat clásico");
prueba("califica respuestas de la IA; no el saludo, el análisis de diagnóstico, lo que llega ni lo vacío", () => {
  const mensajes = [{ id: "saludo", role: "assistant" as const, content: "¡Hola!" }, { id: "u1", role: "user" as const, content: "Quiero un arco" }, { id: "a1", role: "assistant" as const, content: "Te propongo esto" },
    { id: "a2", role: "assistant" as const, content: "{json}", analisisReferencias: {} }, { id: "a3", role: "assistant" as const, content: "" }];
  const fila = (indice: number, listo = true) => html(createElement(CalificacionClasica, { mensajes, indice, listo }));
  assert.ok(fila(2).includes("¿Qué tal quedó?"));
  assert.ok(!fila(2).includes("pl-11"), "sin avatar, sin sangría");
  assert.equal(fila(0), "");
  assert.equal(fila(1), "");
  assert.equal(fila(3), "");
  assert.equal(fila(4), "");
  assert.equal(fila(2, false), "");
});

console.log(`\n${pruebas} pruebas OK`);
