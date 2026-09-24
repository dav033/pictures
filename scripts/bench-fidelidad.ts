import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import sharp from "sharp";
import { analizarReferenciasV2 } from "../src/lib/ia/amaterasu/analizar-referencias-v2";
import { chatDe, imagenDe } from "../src/lib/ia/registro";
import { coloresFotoCliente, coloresFotoParaBusqueda } from "../src/lib/plan/colores-referencia";
import { buildImagePrompt } from "../src/lib/ia/build-image-prompt";
import { GEMINI_COMPOSITION_HARD_LOCK, inputsParaComposicionGemini } from "../src/lib/ia/uzume/lora-gemini-composition";
import type { ImagenEtiquetada } from "../src/lib/ia/tipos";
import { generar, payloadDe, resolverIdentidadLora, saldo, leerEnv } from "./exp-fal-lib";
import { prepararEspacio } from "./bench/espacio";
import { coloresDeEscena, compilarCaption, construirEscena, estructurasDeEscena, repartirColores } from "./bench/escena";
import { analizarVenue } from "../src/lib/ia/analizar-venue";
import { placeStructuresInVenue, type VenuePlacementStructure } from "../src/lib/ia/venue-placement";
import { cargarCorridas, generarInforme } from "./bench/informe";
import { featureEnabled, type FeatureFlag } from "../src/lib/ia/feature-flags";
import { semillaDeEvaluacion } from "../src/lib/ia/lora-seed";
import type { CasoBenchmark, Corrida, FaseBenchmark, PistaColocacion, PistaColor } from "./bench/tipos";

/**
 * Banderas que cambian lo que mide este benchmark. Se registran en la meta de
 * cada corrida para que una diferencia entre fases se pueda atribuir al código
 * y no a una variable de entorno.
 */
const BANDERAS_MEDIDAS: readonly FeatureFlag[] = [
  "MEASURED_COLOR_DOMINANCE_V1",
  "VENUE_AWARE_PLACEMENT_V1",
  "AMBIENTE_FIESTA_V1",
  "REFERENCIA_EN_ETAPA1_V1",
];

/**
 * Benchmark de fidelidad del preview: 4 fotos de referencia + 1 foto del
 * espacio a través de la ruta híbrida real, para poder repetirlo igual después
 * de cada fase del plan y ver la evolución.
 *
 * Alcance, dicho por delante: producción construye la escena desde el PLAN
 * aprobado, no desde la foto (`route.ts:810`), y el plan exige el resolutor
 * Python, un snapshot de catálogo y un token de aprobación. Para no escribir en
 * la base de producción durante una corrida de evaluación, aquí la escena es una
 * plantilla fija coloreada con la paleta que el analizador mide en cada foto
 * (ver `scripts/bench/escena.ts`). Lo que sí se mide de punta a punta: qué
 * extrae el analizador, cuánto sobrevive al catálogo, qué emite el compilador,
 * si pasa el preflight, y si la imagen final conserva el espacio del cliente.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/bench-fidelidad.ts --dry-run
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/bench-fidelidad.ts --fase fase-0-linea-base --espacio "C:/ruta/espacio.jpg" --confirm-spend --max-usd 1.00
 */

function flag(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? porDefecto;
}

