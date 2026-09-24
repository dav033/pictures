import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { TarjetaCotizacion } from "@/components/TarjetaCotizacion";
import { ReferenceReviewPanel } from "@/components/references/ReferenceReviewPanel";
import { PanelEspacio } from "@/components/referencia/PanelEspacio";
import { vistaAnalisisFoto } from "@/components/referencia/textos-analisis";
import { ubicarEtiquetas } from "@/components/referencia/etiquetas-analisis";
import { lineaQuitable } from "@/lib/plan/presentacion-cliente";
import { idsSinFoto } from "@/lib/estado/imagenes-catalogo";
import { EstadoError, PasosAsistente } from "@/components/propuesta";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { PlanResuelto } from "@/lib/plan/resuelto";

/**
 * Propuesta, detalle, cotización y análisis de foto (iteración 4, maquetas
 * Main, ChatNormal, DetallePieza, Cotizacion, FotoAnalisis, EspacioAnalisis y
 * Estados). Render estático: comprueba qué datos reales llegan al cliente, no
 * la animación. Sin red ni proveedores.
 */

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

function textoVisible(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ");
}

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "eval/ui/plan-resuelto-arco-columnas.json"), "utf8")) as PlanResuelto;

function elemento(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    element_id: id,
    source_image_id: "REF_01",
    name: "element",
    category: "balloon_structure",
    scene_role: "midground",
    detection_confidence: 0.9,
    visible_evidence: "visible",
    reference_bbox: { x: 0.3, y: 0.05, width: 0.4, height: 0.8 },
    depth_layer: 1,
    include_policy: "include",
    approved: true,
    source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: ["white"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "arch", composition: "c" },
    relationships: [],
    uncertainties: [],
    ...overrides,
  };
}

function blueprintDe(elementos: Record<string, unknown>[], paleta: string[] = []): ReferenceBlueprintV2 {
  const resultado = ReferenceBlueprintV2Schema.safeParse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos,
    composition: { focal_point: "arch", density: "dense", symmetry: "symmetric", negative_space: [] },
    palette: { observed: paleta, priority: [] },
    unresolved_decisions: [],
  });
  if (!resultado.success) assert.fail(resultado.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | "));
  return resultado.data;
}

const blueprint = blueprintDe([
  elemento("REF_01_E01", { name: "white and gold balloon arch", appearance: { observed_colors: ["white", "gold chrome"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "tall dense arch, spanning the full width", composition: "c" }, visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "REF_01_E01", density: "media" } }),
  elemento("REF_01_E02", { name: "left balloon column", reference_bbox: { x: 0.02, y: 0.3, width: 0.12, height: 0.65 }, visual_semantics: { structure_type: "columna", placement: "lateral_izquierdo", design_role: "soporte", repetition_group: "REF_01_E02", density: "media" } }),
  elemento("REF_01_E03", { name: "flowers", category: "floral", scene_role: "accent" }),
], ["white", "gold chrome"]);

// 1. Propuesta basada en la foto: recortes reales por pieza, chip "Basada en tu foto".
{
  const plan: PlanResuelto = structuredClone(fixture);
  plan.plan.estructuras[0]!.referencia_element_id = "REF_01_E01";
  plan.plan.estructuras[1]!.referencia_element_id = "REF_01_E02";
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan, referenceBlueprint: blueprint, imagenesReferencia: [{ base64: PIXEL, mime: "image/png" }], onAprobar: () => undefined }));
  const texto = textoVisible(html);
  assert.match(texto, /Basada en tu foto/);
  assert.match(texto, /2 de 2 piezas incluidas/);
  assert.match(html, /alt="Arco de tu foto de referencia, centro"/, "el arco muestra su recorte de la foto");
  assert.match(html, /alt="Columna de tu foto de referencia, ambos lados"/);
  assert.equal((html.match(/src="data:image\/png;base64,/g) ?? []).length >= 3, true, "miniatura y recortes usan la foto local, sin pedir nada");
  assert.match(texto, /Arco Centro · 3 × 2,5 m/);
  assert.match(texto, /2 columnas Ambos lados · 0,6 × 2 m/);
  assert.match(texto, /unos 123 globos/);
  assert.match(texto, /En la imagen también pondré Flores · no se cotizan/);
  assert.match(texto, /\$ 116\.873/);
  assert.match(texto, /COP · dentro de tu presupuesto/);
  assert.match(texto, /Aprobar y ver cómo queda/, "texto del botón de la maqueta Main");
  assert.doesNotMatch(texto, /Globos que usaré/, "con fotos de la referencia no se repite la grilla de productos");
  // Detalle de estructura (maqueta DetallePieza).
  assert.match(texto, /Arco al centro 3 m de ancho × 0,5 m de fondo × 2,5 m de alto · unos 123 globos/);
  assert.match(texto, /Ancho 3 m Alto 2,5 m Fondo 0,5 m Globos unos 123/);
  assert.match(texto, /Mezcla de tamaños/);
  assert.match(texto, /Globos que lleva/);
  // Importe exacto de `costes_por_estructura`, que firma Python. Con un `[\d.]+` suelto,
  // reintroducir el reparto de paquetes en React pasaba desapercibido.
  assert.match(texto, /Esta pieza suma unos \$ 58\.334/);
  assert.match(texto, /Marco focal impactante/, "la explicación (porque) va en el detalle");
  ok("propuesta con foto: recortes por pieza, contadores, ambientación y detalle con datos reales");
}

// 1b. Foto del turno que no enlaza con ninguna estructura del plan: sin chip ni recortes, fotos de producto.
{
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: fixture, referenceBlueprint: blueprint, imagenesReferencia: [{ base64: PIXEL, mime: "image/png" }] }));
  const texto = textoVisible(html);
  assert.doesNotMatch(texto, /Basada en tu foto|0 de 2 piezas/, "sin piezas enlazadas no se dice que se basa en la foto");
  assert.doesNotMatch(html, /de tu foto de referencia/, "sin recortes");
  assert.match(texto, /Globos que usaré/);
  ok("foto sin piezas enlazadas: sin chip ni recortes");
}

