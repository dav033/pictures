import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { leerEnv, flag } from "./exp-fal-lib";

/**
 * Recibe un LoRA recién entrenado: lo valida, lo respalda y le escribe la
 * procedencia. Corre ANTES de evaluarlo.
 *
 * Existe porque el LoRA que hoy está en producción llegó sin ningún registro:
 * sus parámetros de entrenamiento (4000 pasos, lr 2e-4, US$25,60) hubo que
 * reconstruirlos a mano desde el dashboard, y el único registro local del repo
 * describía una corrida de otra cuenta. Que no se repita.
 *
 * Además baja una copia local: la app depende de una URL del CDN de fal para un
 * archivo de 332 MB, y un LoRA no se puede regenerar — reentrenar con los mismos
 * parámetros no devuelve los mismos pesos.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/recibir-lora.ts \
 *     --url "<safetensors>" --etiqueta v004-1000 --steps 1000 --lr 0.00005 --costo 6.40
 */

const BACKUP = path.join(process.cwd(), "data/lora-backup");

async function cabeceraSafetensors(url: string): Promise<{ bytes: number; tensores: number; rank: number | null; arquitectura: string }> {
  const r = await fetch(url, { headers: { Range: "bytes=0-262143" }, signal: AbortSignal.timeout(120_000) });
  if (!r.ok && r.status !== 206) throw new Error(`No se pudo leer la cabecera (HTTP ${r.status})`);
  const b = Buffer.from(await r.arrayBuffer());
  const largo = Number(b.readBigUInt64LE(0));
  if (!Number.isFinite(largo) || largo <= 0 || largo > b.length - 8) throw new Error("No parece un archivo safetensors válido.");
  const cabecera = JSON.parse(b.subarray(8, 8 + largo).toString("utf8")) as Record<string, { shape?: number[] }>;
  const claves = Object.keys(cabecera).filter((k) => k !== "__metadata__");
  const rangos = new Set(claves.filter((k) => /lora_A|lora_down/.test(k)).map((k) => cabecera[k]!.shape?.[0]).filter(Boolean));
  const total = Number((r.headers.get("content-range") ?? "").split("/")[1]);
  return {
    bytes: Number.isFinite(total) ? total : 0,
    tensores: claves.length,
    rank: rangos.size === 1 ? [...rangos][0] as number : null,
    arquitectura: claves.some((k) => /double_blocks|single_blocks/.test(k)) ? "FLUX" : "desconocida",
  };
}

async function main(): Promise<void> {
  const url = flag("url", "");
  const etiqueta = flag("etiqueta", "");
  if (!/^https?:\/\//.test(url) || !etiqueta) {
    console.error("Uso: --url <safetensors> --etiqueta <v004-1000> [--steps N --lr X --costo N]");
    process.exit(1);
  }

  console.log("1. Validando el archivo…");
  const info = await cabeceraSafetensors(url);
  console.log(`   arquitectura ${info.arquitectura} · ${info.tensores} tensores · rank ${info.rank ?? "?"} · ${info.bytes} bytes`);
  if (info.arquitectura !== "FLUX") throw new Error("No tiene la firma de un LoRA de FLUX. No continuar.");
  if (info.tensores < 100) throw new Error(`Solo ${info.tensores} tensores: el entrenamiento pudo salir incompleto.`);

  console.log("2. Descargando copia local…");
  fs.mkdirSync(BACKUP, { recursive: true });
  const destino = path.join(BACKUP, `sempertex-${etiqueta}.safetensors`);
  const descarga = await fetch(url, { signal: AbortSignal.timeout(900_000) });
  if (!descarga.ok) throw new Error(`No se pudo descargar (HTTP ${descarga.status})`);
  const bytes = Buffer.from(await descarga.arrayBuffer());
  fs.writeFileSync(destino, bytes);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (info.bytes && bytes.length !== info.bytes) throw new Error(`Descarga incompleta: ${bytes.length} de ${info.bytes} bytes.`);
  console.log(`   ${path.relative(process.cwd(), destino)} · ${bytes.length} bytes · sha256 ${sha.slice(0, 16)}…`);

  console.log("3. Escribiendo procedencia…");
  const procedencia = {
    etiqueta,
    url_fal: url,
    archivo_local: path.relative(process.cwd(), destino),
    bytes: bytes.length,
    sha256: sha,
    tensores: info.tensores,
    rank: info.rank,
    trigger: "eventdecor_style_v2",
    entrenamiento: {
      steps: Number(flag("steps", "0")) || null,
      learning_rate: Number(flag("lr", "0")) || null,
      costo_usd: Number(flag("costo", "0")) || null,
      dataset: "data/staging/sempertex-general-v004-recaption-fal.zip (154 imagenes recaptionadas)",
      epocas_aprox: Number(flag("steps", "0")) ? Number((Number(flag("steps", "0")) / 154).toFixed(1)) : null,
    },
    comparacion: {
      v2_en_produccion: { steps: 4000, learning_rate: 0.0002, costo_usd: 25.6, escala_08: "1/6", escala_03: "6/6" },
      base_sin_lora: { escala_08: "6/6" },
    },
    evaluacion: "PENDIENTE",
    recibido_el: new Date().toISOString().slice(0, 10),
  };
  const rutaProc = path.join(BACKUP, `PROCEDENCIA-${etiqueta}.json`);
  fs.writeFileSync(rutaProc, JSON.stringify(procedencia, null, 2));
  console.log(`   ${path.relative(process.cwd(), rutaProc)}`);
  if (procedencia.entrenamiento.epocas_aprox) console.log(`   ${procedencia.entrenamiento.epocas_aprox} épocas sobre 154 imágenes (el v2 roto fueron 26)`);

  console.log(`\nListo. Siguiente paso — evaluar:\n`);
  console.log(`  npx tsx scripts/eval-lora-nuevo.ts --lora "${url}" --etiqueta ${etiqueta}`);
  console.log(`  npx tsx scripts/exp-contacto.ts --dir reports/lora-debug/eval-${etiqueta} --patron scale08 --cols 3\n`);
  console.log(`Criterio: de las 6 a escala 0,8, contar arco 3D que cierra + dos columnas separadas + mesa.`);
  console.log(`Referencia: base 6/6 · v2 1/6 · para aprobar >=5/6`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