/** mulberry32: selección reproducible de referencias entre fases. */
function prng(semilla: number): () => number {
  let s = semilla;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FotoEjemplo = { id: string; titulo: string; evento: string };

function elegirReferencias(cuantas: number, semilla: number): FotoEjemplo[] {
  const manifiesto = JSON.parse(fs.readFileSync("public/referencias-ejemplo/manifiesto.json", "utf8")) as { fotos: FotoEjemplo[] };
  const pool = [...manifiesto.fotos];
  const aleatorio = prng(semilla);
  const elegidas: FotoEjemplo[] = [];
  while (elegidas.length < cuantas && pool.length) elegidas.push(pool.splice(Math.floor(aleatorio() * pool.length), 1)[0]!);
  return elegidas;
}

async function pistaColor(foto: FotoEjemplo): Promise<{ color: PistaColor; paleta: string[]; estructurasReferencia: string[] }> {
  const base64 = fs.readFileSync(`public/referencias-ejemplo/${foto.id}.jpg`).toString("base64");
  const referencia: ImagenEtiquetada = { id: "REF_01", mime: "image/jpeg", base64, descripcion: "Foto de referencia del cliente" };
  const chat = await chatDe("gemini");
  const resultado = await analizarReferenciasV2(chat, [referencia], [], "perceptual", undefined, undefined, { forzarNuevoAnalisis: true });
  const crudos = [...new Set(resultado.blueprint.elements.flatMap((el) => el.appearance?.observed_colors ?? []))];
  // Suma ponderada por área, igual que `coloresMedidosDeFoto`: es lo que hace
  // comparable la participación entre elementos de tamaños distintos.
  const suma = new Map<string, number>();
  for (const el of resultado.blueprint.elements) {
    if (!el.approved) continue;
    const area = el.reference_bbox.width * el.reference_bbox.height;
    for (const entrada of el.appearance.measured_colors ?? []) suma.set(entrada.color, (suma.get(entrada.color) ?? 0) + entrada.share * area);
  }
  const totalArea = [...suma.values()].reduce((a, b) => a + b, 0);
  const participaciones = totalArea > 0
    ? [...suma.entries()].sort((uno, otro) => otro[1] - uno[1]).map(([color, peso]) => ({ color, share: Number((peso / totalArea).toFixed(4)) }))
    : [];
  // D10: qué formas vio el analizador. La plantilla del benchmark es fija, así
  // que sin esto una referencia que no es un arco se informa como si lo fuera.
  const estructurasReferencia: string[] = [];
  for (const el of resultado.blueprint.elements) {
    if (!el.approved) continue;
    const clase = el.visual_semantics?.structure_type;
    if (clase && !estructurasReferencia.includes(clase)) estructurasReferencia.push(clase);
  }
  const paletaCatalogo = coloresFotoCliente(resultado.blueprint);
  const paletaBusqueda = coloresFotoParaBusqueda(resultado.blueprint);
  return {
    paleta: paletaCatalogo,
    color: {
      elementos: resultado.blueprint.elements.length,
      coloresCrudos: crudos,
      paletaCatalogo,
      paletaBusqueda,
      perdidos: paletaCatalogo.filter((c) => !paletaBusqueda.includes(c)),
      sinConcepto: [],
      renderizables: [],
      participaciones,
    },
    estructurasReferencia,
  };
}

async function main(): Promise<void> {
  const fase = flag("fase", "fase-0-linea-base") as FaseBenchmark;
  const rutaEspacio = flag("espacio", "");
  const semillaSeleccion = Number(flag("seed", "20260917"));
  const cuantas = Number(flag("referencias", "4"));
  const seco = process.argv.includes("--dry-run");

  const referencias = elegirReferencias(cuantas, semillaSeleccion);
  const identidad = resolverIdentidadLora(flag("artifact-id", "v004-1000"));

  if (seco) {
    console.log(`[DRY-RUN] fase=${fase} seed=${semillaSeleccion} lora=${identidad.artifactId} (${identidad.evaluationStatus})`);
    console.log(`  espacio: ${rutaEspacio || "(falta --espacio)"}`);
    referencias.forEach((f, i) => console.log(`  caso ${i + 1}: ${f.id} · ${f.titulo} · seed imagen ${101 + i * 101}`));
    console.log(`  llamadas pagadas previstas: ${cuantas} analisis (2 Gemini c/u) + ${cuantas} fal + ${cuantas} composicion Gemini`);
    return;
  }

  if (process.env.CI === "true") throw new Error("CI_SPEND_FORBIDDEN: esta corrida gasta dinero real. Usa --dry-run.");
  if (!process.argv.includes("--confirm-spend")) throw new Error("CONFIRM_SPEND_REQUIRED: repite con --confirm-spend y --max-usd <tope>.");
  const maxUsd = Number(flag("max-usd", ""));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("MAX_USD_REQUIRED: pasa --max-usd <tope> mayor que 0.");
  if (!rutaEspacio) throw new Error("Pasa --espacio <ruta a la foto del espacio>.");

  const key = leerEnv("FAL_KEY");
  if (!key) throw new Error("Falta FAL_KEY en .env.local");

  const espacio = await prepararEspacio(rutaEspacio);
  const salida = path.join("reports/bench", fase);
  const mini = path.join(salida, "mini");
  fs.mkdirSync(mini, { recursive: true });
  await sharp(Buffer.from(espacio.venue.base64, "base64")).resize({ width: 512 }).jpeg({ quality: 78 }).toFile(path.join(mini, "espacio.jpg"));

  const saldoAntes = await saldo(key);
  console.log(`bench ${fase} · ${referencias.length} casos · lora ${identidad.artifactId} · saldo US$${saldoAntes ?? "?"} · tope US$${maxUsd}`);

  const port = await imagenDe("gemini");

  // La foto del espacio es la misma en los cuatro casos, asi que su analisis se
  // hace una vez.
  //
  // La puerta es la MISMA que usa produccion (`VENUE_AWARE_PLACEMENT_V1`), y
  // `--colocacion` queda como atajo para encenderla sin exportar la variable.
  // Antes solo existia el atajo, asi que una corrida con la bandera puesta
  // medía el camino sin colocacion y la meta decia lo contrario: la corrida no
  // era atribuible, que es justo lo que registrar banderas debia evitar.
  const colocacionPedida = process.argv.includes("--colocacion") || featureEnabled("VENUE_AWARE_PLACEMENT_V1");
  let colocacion: PistaColocacion | null = null;
  if (colocacionPedida) {
    try {
      const chatVenue = await chatDe("gemini");
      const { analysis } = await analizarVenue(chatVenue, espacio.venue);
      const estructuras: VenuePlacementStructure[] = [
        { element_id: "EST_01_ARCO", category: "balloon_structure", scene_role: "midground", reference_bbox: { x: 0.2, y: 0.08, width: 0.6, height: 0.62 }, visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "EST_01_ARCO", density: "media" }, approved: true, include_policy: "include" },
        { element_id: "EST_02_COL_IZQ", category: "balloon_structure", scene_role: "midground", reference_bbox: { x: 0.04, y: 0.2, width: 0.18, height: 0.7 }, visual_semantics: { structure_type: "columna", placement: "lateral_izquierdo", design_role: "soporte", repetition_group: "cols", density: "media" }, approved: true, include_policy: "include" },
        { element_id: "EST_03_COL_DER", category: "balloon_structure", scene_role: "midground", reference_bbox: { x: 0.78, y: 0.2, width: 0.18, height: 0.7 }, visual_semantics: { structure_type: "columna", placement: "lateral_derecho", design_role: "soporte", repetition_group: "cols", density: "media" }, approved: true, include_policy: "include" },
      ] as VenuePlacementStructure[];
      const cajas = placeStructuresInVenue(analysis, estructuras);
      colocacion = {
        usada: Object.keys(cajas).length > 0,
        aperturas: analysis.openings.length,
        paredesPlanas: analysis.flat_walls.length,
        obstaculos: analysis.obstacles.length,
        anclasMetricas: analysis.metric_anchors.length,
        cajas,
        fallo: null,
      };
      console.log(`colocacion: ${colocacion.aperturas} aperturas · ${colocacion.paredesPlanas} paredes · ${colocacion.obstaculos} obstaculos · ${Object.keys(cajas).length} cajas asignadas`);
    } catch (error) {
      colocacion = { usada: false, aperturas: 0, paredesPlanas: 0, obstaculos: 0, anclasMetricas: 0, cajas: {}, fallo: String(error).slice(0, 200) };
      console.log(`colocacion: FALLO ${colocacion.fallo}`);
    }
  }

  const casos: CasoBenchmark[] = [];

  for (const [indice, foto] of referencias.entries()) {
    const semillaImagen = 101 + indice * 101;
    process.stdout.write(`-> ${foto.id} `);
    const { color, paleta, estructurasReferencia } = await pistaColor(foto);
    const reparto = repartirColores(paleta);
    color.sinConcepto = reparto.sinConcepto;
    color.renderizables = reparto.renderizables;
    process.stdout.write(`· paleta [${paleta.join(",")}] · renderizables [${reparto.renderizables.join(",")}] `);

    const caso: CasoBenchmark = {
      referencia: foto.id, titulo: foto.titulo, fixturePlan: "plantilla-arco-dos-columnas", semillaImagen,
      color, caption: null, preflight: null, imagen: { etapa1: null, final: null, fallo: null }, qa: null, juez: null, colocacion,
      estructura: null,
    };
    await sharp(`public/referencias-ejemplo/${foto.id}.jpg`).resize({ width: 512 }).jpeg({ quality: 78 }).toFile(path.join(mini, `ref-${foto.id}.jpg`));

    if (reparto.renderizables.length === 0) {
      caso.imagen.fallo = `LORA_PRODUCT_VOCABULARY_FAILED: ningun color de la foto (${reparto.sinConcepto.join(", ")}) tiene concepto en el vocabulario`;
      casos.push(caso);
      console.log("· sin color renderizable");
      continue;
    }

    const spec = construirEscena(reparto.renderizables, espacio.aspecto, colocacion?.usada ? colocacion.cajas : undefined);

    // D10, la aserción de cotización. `renderizables` dice qué colores de la
    // foto el vocabulario sabe dibujar; `cotizados` dice cuáles la escena pide
    // de verdad. La plantilla usa tres colores en el arco y dos en cada columna,
    // así que la diferencia no es vacía por construcción, y es la clase de
    // defecto de D7: un color detectado que después no compra nada.
    const cotizados = coloresDeEscena(spec);
    color.cotizados = cotizados;
    color.sinLinea = reparto.renderizables.filter((c) => !cotizados.includes(c));
    const estructurasEscena = estructurasDeEscena(spec);
    caso.estructura = {
      referencia: estructurasReferencia,
      escena: estructurasEscena,
      ausentes: estructurasReferencia.filter((clase) => !estructurasEscena.includes(clase)),
    };
    if (color.sinLinea.length) process.stdout.write(`· SIN LINEA [${color.sinLinea.join(",")}] `);

    const compilado = compilarCaption(spec, identidad.trigger);
    caso.caption = compilado.caption;
    caso.preflight = compilado.preflight;

    try {
      const etapa1 = await generar(key, payloadDe(
        { id: foto.id, prompt: compilado.promptFal.replace(new RegExp(`^${identidad.trigger},\\s*`), ""), lora: 0.8, seed: semillaImagen },
        { seed: semillaImagen, guidance: 3.5, ancho: 1024, alto: 1536, loraUrl: identidad.url, trigger: identidad.trigger },
      ));
      const archivo1 = path.join(salida, `${foto.id}-etapa1.png`);
      fs.writeFileSync(archivo1, etapa1.bytes);
      caso.imagen.etapa1 = archivo1;
      await sharp(etapa1.bytes).resize({ width: 512 }).jpeg({ quality: 78 }).toFile(path.join(mini, `${foto.id}-etapa1.jpg`));

      const inputs = inputsParaComposicionGemini(espacio.venue, { base64: etapa1.bytes.toString("base64"), mime: "image/png" });
      // `buildImagePrompt` recibe el mapa de roles, no las imagenes (route.ts:1195-1198).
      const promptComposicion = `${buildImagePrompt({
        sceneSpec: spec,
        inputs: inputs.map(({ id, role, allowed_use }) => ({ image_id: id, role, allowed_use })),
      })}\n\n${GEMINI_COMPOSITION_HARD_LOCK}`;
      const final = await port.generar({ prompt: promptComposicion, sceneSpec: spec, inputs, aspecto: espacio.aspecto, calidad: "alta" });
      const archivoFinal = path.join(salida, `${foto.id}-final.png`);
      fs.writeFileSync(archivoFinal, Buffer.from(final.imagen.base64, "base64"));
      caso.imagen.final = archivoFinal;
      await sharp(Buffer.from(final.imagen.base64, "base64")).resize({ width: 512 }).jpeg({ quality: 78 }).toFile(path.join(mini, `${foto.id}-final.jpg`));

      console.log(`· ok · preflight ${compilado.preflight.ok ? "ok" : "FALLA"}`);
    } catch (error) {
      caso.imagen.fallo = String(error).slice(0, 200);
      console.log(`· FALLO ${caso.imagen.fallo}`);
    }
    casos.push(caso);
  }

  const saldoDespues = await saldo(key);
  const corrida: Corrida = {
    meta: {
      fase, fecha: new Date().toISOString(),
      commit: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
      semillaSeleccion,
      espacio: { nombre: path.basename(rutaEspacio), ancho: espacio.original.ancho, alto: espacio.original.alto },
      slotLora: { slug: "training_1", artifactId: identidad.artifactId, trigger: identidad.trigger, evaluationStatus: identidad.evaluationStatus, escala: 0.8 },
      modelos: { lora: "fal-ai/flux-2/lora", imagen: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image", chat: process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash" },
      parametros: { pasos: 28, guidance: 3.5, ancho: 1024, alto: 1536 },
      banderas: Object.fromEntries(BANDERAS_MEDIDAS.map((nombre) => [nombre, featureEnabled(nombre)])),
      semillaImagen: semillaDeEvaluacion() ?? null,
      gastoUsd: saldoAntes !== null && saldoDespues !== null ? Number((saldoAntes - saldoDespues).toFixed(4)) : null,
    },
    casos,
  };
  fs.writeFileSync(path.join(salida, "resultado.json"), JSON.stringify(corrida, null, 2));

  const informe = generarInforme(cargarCorridas("reports/bench"));
  fs.writeFileSync("reports/bench/informe.html", informe);
  console.log(`\nresultado: ${path.join(salida, "resultado.json")}`);
  console.log(`informe:   reports/bench/informe.html · gasto real US$${corrida.meta.gastoUsd ?? "?"}`);
}

void main();
