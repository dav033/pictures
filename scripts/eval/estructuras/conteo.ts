import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dentroDe } from "../../../src/lib/eval/estructuras/cli-reconocimiento";
import { ejecutarCliConteo, type SistemaConteo } from "../../../src/lib/eval/estructuras/cli-conteo";
import type { AnalizadorConteo, PiezaContada } from "../../../src/lib/eval/estructuras/conteo";

/**
 * Runner del conteo de globos (ADR-0031). Vista previa por defecto; gastar exige
 * `--ejecutar --max-usd <n> --crudos <dir privado>`. Cada foto: el reconocedor de
 * producción (Amaterasu, v16) y la lectura de conteo del ai-api local
 * (`PYTHON_BACKEND_URL`, `INTERNAL_HMAC_SECRET`, con su llave de Gemini).
 *
 *   npx tsx --conditions=react-server scripts/eval/estructuras/conteo.ts \
 *     --suite <DATA_ROOT>/conteo.suite.json --run-id conteo-v1-YYYYMMDD \
 *     --raiz-imagenes <DATA_ROOT> --verdad <DATA_ROOT>/conteo-verdad.csv \
 *     [--ejecutar --max-usd 1 --crudos <dir privado>]
 */

const REPO = process.cwd();
/** Versión del prompt de la lectura (fijada en services/ai-api/tests/test_conteo_referencia.py). La corrida real registra la que Python devuelve. */
const PROMPT_VERSION_CONOCIDA = "conteo-referencia.v1:bfd6604c6192ab95";

function detectarMime(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  throw new Error("formato de imagen no admitido");
}

function cargarEntorno(): void {
  // Solo proveedor y ai-api; sin DATABASE_URL nada de esto puede escribir en la base.
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  delete process.env.DATABASE_URL;
}

async function crearAnalizador(raizImagenes: string, crudos: string): Promise<SistemaConteo & { analizar: AnalizadorConteo }> {
  // telemetria-llamadas configura la persistencia en Postgres al importarse: primero se importa, luego se apaga.
  await import("../../../src/lib/ia/nucleo/telemetria-llamadas");
  const { configurarPersistenciaTelemetria } = await import("@sempertex/agente-core");
  configurarPersistenciaTelemetria(undefined);
  const { chatDe } = await import("../../../src/lib/ia/nucleo/registro");
  const { analizarReferenciasV2 } = await import("../../../src/lib/ia/amaterasu/analizar-referencias-v2");
  const { elementosConteo } = await import("../../../src/lib/ia/amaterasu/conteo-referencia");
  const { llamarPythonConteoReferencia } = await import("../../../src/lib/ia/nucleo/python-adapter");
  const chat = await chatDe("gemini");

  const analizar: AnalizadorConteo = async (item, signal) => {
    const ruta = resolve(raizImagenes, item.ruta_privada);
    if (!dentroDe(raizImagenes, ruta)) throw new Error("ruta_privada fuera de --raiz-imagenes");
    const bytes = readFileSync(ruta);
    if (createHash("sha256").update(bytes).digest("hex") !== item.image_sha256) throw new Error(`la imagen leída no coincide con ${item.image_sha256.slice(0, 12)}`);
    const imagen = { id: "REF_01", mime: detectarMime(bytes), base64: bytes.toString("base64"), descripcion: "Evaluation reference image." };
    const inicio = Date.now();
    const uso = { entrada: 0, salida: 0, pensamiento: 0, completo: true };
    const requestId = randomUUID();
    try {
      const analisis = await analizarReferenciasV2(chat, [imagen], [], "perceptual", { requestId, correlationId: requestId, superficie: "evaluacion/conteo" }, signal, {
        forzarNuevoAnalisis: true,
        // El pensamiento se cobra como salida (calcularCosteEstimado).
        observarPase: (pase) => { uso.entrada += pase.uso.entrada; uso.salida += pase.uso.salida; uso.pensamiento += pase.uso.pensamiento; },
      });
      const elementos = elementosConteo(analisis.blueprint).get("REF_01") ?? [];
      const piezas: PiezaContada[] = [];
      let crudo = "[]";
      if (elementos.length > 0) {
        const resultado = await llamarPythonConteoReferencia({
          imagen: { mimeType: imagen.mime, dataBase64: imagen.base64 },
          elementos, requestId, correlationId: requestId, deadlineMs: 60_000, parentSignal: signal,
        });
        // Una corrida registra una sola versión del prompt: si el ai-api trae otra, falla fuerte.
        if (resultado.promptVersion !== PROMPT_VERSION_CONOCIDA) throw new Error(`el ai-api usa ${resultado.promptVersion}, no ${PROMPT_VERSION_CONOCIDA}`);
        if (resultado.usage) {
          uso.entrada += resultado.usage.prompt_token_count ?? 0;
          uso.salida += resultado.usage.candidates_token_count ?? 0;
          uso.pensamiento += resultado.usage.thoughts_token_count ?? 0;
        } else {
          uso.completo = false;
        }
        crudo = JSON.stringify(resultado.lecturas);
        for (const { element_id, ...lectura } of resultado.lecturas) {
          const elemento = elementos.find((candidato) => candidato.elementId === element_id)!;
          piezas.push({ element_id, tipo: elemento.tipo, estructura_oficial: elemento.estructuraOficial ?? null, piezas: elemento.piezas ?? 1, lectura });
        }
      }
      const sha = createHash("sha256").update(crudo).digest("hex");
      const destino = resolve(crudos, sha.slice(0, 2), `${sha}.json`);
      if (!existsSync(destino)) { mkdirSync(dirname(destino), { recursive: true }); writeFileSync(destino, crudo); }
      return { resultado: "ok", piezas, uso, rawOutputSha256: sha, msTotal: Date.now() - inicio };
    } catch (error) {
      const nombre = error instanceof Error ? error.name : "";
      const resultado = signal.aborted || nombre === "TimeoutError" ? "timeout" : "error";
      return { resultado, uso: { ...uso, completo: false }, msTotal: Date.now() - inicio };
    }
  };
  return { modelo: chat.modelo, promptVersion: PROMPT_VERSION_CONOCIDA, analizar };
}

async function main(): Promise<void> {
  cargarEntorno();
  await ejecutarCliConteo(process.argv.slice(2), {
    repo: REPO,
    leerTexto: (ruta) => (existsSync(ruta) ? readFileSync(ruta, "utf8") : null),
    escribirTexto: (ruta, texto) => { mkdirSync(dirname(ruta), { recursive: true }); writeFileSync(ruta, texto); },
    anexarTexto: (ruta, texto) => { mkdirSync(dirname(ruta), { recursive: true }); appendFileSync(ruta, texto); },
    commit: () => execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim(),
    ahora: () => new Date(),
    desactivarTelemetriaDurable: () => {
      delete process.env.DATABASE_URL;
      if (process.env.DATABASE_URL) throw new Error("DATABASE_URL sigue definida: la evaluación no escribe en la base");
    },
    sistemaSinProveedor: () => ({ modelo: "gemini-3.6-flash", promptVersion: PROMPT_VERSION_CONOCIDA }),
    crearAnalizador: ({ raizImagenes, crudos }) => crearAnalizador(raizImagenes, crudos),
    log: (mensaje) => console.log(mensaje),
  });
}

main().catch((error: unknown) => {
  console.error(`[conteo] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
