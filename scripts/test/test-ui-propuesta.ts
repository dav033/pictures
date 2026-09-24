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
import { EstadoError, PasosAsistente } from "@/components/propuesta/index";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { ControlesPatron, GaleriaEstilos, GraficaPatron, HojaArmado, leyendaPatron, ResumenPatron } from "@/components/plan/patron";
import { conPintado, editar, enPropuesta, patronDeEstilo, pintadosPendientes } from "@/components/plan/patron/borrador";
import { admitePatron, MODOS_POR_TIPO } from "@/components/plan/patron/modos";
import { FalloPlanPatron, MENSAJE_PATRON_INVALIDO, pedirPlanEditarPatron, pedirVistaPatron } from "@/lib/plan/peticion-patron";
import { FalloPlanEditar, mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { PatronColorResueltoSchema, type PatronColor, type PatronColorResuelto } from "@/lib/plan/patron-color";

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
  // 2026-09-24: on a 245 px phone photo "Columna orgánica derecha" was cut to
  // "Colu… d…". The name keeps its width and the place goes only if it fits.
  const pieza = { bbox: { x: 0.45, y: 0.2, width: 0.3, height: 0.7 }, caracteres: "Columna orgánica".length, caracteresExtra: "derecha".length + 2 };
  const movil = ubicarEtiquetas([pieza], { ancho: 245, alto: 380 })[0]!;
  assert.ok(movil.anchoMaximo * 245 >= 44 + pieza.caracteres * 7.2, "en móvil el nombre completo cabe");
  assert.equal(movil.conExtra, false, "en móvil la ubicación se omite antes que cortar el nombre");
  assert.ok(movil.izquierda + movil.anchoMaximo <= 1 + 1e-9, "la etiqueta no se sale de la foto");
  assert.equal(ubicarEtiquetas([pieza], { ancho: 739, alto: 480 })[0]!.conExtra, true, "con espacio, nombre y ubicación");
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

// 7. Patrón de color por estructura (ADR-0028 §13). Fixtures de
// scripts/fixtures/patron-color-ui: planes resueltos por el resolvedor de
// Python (`resolve_plan` con un catálogo de prueba) y vistas previas de
// `patron_resuelto_de_estructura`. La UI solo los dibuja; si Python cambia sus
// textos o su rejilla, se regeneran las fixtures, no estas expectativas a mano.
const planPatrones = JSON.parse(readFileSync(resolve(process.cwd(), "scripts/fixtures/patron-color-ui/plan-con-patrones.json"), "utf8")) as PlanResuelto;
for (const patron of planPatrones.patrones_color ?? []) PatronColorResueltoSchema.parse(patron);
const resueltoDe = (id: string): PatronColorResuelto => planPatrones.patrones_color!.find((patron) => patron.estructura_id === id)!;
const estructuraDe = (id: string) => planPatrones.estructuras.find((estructura) => estructura.estructura_id === id)!;
const declaradaDe = (id: string) => planPatrones.plan.estructuras.find((estructura) => estructura.estructura_id === id)!;
const leyendaDe = (id: string) => leyendaPatron(declaradaDe(id).materiales, estructuraDe(id).lineas);

// 7a. La tarjeta: bloque "Patrón de color" en el detalle, tira del patrón en el resumen y editor cerrado.
{
  const html = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planPatrones, onPlanActualizado: () => undefined, onAprobar: () => undefined }));
  const texto = textoVisible(html);
  assert.equal((html.match(/data-testid="bloque-patron"/g) ?? []).length, 3, "las tres piezas con patrón aplicado muestran su bloque");
  assert.match(texto, /Patrón de color Espiral Cuartetos iguales de blanco \(1\), negro \(2\)/, "nombre y descripción de Python");
  assert.match(texto, /Patrón de color Flores/);
  assert.match(texto, /Patrón de color Degradé Degradé en diagonal/);
  assert.match(texto, /1 Blanco mate 48 · 50 % 2 Negro mate 24 · 25 % 3 Azul cromado 24 · 25 %/, "conteo de Python con la leyenda numerada");
  assert.match(texto, /Total de las 2 piezas iguales/);
  assert.match(texto, /Con cuartetos completos cada pieza lleva 48 globos; las medidas daban 47\./, "el bloque muestra los avisos de Python");
  assert.equal((html.match(/data-testid="editar-patron"/g) ?? []).length, 3);
  assert.equal((html.match(/data-testid="abrir-hoja-armado"/g) ?? []).length, 3);
  assert.equal((html.match(/data-testid="crear-patron"/g) ?? []).length, 1, "la guirnalda sin patrón ofrece crearlo");
  assert.equal((html.match(/Arrastra para cambiar cuánto lleva de cada color/g) ?? []).length, 1, "el reparto por deslizador solo queda donde no manda un patrón");
  assert.match(html, /aria-label="Patrón espiral"/, "la tarjeta de resumen muestra la tira del patrón");
  assert.match(html, /aria-label="Patrón flores"/);
  assert.match(html, /inert=""[^]*data-testid="bloque-patron"/, "el bloque vive en el detalle cerrado (inert)");
  assert.doesNotMatch(html, /role="dialog"|data-testid="editor-patron"|data-testid="dialogo-hoja-armado"/, "editor y hoja cerrados no se montan");
  assert.match(texto, /Aprobar y ver cómo queda/, "sin edición no se habla de regenerar");
  assert.doesNotMatch(texto, /Regenerar visual/);
  ok("tarjeta con patrón: bloque, conteo, tira en el resumen y editor cerrado");

  const sinPatrones = textoVisible(renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: fixture })));
  assert.doesNotMatch(sinPatrones, /Patrón de color/, "sin patrones ni edición no hay bloque");
  const editable = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: fixture, onPlanActualizado: () => undefined }));
  assert.equal((editable.match(/data-testid="crear-patron"/g) ?? []).length, 2, "editable: cada pieza geométrica con dos colores ofrece crear su patrón");
  ok("tarjeta sin patrones: sin bloque o con la invitación a crearlo");
}

