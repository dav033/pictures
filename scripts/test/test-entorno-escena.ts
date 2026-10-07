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
 * Ronda 2 («la composición sigue pobre»): una sola composición para todos los eventos, la luz dramática de la hora
 * del evento con el salón e invitados desenfocados DETRÁS de las piezas, la mesa temática iluminada a un lado, la
 * guarda con el número de piezas y el encuadre 3/4 como PRIMERA frase del caption.
 *
 * Cinco casos con la MISMA cadena que /api/generate (`scripts/lib/caption-de-cuerpo-generate.ts`) o con la entrada
 * guardada de ej06 o del dueño, sin red ni coste (US$0):
 *   1. cumpleaños infantil (safari) con semiarco + 2 columnas;
 *   2. boda con arco orgánico de 3 m en un jardín al atardecer (lo que dijo el cliente);
 *   3. guirnalda de 2,4 m sobre la mesa principal (baby shower);
 *   4. ej06 (tres piezas del motor orgánico) y su variante de ocho colores;
 *   5. el caso del dueño (guiada-20261007-070255-dzwwhq: fútbol, arco asimétrico + 2 columnas).
 *
 *   npx tsx --conditions=react-server scripts/test/test-entorno-escena.ts [--imprimir]
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLAN_RESUELTO_CONTRACT_VERSION } from "@/lib/ia/contracts/domain-v1";
import { avisoNoCotizadoEntorno, ENCUADRE_ESCENA, entornoDeEscena, eventoDelContexto, fraseEntorno, tonoLuzParaPaleta, type EntornoEscena } from "@/lib/ia/escena/entorno-escena";
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

/** La guarda de globos del entorno, con el número de piezas o sin él. */
const GUARDA = /the only balloons (?:are the (?:(?:two|three|four|five|six) )?pieces described|in the scene)/;

/**
 * La parte del caption que es el entorno: desde la frase de la guarda de globos (la del entorno) hasta el final (la
 * frase abre por el lugar, la hora o la luz, así que se busca la frase que termina en la guarda).
 */
function textoDelEntorno(prompt: string): string {
  const guarda = prompt.search(GUARDA);
  const inicio = guarda < 0 ? -1 : prompt.lastIndexOf(". ", guarda);
  assert.ok(inicio > 0, `el entorno está en el caption y va DESPUÉS de la decoración\n${prompt}`);
  return prompt.slice(inicio + 2);
}

/** Lo que la ronda 2 exige al entorno con escenografía propia: dice qué hay DETRÁS de las piezas (o a sus lados). */
const DETRAS_DE_LAS_PIEZAS = /(?:far behind|at both sides of) the pieces/;

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
  assert.match(textoDelEntorno(prompt), GUARDA, `${nombre} a 1000: la guarda sigue`);
  // El encuadre se va solo con la forma mínima del entorno (el último paso, sin cierre fotográfico), nunca antes.
  if (entorno.conEncuadre && !prompt.startsWith(`${ENCUADRE_ESCENA}. `)) assert.ok(textoDelEntorno(prompt).length <= 141, `${nombre} a 1000: sin encuadre solo con el entorno mínimo\n${prompt}`);
  if (IMPRIMIR) console.log(`     ${nombre} a 1000 [${prompt.length}]: …${textoDelEntorno(prompt)}`);
}

