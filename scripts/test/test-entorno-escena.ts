/**
 * El ENTORNO de la imagen es audaz y siempre cabe (2026-10-07, pedido del dueño con una captura correcta pero sosa:
 * semiarco + 2 columnas de colores contra una PARED BLANCA LISA y piso — «necesitamos composiciones un poco más
 * audaces y complejas, no de las decoraciones sino del ENTORNO»).
 *
 * El caption de FLUX solo describía la decoración: sin lugar en el nivel por defecto, con el evento como mucho en
 * «Birthday celebration atmosphere» (o nada con un evento abierto) y con esas pistas quitadas las primeras por el
 * presupuesto. El arreglo (`entorno-escena.ts` + caption-flux.ts): un entorno de evento (escenario, mesa con torta,
 * utilería, luz, detalle de piso, encuadre 3/4 con profundidad de campo y la guarda «the only balloons are the pieces
 * described») DESPUÉS de la decoración, con su forma compacta reservada en todos los pasos de presupuesto.
 *
 * Cuatro casos con la MISMA cadena que /api/generate (`scripts/lib/caption-de-cuerpo-generate.ts`) o con la entrada
 * guardada de ej06, sin red ni coste (US$0):
 *   1. cumpleaños infantil (safari) con semiarco + 2 columnas;
 *   2. boda con arco orgánico de 3 m en un jardín al atardecer (lo que dijo el cliente);
 *   3. guirnalda de 2,4 m sobre la mesa principal (baby shower);
 *   4. ej06 (tres piezas del motor orgánico) y su variante de ocho colores.
 *
 *   npx tsx --conditions=react-server scripts/test/test-entorno-escena.ts [--imprimir]
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAN_RESUELTO_CONTRACT_VERSION } from "@/lib/ia/contracts/domain-v1";
import { avisoNoCotizadoEntorno, entornoDeEscena, eventoDelContexto, fraseEntorno, type EntornoEscena } from "@/lib/ia/escena/entorno-escena";
import { buildVisualContext, type VisualContext } from "@/lib/ia/escena/visual-context";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { BASE_PROMPT_MAX_LENGTH } from "@/lib/ia/kagutsuchi/caption-flux";
import { findFluxPromptLanguageLeaks, preflightFluxPrompt } from "@/lib/ia/kagutsuchi/preflight-flux";
import { compileProductPrompt, type ElementSizeConfirmation } from "@/lib/ia/kagutsuchi/producto-flux";
import { ambienteDeFiesta, avisoNoCotizadoDeImagen } from "@/lib/ia/uzume/ambiente-fiesta";
import type { FraseDeEstructura } from "@/lib/ia/uzume/mezcla-color-escena";
import { PALETA_COLORES_EN_V2 } from "@/lib/rag/taxonomy/v2";
import { captionDeCuerpoGenerate, type CuerpoGenerateGuardado, type RespuestaResolvePython } from "../lib/caption-de-cuerpo-generate";
import { REQUEST_ID_PLAN_FIJADO } from "../lib/vectores-golden";

const RAIZ = process.cwd();
const IMPRIMIR = process.argv.includes("--imprimir");
let fallos = 0;
async function caso(nombre: string, prueba: () => Promise<void> | void): Promise<void> {
  try {
    await prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Palabras de color de la paleta: el entorno no las dice (no tiñe la decoración ni engaña la cobertura de colores). */
const COLORES_EN = [...new Set(Object.values(PALETA_COLORES_EN_V2).flatMap((color) => color.split(" ")))];
const PALABRA_DE_COLOR = new RegExp(`\\b(?:${COLORES_EN.join("|")}|golden|silver|ivory|pastel)\\b`, "i");

/** La parte del caption que es el entorno: desde el escenario hasta el final. */
function textoDelEntorno(prompt: string, entorno: EntornoEscena): string {
  const bajo = prompt.toLowerCase();
  const inicio = [entorno.escenario, entorno.escenarioCorto].map((escenario) => bajo.indexOf(`. ${escenario.toLowerCase()}`)).find((indice) => indice >= 0);
  assert.ok(inicio !== undefined && inicio > 0, `el entorno «${entorno.escenarioCorto}» está en el caption y va DESPUÉS de la decoración\n${prompt}`);
  return prompt.slice(inicio + 2);
}