// 7b. Gráfica numerada: base abajo, número = color, y en edición una rejilla ARIA con foco itinerante.
{
  const resuelto = resueltoDe("EST_01_COLUMNA");
  const base = { resuelto, leyenda: leyendaDe("EST_01_COLUMNA"), tipo: "columna" };
  const estatica = renderToStaticMarkup(React.createElement(GraficaPatron, base));
  const filas = [...estatica.matchAll(/<li aria-label="([^"]+)"/g)].map((fila) => fila[1]!);
  assert.equal(filas.length, 12);
  assert.equal(filas[0], "Racimo 12: Blanco mate, Negro mate, Blanco mate, Azul cromado", "la columna se lee de arriba hacia la base");
  assert.equal(filas[11], "Racimo 1: Blanco mate, Negro mate, Blanco mate, Azul cromado");
  assert.match(textoVisible(estatica), /Arriba 12 1 2 1 3 11 1 2 1 3 [^]* 1 1 2 1 3 Base/);
  const editable = renderToStaticMarkup(React.createElement(GraficaPatron, { ...base, pincel: { material: 2, alcance: "globo" }, onPintar: () => undefined }));
  assert.match(editable, /role="grid"/);
  assert.match(editable, /aria-label="Racimo 3, posición 2: Negro mate"/);
  assert.match(editable, /aria-label="Pintar racimo 3 completo de Azul cromado"/);
  assert.equal((editable.match(/tabindex="0"/g) ?? []).length, 1, "un solo globo entra con Tab; las flechas mueven el resto");
  const flores = textoVisible(renderToStaticMarkup(React.createElement(GraficaPatron, { resuelto: resueltoDe("EST_02_ARCO"), leyenda: leyendaDe("EST_02_ARCO"), tipo: "arco" })));
  assert.match(flores, /^ Pie izquierdo 1 1 1 1 1/, "el arco empieza en el pie izquierdo");
  assert.match(renderToStaticMarkup(React.createElement(GraficaPatron, { resuelto: resueltoDe("EST_02_ARCO"), leyenda: leyendaDe("EST_02_ARCO"), tipo: "arco" })), /aria-label="Racimo 5: Rosado mate, Rosado mate, Rosado mate, Rosado mate, centro Amarillo mate"/, "el centro de la flor es un globo extra del racimo");
  ok("gráfica numerada: orden de armado, números de la leyenda y rejilla accesible");
}

