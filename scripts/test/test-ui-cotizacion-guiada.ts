import { DECORACION_DEMO_COTIZACION } from "./decoracion-demo-cotizacion";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CotizacionGuiadaSchema, ListaMaterialesResultadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { CotizacionPersonalGuiada } from "@/components/guiado/CotizacionPersonalGuiada";
import { CotizacionProfesional } from "@/components/cotizacion/CotizacionProfesional";
import { TarjetaEleccion } from "@/components/guiado/TarjetaEleccion";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

const decoracion = DECORACION_DEMO_COTIZACION;
assert.ok(decoracion, "Falta decoración real de demostración.");
const livePython = process.argv.includes("--python");

/** Costeo real en Python y líneas armadas como las arma la ruta guiada (costear_decoracion). */
function cotizarEnPython(idea: DecoracionSempertex, id?: string) {
  const salida = ListaMaterialesResultadoSchema.parse(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test/datos-cotizacion-guiada.ts", ...(livePython ? [] : ["--fixture"]), ...(id ? [id] : [])], { encoding: "utf8", timeout: 30_000 })));
  return CotizacionGuiadaSchema.parse({
    lineas: salida.lineas.map((linea) => ({
      id: linea.variant_id,
      tamano: "sin tamaño aplicable",
      ...presentacionMaterialGuiado(idea.materiales.find((material) => material.variantId === linea.variant_id)?.nota),
      cantidadNecesaria: linea.cantidad_necesaria,
      disponible: true,
      varianteId: linea.variant_id,
      precioPaquete: linea.precio_paquete,
      unidadesPaquete: linea.unidades_paquete,
      paquetes: linea.paquetes,
      subtotal: linea.subtotal,
      sobrante: linea.sobrante,
    })),
    total: salida.total, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
  });
}
const textoDe = (marcado: string) => marcado.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");

const cotizacion = cotizarEnPython(decoracion);
if (!livePython) assert.equal(cotizacion.total, 39_111, "controlled fixture total");
const html = renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion }));
const textoHTML = html.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");
const htmlNegocioCerrado = renderToStaticMarkup(createElement(CotizacionProfesional, { cotizacion, clave: "guiado-ej-demo-cotizacion" }));
const borradorAbierto = JSON.stringify({ costos: { mano_de_obra: [{ id: "m1", descripcion: "Montaje", costo: "5000", cantidad: "1" }], equipos_transporte: [], indirectos: [] }, precios: {}, utilidad: "" });
// Los escuchas vacíos: con un `window` presente, motion (la lista de materiales anima) cree estar en el navegador.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: { getItem: () => borradorAbierto }, addEventListener: () => undefined, removeEventListener: () => undefined } });
const htmlNegocioAbierto = renderToStaticMarkup(createElement(CotizacionProfesional, { cotizacion, clave: "guiado-ej-demo-cotizacion" }));
if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
else Reflect.deleteProperty(globalThis, "window");
const textoNegocio = htmlNegocioAbierto.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");

// The current UI names Sempertex products and uses their catalogue swatches.
for (const texto of [
  "Sempertex Fashion Palo de Rosa de 12\"",
  "Sempertex Fashion Durazno de 12\"",
  "Sempertex Fashion Blanco de 12\"",
  "Usas 40 globos",
  "compras 1 paquete de 50",
  "te sobran 10",
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(cotizacion.total),
  "Total con IVA",
  "Precio de tienda en línea, IVA incluido. No incluye el montaje.",
  "te sobran 70 para reponer los que se revienten",
]) assert.ok(textoHTML.includes(texto), `Falta texto visible: ${texto}`);
for (const jerga of ["R-12", "variante", "Incluye 0% de reserva"]) assert.equal(textoHTML.includes(jerga), false, `No debe mostrar: ${jerga}`);
// Cada fila con su globo dibujado en su color (sin foto de catálogo en estas líneas): el color va en el degradado.
assert.match(html, /stop-color="#d191a5"/);
assert.match(html, /stop-color="#ffa06a"/);
assert.match(html, /stop-color="#ffffff"/);
assert.equal((html.match(/<svg[^>]*viewBox="0 0 100 100"/g) ?? []).length, cotizacion.lineas.length, "un globo por material");
assert.ok(htmlNegocioCerrado.includes("Ajustar mi precio"));
assert.ok(textoNegocio.includes("Ocultar ajustes"));
for (const nombre of ["Palo de rosa", "Durazno", "Blanco"]) assert.ok(textoNegocio.includes(`Globo de látex 12\" ${nombre}`));
assert.ok(!textoNegocio.includes("R-12") && !textoNegocio.includes("variante"));