/**
 * Con el límite de antes (1000; hoy es 1500, 6628c49) el caption también cabe y pasa el preflight; el entorno compacto o
 * el mínimo sobrevive salvo en la prueba de esfuerzo de ocho colores (`conEntorno: false`), donde la red de seguridad
 * lo quita antes que dejar la imagen sin generar.
 */
function cabeEn1000(nombre: string, prompt: string, sceneSpec: SceneSpec, clauses: Parameters<typeof preflightFluxPrompt>[0]["clauses"], entorno: EntornoEscena, conEntorno = true): void {
  const reporte = preflightFluxPrompt({ sceneSpec, clauses, prompt, maxLength: 1000 });
  assert.ok(prompt.length <= 1000, `${nombre} a 1000: mide ${prompt.length}\n${prompt}`);
  assert.equal(reporte.ok, true, `${nombre} a 1000: ${reporte.errors.join("; ")}`);
  if (!conEntorno) {
    if (IMPRIMIR) console.log(`     ${nombre} a 1000 [${prompt.length}]: sin entorno (red de seguridad)`);
    return;
  }
  assert.match(textoDelEntorno(prompt, entorno), /the only balloons (?:are the pieces described|in the scene)/, `${nombre} a 1000: la guarda sigue`);
  if (IMPRIMIR) console.log(`     ${nombre} a 1000 [${prompt.length}]: …${textoDelEntorno(prompt, entorno)}`);
}

/** Lo que todo caption con entorno cumple: cabe, preflight verde, entorno después de la decoración, guarda, encuadre. */
function comunes(nombre: string, prompt: string, preflight: { ok: boolean; errors: string[] }, entorno: EntornoEscena | undefined): string {
  assert.ok(entorno, `${nombre}: hay entorno`);
  assert.ok(prompt.length <= BASE_PROMPT_MAX_LENGTH, `${nombre}: cabe en ${BASE_PROMPT_MAX_LENGTH} (mide ${prompt.length})\n${prompt}`);
  assert.equal(preflight.ok, true, `${nombre}: preflight ${preflight.errors.join("; ")}\n${prompt}`);
  assert.deepEqual(findFluxPromptLanguageLeaks(prompt), [], `${nombre}: sin español`);
  const delEntorno = textoDelEntorno(prompt, entorno);
  assert.match(delEntorno, /the only balloons (?:are the pieces described|in the scene)/, `${nombre}: la guarda de globos`);
  assert.match(delEntorno, /eye-level three-quarter (?:view|angle)/i, `${nombre}: el encuadre 3/4`);
  assert.doesNotMatch(entornoSinCierre(delEntorno), PALABRA_DE_COLOR, `${nombre}: el entorno no nombra colores`);
  assert.doesNotMatch(prompt, /\bplain (?:white )?(?:studio )?background\b|\bstudio\b/i, `${nombre}: nada de estudio`);
  return delEntorno;
}

/** El entorno sin el cierre fotográfico fijo («realistic latex balloons…», que no es del entorno). */
function entornoSinCierre(texto: string): string {
  return texto.replace(/professional event photograph.*$/i, "");
}

type Json = Record<string, unknown>;
type Fijado = { plan_resuelto: Json & { plan: Json & { estructuras: Json[] }; estructuras: Json[] }; material_estimate: Json & { balloons: Json[] } };
const leerFijado = (nombre: string): Fijado => JSON.parse(readFileSync(path.join(RAIZ, "scripts", "fixtures", "planes-fijados", `${nombre}.json`), "utf8")) as Fijado;

type Pieza = { de: Fijado; origen: string; id: string; cambios: Json };

