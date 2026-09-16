import path from "node:path";

/**
 * Configuration of the live route smoke. Every problem is reported as a
 * failure: a smoke that was asked to run never turns a broken environment into
 * a skip. Values are validated here, but secrets are never printed.
 */

/**
 * `kill-switch` desapareció con `PYTHON_BACKEND_KILL_SWITCH` (ADR-0023 paso 5):
 * ya no hay una variable que devuelva las rutas a TypeScript, así que tampoco
 * hay una fase que comprobarlo. La reversión que sí existe —Python caído, sin
 * reserva en Next— la cubre `python-down`.
 */
export type Fase = "python-on" | "python-down";

const FASES: readonly Fase[] = ["python-on", "python-down"];
const PUERTO_PROHIBIDO = "3000";
const MIN_SECRET_BYTES = 32;

export type ConfigSmoke = {
  fase: Fase;
  statePath: string;
  artefactosDir: string;
  nextUrl: URL;
  fastapiUrl: URL;
  databaseUrl: string;
  appPassword: string;
  imagenPagada: boolean;
  /** python-on only: skip the paid chat call and re-verify `plan_chat` from --state. */
  reutilizarChat: boolean;
};

type Entorno = Record<string, string | undefined>;

function esVerdadero(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
}

function valorArgumento(argv: readonly string[], nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i]!;
    if (actual.startsWith(prefijo)) return actual.slice(prefijo.length);
    if (actual === `--${nombre}`) return argv[i + 1];
  }
  return undefined;
}

function urlLoopback(nombre: string, raw: string | undefined, errores: string[]): URL | null {
  if (!raw?.trim()) {
    errores.push(`falta ${nombre}`);
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    errores.push(`${nombre} no es una URL válida`);
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.hostname !== "127.0.0.1") {
    errores.push(`${nombre} debe usar http://127.0.0.1 (localhost puede resolver a ::1)`);
    return null;
  }
  return url;
}

export function leerConfig(argv: readonly string[], env: Entorno): { config: ConfigSmoke } | { errores: string[] } {
  const errores: string[] = [];

  const faseRaw = valorArgumento(argv, "phase");
  const fase = FASES.find((item) => item === faseRaw);
  if (!fase) errores.push(`--phase debe ser uno de ${FASES.join("|")}`);

  const stateRaw = valorArgumento(argv, "state");
  if (!stateRaw?.trim()) errores.push("falta --state <archivo>");
  const statePath = stateRaw ? path.resolve(stateRaw.trim()) : "";
  const artefactosDir = statePath ? path.dirname(statePath) : "";
  const repo = path.resolve(process.cwd());
  if (artefactosDir && (artefactosDir === repo || artefactosDir.startsWith(`${repo}${path.sep}`))) {
    errores.push("--state debe quedar fuera del repositorio (la imagen y el token se guardan junto a él)");
  }

  const nextUrl = urlLoopback("SMOKE_NEXT_URL", env.SMOKE_NEXT_URL ?? "http://127.0.0.1:3100", errores);
  if (nextUrl && nextUrl.port === PUERTO_PROHIBIDO) {
    errores.push("SMOKE_NEXT_URL no puede usar el puerto 3000 (otro proyecto)");
  }
  const fastapiUrl = urlLoopback("PYTHON_BACKEND_URL", env.PYTHON_BACKEND_URL, errores);

  const databaseUrl = (env.SMOKE_DATABASE_URL ?? env.DATABASE_URL)?.trim() ?? "";
  if (!databaseUrl) {
    errores.push("falta DATABASE_URL (o SMOKE_DATABASE_URL)");
  } else {
    try {
      const url = new URL(databaseUrl);
      if (!/^postgres(?:ql)?:$/.test(url.protocol)) errores.push("DATABASE_URL no es PostgreSQL");
      if (url.hostname !== "127.0.0.1") errores.push("DATABASE_URL debe apuntar a 127.0.0.1 (nunca a la base remota)");
      if (url.pathname !== "/demo_rag") errores.push("DATABASE_URL debe usar la base demo_rag local");
    } catch {
      errores.push("DATABASE_URL no es una URL válida");
    }
  }

  const appPassword = env.APP_PASSWORD ?? "";
  if (!appPassword.trim()) errores.push("falta APP_PASSWORD");
  if (!env.PLAN_APPROVAL_SECRET?.trim()) errores.push("falta PLAN_APPROVAL_SECRET (debe ser el mismo de Next)");
  const hmac = env.INTERNAL_HMAC_SECRET?.trim() ?? "";
  if (Buffer.byteLength(hmac, "utf8") < MIN_SECRET_BYTES) errores.push("INTERNAL_HMAC_SECRET falta o tiene menos de 32 bytes");

  const imagenPagada = argv.includes("--paid-image") || esVerdadero(env.SMOKE_ALLOW_PAID_IMAGE);
  const reutilizarChat = argv.includes("--reuse-chat-plan");
  if (reutilizarChat && fase !== "python-on") errores.push("--reuse-chat-plan solo aplica a --phase=python-on");

  if (errores.length || !fase || !nextUrl || !fastapiUrl) return { errores };
  return {
    config: { fase, statePath, artefactosDir, nextUrl, fastapiUrl, databaseUrl, appPassword, imagenPagada, reutilizarChat },
  };
}
