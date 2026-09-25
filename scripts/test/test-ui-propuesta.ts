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
import { BloquePatron, ControlesPatron, GaleriaEstilos, GraficaPatron, HojaArmado, leyendaPatron, PieEditorPatron, ResumenPatron } from "@/components/plan/patron";
import { crearAutoguardado, type Reloj } from "@/components/plan/autoguardado";
import { crearColaAjustes, crearPendientesAjustes } from "@/components/plan/cola-ajustes";
import { vistaDeAutoguardado, type VistaEstadoGuardado } from "@/components/plan/EstadoGuardado";
import { conGlobosPorRacimo, conPintado, editar, enPropuesta, pintadosPendientes } from "@/components/plan/patron/borrador";
import { admitePatron, controlesDeModo, iconoDeModo } from "@/components/plan/patron/modos";
import { posicionItinerante } from "@/components/plan/patron/GraficaPatron";
import { GLOBOS_POR_TRAMO_IMPRESO, tramosDeColumnas } from "@/components/plan/patron/HojaArmado";
import { ResumenVistaPatron } from "@/components/plan/patron/PanelVistaPatron";
import { avisosDelCambioDeEstilo } from "@/components/plan/patron/usarVistaPrevia";
import { RepartoColores } from "@/components/plan/RepartoColores";
import { crearVistaReparto, repartoADibujar } from "@/components/plan/vista-reparto";
import { crearVistasEnVivo } from "@/components/plan/vistas-en-vivo";
import { avisosDeEdicion } from "@/components/plan/avisos-edicion";
import { FalloPlanPatron, MENSAJE_PATRON_INVALIDO, pedirPlanEditarPatron, pedirVistaPatron, pedirVistaPatronDetallada } from "@/lib/plan/peticion-patron";
import { FalloPlanEditar, mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { PatronColorResueltoSchema, type ModoAdmitido, type PatronColor, type PatronColorResuelto } from "@/lib/plan/patron-color";

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

  // Mientras se guarda (el cambio pendiente que dejó el editor al cerrarse),
  // "Editar patrón" y "Crear patrón" siguen enfocables: el foco vuelve a ellos
  // al cerrar. Un botón `disabled` no recibe el foco y lo dejaba en <body>.
  const bloqueOcupado = (resuelto?: PatronColorResuelto) => renderToStaticMarkup(React.createElement(BloquePatron, { resuelto, leyenda: leyendaDe("EST_01_COLUMNA"), tipo: "columna", repeticiones: 2, nombrePieza: "Columna", onEditar: () => undefined, onHojaArmado: () => undefined, ocupado: true }));
  for (const [html, testid] of [[bloqueOcupado(resueltoDe("EST_01_COLUMNA")), "editar-patron"], [bloqueOcupado(), "crear-patron"]] as const) {
    const boton = new RegExp(`<button[^>]*data-testid="${testid}"[^>]*>`).exec(html)?.[0] ?? "";
    assert.match(boton, /aria-disabled="true"/, `${testid} ocupado se anuncia como no disponible`);
    assert.doesNotMatch(boton, /\sdisabled=""/, `${testid} ocupado no pierde el foco`);
  }
  const libre = renderToStaticMarkup(React.createElement(BloquePatron, { resuelto: resueltoDe("EST_01_COLUMNA"), leyenda: leyendaDe("EST_01_COLUMNA"), tipo: "columna", repeticiones: 2, nombrePieza: "Columna", onEditar: () => undefined }));
  assert.doesNotMatch(/<button[^>]*data-testid="editar-patron"[^>]*>/.exec(libre)?.[0] ?? "", /\s(aria-)?disabled=/);
  ok("bloque del patrón: abrir el editor sigue enfocable mientras se guarda");
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
  // Foco en el número del racimo 12 y la columna pasa a 6 racimos (más globos
  // por racimo, "Deshacer" u otro estilo): el Tab stop no puede quedar en una fila borrada.
  const seisFilas = resuelto.celdas.slice(0, 6);
  assert.deepEqual(posicionItinerante({ fila: 11, columna: -1 }, seisFilas, 5), { fila: 5, columna: 0 }, "la cabecera de una fila que ya no existe vuelve al primer racimo a la vista");
  assert.deepEqual(posicionItinerante({ fila: 11, columna: 2 }, seisFilas, 5), { fila: 5, columna: 0 });
  assert.deepEqual(posicionItinerante({ fila: 3, columna: -1 }, seisFilas, 5), { fila: 3, columna: -1 }, "la cabecera de una fila que sigue se conserva");
  assert.deepEqual(posicionItinerante({ fila: 3, columna: 7 }, [[0, 1], [0, 1], [0, 1], [0, 1, 0]], 3), { fila: 3, columna: 2 }, "en una fila más corta queda en su último globo");
  for (const elegido of [{ fila: 11, columna: -1 }, { fila: 0, columna: 5 }, { fila: 2, columna: -1 }]) {
    const activo = posicionItinerante(elegido, seisFilas, 5);
    assert.ok(activo.columna >= -1 && activo.columna < seisFilas[activo.fila]!.length, `${JSON.stringify(elegido)} → un botón que existe`);
  }
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
  assert.match(columna, /Paso a paso Racimos 1–12 Blanco mate, Negro mate, Blanco mate, Azul cromado 1 · 2 · 1 · 3 × 12 racimos/, "cada paso dice sus colores en texto y los dibuja con su número");
  assert.match(columna, /Consejos de armado Infla cada globo con el calibrador/);
  assert.match(columna, /Blanco mate 24 48 2 Negro mate 12 24 3 Azul cromado 12 24/, "por pieza y total de las dos columnas");
  assert.match(columna, /12″ 48 24 24 96/, "globos por tamaño salen de las líneas resueltas");
  const arco = hoja("EST_02_ARCO");
  assert.match(textoVisible(arco), /Racimos 1–3 [^]*?1 · 1 · 1 · 1 × 3 racimos Racimo 4 [^]*?2 · 2 · 2 · 2 Racimo 5 [^]*?2 · 2 · 2 · 2 centro 3/);
  // Lo que oye un lector de pantalla: texto (sr-only), no un aria-label en un
  // <span> sin rol, que ARIA 1.2 prohíbe y NVDA ignora (axe: aria-prohibited-attr).
  const pasos = /<h3[^>]*>Paso a paso<\/h3>([^]*?)<\/ol>/.exec(arco)?.[1] ?? "";
  assert.match(pasos, /<span class="sr-only">Rosado mate, Rosado mate, Rosado mate, Rosado mate, y al centro Amarillo mate<\/span>/, "el centro de la flor se dice en el paso");
  assert.equal((pasos.match(/<span class="sr-only">/g) ?? []).length, planPatrones.patrones_color!.find((patron) => patron.estructura_id === "EST_02_ARCO")!.pasos.length, "cada paso lleva sus colores en texto");
  assert.doesNotMatch(pasos, /<span(?![^>]*\brole=)[^>]*\baria-label=/, "ningún <span> genérico con aria-label en el paso a paso");
  ok("hoja de armado: paso a paso, consejos y conteos");

  // Una pared ancha (10 m × 2,4 m sale de 18 × 76, ADR-0028 §2): en pantalla
  // solo la gráfica se desplaza de lado (la sección es `min-w-0`, así la hoja
  // no se ensancha en un teléfono); en el papel va a todo el ancho y por
  // tramos que caben, sin recortar ningún globo.
  assert.deepEqual(tramosDeColumnas(76), [{ desde: 0, hasta: 19 }, { desde: 19, hasta: 38 }, { desde: 38, hasta: 57 }, { desde: 57, hasta: 76 }]);
  assert.deepEqual(tramosDeColumnas(GLOBOS_POR_TRAMO_IMPRESO), [{ desde: 0, hasta: GLOBOS_POR_TRAMO_IMPRESO }], "hasta 24 globos la gráfica va entera");
  assert.deepEqual(tramosDeColumnas(25).map((tramo) => tramo.hasta - tramo.desde), [13, 12]);
  const pared = resueltoDe("EST_03_PARED");
  const celdasAnchas = Array.from({ length: 18 }, (_, fila) => Array.from({ length: 76 }, (_, columna) => (fila + columna) % 2));
  const hojaAncha = renderToStaticMarkup(React.createElement(HojaArmado, { resuelto: { ...pared, filas: 18, columnas: 76, celdas: celdasAnchas }, leyenda: leyendaDe("EST_03_PARED"), estructura: estructuraDe("EST_03_PARED"), declarada: declaradaDe("EST_03_PARED") }));
  assert.match(hojaAncha, /class="hoja-armado-columnas grid /, "la rejilla de dos columnas tiene su regla de impresión");
  assert.match(readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8"), /@media print \{[^]*\.hoja-armado-columnas \{\s*grid-template-columns: minmax\(0, 1fr\) !important;/, "al imprimir la hoja va en una sola columna");
  assert.match(hojaAncha, /<section class="min-w-0 space-y-2"><h3[^>]*>Gráfica numerada<\/h3><div tabindex="0" role="group" aria-label="Gráfica numerada" class="[^"]*overflow-x-auto[^"]*print:hidden"/, "en pantalla la gráfica entera se desplaza dentro de su sección (también con el teclado) y no se imprime");
  const tramosHtml = hojaAncha.split('data-testid="grafica-por-tramos"')[1]?.split("</section>")[0] ?? "";
  assert.match(tramosHtml, /^ class="hidden [^"]*print:block"/, "los tramos solo se imprimen");
  const globosPorFila = new Map<number, number[]>();
  for (const [, fila, colores] of tramosHtml.matchAll(/<li aria-label="Fila (\d+): ([^"]*)"/g)) {
    globosPorFila.set(Number(fila), [...(globosPorFila.get(Number(fila)) ?? []), colores!.split(", ").length]);
  }
  assert.equal(globosPorFila.size, 18);
  for (const [fila, tramos] of globosPorFila) {
    assert.deepEqual(tramos, [19, 19, 19, 19], `fila ${fila}: cuatro tramos de 19 globos`);
  }
  assert.equal((textoVisible(tramosHtml).match(/Tramo \d · globos \d+ a \d+ de cada fila/g) ?? []).length, 4);
  const columnaHoja = hoja("EST_01_COLUMNA");
  assert.doesNotMatch(columnaHoja, /grafica-por-tramos|print:hidden/, "una columna de cuartetos se imprime entera");
  ok("hoja de armado: una pared ancha se desplaza en pantalla y se imprime por tramos sin recortar globos");
}

// 7d. Controles del editor: los estilos, sus direcciones y el espejo son los
// que Python admite para la pieza (`modos_admitidos`), en su orden. La
// interfaz no decide ninguno por el tipo de la pieza.
const admitido = (modo: ModoAdmitido["modo"], direcciones: ModoAdmitido["direcciones"] = ["longitudinal"], espejo = false): ModoAdmitido => ({ modo, direcciones, espejo });
// Como los devolvió Python para la columna y la pared de la fixture.
const MODOS_COLUMNA = [admitido("espiral"), admitido("anillos"), admitido("bloques"), admitido("degradado"), admitido("aleatorio"), admitido("flor")];
const MODOS_PARED = [admitido("anillos", ["longitudinal", "transversal"]), admitido("bloques", ["longitudinal", "transversal"]), admitido("degradado", ["longitudinal", "transversal", "diagonal"]), admitido("aleatorio"), admitido("damero")];
{
  const estilo = { onElegir: () => undefined };
  const controles = (id: string, geometria: "racimos" | "rejilla", modos: readonly ModoAdmitido[]) => textoVisible(renderToStaticMarkup(React.createElement(ControlesPatron, {
    patron: declaradaDe(id).patron_color!,
    leyenda: leyendaDe(id),
    modos,
    geometria,
    globosPorRacimo: 4,
    estilo,
    onCambiar: () => undefined,
  })));
  const pared = controles("EST_03_PARED", "rejilla", MODOS_PARED);
  assert.match(pared, /Estilo .*Anillos .*Bloques .*Degradé .*Confeti .*Damero/, "los estilos de Python, en su orden");
  assert.doesNotMatch(pared, /Flores|Espiral|Globos por racimo/);
  assert.match(pared, /Dirección Por filas Por columnas En diagonal/, "las direcciones del degradé, las de Python");
  const columna = controles("EST_01_COLUMNA", "racimos", MODOS_COLUMNA);
  assert.match(columna, /Espiral .*Anillos .*Bloques .*Degradé .*Confeti .*Flores/);
  assert.doesNotMatch(columna, /Damero|Dirección|Simetría espejo/, "una sola dirección no se ofrece; sin espejo de Python, no hay interruptor");
  assert.match(columna, /Posición 1 .*Posición 2 .*Posición 3 .*Posición 4/);
  assert.match(columna, /4 · cuarteto/);
  // Lo que diga Python manda, aunque no sea lo de siempre para el tipo: la interfaz no filtra por tipo.
  const otra = controles("EST_01_COLUMNA", "racimos", [admitido("damero"), admitido("espiral", ["longitudinal", "transversal"], true)]);
  assert.match(otra, /Estilo .*Damero .*Espiral/);
  assert.doesNotMatch(otra, /Anillos|Flores/);
  assert.match(otra, /Dirección Por filas Por columnas/);
  assert.match(otra, /Simetría espejo/);
  assert.match(controles("EST_02_ARCO", "racimos", [admitido("flor", ["longitudinal"], true)]), /Simetría espejo/, "el espejo cuando Python lo admite para el estilo del borrador");
  ok("controles del editor: estilos, direcciones y espejo de Python, en su orden");

  // Mientras Python no respondió, la galería espera sin fichas inventadas; un estilo en camino se marca y su rechazo queda a la vista.
  const cargando = renderToStaticMarkup(React.createElement(GaleriaEstilos, { patron: null, modos: null, estilo }));
  assert.doesNotMatch(cargando, /aria-pressed/);
  assert.match(cargando, /brillo-carga/);
  const galeria = renderToStaticMarkup(React.createElement(GaleriaEstilos, { patron: null, modos: MODOS_COLUMNA, estilo: { onElegir: () => undefined, pendiente: "anillos", error: { modo: "flor", mensaje: "Negro no aparece en el patrón." } } }));
  assert.match(textoVisible(galeria), /Elige uno para empezar tu patrón/);
  assert.equal((galeria.match(/aria-pressed="false"/g) ?? []).length, 6, "las seis fichas que Python admite, ninguna elegida");
  assert.match(galeria, /aria-busy="true" data-modo="anillos"/, "el estilo que Python está armando");
  assert.match(textoVisible(galeria), /Flores: Negro no aparece en el patrón\./);
  ok("galería: espera a Python, marca el estilo en camino y muestra su rechazo");

  // Cambiar de estilo que obliga a Python a quitar algo del borrador (el espejo al pasar a bloques):
  // el aviso va junto a los estilos, en una región viva que ya estaba montada, no solo en el conteo
  // (en un teléfono queda bajo todos los ajustes y no se anunciaba).
  const QUITADO = "El estilo «bloques» no se arma en espejo en esta pieza: queda sin espejo.";
  const previa = resueltoDe("EST_02_ARCO");
  const llegada = { ...previa, avisos: [QUITADO, ...previa.avisos] };
  assert.deepEqual(avisosDelCambioDeEstilo(previa, llegada), [QUITADO], "solo lo nuevo del cambio; lo que el dibujo ya decía sigue en el conteo");
  assert.deepEqual(avisosDelCambioDeEstilo(null, llegada), llegada.avisos);
  const vivaVacia = /<div role="status" aria-live="polite" data-testid="avisos-estilo">([^]*?)<\/div>/.exec(renderToStaticMarkup(React.createElement(GaleriaEstilos, { patron: declaradaDe("EST_02_ARCO").patron_color!, modos: MODOS_COLUMNA, estilo })));
  assert.equal(vivaVacia?.[1], "", "la región viva está montada y vacía antes del cambio");
  const conAviso = renderToStaticMarkup(React.createElement(GaleriaEstilos, { patron: declaradaDe("EST_02_ARCO").patron_color!, modos: MODOS_COLUMNA, estilo: { onElegir: () => undefined, avisos: [QUITADO] } }));
  const region = /<div role="status" aria-live="polite" data-testid="avisos-estilo">([^]*?)<\/ul><\/div>/.exec(conAviso)?.[1] ?? "";
  assert.ok(textoVisible(region).includes(QUITADO), "el aviso se anuncia junto a los estilos");
  assert.ok(conAviso.indexOf('data-testid="galeria-estilos"') < conAviso.indexOf('data-testid="avisos-estilo"'), "justo debajo de las fichas");
  const resumen = textoVisible(renderToStaticMarkup(React.createElement(ResumenVistaPatron, { vista: llegada, avisosAparte: [QUITADO], enPropuesta: true, leyenda: leyendaDe("EST_02_ARCO"), repeticiones: 1, modo: "vista", cargando: false, error: null, onReintentar: () => undefined })));
  assert.ok(!resumen.includes(QUITADO), "no se repite en el conteo mientras está junto a los estilos");
  for (const aviso of previa.avisos) assert.ok(resumen.includes(aviso), "los demás avisos siguen en el conteo");
  ok("cambio de estilo: lo que Python quitó se avisa junto a los estilos, en una región viva");

  // Qué controles lleva cada modo lo dice la respuesta, no el tipo.
  assert.deepEqual(controlesDeModo(MODOS_PARED, "degradado"), { direcciones: ["longitudinal", "transversal", "diagonal"], espejo: false });
  assert.deepEqual(controlesDeModo(MODOS_PARED, "damero"), { direcciones: [], espejo: false }, "una sola dirección no se ofrece");
  assert.deepEqual(controlesDeModo(null, "degradado"), { direcciones: [], espejo: false }, "sin respuesta de Python, ninguno");
  assert.deepEqual(controlesDeModo(MODOS_COLUMNA, "damero"), { direcciones: [], espejo: false }, "un modo que Python no admite, ninguno");
  const espiral = declaradaDe("EST_01_COLUMNA").patron_color!;
  assert.equal(iconoDeModo("espiral", { ...espiral, base: { modo: "espiral", racimo: [0, 1, 0, 2], trazo: "zigzag" } }), "zigzag", "la ficha del borrador muestra su trazo");
  assert.equal(iconoDeModo("anillos", espiral), "anillos");
  // "Crear patrón": solo la puerta de la interfaz (pieza geométrica con dos colores); Python contesta el resto al abrir.
  assert.equal(admitePatron("columna", 2), true);
  assert.equal(admitePatron("columna", 1), false, "un solo material no lleva patrón");
  assert.equal(admitePatron("backdrop", 3), false, "un tipo sin geometría no lleva patrón");
  ok("modos del editor: controles e iconos desde la respuesta de Python");
}

// 7e. Borrador declarativo: pintar reemplaza lo pintado antes.
{
  const espiral = declaradaDe("EST_01_COLUMNA").patron_color!;
  const unGlobo = conPintado(espiral, { fila: 2, columna: 1, material: 2 });
  const otraVez = conPintado(unGlobo, { fila: 2, columna: 1, material: 0 });
  assert.deepEqual(otraVez.pintados, [{ fila: 2, columna: 1, material: 0 }], "repintar el mismo globo no acumula");
  const racimo = conPintado(conPintado(otraVez, { fila: 3, columna: 0, material: 1 }), { fila: 2, material: 1 });
  assert.deepEqual(racimo.pintados, [{ fila: 3, columna: 0, material: 1 }, { fila: 2, material: 1 }], "pintar el racimo entero reemplaza sus globos pintados");
  assert.equal(racimo.origen, "decorador");
  assert.deepEqual(pintadosPendientes(racimo, unGlobo), racimo.pintados, "lo que el eco de Python no trae sigue pendiente");
  assert.deepEqual(pintadosPendientes(racimo, racimo), []);
  assert.deepEqual(conGlobosPorRacimo(espiral, 3).base, { modo: "espiral", racimo: [0, 1, 0], trazo: "espiral" }, "otro racimo recorta la espiral");
  ok("borrador: pintados sin duplicados");
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

// 8. Autoguardado (sin "Aplicar"): el editor de patrón y los deslizadores
// guardan solos. El planificador es puro: reloj falso y guardados que la
// prueba resuelve a mano.

/** Deja correr las promesas pendientes (los `.then` del planificador y de la cola). */
function vaciarPromesas(): Promise<void> {
  return new Promise((listo) => setImmediate(listo));
}

function relojFalso(): { reloj: Reloj; avanzar: (ms: number) => Promise<void> } {
  let ahora = 0;
  let siguienteId = 0;
  let tareas: Array<{ id: number; en: number; accion: () => void }> = [];
  const reloj: Reloj = (accion, ms) => {
    const id = ++siguienteId;
    tareas.push({ id, en: ahora + ms, accion });
    return () => {
      tareas = tareas.filter((tarea) => tarea.id !== id);
    };
  };
  async function avanzar(ms: number): Promise<void> {
    const fin = ahora + ms;
    for (;;) {
      tareas.sort((a, b) => a.en - b.en || a.id - b.id);
      const tarea = tareas[0];
      if (!tarea || tarea.en > fin) break;
      tareas.shift();
      ahora = tarea.en;
      tarea.accion();
      await vaciarPromesas();
    }
    ahora = fin;
    await vaciarPromesas();
  }
  return { reloj, avanzar };
}

type Patronito = { estilo: string; origen?: string } | null;
/** Igualdad de diseño como `mismoDiseno`: el origen no cuenta. */
const mismoPatronito = (a: Patronito, b: Patronito): boolean => (a === null || b === null ? a === b : a.estilo === b.estilo);

function banco(opciones: { enPlan?: Patronito; validar?: boolean; alPendiente?: (pendiente: boolean) => void } = {}) {
  const { reloj, avanzar } = relojFalso();
  const llamadas: Array<{ valor: Patronito; resolver: (motivo: string | null) => void }> = [];
  const control = crearAutoguardado<Patronito>({
    enPlan: opciones.enPlan ?? { estilo: "espiral" },
    iguales: mismoPatronito,
    esperaMs: 700,
    validar: opciones.validar ?? true,
    reloj,
    alPendiente: opciones.alPendiente,
    guardar: (valor) => new Promise((resolver) => llamadas.push({ valor, resolver })),
  });
  const guardados = () => llamadas.map((llamada) => llamada.valor?.estilo ?? "sin patrón");
  async function responder(indice: number, motivo: string | null = null): Promise<void> {
    llamadas[indice]!.resolver(motivo);
    await vaciarPromesas();
  }
  return { control, avanzar, llamadas, guardados, responder };
}

async function probarAutoguardado(): Promise<void> {
  // Pausa: una ráfaga de cambios es un solo guardado, 700 ms después del último.
  {
    const { control, avanzar, guardados, responder } = banco({ validar: false });
    assert.equal(control.estado().fase, "quieto", "antes del primer cambio no hay nada que decir");
    control.cambiar({ estilo: "anillos" });
    await avanzar(300);
    control.cambiar({ estilo: "bloques" });
    assert.equal(control.estado().fase, "esperando", "un cambio en espera ya se anuncia como guardándose");
    await avanzar(690);
    assert.deepEqual(guardados(), [], "la pausa se cuenta desde el último cambio");
    await avanzar(10);
    assert.deepEqual(guardados(), ["bloques"], "solo se guarda el último");
    assert.equal(control.estado().fase, "guardando");
    await responder(0);
    assert.deepEqual(control.estado(), { fase: "guardado", motivo: null, guardados: 1 });
  }
  ok("autoguardado: espera a que el borrador deje de cambiar");

  // Nunca se guarda un borrador que la vista previa no aprobó.
  {
    const { control, avanzar, guardados, responder } = banco();
    const flores = { estilo: "flores" };
    control.cambiar(flores);
    await avanzar(2000);
    assert.deepEqual(guardados(), [], "sin vista previa todavía, espera");
    control.validar(flores, { ok: true });
    assert.deepEqual(guardados(), ["flores"], "con la pausa cumplida, la vista previa buena lo guarda al llegar");
    await responder(0);
    const damero = { estilo: "damero" };
    control.cambiar(damero);
    control.validar(damero, { ok: false, motivo: "Negro no aparece en el patrón." });
    await avanzar(5000);
    assert.deepEqual(guardados(), ["flores"], "un borrador que Python rechazó no se guarda");
    assert.deepEqual(control.estado(), { fase: "rechazado", motivo: "Negro no aparece en el patrón.", guardados: 1 });
    control.validar({ estilo: "otro" }, { ok: true });
    await avanzar(1000);
    assert.deepEqual(guardados(), ["flores"], "la vista previa de otro borrador no lo aprueba");
    const anillos = { estilo: "anillos" };
    control.cambiar(anillos);
    control.validar(anillos, { ok: true });
    await avanzar(700);
    assert.deepEqual(guardados(), ["flores", "anillos"], "el siguiente borrador válido se guarda solo");
  }
  ok("autoguardado: solo lo que Python dibujó sin rechazo");

  // Un guardado a la vez; lo que cambia mientras vuela se junta y va después, solo lo último.
  {
    const { control, avanzar, guardados, responder } = banco({ validar: false });
    control.cambiar({ estilo: "anillos" }, { inmediato: true });
    assert.deepEqual(guardados(), ["anillos"]);
    control.cambiar({ estilo: "bloques" });
    await avanzar(800);
    control.cambiar({ estilo: "degradado" });
    await avanzar(800);
    assert.deepEqual(guardados(), ["anillos"], "no sale otro guardado con uno en vuelo (ni se cancela el que vuela)");
    assert.equal(control.estado().fase, "guardando");
    await responder(0);
    assert.deepEqual(guardados(), ["anillos", "degradado"], "al terminar se guarda solo el último cambio");
    await responder(1);
    assert.deepEqual(control.estado(), { fase: "guardado", motivo: null, guardados: 2 });
  }
  ok("autoguardado: un guardado en vuelo, los cambios de mientras se juntan");

  // Lo que el plan ya lleva no se guarda; volver al de antes con uno en vuelo sí.
  {
    const { control, avanzar, guardados, responder } = banco({ enPlan: { estilo: "espiral", origen: "sugerido" }, validar: false });
    control.cambiar({ estilo: "espiral", origen: "decorador" }, { inmediato: true });
    await avanzar(1000);
    assert.deepEqual(guardados(), [], "mismo diseño que el plan (aunque cambie el origen): nada que guardar");
    assert.equal(control.estado().fase, "quieto");
    control.cambiar({ estilo: "anillos" }, { inmediato: true });
    control.cambiar({ estilo: "espiral" });
    await avanzar(700);
    await responder(0);
    assert.deepEqual(guardados(), ["anillos", "espiral"], "deshacer mientras vuela: el plan va a cambiar, así que el de antes se vuelve a guardar");
    await responder(1);
    control.cambiar({ estilo: "espiral", origen: "decorador" });
    await avanzar(700);
    assert.deepEqual(guardados(), ["anillos", "espiral"], "igual a lo último guardado: nada");
    assert.equal(control.estado().fase, "guardado");
  }
  ok("autoguardado: no repite lo que el plan ya tiene");

  // Tras un "Deshacer" de la tarjeta, volver a elegir el valor deshecho es un cambio (la mezcla de tamaños es un string).
  {
    const { reloj, avanzar } = relojFalso();
    const guardadas: string[] = [];
    const tamanos = crearAutoguardado<string>({ enPlan: "organica_fina", iguales: (a, b) => a === b, esperaMs: 600, reloj, guardar: async (mezcla) => { guardadas.push(mezcla); return null; } });
    tamanos.cambiar("clasica", { inmediato: true });
    await vaciarPromesas();
    assert.deepEqual(guardadas, ["clasica"]);
    tamanos.sincronizar("organica_fina");
    tamanos.cambiar("clasica");
    assert.equal(tamanos.estado().fase, "esperando", "el control no vuelve de golpe a lo que tiene el plan");
    await avanzar(600);
    assert.deepEqual(guardadas, ["clasica", "clasica"], "la mezcla deshecha, elegida otra vez, se guarda");
    tamanos.sincronizar("clasica");
    tamanos.cambiar("solo_grandes");
    await avanzar(400);
    tamanos.cambiar("solo_grandes");
    await avanzar(200);
    assert.deepEqual(guardadas, ["clasica", "clasica", "solo_grandes"], "un efecto que repite el mismo valor sigue sin ser un cambio: no alarga la pausa");
  }
  ok("autoguardado: tras deshacer, el mismo valor se puede volver a elegir");

  // Pendiente: desde que el cambio espera su pausa hasta que el plan lo tiene (o falla). Aprobar espera a esto.
  {
    const avisos: boolean[] = [];
    const { control, avanzar, responder } = banco({ validar: false, alPendiente: (pendiente) => avisos.push(pendiente) });
    control.cambiar({ estilo: "anillos" });
    assert.deepEqual(avisos, [true], "esperar la pausa ya cuenta como pendiente, antes de llegar a la cola");
    await avanzar(700);
    assert.deepEqual(avisos, [true], "de esperar a guardando sigue pendiente sin avisar otra vez");
    await responder(0);
    assert.deepEqual(avisos, [true, false]);
    control.cambiar({ estilo: "bloques" }, { inmediato: true });
    await responder(1, "No pudimos conectarnos.");
    assert.deepEqual(avisos, [true, false, true, false], "un fallo deja de estar pendiente: se ve el error");
    control.cambiar({ estilo: "anillos" });
    assert.deepEqual(avisos, [true, false, true, false], "volver a lo que el plan ya tiene no deja nada pendiente");

    const cantidades: number[] = [];
    const contador = crearPendientesAjustes((cantidad) => cantidades.push(cantidad));
    const colores = contador.avisador();
    const tamanos = contador.avisador();
    colores(true);
    colores(true);
    tamanos(true);
    colores(false);
    tamanos(false);
    tamanos(false);
    assert.deepEqual(cantidades, [1, 2, 1, 0], "cada control cuenta una vez mientras tenga algo sin guardar");
    assert.equal(contador.cantidad(), 0);
  }
  ok("autoguardado: avisa mientras hay un cambio sin guardar, también en la pausa");

  // Error: el plan se queda como estaba, el motivo a la vista con Reintentar; otro cambio reintenta solo.
  {
    const { control, avanzar, guardados, responder } = banco({ validar: false });
    control.cambiar({ estilo: "anillos" }, { inmediato: true });
    await responder(0, "No pudimos conectarnos.");
    assert.deepEqual(control.estado(), { fase: "error", motivo: "No pudimos conectarnos.", guardados: 0 });
    control.reintentar();
    assert.deepEqual(guardados(), ["anillos", "anillos"], "Reintentar vuelve a mandar el mismo borrador");
    await responder(1);
    assert.equal(control.estado().fase, "guardado");
    control.cambiar({ estilo: "bloques" }, { inmediato: true });
    await responder(2, "No pudimos conectarnos.");
    control.cambiar({ estilo: "flores" });
    assert.equal(control.estado().fase, "esperando", "un cambio nuevo deja atrás el error");
    await avanzar(700);
    assert.deepEqual(guardados(), ["anillos", "anillos", "bloques", "flores"]);
    await responder(3);
    assert.deepEqual(control.estado(), { fase: "guardado", motivo: null, guardados: 2 });
    const roto = crearAutoguardado<number>({ enPlan: 0, iguales: (a, b) => a === b, esperaMs: 10, guardar: () => Promise.reject(new Error("x")) });
    roto.cambiar(1, { inmediato: true });
    await vaciarPromesas();
    assert.deepEqual(roto.estado(), { fase: "error", motivo: "No se pudo guardar el cambio.", guardados: 0 }, "un guardado que revienta no se da por bueno");
  }
  ok("autoguardado: los errores se ven y se reintentan");

  // Cerrar: lo que esperaba sale ya (aunque falte la vista previa: el servidor valida) y la sesión avisa al terminar.
  {
    const { control, llamadas, guardados, responder } = banco();
    const anillos = { estilo: "anillos" };
    control.cambiar(anillos);
    control.validar(anillos, { ok: true });
    let resumen: unknown = null;
    void control.cerrar().then((valor) => { resumen = valor; });
    assert.deepEqual(guardados(), ["anillos"], "cerrar no espera la pausa");
    await vaciarPromesas();
    assert.equal(resumen, null, "el resumen llega cuando termina el guardado");
    await responder(0);
    assert.deepEqual(resumen, { guardados: 1, error: null, sinGuardar: null });
    control.cambiar({ estilo: "flores" }, { inmediato: true });
    assert.equal(llamadas.length, 1, "cerrado, ya no escucha cambios");

    // Lo que no llegó al guardarse vuelve en el resumen: la tarjeta lo puede reintentar (y sabe si fue un rechazo de Python).
    const sinVista = banco();
    const bloques = { estilo: "bloques" };
    sinVista.control.cambiar(bloques);
    const fin = sinVista.control.cerrar();
    assert.deepEqual(sinVista.guardados(), ["bloques"], "sin vista previa todavía: se manda y Python decide");
    await sinVista.responder(0, "Negro no aparece en el patrón.");
    assert.deepEqual(await fin, { guardados: 0, error: "Negro no aparece en el patrón.", sinGuardar: { valor: bloques } }, "si no quedó, la tarjeta lo dice");

    const caido = banco({ validar: false });
    const flores = { estilo: "flores" };
    caido.control.cambiar(flores, { inmediato: true });
    await caido.responder(0, "No pudimos conectarnos.");
    assert.equal(caido.control.estado().fase, "error");
    const cierreCaido = await caido.control.cerrar();
    assert.deepEqual(cierreCaido, { guardados: 0, error: "No pudimos conectarnos.", sinGuardar: { valor: flores } }, "cerrar con un fallo a la vista no pierde el borrador: vuelve para reintentarlo");
    assert.equal(cierreCaido.sinGuardar?.valor, flores, "el mismo borrador, no una copia");

    const rechazado = banco();
    const damero = { estilo: "damero" };
    rechazado.control.cambiar(damero);
    rechazado.control.validar(damero, { ok: false, motivo: "No se puede armar así." });
    assert.deepEqual(await rechazado.control.cerrar(), { guardados: 0, error: "No se puede armar así.", sinGuardar: null }, "un rechazo de la vista previa no se ofrece para reintentar");
    assert.deepEqual(rechazado.guardados(), [], "un rechazado tampoco se manda al cerrar");

    const quieto = banco();
    assert.deepEqual(await quieto.control.cerrar(), { guardados: 0, error: null, sinGuardar: null }, "sin cambios, cerrar termina al instante");
  }
  ok("autoguardado: cerrar guarda lo pendiente y resume la sesión");

  // Quitar el patrón: sin vista previa ni pausa.
  {
    const { control, guardados } = banco();
    control.cambiar(null, { inmediato: true, valido: true });
    assert.deepEqual(guardados(), ["sin patrón"]);
  }
  ok("autoguardado: quitar el patrón se guarda al instante");

  // Cola de la tarjeta: cada edición sale sobre el plan que firmó la anterior, aunque se encolen a la vez.
  {
    type Plan = { hash: string };
    const p0: Plan = { hash: "p0" };
    const pendientes: number[] = [];
    const cola = crearColaAjustes<Plan>(p0, (cantidad) => pendientes.push(cantidad));
    const bases: string[] = [];
    const firmar = (hash: string) => async (base: Plan): Promise<Plan> => {
      bases.push(base.hash);
      await vaciarPromesas();
      return { hash };
    };
    const primera = cola.encolar(firmar("p1"));
    const segunda = cola.encolar(firmar("p2"));
    const fallida = cola.encolar(async (base) => {
      bases.push(base.hash);
      throw new Error("sin conexión");
    });
    const cuarta = cola.encolar(firmar("p3"));
    assert.equal(cola.pendientes(), 4);
    assert.equal((await primera).hash, "p1");
    assert.equal((await segunda).hash, "p2");
    await assert.rejects(fallida, /sin conexión/, "el fallo lo recibe quien encoló");
    assert.equal((await cuarta).hash, "p3");
    await vaciarPromesas();
    assert.deepEqual(bases, ["p0", "p1", "p2", "p2"], "cada una sobre la anterior; la que falla no cambia la base");
    assert.equal(cola.base().hash, "p3");
    assert.equal(pendientes.at(-1), 0);
    const atrasado = p0;
    cola.sincronizar(atrasado);
    assert.equal(cola.base().hash, "p3", "un render atrasado (un plan que la cola ya vio) no pisa la última firma");
    cola.sincronizar({ hash: "del chat" });
    assert.equal(cola.base().hash, "del chat", "un plan nuevo que llega de fuera sí es la base");

    // El autoguardado encadena sus guardados por la cola: el segundo sale sobre el plan que firmó el primero.
    const reloj = relojFalso();
    const colaPatron = crearColaAjustes<Plan>(p0);
    const basesPatron: string[] = [];
    const liberar: Array<() => void> = [];
    const patron = crearAutoguardado<string>({
      enPlan: "espiral",
      iguales: (a, b) => a === b,
      esperaMs: 700,
      reloj: reloj.reloj,
      guardar: (valor) => colaPatron.encolar(async (base) => {
        basesPatron.push(`${valor}@${base.hash}`);
        await new Promise<void>((listo) => liberar.push(listo));
        return { hash: `${base.hash}+${valor}` };
      }).then(() => null, () => "falló"),
    });
    patron.cambiar("anillos", { inmediato: true });
    await vaciarPromesas();
    patron.cambiar("bloques");
    await reloj.avanzar(700);
    liberar.shift()!();
    await vaciarPromesas();
    await vaciarPromesas();
    liberar.shift()!();
    await vaciarPromesas();
    assert.deepEqual(basesPatron, ["anillos@p0", "bloques@p0+anillos"], "el segundo guardado usa el plan que devolvió el primero");
    assert.equal(colaPatron.base().hash, "p0+anillos+bloques");
  }
  ok("cola de la tarjeta: una edición a la vez, cada una sobre la última firma");

  // "Deshacer" solo mientras la edición (o la sesión del editor) sea lo último que cambió el plan.
  {
    type Plan = { hash: string };
    const p0: Plan = { hash: "p0" };
    const cola = crearColaAjustes<Plan>(p0);
    const firmar = (paso: string) => async (base: Plan): Promise<Plan> => ({ hash: `${base.hash}+${paso}` });
    const liberar: Array<() => void> = [];
    const firmarLento = (paso: string) => (base: Plan): Promise<Plan> => new Promise((listo) => liberar.push(() => listo({ hash: `${base.hash}+${paso}` })));
    const publicados: string[] = [];
    const publicar = (plan: Plan) => { publicados.push(plan.hash); };

    const sola = cola.tramo();
    assert.equal(sola.deshacible(), false, "sin ediciones no hay qué deshacer");
    await sola.encolar(firmar("colores"));
    await vaciarPromesas();
    assert.equal(sola.deshacible(), true);
    assert.equal(await sola.deshacer(publicar), true);
    assert.deepEqual(publicados, ["p0"], "vuelve al plan de antes, publicado en su turno");
    assert.equal(cola.base(), p0);
    assert.equal(sola.deshacible(), false, "deshecho una vez, no se deshace dos");

    // El caso del revisor: colores guardados con su Deshacer, tamaño en vuelo, Deshacer de los colores.
    const colores = cola.tramo();
    await colores.encolar(firmar("colores"));
    const tamano = cola.tramo().encolar(firmarLento("tamaño"));
    await vaciarPromesas();
    assert.equal(colores.deshacible(), false, "con otra edición en camino, el Deshacer anterior no se ofrece");
    const vuelta = colores.deshacer(publicar);
    liberar.shift()!();
    await tamano;
    assert.equal(await vuelta, false, "si igual se pulsa, la vuelta atrás no pisa lo que llegó después");
    assert.equal(cola.base().hash, "p0+colores+tamaño", "el cambio de tamaño sigue en el plan");
    assert.deepEqual(publicados, ["p0"], "y no se publicó ningún plan viejo");

    // Si la otra edición falla, el plan sigue siendo el de esta: sí se puede deshacer.
    const quitar = cola.tramo();
    await quitar.encolar(firmar("quitar"));
    await assert.rejects(cola.encolar(async () => { throw new Error("sin conexión"); }));
    await vaciarPromesas();
    assert.equal(quitar.deshacible(), true);

    // Sesión del editor: guardado, otra pieza entre medio, guardado. Deshacer la sesión borraría la otra pieza.
    const sesion = cola.tramo();
    await sesion.encolar(firmar("patrón1"));
    await cola.tramo().encolar(firmar("mezcla"));
    await sesion.encolar(firmar("patrón2"));
    await vaciarPromesas();
    assert.equal(sesion.deshacible(), false, "una edición ajena entre dos guardados de la sesión");
    const antesDelIntento = cola.base();
    assert.equal(await sesion.deshacer(() => assert.fail("no publica un plan que borre la mezcla")), false);
    assert.equal(cola.base(), antesDelIntento);

    // Sesión limpia: vuelve al plan de antes de su primer guardado que salió bien (un fallo no cuenta).
    const limpia = cola.tramo();
    const antes = cola.base();
    await assert.rejects(limpia.encolar(async () => { throw new Error("sin conexión"); }));
    await limpia.encolar(firmar("patrón1"));
    await limpia.encolar(firmar("patrón2"));
    await vaciarPromesas();
    assert.equal(limpia.deshacible(), true);
    assert.equal(await limpia.deshacer(publicar), true);
    assert.equal(cola.base(), antes);

    // Un plan que llega del chat reemplaza la base: la edición anterior ya no se deshace.
    const ultima = cola.tramo();
    await ultima.encolar(firmar("x"));
    cola.sincronizar({ hash: "del chat" });
    assert.equal(ultima.deshacible(), false);
    assert.equal(await ultima.deshacer(publicar), false);
    assert.equal(cola.base().hash, "del chat");
  }
  ok("cola de la tarjeta: Deshacer nunca borra una edición posterior");

  // Pie del editor y deslizadores: sin "Aplicar"; el estado del guardado a la vista.
  {
    const pie = (estado: VistaEstadoGuardado, extra: Partial<React.ComponentProps<typeof PieEditorPatron>> = {}) => renderToStaticMarkup(React.createElement(PieEditorPatron, {
      estado, avisoRegenerar: false, puedeQuitar: true, puedeRestablecer: true, tituloRestablecer: "Volver", onQuitar: () => undefined, onRestablecer: () => undefined, onListo: () => undefined, ...extra,
    }));
    const quieto = pie(null);
    const textoQuieto = textoVisible(quieto);
    assert.doesNotMatch(textoQuieto, /Aplicar/, "el editor ya no tiene Aplicar");
    assert.match(textoQuieto, /Quitar patrón Restablecer Listo/);
    assert.doesNotMatch(textoQuieto, /Guardando|guardad|No se guardó/, "antes del primer cambio el pie no dice nada");
    assert.match(quieto, /role="status" aria-live="polite"[^>]*data-testid="estado-patron"/, "la región que anuncia el guardado existe desde el principio");
    assert.match(textoVisible(pie({ tipo: "guardando" })), /Guardando…/);
    assert.match(textoVisible(pie(vistaDeAutoguardado({ fase: "guardado", motivo: null, guardados: 2 }, "Cambios guardados en tu propuesta", () => undefined))), /Cambios guardados en tu propuesta/);
    const conError = pie(vistaDeAutoguardado({ fase: "error", motivo: "No pudimos conectarnos.", guardados: 0 }, "x", () => undefined));
    assert.match(textoVisible(conError), /No se guardó: No pudimos conectarnos\. Reintentar/);
    const rechazo = textoVisible(pie(vistaDeAutoguardado({ fase: "rechazado", motivo: "Negro no aparece en el patrón.", guardados: 0 }, "x", () => undefined)));
    assert.match(rechazo, /No se guardó: Negro no aparece en el patrón\./);
    assert.doesNotMatch(rechazo, /Reintentar/, "reintentar un rechazo de Python daría lo mismo");
    assert.equal(vistaDeAutoguardado({ fase: "esperando", motivo: null, guardados: 0 }, "x", () => undefined)?.tipo, "guardando");
    assert.match(textoVisible(pie({ tipo: "guardando" }, { avisoRegenerar: true })), /La imagen se actualiza cuando pulses Regenerar visual/);
    assert.doesNotMatch(textoVisible(pie(null, { puedeQuitar: false })), /Quitar patrón/, "sin patrón no hay qué quitar");
    // "Crear patrón": abrir para mirar no guarda la sugerencia; se dice y se puede usar tal cual.
    const sugerencia = pie(null, { puedeQuitar: false, puedeRestablecer: false, onUsarSugerencia: () => undefined });
    assert.match(textoVisible(sugerencia), /Es una sugerencia: entra en tu propuesta cuando la ajustes o la uses\. Usar sugerencia/);
    assert.match(sugerencia, /<button type="button" data-testid="usar-sugerencia"/, "usarla es un botón");
    assert.doesNotMatch(textoVisible(sugerencia), /Guardando/, "sin un gesto del decorador no se está guardando nada");
    assert.doesNotMatch(textoQuieto, /Usar sugerencia|Es una sugerencia/, "con un patrón propio no se ofrece");

    const deslizadores = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: fixture, onPlanActualizado: () => undefined }));
    const textoDeslizadores = textoVisible(deslizadores);
    assert.ok((deslizadores.match(/data-testid="reparto-colores"/g) ?? []).length >= 1, "el reparto de colores sigue en el detalle");
    assert.ok((deslizadores.match(/data-testid="balance-tamanos"/g) ?? []).length >= 1);
    assert.doesNotMatch(textoDeslizadores, /Aplicar colores|Aplicar tamaños|Aplicando…|se recalculan al aplicar/, "los deslizadores guardan solos al soltar");
    assert.match(deslizadores, /role="status" aria-live="polite"[^>]*data-testid="estado-reparto-colores"/);
    assert.match(deslizadores, /role="status" aria-live="polite"[^>]*data-testid="estado-balance-tamanos"/);
    assert.match(deslizadores, /role="slider"[^>]*tabindex="0"/, "el reparto se sigue moviendo con el teclado");
  }
  ok("pie del editor y deslizadores: sin Aplicar, con el estado del guardado");
}