// Ideas REALES del carrusel (notas del catálogo «… — R-12 / PAQUETE X 50 · R-12 · rosado»): antes cada línea decía
// «Globo de de 12"» y todas se juntaban en una sola fila. Ahora una fila por variante, con su color de cliente.
const visibles = bibliotecaVisible();
const resumenReales: string[] = [];
for (const [id, esperados] of [
  ["deco-real-05-arco-organico-bf3d4c2f-12ab-4c83-a87b-97da3b53ec", ["Fashion Palo de Rosa", "Fashion Arena", "Fashion Frambuesa", "Reflex Dorado Rosa", "Fashion Rosado"]],
  ["deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", ["Fashion Blanco", "Pastel Mate Azul", "Reflex Plata", "Reflex Azul"]],
] as const) {
  const idea = visibles.find((item) => item.id === id);
  assert.ok(idea, `La idea ${id} debe estar visible en la biblioteca.`);
  const cotizacionReal = cotizarEnPython(idea, id);
  assert.equal(cotizacionReal.lineas.length, idea.materiales.length, "Python cotiza una línea por variante");
  const marcado = renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: cotizacionReal, decoracion: idea }));
  const texto = textoDe(marcado);
  const filas = [...marcado.matchAll(/<li[\s>]/g)].length;
  assert.equal(filas, idea.materiales.length, `${id}: una fila por variante (${filas} filas para ${idea.materiales.length} variantes)`);
  for (const nombre of esperados) assert.ok(texto.includes(`Sempertex ${nombre} de 12\"`), `${id}: falta la fila «${nombre}» en ${texto}`);
  for (const material of idea.materiales) {
    const linea = cotizacionReal.lineas.find((item) => item.varianteId === material.variantId)!;
    // Con 1 se dice en singular («Usas 1 globo»); antes salía «Usas 1 globos».
    assert.ok(texto.includes(`Usas ${linea.cantidadNecesaria} ${linea.cantidadNecesaria === 1 ? "globo " : "globos"}`), `${id}: falta la cantidad ${linea.cantidadNecesaria}`);
  }
  for (const jerga of ["Globo de de", "R-12", "PAQUETE", "B2b", "· rosado"]) assert.equal(texto.includes(jerga), false, `${id}: no debe mostrar «${jerga}»`);
  // La tarjeta de la idea dice los mismos colores que su precio.
  const tarjeta = textoDe(renderToStaticMarkup(createElement(TarjetaEleccion, { decoracion: idea })));
  for (const nombre of esperados) {
    assert.ok(tarjeta.includes(nombre), `${id}: la tarjeta y la cotización comparten «${nombre}»`);
  }
  // Negocio: el nombre del catálogo, limpio (sin paquete ni etiqueta).
  for (const linea of cotizacionReal.lineas) assert.match(linea.nombre, /^Globo de látex \d{1,2}" [A-ZÁÉÍÓÚ][^·/]*$/, `${id}: nombre de negocio limpio: ${linea.nombre}`);
  resumenReales.push(`${id.slice(0, 12)}: ${cotizacionReal.lineas.length} filas`);
}

