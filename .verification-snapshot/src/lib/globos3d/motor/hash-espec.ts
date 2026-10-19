import { createHash } from "node:crypto";

/** JSON con las llaves ordenadas: la misma espec da siempre los mismos bytes, sin importar el orden en que se armó. */
export function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonEstable(v)}`).join(",")}}`;
  }
  return JSON.stringify(valor) ?? "null";
}

export function especHashDe(espec: unknown, versionMotor: string): string {
  return createHash("sha256").update(jsonEstable(espec)).update("\n").update(versionMotor).digest("hex");
}
