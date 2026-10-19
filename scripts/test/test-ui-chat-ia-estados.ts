/**
 * Estados de las superficies de IA con los componentes React Bits (T12), sin navegador, red ni coste:
 * - espera del asistente (StatusMark + LatticeLoader) hasta que llega texto de un turno guionado;
 * - pasos de la IA de escena doblados en ThoughtLine, alimentados con líneas NDJSON simuladas del flujo real;
 * - «Foto realista» con RefineFrame: una etapa por evento real;
 * - el compositor (PromptBar) conserva enviar, adjuntar y cancelar.
 *
 * Run: npx tsx scripts/test/test-ui-chat-ia-estados.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EsperaAsistente } from "../../src/components/ui/shell/EsperaAsistente";
import { Compositor } from "../../src/components/ui/shell/Compositor";
import { PromptBar } from "../../src/components/ui/reactbits";
import { TarjetaComparando, TarjetaEnCurso, aplicarEventoEnCurso } from "../../src/components/tres-d/ia/TarjetaEnCurso";
import type { EnCurso } from "../../src/components/tres-d/ia/useAsistenteIA";
import { ETAPAS_FOTO_REALISTA, EtapasFotoRealista, type EtapaFotoRealista } from "../../src/components/tres-d/EtapasFotoRealista";
import { crearSeparadorDeLineas, eventoDeLinea, lineaNdjson, type EventoFlujo } from "../../src/lib/globos3d/flujo-escena-ia";

const ROOT = path.resolve(__dirname, "..", "..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

let pruebas = 0;
function prueba(nombre: string, fn: () => void): void {
  fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

/** Recorre un árbol de elementos (los componentes sin hooks se expanden) y devuelve los que cumplen `cumple`. */
function buscar(nodo: ReactNode, cumple: (e: ReactElement<Record<string, unknown>>) => boolean, fuera: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) { nodo.forEach((n) => buscar(n, cumple, fuera)); return fuera; }
  if (!isValidElement(nodo)) return fuera;
  const e = nodo as ReactElement<Record<string, unknown>>;
  if (cumple(e)) fuera.push(e);
  if (typeof e.type === "function" && e.type === PromptBar) buscar((e.type as (p: unknown) => ReactNode)(e.props), cumple, fuera);
  else buscar(e.props.children as ReactNode, cumple, fuera);
  return fuera;
}

// --- Flujo simulado: líneas NDJSON cortadas por la red, tal como las lee la interfaz.
function eventosSimulados(): EventoFlujo[] {
  const eventos: EventoFlujo[] = [];
  const separador = crearSeparadorDeLineas((l) => { const e = eventoDeLinea(l); if (e) eventos.push(e); });
  const crudo = [
    { tipo: "fase", fase: "leyendo_foto" }, { tipo: "fase", fase: "pensando" }, { tipo: "latido" },
    { tipo: "paso", n: 1, herramienta: "agregar_pieza", resumen: "Arco de 220 cm", consulta: false, ok: true },
    { tipo: "paso", n: 2, herramienta: "mover_pieza", resumen: "No cabe", consulta: false, ok: false },
  ].map((e) => lineaNdjson(e as EventoFlujo)).join("");
  for (let i = 0; i < crudo.length; i += 17) separador.meter(crudo.slice(i, i + 17));
  separador.cerrar();
  return eventos;
}

const enCursoInicial = (): EnCurso => ({ pedido: "pon un arco", contexto: "escena", foto: true, inicio: Date.now(), fase: "leyendo_foto", pasos: [] });

console.log("Espera del asistente");
prueba("turno guionado sin texto: pinta StatusMark + LatticeLoader; con texto ya no hay espera", () => {
  const turno = { cargando: true, content: "" };
  const vista = (t: { cargando: boolean; content: string }) => (t.cargando && !t.content ? renderToStaticMarkup(createElement(EsperaAsistente)) : "");
  const espera = vista(turno);
  assert.match(espera, /data-testid="espera-asistente"/);
  assert.match(espera, /data-status="pending"/);
  assert.match(espera, /data-testid="lattice-loader"/);
  assert.match(espera, /role="status"/);
  assert.equal(vista({ cargando: true, content: "Hola" }), "");
});

