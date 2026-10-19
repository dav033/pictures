/**
 * Guía de estructura para la imagen (ADR-0033). Determinista y sin red:
 * `globalThis.fetch` se sustituye donde haría falta.
 *
 * - La guía: SVG sin texto ni NaN, un disco por globo del armado o del patrón,
 *   colores iguales a los del plan, pared sin piso; PNG del tamaño esperado.
 * - La carta: franjas planas, sin una letra.
 * - Cuándo se usa: bandera, foto del espacio, resultado previo, híbrido,
 *   formato; una sola estructura con armado o patrón.
 * - La petición a fal: con guía, `/edit` con `image_urls[0]` = guía y la carta
 *   después, sus notas en el prompt; sin ella, byte a byte la de antes
 *   (`scripts/fixtures/guia-estructura/peticiones-base.json`, capturada una vez
 *   sobre 90da1ef y nunca regenerada desde este código).
 * - El filtro de `generarConSempertexFlux` que tiraba las imágenes elegidas
 *   sin foto del espacio (`REFERENCIA_EN_ETAPA1_V1` sin efecto).
 * - El caption con guía cabe en `FLUX_PROMPT_MAX_LENGTH` y pasa el preflight.
 * - La medida de evaluación (`scripts/lib/medir-guia.ts`) y la vista previa de
 *   la corrida pagada, que no gasta.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-guia-estructura.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { configurarPersistenciaTelemetria, ultimosEventos } from "@sempertex/agente-core";
import { FLUX_PROMPT_MAX_LENGTH } from "@/lib/ia/kagutsuchi/caption-flux";
import { findFluxPromptLanguageLeaks, findFluxPromptProductLeaks } from "@/lib/ia/kagutsuchi/preflight-flux";
import {
  CARTA,
  costeEntradasUsdEstimado,
  discosDeGuia,
  elegirCaptionConGuia,
  estructuraParaGuia,
  FONDO_GUIA,
  generacionAdmiteGuia,
  svgCarta,
  svgGuia,
  tamanoGuia,
  type DiscoGuia,
} from "@/lib/ia/kagutsuchi/guia-estructura";
import { prepararGuiaEstructura } from "@/lib/ia/kagutsuchi/rasterizar-guia";
import {
  buildFluxEditPrompt,
  generarConSempertexFlux,
  imageSizeFor,
  FLUX_EDIT_PROMPT_MAX_LENGTH,
  NOTA_GUIA_ESTRUCTURA,
  notaCartaColor,
  PROMPT_VERSION_GUIA,
  reservaNotasGuia,
  type ImagenGuiaFlux,
} from "@/lib/ia/kagutsuchi/flux";
import { featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { CAPTION_DE_PRUEBA, capturarPeticion, casosBase, imagenDePrueba, FLUX_DE_PRUEBA, type PeticionCapturada } from "../lib/capturar-peticion-flux";

const CAPTION_BASE = CAPTION_DE_PRUEBA.replace(/^eventdecor_style_v3,\s*/, "");
import { captionDeCaso, casoArcoPatron, casoGuirnaldaPared, planDeUnaEstructura } from "../lib/escenas-guia-estructura";
import { planGuirnalda } from "../lib/escenas-armado-guirnalda";
import { medirColores, medirSilueta, type Pixeles } from "../lib/medir-guia";

configurarPersistenciaTelemetria(undefined);

// La prueba pasa un LoRA de prueba (`FLUX_DE_PRUEBA`) para comparar byte a byte con la instantánea 90da1ef: con adaptador
// el destino es /lora/edit. El camino real (loras: []) va a /flux-2/edit y lo cubren las pruebas de edición FLUX.
const EDIT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const TEXTO = "https://queue.fal.run/fal-ai/flux-2/lora";
const BASE = JSON.parse(readFileSync(path.join("scripts", "fixtures", "guia-estructura", "peticiones-base.json"), "utf8")) as { directo: Record<string, PeticionCapturada> };
const HEX: Readonly<Record<string, string>> = HEX_COLORES_V2;
const HEX_PLAN: Readonly<Record<string, string>> = {
  ...HEX,
  // Estos fixtures compran Fashion Rosado 009 y Fashion Amarillo 020. Sus
  // tintas son hexes de catálogo; la taxonomía solo guarda muestras genéricas.
  rosado: "#f8a3bc",
  amarillo: "#fedd00",
};

