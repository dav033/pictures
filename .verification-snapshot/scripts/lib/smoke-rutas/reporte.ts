/**
 * Assertion log for the live smoke. Every failed check prints `[FAIL]` and the
 * process exits 1 at the end. Output never includes secrets, full approval
 * tokens, image bytes or full conversation text.
 */

export class AbortoFase extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortoFase";
  }
}

const CLAVES_REDACTADAS = new Set(["approval_token", "imagen", "base64", "prompt", "prompts", "password", "cookie"]);
const LARGO_MAXIMO_DETALLE = 600;

export class Reporte {
  private fallos = 0;
  private aciertos = 0;

  get totalFallos(): number {
    return this.fallos;
  }

  get totalAciertos(): number {
    return this.aciertos;
  }

  pass(nombre: string, detalle = ""): void {
    this.aciertos += 1;
    console.log(`[PASS] ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }

  fail(nombre: string, detalle: string): void {
    this.fallos += 1;
    console.error(`[FAIL] ${nombre} — ${detalle}`);
  }

  info(mensaje: string): void {
    console.log(`[INFO] ${mensaje}`);
  }

  /** Records the outcome and returns it, so later steps can depend on it. */
  check(nombre: string, condicion: boolean, detalle: string): boolean {
    if (condicion) this.pass(nombre, detalle);
    else this.fail(nombre, detalle);
    return condicion;
  }

  /** Same as `check`, but aborts the current phase when the step is a prerequisite. */
  exigir(nombre: string, condicion: boolean, detalle: string): asserts condicion {
    if (!this.check(nombre, condicion, detalle)) throw new AbortoFase(`${nombre}: ${detalle}`);
  }
}

export function prefijo(value: string | null | undefined, largo = 12): string {
  if (!value) return "(vacío)";
  return value.length <= largo ? value : `${value.slice(0, largo)}…`;
}

export function tokenRedactado(token: string | undefined): string {
  return token ? `<token ${token.slice(0, 6)}… ${token.length} chars>` : "<sin token>";
}

function redactar(clave: string, valor: unknown): unknown {
  if (CLAVES_REDACTADAS.has(clave) && typeof valor === "string") {
    return clave === "approval_token" ? tokenRedactado(valor) : `<redactado ${valor.length} chars>`;
  }
  return valor;
}

/** Compact, redacted rendering of a request or response body for the log. */
export function resumen(valor: unknown, largo = LARGO_MAXIMO_DETALLE): string {
  let texto: string;
  try {
    texto = JSON.stringify(valor, redactar) ?? String(valor);
  } catch {
    texto = String(valor);
  }
  return texto.length > largo ? `${texto.slice(0, largo)}…(${texto.length} chars)` : texto;
}

export function extracto(texto: string | undefined, largo = 300): string {
  if (!texto) return "(vacío)";
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}
