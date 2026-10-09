/**
 * Los componentes del panel de la IA (D-021), renderizados a HTML estático, sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-panel-ia-componentes.ts
 * - las pestañas «Pieza | IA» con sus roles y estados ARIA, y la pestaña «Pieza» inerte mientras se ve «antes»;
 * - la tarjeta de turno según lo que se puede hacer HOY (deshacer, rehacer, ya lo cambiaste tú, de otra escena), compacta en el
 *   teléfono, sin coste por turno (salvo con foto) y sin «Deshacer» activo que no haga nada;
 * - el panel: hilo, pregunta de la IA, «La IA cambiará:» con «Escena entera» por defecto, «Enviar» que se vuelve «Detener»,
 *   el menú «⋯» con su confirmación y la foto realista debajo del pedido (no en el teléfono);
 * - «Antes | Después» sobre el visor;
 * - la conversación se guarda aparte de la escena, con su clave, y la escena se guarda aunque la conversación no quepa;
 * - el teclado de pantalla: cuánto sube la hoja.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { estadoDeTurno } from "../../src/lib/globos3d/deshacer-turno";
import { diffEscenas } from "../../src/lib/globos3d/diff-escenas";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena } from "../../src/lib/globos3d/escena";
import type { TurnoPanel } from "../../src/lib/globos3d/turnos-ia";
import { BannerVerAntes } from "../../src/components/tres-d/ia/BannerVerAntes";
import { MenuConversacion } from "../../src/components/tres-d/ia/MenuConversacion";
import { PanelIA } from "../../src/components/tres-d/ia/PanelIA";
import { PestanasLaterales } from "../../src/components/tres-d/ia/PestanasLaterales";
import { TarjetaTurno } from "../../src/components/tres-d/ia/TarjetaTurno";
import type { AsistenteIA } from "../../src/components/tres-d/ia/useAsistenteIA";
import { guardarEscena, leerGuardada } from "../../src/components/tres-d/guardado-escena";
import { guardarConversacion, leerConversacion } from "../../src/components/tres-d/guardado-conversacion";
import { registrarClave } from "../../src/lib/globos3d/claves-escena";
import { historialCambiar, historialDeshacer, historialNuevo, historialRehacer } from "../../src/lib/globos3d/escena";
import { insetTeclado } from "../../src/components/tres-d/useInsetTeclado";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const alta: Escena = { ...base, nodos: base.nodos.map((n) => (n.id === "columna-izq" && n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 220, colores: ["570"] } } : n)) };
const turno = (numero: number, cambios: Partial<TurnoPanel> = {}): TurnoPanel => ({
  id: `t${numero}`, numero, pedido: `Hazla de 2,2 m ${numero}`, contexto: "sobre «Columna izquierda»", ambito: "escena", clave: "e1", foto: false, respuesta: "Subí la columna a 2,2 m.",
  pasos: [{ herramienta: "ver_escena", resumen: "Miré la escena", consulta: true }, { herramienta: "cambiar_pieza", resumen: "alto 220 cm", consulta: false }],
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
const hayBoton = (h: string, texto: string) => h.split("<button").some((t) => t.slice(0, t.indexOf("</button>")).endsWith(texto));
const desactivado = (etiqueta: string) => / disabled=""/.test(etiqueta);

const iaFalsa = (turnos: TurnoPanel[], extra: Partial<AsistenteIA> = {}): AsistenteIA => ({
  turnos, enCurso: null, refinando: null, ocupado: false, enviar: async () => true, detener: sinAccion, deshacer: sinAccion, rehacer: sinAccion, verAntes: sinAccion, antesId: null, escenaAntes: null,
  borrar: sinAccion, preguntaPendiente: null, estados: Object.fromEntries(turnos.filter((t) => t.diff).map((t) => [t.id, estadoDeTurno(alta, t.diff!)])), avisos: {},
  datosFeedback: () => undefined, marcas: [], apuntar: sinAccion, tiempo: "unos 12 s", costeTotalUsd: 0.0031, ...extra,
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
prueba("mientras se ve «antes», la pestaña «Pieza» es inerte (muestra la escena de ahora y no se edita) y la IA no", () => {
  const h = html(createElement(PestanasLaterales, { activa: "pieza", alCambiar: sinAccion, pieza: null, ia: null, turnos: 0, trabajando: false, piezaInerte: true }));
  assert.match(h, /id="lado-panel-pieza"[^>]*inert=""/);
  assert.doesNotMatch(h, /id="lado-panel-ia"[^>]*inert/);
  assert.doesNotMatch(html(createElement(PestanasLaterales, { activa: "pieza", alCambiar: sinAccion, pieza: null, ia: null, turnos: 0, trabajando: false })), /inert/);
});

console.log("Antes | Después");
prueba("un interruptor sobre el visor: «Antes» activo y «Después» vuelve", () => {
  const h = html(createElement(BannerVerAntes, { numero: 3, alVolver: sinAccion }));
  assert.match(h, /aria-label="Escena antes o después del turno 3"/);
  assert.match(botonCon(h, "Antes"), /aria-pressed="true"/);
  assert.match(botonCon(h, "Después"), /aria-pressed="false"/);
});

console.log("Tarjeta de turno");
const propsTarjeta = (t: TurnoPanel, escena: Escena = alta, extra: Record<string, unknown> = {}) => ({
  turno: t, estado: t.diff ? estadoDeTurno(escena, t.diff) : undefined, aviso: undefined, esUltimo: true, compacta: false, viendoAntes: false, hayPieza: () => true,
  alDeshacer: sinAccion, alRehacer: sinAccion, alVerAntes: sinAccion, alApuntar: sinAccion, alElegir: sinAccion, alReintentar: sinAccion, ...extra,
});
prueba("muestra lo que hizo, una línea por pieza en palabras de decorador, los pasos legibles y las dos acciones", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2))));
  assert.match(h, /aria-label="Turno 2"/);
  assert.match(h, /Subí la columna a 2,2 m\./);
  assert.match(h, /aria-label="Cambiada: Columna izquierda, alto 1,8 m → 2,2 m · Rosado\/Blanco\/Dorado \+1 → Dorado 570\. Enter la elige en la escena"/);
  assert.equal((h.match(/Cambiada: /g) ?? []).length, 1, "una sola línea por pieza");
  assert.doesNotMatch(h, /R-12/, "los conteos por formato no se repiten");
  assert.match(h, /2 pasos de la IA/);
  assert.match(h, /Cambió una pieza · alto 2,2 m/, "paso legible, medidas en m");
  assert.doesNotMatch(h, /cambiar_pieza/);
  assert.match(botonCon(h, "Deshacer turno"), /type="button"/);
  assert.doesNotMatch(botonCon(h, "Deshacer turno"), / disabled=""/);
  assert.match(botonCon(h, "Ver antes"), /aria-pressed="false"/);
});
prueba("no muestra el coste del turno (solo el de uno con foto)", () => {
  assert.doesNotMatch(html(createElement(TarjetaTurno, propsTarjeta(turno(2)))), /US\$/);
  assert.match(html(createElement(TarjetaTurno, propsTarjeta(turno(2, { foto: true })))), /US\$0,0031/);
});
prueba("deshecho (por el botón o por Ctrl+Z): atenuado, «Rehacer turno» en vez de «Deshacer», y «Ver antes» apagado", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2), base)));
  assert.match(h, /opacity-70/);
  assert.match(h, /deshecho/);
  assert.ok(hayBoton(h, "Rehacer turno"));
  assert.ok(!hayBoton(h, "Deshacer turno"));
  assert.match(botonCon(h, "Ver antes"), / disabled=""/);
});
prueba("nunca un «Deshacer» activo que no hace nada: si lo cambiado ya lo cambiaste tú, el botón está apagado y lo dice", () => {
  const tuyo: Escena = { ...alta, nodos: alta.nodos.map((n) => (n.id === "columna-izq" && n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 250, colores: ["010"] } } : n)) };
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2), tuyo)));
  assert.match(botonCon(h, "Ya lo cambiaste tú"), / disabled=""/);
  assert.ok(!hayBoton(h, "Rehacer turno"));
});
prueba("un turno de otra escena (o de otro editor) no ofrece nada y se ve atenuado", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2), alta, { estado: undefined })));
  assert.match(h, /de otra escena/);
  assert.match(h, /opacity-70/);
  assert.ok(!hayBoton(h, "Deshacer turno") && !hayBoton(h, "Ver antes"));
  assert.match(h, /<button type="button" disabled=""/, "las líneas del diff no se pueden señalar");
});
prueba("«Ver antes» activo queda presionado; las piezas que ya no están no se pueden señalar", () => {
  assert.match(botonCon(html(createElement(TarjetaTurno, propsTarjeta(turno(2), alta, { viendoAntes: true }))), "Ver antes"), /aria-pressed="true"/);
  assert.match(html(createElement(TarjetaTurno, propsTarjeta(turno(2), alta, { hayPieza: () => false }))), /<button type="button" disabled=""[^>]*aria-label="Cambiada: Columna izquierda/);
});
prueba("un error ofrece «Volver a intentarlo» y no tiene lista ni deshacer", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(3, { estado: "error", diff: null, respuesta: "", nota: "No pude hablar con la IA ahora.", costeUsd: null }))));
  assert.ok(hayBoton(h, "Volver a intentarlo"));
  assert.match(h, /No pude hablar con la IA ahora\./);
  assert.doesNotMatch(h, /Cambios en la escena|Deshacer turno/);
});
prueba("compacta (teléfono): los cambios van plegados («1 cambio») y los botones con 40 px de alto", () => {
  const h = html(createElement(TarjetaTurno, propsTarjeta(turno(2), alta, { compacta: true })));
  assert.match(h, /<details class="mb-1\.5"><summary[^>]*>1 cambio<\/summary>/);
  assert.doesNotMatch(h, /<details open/);
  assert.ok(h.indexOf("<footer") < h.indexOf("<details"), "los botones van antes de los cambios plegados: caben sin desplazar");
  assert.ok(html(createElement(TarjetaTurno, propsTarjeta(turno(2)))).indexOf("<footer") > html(createElement(TarjetaTurno, propsTarjeta(turno(2)))).indexOf("<details"), "en el escritorio, después");
  assert.match(botonCon(h, "Deshacer turno"), /min-h-10/);
  assert.match(html(createElement(TarjetaTurno, propsTarjeta(turno(2)))), /<details open="" class="mb-1\.5"><summary/);
});
prueba("la última tarjeta explica que las líneas se ven en la escena y se eligen", () => {
  assert.match(html(createElement(TarjetaTurno, propsTarjeta(turno(2)))), /Pasa el cursor por una línea para verla en la escena/);
  assert.match(html(createElement(TarjetaTurno, propsTarjeta(turno(2), alta, { compacta: true }))), /Toca una línea para verla en la escena/);
  assert.doesNotMatch(html(createElement(TarjetaTurno, propsTarjeta(turno(2), alta, { esUltimo: false }))), /Pasa el cursor/);
});

console.log("Panel");
const propsPanel = (ia: AsistenteIA, extra: Record<string, unknown> = {}) => ({
  ia, escena: base, seleccion: { id: "columna-izq", nombre: "Columna izquierda" }, alFotoRealista: sinAccion, alElegirPieza: sinAccion, ...extra,
});
prueba("hilo con los turnos, «La IA cambiará:» con la pieza elegida, sugerencias, tiempo y coste total (no por turno)", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1), turno(2)]))));
  assert.match(h, /role="log"[^>]*aria-label="Conversación con la IA"/);
  assert.match(h, /aria-label="Turno 1"/);
  assert.match(h, /aria-label="Turno 2"/);
  assert.match(h, /La IA cambiará:[\s\S]*Columna izquierda/);
  assert.match(botonCon(h, "Escena entera"), /aria-pressed="false"/);
  assert.match(h, /Sugerencias para esta escena/);
  assert.match(h, /Suele tardar unos 12 s/);
  assert.match(h, /Esta conversación: US\$0,0031/);
  assert.doesNotMatch(h, /<footer[^>]*>[\s\S]*?US\$0,0031[\s\S]*?<\/footer>/);
});
prueba("sin pieza elegida, «Escena entera» ya está elegida (y no es un interruptor)", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]), { seleccion: null })));
  assert.match(h, /La IA cambiará:[\s\S]*?Escena entera/);
  assert.ok(!hayBoton(h, "Escena entera"), "es una ficha fija, no un botón");
});
prueba("la foto realista va DEBAJO del pedido y sin competir con «Enviar» (botón secundario)", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]))));
  assert.ok(h.indexOf("Foto realista de lo que ves") > h.indexOf('aria-label="Enviar a la IA"'));
  assert.match(h, /FLUX · 20–40 s · ≈US\$0,05 por foto \(tope de 30 por hora\)/);
  assert.match(botonCon(h, "Generar"), /border-taller-borde/);
  assert.doesNotMatch(botonCon(h, "Generar"), /bg-taller-primario/);
});
prueba("la pregunta de la IA trae sus opciones y «Otra cosa…»", () => {
  const ia = iaFalsa([turno(1)], { preguntaPendiente: { turnoId: "t1", texto: "¿La igualo?", opciones: ["Sí, iguálala", "No, así está bien"] } });
  const h = html(createElement(PanelIA, propsPanel(ia)));
  assert.match(h, /La IA pregunta:/);
  assert.match(h, /Sí, iguálala/);
  assert.match(h, /Otra cosa…/);
});
prueba("trabajando: tarjeta con pasos legibles y «Detener»; «Enviar» se vuelve «Detener»; el contador no se anuncia", () => {
  const enCurso = { pedido: "Quita las flores", contexto: "escena entera", foto: false, inicio: Date.now(), fase: "pensando" as const, pasos: [{ n: 1, herramienta: "ver_escena", resumen: "Miré la escena", consulta: true, ok: true }] };
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([], { enCurso, ocupado: true }))));
  assert.match(h, /aria-label="La IA está trabajando"/);
  assert.match(h, /Miré la escena/);
  assert.match(h, /aria-label="Detener el pedido a la IA"/);
  assert.match(h, /<button type="button" aria-label="Detener" title="Detener \(Esc\)"/);
  assert.doesNotMatch(h, /aria-label="Enviar a la IA"/);
  assert.match(h, /<textarea[^>]*disabled=""/);
  assert.match(h, /<span aria-hidden="true">Trabajando · \d+ s<\/span>/);
});
prueba("la caja de pedido muestra el foco (anillo en la caja entera, no solo outline-none) y los botones miden 40 px", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]))));
  assert.match(h, /focus-within:ring-2/);
  assert.match(botonCon(h, "Escena entera"), /min-h-10/);
  assert.match(h, /aria-label="Enviar a la IA"[^>]*min-h-10/);
});
prueba("el menú «⋯» pide confirmar antes de borrar la conversación (la papelera suelta ya no está)", () => {
  const h = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]))));
  assert.match(h, /aria-label="Más opciones de la conversación"[^>]*/);
  assert.doesNotMatch(h, /aria-label="Borrar la conversación"/);
  assert.doesNotMatch(html(createElement(MenuConversacion, { alBorrar: sinAccion, deshabilitado: false, haciaArriba: false })), /Borrar la conversación…/, "el menú cerrado no muestra la opción");
});
prueba("en el teléfono: compacta, sin la tarjeta de la foto, sin «La IA cambiará:» si no hay pieza y con el «⋯» junto a la caja", () => {
  const sinElegida = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]), { enHoja: true, seleccion: null })));
  assert.doesNotMatch(sinElegida, /Foto realista de lo que ves/);
  assert.doesNotMatch(sinElegida, /La IA cambiará:/);
  assert.match(sinElegida, /aria-label="Más opciones de la conversación"/);
  assert.doesNotMatch(sinElegida, /<h2/);
  assert.match(sinElegida, /<details class="mb-1\.5"><summary[^>]*>1 cambio/);
  const conPieza = html(createElement(PanelIA, propsPanel(iaFalsa([turno(1)]), { enHoja: true })));
  assert.match(conPieza, /La IA cambiará:[\s\S]*Columna izquierda/);
  const vacio = html(createElement(PanelIA, propsPanel(iaFalsa([], { tiempo: null, costeTotalUsd: 0 }), { enHoja: true })));
  assert.match(vacio, /Sugerencias para esta escena/);
});