console.log("Pasos de la IA de escena");
prueba("los eventos simulados llegan completos y en orden", () => {
  const eventos = eventosSimulados();
  assert.deepEqual(eventos.map((e) => e.tipo), ["fase", "fase", "latido", "paso", "paso"]);
});
prueba("sin pasos: la línea muestra la fase y el LatticeLoader", () => {
  const html = renderToStaticMarkup(createElement(TarjetaEnCurso, { enCurso: enCursoInicial(), alDetener: () => {} }));
  assert.match(html, /data-testid="lattice-loader"/);
  assert.match(html, /data-testid="thought-line"/);
  assert.match(html, /Leyendo la foto…/);
});
prueba("con pasos: ThoughtLine los dobla, con ✓/✗ y el contador, y la fase avanza", () => {
  const enCurso = eventosSimulados().reduce(aplicarEventoEnCurso, enCursoInicial());
  assert.equal(enCurso.fase, "pensando");
  assert.equal(enCurso.pasos.length, 2);
  const html = renderToStaticMarkup(createElement(TarjetaEnCurso, { enCurso, alDetener: () => {} }));
  assert.match(html, /<details[^>]*data-testid="thought-line"/);
  assert.match(html, /2 pasos/);
  assert.match(html, /data-status="ok"/);
  assert.match(html, /data-status="error"/);
  assert.match(html, /Siguiente paso…/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});
prueba("detener sigue conectado y la comparación con la foto usa el mismo loader", () => {
  const html = renderToStaticMarkup(createElement(TarjetaEnCurso, { enCurso: enCursoInicial(), alDetener: () => {} }));
  assert.match(html, /aria-label="Detener el pedido a la IA"/);
  assert.match(source("src/components/tres-d/ia/TarjetaEnCurso.tsx"), /onClick=\{alDetener\}/);
  const comparando = renderToStaticMarkup(createElement(TarjetaComparando, { progreso: { ronda: 2, total: 3 }, alDetener: () => {} }));
  assert.match(comparando, /ronda 2\/3/);
  assert.match(comparando, /data-testid="lattice-loader"/);
});

console.log("Foto realista");
prueba("RefineFrame marca una etapa por evento: lo anterior hecho, lo actual activo, lo siguiente pendiente", () => {
  ETAPAS_FOTO_REALISTA.forEach((e, i) => {
    const html = renderToStaticMarkup(createElement(EtapasFotoRealista, { etapa: e.id as EtapaFotoRealista }));
    assert.match(html, new RegExp(`data-current="${e.id}"`));
    assert.match(html, new RegExp(`data-stage="${e.id}" aria-current="step"`));
    assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
    assert.equal((html.match(/data-status="ok"/g) ?? []).length, i);
  });
  assert.equal((renderToStaticMarkup(createElement(EtapasFotoRealista, { etapa: null })).match(/aria-current/g) ?? []).length, 0);
});
prueba("GeneradorIA fija cada etapa en el punto real (captura, respuesta, guardado) y la limpia al terminar", () => {
  const src = source("src/components/tres-d/GeneradorIA.tsx");
  const orden = ['setEtapa("capturando")', "await capturar()", 'setEtapa("generando")', "await postReanudable(", 'setEtapa("guardando")', "await guardarImagen(", "setEtapa(null)"].map((t) => src.indexOf(t));
  assert.ok(orden.every((i) => i >= 0), "faltan puntos de etapa");
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, "las etapas no siguen el orden de los eventos");
  assert.match(src, /\{cargando && <EtapasFotoRealista etapa=\{etapa\} \/>\}/);
});

console.log("Compositor (PromptBar)");
const propsCompositor = (extra: Partial<Parameters<typeof Compositor>[0]> = {}) => ({
  variante: "normal" as const, entrada: "", onEntrada: () => {}, onEnviar: () => {}, cargando: false, onCancelar: () => {}, placeholder: "Escribe", inputRef: { current: null },
  fotoEspacio: null, onQuitarFotoEspacio: () => {}, referencias: [], onQuitarReferencia: () => {}, onArchivoEspacio: () => {}, onArchivosReferencia: () => {},
  puedeAgregarReferencia: true, ...extra,
});
prueba("usa el estilo PromptBar y conserva adjuntar, texto y enviar", () => {
  const html = renderToStaticMarkup(createElement(Compositor, propsCompositor({ entrada: "hola" })));
  assert.match(html, /data-testid="prompt-bar"/);
  assert.match(html, /prompt-bar/);
  assert.match(html, /data-testid="adjuntar-imagen"/);
  assert.match(html, /id="compositor-mensaje"/);
  assert.match(html, /aria-label="Enviar"/);
  assert.doesNotMatch(html, /cancelar-respuesta/);
});
prueba("enviar: el submit llama a onEnviar y se deshabilita sin texto ni adjuntos", () => {
  let enviados = 0;
  const barra = createElement(PromptBar, { variant: "normal", leading: null, loading: false, canSend: true, onSend: () => { enviados += 1; }, onCancel: () => {} } as Parameters<typeof PromptBar>[0], null);
  const [form] = buscar(barra, (e) => e.type === "form");
  let prevenido = false;
  (form!.props.onSubmit as (e: { preventDefault(): void }) => void)({ preventDefault: () => { prevenido = true; } });
  assert.ok(prevenido);
  assert.equal(enviados, 1);
  assert.match(renderToStaticMarkup(createElement(Compositor, propsCompositor())), /<button type="submit" disabled=""/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Compositor, propsCompositor({ entrada: "x" }))), /<button type="submit" disabled=""/);
});
prueba("cancelar: con la respuesta en curso aparece el botón y llama a onCancelar", () => {
  let cancelados = 0;
  const barra = createElement(PromptBar, { variant: "grande", leading: null, loading: true, canSend: false, onSend: () => {}, onCancel: () => { cancelados += 1; } } as Parameters<typeof PromptBar>[0], null);
  const [boton] = buscar(barra, (e) => e.props["data-testid"] === "cancelar-respuesta");
  (boton!.props.onClick as () => void)();
  assert.equal(cancelados, 1);
  const html = renderToStaticMarkup(createElement(Compositor, propsCompositor({ cargando: true })));
  assert.match(html, /data-testid="cancelar-respuesta"/);
  assert.doesNotMatch(html, /aria-label="Enviar"/);
});
prueba("adjuntar: los adjuntos salen como chips quitables y el aviso de formato se mantiene", () => {
  const html = renderToStaticMarkup(createElement(Compositor, propsCompositor({ fotoEspacio: { src: "data:image/png;base64,AA", etiqueta: "Mi sala" }, referencias: [{ src: "data:image/png;base64,BB", etiqueta: "Ref 1" }], errorAdjuntos: "Formato no válido" })));
  assert.match(html, /data-adjunto="espacio"/);
  assert.match(html, /data-adjunto="referencia"/);
  assert.match(html, /aria-label="Quitar Ref 1"/);
  assert.match(html, /Formato no válido/);
  assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
});

console.log(`\n${pruebas} pruebas OK`);