// 1c. D7 del E2E real: "Quitar" solo donde la estructura conserva un material.
{
  const plan: PlanResuelto = structuredClone(fixture);
  const columnas = plan.plan.estructuras[1]!;
  columnas.materiales = [{ ...columnas.materiales[0]!, participacion: 1 }];
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
  const quitar = [...html.matchAll(/aria-label="Quitar ([^"]+)"/g)].map((m) => m[1]!);
  const modificar = [...html.matchAll(/aria-label="Modificar ([^"]+)"/g)].length;
  const lineasArco = new Set(plan.estructuras[0]!.lineas.map((linea) => linea.variant_id)).size;
  assert.equal(quitar.length, lineasArco, "el arco (2 materiales) ofrece Quitar en cada línea; las columnas (1 material) en ninguna");
  assert.ok(modificar > quitar.length, "Modificar sigue disponible en las líneas sin Quitar");
  const unaLinea = lineaQuitable({ product_id: "p", variant_id: "v", color: "rosa" }, [{ product_id: "p", variant_id: "v", color: "rosa" }], [{ product_id: "p", color: "rosa" }, { product_id: "q", color: "azul" }]);
  assert.equal(unaLinea, false, "una sola línea visible: sin Quitar");
  assert.equal(lineaQuitable({ product_id: "p", variant_id: "v", color: "rosa", quitable: true }, [], undefined), true, "la marca explícita del backend manda");
  assert.equal(lineaQuitable({ product_id: "z", variant_id: "v", color: "rosa" }, [{ product_id: "z", variant_id: "v", color: "rosa" }, { product_id: "q", variant_id: "w", color: "azul" }], [{ product_id: "p", color: "rosa" }, { product_id: "q", color: "azul" }]), false, "línea sin material editable: sin Quitar");
  ok("Quitar oculto cuando la estructura quedaría sin material");
}

// 2. Propuesta sin foto (maqueta ChatNormal): chips de estructura y fotos reales de producto.
{
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: fixture }));
  const texto = textoVisible(html);
  assert.doesNotMatch(texto, /Basada en tu foto/);
  assert.match(texto, /Globos que usaré/);
  assert.match(html, /src="https:\/\/cdn\.shopify\.com\/[^"]*R12_Blanco[^"]*"/, "foto real del catálogo");
  assert.match(texto, /Globo Latex Redondo Fashion Blanco 122 globos · 5, 9, 12 y 18 pulgadas/);
  assert.doesNotMatch(html, /IVBORw0KGgo/, "sin referencia no hay recortes");
  ok("propuesta sin foto: estructuras y productos reales del catálogo");
}

