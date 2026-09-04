// Orquestador: recibe uno o varios números de orden y corre las 3 fases en cadena para cada
// uno -- foto real (Revie) -> desglose real (Shopify) -> caption (Claude + desglose como
// ground truth). Salta pasos ya hechos (idempotente) para poder re-correr sin gastar de más.
//
// Requiere: Chrome dedicado abierto con --remote-debugging-port=9222 y sesión de Shopify/Revie
// activa (ver README de revie-build-index.ts), y `claude` en PATH para el caption.

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

async function existe(rutaArchivo: string): Promise<boolean> {
  try {
    await access(rutaArchivo);
    return true;
  } catch {
    return false;
  }
}

function correr(script: string, args: string[]): boolean {
  const resultado = spawnSync("npx", ["tsx", `scripts/${script}`, ...args], { stdio: "inherit", shell: true });
  return resultado.status === 0;
}

async function tieneAlgunaFoto(carpeta: string): Promise<boolean> {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    if (await existe(path.join(carpeta, `foto-1.${ext}`))) return true;
  }
  return false;
}

/**
 * Una orden puede tener más de una reseña con foto (ej. #9018: dos productos distintos
 * reseñados por separado) -- crear-carpeta-orden.ts y generar-caption-orden.ts son
 * idempotentes por archivo (saltan lo que ya existe), así que en vez de intentar adivinar
 * aquí si "falta algo", simplemente se corren siempre y que decidan ellos mismos qué hace
 * falta -- así una foto nueva que aparezca después en el índice de Revie no se pierde.
 */
async function procesarOrden(numeroOrden: string): Promise<void> {
  console.log(`\n=== Orden #${numeroOrden} ===`);
  const carpeta = path.join(RUTA_ORDENES, numeroOrden);

  console.log("[1/3] Revisando fotos reales en Revie (descarga solo lo nuevo)...");
  correr("crear-carpeta-orden.ts", [numeroOrden]);

  if (await existe(path.join(carpeta, "desglose.json"))) {
    console.log("[2/3] Desglose ya existe, salto.");
  } else {
    console.log("[2/3] Buscando orden real en Shopify...");
    correr("obtener-desglose-orden.ts", [numeroOrden]);
  }

  if (!(await tieneAlgunaFoto(carpeta)) || !(await existe(path.join(carpeta, "desglose.json")))) {
    console.log("[3/3] No se puede generar caption sin foto y desglose -- revisá los pasos anteriores.");
  } else {
    console.log("[3/3] Generando captions con Claude (salta las fotos que ya tienen)...");
    correr("generar-caption-orden.ts", [numeroOrden]);
  }
}

async function main(): Promise<void> {
  const ordenes = process.argv.slice(2).map((n) => n.replace(/^#/, "").trim()).filter(Boolean);
  if (ordenes.length === 0) {
    console.error("Uso: tsx scripts/procesar-ordenes.ts <numero1> <numero2> ...");
    process.exit(1);
  }
  for (const orden of ordenes) {
    await procesarOrden(orden);
  }
  console.log(`\nListo. ${ordenes.length} orden(es) procesada(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