// 9. Vista previa en vivo del deslizador de colores sobre un confeti
// (vista-reparto.ts): una petición a la vez, gana el último reparto, se
// cancela al volver al plan y un fallo vuelve a la barra sola.
async function probarVistaReparto(): Promise<void> {
  type Pedido = { participaciones: readonly number[]; signal: AbortSignal; resolver: (valor: string) => void; rechazar: (error: unknown) => void };
  function bancoReparto({ intervaloMs = 100, oyeCancelar = true } = {}) {
    const { reloj, avanzar } = relojFalso();
    const pedidos: Pedido[] = [];
    const fallos: unknown[] = [];
    const control = crearVistaReparto<string>({
      reloj,
      intervaloMs,
      alFallar: (error) => fallos.push(error),
      pedir: (participaciones, signal) => new Promise<string>((resolver, rechazar) => {
        pedidos.push({ participaciones, signal, resolver, rechazar });
        if (oyeCancelar) signal.addEventListener("abort", () => rechazar(new DOMException("Cancelado", "AbortError")));
      }),
    });
    return { control, avanzar, pedidos, fallos };
  }

  {
    const { control, avanzar, pedidos } = bancoReparto();
    control.mostrar([0.5, 0.5]);
    assert.equal(pedidos.length, 1, "el primer movimiento se pide al instante");
    control.mostrar([0.45, 0.55]);
    control.mostrar([0.4, 0.6]);
    await avanzar(150);
    assert.equal(pedidos.length, 1, "nunca dos en vuelo: lo nuevo espera su turno");
    assert.equal(control.estado().actualizando, true);
    pedidos[0]!.resolver("dibujo 50/50");
    await vaciarPromesas();
    assert.equal(control.estado().vista, "dibujo 50/50", "cada respuesta se muestra aunque otra espere: la pieza cambia durante el arrastre");
    assert.deepEqual(control.estado().participaciones, [0.5, 0.5]);
    assert.equal(pedidos.length, 2, "al llegar, sale lo último");
    assert.deepEqual(pedidos[1]!.participaciones, [0.4, 0.6], "el reparto intermedio nunca se pide");
    pedidos[1]!.resolver("dibujo 40/60");
    await vaciarPromesas();
    assert.deepEqual(control.estado(), { vista: "dibujo 40/60", participaciones: [0.4, 0.6], actualizando: false, apagada: false });
    control.mostrar([0.4, 0.6]);
    await avanzar(500);
    assert.equal(pedidos.length, 2, "lo ya dibujado no se vuelve a pedir");
  }
  ok("reparto en vivo: una petición a la vez y gana el último reparto");

  {
    const { control, avanzar, pedidos } = bancoReparto({ intervaloMs: 100 });
    control.mostrar([0.5, 0.5]);
    pedidos[0]!.resolver("a");
    await vaciarPromesas();
    control.mostrar([0.6, 0.4]);
    assert.equal(pedidos.length, 1, "una respuesta rápida no se salta la pausa entre peticiones");
    await avanzar(99);
    assert.equal(pedidos.length, 1);
    await avanzar(1);
    assert.equal(pedidos.length, 2);
  }
  ok("reparto en vivo: entre el comienzo de dos peticiones pasa el intervalo");

  {
    const { control, avanzar, pedidos, fallos } = bancoReparto({ oyeCancelar: false });
    control.mostrar([0.3, 0.7]);
    pedidos[0]!.resolver("antes");
    await vaciarPromesas();
    control.mostrar([0.35, 0.65]);
    await avanzar(100);
    const enVuelo = pedidos[1]!;
    control.mostrar(null);
    assert.equal(enVuelo.signal.aborted, true, "volver al plan cancela lo que vuela");
    assert.deepEqual(control.estado(), { vista: null, participaciones: null, actualizando: false, apagada: false }, "y el dibujo previo se descarta: manda el plan");
    enVuelo.resolver("tarde");
    await vaciarPromesas();
    assert.equal(control.estado().vista, null, "una respuesta que llega tarde (aunque ignore la cancelación) no cuenta");
    assert.equal(fallos.length, 0, "cancelar no es un fallo");
    control.mostrar([0.35, 0.65]);
    await avanzar(100);
    assert.equal(pedidos.length, 3, "la próxima interacción vuelve a pedir lo mismo desde cero");
  }
  ok("reparto en vivo: volver al plan cancela y las respuestas viejas no cuentan");

  {
    const { control, avanzar, pedidos, fallos } = bancoReparto();
    control.mostrar([0.5, 0.5]);
    pedidos[0]!.resolver("dibujo");
    await vaciarPromesas();
    control.mostrar([0.6, 0.4]);
    await avanzar(100);
    pedidos[1]!.rechazar(new FalloPlanPatron("Esta pieza no tiene un patrón de color que dibujar."));
    await vaciarPromesas();
    assert.deepEqual(control.estado(), { vista: null, participaciones: null, actualizando: false, apagada: true }, "un fallo apaga la vista previa: la barra sigue sola");
    assert.equal(fallos.length, 1, "el fallo queda a la vista de quien depura");
    control.mostrar([0.7, 0.3]);
    await avanzar(500);
    assert.equal(pedidos.length, 2, "apagada, no insiste en la misma interacción");
    control.mostrar(null);
    control.mostrar([0.7, 0.3]);
    assert.equal(pedidos.length, 3, "de vuelta al plan, la próxima interacción lo intenta otra vez");
  }
  ok("reparto en vivo: un fallo vuelve a la barra sola, sin reintentos en la misma interacción");

  // Qué reparto se dibuja: solo el que va camino del plan. Uno que no se guardó
  // no: el bloque y el resumen mostrarían algo que "Aprobar" no firma (revisión 2026-09-24).
  {
    const plan = [50, 25, 25];
    const propio = [12, 63, 25];
    assert.deepEqual(repartoADibujar(propio, plan, { arrastrando: true, fase: "quieto" }), propio, "mientras se arrastra");
    assert.deepEqual(repartoADibujar(propio, plan, { arrastrando: false, fase: "esperando" }), propio, "esperando la pausa (teclado)");
    assert.deepEqual(repartoADibujar(propio, plan, { arrastrando: false, fase: "guardando" }), propio, "mientras se guarda, hasta que llega el plan firmado");
    assert.equal(repartoADibujar(propio, plan, { arrastrando: false, fase: "error" }), null, "un guardado que falló vuelve al dibujo del plan");
    assert.equal(repartoADibujar(propio, plan, { arrastrando: false, fase: "guardado" }), null);
    assert.equal(repartoADibujar([50, 25, 25], plan, { arrastrando: true, fase: "quieto" }), null, "lo que ya es el plan no se pide");
    assert.equal(repartoADibujar(null, plan, { arrastrando: false, fase: "guardando" }), null);
    assert.deepEqual(repartoADibujar(propio, plan, { arrastrando: true, fase: "error" }), propio, "tras un fallo, volver a arrastrar vuelve a dibujar");
  }
  ok("reparto en vivo: se dibuja lo que va camino del plan, nunca un reparto que no se guardó");

  // Los dibujos en vivo viven fuera de la tarjeta: cada respuesta avisa y cada pieza lee solo el suyo.
  {
    const vistas = crearVistasEnVivo<string>();
    let avisos = 0;
    const dejar = vistas.suscribir(() => { avisos += 1; });
    vistas.fijar("columna", "dibujo 12/63/25");
    assert.equal(vistas.vista("columna"), "dibujo 12/63/25");
    assert.equal(vistas.vista("arco"), null, "otra pieza sigue con su plan (su lectura no cambia y no se vuelve a pintar)");
    vistas.fijar("columna", "dibujo 12/63/25");
    assert.equal(avisos, 1, "el mismo dibujo no avisa otra vez");
    vistas.fijar("columna", null);
    assert.equal(vistas.vista("columna"), null, "null: de vuelta al dibujo del plan");
    vistas.fijar("arco", null);
    assert.equal(avisos, 2, "quitar lo que no estaba no avisa");
    dejar();
    vistas.fijar("columna", "otro");
    assert.equal(avisos, 2);
  }
  ok("reparto en vivo: los dibujos por pieza fuera del estado de la tarjeta");

  // El deslizador: cifras de Python cuando las hay (el patrón del plan), estimación sin patrón.
  {
    const colores = [{ etiqueta: "Blanco", fondo: "#fff", participacion: 0.5 }, { etiqueta: "Negro", fondo: "#000", participacion: 0.5 }];
    const fila = (material: number, unidades: number) => ({ material, color: null, acabado: null, unidades_por_instancia: unidades / 2, unidades_total: unidades });
    const conPatron = renderToStaticMarkup(React.createElement(RepartoColores, { colores, totalGlobos: 96, onGuardar: async () => null, conteo: [fila(0, 52), fila(1, 44)] }));
    assert.match(textoVisible(conPatron), /Blanco 52 globos Negro 44 globos/, "el conteo exacto de Python, sin ≈");
    assert.match(conPatron, /aria-label="Globos por color"[^>]*data-origen="python"/);
    const sinPatron = renderToStaticMarkup(React.createElement(RepartoColores, { colores, totalGlobos: 96, onGuardar: async () => null }));
    assert.match(textoVisible(sinPatron), /Blanco ≈ 48 globos Negro ≈ 48 globos/);
    assert.match(sinPatron, /data-origen="estimado"/);
    assert.doesNotMatch(sinPatron, /data-testid="reparto-avisos"/);

    // El bloque con el dibujo en vivo de su pieza: lo que el plan ya decía se queda; lo nuevo del reparto lo dice el deslizador (una sola vez).
    const columna = resueltoDe("EST_01_COLUMNA");
    const aviso = columna.avisos[0]!;
    const nuevo = "Los acentos y los globos pintados a mano se integraron al confeti para respetar el reparto que elegiste.";
    const propsBloque = { leyenda: leyendaDe("EST_01_COLUMNA"), tipo: "columna", repeticiones: 2, nombrePieza: "Columna" };
    const bloque = (vivo: PatronColorResuelto | null) => {
      const vistas = crearVistasEnVivo<PatronColorResuelto>();
      vistas.fijar("EST_01_COLUMNA", vivo);
      return renderToStaticMarkup(React.createElement(BloquePatron, { ...propsBloque, resuelto: columna, enVivo: { vistas, id: "EST_01_COLUMNA" } }));
    };
    const vivo = { ...columna, conteo: columna.conteo.map((fila, indice) => ({ ...fila, unidades_total: indice === 0 ? 12 : fila.unidades_total })), avisos: [nuevo, aviso] };
    assert.match(textoVisible(bloque(null)), /Con cuartetos completos/);
    assert.doesNotMatch(bloque(null), /así queda con tu reparto|data-en-vivo/);
    const enVivo = bloque(vivo);
    assert.match(enVivo, /data-en-vivo="true"/);
    assert.match(textoVisible(enVivo), /así queda con tu reparto/);
    assert.match(textoVisible(enVivo), /1 Blanco mate 12 ·/, "el conteo del dibujo en vivo, el de Python");
    assert.match(textoVisible(enVivo), /Con cuartetos completos/, "en vivo, lo que el plan ya decía no se mueve");
    assert.doesNotMatch(textoVisible(enVivo), /se integraron al confeti/, "un aviso que trae el reparto nuevo va junto al deslizador");
    const otraPieza = crearVistasEnVivo<PatronColorResuelto>();
    otraPieza.fijar("EST_02_ARCO", vivo);
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(BloquePatron, { ...propsBloque, resuelto: columna, enVivo: { vistas: otraPieza, id: "EST_01_COLUMNA" } })), /data-en-vivo/, "cada bloque lee solo el dibujo de su pieza");

    // Una columna en confeti: la tarjeta ofrece el deslizador con el conteo del plan que firmó Python.
    const vistas = JSON.parse(readFileSync(resolve(process.cwd(), "scripts/fixtures/patron-color-ui/vistas-previas.json"), "utf8")) as Record<string, { porEstilo: Record<string, PatronColorResuelto> }>;
    const confeti = PatronColorResueltoSchema.parse(vistas.EST_01_COLUMNA!.porEstilo.aleatorio);
    const planConfeti = structuredClone(planPatrones);
    planConfeti.plan.estructuras.find((estructura) => estructura.estructura_id === "EST_01_COLUMNA")!.patron_color = confeti.patron;
    planConfeti.patrones_color = planConfeti.patrones_color!.map((patron) => (patron.estructura_id === "EST_01_COLUMNA" ? { ...confeti, aplicado: true } : patron));
    const tarjeta = renderToStaticMarkup(React.createElement(TarjetaPlanDecoracion, { plan: planConfeti, onPlanActualizado: () => undefined }));
    assert.equal((tarjeta.match(/Arrastra para cambiar cuánto lleva de cada color/g) ?? []).length, 2, "el confeti vuelve a tener su deslizador (y la guirnalda sin patrón)");
    assert.equal((tarjeta.match(/data-origen="python"/g) ?? []).length, 1, "las cifras del confeti son las de Python");
    for (const fila of confeti.conteo) assert.match(textoVisible(tarjeta), new RegExp(`${fila.unidades_total} globos`));
    // En un teléfono el dibujo va arriba: el deslizador del confeti queda dentro del bloque, justo bajo el nombre del patrón
    // y antes de la frase, el conteo y los botones, para ver la pieza entera mientras se mueve (revisión 2026-09-24).
    const bloques = tarjeta.split('data-testid="bloque-patron"').slice(1).map((resto) => resto.slice(0, resto.indexOf("</section>")));
    const bloqueConfeti = bloques.find((html) => html.includes(">Confeti<")) ?? "";
    assert.ok(bloqueConfeti, "el confeti tiene su bloque");
    const posicion = (marca: string) => bloqueConfeti.indexOf(marca);
    assert.ok(posicion("<svg") >= 0 && posicion("<svg") < posicion('data-testid="reparto-colores"'), "primero el dibujo");
    assert.ok(posicion('data-testid="reparto-colores"') < posicion(confeti.descripcion.slice(0, 20)), "el deslizador antes de la frase de Python");
    assert.ok(posicion('data-testid="reparto-colores"') < posicion('data-testid="editar-patron"'), "y antes de los botones");
    assert.equal(bloques.filter((html) => html.includes('data-testid="reparto-colores"')).length, 1, "solo el confeti lo lleva dentro");
  }
  ok("deslizador de colores: cifras de Python con patrón, estimación sin él, avisos una sola vez");
}

