/**
 * Shared gating for the live Python smoke scripts.
 *
 * A smoke that was asked to run must never turn a broken environment into a
 * successful `[SKIP]`. It is "required" when the Python backend is enabled,
 * when `--require-python` is passed, or when `PYTHON_SMOKE_REQUIRED=true`.
 * Only a genuinely unconfigured run (neither enabled nor required) may skip.
 */

type Entorno = Record<string, string | undefined>;

export const HOSTS_LOCALES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function esVerdadero(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
}

export function smokePythonRequerido(env: Entorno = process.env, argv: readonly string[] = process.argv): boolean {
  return esVerdadero(env.PYTHON_BACKEND_ENABLED)
    || esVerdadero(env.PYTHON_SMOKE_REQUIRED)
    || argv.includes("--require-python");
}

export type DecisionSmoke =
  | { accion: "ejecutar"; backendUrl: URL }
  | { accion: "saltar"; motivo: string }
  | { accion: "fallar"; motivo: string };

/**
 * `problemaConfiguracion` returns a human reason when the environment cannot
 * run the smoke, or null when it can. The caller supplies the checks specific
 * to each script (for example, a loopback catalog database).
 */
export function decidirSmoke(
  problemaConfiguracion: (env: Entorno) => string | null,
  env: Entorno = process.env,
  argv: readonly string[] = process.argv,
): DecisionSmoke {
  const requerido = smokePythonRequerido(env, argv);
  const problema = problemaBase(env) ?? problemaConfiguracion(env);
  if (problema) {
    return requerido
      ? { accion: "fallar", motivo: `smoke requerido pero mal configurado: ${problema}` }
      : { accion: "saltar", motivo: problema };
  }
  // problemaBase already validated the URL.
  return { accion: "ejecutar", backendUrl: new URL(env.PYTHON_BACKEND_URL!.trim()) };
}

function problemaBase(env: Entorno): string | null {
  const rawUrl = env.PYTHON_BACKEND_URL?.trim();
  const secret = env.INTERNAL_HMAC_SECRET?.trim();
  if (!rawUrl || !secret || Buffer.byteLength(secret, "utf8") < 32) {
    return "faltan PYTHON_BACKEND_URL o INTERNAL_HMAC_SECRET válido (mínimo 32 bytes)";
  }
  if (!esVerdadero(env.PYTHON_BACKEND_ENABLED)) return "PYTHON_BACKEND_ENABLED no está activo";
  if (esVerdadero(env.PYTHON_BACKEND_KILL_SWITCH)) return "PYTHON_BACKEND_KILL_SWITCH está activo";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "PYTHON_BACKEND_URL no es una URL válida";
  }
  if (!/^https?:$/.test(url.protocol) || !HOSTS_LOCALES.has(url.hostname)) {
    return "PYTHON_BACKEND_URL no apunta a un host local";
  }
  return null;
}

export function problemaPostgresLocal(nombre: string, env: Entorno): string | null {
  const raw = env[nombre]?.trim();
  if (!raw) return `falta ${nombre}`;
  try {
    const url = new URL(raw);
    if (!/^postgres(?:ql)?:$/.test(url.protocol) || !HOSTS_LOCALES.has(url.hostname)) {
      return `${nombre} no apunta a un PostgreSQL local`;
    }
  } catch {
    return `${nombre} no es una URL válida`;
  }
  return null;
}

/** Fails unless GET /readyz answers 200 within the deadline. */
export async function exigirReadyz(backendUrl: URL, deadlineMs = 5_000): Promise<void> {
  const target = new URL("/readyz", backendUrl);
  let response: Response;
  try {
    response = await fetch(target, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(deadlineMs) });
  } catch (error) {
    throw new Error(`preflight ${target.href} no respondió (${error instanceof Error ? error.message : String(error)})`, { cause: error });
  }
  await response.body?.cancel();
  if (response.status !== 200) {
    throw new Error(`preflight ${target.href} respondió ${response.status}, se esperaba 200`);
  }
}
