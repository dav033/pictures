import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dentroDe, ejecutarCli } from "../../../src/lib/eval/estructuras/cli-reconocimiento";

/**
 * Recognition runner CLI (Plan A §A0.3). Preview by default; spending requires
 * `--ejecutar --max-usd <n> --crudos <private dir>`.
 *
 *   npx tsx --conditions=react-server scripts/eval/estructuras/reconocimiento.ts \
 *     --suite datasets/estructuras/manifests/dev-seed-v0.suite.json --run-id a0-4a-v13-YYYYMMDD \
 *     --raiz-imagenes <DATA_ROOT>/estructuras-ext --corridas 5 [--ejecutar --max-usd 15 --crudos <private dir>]
 */

const REPO = process.cwd();

function detectarMime(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  throw new Error("formato de imagen no admitido");
}

function cargarEntorno(): void {
  // Only provider settings are needed; the database URL is removed so nothing here can write to it.
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  delete process.env.DATABASE_URL;
}

async function sistemaActual(variante: "v13" | "v14-candidato") {
  const { chatDe } = await import("../../../src/lib/ia/registro");
  const { analysisConfigHash, ANALYSIS_PARSER_VERSION, sistemaAnalisis } = await import("../../../src/lib/ia/analizar-referencias-v2");
  // Creating the port makes no request; it only reads model and thinking settings.
  const chat = await chatDe("gemini");
  const { systemPromptHash } = sistemaAnalisis([], "perceptual", variante);
  return {
    chat,
    modelo: chat.modelo,
    thinkingLevel: chat.thinkingLevel ?? null,
    systemPromptSha256: systemPromptHash,
    configHash: analysisConfigHash({ model: chat.modelo, thinkingLevel: chat.thinkingLevel, mode: "perceptual", systemPromptHash }),
    parserVersion: ANALYSIS_PARSER_VERSION,
  };
}

async function main(): Promise<void> {
  cargarEntorno();
  const argVariante = process.argv[process.argv.indexOf("--variante") + 1];
  const variante = process.argv.includes("--variante") && argVariante === "v14-candidato" ? "v14-candidato" : "v13";
  const inicial = await sistemaActual(variante);
  await ejecutarCli(process.argv.slice(2), {
    repo: REPO,
    leerTexto: (ruta) => (existsSync(ruta) ? readFileSync(ruta, "utf8") : null),
    escribirTexto: (ruta, texto) => { mkdirSync(dirname(ruta), { recursive: true }); writeFileSync(ruta, texto); },
    anexarTexto: (ruta, texto) => { mkdirSync(dirname(ruta), { recursive: true }); appendFileSync(ruta, texto); },
    commit: () => execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim(),
    ahora: () => new Date(),
    desactivarTelemetriaDurable: () => {
      // Without a URL getRagPool cannot connect; crearAnalizador also unsets the persistence itself.
      delete process.env.DATABASE_URL;
      if (process.env.DATABASE_URL) throw new Error("DATABASE_URL sigue definida: la evaluación no escribe en la base");
    },
    sistemaSinProveedor: () => inicial,
    crearAnalizador: async ({ raizImagenes, crudos, variante: varianteAnalizador }) => {
      // telemetria-llamadas configures Postgres persistence when imported: import it first, then disable.
      await import("../../../src/lib/ia/telemetria-llamadas");
      const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
      configurarPersistenciaTelemetria(undefined);
      const { crearAnalizadorV13 } = await import("../../../src/lib/eval/estructuras/adaptador-v13");
      const analizar = crearAnalizadorV13({
        chat: inicial.chat,
        variante: varianteAnalizador,
        leerImagen: async (item) => {
          const ruta = resolve(raizImagenes, item.ruta_privada);
          if (!dentroDe(raizImagenes, ruta)) throw new Error("ruta_privada fuera de --raiz-imagenes");
          const bytes = readFileSync(ruta);
          return { base64: bytes.toString("base64"), mime: detectarMime(bytes) };
        },
        guardarSalidaCruda: async (contenido) => {
          const sha = createHash("sha256").update(contenido).digest("hex");
          const destino = resolve(crudos, sha.slice(0, 2), `${sha}.json`);
          if (!existsSync(destino)) { mkdirSync(dirname(destino), { recursive: true }); writeFileSync(destino, contenido); }
          return sha;
        },
      });
      return { ...inicial, analizar };
    },
    log: (mensaje) => console.log(mensaje),
  });
}

main().catch((error: unknown) => {
  console.error(`[reconocimiento] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