console.log("Conversación guardada aparte de la escena");
function falsoNavegador(limite: (clave: string, valor: string) => boolean) {
  const memoria = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = { localStorage: {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => { if (!limite(k, v)) throw new Error("QuotaExceededError"); memoria.set(k, v); },
  } };
  return memoria;
}
prueba("guardar y leer devuelve los turnos (sin los errores); la escena guarda su clave y no lleva la conversación", () => {
  const memoria = falsoNavegador(() => true);
  const turnos = [turno(1), turno(2, { pregunta: { texto: "¿La igualo?", opciones: ["Sí", "No"] } }), turno(3, { estado: "error", diff: null })];
  assert.equal(guardarConversacion(turnos), true);
  assert.equal(guardarEscena({ nombre: "Mi escena", escena: alta, clave: "e7" }), true);
  const leida = leerConversacion();
  assert.deepEqual(leida.map((t) => t.numero), [1, 2]);
  assert.deepEqual(leida[0]?.diff, turnos[0]!.diff);
  assert.ok(!(memoria.get("taller3d:escena:v1") ?? "").includes("turnos"));
  assert.equal(leerGuardada()?.clave, "e7", "la clave sobrevive aunque la conversación no se guarde");
  assert.equal(leerGuardada()?.escena.nodos.length, alta.nodos.length);
  memoria.set("taller3d:escena:v1", JSON.stringify({ nombre: "Vieja", escena: base }));
  assert.equal(leerGuardada()?.clave, undefined, "una escena guardada antes de las claves abre igual");
});
prueba("si la conversación no cabe en el navegador, la escena se guarda igual y la conversación suelta los turnos más viejos hasta caber", () => {
  const LIMITE = 40_000;
  falsoNavegador((k, v) => k !== "taller3d:conversacion:v1" || v.length < LIMITE);
  const grandes = Array.from({ length: 12 }, (_, i) => turno(i + 1, { respuesta: "x".repeat(9_000) }));
  assert.equal(guardarEscena({ nombre: "Mi escena", escena: alta, clave: "e1" }), true, "la escena no depende de la conversación");
  assert.equal(guardarConversacion(grandes), true);
  const leida = leerConversacion();
  assert.ok(leida.length > 0 && leida.length < 12, "quedaron los más nuevos");
  assert.equal(leida[leida.length - 1]!.numero, 12);
});
prueba("si ni un turno cabe, no lanza (devuelve false) y la escena sigue guardándose; basura guardada no rompe la lectura", () => {
  const memoria = falsoNavegador((k) => k !== "taller3d:conversacion:v1");
  assert.equal(guardarConversacion([turno(1)]), false);
  assert.equal(guardarEscena({ nombre: "Mi escena", escena: alta, clave: "e1" }), true);
  memoria.set("taller3d:conversacion:v1", "{no es json");
  assert.deepEqual(leerConversacion(), []);
  memoria.set("taller3d:conversacion:v1", JSON.stringify({ turnos: "no" }));
  assert.deepEqual(leerConversacion(), []);
});

