import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clasificarColores, clasificarTonos, COLORES_CLAROS_V2, familiaDeColorPropuesta } from "../../src/lib/rag/taxonomy/v2";
import { coloresConTonosDelCliente, esGloboDelTono, filtrarPorTonos, tonoDelTitulo, tonosExclusivos } from "../../src/lib/plan/tonos-color";
import { coloresRealesProducto } from "../../src/lib/plan/colores-producto";
import { extraerRestriccionesUsuario } from "../../src/lib/plan/restricciones";
import { CotizacionGuiadaSchema, PropuestaComposicionSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { normalizarPropuestaComposicion } from "../../src/lib/ia/guiado/propuesta-composicion";
import { instruccionPlanGuiado, defectoPlanGuiado } from "../../src/lib/ia/guiado/instruccion-plan";
import { presentacionMaterialGuiado } from "../../src/lib/ia/guiado/presentacion-material-guiado";
import { colorSempertex } from "../../src/components/guiado/color-sempertex";
import { nombreLineaCliente } from "../../src/components/guiado/formato";
import { nombreMaterial } from "../../src/components/guiado/TarjetaEleccion";
import { CotizacionPersonalGuiada } from "../../src/components/guiado/CotizacionPersonalGuiada";
import { bibliotecaVisible } from "../../src/lib/biblioteca-sempertex/biblioteca";

/**
 * Probador (2026-10-07, guiada-20261006-234525-va33im): «celeste» no existía. Un unicornio en «rosa, lila, celeste y
 * dorado» salió «Azul cromado» (Reflex Azul, petróleo en el dibujo), y el «Azul caribe» de la columna arcoíris se
 * llamaba «celeste» en la cotización. Sin coste: sin modelo, sin Python, sin red.
 *
 *   npx tsx scripts/test/test-colores-claros-guiada.ts
 */

const UNICORNIO = "me gusta la columna pero en colores de unicornio: rosa, lila, celeste y dorado. y que sean 2 columnas para la entrada";

// ── 1. La taxonomía conoce los tonos claros (y Python sigue viendo su familia) ──────────────────────────────────────
assert.deepEqual(clasificarColores(UNICORNIO).values, ["rosado", "lila", "azul", "dorado"], "antes «celeste» no era ningún color: salían tres");
assert.deepEqual(clasificarTonos(UNICORNIO).values, ["celeste"]);
assert.deepEqual(clasificarColores("globo azul celeste").values, ["azul"], "«azul celeste» es UN color, no dos");
assert.deepEqual(clasificarTonos("algo en azul cielo y rosa bebé").values, ["celeste", "rosa pastel"]);
assert.deepEqual(clasificarColores("durazno y menta").values, ["menta"], "durazno es un tono, no un naranja de paleta (un plan «naranja» compraría el naranja vivo)");
assert.deepEqual(clasificarTonos("durazno y menta").values, ["durazno"]);
assert.equal(familiaDeColorPropuesta("celeste"), "azul");
assert.equal(familiaDeColorPropuesta("Rosa pastel"), "rosado");
assert.equal(familiaDeColorPropuesta("lila"), "lila");
assert.deepEqual([...COLORES_CLAROS_V2], ["celeste", "rosa pastel", "lila", "menta", "durazno"], "la lista de colores claros que se ofrecen");
assert.deepEqual(tonosExclusivos(UNICORNIO), ["celeste"]);
assert.deepEqual(tonosExclusivos("columnas azul rey y celeste"), [], "con otro azul pedido, los dos azules valen");
assert.deepEqual(extraerRestriccionesUsuario(UNICORNIO).colores.map((color) => color.valor).sort(), ["azul", "dorado", "lila", "rosa"], "la restricción del plan exige su familia");

// ── 2. La propuesta lleva el tono que dijo el cliente ────────────────────────────────────────────────────────────────
assert.deepEqual(coloresConTonosDelCliente(["rosado", "lila", "azul", "dorado"], [UNICORNIO]), ["rosado", "lila", "celeste", "dorado"]);
assert.deepEqual(coloresConTonosDelCliente(["rosado", "lila", "azul", "dorado"], [UNICORNIO, "el azul cámbialo por celeste clarito en las dos columnas, el resto igual"]), ["rosado", "lila", "celeste", "dorado"], "«cámbialo por celeste» reemplaza el azul");
assert.deepEqual(coloresConTonosDelCliente(["azul", "plateado"], ["columnas en azul rey y celeste"]), ["azul", "celeste", "plateado"], "azul rey y celeste: los dos");
assert.deepEqual(coloresConTonosDelCliente(["rosado", "dorado"], ["rosa y dorado"]), ["rosado", "dorado"], "sin tono, igual");
const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: coloresConTonosDelCliente(["rosado", "lila", "azul", "dorado"], [UNICORNIO]), piezas: [{ estructura: "columna", cantidad: 2 }] });
assert.equal(propuesta.frase, "Te propongo dos columnas en rosado, lila, celeste y dorado.");
assert.ok(PropuestaComposicionSchema.safeParse({ ...propuesta, colores: ["celeste", "rosa pastel", "durazno"] }).success, "el contrato de la propuesta acepta los tonos");
assert.equal(PropuestaComposicionSchema.safeParse({ ...propuesta, colores: ["azul petróleo"] }).success, false, "y nada inventado");