// 7c. Hoja de armado: paso a paso de `pasos`, instrucciones y conteos por color y por tamaño.
{
  const hoja = (id: string) => renderToStaticMarkup(React.createElement(HojaArmado, { resuelto: resueltoDe(id), leyenda: leyendaDe(id), estructura: estructuraDe(id), declarada: declaradaDe(id), tituloPlan: planPatrones.plan.concepto.titulo }));
  const columna = textoVisible(hoja("EST_01_COLUMNA"));
  assert.match(columna, /Hoja de armado · Baby shower azul, blanco y flores/);
  assert.match(columna, /2 piezas iguales · 12 racimos de 4 globos \(cuarteto\) · 48 globos por pieza/);
  assert.match(columna, /Paso a paso Racimos 1–12 1 · 2 · 1 · 3 × 12 racimos/);
  assert.match(columna, /Consejos de armado Infla cada globo con el calibrador/);
  assert.match(columna, /Blanco mate 24 48 2 Negro mate 12 24 3 Azul cromado 12 24/, "por pieza y total de las dos columnas");
  assert.match(columna, /12″ 48 24 24 96/, "globos por tamaño salen de las líneas resueltas");
  const arco = hoja("EST_02_ARCO");
  assert.match(textoVisible(arco), /Racimos 1–3 1 · 1 · 1 · 1 × 3 racimos Racimo 4 2 · 2 · 2 · 2 Racimo 5 2 · 2 · 2 · 2 centro 3/);
  assert.match(arco, /aria-label="Rosado mate, Rosado mate, Rosado mate, Rosado mate, y al centro Amarillo mate"/);
  ok("hoja de armado: paso a paso, consejos y conteos");
}

// 7d. Controles del editor: la galería respeta los modos de cada tipo y la espiral muestra su racimo.
{
  const controles = (id: string, tipo: string, geometria: "racimos" | "rejilla") => textoVisible(renderToStaticMarkup(React.createElement(ControlesPatron, {
    patron: declaradaDe(id).patron_color!,
    leyenda: leyendaDe(id),
    tipo,
    geometria,
    contexto: { participaciones: declaradaDe(id).materiales.map((material) => material.participacion ?? 0), globosPorRacimo: 4 },
    onCambiar: () => undefined,
  })));
  const pared = controles("EST_03_PARED", "pared", "rejilla");
  assert.match(pared, /Damero/);
  assert.match(pared, /Degradé diagonal/);
  assert.doesNotMatch(pared, /Flores|Espiral|Globos por racimo/, "la pared no ofrece modos de racimo");
  assert.match(pared, /Por filas Por columnas En diagonal/);
  const columna = controles("EST_01_COLUMNA", "columna", "racimos");
  assert.match(columna, /Espiral .*Zig-zag .*Franjas rectas .*Anillos .*Bloques .*Degradé .*Confeti .*Flores/);
  assert.doesNotMatch(columna, /Damero|Degradé diagonal|Simetría espejo/);
  assert.match(columna, /Posición 1 .*Posición 2 .*Posición 3 .*Posición 4/);
  assert.match(columna, /4 · cuarteto/);
  assert.match(controles("EST_02_ARCO", "arco", "racimos"), /Simetría espejo/);
  ok("controles del editor: estilos por tipo, racimo de la espiral y espejo solo en arcos");

  // Sin borrador (Python no pudo sugerir): la galería entera, ninguna ficha activa, para empezar por un estilo.
  const galeria = renderToStaticMarkup(React.createElement(GaleriaEstilos, { patron: null, tipo: "guirnalda", contexto: { participaciones: [0.5, 0.49, 0.01], globosPorRacimo: 4 }, onCambiar: () => undefined }));
  assert.match(textoVisible(galeria), /Elige uno para empezar tu patrón/);
  assert.equal((galeria.match(/aria-pressed="false"/g) ?? []).length, 8, "las ocho fichas de la guirnalda, sin ninguna elegida");
  assert.doesNotMatch(galeria, /aria-pressed="true"/);
  ok("galería sin borrador: se puede empezar por un estilo cuando la sugerencia falla");
}