function rellenos(svg: string): Set<string> {
  return new Set([...svg.matchAll(/<ellipse [^>]*fill="(#[0-9a-f]{6})"/g)].map((coincidencia) => coincidencia[1]!));
}

function contar(svg: string, etiqueta: string): number {
  return (svg.match(new RegExp(`<${etiqueta}[ >]`, "g")) ?? []).length;
}

function sinEtiquetas(svg: string): string {
  return svg.replace(/<[^>]*>/g, "").trim();
}

function coloresDelPlan(plan: PlanResuelto): Set<string> {
  const colores = plan.armados_guirnalda?.[0]?.leyenda.map((entrada) => entrada.color) ?? plan.patrones_color?.[0]?.conteo.map((fila) => fila.color) ?? [];
  return new Set(colores.map((color) => {
    const normalizado = color?.toLowerCase() ?? "";
    return /^#[0-9a-f]{6}$/.test(normalizado) ? normalizado : HEX_PLAN[color ?? ""] ?? "sin-hex";
  }));
}

async function pixelesDeSvg(svg: string): Promise<Pixeles> {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { ancho: info.width, alto: info.height, rgb: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

// ---------------------------------------------------------------------------
// 1. La guía y la carta.
// ---------------------------------------------------------------------------

async function guiaYCarta(): Promise<void> {
  const tamano = tamanoGuia(imageSizeFor("3:2"));
  assert.deepEqual(tamano, { ancho: 1024, alto: 683 });
  assert.deepEqual(tamanoGuia(imageSizeFor("2:3")), { ancho: 683, alto: 1024 });

  for (const caso of [casoGuirnaldaPared(), casoArcoPatron()]) {
    const estructura = estructuraParaGuia(caso.plan);
    assert.ok(estructura, `${caso.nombre}: una estructura con armado o patrón admite guía`);
    const { discos, sobrePiso } = discosDeGuia(estructura);
    const svg = svgGuia(discos, sobrePiso, tamano);
    assert.equal(svg, svgGuia(discosDeGuia(estructuraParaGuia(caso.plan)!).discos, sobrePiso, tamano), `${caso.nombre}: el mismo plan da el mismo SVG`);
    assert.doesNotMatch(svg, /<text|font|url\(#|Gradient|filter|opacity|NaN|Infinity|undefined/, `${caso.nombre}: sin texto, degradados, sombras ni valores rotos`);
    assert.equal(sinEtiquetas(svg), "", `${caso.nombre}: sin una letra`);
    const globos = caso.nombre === "guirnalda-pared" ? caso.plan.armados_guirnalda![0]!.globos_por_instancia : caso.plan.patrones_color![0]!.globos_por_instancia;
    assert.equal(contar(svg, "ellipse"), globos, `${caso.nombre}: un disco por globo`);
    assert.deepEqual(rellenos(svg), coloresDelPlan(caso.plan), `${caso.nombre}: los colores son los del plan`);
    // La pared es el fondo: sin piso. El arco se apoya en el piso: fondo y plano de piso.
    assert.equal(contar(svg, "rect"), caso.nombre === "guirnalda-pared" ? 1 : 2, `${caso.nombre}: soporte`);
    assert.match(svg, new RegExp(`fill="${FONDO_GUIA}"`));
  }

  const guirnalda = await prepararGuiaEstructura(casoGuirnaldaPared().plan, "3:2");
  assert.ok(guirnalda);
  const [guia, carta] = guirnalda.imagenes;
  assert.deepEqual([guia.role, carta.role], ["structure_guide", "color_chart"]);
  const metaGuia = await sharp(Buffer.from(guia.base64, "base64")).metadata();
  assert.deepEqual([metaGuia.format, metaGuia.width, metaGuia.height], ["png", 1024, 683]);
  const metaCarta = await sharp(Buffer.from(carta.base64, "base64")).metadata();
  assert.deepEqual([metaCarta.format, metaCarta.width, metaCarta.height], ["png", CARTA.ancho, CARTA.alto]);
  assert.match(guirnalda.sha256, /^[0-9a-f]{64}$/);
  assert.ok(guirnalda.bytes < 200_000, `colores planos: ${guirnalda.bytes} bytes`);
  const vertical = await prepararGuiaEstructura(casoArcoPatron().plan, "2:3");
  const metaVertical = await sharp(Buffer.from(vertical!.imagenes[0].base64, "base64")).metadata();
  assert.deepEqual([metaVertical.width, metaVertical.height], [683, 1024], "la guía sigue el aspecto pedido");

  const cartaSvg = svgCarta(["#FFFFFF", "#f2a7c3", "no-es-hex", "#c9a227"]);
  assert.equal(sinEtiquetas(cartaSvg), "", "la carta no tiene una letra");
  assert.deepEqual([...new Set([...cartaSvg.matchAll(/<(\w+)/g)].map((coincidencia) => coincidencia[1]))], ["svg", "rect"], "solo franjas");
  assert.deepEqual([...cartaSvg.matchAll(/fill="([^"]+)"/g)].map((coincidencia) => coincidencia[1]), ["#ffffff", "#f2a7c3", "#c9a227"]);
  assert.throws(() => svgCarta([]), /al menos un color/);
  assert.throws(() => svgGuia([], false, tamano), /no tiene globos/);
  assert.throws(() => svgGuia([{ x: Number.NaN, y: 0, r: 1, hex: "#ffffff" }], false, tamano), /no finito/);
  assert.throws(() => svgGuia([{ x: 0, y: 0, r: 1, hex: "url(#x)" } as DiscoGuia], false, tamano), /fuera de formato/);
  console.log("[PASS] guía plana y carta: discos por globo con los colores del plan, sin texto, PNG del tamaño pedido");
}

// ---------------------------------------------------------------------------
// 2. Cuándo hay guía.
// ---------------------------------------------------------------------------

async function cuandoHayGuia(): Promise<void> {
  const original = process.env.GUIA_ESTRUCTURA_V1;
  delete process.env.GUIA_ESTRUCTURA_V1;
  assert.equal(featureEnabled("GUIA_ESTRUCTURA_V1"), false, "apagada por defecto");
  process.env.GUIA_ESTRUCTURA_V1 = "true";
  assert.equal(featureEnabled("GUIA_ESTRUCTURA_V1"), true);
  if (original === undefined) delete process.env.GUIA_ESTRUCTURA_V1;
  else process.env.GUIA_ESTRUCTURA_V1 = original;

  const admite = { bandera: true, usarFlux: true, hibrido: false, fotoEspacio: false, resultadoPrevio: false, editApagado: false, formatoTexto: true };
  assert.equal(generacionAdmiteGuia(admite), true, "sin foto del espacio, con la bandera: guía");
  assert.equal(generacionAdmiteGuia({ ...admite, bandera: false }), false, "bandera apagada: nunca");
  assert.equal(generacionAdmiteGuia({ ...admite, fotoEspacio: true }), false, "con foto del espacio no se usa (pendiente)");
  assert.equal(generacionAdmiteGuia({ ...admite, hibrido: true, fotoEspacio: true }), false, "híbrido: no");
  assert.equal(generacionAdmiteGuia({ ...admite, resultadoPrevio: true }), false, "una revisión edita su resultado previo");
  assert.equal(generacionAdmiteGuia({ ...admite, editApagado: true }), false, "SEMPERTEX_FLUX_EDIT=false");
  assert.equal(generacionAdmiteGuia({ ...admite, formatoTexto: false }), false, "solo el caption de texto");
  assert.equal(generacionAdmiteGuia({ ...admite, usarFlux: false }), false, "Gemini no la recibe");

  // Varias estructuras, repeticiones, sin armado: sin guía.
  const conDos = planGuirnalda("pared").plan;
  assert.equal(conDos.estructuras.length, 2);
  assert.equal(estructuraParaGuia(conDos), null, "dos estructuras: sin guía");
  assert.equal(await prepararGuiaEstructura(conDos, "3:2"), null);
  const completo = JSON.parse(readFileSync(path.join("scripts", "fixtures", "patron-color-ui", "plan-con-patrones.json"), "utf8")) as PlanResuelto;
  assert.equal(estructuraParaGuia(completo), null, "cuatro estructuras con patrón: sin guía");
  assert.equal(estructuraParaGuia(planDeUnaEstructura(completo, "EST_01_COLUMNA")), null, "dos columnas iguales (repeticiones 2): sin guía");
  assert.equal(estructuraParaGuia(planDeUnaEstructura(completo, "EST_03_PARED")), null, "una pared (rejilla): fuera de esta entrega");
  assert.equal(estructuraParaGuia(planDeUnaEstructura(completo, "EST_04_GUIRNALDA")), null, "guirnalda con patrón pero sin armado: sin racimos que dibujar");
  assert.equal(estructuraParaGuia(planDeUnaEstructura(planGuirnalda("pared-sin-armado").plan, "EST_01_GUIRNALDA")), null, "guirnalda sin armado");
  // Solo cuenta que haya un prop: su contenido no importa para esta decisión.
  const conProp = { ...casoArcoPatron().plan, props: [{} as NonNullable<PlanResuelto["props"]>[number]] };
  assert.equal(estructuraParaGuia(conProp), null, "un prop de catálogo es otra pieza");
  assert.equal(estructuraParaGuia({ ...casoArcoPatron().plan, patrones_color: casoArcoPatron().plan.patrones_color!.map((patron) => ({ ...patron, aplicado: false })) }), null, "una sugerencia de patrón no aplicada");
  console.log("[PASS] cuándo: bandera, sin foto del espacio ni revisión, una sola estructura con armado o patrón");
}

// ---------------------------------------------------------------------------
// 3. El prompt con guía.
// ---------------------------------------------------------------------------

const GUIA: ImagenGuiaFlux = { id: "STRUCTURE_GUIDE", role: "structure_guide", base64: "R1VJQQ==", mime: "image/png" };
const CARTA_IMG: ImagenGuiaFlux = { id: "COLOR_CHART", role: "color_chart", base64: "Q0FSVEE=", mime: "image/png" };

function promptConGuia(): void {
  const conCarta = buildFluxEditPrompt(CAPTION_BASE, [GUIA, CARTA_IMG]);
  assert.equal(conCarta, `${NOTA_GUIA_ESTRUCTURA}\n\n${CAPTION_BASE}\n\n${notaCartaColor(2)}`, "nota delante, caption, nota de la carta");
  assert.equal(conCarta.length - CAPTION_BASE.length, reservaNotasGuia(true), "la reserva mide exactamente las notas");
  const sinCarta = buildFluxEditPrompt(CAPTION_BASE, [GUIA]);
  assert.equal(sinCarta.length - CAPTION_BASE.length, reservaNotasGuia(false));
  assert.doesNotMatch(sinCarta, /color chart/);
  for (const prompt of [conCarta, sinCarta]) {
    assert.deepEqual(findFluxPromptLanguageLeaks(prompt), [], prompt);
    assert.deepEqual(findFluxPromptProductLeaks(prompt), [], prompt);
    assert.doesNotMatch(prompt, /INPUT IMAGES|STRUCTURE_GUIDE|COLOR_CHART/, "sin el bloque de referencias ni ids");
  }
  assert.throws(() => buildFluxEditPrompt(CAPTION_BASE, [CARTA_IMG, GUIA]), /FLUX_GUIA_INVALIDA/, "la guía va primera");
  assert.throws(() => buildFluxEditPrompt(CAPTION_BASE, [GUIA, imagenDePrueba("composition_reference", 1, "R1")]), /FLUX_GUIA_INVALIDA/, "la guía no se mezcla con referencias");
  assert.throws(() => buildFluxEditPrompt(CAPTION_BASE, [GUIA, CARTA_IMG, CARTA_IMG]), /FLUX_GUIA_INVALIDA/);

  // La carta acompaña ambos captions actuales porque caben dentro del límite.
  // `elegirCaptionConGuia` solo la quita cuando el prompt no cabe con ella.
  for (const [caso, cartaEsperada] of [[casoArcoPatron(), true], [casoGuirnaldaPared(), true]] as const) {
    const elegido = elegirCaptionConGuia<ReturnType<typeof captionDeCaso>, ImagenGuiaFlux>({
      imagenes: [GUIA, CARTA_IMG],
      maximo: FLUX_PROMPT_MAX_LENGTH,
      reserva: reservaNotasGuia,
      compilar: (maxLength) => captionDeCaso(caso, maxLength),
      cabe: (compilacion, imagenes) => buildFluxEditPrompt(compilacion.prompt, imagenes).length <= FLUX_PROMPT_MAX_LENGTH,
    });
    assert.ok(elegido, `${caso.nombre}: la guía cabe`);
    assert.equal(elegido.imagenes.length > 1, cartaEsperada, `${caso.nombre}: carta`);
    const final = buildFluxEditPrompt(elegido.compilacion.prompt, elegido.imagenes);
    assert.ok(final.length <= FLUX_PROMPT_MAX_LENGTH, `${caso.nombre}: ${final.length}`);
    assert.ok(final.length <= FLUX_EDIT_PROMPT_MAX_LENGTH);
  }
  const nunca = elegirCaptionConGuia({ imagenes: ["guia", "carta"], maximo: 10, reserva: () => 5, compilar: (maxLength) => ({ prompt: "x".repeat(maxLength + 1) }), cabe: () => false });
  assert.equal(nunca, null, "si no cabe ni sin carta, sin guía");
  const intentos: number[] = [];
  elegirCaptionConGuia({ imagenes: ["guia", "carta"], maximo: 750, reserva: reservaNotasGuia, compilar: (maxLength) => { intentos.push(maxLength); return maxLength; }, cabe: () => false });
  assert.deepEqual(intentos, [750 - reservaNotasGuia(true), 750 - reservaNotasGuia(false)], "primero con carta, después sin ella");
  assert.equal(costeEntradasUsdEstimado(2), 0.042);
  console.log("[PASS] prompt con guía: nota delante, carta al final, caption base sin trigger, sin español ni ids, dentro del presupuesto del LoRA");
}

// ---------------------------------------------------------------------------
// 4. Lo que llega a fal.
// ---------------------------------------------------------------------------

async function peticionAFal(): Promise<void> {
  const opciones = { loras: [FLUX_DE_PRUEBA], seed: 101, guidanceScale: 3.5 };
  // Sin guía (bandera apagada): byte a byte lo de antes, camino por camino.
  for (const [nombre, inputs] of Object.entries(casosBase())) {
    const esperado = BASE.directo[nombre];
    assert.ok(esperado, `la instantánea no tiene ${nombre}`);
    const capturada = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", inputs, opciones);
    assert.equal(capturada.destino, esperado.destino, `${nombre}: endpoint`);
    assert.equal(JSON.stringify(capturada.cuerpo), JSON.stringify(esperado.cuerpo), `${nombre}: el cuerpo cambió respecto a 90da1ef`);
  }

  // Con guía, sin foto del espacio: /edit, la guía primera y la carta después.
  const guia = (await prepararGuiaEstructura(casoArcoPatron().plan, "3:2"))!;
  const conGuia = await capturarPeticion(generarConSempertexFlux, CAPTION_BASE, "3:2", casosBase()["solo-productos"]!, { ...opciones, imagenesEdit: guia.imagenes });
  assert.equal(conGuia.destino, EDIT);
  const cuerpo = conGuia.cuerpo as { prompt: string; image_urls: string[]; image_size: unknown };
  assert.deepEqual(cuerpo.image_urls, [`data:image/png;base64,${guia.imagenes[0].base64}`, `data:image/png;base64,${guia.imagenes[1].base64}`], "image_urls[0] es la guía; las fotos de producto no entran");
  assert.ok(cuerpo.prompt.startsWith(`${NOTA_GUIA_ESTRUCTURA}\n\n`), cuerpo.prompt);
  assert.ok(cuerpo.prompt.endsWith(notaCartaColor(2)), cuerpo.prompt);
  assert.deepEqual(cuerpo.image_size, { width: 1536, height: 1024 });
  const evento = ultimosEventos()[0]!;
  assert.equal(evento.modelo, "flux-2/lora/edit");
  assert.equal(evento.promptVersion, PROMPT_VERSION_GUIA, "la telemetría distingue la llamada con guía");
  assert.equal(evento.bytesImagenEntrada, guia.bytes, "cuenta los bytes de la guía y la carta");
  await capturarPeticion(generarConSempertexFlux, CAPTION_BASE, "3:2", [], opciones);
  assert.equal(ultimosEventos()[0]!.promptVersion, undefined, "sin guía, el evento de siempre");

  console.log("[PASS] fal: sin guía byte a byte la de 90da1ef; con guía /edit con image_urls[0] = guía y la carta después");
}

// ---------------------------------------------------------------------------
// 5. Regresión: el filtro tiraba las imágenes que la ruta eligió.
// ---------------------------------------------------------------------------

async function filtroDeImagenes(): Promise<void> {
  const opciones = { loras: [FLUX_DE_PRUEBA], seed: 101, guidanceScale: 3.5 };
  const referencias = casosBase()["referencias-hibrido"]!;
  // Antes (y todavía sin `imagenesEdit`): sin venue ni resultado previo, las
  // referencias de la etapa 1 se descartaban y la llamada iba a texto.
  const filtradas = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", referencias, opciones);
  assert.equal(filtradas.destino, TEXTO);
  // Elegidas por la ruta (REFERENCIA_EN_ETAPA1_V1): llegan a /edit, en su orden.
  const elegidas = await capturarPeticion(generarConSempertexFlux, CAPTION_BASE, "3:2", [], { ...opciones, imagenesEdit: referencias });
  assert.equal(elegidas.destino, EDIT, "REFERENCIA_EN_ETAPA1_V1 por fin cambia lo que recibe fal");
  const cuerpo = elegidas.cuerpo as { prompt: string; image_urls: string[] };
  assert.equal(cuerpo.image_urls.length, 2);
  assert.match(cuerpo.prompt, /No venue base; create venue from prompt\./);
  assert.match(cuerpo.prompt, /Input image 1 \(@image1\): composition only/);
  // Una lista explícita vacía es texto a imagen, igual que sin imágenes.
  const vacia = await capturarPeticion(generarConSempertexFlux, CAPTION_DE_PRUEBA, "3:2", referencias, { ...opciones, imagenesEdit: [] });
  assert.equal(JSON.stringify(vacia.cuerpo), JSON.stringify(BASE.directo["sin-imagenes"]!.cuerpo));
  console.log("[PASS] regresión: las imágenes elegidas por la ruta ya no se descartan sin foto del espacio");
}

// ---------------------------------------------------------------------------
// 6. La medida de evaluación.
// ---------------------------------------------------------------------------

async function medida(): Promise<void> {
  const tamano = tamanoGuia(imageSizeFor("3:2"));
  const estructura = estructuraParaGuia(casoGuirnaldaPared().plan)!;
  const { discos } = discosDeGuia(estructura);
  const guia = await pixelesDeSvg(svgGuia(discos, false, tamano));
  const objetivos = [...new Set(discos.map((disco) => disco.hex))].map((hex) => ({ hex, nombre: hex }));

  const identica = medirSilueta(guia, guia)!;
  assert.equal(identica.iouAlineada, 1);
  assert.equal(identica.iouEncuadre, 1);
  const colores = medirColores(guia, objetivos);
  assert.ok(colores.ok, JSON.stringify(colores));
  assert.ok(colores.colores.find((color) => color.objetivo.hex === "#ffffff")!.neutro, "el blanco no se juzga");

  // La misma guirnalda más chica, corrida y sobre otro fondo: la forma se conserva.
  const movidos: DiscoGuia[] = discos.map((disco) => ({ ...disco, x: disco.x * 0.6 + 40, y: disco.y * 0.6 - 10, r: disco.r * 0.6 }));
  const otraFoto = await pixelesDeSvg(svgGuia(movidos, false, tamano).replace(`fill="${FONDO_GUIA}"`, 'fill="#8f8a84"'));
  const movida = medirSilueta(otraFoto, guia)!;
  assert.ok(movida.iouAlineada > 0.85, `forma conservada: ${movida.iouAlineada}`);

  // Un "arco con patas": la guirnalda con dos columnas hasta el piso.
  const pata = (x: number): DiscoGuia[] => Array.from({ length: 8 }, (_, indice) => ({ x, y: 30 + indice * 16, r: 8, hex: "#c9a227" }));
  const conPatas = await pixelesDeSvg(svgGuia([...discos, ...pata(Math.min(...discos.map((disco) => disco.x))), ...pata(Math.max(...discos.map((disco) => disco.x)))], false, tamano));
  const patas = medirSilueta(conPatas, guia)!;
  assert.ok(patas.razonGenerada > patas.razonGuia * 1.5, `con patas sale más alto: ${patas.razonGenerada} contra ${patas.razonGuia}`);
  assert.ok(patas.iouAlineada < movida.iouAlineada - 0.2, `y la forma ya no coincide: ${patas.iouAlineada}`);

  // Un color que no salió: el dorado cambiado por azul.
  const sinDorado = await pixelesDeSvg(svgGuia(discos.map((disco) => (disco.hex === "#c9a227" ? { ...disco, hex: "#1f4fbf" } : disco)), false, tamano));
  const medidaSinDorado = medirColores(sinDorado, objetivos);
  assert.equal(medidaSinDorado.ok, false);
  assert.equal(medidaSinDorado.colores.find((color) => color.objetivo.hex === "#c9a227")!.encontrado, null, "el dorado no aparece");
  assert.ok(medidaSinDorado.intrusos > 0.12, "y el azul es un intruso");
  assert.equal(medirSilueta(await pixelesDeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${FONDO_GUIA}"/></svg>`), guia), null, "sin estructura no hay silueta");
  console.log("[PASS] medida de evaluación: IoU 1 contra sí misma, patas y colores ausentes se detectan");
}

// ---------------------------------------------------------------------------
// 7. La corrida pagada: la vista previa no gasta.
// ---------------------------------------------------------------------------

async function vistaPrevia(): Promise<void> {
  const { directorioSalida, prepararCorridaGuia } = await import("../lib/corrida-guia-estructura");
  const { correrExperimento } = await import("../lib/fal-evaluacion");
  const argv = process.argv;
  const fetchOriginal = globalThis.fetch;
  const log = console.log;
  const salida: string[] = [];
  let llamadas = 0;
  process.argv = [...argv.slice(0, 2), "--dry-run"];
  globalThis.fetch = (async () => {
    llamadas += 1;
    throw new Error("la vista previa no debe tocar la red");
  }) as typeof fetch;
  console.log = (...partes: unknown[]) => { salida.push(partes.map(String).join(" ")); };
  try {
    const { celdas } = await prepararCorridaGuia({ escala: 0.8, semillas: [101, 202, 303] });
    const manifiesto = await correrExperimento({ nombre: "guia-estructura-prueba", celdas, defaults: { seed: 101, guidance: 3.5, ancho: 1536, alto: 1024, loraUrl: "https://example.invalid/lora.safetensors", trigger: "eventdecor_style_v3" }, outDir: path.join(os.tmpdir(), "no-se-escribe") });
    assert.equal(llamadas, 0, "sin red");
    assert.equal(celdas.length, 12, "2 planes × 2 brazos × 3 semillas");
    assert.equal(manifiesto.resultados.length, 0);
    assert.equal(manifiesto.coste_estimado_usd, 0.756, "6 × 0,042 + 3 × 0,063 (guía) + 3 × 0,105 (guía y carta), estimado");
    const impreso = salida.join("\n");
    assert.doesNotMatch(impreso, /base64,/, "las imágenes de entrada nunca se imprimen");
    assert.match(impreso, /<image\/png · \d+ bytes · sha256 [0-9a-f]{12}>/);
    assert.match(impreso, /\[DRY-RUN\] 12 celdas, coste ESTIMADO US\$0\.756/);
    assert.equal(manifiesto.celdas.filter((celda) => celda.endpoint.endsWith("/edit")).length, 6, "solo el brazo con guía va a /edit");
  } finally {
    process.argv = argv;
    globalThis.fetch = fetchOriginal;
    console.log = log;
  }
  assert.throws(() => directorioSalida(path.join(process.cwd(), "reports", "x"), "v007-1000"), /SALIDA_EN_EL_REPO/);
  assert.ok(!path.relative(process.cwd(), directorioSalida(undefined, "v007-1000")).startsWith("reports"));
  console.log("[PASS] corrida pagada: la vista previa no gasta, no imprime base64 y estima US$ 0,756");
}

async function main(): Promise<void> {
  await guiaYCarta();
  await cuandoHayGuia();
  promptConGuia();
  await peticionAFal();
  await filtroDeImagenes();
  await medida();
  await vistaPrevia();
}

main().catch((error: unknown) => {
  console.error("[FAIL] guía de estructura", error);
  process.exitCode = 1;
});