// ── 3. El plan: la instrucción pide el tono y la búsqueda solo devuelve globos de ese tono ───────────────────────────
const instruccion = instruccionPlanGuiado(propuesta);
assert.match(instruccion, /usa EXACTAMENTE estos colores: rosado, lila, celeste, dorado/);
assert.match(instruccion, /celeste → globo redondo azul celeste/);
assert.match(instruccion, /celeste es un tono claro/);
assert.deepEqual(tonosExclusivos(instruccion), ["celeste"], "la instrucción no nombra otro azul (si no, la búsqueda aceptaría cualquiera)");
assert.deepEqual(extraerRestriccionesUsuario(instruccion).colores.map((color) => color.valor).sort(), ["azul", "dorado", "lila", "rosa"], "/api/chat exige azul, que es como Python guarda el celeste");
// Un plan con el Fashion Azul Celeste cumple lo pedido: el «celeste» de la vista es el «azul» del catálogo.
const planCeleste = { plan: { estructuras: [{ estructura_id: "c1", estructura_oficial: "columna", nombre: "Columna izquierda", colores_referencia: ["celeste"] }] }, estructuras: [{ estructura_id: "c1", lineas: [{ titulo: "GLOBO REDONDO FASHION AZUL CELESTE", color: "azul", diam_pulg: 12, unidades: 10 }] }] };
assert.equal(defectoPlanGuiado(planCeleste, undefined, { coloresPedidos: propuesta.colores }), null, "el celeste comprado como «azul» no es un color faltante");

// Catálogo real (snapshot de Shopify): de los azules redondos lisos, ¿cuáles quedan para un celeste?
type Producto = { titulo: string };
const snapshot = JSON.parse(readFileSync(path.join(process.cwd(), "data", "processed", "shopify-products.enriched.json"), "utf8")) as { productos: Producto[] };
const lisos = snapshot.productos
  .map((producto) => producto.titulo)
  .filter((titulo) => /^GLOBO REDONDO /.test(titulo) && !/INFINITY|IMPRES|SURTIDO|POLICROM/i.test(titulo))
  .map((titulo) => ({ titulo, colores: coloresRealesProducto(titulo, clasificarColores(titulo).values) }));