/** Plan de Python (contrato) con estas piezas: las del fixture, renombradas y con sus campos cambiados. */
function respuestaPython(piezas: readonly Pieza[]): RespuestaResolvePython {
  const base = structuredClone(piezas[0]!.de.plan_resuelto);
  const declaradas: Json[] = [];
  const resueltas: Json[] = [];
  for (const pieza of piezas) {
    const renombrar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor).split(`"${pieza.origen}"`).join(`"${pieza.id}"`)) as T;
    const declarada = pieza.de.plan_resuelto.plan.estructuras.find((estructura) => estructura.estructura_id === pieza.origen);
    const resuelta = pieza.de.plan_resuelto.estructuras.find((estructura) => estructura.estructura_id === pieza.origen);
    assert.ok(declarada && resuelta, `falta ${pieza.origen}`);
    declaradas.push({ ...renombrar(declarada), ...pieza.cambios });
    resueltas.push({ ...renombrar(resuelta), ...Object.fromEntries(Object.entries(pieza.cambios).filter(([clave]) => ["ubicacion", "repeticiones", "nombre", "tipo"].includes(clave))) });
  }
  const compras = piezas.flatMap((pieza) => (pieza.de.plan_resuelto.compras as Json[]));
  const plan_resuelto = { schema_version: PLAN_RESUELTO_CONTRACT_VERSION, request_id: REQUEST_ID_PLAN_FIJADO, ...base, plan: { ...base.plan, estructuras: declaradas }, estructuras: resueltas, compras: [...new Map(compras.map((compra) => [String(compra.variant_id), compra])).values()], costes_por_estructura: [] };
  const balloons = piezas.flatMap((pieza) => pieza.de.material_estimate.balloons.filter((linea) => linea.structure_id === pieza.origen).map((linea) => ({ ...linea, structure_id: pieza.id })));
  return { plan_resuelto, material_estimate: { ...piezas[0]!.de.material_estimate, balloons } as unknown as RespuestaResolvePython["material_estimate"] };
}

/** ANTES (sin entorno) y DESPUÉS (con el entorno de la ruta) de la misma entrada. */
async function antesYDespues(nombre: string, cuerpo: CuerpoGenerateGuardado, python: RespuestaResolvePython) {
  const despues = await captionDeCuerpoGenerate(cuerpo, python);
  const antes = compileProductPrompt({ ...despues.entrada, entorno: undefined });
  const a1000 = compileProductPrompt({ ...despues.entrada, maxLength: 1000 });
  cabeEn1000(nombre, a1000.prompt, despues.sceneSpec, a1000.clauses, despues.entrada.entorno!);
  return { antes: antes.prompt, despues };
}

const COLUMNAS = leerFijado("qa-lateral-repetida-x2");
const SEMIARCO = leerFijado("calibracion-cumple-semiarco-columna");
const ORGANICA = { estructura_oficial: "columna_asimetrica", mezcla: "organica_fina", densidad: "lujosa" } as const;

const informe: Array<{ caso: string; antes: string; despues: string }> = [];