// 3. Cotización sin plan con el mismo estilo.
{
  const cotizacion: Cotizacion = {
    lineas: [
      { id: "v1", tamano: "R-12", tamanoCodigo: "R-12", color: "rosado", cantidadNecesaria: 64, disponible: true, nombre: "B2b Globo Latex Redondo Fashion Rosa — R-12 / PAQUETE X 50", precioPaquete: 19200, unidadesPaquete: 50, paquetes: 2, subtotal: 38400, sobrante: 36, foto: "https://cdn.shopify.com/rosa.jpg" },
      { id: "sin-ref-1", tamano: "R-18", color: "lila", cantidadNecesaria: 5, disponible: false, sinReferencia: true },
    ],
    total: 38400,
    mermaPorcentaje: 8,
    incluyeIva: true,
    complementosSoportados: false,
  };
  const texto = textoVisible(renderToStaticMarkup(React.createElement(TarjetaCotizacion, { cotizacion, editable: true, onAplicar: () => undefined })));
  assert.match(texto, /Globo Latex Redondo Fashion Rosa 12 pulgadas · rosado/);
  assert.match(texto, /Necesitas 64/);
  assert.match(texto, /2 paquetes de 50 sobran 36/);
  assert.match(texto, /\$ 38\.400/);
  assert.match(texto, /Total con IVA/);
  assert.match(texto, /18 pulgadas · lila · todavía no está disponible/);
  assert.doesNotMatch(texto, /R-\d|B2b|PAQUETE/, "sin códigos de catálogo");
  ok("cotización sin plan: necesitas, paquetes, sobrantes y precio sin códigos");
  // D9: una línea con foto la usa; las que no la traen se piden al catálogo por variant_id (una vez cada una).
  assert.match(renderToStaticMarkup(React.createElement(TarjetaCotizacion, { cotizacion })), /src="https:\/\/cdn\.shopify\.com\/rosa\.jpg"/);
  assert.deepEqual(idsSinFoto([
    { varianteId: "v1", foto: "https://cdn.shopify.com/rosa.jpg" },
    { varianteId: "v2" },
    { varianteId: "v2" },
    { varianteId: "v3", sinReferencia: true },
    {},
  ]), ["v2"]);
  ok("cotización: foto propia o foto del catálogo por variante");
}

// 4. Análisis de la foto de referencia (FotoAnalisis, hallazgo #17).
{
  const imagen = { base64: PIXEL, mime: "image/png" };
  const analizando = textoVisible(renderToStaticMarkup(React.createElement(ReferenceReviewPanel, { references: [imagen], blueprint: null, status: "analyzing", error: null })));
  assert.match(analizando, /Estoy mirando tu foto/);

  const listo = textoVisible(renderToStaticMarkup(React.createElement(ReferenceReviewPanel, { references: [imagen], blueprint, status: "ready", error: null })));
  assert.match(listo, /Veo un arco al centro y una columna a la izquierda\./);
  assert.match(listo, /1 Arco centro/);
  assert.match(listo, /2 Columna izquierda/);
  assert.match(listo, /Blanco/);
  assert.match(listo, /Dorado/);
  assert.match(listo, /Flores/);
  assert.doesNotMatch(listo, /\bListo\b/);

  const soloFlores = blueprintDe([elemento("REF_01_E01", { name: "roses", category: "floral", scene_role: "accent" })], ["pink"]);
  const sinGlobos = textoVisible(renderToStaticMarkup(React.createElement(ReferenceReviewPanel, { references: [imagen], blueprint: soloFlores, status: "ready", error: null, onElegirEjemplo: () => undefined })));
  assert.match(sinGlobos, /No veo decoración con globos en esta foto/);
  assert.match(sinGlobos, /te preguntaré qué piezas quieres/);
  assert.match(sinGlobos, /Elegir una foto de ejemplo/);
  assert.doesNotMatch(sinGlobos, /\bListo\b|\bVeo un/);

  const vacio = blueprintDe([elemento("REF_01_E01", { name: "lights", category: "lighting", scene_role: "lighting", approved: false, include_policy: "ask" })]);
  const vistaVacia = vistaAnalisisFoto("listo", vacio);
  assert.equal(vistaVacia.caso, "sin_elementos", "una foto sin nada aprobado no es 'Listo'");

  const error = textoVisible(renderToStaticMarkup(React.createElement(ReferenceReviewPanel, { references: [imagen], blueprint: null, status: "error", error: "No pude revisar la foto.", onReintentar: () => undefined })));
  assert.match(error, /No pude mirar bien tu foto No pude revisar la foto\. Reintentar/);
  ok("análisis de foto: escaneo, piezas numeradas, sin globos, sin elementos y reintento");
}

