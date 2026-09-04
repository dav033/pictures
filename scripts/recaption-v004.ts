import fs from "node:fs";
import path from "node:path";

/**
 * Recaptionador del dataset del LoRA Sempertex, para el reentrenamiento.
 *
 * Cada regla del prompt sale de una medición sobre los 154 captions actuales
 * (ver «ESPECIFICACIÓN DEL REENTRENAMIENTO» en HANDOFF-LORA-COMPOSICION.md):
 *
 *   · 93% mete cláusula de iluminación y 67% TERMINA en ella. Es constante, así
 *     que describirla en cada caption impide que el trigger se quede con el
 *     estilo y acopla estilo con composición. Se elimina.
 *   · 5,6 palabras de acabado/luz por caption contra 1,3 espaciales (4,4:1). Hay
 *     que invertir el peso hacia el layout.
 *   · 0 de 154 captions expresan una relación BILATERAL, y el prompt de
 *     producción pide exactamente eso. Es el hueco que explica que las columnas
 *     se fundan en las patas del arco.
 *   · De 44 captions con `arch`, 14 son un panel plano y 3 un aro metálico. Esa
 *     ambigüedad explica los «portales rectangulares».
 *   · 41% menciona cartelería, de ahí el texto basura en la salida.
 *
 * La bilateralidad se escribe SIN «left/right» a propósito: el trainer de fal no
 * permite apagar la augmentación, y si voltea las imágenes la lateralidad se
 * vuelve ruido. `on either side` da la relación bilateral y sobrevive al volteo.
 *
 * Correr:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/recaption-v004.ts --muestra 6
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/recaption-v004.ts        # las 154
 *
 * También acepta otra carpeta de trabajo y puede completar solo captions
 * faltantes, para ampliar el conjunto sin volver a procesar v004:
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/recaption-v004.ts --raiz data/staging/recaption-v005 --solo-pendientes
 */

const RAIZ = path.join(process.cwd(), arg("raiz") ?? "data/staging/recaption-v004");
const ORIGEN = path.join(RAIZ, "original");
const DESTINO = path.join(RAIZ, "nuevo");
const TRIGGER = "eventdecor_style_v2";
const CONCURRENCIA = 4;
const SOLO_PENDIENTES = process.argv.includes("--solo-pendientes");

const INSTRUCCION = `You caption photos of real balloon-decoration installations to train a STYLE LoRA.

The trigger word "${TRIGGER}" must own everything that is CONSTANT across the dataset: the
photographic look, the lighting, the mood, the render quality. So you must NEVER describe those.
Your caption describes only what VARIES from photo to photo: which structures are present, what
they are made of, and — above all — HOW THEY ARE ARRANGED IN SPACE.

Write ONE caption, 45 to 70 words, lowercase, no trailing period issues, in this exact shape:

${TRIGGER}, <structures with their materials and their spatial arrangement>, set against <the wall/floor/room surface>.

HARD RULES

1. NEVER mention: lighting, lit, glow, soft, warm, bright, ambience, mood, atmosphere, photo,
   photograph, photorealistic, camera, depth of field, quality, aesthetic. Not once.
2. ALWAYS state where each structure sits relative to the others and to the room.
3. When two matching structures sit on opposite sides of a central one, you MUST write
   "flanked by a matching <structure> on either side". NEVER write "left", "right",
   "on the left", "on the right" — the trainer may mirror the image and that would teach noise.
   Use "on either side", "at each end", "on both sides".
4. Disambiguate arches, this is critical:
   - a real three-dimensional arch built of balloons -> "balloon garland arch"
   - a flat board or panel cut in an arch silhouette -> "flat arch-shaped backdrop panel"
   - a bare metal hoop or circular frame -> "metal ring frame"
   Never call a flat panel or a metal hoop an "arch".
5. Signage: refer to it generically as "a sign", "a name sign", "a number marquee". NEVER
   transcribe or quote the letters, words, names or digits shown.
6. Balloon vocabulary — use these exact terms: sizes "large" / "small"; finishes "matte",
   "glossy chrome", "metallic foil", "pearl", "satin", "confetti". Name the real colors.
7. Describe only what you can actually see. No invention.

Return ONLY the caption text. No preamble, no quotes, no markdown.`;

type Resultado = { nombre: string; antes: string; despues: string; error?: string };

