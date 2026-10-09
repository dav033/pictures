/**
 * Los componentes del panel de la IA (D-021), renderizados a HTML estático, sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-panel-ia-componentes.ts
 * - las pestañas «Pieza | IA» con sus roles y estados ARIA;
 * - la tarjeta de turno: cambios como botones enfocables, «Deshacer turno» y «Ver antes» con su estado;
 * - el panel: hilo, pregunta de la IA con «Otra cosa…», fichas de alcance, sugerencias de la escena, tiempo y coste, y la
 *   tarjeta de la foto realista (no en el teléfono);
 * - la conversación se guarda con la escena y vuelve igual al leerla (y la escena vieja sin conversación sigue abriendo).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { diffEscenas } from "../../src/lib/globos3d/diff-escenas";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena } from "../../src/lib/globos3d/escena";
import type { TurnoPanel } from "../../src/lib/globos3d/turnos-ia";
import { PanelIA } from "../../src/components/tres-d/ia/PanelIA";
import { PestanasLaterales } from "../../src/components/tres-d/ia/PestanasLaterales";
import { TarjetaTurno } from "../../src/components/tres-d/ia/TarjetaTurno";
import type { AsistenteIA } from "../../src/components/tres-d/ia/useAsistenteIA";
import { guardarEscena, leerGuardada } from "../../src/components/tres-d/guardado-escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const alta: Escena = { ...base, nodos: base.nodos.map((n) => (n.id === "columna-izq" && n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 220 } } : n)) };
const turno = (numero: number, cambios: Partial<TurnoPanel> = {}): TurnoPanel => ({
  id: `t${numero}`, numero, pedido: `Hazla de 2,2 m ${numero}`, contexto: "sobre «Columna izquierda»", ambito: "escena", foto: false, respuesta: "Subí la columna a 2,2 m.",
  pasos: [{ herramienta: "ver_escena", resumen: "Miré la escena", consulta: true }, { herramienta: "cambiar_pieza", resumen: "alto 220", consulta: false }],
  diff: diffEscenas(base, alta), pregunta: null, costeUsd: 0.0031, ms: 12_000, estado: "aplicado", nota: null, ...cambios,
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const sinAccion = () => undefined;
/** La etiqueta de apertura del botón cuyo contenido termina en `texto`. */
const botonCon = (h: string, texto: string): string => {
  const trozo = h.split("<button").find((t) => t.slice(0, t.indexOf("</button>")).endsWith(texto));
  if (trozo === undefined) assert.fail(`no hay un botón «${texto}»`);
  return `<button${trozo.slice(0, trozo.indexOf(">") + 1)}`;
};

const iaFalsa = (turnos: TurnoPanel[], extra: Partial<AsistenteIA> = {}): AsistenteIA => ({
  turnos, enCurso: null, refinando: null, ocupado: false, enviar: async () => true, detener: sinAccion, deshacer: sinAccion, verAntes: sinAccion, antesId: null, escenaAntes: null,
  borrar: sinAccion, preguntaPendiente: null, marcas: [], apuntar: sinAccion, tiempo: "unos 12 s", costeTotalUsd: 0.0031, ...extra,
});

console.log("Pestañas");
prueba("Pieza | IA: tablist, tab seleccionada, tabpanel enlazado y el otro oculto, ambos montados", () => {
  const h = html(createElement(PestanasLaterales, { activa: "ia", alCambiar: sinAccion, pieza: createElement("p", null, "INSPECTOR"), ia: createElement("p", null, "ASISTENTE"), turnos: 2, trabajando: false }));
  assert.match(h, /role="tablist"/);
  assert.match(h, /id="lado-pestana-ia"[^>]*aria-selected="true"[^>]*aria-controls="lado-panel-ia"[^>]*tabindex="0"/);
  assert.match(h, /id="lado-pestana-pieza"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(h, /id="lado-panel-pieza" aria-labelledby="lado-pestana-pieza" hidden=""/);
  assert.match(h, /INSPECTOR/);
  assert.match(h, /ASISTENTE/);
});
prueba("con «Pieza» abierta avisa en la pestaña de la IA que está trabajando", () => {
  const h = html(createElement(PestanasLaterales, { activa: "pieza", alCambiar: sinAccion, pieza: null, ia: null, turnos: 0, trabajando: true }));
  assert.match(h, /aria-label="La IA está trabajando"/);
});

console.log("Tarjeta de turno");
const propsTarjeta = (t: TurnoPanel, extra: Record<string, unknown> = {}) => ({
  turno: t, ambitoActual: "escena" as const, viendoAntes: false, hayPieza: () => true, alDeshacer: sinAccion, alVerAntes: sinAccion, alApuntar: sinAccion, alElegir: sinAccion, alReusar: sinAccion, ...extra,
});
prueba("muestra lo que hizo, los cambios como botones, los pasos y las dos acciones", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2))));
  assert.match(h, /aria-label="Turno 2"/);
  assert.match(h, /Subí la columna a 2,2 m\./);
  assert.match(h, /aria-label="Cambiada: Columna izquierda, alto 1,8 m → 2,2 m\. Enter la elige en la escena"/);
  assert.match(h, /2 pasos de la IA/);
  assert.match(h, /Deshacer turno/);
  assert.match(botonCon(h, "Ver antes"), /aria-pressed="false"/);
  assert.doesNotMatch(botonCon(h, "Deshacer turno"), / disabled=""/);
  assert.match(h, /US\$0,0031/);
});
prueba("un turno deshecho no se puede deshacer otra vez; «Ver antes» activo queda presionado", () => {
  const deshecho = html(createElement(TarjetaTurno, propsTarjeta(turno(2, { estado: "deshecho", nota: "Deshice el turno 2." }))));
  assert.match(botonCon(deshecho, "Deshacer turno"), /disabled=""/);
  assert.match(deshecho, /Deshice el turno 2\./);
  assert.match(botonCon(html(createElement(TarjetaTurno, propsTarjeta(turno(2), { viendoAntes: true }))), "Ver antes"), /aria-pressed="true"/);
});
prueba("un turno de otro editor no ofrece deshacer; un error ofrece volver a intentarlo y no tiene lista", () => {
  assert.match(botonCon(html(createElement(TarjetaTurno, propsTarjeta(turno(2, { ambito: "pieza" })))), "Deshacer turno"), /disabled=""/);
  const error = html(createElement(TarjetaTurno, propsTarjeta(turno(3, { estado: "error", diff: null, respuesta: "", nota: "No pude hablar con la IA ahora.", costeUsd: null }))));
  assert.match(error, /Volver a intentarlo/);
  assert.match(error, /No pude hablar con la IA ahora\./);
  assert.doesNotMatch(error, /Cambios en la escena|Deshacer turno/);
});
prueba("las piezas quitadas o que ya no están no se pueden señalar", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2), { hayPieza: () => false })));
  assert.match(h, /<button type="button" disabled=""[^>]*aria-label="Cambiada: Columna izquierda, alto 1,8 m → 2,2 m"/);
});

