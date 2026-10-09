/**
 * REQ-012 «Mobiliario libre» (3/3): el inspector de la mesa y sus sillas. Render estático, sin red ni proveedores.
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-mobiliario-libre-ui.ts   (sin --conditions=react-server: renderiza React)
 * - el inspector de una mesa y el de sus sillas exponen tipo, medida, mantel y sillas (cantidad, tipo, disposición, colores);
 * - lo que cambia el inspector son las mismas operaciones de la escena (cambiarSillas / cambiarMesa).
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorConjuntoMesa } from "../../src/components/tres-d/EditorConjuntoMesa";
import type { Escena } from "../../src/lib/globos3d/escena";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";
import { mesaDePieza } from "../../src/lib/globos3d/mobiliario-conjunto";
import { cambiarMesa, cambiarSillas } from "../../src/lib/globos3d/mobiliario-conjunto-escena";
import { piezaDeMueble } from "../../src/lib/globos3d/mobiliario-pieza";
import { cuantas, fin, llamar, nodo, prueba, salaGrande } from "./lib-test-mobiliario-libre";

prueba("el inspector de una mesa expone tipo, medida, mantel y sillas (cantidad, tipo, disposición) y el de las sillas, los mismos", () => {
  const e = llamar(salaGrande(), "agregar_mesas", { sillas_por_mesa: 6 }).escena;
  const html = (id: string) => renderToStaticMarkup(createElement(EditorConjuntoMesa, { nodo: nodo(e, id), escena: e, onEscena: () => {} }));
  for (const id of ["mesa-redonda", "sillas-mesa-redonda"]) {
    const h = html(id);
    for (const frase of ["Tipo de mesa", "Mesa media luna", "Banquete en U", "Diámetro", "Alto de la tapa", "Mantel", "Hasta el piso", "Cantidad", "caben 13", "Tipo de silla", "Silla Tiffany", "Disposición", "Frente al escenario", "Color de las sillas", "Color del cojín", "camino de mesa"]) {
      assert.ok(h.includes(frase), `${id}: falta «${frase}»`);
    }
    assert.match(h, /<option value="redonda" selected="">Mesa redonda<\/option>/);
    assert.match(h, /font-mono text-\[13px\]" aria-live="polite">6</);
  }
  assert.ok(!html("mesa-redonda").includes("Ancho de la mesa"), "la redonda no tiene fondo aparte");
  const rect = llamar(salaGrande(), "agregar_mesas", { tipo: "rectangular", sillas_por_mesa: 0 }).escena;
  const hr = renderToStaticMarkup(createElement(EditorConjuntoMesa, { nodo: rect.nodos[0]!, escena: rect, onEscena: () => {} }));
  assert.ok(hr.includes("Ancho de la mesa") && hr.includes("Largo"));
  // Un conjunto fijo ofrece pasarlo a editable.
  const fijo: Escena = { ...salaGrande(), nodos: [{ id: "f", nombre: "Mesa", pieza: piezaDeMueble(muebleDe("mesa_redonda_sillas")!), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  assert.ok(renderToStaticMarkup(createElement(EditorConjuntoMesa, { nodo: fijo.nodos[0]!, escena: fijo, onEscena: () => {} })).includes("Hacerla editable"));
});

prueba("cambiar las sillas o la mesa desde el inspector usa las mismas operaciones (cambiarSillas / cambiarMesa) y no rompe lo demás", () => {
  const e = llamar(salaGrande(), "agregar_mesas", { cantidad: 2, sillas_por_mesa: 6 }).escena;
  const notas: string[] = [];
  const a = cambiarSillas(e, "mesa-redonda", { cantidad: 3 }, notas);
  assert.equal(cuantas(a, "mesa-redonda"), 3);
  assert.equal(cuantas(a, "mesa-redonda-2"), 6);
  const b = cambiarMesa(a, "mesa-redonda", { tipo: "cuadrada", anchoCm: 120 }, notas);
  assert.equal(cuantas(b, "mesa-redonda"), 3);
  assert.equal(mesaDePieza(nodo(b, "mesa-redonda").pieza)!.tipo, "cuadrada");
  assert.equal(nodo(b, "mesa-redonda").nombre, "Mesa cuadrada 120×120 1");
  assert.equal(JSON.stringify(nodo(b, "mesa-redonda-2")), JSON.stringify(nodo(a, "mesa-redonda-2")));
});



fin("test-mobiliario-libre-ui");
