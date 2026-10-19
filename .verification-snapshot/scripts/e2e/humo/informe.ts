import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Configuracion } from "./configuracion";
import type { EstadoPaso, ResultadoPaso } from "./ejecutor";

function contar(resultados: readonly ResultadoPaso[]): Record<EstadoPaso, number> {
  const cuenta: Record<EstadoPaso, number> = { PASS: 0, FAIL: 0, SKIPPED: 0 };
  for (const resultado of resultados) cuenta[resultado.estado] += 1;
  return cuenta;
}

/** Escribe el informe JSON en la carpeta de salida y devuelve su ruta. */
export function escribirInforme(config: Configuracion, resultados: readonly ResultadoPaso[], iniciadoEn: Date): string {
  mkdirSync(config.carpetaSalida, { recursive: true });
  const archivo = path.join(config.carpetaSalida, "informe.json");
  const informe = {
    base: config.base,
    iniciadoEn: iniciadoEn.toISOString(),
    ms: Date.now() - iniciadoEn.getTime(),
    resumen: contar(resultados),
    pasos: resultados,
  };
  writeFileSync(archivo, `${JSON.stringify(informe, null, 2)}\n`, "utf8");
  return archivo;
}

export function imprimirResumen(config: Configuracion, resultados: readonly ResultadoPaso[], iniciadoEn: Date, archivo: string): void {
  const cuenta = contar(resultados);
  const segundos = ((Date.now() - iniciadoEn.getTime()) / 1000).toFixed(1);
  console.log(`\nHumo e2e contra ${config.base}: ${cuenta.PASS} PASS, ${cuenta.FAIL} FAIL, ${cuenta.SKIPPED} SKIPPED en ${segundos} s`);
  console.log(`Informe: ${archivo}`);
}
