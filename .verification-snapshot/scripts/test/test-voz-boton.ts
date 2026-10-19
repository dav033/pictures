/**
 * El botón de dictar dibujado a HTML estático, sin red:
 *   npx tsx scripts/test/test-voz-boton.ts
 * Con el dictado apagado (o sin saberlo todavía) los campos de texto quedan exactamente como estaban: el botón no deja nada
 * en el HTML, ni en la caja del taller ni en las de la vista del cliente.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BotonVoz } from "../../src/components/voz/BotonVoz";
import { Compositor } from "../../src/components/guiado/Compositor";
import { Compositor as CompositorClasico } from "../../src/components/ui/shell/Compositor";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const sin = () => undefined;

prueba("sin saber si el servidor lo habilitó, el botón no se dibuja", () => {
  for (const variante of ["taller", "cliente"] as const) {
    assert.equal(renderToStaticMarkup(createElement(BotonVoz, { campoId: "x", alTexto: sin, clase: "c", variante })), "");
  }
});

prueba("la caja de la vista guiada: sin micrófono, con la caja de siempre (campo con id para el dictado)", () => {
  const html = renderToStaticMarkup(createElement(Compositor, {
    valor: "", onCambiar: sin, onEnviar: sin, placeholder: "Cuéntame", cargando: false, onDetener: sin, deshabilitado: false,
    foto: null, onFoto: sin, textoRef: { current: null }, archivoRef: { current: null },
  }));
  assert.doesNotMatch(html, /Dictar/);
  assert.match(html, /id="compositor-guiado-mensaje"/);
  assert.match(html, /aria-label="Enviar mensaje"/);
});

prueba("la caja de la vista clásica: sin micrófono", () => {
  const html = renderToStaticMarkup(createElement(CompositorClasico, {
    entrada: "", onEntrada: sin, onEnviar: sin, cargando: false, onCancelar: sin, placeholder: "Escribe", inputRef: { current: null },
    fotoEspacio: null, onQuitarFotoEspacio: sin, referencias: [], onQuitarReferencia: sin, onArchivoEspacio: sin, onArchivosReferencia: sin,
    puedeAgregarReferencia: true, analisis: null, errorAdjuntos: null,
  } as never));
  assert.doesNotMatch(html, /Dictar/);
  assert.match(html, /id="compositor-mensaje"/);
});

console.log(`\n[PASS] ${pruebas} pruebas del botón de dictar`);