// Ideas curadas de las fotos de Sempertex: globos metalizados, de corazón, de eslabón y para modelar, y una cortina.
// Cada variante es una fila con su nombre de cliente, sin códigos del catálogo.
for (const [id, esperados] of [
  ["deco-real-22-guirnalda-san-valentin", ["Globo metalizado «LOVE» rojo y blanco de 18\"", "Globo de corazón rojo con «Te amo» de 12\"", "Sempertex Fashion Rosa de 12\"", "Cortina Metalica Roja"]],
  ["deco-real-29-arco-link-o-loon-fucsia-tulipanes", ["Globo de eslabón fucsia de 12\"", "Globo amarillo para modelar", "Sempertex Fashion Fucsia de 5\""]],
] as const) {
  const idea = visibles.find((item) => item.id === id);
  assert.ok(idea, `La idea ${id} debe estar visible en la biblioteca.`);
  const cotizacionReal = cotizarEnPython(idea, id);
  assert.equal(cotizacionReal.lineas.length, idea.materiales.length, `${id}: Python cotiza una línea por variante`);
  const marcado = renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: cotizacionReal, decoracion: idea }));
  const texto = textoDe(marcado);
  assert.equal([...marcado.matchAll(/<li[\s>]/g)].length, idea.materiales.length, `${id}: una fila por variante`);
  for (const nombre of esperados) assert.ok(texto.includes(nombre), `${id}: falta la fila «${nombre}» en ${texto}`);
  for (const jerga of ["R-12", "T260", "LOL", "PAQUETE", "B2b", "Tubito", "Link-O-Loon"]) assert.equal(texto.includes(jerga), false, `${id}: no debe mostrar «${jerga}»`);
  assert.ok(!/(?<!\d)1 globos/.test(texto), `${id}: 1 globo en singular`);
  if (id === "deco-real-22-guirnalda-san-valentin") assert.ok(texto.includes("Usas 1 unidad ·"), `${id}: la cortina se cuenta en unidades`);
  for (const linea of cotizacionReal.lineas) assert.ok(!/paquete|·/i.test(linea.nombre) && linea.nombre !== "Globo de látex", `${id}: nombre de negocio limpio: ${linea.nombre}`);
  resumenReales.push(`${id.slice(10, 26)}: ${cotizacionReal.lineas.length} filas`);
}

// Dos variantes del mismo color de cliente (Reflex y Metal dorado) siguen en filas distintas y se distinguen por acabado.
const doradas: DecoracionSempertex = { ...DECORACION_DEMO_COTIZACION, materiales: [
  { variantId: "v-reflex", sku: null, cantidad: 10, nota: "B2b Globo Latex Redondo Reflex Dorado — R-12 / PAQUETE X 50 · R-12 · dorado" },
  { variantId: "v-metal", sku: null, cantidad: 5, nota: "B2b Globo Latex Redondo Metal Dorado — R-12 / PAQUETE X 50 · R-12 · dorado" },
] };
const cotizacionDoradas = CotizacionGuiadaSchema.parse({
  lineas: doradas.materiales.map((material) => ({ id: material.variantId, tamano: "sin tamaño aplicable", ...presentacionMaterialGuiado(material.nota), cantidadNecesaria: material.cantidad, disponible: true, varianteId: material.variantId, precioPaquete: 1000, unidadesPaquete: 50, paquetes: 1, subtotal: 1000, sobrante: 50 - material.cantidad })),
  total: 2000, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
});
const textoDoradas = textoDe(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: cotizacionDoradas, decoracion: doradas })));
assert.ok(textoDoradas.includes("Sempertex Reflex Dorado de 12\"") && textoDoradas.includes("Sempertex Metal Dorado de 12\""), `acabados distintos en filas distintas: ${textoDoradas}`);

console.log(`test-ui-cotizacion-guiada: ideas reales una fila por variante (${resumenReales.join(" | ")}); ${livePython ? "Python real" : "paquetes controlados sin red"}, personal y negocio; total ${cotizacion.total}`);
