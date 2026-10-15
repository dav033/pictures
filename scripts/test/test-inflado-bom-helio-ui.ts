/**
 * T25 y T28 en pantalla, sin navegador ni red (renderToStaticMarkup): «Inflar a N cm» con los segundos de bomba marcados
 * como estimación por capa, y el helio en litros y ft³ con la cinta total y por globo. Y no aparecen sin capas ni helio.
 * Run: npx tsx scripts/test/test-inflado-bom-helio-ui.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HojaArmadoCapa } from "@/components/tres-d/HojaArmadoCapa";
import { HojaArmadoHelioDePieza, HojaArmadoHelioTotal } from "@/components/tres-d/HojaArmadoHelio";
import { SeccionHelio } from "@/components/tres-d/SeccionHelio";
import { SeccionBomba } from "@/components/tres-d/SeccionBomba";
import { resumenHelio } from "@/lib/globos3d/helio-cinta";
import { capasDeAnillos } from "@/lib/globos3d/hoja-armado-capas";
import type { CentroLocal } from "@/lib/globos3d/hoja-armado-local";

const globo = (infladoCm: number, helio?: true) => ({ formatoId: "R-12", infladoCm, ...(helio ? { helio } : {}) });
const conHelio = [{ globos: Array.from({ length: 10 }, () => globo(30, true)) }];
const sinHelio = [{ globos: [globo(28), globo(28)] }];

const cuarteto = (y: number): CentroLocal[] =>
  ["012", "012", "030", "030"].map((codigo, k) => ({
    globo: { formatoId: "R-12", infladoCm: 25, codigo, nudo: { x: 0, y: 0, z: 0 }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0, nivel: 0 },
    x: 15 * Math.cos((Math.PI / 2) * k), y, z: 15 * Math.sin((Math.PI / 2) * k),
  }));

test("la lista de compra con helio dice litros y ft³ por tamaño, el volumen total y la cinta total y por globo", () => {
  const html = renderToStaticMarkup(createElement(SeccionHelio, { grupos: conHelio, metalizados: 0 }));
  assert.match(html, /151,3 L \(5,34 ft³\)/);
  assert.match(html, /Helio \(con pérdida del 7 %\): 151,3 L \(5,34 ft³\) · cinta: 12 m en total, 1,2 m por globo/);
  assert.equal(html.match(/151,3/g)?.length, 2, "los litros salen en la fila y en la línea de total, no más");
});

const filasLi = (html: string): string[] => [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
const dosTamanos = [{ globos: [...Array.from({ length: 4 }, () => globo(30, true)), ...Array.from({ length: 2 }, () => ({ formatoId: "R-18", infladoCm: 42, helio: true as const }))] }];

test("con dos tamaños de helio cada fila (li) lleva sus litros y sus ft³, en la lista de compra y en la hoja", () => {
  const resumen = resumenHelio(dosTamanos)!;
  const esperado = [/R-12 inflado a 30 cm.*60,5 L \(2,14 ft³\)/, /R-18 inflado a 42 cm.*83 L \(2,93 ft³\)/];
  const lista = filasLi(renderToStaticMarkup(createElement(SeccionHelio, { grupos: dosTamanos, metalizados: 0 })));
  const hoja = filasLi(renderToStaticMarkup(createElement(HojaArmadoHelioTotal, { resumen })));
  for (const filas of [lista, hoja]) {
    assert.equal(filas.length, 2);
    filas.forEach((fila, i) => assert.match(fila, esperado[i]!));
  }
});

test("sin globos de helio no hay volumen ni ft³ en la lista de compra", () => {
  const html = renderToStaticMarkup(createElement(SeccionHelio, { grupos: sinHelio, metalizados: 0 }));
  assert.doesNotMatch(html, /ft³|Volumen|por globo/);
});

test("la hoja de armado: la pieza y el total de helio llevan ft³ y cinta por globo", () => {
  const resumen = resumenHelio(conHelio)!;
  const pieza = renderToStaticMarkup(createElement(HojaArmadoHelioDePieza, { resumen, copias: 1 }));
  const total = renderToStaticMarkup(createElement(HojaArmadoHelioTotal, { resumen }));
  for (const html of [pieza, total]) {
    assert.match(html, /5,34 ft³/);
    assert.match(html, /1,2 m por globo/);
    assert.equal(html.match(/151,3/g)?.length, 2, "los litros salen en la fila y en una sola línea de total");
  }
});

test("una capa dice «Inflar a N cm» y marca los segundos de bomba como estimación", () => {
  const capas = capasDeAnillos([cuarteto(0), cuarteto(20)], 4)!;
  const html = renderToStaticMarkup(createElement(HojaArmadoCapa, { capa: capas[0]! }));
  assert.match(html, /Inflar a 25 cm/);
  assert.match(html, /\(estimación\)/);
  const filas = filasLi(html).filter((f) => f.includes("c/u"));
  assert.ok(filas.length > 0);
  for (const fila of filas) assert.match(fila, /Inflar a 25 cm.*\(estimación\)/);
});

test("la sección Bomba de la lista de compra también dice a cuántos cm inflar; sin globos de bomba no sale", () => {
  const con = renderToStaticMarkup(createElement(SeccionBomba, { globos: [globo(25)], calibracion: {}, onCambiar: () => {} }));
  assert.match(con, /Inflar a 25 cm/);
  for (const fila of filasLi(con).filter((f) => f.includes("c/u"))) assert.match(fila, /\(estimación\)/);
  const sin = renderToStaticMarkup(createElement(SeccionBomba, { globos: [globo(30, true)], calibracion: {}, onCambiar: () => {} }));
  assert.doesNotMatch(sin, /Inflar a/);
});
