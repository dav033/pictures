// Compuerta de envío local del líder: corre en orden las suites que deben estar verdes antes de subir a main.
// Se detiene en la primera falla. La última línea es «GATE OK» o «GATE FAIL <suite>»; código 1 si falla.
// Uso: npm run gate
import { spawnSync } from "node:child_process";

const SUITES = [
  "contracts:check",
  "kontext:test",
  "catalogo:test",
  "globos3d:test",
  "motor3d:test",
  "escena:test",
  "test-cotizacion-unica",
  "test-guardia-prerender",
];

let fallo = null;
for (const nombre of SUITES) {
  console.log(`\n=== gate: ${nombre}`);
  const inicio = Date.now();
  const resultado = spawnSync(`npm run ${nombre}`, { shell: true, stdio: "inherit" });
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  if (resultado.status !== 0) {
    fallo = nombre;
    console.log(`=== gate: ${nombre} falló en ${segundos} s`);
    break;
  }
  console.log(`=== gate: ${nombre} ok en ${segundos} s`);
}

console.log(fallo === null ? "\nGATE OK" : `\nGATE FAIL ${fallo}`);
process.exitCode = fallo === null ? 0 : 1;