// 7d'. Adaptador temporal de modos.ts: refleja `_MODOS_POR_TIPO` de Python (el
// dueño). Se lee de patron_color.py para que la tabla no quede atrás en silencio.
{
  const fuente = readFileSync(resolve(process.cwd(), "services/ai-api/app/patron_color.py"), "utf8");
  const cadenas = (texto: string) => [...texto.matchAll(/"([a-z_]+)"/g)].map((cadena) => cadena[1]!);
  const tuplas = new Map([...fuente.matchAll(/^(_?[A-Z][A-Z_]*)(?::[^=\n]+)? = \(([^)]*)\)/gm)].map(([, nombre, cuerpo]) => [nombre!, cadenas(cuerpo!)]));
  const tabla = /^_MODOS_POR_TIPO(?::[^=\n]+)? = \{([^}]*)\}/m.exec(fuente);
  assert.ok(tabla, "patron_color.py ya no define _MODOS_POR_TIPO como un dict literal: actualiza esta prueba y el adaptador de modos.ts");
  const python: Record<string, string[]> = {};
  for (const [, tipo, valor] of tabla[1]!.matchAll(/"([a-z_]+)":\s*(\([^)]*\)|[A-Za-z_]+)/g)) {
    const modos = valor!.startsWith("(") ? cadenas(valor!) : tuplas.get(valor!);
    assert.ok(modos, `no encontré la tupla ${valor} en patron_color.py`);
    python[tipo!] = [...modos].sort();
  }
  assert.ok(Object.keys(python).length >= 6, "la tabla de Python se leyó entera");
  const typescript = Object.fromEntries(Object.entries(MODOS_POR_TIPO).map(([tipo, modos]) => [tipo, [...modos].sort()]));
  assert.deepEqual(typescript, python, "MODOS_POR_TIPO (modos.ts) debe ser _MODOS_POR_TIPO (patron_color.py)");
  assert.equal(admitePatron("columna", 2), true);
  assert.equal(admitePatron("columna", 1), false, "un solo material no lleva patrón");
  assert.equal(admitePatron("backdrop", 3), false, "un tipo sin geometría no lleva patrón");
  ok("modos por tipo del editor: iguales a los de Python");
}

// 7e. Borrador declarativo: pintar reemplaza lo pintado antes y un estilo nuevo conserva lo que sirve.
{
  const espiral = declaradaDe("EST_01_COLUMNA").patron_color!;
  const unGlobo = conPintado(espiral, { fila: 2, columna: 1, material: 2 });
  const otraVez = conPintado(unGlobo, { fila: 2, columna: 1, material: 0 });
  assert.deepEqual(otraVez.pintados, [{ fila: 2, columna: 1, material: 0 }], "repintar el mismo globo no acumula");
  const racimo = conPintado(conPintado(otraVez, { fila: 3, columna: 0, material: 1 }), { fila: 2, material: 1 });
  assert.deepEqual(racimo.pintados, [{ fila: 3, columna: 0, material: 1 }, { fila: 2, material: 1 }], "pintar el racimo entero reemplaza sus globos pintados");
  assert.equal(racimo.origen, "decorador");
  const zigzag = patronDeEstilo("zigzag", espiral, { participaciones: [0.5, 0.25, 0.25], globosPorRacimo: 4 });
  assert.deepEqual(zigzag.base, { modo: "espiral", racimo: [0, 1, 0, 2], trazo: "zigzag" }, "el racimo sigue al cambiar el trazo");
  const confeti = patronDeEstilo("aleatorio", espiral, { participaciones: [0.5, 0.25, 0.25], globosPorRacimo: 4 });
  assert.deepEqual(confeti.base, { modo: "aleatorio", pesos: [{ material: 0, peso: 50 }, { material: 1, peso: 25 }, { material: 2, peso: 25 }], semilla: 1 });
  assert.deepEqual(pintadosPendientes(racimo, unGlobo), racimo.pintados, "lo que el eco de Python no trae sigue pendiente");
  assert.deepEqual(pintadosPendientes(racimo, racimo), []);
  ok("borrador: pintados sin duplicados y estilos que conservan el racimo");

  // Una ficha del mismo modo que el patrón de Python parte de él, no de un arranque armado aquí.
  const presetConfeti: PatronColor = { version: "patron-color.v1", origen: "sugerido", base: { modo: "aleatorio", pesos: [{ material: 0, peso: 60 }, { material: 1, peso: 40 }], semilla: 1_234_567 } };
  const anillos = patronDeEstilo("anillos", presetConfeti, { participaciones: [0.6, 0.4], globosPorRacimo: 4, referencia: presetConfeti });
  const deVuelta = patronDeEstilo("aleatorio", anillos, { participaciones: [0.6, 0.4], globosPorRacimo: 4, referencia: presetConfeti });
  assert.deepEqual(deVuelta.base, presetConfeti.base, "volver a Confeti recupera la semilla y los pesos de Python");
  const conEspiralPython = patronDeEstilo("espiral", anillos, { participaciones: [0.5, 0.25, 0.25], globosPorRacimo: 4, referencia: espiral });
  assert.deepEqual(conEspiralPython.base, { modo: "espiral", racimo: [0, 1, 0, 2], trazo: "espiral" }, "y volver a Espiral, el racimo del plan");
  const sinNada = patronDeEstilo("anillos", null, { participaciones: [0.5, 0.49, 0.01], globosPorRacimo: 4 });
  assert.deepEqual(sinNada.base, { modo: "anillos", secuencia: [0, 1, 2], largo: 1 }, "sin borrador ni patrón de Python, todos los colores en orden");
  ok("borrador: una ficha del modo del patrón de Python parte de él");
}

