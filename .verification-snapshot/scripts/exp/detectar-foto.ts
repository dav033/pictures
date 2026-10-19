/**
 * Solo la detección de globos y fondos de una foto (lo que `iterar-foto.ts --pagar` hace junto con la lectura), para tener
 * la verdad de la foto con la que `medir-proporciones.ts` compara la captura. Pagado (≈ US$0,01–0,02: 9 trozos de Flash).
 * Escribe `detecciones.json` y `fondos.json` en `--salida`. La foto vive fuera del repo.
 *
 *   npx tsx --conditions=react-server scripts/exp/detectar-foto.ts --foto <ruta> --salida <dir> --pagar
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectarGlobos } from "../../src/lib/globos3d/detectar-globos-ia";
import { conContexto } from "../../src/lib/registro/servidor";
import { normalizarFoto } from "../../src/lib/taller/normalizar-foto";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);

async function main() {
  const foto = arg("--foto"), salida = arg("--salida");
  if (!foto || !salida) throw new Error("Faltan --foto y --salida");
  if (!process.argv.includes("--pagar")) throw new Error("Sin --pagar no se llama a la IA.");
  mkdirSync(salida, { recursive: true });
  const bytes = await normalizarFoto(readFileSync(foto));
  const deteccion = await conContexto({ conversacion: `exp-detectar-foto-${path.basename(salida)}`, vista: "3d" }, () => detectarGlobos({ bytes, mime: "image/jpeg" }, { superficie: "exp:detectar-foto" }));
  writeFileSync(path.join(salida, "detecciones.json"), JSON.stringify(deteccion.globos));
  writeFileSync(path.join(salida, "fondos.json"), JSON.stringify(deteccion.fondos));
  console.log(`detección: ${deteccion.globos.length} globos y ${deteccion.fondos.length} fondos (${deteccion.fallidos} trozos fallidos), ${deteccion.costeEstimadoUsd} USD`);
}

main().catch((e) => { console.error(e); process.exit(1); });
