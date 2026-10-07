import { DECORACION_DEMO_COTIZACION } from "./decoracion-demo-cotizacion";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CotizacionGuiadaSchema, ListaMaterialesResultadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { CotizacionPersonalGuiada } from "@/components/guiado/CotizacionPersonalGuiada";
import { CotizacionProfesional } from "@/components/cotizacion/CotizacionProfesional";

const decoracion = DECORACION_DEMO_COTIZACION;
assert.ok(decoracion, "Falta decoración real de demostración.");
const salidaPython = ListaMaterialesResultadoSchema.parse(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test/datos-cotizacion-guiada.ts"], { encoding: "utf8" })));
const cotizacion = CotizacionGuiadaSchema.parse({
  lineas: salidaPython.lineas.map((linea) => ({
    id: linea.variant_id,
    tamano: "sin tamaño aplicable",
    ...presentacionMaterialGuiado(decoracion.materiales.find((material) => material.variantId === linea.variant_id)?.nota),
    cantidadNecesaria: linea.cantidad_necesaria,
    disponible: true,
    varianteId: linea.variant_id,
    precioPaquete: linea.precio_paquete,
    unidadesPaquete: linea.unidades_paquete,
    paquetes: linea.paquetes,
    subtotal: linea.subtotal,
    sobrante: linea.sobrante,
  })),
  total: salidaPython.total,
  mermaPorcentaje: 0,
  incluyeIva: true,
  complementosSoportados: false,
});
const html = renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion }));
const textoHTML = html.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");
const htmlNegocioCerrado = renderToStaticMarkup(createElement(CotizacionProfesional, { cotizacion, clave: "guiado-ej-demo-cotizacion" }));
const borradorAbierto = JSON.stringify({ costos: { mano_de_obra: [{ id: "m1", descripcion: "Montaje", costo: "5000", cantidad: "1" }], equipos_transporte: [], indirectos: [] }, precios: {}, utilidad: "" });
Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: { getItem: () => borradorAbierto } } });
const htmlNegocioAbierto = renderToStaticMarkup(createElement(CotizacionProfesional, { cotizacion, clave: "guiado-ej-demo-cotizacion" }));
const textoNegocio = htmlNegocioAbierto.replaceAll("&quot;", "\"").replaceAll(/\s+/g, " ");

// Uso personal: nombre de cliente («Globo palo de rosa de 12"», formato.ts). Negocio conserva el nombre de catálogo.
for (const texto of [
  "Globo palo de rosa de 12\"",
  "Globo durazno de 12\"",
  "Globo blanco de 12\"",
  "Usas 40 globos",
  "compras 1 paquete de 50",
  "te sobran 10",
  "39.111",
  "Total con IVA",
  "Precio de tienda en línea, IVA incluido. No incluye el montaje.",
  "te sobran 70 para reponer los que se revienten",
]) assert.ok(textoHTML.includes(texto), `Falta texto visible: ${texto}`);
for (const jerga of ["R-12", "variante", "Incluye 0% de reserva"]) assert.equal(textoHTML.includes(jerga), false, `No debe mostrar: ${jerga}`);
assert.match(html, /background-color:#f2a7c3/);
assert.match(html, /background-color:#f28c28/);
assert.match(html, /background-color:#ffffff/);
assert.ok(htmlNegocioCerrado.includes("Ajustar mi precio"));
assert.ok(textoNegocio.includes("Ocultar ajustes"));
for (const nombre of ["Palo de rosa", "Durazno", "Blanco"]) assert.ok(textoNegocio.includes(`Globo de látex 12\" ${nombre}`));
assert.ok(!textoNegocio.includes("R-12") && !textoNegocio.includes("variante"));
console.log(`test-ui-cotizacion-guiada: render real Python personal y negocio; ${cotizacion.lineas.map((linea) => `${linea.nombre}, ${linea.cantidadNecesaria}, ${linea.paquetes}x${linea.unidadesPaquete}, sobra ${linea.sobrante}, ${linea.subtotal}`).join(" | ")}; total ${cotizacion.total}`);