// 7e'. "En tu propuesta" lo decide el diseño que ya tiene el plan, no `origen`.
{
  const delPlan = declaradaDe("EST_01_COLUMNA").patron_color!;
  const presetAplicado: PatronColor = { ...delPlan, origen: "sugerido" };
  assert.equal(enPropuesta(presetAplicado, presetAplicado), true, "un preset que Python aplicó al confirmar ya se cotiza");
  assert.equal(enPropuesta({ ...presetAplicado, origen: "decorador" }, presetAplicado), true, "cambiar solo el origen no lo saca de la propuesta");
  const retocado = editar(presetAplicado, { globos_por_racimo: 3 });
  assert.equal(retocado.origen, "decorador");
  assert.equal(enPropuesta(retocado, presetAplicado), false, "un borrador retocado no está en la propuesta hasta aplicarlo");
  assert.equal(enPropuesta(presetAplicado, null), false, "una pieza sin patrón no cotiza ninguno, sugerido o no");
  assert.equal(enPropuesta(undefined, presetAplicado), false);
  const conteo = resueltoDe("EST_01_COLUMNA").conteo;
  const fuera = textoVisible(renderToStaticMarkup(React.createElement(ResumenPatron, { conteo, repeticiones: 2, leyenda: leyendaDe("EST_01_COLUMNA"), fueraDePropuesta: true })));
  assert.match(fuera, /Total de las 2 piezas iguales · todavía no está en tu propuesta/);
  const dentro = textoVisible(renderToStaticMarkup(React.createElement(ResumenPatron, { conteo, repeticiones: 2, leyenda: leyendaDe("EST_01_COLUMNA") })));
  assert.doesNotMatch(dentro, /no está en tu propuesta|sugerido/);
  ok("conteo en el editor: fuera de la propuesta solo si el plan no usa ese diseño");
}