console.log("La clave de la escena sigue a Ctrl+Z y Ctrl+Y");
prueba("edición hereda; plantilla o sala vacía abren otra; Ctrl+Z devuelve la anterior con SU clave y Ctrl+Y la nueva", () => {
  const claves = new WeakMap<Escena, string>();
  const A = base, B = alta, C = { ...base, nodos: [] } as Escena;
  claves.set(A, "e1");
  let h = historialNuevo(A);
  registrarClave(claves, h.presente, B);
  h = historialCambiar(h, B);
  assert.equal(claves.get(h.presente), "e1", "una edición hereda");
  registrarClave(claves, h.presente, C, "e2");
  h = historialCambiar(h, C);
  assert.equal(claves.get(h.presente), "e2", "reemplazar la escena abre otra identidad");
  h = historialDeshacer(h);
  assert.equal(h.presente, B);
  assert.equal(claves.get(h.presente), "e1", "Ctrl+Z trae la escena de antes con su identidad: sus turnos vuelven a actuar");
  h = historialRehacer(h);
  assert.equal(claves.get(h.presente), "e2");
  // Una escena que ya tenía clave (la devuelve la IA con otra forma) no la pierde por heredar.
  const D = { ...A }; claves.set(D, "e9");
  registrarClave(claves, B, D);
  assert.equal(claves.get(D), "e9");
});

console.log("Teclado de pantalla");
prueba("la hoja sube lo que tapa el teclado; la barra del navegador (poco) no cuenta", () => {
  assert.equal(insetTeclado(844, { height: 844, offsetTop: 0 }), 0);
  assert.equal(insetTeclado(844, { height: 790, offsetTop: 0 }), 0, "la barra de direcciones");
  assert.equal(insetTeclado(844, { height: 520, offsetTop: 0 }), 324);
  assert.equal(insetTeclado(844, { height: 520, offsetTop: 30 }), 294, "la página se desplazó dentro del viewport visual");
});

console.log(`\n${pruebas} pruebas OK`);