const azules = lisos.filter((producto) => producto.colores.length === 1 && producto.colores[0] === "azul");
const celestes = filtrarPorTonos(azules, ["celeste"], (producto) => producto).map((producto) => producto.titulo).sort();
assert.ok(celestes.includes("GLOBO REDONDO FASHION AZUL CELESTE"), `«celeste» encuentra el Fashion Azul Celeste: ${celestes.join(", ")}`);
assert.ok(celestes.includes("GLOBO REDONDO PASTEL MATE AZUL"), "y el Pastel Mate Azul");
for (const ajeno of ["GLOBO REDONDO REFLEX AZUL", "GLOBO REDONDO FASHION AZUL REY", "GLOBO REDONDO FASHION AZUL NAVAL", "GLOBO REDONDO FASHION AZUL CARIBE", "GLOBO REDONDO METAL AZUL", "GLOBO REDONDO NEON AZUL", "GLOBO REDONDO REFLEX AZUL GALAXY"]) {
  if (azules.some((producto) => producto.titulo === ajeno)) assert.ok(!celestes.includes(ajeno), `${ajeno} no es celeste`);
}
const mezcla = filtrarPorTonos(lisos.filter((producto) => /FASHION (?:ROSADO|LILA|AZUL)$|REFLEX (?:AZUL|DORADO)$/.test(producto.titulo)), ["celeste"], (producto) => producto).map((producto) => producto.titulo).sort();
for (const sigue of ["GLOBO REDONDO FASHION AZUL", "GLOBO REDONDO FASHION LILA", "GLOBO REDONDO FASHION ROSADO"]) assert.ok(mezcla.includes(sigue), `${sigue} sigue (otros colores y azul claro): ${mezcla.join(", ")}`);
assert.ok(!mezcla.includes("GLOBO REDONDO REFLEX AZUL"), "el Reflex Azul (petróleo) sale");
assert.deepEqual(filtrarPorTonos([{ titulo: "GLOBO REDONDO REFLEX AZUL", colores: ["azul"] }], ["celeste"], (producto) => producto).length, 1, "sin ningún celeste, el azul no desaparece de la búsqueda");
assert.equal(esGloboDelTono("GLOBO REDONDO FASHION DURAZNO", "durazno", ["naranja"]), true);
assert.equal(esGloboDelTono("GLOBO REDONDO FASHION NARANJA", "durazno", ["naranja"]), false);
assert.equal(esGloboDelTono("GLOBO REDONDO PASTEL MATE ROSADO", "rosa pastel", ["rosado"]), true);
assert.equal(esGloboDelTono("GLOBO REDONDO REFLEX ROSADO", "rosa pastel", ["rosado"]), false, "el rosado cromado no es rosa pastel");

// ── 4. Nombres: «Celeste» en la propuesta, en los chips del plan y en la cotización ─────────────────────────────────
assert.equal(colorSempertex("celeste").nombre, "Celeste", "antes «Celeste» se pintaba gris (no estaba en la paleta)");
assert.equal(colorSempertex("celeste").hex, "#62b5e5", "con la referencia Sempertex de azul claro (040)");
const conTitulo = colorSempertex("azul", { titulo: "B2b Globo Latex Redondo Fashion Azul Celeste — R-12 / PAQUETE X 12", acabado: "fashion" });
assert.deepEqual(conTitulo, { nombre: "Celeste", hex: "#62b5e5", producto: "Fashion Azul Celeste" }, "el globo celeste guardado como «azul»");
assert.equal(colorSempertex("azul", { titulo: "B2b Globo Latex Redondo Pastel Mate Azul — R-12 / PAQUETE X 50" }).nombre, "Celeste pastel");
assert.equal(colorSempertex("azul", { titulo: "B2b Globo Latex Redondo Reflex Azul — R-12 / PAQUETE X 50" }).nombre, "Azul cromado", "el Reflex Azul sigue siendo azul cromado");
assert.equal(colorSempertex("azul", { titulo: "B2b Globo Latex Redondo Fashion Azul — R-12 / PAQUETE X 50" }).nombre, "Azul", "el Fashion Azul 040 sigue llamándose Azul");
assert.equal(colorSempertex("rosa pastel").nombre, "Rosa pastel");
assert.equal(colorSempertex("durazno").nombre, "Durazno");
assert.equal(tonoDelTitulo("GLOBO REDONDO FASHION AZUL CELESTE"), "celeste");
assert.equal(tonoDelTitulo("GLOBO REDONDO FASHION AZUL CARIBE"), null);

