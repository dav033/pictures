import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resumenHelio } from "../../src/lib/globos3d/helio-cinta";
import { CotizacionTallerV2Schema } from "../../src/lib/taller/cotizacion-taller-tipos";
import { CotizacionProfesionalDesdeTaller, ResumenHelioCotizacion } from "../../src/components/tres-d/CotizacionProfesionalDesdeTaller";

const cotizacion = CotizacionTallerV2Schema.parse({
  schema_version: "taller-cotizacion.v2",
  total: 1_000,
  mermaPorcentaje: 8,
  incluyeIva: true,
  complementosSoportados: false,
  lineas: [{
    id: "variant-1", productId: "product-1", formatoId: "R-12", codigo: "005", tamano: "R-12", tamanoCodigo: "R-12",
    color: "Blanco", nombre: "Globo blanco", cantidad: 10, cantidadNecesaria: 10, disponible: true, reserva: 1,
    varianteId: "variant-1", paquetes: 1, unidadesPaquete: 12, precioPaquete: 1_000, subtotal: 1_000, sobrante: 2,
  }],
  faltantes: [],
});
const helio = resumenHelio([{ globos: Array.from({ length: 2 }, () => ({ formatoId: "R-12", infladoCm: 30, parte: "helio" })), metrosCinta: 2.4 }]);

const heliumHtml = renderToStaticMarkup(h(ResumenHelioCotizacion, { resumen: helio }));
assert.match(heliumHtml, /Helio y cinta/);
assert.match(heliumHtml, /30,3 L/);
assert.match(heliumHtml, /2,4 m/);
assert.match(heliumHtml, /no está incluido porque el catálogo/);

const actualHtml = renderToStaticMarkup(h(CotizacionProfesionalDesdeTaller, { nombre: "Arco", cotizacion, helio, clave: "taller-demo", vigente: true, visor: null, readerEnabled: false, writerEnabled: false }));
assert.match(actualHtml, /Pasar a cotización/);
assert.match(actualHtml, /aria-expanded="false"/);
assert.doesNotMatch(actualHtml, /aviso-cotizacion-taller-desactualizada/);

const viejaHtml = renderToStaticMarkup(h(CotizacionProfesionalDesdeTaller, { nombre: "Arco", cotizacion, helio, clave: "taller-demo", vigente: false, visor: null, readerEnabled: false, writerEnabled: false }));
assert.match(viejaHtml, /data-testid="aviso-cotizacion-taller-desactualizada"/);
assert.match(viejaHtml, /La escena cambió desde esta cotización/);
assert.match(viejaHtml, /disabled=""/);
assert.doesNotMatch(viejaHtml, /data-testid="cotizacion-profesional"/);

console.log("[PASS] la interfaz ofrece pasar a cotización, muestra cantidades de helio sin inventar costo y bloquea una escena desactualizada");