// 4b. D6 del E2E real (ejemplo-07 a 1440 px): recuadros cruzados no tapan sus etiquetas.
{
  const cajas = [
    { x: 0.21, y: 0, width: 0.79, height: 0.82 },
    { x: 0.29, y: 0.55, width: 0.5, height: 0.3 },
    { x: 0.44, y: 0.51, width: 0.26, height: 0.48 },
  ];
  const caracteres = ["Arco asimétrico centro", "Bouquet de globos piso, al frente", "Bouquet de globos piso, al frente"].map((texto) => texto.length);
  for (const tamano of [{ ancho: 739, alto: 480 }, { ancho: 368, alto: 239 }]) {
    const posiciones = ubicarEtiquetas(cajas.map((bbox, indice) => ({ bbox, caracteres: caracteres[indice]! })), tamano);
    const alto = 38 / tamano.alto;
    const anchos = caracteres.map((n, indice) => Math.min(posiciones[indice]!.anchoMaximo, (44 + n * 7.2) / tamano.ancho));
    for (let a = 0; a < posiciones.length; a += 1) {
      const pa = posiciones[a]!;
      assert.ok(pa.inferior - alto >= -1e-9 && pa.inferior <= 1 + 1e-9, `etiqueta ${a + 1} dentro de la foto`);
      for (let b = a + 1; b < posiciones.length; b += 1) {
        const pb = posiciones[b]!;
        const cruzanX = pa.izquierda < pb.izquierda + anchos[b]! && pb.izquierda < pa.izquierda + anchos[a]!;
        const cruzanY = pa.inferior - alto < pb.inferior && pb.inferior - alto < pa.inferior;
        assert.ok(!(cruzanX && cruzanY), `a ${tamano.ancho} px la etiqueta ${b + 1} no tapa la ${a + 1}`);
      }
    }
  }
  const sola = ubicarEtiquetas([{ bbox: { x: 0.3, y: 0.05, width: 0.4, height: 0.8 }, caracteres: 10 }]);
  assert.equal(sola.length, 1);
  assert.equal(sola[0]!.izquierda, 0.3);
  assert.ok(Math.abs(sola[0]!.inferior - 0.85) < 1e-9, "sin cruces la etiqueta sigue abajo a la izquierda de su recuadro");
  ok("análisis de foto: etiquetas de recuadros cruzados sin solaparse");
}

// 5. Foto del espacio (EspacioAnalisis, D2 del E2E real): nunca afirma haber medido.
{
  const foto = { base64: PIXEL, mime: "image/png" };
  const render = (espacio: Record<string, unknown>) => textoVisible(renderToStaticMarkup(React.createElement(PanelEspacio, { foto, espacio: espacio as never })));
  const supuesto = render({ tipo: "salón", ancho_m: 5, alto_m: 3, fuente: "supuesto" });
  assert.doesNotMatch(supuesto, /≈/, "medidas supuestas no se dibujan sobre la foto");
  assert.match(supuesto, /Medidas estimadas para la propuesta: unos 5 m de ancho y 3 m de alto\. Confírmalas o dime las reales\./);
  // Caso real del E2E: salón enorme, "3 × 3 × 2,5 m" con fuente "foto" y sin marca de medida real.
  const deFotoSinMarca = render({ tipo: "salón", ancho_m: 3, largo_m: 3, alto_m: 2.5, fuente: "foto" });
  assert.doesNotMatch(deFotoSinMarca, /Medí|≈/, "fuente foto sin marca del backend: estimadas, no medidas");
  assert.match(deFotoSinMarca, /Medidas estimadas para la propuesta: unos 3 m de ancho, 3 m de largo y 2,5 m de alto\. Confírmalas o dime las reales\./);
  // Contrato de fix-backend: solo "cliente" son medidas reales; ninguna marca convierte "foto" en medido.
  const conMarca = render({ tipo: "salón", ancho_m: 6, alto_m: 3, fuente: "foto", medidas_verificadas: true });
  assert.doesNotMatch(conMarca, /≈/);
  assert.match(conMarca, /Medidas estimadas para la propuesta: unos 6 m de ancho y 3 m de alto\./);
  const cliente = render({ tipo: "salón", ancho_m: 4, fuente: "cliente" });
  assert.match(cliente, /Usé las medidas que me diste: 4 m de ancho\./);
  assert.doesNotMatch(cliente, /≈/);
  const sinMedidas = render({ tipo: "salón", fuente: "foto" });
  assert.doesNotMatch(sinMedidas, /\d+ m|Medí/);
  for (const texto of [supuesto, deFotoSinMarca, conMarca, cliente, sinMedidas]) assert.doesNotMatch(texto, /\bMed[íi]\b/, "nunca «Medí»");
  ok("foto del espacio: medidas estimadas marcadas como tales; reales solo si las dio el cliente");
}

// 6. Contrato con ui-shell: pasos del asistente y estados de error.
{
  const pasos = textoVisible(renderToStaticMarkup(React.createElement(PasosAsistente, { pasos: [{ id: "a", texto: "Busqué globos azules", estado: "listo" }, { id: "b", texto: "Armando la propuesta", estado: "en_curso" }] })));
  assert.match(pasos, /Busqué globos azules \(listo\) Armando la propuesta \(en curso\)/);
  const estado = textoVisible(renderToStaticMarkup(React.createElement(EstadoError, { titulo: "Tu propuesta está lista, pero la imagen no se puede crear ahora", mensaje: "Tu propuesta y su precio quedan guardados.", tono: "aviso", accion: { texto: "Intentar más tarde", onClick: () => undefined } })));
  assert.match(estado, /Tu propuesta está lista.*Tu propuesta y su precio quedan guardados\. Intentar más tarde/);
  ok("PasosAsistente y EstadoError");
}

console.log(`\n${casos} casos OK (propuesta, cotización y análisis de foto)`);