// 7f. /api/plan-patron desde el navegador: respuesta validada y errores aptos para el decorador.
async function probarPeticionPatron(): Promise<void> {
  const resuelto = resueltoDe("EST_01_COLUMNA");
  const cuerpo = { plan: planPatrones.plan, estructura_id: "EST_01_COLUMNA", patron_color: null as PatronColor | null };
  const responder = (datos: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json" } });
  const bien = await pedirVistaPatron(cuerpo, { fetcher: responder({ patron: resuelto }) });
  assert.equal(bien.nombre, "Espiral");
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ error: "patron_invalido", motivo: "material_sin_uso", mensaje: "Negro no aparece en el patrón." }, 422) }), (error: unknown) => error instanceof FalloPlanPatron && error.patronInvalido && error.motivo === "material_sin_uso" && error.message === "Negro no aparece en el patrón.");
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ error: "Traceback (most recent call last)" }, 500) }), (error: unknown) => error instanceof FalloPlanPatron && !error.patronInvalido && !/Traceback/.test(error.message), "un error técnico no llega al decorador");
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: async () => { throw new TypeError("Failed to fetch"); } }), (error: unknown) => error instanceof FalloPlanPatron && !/Failed to fetch/.test(error.message));
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ patron: { ...resuelto, celdas: "no" } }) }), FalloPlanPatron, "una respuesta fuera de esquema no se dibuja");
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ patron: { ...resuelto, estructura_id: "EST_02_ARCO" } }) }), FalloPlanPatron, "ni la de otra estructura");
  const controlador = new AbortController();
  controlador.abort();
  await assert.rejects(pedirVistaPatron(cuerpo, { signal: controlador.signal, fetcher: async (_url, init) => { init?.signal?.throwIfAborted(); throw new Error("no llega"); } }), (error: unknown) => error instanceof DOMException && error.name === "AbortError", "una cancelación se relanza tal cual");

  // El rechazo del patrón se reconoce también con el cuerpo `{error, ui_error}` del ADR-0028 §10.
  const frase = "El color azul (3) no queda en ningún globo del patrón: úsalo en el patrón o quítalo de la pieza.";
  const uiRechazo = construirUiErrorV1("PROPUESTA_INCOMPLETA", { mensaje: frase, codigoOrigen: "PATRON_INVALIDO:material_sin_uso", causa: "PATRON_INVALIDO", mensajeUsuario: frase });
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ error: frase, ui_error: uiRechazo }, 422) }), (error: unknown) => error instanceof FalloPlanPatron && error.patronInvalido && error.motivo === "material_sin_uso" && error.message === frase, "solo con ui_error");
  const uiGenerico = construirUiErrorV1("PROPUESTA_INCOMPLETA", { mensaje: "x", causa: "PATRON_INVALIDO" });
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ error: "Traceback", causa: "PATRON_INVALIDO", ui_error: uiGenerico }, 422) }), (error: unknown) => error instanceof FalloPlanPatron && error.patronInvalido && error.motivo === null && error.message === MENSAJE_PATRON_INVALIDO, "sin la frase de Python: rechazo del patrón con un texto propio, nunca el `error` crudo");
  await assert.rejects(pedirVistaPatron(cuerpo, { fetcher: responder({ error: "estructura_no_encontrada" }, 404) }), (error: unknown) => error instanceof FalloPlanPatron && !error.patronInvalido, "otro fallo sí se puede reintentar");
  ok("petición de vista previa: validación de la respuesta y errores para el decorador");

  // Aplicar (acción `patron` de /api/plan-editar): la frase de Python llega al editor aunque el ui_error sea el genérico.
  const cuerpoEdicion = { modo: "aplicar", base: planPatrones, edicion: { accion: "patron", estructura_id: "EST_01_COLUMNA", patron_color: declaradaDe("EST_01_COLUMNA").patron_color } };
  let url = "";
  const rechazo = { error: frase, causa: "PATRON_INVALIDO", motivo: "material_sin_uso", mensaje: frase, ui_error: construirUiErrorV1("PROPUESTA_INCOMPLETA", { mensaje: frase, causa: "PATRON_INVALIDO" }) };
  const fallo = await pedirPlanEditarPatron(cuerpoEdicion, "No se pudo actualizar la pieza.", { fetcher: async (destino, init) => { url = String(destino); return responder(rechazo, 422)(destino, init); } }).then(() => null, (error: unknown) => error);
  assert.equal(url, "/api/plan-editar");
  assert.ok(fallo instanceof FalloPlanPatron && fallo.patronInvalido && fallo.motivo === "material_sin_uso");
  assert.ok(fallo instanceof FalloPlanEditar, "quien muestra fallos de plan-editar muestra también este");
  assert.equal(mensajeFalloPlanEditar(fallo, "No se pudo actualizar la pieza."), frase);
  const aplicado = await pedirPlanEditarPatron(cuerpoEdicion, "No se pudo actualizar la pieza.", { fetcher: responder({ plan: planPatrones }) });
  assert.deepEqual(aplicado, { plan: planPatrones }, "si sale bien devuelve el cuerpo, como pedirPlanEditar");
  ok("aplicar el patrón: el rechazo de Python llega con su frase");
}

probarPeticionPatron()
  .then(() => console.log(`\n${casos} casos OK (propuesta, cotización, análisis de foto y patrón de color)`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