/** Lo que todo caption con entorno cumple: cabe, preflight verde, encuadre primero, entorno después de la decoración, guarda. */
function comunes(nombre: string, prompt: string, preflight: { ok: boolean; errors: string[] }, entorno: EntornoEscena | undefined): string {
  assert.ok(entorno, `${nombre}: hay entorno`);
  assert.ok(prompt.length <= BASE_PROMPT_MAX_LENGTH, `${nombre}: cabe en ${BASE_PROMPT_MAX_LENGTH} (mide ${prompt.length})\n${prompt}`);
  assert.equal(preflight.ok, true, `${nombre}: preflight ${preflight.errors.join("; ")}\n${prompt}`);
  assert.deepEqual(findFluxPromptLanguageLeaks(prompt), [], `${nombre}: sin español`);
  const delEntorno = textoDelEntorno(prompt);
  assert.match(delEntorno, GUARDA, `${nombre}: la guarda de globos`);
  // El encuadre 3/4 es la PRIMERA frase (en la cola FLUX.2 no lo leía), y solo está ahí.
  assert.ok(prompt.startsWith(`${ENCUADRE_ESCENA}. `), `${nombre}: el encuadre abre el caption\n${prompt}`);
  assert.equal(prompt.split(ENCUADRE_ESCENA).length, 2, `${nombre}: un solo encuadre`);
  assert.doesNotMatch(prompt, /three-quarter angle|lit from the front/i, `${nombre}: ni el encuadre viejo de la cola ni la luz de flash`);
  if (entorno.conEscenografiaPropia) assert.match(delEntorno, DETRAS_DE_LAS_PIEZAS, `${nombre}: el entorno dice qué hay detrás de las piezas\n${delEntorno}`);
  assert.doesNotMatch(prompt, /plain wall/, `${nombre}: nada de pared lisa`);
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

  await caso("sin entorno con foto del espacio, sobre una imagen previa o si pide fondo liso; sin utilería en niveles 0-1 o con escenografía de la foto; sin encuadre con la guía de escena", () => {
    const contexto = buildVisualContext({ brief: { tipo_evento: "cumpleaños" }, userRequest: "Cumpleaños de mi hija de 5 años" });
    assert.equal(entornoDeEscena({ contexto, nivel: 2, modo: "edit_venue" }), undefined);
    assert.equal(entornoDeEscena({ contexto, nivel: 2, modo: "revise_current_result" }), undefined);
    assert.equal(entornoDeEscena({ contexto: buildVisualContext({ userRequest: "un arco dorado con fondo blanco liso, foto de estudio" }), nivel: 2, modo: "text_to_image" }), undefined);
    const fiel = entornoDeEscena({ contexto, nivel: 0, modo: "text_to_image" })!;
    assert.equal(fiel.mesa, undefined);
    assert.deepEqual(fiel.extras, []);
    // Nivel 0: sin la utilería del evento, pero con la luz y el salón detrás (nunca paño liso), que se avisan.
    assert.equal(avisoNoCotizadoEntorno(fiel), "La iluminación, las luces y las mesas de invitados de la vista previa son ambientación: no están incluidos en la cotización.");
    assert.equal(fraseEntorno(fiel, "compacto").escena, "At night, warm amber uplighting, string light bokeh, blurred guests far behind the pieces, the only balloons are the pieces described");
    const conFoto = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image", conEscenografiaDeFoto: true })!;
    assert.equal(conFoto.mesa, undefined, "la mesa de la foto es la mesa: no se pone otra");
    assert.equal(conFoto.conEscenografiaPropia, false, "ni luces colgadas, ni invitados: la escenografía de la foto es el fondo");
    assert.equal(avisoNoCotizadoEntorno(conFoto), undefined, "sin objetos añadidos, sin aviso del entorno");
    for (const detalle of ["completo", "medio", "compacto", "minimo"] as const) {
      const escena = fraseEntorno(conFoto, detalle).escena;
      assert.doesNotMatch(escena, /fabric|curtain|guests|table|rug|string lights?/, `con escenografía de la foto, la ${detalle} no pone objetos propios: ${escena}`);
    }
    const audaz = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image" })!;
    assert.equal(audaz.evento, "cumple_infantil");
    assert.ok(audaz.mesa && audaz.extras.length >= 2 && audaz.detalle, "nivel 2: mesa, utilería y detalle");
    assert.equal(fraseEntorno(audaz, "compacto").encuadre, ENCUADRE_ESCENA);
    // Con la guía de escena el mapa fija el punto de vista: la misma escena, sin encuadre.
    const conGuia = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image", conGuiaDeEscena: true })!;
    for (const detalle of ["completo", "medio", "compacto", "minimo"] as const) {
      assert.equal(fraseEntorno(conGuia, detalle).encuadre, undefined, `con guía, sin encuadre (${detalle})`);
      assert.equal(fraseEntorno(conGuia, detalle).escena, fraseEntorno(audaz, detalle).escena, `con guía, la misma escena (${detalle})`);
    }
    assert.equal(fraseEntorno(audaz, "minimo").encuadre, undefined, "la forma mínima va sin encuadre");
  });

  await caso("hora y luz: la del cliente manda; sin hora, de noche (al atardecer los eventos de día); de día, luz natural; tono que no compite", () => {
    const entorno = (brief: Record<string, string>) => entornoDeEscena({ contexto: buildVisualContext({ brief, userRequest: brief.tipo_evento }), nivel: 2, modo: "text_to_image" })!;
    assert.equal(entorno({ tipo_evento: "cumpleaños" }).momento, "noche");
    assert.equal(entorno({ tipo_evento: "boda", espacio: "jardín" }).momento, "noche");
    assert.equal(entorno({ tipo_evento: "baby shower" }).momento, "atardecer", "evento de día: al atardecer");
    assert.equal(entorno({ tipo_evento: "bautizo" }).origen.momento, "evento");
    const deDia = entorno({ tipo_evento: "boda", espacio: "jardín", momento_dia: "día" });
    assert.equal(deDia.momento, "dia");
    assert.equal(deDia.origen.momento, "cliente");
    // Plan desde una foto: sin hora del cliente, de día como la foto (la noche con uplighting cambiaba su ambiente);
    // con la escenografía de la foto, la escena es solo el sitio y la luz natural.
    const contextoFoto = buildVisualContext({ brief: { tipo_evento: "cumpleaños" }, userRequest: "cumpleaños" });
    const desdeFoto = entornoDeEscena({ contexto: contextoFoto, nivel: 2, modo: "text_to_image", desdeFoto: true, conEscenografiaDeFoto: true })!;
    assert.equal(desdeFoto.momento, "dia");
    assert.equal(desdeFoto.origen.momento, "foto");
    assert.doesNotMatch(fraseEntorno(desdeFoto, "compacto").escena, /night|uplighting/, fraseEntorno(desdeFoto, "compacto").escena);
    assert.equal(entornoDeEscena({ contexto: buildVisualContext({ brief: { tipo_evento: "cumpleaños", momento_dia: "noche" }, userRequest: "cumpleaños" }), nivel: 2, modo: "text_to_image", desdeFoto: true })!.momento, "noche", "la hora del cliente manda sobre la foto");
    for (const detalle of ["completo", "medio", "compacto", "minimo"] as const) {
      const escena = fraseEntorno(deDia, detalle).escena;
      assert.doesNotMatch(escena, /\bnight\b|\bdusk\b|uplighting|bokeh|lamps/, `de día no hay noche ni uplighting (${detalle}): ${escena}`);
    }
    assert.match(fraseEntorno(deDia, "compacto").escena, /^A lush garden, bright daylight, string lights overhead, blurred guests far behind the pieces, a sweetheart table with a wedding cake at one side, /);
    assert.match(fraseEntorno(entorno({ tipo_evento: "boda", espacio: "salón", momento_dia: "noche" }), "medio").escena, /^An event hall set for a wedding at night: the walls washed in warm amber uplighting, /);
    assert.match(fraseEntorno(entorno({ tipo_evento: "boda", espacio: "jardín", momento_dia: "atardecer" }), "compacto").escena, /^A lush garden at dusk, warm amber uplighting, /);
    // La cena romántica no tiene invitados al fondo: mesas con velas.
    assert.match(fraseEntorno(entorno({ tipo_evento: "san valentín" }), "compacto").escena, /blurred candlelit tables far behind the pieces/);
    // La luz del fondo no compite con los globos: ámbar salvo con colores ámbar (dorado, amarillo, naranja…).
    assert.equal(tonoLuzParaPaleta(["verde", "negro", "blanco"]), "warm amber");
    assert.equal(tonoLuzParaPaleta(["rosado", "dorado rosa"]), "cool-toned");
    assert.equal(tonoLuzParaPaleta(["amarillo", "azul"]), "cool-toned");
  });

  await caso("formas: compacta de 120-260 caracteres con el encuadre, todas dicen qué hay detrás de las piezas, la guarda cuenta las piezas", () => {
    const eventos = ["cumpleaños infantil de 4 años", "cumpleaños de 40 años", "boda", "XV años", "baby shower", "revelación de género", "bautizo", "graduación", "fiesta de empresa", "halloween", "navidad", "san valentín", "día de la madre", "fiesta"];
    const lugares = [undefined, "jardín", "salón", "terraza", "playa", "hotel", "casa", "piscina del conjunto"];
    const momentos = [undefined, "noche", "atardecer", "día"];
    const largos: number[] = [];
    for (const evento of eventos) for (const espacio of lugares) for (const momento of momentos) for (const opciones of [{}, { enAlto: true }, { mesaPrincipal: true }, { piezas: 3 }]) {
      const contexto = buildVisualContext({ brief: { tipo_evento: evento, ...(espacio ? { espacio } : {}), ...(momento ? { momento_dia: momento } : {}) }, userRequest: evento });
      const entorno = entornoDeEscena({ contexto, nivel: 2, modo: "text_to_image" })!;
      const nombre = `${JSON.stringify(opciones)} ${evento} / ${espacio ?? "-"} / ${momento ?? "-"}`;
      const compacta = fraseEntorno(entorno, "compacto", opciones);
      // Lo que ocupa en el caption: «<encuadre>. » antes de la decoración y «<escena>. » después.
      const largo = `${compacta.encuadre}. ${compacta.escena}. `.length;
      largos.push(largo);
      assert.ok(largo >= 120 && largo <= 260, `${nombre}: compacta de ${largo}\n${compacta.encuadre}. ${compacta.escena}`);
      const completa = fraseEntorno(entorno, "completo", opciones);
      const media = fraseEntorno(entorno, "medio", opciones);
      const minima = fraseEntorno(entorno, "minimo", opciones);
      for (const texto of [compacta.escena, media.escena, completa.escena, minima.escena, ENCUADRE_ESCENA]) {
        assert.deepEqual(findFluxPromptLanguageLeaks(texto), [], `sin español: ${texto}`);
        assert.doesNotMatch(texto, PALABRA_DE_COLOR, `sin colores: ${texto}`);
        assert.doesNotMatch(texto, /\b(?:sign|signage|text|letters?|banner|logo|arch(?:es)?|frame|garland|column|backdrop|plain|curtain|fabric|wall)\b/i, `ni letreros, ni estructuras, ni nada liso detrás: ${texto}`);
      }
      for (const [forma, texto] of [["completa", completa.escena], ["media", media.escena], ["compacta", compacta.escena], ["mínima", minima.escena]] as const) {
        assert.match(texto, DETRAS_DE_LAS_PIEZAS, `${nombre}: la ${forma} dice qué hay detrás de las piezas\n${texto}`);
        assert.match(texto, GUARDA, `${nombre}: la ${forma} lleva la guarda`);
        if ("piezas" in opciones) assert.match(texto, /\bthree (?:described balloon )?pieces\b/, `${nombre}: la ${forma} cuenta las piezas`);
        else assert.doesNotMatch(texto, /\b(?:two|three|four|five|six) (?:described balloon )?pieces\b/, `${nombre}: sin número si no se pudo contar`);
      }
      for (const forma of [completa, media, compacta]) assert.equal(forma.encuadre, ENCUADRE_ESCENA, `${nombre}: el encuadre`);
      // Lo que dijo el cliente no se pierde en la compacta: su lugar abre la frase y su hora la acompaña.
      if (entorno.lugarCliente) assert.ok(compacta.escena.toLowerCase().includes(entorno.lugarCliente.toLowerCase()), `${nombre}: el lugar del cliente en la compacta\n${compacta.escena}`);
      const hora = { noche: /\bat night\b/i, atardecer: /\bat dusk\b/i, dia: /\bdaylight\b/i }[entorno.momento];
      for (const texto of [compacta.escena, media.escena, completa.escena, minima.escena]) if (entorno.momento !== "dia" || texto !== minima.escena) assert.match(texto, hora, `${nombre}: la hora (${entorno.momento})\n${texto}`);
      if ("enAlto" in opciones) assert.doesNotMatch(`${compacta.escena} ${media.escena} ${completa.escena}`, /far behind the pieces|continuing far behind/, `${nombre}: piezas colgadas, el salón a sus lados`);
      if ("mesaPrincipal" in opciones && entorno.mesa) assert.match(compacta.escena, /\bthe (?:lit )?main table set with\b/, `${nombre}: la mesa es la principal`);
      assert.ok(minima.escena.length <= 140, `mínima corta: ${minima.escena}`);
      assert.ok(avisoNoCotizadoEntorno(entorno)?.endsWith("no están incluidos en la cotización."), "aviso de lo que añade");
    }
    if (IMPRIMIR) console.log(`     compacta con encuadre: ${Math.min(...largos)}-${Math.max(...largos)} caracteres`);
  });

  await caso("aviso: el del entorno nombra lo añadido; sin entorno, el de siempre", () => {
    const entorno = entornoDeEscena({ contexto: buildVisualContext({ brief: { tipo_evento: "cumpleaños" }, userRequest: "cumpleaños de mi hijo de 6 años" }), nivel: 2, modo: "text_to_image" });
    assert.equal(avisoNoCotizadoDeImagen(ambienteDeFiesta("ninguno"), [], entorno), "La mesa de postres, la torta, los dulces, los regalos, las luces, el confeti, la iluminación y las mesas de invitados de la vista previa son ambientación: no están incluidos en la cotización.");
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
    // Sin hora: de noche, con la luz del fondo en tono frío (rojo y dorado compiten con el ámbar), el salón con
    // invitados detrás de las piezas, la mesa temática iluminada a un lado y la guarda con las tres piezas.
    assert.equal(entorno.momento, "noche");
    assert.match(delEntorno, /^(?:A lively kids' party room at night: the walls washed in cool-toned uplighting|At night, cool-toned uplighting), /, delEntorno);
    assert.match(delEntorno, /blurred guests (?:and tables )?far behind the pieces/, delEntorno);
    assert.match(delEntorno, /(?:a lit dessert table with a jungle safari themed birthday cake at one side|at one side a dessert table with a jungle safari themed birthday cake)/, delEntorno);
    assert.match(delEntorno, /the only balloons are the three pieces described|the three described balloon pieces/, delEntorno);
    assert.doesNotMatch(despues.prompt, /plain wall/, "con entorno, el hueco entre piezas no es «de pared lisa»");
    assert.doesNotMatch(despues.prompt, /celebration atmosphere/, "la pista suelta del evento la sustituye el entorno");
    // La decoración intacta: las tres piezas, la punta libre del semiarco, las torres sueltas, las tres piezas.
    assert.ok(despues.prompt.startsWith(`${ENCUADRE_ESCENA}. An asymmetrical one-sided curved organic balloon garland`), despues.prompt);
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
    // El jardín y el atardecer que dijo el cliente: el jardín sigue detrás de las piezas con invitados, la mesa de los
    // novios iluminada a un lado. Un solo arco: la guarda sin número.
    assert.equal(entorno.momento, "atardecer");
    assert.match(delEntorno, /^A lush garden (?:with trees and open sky set for a wedding reception, at dusk: |set for a wedding at dusk: |at dusk, )/, delEntorno);
    assert.match(delEntorno, /(?:the grounds continuing far behind the pieces with softly blurred guests and tables|blurred guests (?:and tables )?far behind the pieces)/, delEntorno);
    assert.match(delEntorno, /(?:at one side a sweetheart table with fine linens and a tiered wedding cake|a lit sweetheart table with a wedding cake at one side)/, delEntorno);
    assert.doesNotMatch(delEntorno, /\b(?:two|three) (?:described balloon )?pieces\b/, "una pieza: sin número");
    assert.ok(despues.prompt.startsWith(`${ENCUADRE_ESCENA}. An organic balloon garland arch, 3 m / 10 ft wide and 2.5 m / 8 ft tall with about 145 balloons, made of `), despues.prompt);
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
    // Evento de día sin hora: al atardecer. La guirnalda cuelga de la pared: el salón se abre a sus lados (no detrás).
    assert.equal(entorno.momento, "atardecer");
    assert.match(delEntorno, /^(?:A bright, airy baby shower lounge with tall windows and potted plants, at dusk|An airy baby shower lounge at dusk|At dusk)[,:] /, delEntorno);
    assert.match(delEntorno, /the (?:lit )?main table set with a tiered cake/, delEntorno);
    assert.match(delEntorno, /at both sides of the pieces/, delEntorno);
    assert.doesNotMatch(delEntorno, /far behind the pieces/, "pieza colgada: nada detrás de la pared");
    // Antes la expresión llevaba dos caracteres de retroceso (0x08) en vez de «\b» y nunca podía fallar.
    assert.doesNotMatch(despues.prompt, /\ba dessert table\b/, "una sola mesa: la principal, no una segunda");
    assert.ok(despues.prompt.startsWith(`${ENCUADRE_ESCENA}. A small organic balloon garland, 2.4 m / 8 ft long with about 37 balloons, made of `), despues.prompt);
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

  // ── 5. El caso del dueño (guiada-20261007-070255-dzwwhq): la composición ganadora cabe y la decoración no cambia ───
  await caso("5. dueño (fútbol, arco asimétrico + 2 columnas): encuadre primero, noche con invitados detrás y la MISMA decoración, entera", async () => {
    type FixtureDueno = { cuerpo: CuerpoGenerateGuardado; python: RespuestaResolvePython };
    const fijado = JSON.parse(readFileSync(path.join(RAIZ, "scripts", "test", "fixtures", "plan-guiada-dzwwhq-futbol.json"), "utf8")) as FixtureDueno;
    const r = await captionDeCuerpoGenerate(fijado.cuerpo, fijado.python);
    const entorno = r.entrada.entorno!;
    informe.push({ caso: "5. dueño (fútbol)", antes: compileProductPrompt({ ...r.entrada, entorno: undefined }).prompt, despues: r.prompt });
    const delEntorno = comunes("dueño", r.prompt, r.preflight, entorno);
    assert.equal(entorno.momento, "noche", "sin hora: de noche");
    assert.equal(entorno.tonoLuz, "warm amber", "verde, negro y blanco no compiten con el ámbar");
    // La escena entera de la ronda 2 cabe en 1500 sin quitarle nada a la decoración.
    assert.equal(delEntorno, "At night, warm amber uplighting, string light bokeh, blurred guests far behind the pieces, a lit dessert table with a soccer themed birthday cake at one side, the only balloons are the three pieces described. Professional event photograph, realistic latex balloons with natural reflections, sharp detail, natural depth, grounded supports.");
    // La decoración: entre el encuadre y el entorno, con su escala, tallas, patrón y colores; la misma con y sin encuadre.
    const decoracion = r.prompt.slice(`${ENCUADRE_ESCENA}. `.length, r.prompt.length - delEntorno.length);
    for (const exigido of [/^An asymmetrical organic balloon garland arch, 3 m wide, about 269 balloons, made of mixed small 5-inch to extra-large 24-inch /, /two balloon columns, each 2 m tall, about 36 balloons/, /in an ordered gradient up the column from green at the base to white at the top/, /ending flush at its top ring, the last ring of balloons level and bare on top/, /flanking the main arch, each its own freestanding tower\. $/, /standing on the floor on its left leg/]) assert.match(decoracion, exigido, String(exigido));
    for (const hex of ["#43B88E", "#000000", "#FFFFFF"]) assert.ok(decoracion.includes(hex), hex);
    assert.equal(r.preflight.structures.represented, r.preflight.structures.expected, "las tres piezas");
    assert.equal(r.preflight.colors.represented, r.preflight.colors.expected, "los tres colores");
    const sinEncuadre = compileProductPrompt({ ...r.entrada, entorno: { ...entorno, conEncuadre: false } }).prompt;
    assert.ok(sinEncuadre.startsWith(decoracion), "el encuadre no le quita nada a la decoración");
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