// ── 5. La cotización personal dice el globo que se compra, no la etiqueta de la foto ────────────────────────────────
const NOTA_CARIBE = "B2b Globo Latex Redondo Fashion Azul Caribe — R-12 / PAQUETE X 50 · R-12 · azul celeste";
assert.equal(nombreLineaCliente({ nombre: NOTA_CARIBE }), "Globo azul caribe de 12\"", "antes «Globo azul celeste de 12\"» (la etiqueta de la foto)");
assert.equal(nombreMaterial(NOTA_CARIBE), "Globos azul caribe de 12\"", "«Comprar» y la tarjeta sencilla dicen lo mismo");
assert.equal(nombreLineaCliente({ nombre: "B2b Globo Latex Redondo Infinity® Feliz Dia Mami Flores Fashion Surtido Rosa Silvestre — R-12 / PAQUETE X 12 · R-12 · rosa con «Feliz día Mami»" }), "Globo rosa con «Feliz día Mami» de 12\"", "lo impreso sigue diciéndose");
const columna = bibliotecaVisible().find((idea) => idea.id.startsWith("deco-real-06"));
assert.ok(columna, "la columna arcoíris de la biblioteca real");
const cotizacion = CotizacionGuiadaSchema.parse({
  lineas: columna.materiales.map((material, indice) => ({ id: material.variantId, tamano: "sin tamaño aplicable", ...presentacionMaterialGuiado(material.nota), cantidadNecesaria: material.cantidad, disponible: true, varianteId: material.variantId, precioPaquete: 10_000 + indice, unidadesPaquete: 50, paquetes: 1, subtotal: 10_000 + indice, sobrante: 50 - material.cantidad })),
  total: 60_015, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
});
const html = renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion, decoracion: columna }));
const texto = html.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");
assert.ok(/Azul Caribe de 12"/.test(texto), `la cotización nombra el Azul Caribe: ${texto.slice(0, 400)}`);
assert.ok(!/celeste/i.test(texto), "y no dice «celeste»");
const filaCaribe = /<li[^>]*>(?:(?!<\/li>)[\s\S])*Azul Caribe(?:(?!<\/li>)[\s\S])*<\/li>/.exec(html)?.[0] ?? "";
assert.ok(filaCaribe.includes("#008eaa"), "pintado con el tono del Azul Caribe (038), no con el azul rey de la paleta");
// Sin la idea (plan a medida): el nombre de la línea de Python, por la misma fuente.
const sinIdea = CotizacionGuiadaSchema.parse({ ...cotizacion, lineas: [{ ...cotizacion.lineas[0]!, id: "v1", varianteId: "v1", nombre: "B2b Globo Latex Redondo Fashion Azul Celeste — R-12 / PAQUETE X 12", color: "azul" }], total: 10_000 });
const textoSinIdea = renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion: sinIdea })).replaceAll("&quot;", "\"");
assert.ok(textoSinIdea.includes("Sempertex Fashion Azul Celeste de 12\""), `el celeste del plan se cotiza por su producto: ${textoSinIdea.slice(0, 300)}`);

console.log(`test-colores-claros-guiada: celeste reconocido (taxonomía, propuesta, instrucción, restricción), búsqueda real → ${celestes.length} azules claros (${celestes.map((titulo) => titulo.replace("GLOBO REDONDO ", "")).join(", ")}); nombres «Celeste» y «Azul Caribe» de una sola fuente.`);