// 10. Avisos de Python sobre una edición (/api/plan-editar), tal cual y sin repetir.
{
  const frase = "El patrón se rehízo porque quitaste un color.";
  assert.deepEqual(avisosDeEdicion({ plan: {}, avisos: [frase, frase, "Los acentos y los globos pintados a mano se integraron al confeti para respetar el reparto que elegiste."] }), [frase, "Los acentos y los globos pintados a mano se integraron al confeti para respetar el reparto que elegiste."]);
  assert.deepEqual(avisosDeEdicion({ plan: {} }), [], "sin avisos, ninguno");
  assert.deepEqual(avisosDeEdicion({ avisos: frase }), [], "algo que no es una lista no se muestra");
  assert.deepEqual(avisosDeEdicion({ avisos: [1, frase] }), []);
  assert.deepEqual(avisosDeEdicion(null), []);
  ok("avisos de la edición: los de Python, tal cual");
}

// 11. Estilos que admite una pieza: vienen con la vista previa y con su rechazo (aunque Python no pueda sugerir).
async function probarModosAdmitidos(): Promise<void> {
  const resuelto = resueltoDe("EST_01_COLUMNA");
  const responder = (datos: unknown, status = 200) => new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json" } });
  const cuerpo = { plan: planPatrones.plan, estructura_id: "EST_01_COLUMNA", patron_color: null };
  const detallada = await pedirVistaPatronDetallada({ ...cuerpo, modo: "anillos" }, { fetcher: async () => responder({ patron: resuelto, modos_admitidos: MODOS_COLUMNA }) });
  assert.deepEqual(detallada.modos_admitidos, MODOS_COLUMNA);
  await assert.rejects(pedirVistaPatronDetallada(cuerpo, { fetcher: async () => responder({ patron: resuelto }) }), FalloPlanPatron, "una respuesta sin estilos no vale");
  await assert.rejects(pedirVistaPatronDetallada(cuerpo, { fetcher: async () => responder({ patron: resuelto, modos_admitidos: [{ modo: "rombos", direcciones: ["longitudinal"], espejo: false }] }) }), FalloPlanPatron, "ni con un estilo fuera del contrato");

  // Sin sugerencia: el rechazo de Python ya trae los estilos de la pieza; una sola petición.
  const sinPreset = {
    error: "El color dorado (5) no queda en ningún globo del patrón.",
    causa: "PATRON_INVALIDO",
    motivo: "material_sin_uso",
    mensaje: "El color dorado (5) no queda en ningún globo del patrón.",
    modos_admitidos: MODOS_COLUMNA,
  };
  let pedidos = 0;
  await assert.rejects(
    pedirVistaPatronDetallada(cuerpo, { fetcher: async () => { pedidos += 1; return responder(sinPreset, 422); } }),
    (error: unknown) => error instanceof FalloPlanPatron && error.patronInvalido && error.motivo === "material_sin_uso" && error.message === sinPreset.mensaje && JSON.stringify(error.modosAdmitidos) === JSON.stringify(MODOS_COLUMNA),
  );
  assert.equal(pedidos, 1, "no se pregunta estilo por estilo");
  // Estilos fuera del contrato, repetidos o que no son una lista: no cuenta ninguno.
  for (const modos of [[admitido("anillos"), { modo: "rombos", direcciones: ["longitudinal"], espejo: false }], [...MODOS_COLUMNA, admitido("espiral")], [{ ...admitido("flor"), extra: 1 }], "espiral"]) {
    await assert.rejects(
      pedirVistaPatronDetallada(cuerpo, { fetcher: async () => responder({ ...sinPreset, modos_admitidos: modos }, 422) }),
      (error: unknown) => error instanceof FalloPlanPatron && error.patronInvalido && error.modosAdmitidos === null,
      JSON.stringify(modos),
    );
  }
  // Un rechazo que no es del patrón no dice estilos aunque el cuerpo los traiga.
  await assert.rejects(
    pedirVistaPatronDetallada(cuerpo, { fetcher: async () => responder({ error: "No se encontró la estructura seleccionada.", modos_admitidos: MODOS_COLUMNA }, 404) }),
    (error: unknown) => error instanceof FalloPlanPatron && !error.patronInvalido && error.modosAdmitidos === null,
  );

  // Cambiar de estilo lleva el borrador (`desde`) con `modo`: Python decide qué conserva.
  const borrador = declaradaDe("EST_01_COLUMNA").patron_color!;
  let enviado: Record<string, unknown> = {};
  await pedirVistaPatronDetallada({ ...cuerpo, modo: "anillos", desde: borrador }, {
    fetcher: async (_url, init) => {
      enviado = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return responder({ patron: resuelto, modos_admitidos: MODOS_COLUMNA });
    },
  });
  assert.deepEqual([enviado.modo, enviado.desde, enviado.patron_color], ["anillos", borrador, null]);
  ok("estilos de la pieza: con la vista previa y con su rechazo; cambiar de estilo lleva el borrador");
}

probarPeticionPatron()
  .then(probarAutoguardado)
  .then(probarVistaReparto)
  .then(probarModosAdmitidos)
  .then(() => console.log(`\n${casos} casos OK (propuesta, cotización, análisis de foto, patrón de color y autoguardado)`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
