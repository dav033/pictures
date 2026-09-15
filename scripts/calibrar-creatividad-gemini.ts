/**
 * PAID calibration run: creativity levels 0-5 on the standard Gemini image
 * path, text only (no venue, reference or catalog photos). For every scenario
 * of scripts/lib/calibracion-creatividad.ts, level and repetition it builds the
 * /api/generate prompt, calls the app's Gemini image port and the visual QA
 * observer, and writes image, prompt and QA under --out (outside the repo).
 * Gemini image has no seed control: a repetition is a fresh draw of the same
 * prompt, which measures the noise between levels.
 *
 * Preview without cost: --dry writes prompts only.
 * Run (paid):
 *   env DATABASE_URL= FAL_KEY= npx tsx --conditions=react-server --env-file=.env.local \
 *     scripts/calibrar-creatividad-gemini.ts --out ~/dev/pictures-infra/iteracion5/calibracion/baseline
 * DATABASE_URL is blanked so provider telemetry never reaches the production
 * database. Rerunning skips images already on disk (delete one to redo it).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NIVELES_CREATIVIDAD, type NivelCreatividad } from "@/lib/ia/creatividad";
import { crearImagenGemini } from "@/lib/ia/gemini/imagen";
import { buildGenerationQa } from "@/lib/ia/generation-qa";
import { ESCENARIOS, promptParaNivel, resolverEscenario } from "./lib/calibracion-creatividad";

type Opciones = { out: string; dry: boolean; qa: boolean; reps: number; niveles: NivelCreatividad[]; escenarios: string[]; concurrencia: number };

function parseArgs(argv: string[]): Opciones {
  const valor = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const out = valor("--out");
  if (!out) throw new Error("--out <directorio> es obligatorio (fuera del repo).");
  const resolved = path.resolve(out.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  const repo = path.resolve(process.cwd());
  if (resolved === repo || resolved.startsWith(`${repo}${path.sep}`)) throw new Error("--out debe quedar fuera del repositorio.");
  const reps = Number(valor("--reps") ?? "1");
  const concurrencia = Number(valor("--concurrency") ?? "3");
  if (!Number.isInteger(reps) || reps < 1 || reps > 3) throw new Error("--reps debe ser 1..3.");
  if (!Number.isInteger(concurrencia) || concurrencia < 1 || concurrencia > 4) throw new Error("--concurrency debe ser 1..4.");
  const niveles = (valor("--levels") ?? "0,1,2,3,4,5").split(",").map(Number);
  if (niveles.some((nivel) => !(NIVELES_CREATIVIDAD as readonly number[]).includes(nivel))) throw new Error("--levels debe ser una lista de 0..5.");
  const escenarios = (valor("--scenarios") ?? ESCENARIOS.map((escenario) => escenario.id).join(",")).split(",");
  const desconocidos = escenarios.filter((id) => !ESCENARIOS.some((escenario) => escenario.id === id));
  if (desconocidos.length) throw new Error(`Escenarios desconocidos: ${desconocidos.join(", ")}`);
  return { out: resolved, dry: argv.includes("--dry"), qa: !argv.includes("--no-qa"), reps, niveles: niveles as NivelCreatividad[], escenarios, concurrencia };
}

async function enParalelo<T>(tareas: Array<() => Promise<T>>, limite: number): Promise<T[]> {
  const resultados: T[] = [];
  let siguiente = 0;
  await Promise.all(Array.from({ length: limite }, async () => {
    while (siguiente < tareas.length) {
      const index = siguiente++;
      resultados[index] = await tareas[index]!();
    }
  }));
  return resultados;
}

async function main(): Promise<void> {
  const opciones = parseArgs(process.argv.slice(2));
  if (!opciones.dry && !process.env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY (usa --env-file=.env.local o --dry).");
  const port = crearImagenGemini();
  const tareas: Array<() => Promise<Record<string, unknown>>> = [];
  for (const escenario of ESCENARIOS.filter((item) => opciones.escenarios.includes(item.id))) {
    const escena = await resolverEscenario(escenario);
    const dir = path.join(opciones.out, escenario.id);
    await mkdir(dir, { recursive: true });
    for (const nivel of opciones.niveles) {
      const { prompt, visualContext } = promptParaNivel(escenario, escena, nivel);
      const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
      await writeFile(path.join(dir, `n${nivel}.prompt.txt`), prompt);
      for (let rep = 1; rep <= opciones.reps; rep += 1) {
        const base = path.join(dir, `n${nivel}-r${rep}`);
        const resumen = { escenario: escenario.id, nivel, rep, promptHash, promptChars: prompt.length, venue: visualContext.venue ?? null, timeOfDay: visualContext.timeOfDay ?? null };
        if (opciones.dry) {
          tareas.push(async () => resumen);
          continue;
        }
        tareas.push(async () => {
          if (existsSync(`${base}.jpg`) && existsSync(`${base}.json`)) return JSON.parse(await readFile(`${base}.json`, "utf8")) as Record<string, unknown>;
          const inicio = Date.now();
          try {
            const result = await port.generar({ prompt, sceneSpec: escena.sceneSpec, inputs: [], aspecto: "3:2", calidad: "borrador", revisionMode: "new_generation", telemetria: { superficie: "calibracion-creatividad" } });
            await writeFile(`${base}.jpg`, Buffer.from(result.imagen.base64, "base64"));
            const qa = opciones.qa
              ? await buildGenerationQa({ sceneSpec: escena.sceneSpec, image: result.imagen, hashes: { planHash: escena.plan.plan_hash, sceneSpecHash: promptHash }, materialEstimate: escena.materialEstimate, force: true, plan: escena.qaPlan, creatividad: nivel })
              : null;
            const salida = { ...resumen, modelo: result.modelo, ms: Date.now() - inicio, qa };
            await writeFile(`${base}.json`, JSON.stringify(salida, null, 2));
            console.log(`${escenario.id} n${nivel} r${rep}: ok ${Math.round((Date.now() - inicio) / 1000)}s qa=${qa?.pass ?? "-"} ${qa?.retry_reasons.slice(0, 3).join(" | ") ?? ""}`);
            return salida;
          } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error);
            console.error(`${escenario.id} n${nivel} r${rep}: ERROR ${mensaje}`);
            return { ...resumen, error: mensaje };
          }
        });
      }
    }
  }
  const resultados = await enParalelo(tareas, opciones.concurrencia);
  await writeFile(path.join(opciones.out, "resumen.json"), JSON.stringify(resultados, null, 2));
  console.log(`${resultados.length} casos -> ${opciones.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
