/**
 * D-038: lo que la lista de una idea pide y el precio no cuenta (un globo impreso que el cruce con la tienda no conoce) se dice
 * junto al total en la tarjeta «¿Cuánto cuesta?» de la vista guiada, con las mismas palabras que lee el modelo; sin nada fuera
 * del precio, o sin precio, no hay nota. Sin red ni Python.
 *
 *   npx tsx scripts/test/test-ui-nota-no-incluidos.ts
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostosMateriales } from "@/components/guiado/CostosMateriales";
import { claveDeWidget, recordarNota, type NotasNoIncluidos } from "@/components/guiado/useNoIncluidos";
import { CotizacionGuiadaSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { notaNoIncluidos } from "@/lib/guiada-motor/no-incluidos";

const cotizacion = CotizacionGuiadaSchema.parse({
  lineas: [{ id: "v1", tamano: "R-12", nombre: "Globo de látex 12\" Blanco", cantidadNecesaria: 40, disponible: true, varianteId: "v1", precioPaquete: 12000, unidadesPaquete: 50, paquetes: 1, subtotal: 12000, sobrante: 10 }],
  total: 12000, mermaPorcentaje: 8, incluyeIva: true, complementosSoportados: false,
});
const noIncluidos = [{ nombre: "Globo de látex 12\" impreso para bautizo", cantidad: 20 }];
const props = { cotizacion, uso: "personal", clave: "nota-no-incluidos", onProveedores: () => undefined, mensajePendiente: "pendiente" } as const;
const textoDe = (marcado: string) => marcado.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");

const conNota = textoDe(renderToStaticMarkup(createElement(CostosMateriales, { ...props, noIncluidos })));
assert.ok(conNota.includes(notaNoIncluidos(noIncluidos)!), `la tarjeta repite la nota del modelo: ${conNota}`);
assert.ok(conNota.includes("No incluido en el precio: 20 × Globo de látex 12\" impreso para bautizo."));
assert.ok(conNota.includes("nota-no-incluidos-cotizacion") && conNota.indexOf("No incluido en el precio") < conNota.indexOf("Materiales para tu decoración"), "la nota va encima de los materiales y el total");
assert.equal(textoDe(renderToStaticMarkup(createElement(CostosMateriales, props))).includes("No incluido en el precio"), false, "sin nada fuera del precio no hay nota");
assert.equal(textoDe(renderToStaticMarkup(createElement(CostosMateriales, { ...props, noIncluidos: [] }))).includes("No incluido en el precio"), false, "una lista vacía tampoco");
assert.equal(textoDe(renderToStaticMarkup(createElement(CostosMateriales, { ...props, cotizacion: null, noIncluidos }))).includes("No incluido en el precio"), false, "sin precio no hay nota de lo que queda fuera de él");
// La nota es de UNA tarjeta, no de la idea: preguntar dos veces cuánto cuesta la misma idea deja dos tarjetas, cada una con lo que su costeo dejó fuera.
const primeraTarjeta = claveDeWidget("mensaje-1", 2);
const segundaTarjeta = claveDeWidget("mensaje-2", 1);
assert.notEqual(primeraTarjeta, segundaTarjeta);
assert.equal(claveDeWidget("mensaje-1", 2), "mensaje-1-2", "la misma clave con la que VistaGuiada pinta el widget (`key`)");
let notas: NotasNoIncluidos = recordarNota({}, primeraTarjeta, noIncluidos);
const alPreguntarOtraVez = recordarNota(notas, segundaTarjeta, undefined);
assert.deepEqual(alPreguntarOtraVez[primeraTarjeta], noIncluidos, "un segundo costeo de la misma idea sin nada fuera NO borra la nota de la primera tarjeta");
assert.equal(alPreguntarOtraVez[segundaTarjeta], undefined);
assert.equal(recordarNota(notas, segundaTarjeta, undefined), notas, "sin nada que recordar ni olvidar el estado no cambia (no vuelve a pintar)");
const otraNota = [{ nombre: "Cortina de foil dorada", cantidad: 2 }];
notas = recordarNota(notas, segundaTarjeta, otraNota);
assert.deepEqual([notas[primeraTarjeta], notas[segundaTarjeta]], [noIncluidos, otraNota], "un segundo costeo con otra nota no reescribe la primera");
assert.deepEqual(recordarNota(notas, primeraTarjeta, undefined)[segundaTarjeta], otraNota, "olvidar la nota de una tarjeta deja la de la otra");
const dosTarjetas = [primeraTarjeta, segundaTarjeta].map((clave) => textoDe(renderToStaticMarkup(createElement(CostosMateriales, { ...props, noIncluidos: notas[clave] }))));
assert.ok(dosTarjetas[0]!.includes("20 × Globo de látex 12\" impreso para bautizo") && !dosTarjetas[0]!.includes("Cortina de foil dorada"), "la primera tarjeta dice lo suyo");
assert.ok(dosTarjetas[1]!.includes("2 × Cortina de foil dorada") && !dosTarjetas[1]!.includes("impreso para bautizo"), "y la segunda lo suyo");

// El cableado de la vista (un test de render no ve VistaGuiada entera): la nota se guarda y se lee por la clave del widget, nunca por el id de la idea.
const vista = readFileSync(path.join(__dirname, "..", "..", "src", "components", "guiado", "VistaGuiada.tsx"), "utf8");
assert.ok(vista.includes("registrarNoIncluidos(claveDeWidget(idAsistente, widgets.length - 1), datos.noIncluidos)"), "se guarda con la clave del widget recién agregado");
assert.ok(vista.includes("noIncluidos={noIncluidos[clave]}"), "se lee con la clave con la que se pinta");
assert.ok(!/noIncluidos\[widget\.decoracion\.id\]|registrarNoIncluidos\(elegida\.id/.test(vista), "ya no se guarda ni se lee por la idea");
assert.ok(vista.includes("renderWidget(widget, activo, claveDeWidget(mensaje.id, posicion), mensaje, indice)"), "la clave que se pinta sale del mismo ayudante");

console.log("test-ui-nota-no-incluidos: ok");