async function main(): Promise<void> {
  await caso("evento: lo dice la etiqueta o las palabras; infantil por la edad, adulto por la edad", () => {
    const evento = (texto: Partial<VisualContext>) => eventoDelContexto({ ...texto }).evento;
    assert.equal(evento({ eventType: "cumpleaños", userRequest: "Cumpleaños. 4 a 6 años. Rosa y lila." }), "cumple_infantil");
    assert.equal(evento({ eventType: "cumpleaños", userRequest: "los 40 años de mi esposo" }), "cumple_adulto");
    assert.equal(evento({ eventType: "cumpleaños" }), "cumple");
    assert.equal(evento({ eventType: "revelacion_genero" }), "revelacion");
    assert.equal(evento({ eventType: "boda", userRequest: "y el cumpleaños de mi hija" }), "boda", "la etiqueta manda");
    assert.equal(evento({ userRequest: "unos XV años en salón" }), "xv");
    assert.equal(evento({ userRequest: "fiesta de empresa" }), "corporativo");
    assert.equal(evento({}), "fiesta");
  });

  await caso("sin entorno con foto del espacio, sobre una imagen previa o si pide fondo liso; sin utilería en niveles 0-1 o con escenografía de la foto", () => {
    const contexto = buildVisualContext({ brief: { tipo_evento: "cumpleaños" }, userRequest: "Cumpleaños de mi hija de 5 años" });
    assert.equal(entornoDeEscena({ contexto, nivel: 2, modo: "edit_venue" }), undefined);
    assert.equal(entornoDeEscena({ contexto, nivel: 2, modo: "revise_current_result" }), undefined);
    assert.equal(entornoDeEscena({ contexto: buildVisualContext({ userRequest: "un arco dorado con fondo blanco liso, foto de estudio" }), nivel: 2, modo: "text_to_image" }), undefined);
    const fiel = entornoDeEscena({ contexto, nivel: 0, modo: "text_to_image" })!;
    assert.equal(fiel.mesa, undefined);
    assert.deepEqual(fiel.extras, []);
    assert.equal(avisoNoCotizadoEntorno(fiel), undefined, "sin objetos añadidos, sin aviso del entorno");
    const conFoto = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image", conEscenografiaDeFoto: true })!;
    assert.equal(conFoto.mesa, undefined, "la mesa de la foto es la mesa: no se pone otra");
    const audaz = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image" })!;
    assert.equal(audaz.evento, "cumple_infantil");
    assert.ok(audaz.mesa && audaz.extras.length >= 2 && audaz.detalle, "nivel 2: mesa, utilería y detalle");
  });

  await caso("forma compacta: 150-220 caracteres con encuadre, en todos los eventos y lugares", () => {
    const eventos = ["cumpleaños infantil de 4 años", "cumpleaños de 40 años", "boda", "XV años", "baby shower", "revelación de género", "bautizo", "graduación", "fiesta de empresa", "halloween", "navidad", "san valentín", "día de la madre", "fiesta"];
    const lugares = [undefined, "jardín", "salón", "terraza", "playa", "hotel", "casa", "piscina del conjunto"];
    const momentos = [undefined, "noche", "atardecer", "día"];
    for (const evento of eventos) for (const espacio of lugares) for (const momento of momentos) {
      const contexto = buildVisualContext({ brief: { tipo_evento: evento, ...(espacio ? { espacio } : {}), ...(momento ? { momento_dia: momento } : {}) }, userRequest: evento });
      const entorno = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image" })!;
      const compacta = fraseEntorno(entorno, "compacto");
      // Lo que ocupa en el caption: «<escena>. <encuadre>, » antes del cierre fotográfico.
      const largo = `${compacta.escena}. ${compacta.camara}, `.length;
      assert.ok(largo >= 140 && largo <= 225,`${evento} / ${espacio ?? "-"} / ${momento ?? "-"}: compacta de ${largo}\n${compacta.escena}. ${compacta.camara}`);
      const completa = fraseEntorno(entorno, "completo");
      const minima = fraseEntorno(entorno, "minimo");
      for (const texto of [compacta.escena, completa.escena, minima.escena, completa.camara ?? ""]) {
        assert.deepEqual(findFluxPromptLanguageLeaks(texto), [], `sin español: ${texto}`);
        assert.doesNotMatch(texto, PALABRA_DE_COLOR, `sin colores: ${texto}`);
        assert.doesNotMatch(texto, /\b(?:sign|signage|text|letters?|banner|logo|arch(?:es)?|frame|garland|column|backdrop)\b/i, `ni letreros ni estructuras: ${texto}`);
      }
      assert.ok(minima.escena.length <= 140, `mínima corta: ${minima.escena}`);
      assert.ok(avisoNoCotizadoEntorno(entorno)?.endsWith("no están incluidos en la cotización."), "aviso de lo que añade");
    }
  });

  await caso("aviso: el del entorno nombra lo añadido; sin entorno, el de siempre", () => {
    const entorno = entornoDeEscena({ contexto: buildVisualContext({ brief: { tipo_evento: "cumpleaños" }, userRequest: "cumpleaños de mi hijo de 6 años" }), nivel: 2, modo: "text_to_image" });
    assert.equal(avisoNoCotizadoDeImagen(ambienteDeFiesta("ninguno"), [], entorno), "La mesa de postres, la torta, los dulces, los regalos, las luces y el confeti de la vista previa son ambientación: no están incluidos en la cotización.");
    assert.match(avisoNoCotizadoDeImagen(ambienteDeFiesta("ninguno"), [{ name: "mesa" }], undefined) ?? "", /conserva elementos de tu foto/);
    assert.equal(avisoNoCotizadoDeImagen(ambienteDeFiesta("ninguno"), [], undefined), undefined);
  });

  // ── 1. Cumpleaños infantil: semiarco + 2 columnas (la captura del dueño) ───────────────────────────────────────
  await caso("1. cumpleaños infantil (safari), semiarco + 2 columnas: salón de fiesta con mesa de postres, regalos, luces y la decoración intacta", async () => {
    const python = respuestaPython([
      { de: SEMIARCO, origen: "EST_01_SEMIARCO", id: "EST_01_SEMIARCO_ASIMETRICO", cambios: { estructura_oficial: "semiarco_asimetrico", rol_escena: "focal", ubicacion: "fondo_pared", repeticiones: 1 } },
      { de: COLUMNAS, origen: "EST_02_COLUMNAS", id: "EST_02_COLUMNA", cambios: { ...ORGANICA, nombre: "Columna orgánica", rol_escena: "soporte", ubicacion: "lateral_izquierdo", repeticiones: 1 } },
      { de: COLUMNAS, origen: "EST_02_COLUMNAS", id: "EST_03_COLUMNA", cambios: { ...ORGANICA, nombre: "Columna orgánica", rol_escena: "soporte", ubicacion: "lateral_derecho", repeticiones: 1 } },
    ]);
    // El cuerpo de la guiada (`entradaImagenGuiada`): evento, temática y las palabras del cliente.
    const cuerpo: CuerpoGenerateGuardado = { brief: { tipo_evento: "Cumpleaños", estilo: "Safari", colores: ["rojo", "dorado"] }, solicitudUsuario: "Cumpleaños. 4 a 6 años. Safari. Rojo y dorado.", creatividad: 2 };
    const { antes, despues } = await antesYDespues("cumpleaños", cuerpo, python);
    informe.push({ caso: "1. cumpleaños infantil, semiarco + 2 columnas", antes, despues: despues.prompt });
    const entorno = despues.entrada.entorno!;
    const delEntorno = comunes("cumpleaños", despues.prompt, despues.preflight, entorno);
    assert.match(delEntorno, /^A lively kids' (?:birthday )?party room(?: with tall windows and guest tables in the background)?: a dessert table (?:in the foreground )?with a jungle safari themed birthday cake/, delEntorno);
    assert.doesNotMatch(despues.prompt, /plain wall/, "con entorno, el hueco entre piezas no es «de pared lisa»");
    assert.match(delEntorno, /wrapped gifts/);
    assert.doesNotMatch(despues.prompt, /celebration atmosphere/, "la pista suelta del evento la sustituye el entorno");
    // La decoración intacta: las tres piezas, la punta libre del semiarco, las torres sueltas, las tres piezas.
    assert.match(despues.prompt, /^An asymmetrical one-sided curved organic balloon garland/);
    assert.match(despues.prompt, /two organic balloon columns/);
    assert.match(despues.prompt, /tip ending in mid-air/);
    assert.match(despues.prompt, /each (?:a separate|its own) freestanding tower/);
    assert.match(despues.prompt, /[Tt]hree separate pieces/);
    assert.doesNotMatch(despues.prompt, /main arch|\barch\b/);
    for (const color of ["red", "gold"]) assert.match(despues.prompt, new RegExp(`\\b${color}\\b`));
    assert.equal(despues.preflight.structures.represented, despues.preflight.structures.expected);
    assert.equal(avisoNoCotizadoDeImagen(ambienteDeFiesta("ninguno"), [], entorno)?.startsWith("La mesa de postres, la torta"), true);
  });

  // ── 2. Boda con arco orgánico de 3 m, en un jardín al atardecer (lo dijo el cliente) ──────────────────────────
  await caso("2. boda, arco orgánico de 3 m en jardín al atardecer: jardín, mesa de los novios, flores, velas, luz de atardecer", async () => {
    const guardado = JSON.parse(readFileSync(path.join(RAIZ, "data", "biblioteca-real", "analisis", "real-01-305.plan.json"), "utf8")) as { plan_resuelto: Json & { plan: Json & { estructuras: Json[] } }; material_estimate: RespuestaResolvePython["material_estimate"] };
    const plan = { ...guardado.plan_resuelto.plan, estructuras: guardado.plan_resuelto.plan.estructuras.map((estructura, indice) => (indice === 0 ? { ...estructura, medidas: { ...(estructura.medidas as Json), ancho_m: 3, alto_m: 2.5 } } : estructura)) };
    const python: RespuestaResolvePython = { plan_resuelto: { schema_version: "plan-resuelto.v1", ...guardado.plan_resuelto, plan }, material_estimate: guardado.material_estimate };
    const cuerpo: CuerpoGenerateGuardado = { brief: { tipo_evento: "boda", espacio: "jardín", momento_dia: "atardecer", colores: ["blanco", "dorado"] }, solicitudUsuario: "Boda en un jardín al atardecer, arco orgánico de 3 metros", creatividad: 2 };
    const { antes, despues } = await antesYDespues("boda", cuerpo, python);
    informe.push({ caso: "2. boda, arco orgánico de 3 m (jardín, atardecer)", antes, despues: despues.prompt });
    const entorno = despues.entrada.entorno!;
    assert.equal(entorno.origen.lugar, "cliente");
    assert.equal(entorno.origen.momento, "cliente");
    const delEntorno = comunes("boda", despues.prompt, despues.preflight, entorno);
    assert.match(delEntorno, /^A lush garden (?:with trees and open sky )?set for a wedding(?: reception)?: a sweetheart table (?:in the foreground )?with (?:fine linens and )?a (?:tiered )?wedding cake/, delEntorno);
    assert.match(delEntorno, /warm sunset (?:sky )?light/);
    assert.ok(despues.prompt.startsWith("An organic balloon garland arch, 3 m / 10 ft wide and 2.5 m / 8 ft tall with about 145 balloons, made of "), despues.prompt);
    assert.match(despues.prompt, /[Ee]very balloon at most 12-inch/);
  });

  // ── 3. Guirnalda de 2,4 m sobre la mesa principal ───────────────────────────────────────────────────────────
  await caso("3. guirnalda de 2,4 m sobre la mesa: la mesa del evento ES la mesa principal; escala y forma intactas", async () => {
    const guardado = JSON.parse(readFileSync(path.join(RAIZ, "data", "biblioteca-real", "analisis", "real-18-sddefault.plan.json"), "utf8")) as { plan_resuelto: Json; material_estimate: RespuestaResolvePython["material_estimate"] };
    const ideas = JSON.parse(readFileSync(path.join(RAIZ, "src", "lib", "biblioteca-sempertex", "planes-ideas.json"), "utf8")) as { ideas: Record<string, { plan: Json & { concepto: { paleta: string[] } } }> };
    const plan = ideas.ideas["deco-real-18-sddefault"]!.plan;
    const python: RespuestaResolvePython = { plan_resuelto: { schema_version: "plan-resuelto.v1", ...guardado.plan_resuelto, plan }, material_estimate: guardado.material_estimate };
    const cuerpo: CuerpoGenerateGuardado = { brief: { tipo_evento: "baby shower", colores: plan.concepto.paleta, estilo: "Baby shower niña" }, solicitudUsuario: "Baby shower. Niña.", creatividad: 2 };
    const { antes, despues } = await antesYDespues("guirnalda", cuerpo, python);
    informe.push({ caso: "3. guirnalda de 2,4 m sobre mesa (baby shower)", antes, despues: despues.prompt });
    const entorno = despues.entrada.entorno!;
    const delEntorno = comunes("guirnalda", despues.prompt, despues.preflight, entorno);
    assert.match(delEntorno, /^(?:A bright, airy baby shower lounge(?: with tall windows and potted plants)?|An airy baby shower lounge): the main table set (?:as a dessert table )?with a tiered cake/, delEntorno);
    assert.doesNotMatch(despues.prompt, /a dessert table/, "una sola mesa: la principal, no una segunda");
    assert.ok(despues.prompt.startsWith("A small organic balloon garland, 2.4 m / 8 ft long with about 37 balloons, made of "), despues.prompt);
    assert.match(despues.prompt, /hung horizontally on the rear wall above the main table/);
    assert.match(despues.prompt, /One single horizontal strip spanning only part of the wall, both ends hanging free in mid-air, every balloon at most 18-inch, about beach-ball size\./);
    assert.match(despues.prompt, /medium shot showing the whole decoration/i);
  });

  // ── 4. ej06 (tres piezas del motor orgánico) y su variante de ocho colores ───────────────────────────────────
  type Fixture06 = { sceneSpec: SceneSpec; visualContext: VisualContext; sizeConfirmations: ElementSizeConfirmation[]; productIdAliases: Array<[string, string[]]>; productCatalogTitles: Array<[string, string]>; ambientDecor: string[]; creativeCues: string[]; officialStructures: Array<[string, string]>; colorPatterns: FraseDeEstructura[] };
  const EJ06 = JSON.parse(readFileSync(path.join(RAIZ, "scripts", "test", "fixtures", "caption-flux-ejemplo-06.json"), "utf8")) as Fixture06;
  const compilar06 = (f: Fixture06, entorno: EntornoEscena | undefined, maxLength?: number) => {
    const c = compileProductPrompt({ sceneSpec: f.sceneSpec, visualContext: f.visualContext, sizeConfirmations: f.sizeConfirmations, productIdAliases: new Map(f.productIdAliases), productCatalogTitles: new Map(f.productCatalogTitles), ambientDecor: f.ambientDecor, creativeCues: f.creativeCues, officialStructures: new Map(f.officialStructures), colorPatterns: f.colorPatterns, entorno, maxLength });
    return { prompt: c.prompt, clauses: c.clauses, preflight: preflightFluxPrompt({ sceneSpec: f.sceneSpec, clauses: c.clauses, prompt: c.prompt }), diagnostico: c.diagnostics.find((linea) => linea.startsWith("caption compactado")) ?? "sin compactar" };
  };

  await caso("4a. ej06 (revelación de género, escenografía de la foto): el entorno cabe y la decoración conserva lo que pedía el presupuesto", () => {
    const entorno = entornoDeEscena({ contexto: EJ06.visualContext, nivel: 2, modo: EJ06.sceneSpec.generation_mode, conEscenografiaDeFoto: EJ06.ambientDecor.length > 0 });
    const antes = compilar06(EJ06, undefined);
    const despues = compilar06(EJ06, entorno);
    const a1000 = compilar06(EJ06, entorno, 1000);
    cabeEn1000("ej06", a1000.prompt, EJ06.sceneSpec, a1000.clauses, entorno!);
    informe.push({ caso: "4a. ej06 (revelación de género, con escenografía de la foto)", antes: antes.prompt, despues: despues.prompt });
    if (IMPRIMIR) console.log(`     ej06: ${despues.diagnostico}`);
    assert.equal(entorno?.evento, "revelacion");
    assert.equal(entorno?.mesa, undefined, "la foto trae su mesa");
    comunes("ej06", despues.prompt, despues.preflight, entorno);
    assert.match(despues.prompt, /light pink \(#F2B6C8\)/);
    assert.match(despues.prompt, /vivid cyan blue \(#01B2E8\)/);
    assert.match(despues.prompt, /white \(#FFFFFF\)/);
    for (const escala of [/2\.2 m(?: \/ 7 ft)? tall/, /about 105 balloons/, /1\.8 m(?: \/ 6 ft)? tall/, /about 165 balloons/, /2\.5 m(?: \/ 8 ft)? long/, /about 204 balloons/]) assert.match(despues.prompt, escala);
    assert.match(despues.prompt, /standing on the floor on its left leg/, "el semiarco conserva cómo se apoya");
  });

  await caso("4b. ej06 con ocho colores y sin escenografía de la foto (entorno con utilería): cabe con todos los hex y colores", () => {
    const COLORES = [["rosado", "Fashion Rosado"], ["azul", "Fashion Azul"], ["blanco", "Satin Blanco"], ["verde", "Fashion Verde Lima"], ["amarillo", "Fashion Amarillo"], ["lila", "Fashion Lila"], ["naranja", "Fashion Naranja"], ["fucsia", "Fashion Fucsia"]] as const;
    const PALETAS: Readonly<Record<string, readonly number[]>> = { EST_01_SEMIARCO: [0, 1, 2, 3, 4], EST_02_COLUMNA: [5, 6, 7, 0, 1], EST_03_GUIRNALDA: [2, 3, 4, 5, 6] };
    const titulos: Array<[string, string]> = [];
    const confirmaciones: ElementSizeConfirmation[] = [];
    const elementos = EJ06.sceneSpec.elements.map((elemento) => {
      const paleta = PALETAS[elemento.element_id] ?? [0, 1, 2];
      const ids = paleta.flatMap((indice, orden) => [5, 9, 12, 18].map((talla) => {
        const id = `MC-${COLORES[indice]![0]}-${talla}`;
        if (!titulos.some(([existente]) => existente === id)) titulos.push([id, `B2b Globo Latex Redondo ${COLORES[indice]![1]}`]);
        confirmaciones.push({ elementId: elemento.element_id, productId: id, sizeCode: `R-${talla}`, diameterInches: talla, units: 12 - orden * 2 });
        return id;
      }));
      return { ...elemento, catalog_product_id: ids[0], catalog_product_ids: ids, resolved_colors: paleta.map((indice) => COLORES[indice]![0]), resolved_finishes: ["fashion"] };
    });
    const muchos: Fixture06 = { ...EJ06, sceneSpec: { ...EJ06.sceneSpec, elements: elementos }, sizeConfirmations: confirmaciones, productCatalogTitles: titulos, productIdAliases: [], ambientDecor: [] };
    const entorno = entornoDeEscena({ contexto: muchos.visualContext, nivel: 2, modo: muchos.sceneSpec.generation_mode, conEscenografiaDeFoto: false });
    const antes = compilar06(muchos, undefined);
    const despues = compilar06(muchos, entorno);
    const a1000 = compilar06(muchos, entorno, 1000);
    cabeEn1000("ej06 ocho colores", a1000.prompt, muchos.sceneSpec, a1000.clauses, entorno!, false);
    informe.push({ caso: "4b. ej06 con ocho colores (entorno con utilería)", antes: antes.prompt, despues: despues.prompt });
    if (IMPRIMIR) console.log(`     ej06 ocho colores: ${despues.diagnostico}`);
    assert.ok(entorno?.mesa, "sin foto, el entorno pone su mesa");
    comunes("ej06 ocho colores", despues.prompt, despues.preflight, entorno);
    assert.equal(despues.preflight.colors.represented, despues.preflight.colors.expected, "todos los colores");
    for (const hex of ["F2B6C8", "01B2E8", "F7F7F5", "8AC85B", "F6E702", "B698C1", "E75D1D", "E44A80"]) assert.equal((despues.prompt.match(new RegExp(`#${hex}`, "g")) ?? []).length, 1, `#${hex} una vez\n${despues.prompt}`);
  });

  if (IMPRIMIR) {
    for (const { caso: nombre, antes, despues } of informe) {
      console.log(`\n## ${nombre}\nANTES   [${antes.length}] ${antes}\nDESPUÉS [${despues.length}] ${despues}`);
    }
  }
  if (fallos) {
    console.error(`\n${fallos} caso(s) fallaron`);
    process.exit(1);
  }
  console.log("\ntest-entorno-escena: todo OK");
}

void main();
