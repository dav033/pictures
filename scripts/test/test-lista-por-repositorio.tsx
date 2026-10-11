/**
 * La lista de compra por repositorio (REQ-013 fase 5, T25, SPEC §8): las líneas de «Escenografía» de `productosDe` se reparten en
 * «Mobiliario» y «Escenografía» con la interfaz por repositorio encendida; apagada (la marcha atrás), la lista es la de siempre. Sin
 * navegador, sin red ni coste (el recorrido en el navegador está en `test-lista-repositorios-ui.ts`).
 * - el reparto: sillas, mesas, sofás y conjuntos de mesa con sillas son mobiliario; fondos y decorado, escenografía; lo de una idea de
 *   Sempertex (mesas dibujadas por la idea), papel y follaje, y un mueble que ya no existe se quedan en «Escenografía»; ninguna línea
 *   se pierde ni se repite y el orden de cada parte es el de siempre;
 * - el texto que se copia: la sección «ESCENOGRAFÍA» de siempre, o «MOBILIARIO» y «ESCENOGRAFÍA»;
 * - lo que pinta `ListaEscenografia`: sin reparto, byte a byte lo de antes (una sola sección «Escenografía»); con reparto, una sección
 *   por parte; sin mobiliario, lo mismo que sin reparto.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-lista-por-repositorio.tsx   (sin --conditions=react-server: renderiza React)
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListaEscenografia } from "../../src/components/tres-d/ListaEscenografia";
import { escenografiaEnTexto, repartirEscenografia } from "../../src/lib/catalogo/lista-por-repositorio";
import { BIBLIOTECA_FABRICA, escenaDeItem, itemDeEscena, productosDe, type LineaEscenografia } from "../../src/lib/globos3d/biblioteca";
import type { Escena } from "../../src/lib/globos3d/escena";
import { entradaDeCatalogo } from "../../src/lib/globos3d/fondos-escenografia";
import { piezaDeEntrada, type PiezaEscenografia } from "../../src/lib/globos3d/mobiliario-pieza";
import { llamar, salaGrande } from "./lib-test-mobiliario-libre";

let pruebas = 0;
function prueba(nombre: string, fn: () => void): void {
  fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

const conMuebles = (): Escena => {
  let escena = llamar(salaGrande(), "agregar_mesas", { sillas_por_mesa: 6 }).escena;
  for (const id of ["mesa_redonda_sillas", "sofa", "panel_redondo", "base_pastel"]) escena = llamar(escena, "agregar_mobiliario", { id }).escena;
  return escena;
};
const listaDe = (escena: Escena) => productosDe(itemDeEscena({ id: "vista:prueba", nombre: "Prueba", ocasiones: ["general"], escena })).escenografia;
const nombres = (lineas: readonly LineaEscenografia[]) => lineas.map((l) => l.nombre);

prueba("sillas, mesas, sofás y conjuntos de mesa con sillas son Mobiliario; fondos y decorado, Escenografía; cada línea una vez y en su orden", () => {
  const escena = conMuebles();
  const lineas = listaDe(escena);
  const partes = repartirEscenografia(escena, lineas);
  assert.deepEqual(nombres(partes.mobiliario), ["Mesa redonda Ø150", "Silla Tiffany", "Mesa redonda con 8 sillas", "Sofá"]);
  assert.deepEqual(nombres(partes.escenografia), ["Panel redondo", "Base de pastel"]);
  assert.deepEqual([...partes.mobiliario, ...partes.escenografia].map((l) => l.nombre).sort(), nombres(lineas).sort(), "ni se pierde ni se repite ninguna");
  assert.deepEqual(partes.mobiliario.map((l) => l.cantidad), [1, 6, 1, 1], "las cantidades son las de siempre");
  for (const parte of [partes.mobiliario, partes.escenografia]) {
    const posiciones = parte.map((l) => lineas.indexOf(l));
    assert.deepEqual(posiciones, [...posiciones].sort((a, b) => a - b), "el orden de siempre dentro de cada parte");
  }
});

prueba("lo que dibuja una idea de Sempertex, papel y follaje se quedan en Escenografía, y no hay línea nueva ni distinta", () => {
  const marco = BIBLIOTECA_FABRICA.find((i) => i.id === "escena:halloween_marco_mesas")!;
  const lineas = productosDe(marco).escenografia;
  assert.ok(lineas.some((l) => l.nombre.startsWith("Mesa cilíndrica")) && lineas.some((l) => l.clase === "papel"), "la idea trae mesas dibujadas y papel");
  const partes = repartirEscenografia(escenaDeItem(marco), lineas);
  assert.deepEqual(partes.mobiliario, [], "las mesas de la idea son escenografía de Sempertex, no el mobiliario del catálogo");
  assert.deepEqual(partes.escenografia, lineas);
});

prueba("una línea es de Mobiliario solo si TODAS sus piezas lo son: una mezcla o un mueble que ya no existe se quedan en Escenografía", () => {
  const deCatalogo = (id: string): PiezaEscenografia => {
    const pieza = piezaDeEntrada(entradaDeCatalogo(id)!);
    if (pieza.tipo !== "escenografia" || !pieza.mueble) throw new Error(`«${id}» no se guarda como mueble de escenografía`);
    return pieza;
  };
  const silla = deCatalogo("silla_tiffany");
  const panel = deCatalogo("panel_redondo");
  const huerfano: PiezaEscenografia = { ...silla, mueble: { ...silla.mueble!, id: "silla_que_ya_no_existe" } };
  const escena: Escena = {
    ...salaGrande(),
    nodos: [
      { id: "a", nombre: "Igual", pieza: silla, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } },
      { id: "b", nombre: "Igual", pieza: panel, colocacion: { en: "piso", xCm: 90, zCm: 0, giroGrados: 0 } },
      { id: "c", nombre: "Sola", pieza: silla, colocacion: { en: "piso", xCm: 180, zCm: 0, giroGrados: 0 } },
      { id: "d", nombre: "Huérfana", pieza: huerfano, colocacion: { en: "piso", xCm: 270, zCm: 0, giroGrados: 0 } },
    ],
  };
  const linea = (nombre: string, ...piezas: string[]): LineaEscenografia => ({ nombre, clase: "escenografia", cantidad: piezas.length, piezas });
  const partes = repartirEscenografia(escena, [linea("Igual", "Igual", "Igual"), linea("Sola", "Sola"), linea("Huérfana", "Huérfana"), linea("Sin piezas")]);
  assert.deepEqual(nombres(partes.mobiliario), ["Sola"]);
  assert.deepEqual(nombres(partes.escenografia), ["Igual", "Huérfana", "Sin piezas"]);
});

prueba("el texto que se copia: la sección de siempre, o Mobiliario y Escenografía; sin mobiliario es el mismo", () => {
  const escena = conMuebles();
  const lineas = listaDe(escena);
  const partes = repartirEscenografia(escena, lineas);
  assert.deepEqual(escenografiaEnTexto(lineas, null), ["", "ESCENOGRAFÍA (no es producto de la tienda)", ...lineas.map((l) => `${l.cantidad} × ${l.nombre}`)], "la de antes, línea a línea");
  assert.deepEqual(escenografiaEnTexto(lineas, partes), [
    "", "MOBILIARIO (no es producto de la tienda)", "1 × Mesa redonda Ø150", "6 × Silla Tiffany", "1 × Mesa redonda con 8 sillas", "1 × Sofá",
    "", "ESCENOGRAFÍA (no es producto de la tienda)", "1 × Panel redondo", "1 × Base de pastel",
  ]);
  assert.deepEqual(escenografiaEnTexto([], null), [], "sin líneas no hay sección");
  const soloFondos = repartirEscenografia(escena, lineas.filter((l) => l.nombre === "Panel redondo"));
  assert.deepEqual(escenografiaEnTexto(lineas.filter((l) => l.nombre === "Panel redondo"), soloFondos), escenografiaEnTexto(lineas.filter((l) => l.nombre === "Panel redondo"), null), "sin mobiliario, el texto es el de siempre");
});

// ---------------------------------------------------------------------------------------------------------------------
// Lo que pinta ListaEscenografia
// ---------------------------------------------------------------------------------------------------------------------

const LINEAS: readonly LineaEscenografia[] = [
  { nombre: "Panel redondo", clase: "escenografia", cantidad: 2, piezas: ["Panel redondo"] },
  { nombre: "Confeti (relleno del globo burbuja)", clase: "papel", cantidad: 1, piezas: ["Burbuja"] },
  { nombre: "Flores artificiales (follaje)", clase: "follaje", cantidad: 12, piezas: ["Arco"] },
];
const productos = (escenografia: readonly LineaEscenografia[]) => ({ globos: [], totalGlobos: 0, tienda: [], utileria: [], escenografia: [...escenografia] });
const dibujar = (lineas: readonly LineaEscenografia[], partes: ReturnType<typeof repartirEscenografia> | null) => renderToStaticMarkup(createElement(ListaEscenografia, { productos: productos(lineas), partes }));

/** El HTML que pintaba `TablaProductos` para estas líneas antes de la fase 5 (copiado del JSX de entonces; comprobado byte a byte contra `origin/main`). */
const DE_SIEMPRE = '<div><h4 class="text-sm font-semibold text-texto">Escenografía <span class="font-normal text-texto-suave">· no es producto de la tienda</span></h4><ul class="mt-1 text-sm text-texto">'
  + '<li>2 × Panel redondo <span class="text-[0.7rem] text-texto-suave">(escenografía)</span></li>'
  + '<li>1 × Confeti (relleno del globo burbuja) <span class="text-[0.7rem] text-texto-suave">(papel)</span></li>'
  + '<li>12 × Flores artificiales (follaje) <span class="text-[0.7rem] text-texto-suave">(follaje artificial)</span></li></ul></div>';