function leerEnv(clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave];
  const archivo = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(archivo)) return undefined;
  return fs.readFileSync(archivo, "utf8").match(new RegExp(`^${clave}=(.*)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");
}

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Normaliza lo que devuelva el modelo: un solo trigger al inicio, sin comillas ni saltos. */
function normalizar(texto: string): string {
  let t = texto.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ");
  t = t.replace(new RegExp(`^${TRIGGER},?\\s*`, "i"), "");
  if (!t.endsWith(".")) t += ".";
  return `${TRIGGER}, ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

async function captionar(clave: string, modelo: string, imagen: Buffer, mime: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${clave}`;
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: INSTRUCCION }, { inline_data: { mime_type: mime, data: imagen.toString("base64") } }] }],
      // Gemini 3.x razona antes de responder y ese razonamiento consume el
      // presupuesto de salida: con 400 tokens la respuesta volvía truncada y con
      // eco de la instrucción. MINIMAL + margen amplio lo resuelve.
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!respuesta.ok) throw new Error(`Gemini ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
  const cuerpo = await respuesta.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const texto = cuerpo.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!texto) throw new Error("Gemini no devolvió texto.");
  return normalizar(texto);
}

async function main(): Promise<void> {
  const clave = leerEnv("GEMINI_API_KEY");
  if (!clave) throw new Error("Falta GEMINI_API_KEY en .env.local");
  const modelo = arg("modelo") ?? leerEnv("GEMINI_CHAT_MODEL") ?? "gemini-3.6-flash";
  if (!fs.existsSync(ORIGEN)) throw new Error(`Falta ${ORIGEN}. Descomprimir primero el zip de entrenamiento.`);

  const imagenes = fs.readdirSync(ORIGEN).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  const pendientes = SOLO_PENDIENTES
    ? imagenes.filter((archivo) => !fs.existsSync(path.join(DESTINO, `${archivo.replace(/\.[^.]+$/, "")}.txt`)))
    : imagenes;
  const muestra = Number(arg("muestra") ?? "0");
  // La muestra se toma repartida a lo largo del set, no los primeros N: los
  // primeros archivos comparten sesión de fotos y no representan el dataset.
  const paso = muestra > 0 ? Math.max(1, Math.floor(pendientes.length / muestra)) : 1;
  const objetivo = muestra > 0 ? pendientes.filter((_, i) => i % paso === 0).slice(0, muestra) : pendientes;

  fs.mkdirSync(DESTINO, { recursive: true });
  console.log(`modelo ${modelo} · ${objetivo.length} de ${imagenes.length} imagenes${SOLO_PENDIENTES ? " · solo pendientes" : ""}`);

  const resultados: Resultado[] = [];
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, objetivo.length) }, async () => {
      while (siguiente < objetivo.length) {
        const archivo = objetivo[siguiente++]!;
        const nombre = archivo.replace(/\.[^.]+$/, "");
        const antes = fs.existsSync(path.join(ORIGEN, `${nombre}.txt`)) ? fs.readFileSync(path.join(ORIGEN, `${nombre}.txt`), "utf8").trim() : "";
        try {
          const mime = /\.png$/i.test(archivo) ? "image/png" : /\.webp$/i.test(archivo) ? "image/webp" : "image/jpeg";
          const despues = await captionar(clave, modelo, fs.readFileSync(path.join(ORIGEN, archivo)), mime);
          fs.writeFileSync(path.join(DESTINO, `${nombre}.txt`), despues, "utf8");
          resultados.push({ nombre, antes, despues });
          process.stdout.write(".");
        } catch (error) {
          resultados.push({ nombre, antes, despues: "", error: String(error) });
          process.stdout.write("x");
        }
      }
    }),
  );
  console.log("");

  const ok = resultados.filter((r) => !r.error);
  fs.writeFileSync(path.join(RAIZ, "recaption-log.json"), JSON.stringify(resultados, null, 2));

  if (muestra > 0) {
    for (const r of resultados.slice(0, 6)) {
      console.log(`\n${"=".repeat(78)}\n${r.nombre}\n${"=".repeat(78)}`);
      console.log(`ANTES  (${r.antes.split(/\s+/).length} pal.): ${r.antes}`);
      console.log(`\nDESPUÉS(${r.despues.split(/\s+/).length} pal.): ${r.despues || r.error}`);
    }
  }

  // Las mismas métricas de la especificación, para ver si el recaptionado movió la aguja.
  const medir = (textos: string[], etiqueta: string) => {
    const n = textos.length || 1;
    const limpio = textos.map((t) => t.replace(new RegExp(`^${TRIGGER},?\\s*`, "i"), "").toLowerCase());
    const ESTILO = /\b(matte|glossy|chrome|metallic|metalized|pearl|satin|foil|shiny|reflective|confetti|lighting|lit|sheen|finish|pastel|neon|iridescent)\b/g;
    const LAYOUT = /\b(left|right|center|centered|behind|beside|above|below|front|flanking|flanked|between|corner|against|opposite|adjacent|either side|both sides|each end|on top of)\b/g;
    const e = limpio.reduce((a, t) => a + (t.match(ESTILO) ?? []).length, 0) / n;
    const l = limpio.reduce((a, t) => a + (t.match(LAYOUT) ?? []).length, 0) / n;
    const bil = limpio.filter((t) => /either side|both sides|each end/.test(t)).length;
    const luz = limpio.filter((t) => /lighting|lit\b/.test(t)).length;
    const lr = limpio.filter((t) => /\bleft\b|\bright\b/.test(t)).length;
    console.log(
      `${etiqueta.padEnd(9)} estilo ${e.toFixed(1)} · layout ${l.toFixed(1)} · ratio ${(e / (l || 1)).toFixed(1)}:1` +
      ` · bilateral ${bil}/${n} · con luz ${luz}/${n} · con left/right ${lr}/${n}`,
    );
  };
  console.log(`\n${"=".repeat(78)}\nMÉTRICAS (${ok.length} captions)\n${"=".repeat(78)}`);
  medir(ok.map((r) => r.antes), "ANTES");
  medir(ok.map((r) => r.despues), "DESPUÉS");
  if (resultados.length !== ok.length) console.log(`\nfallaron ${resultados.length - ok.length}; ver recaption-log.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