console.log("Panel");
const propsPanel = (ia: AsistenteIA, extra: Record<string, unknown> = {}) => ({
  ia, escena: base, ambito: "escena" as const, seleccion: { id: "columna-izq", nombre: "Columna izquierda" }, alFotoRealista: sinAccion, alElegirPieza: sinAccion, ...extra,
});
prueba("hilo con los turnos, ficha de alcance de la pieza elegida, sugerencias de la escena, tiempo y coste", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1), turno(2)]))));
  assert.match(h, /role="log"[^>]*aria-label="Conversación con la IA"/);
  assert.match(h, /aria-label="Turno 1"/);
  assert.match(h, /aria-label="Turno 2"/);
  assert.match(h, /Sobre:[\s\S]*Columna izquierda/);
  assert.match(h, /aria-pressed="false"[^>]*>Escena entera/);
  assert.match(h, /Sugerencias para esta escena/);
  assert.match(h, /Hazla más alta, de 2,2 m/);
  assert.match(h, /Suele tardar unos 12 s/);
  assert.match(h, /Esta conversación: US\$0,0031/);
  assert.match(h, /Foto realista de lo que ves/);
  assert.match(h, /FLUX · 20–40 s · ≈US\$0,05 por foto \(tope de 30 por hora\)/);
});
prueba("la pregunta de la IA trae sus opciones y «Otra cosa…»", () => {
  const ia = iaFalsa([turno(1)], { preguntaPendiente: { turnoId: "t1", texto: "¿La igualo?", opciones: ["Sí, iguálala", "No, así está bien"] } });
  const h = html(createElement(PanelIA, propsPanel(ia)));
  assert.match(h, /La IA pregunta:/);
  assert.match(h, /Sí, iguálala/);
  assert.match(h, /Otra cosa…/);
});
prueba("trabajando: tarjeta con los pasos en vivo y «Detener»; la caja queda desactivada", () => {
  const enCurso = { pedido: "Quita las flores", contexto: "escena entera", foto: false, inicio: Date.now(), fase: "pensando" as const, pasos: [{ n: 1, herramienta: "ver_escena", resumen: "Miré la escena", consulta: true, ok: true }] };
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([], { enCurso, ocupado: true }))));
  assert.match(h, /aria-label="La IA está trabajando"/);
  assert.match(h, /Miré la escena/);
  assert.match(h, /aria-label="Detener el pedido a la IA"/);
  assert.match(h, /<textarea[^>]*disabled=""/);
});
prueba("en el teléfono: sin la tarjeta de la foto realista y con menos sugerencias", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]), { enHoja: true })));
  assert.doesNotMatch(h, /Foto realista de lo que ves/);
  assert.doesNotMatch(h, /Sugerencias para esta escena/);
  const vacio = html(createElement(PanelIA, propsPanel(iaFalsa([], { tiempo: null, costeTotalUsd: 0 }), { enHoja: true })));
  assert.match(vacio, /Sugerencias para esta escena/);
  assert.match(vacio, /Tarda unos segundos/);
});

console.log("Conversación guardada con la escena");
prueba("guardar y leer devuelve la conversación; sin conversación o con basura abre igual", () => {
  const memoria = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => { memoria.set(k, v); } } };
  const conversacion = [turno(1), turno(2, { pregunta: { texto: "¿La igualo?", opciones: ["Sí", "No"] } }), turno(3, { estado: "error", diff: null })];
  assert.equal(guardarEscena({ nombre: "Mi escena", escena: alta, conversacion }), true);
  const leida = leerGuardada();
  assert.deepEqual(leida?.conversacion?.map((t) => t.numero), [1, 2], "los errores no se guardan");
  assert.deepEqual(leida?.conversacion?.[0]?.diff, conversacion[0]!.diff);
  assert.equal(leida?.escena.nodos.length, alta.nodos.length);
  memoria.set("taller3d:escena:v1", JSON.stringify({ nombre: "Vieja", escena: base }));
  assert.deepEqual(leerGuardada()?.conversacion, []);
  memoria.set("taller3d:escena:v1", JSON.stringify({ nombre: "Rota", escena: base, conversacion: "no" }));
  assert.deepEqual(leerGuardada()?.conversacion, []);
});

console.log(`\n${pruebas} pruebas OK`);