prueba("la marcha atrás: sin reparto, la sección «Escenografía» es byte a byte la de antes de la fase 5", () => {
  assert.equal(dibujar(LINEAS, null), DE_SIEMPRE);
  assert.equal(dibujar([], null), "", "sin líneas no pinta nada, como antes");
});

prueba("con reparto: una sección por parte, la de mobiliario con su rótulo; sin mobiliario es la misma sección de siempre", () => {
  const escena = conMuebles();
  const lineas = listaDe(escena);
  const html = dibujar(lineas, repartirEscenografia(escena, lineas));
  assert.deepEqual([...html.matchAll(/<h4[^>]*>([^<]*)</g)].map((m) => m[1]!.trim()), ["Mobiliario", "Escenografía"]);
  assert.ok(html.indexOf("Mobiliario") < html.indexOf("Escenografía"));
  assert.ok(html.includes("Sofá <span class=\"text-[0.7rem] text-texto-suave\">(mobiliario)</span>"), "las líneas de mobiliario se rotulan «mobiliario»");
  assert.ok(html.includes("Panel redondo <span class=\"text-[0.7rem] text-texto-suave\">(escenografía)</span>"));
  assert.equal(dibujar(LINEAS, repartirEscenografia(escena, LINEAS)), DE_SIEMPRE, "papel, follaje y lo que no es mobiliario: una sola sección, igual que antes");
});

console.log(`test-lista-por-repositorio: ${pruebas} pruebas ok`);
