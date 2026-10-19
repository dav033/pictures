/**
 * REQ-002: prueba REAL (de pago, una sola llamada) de `embeberImagen` contra gemini-embedding-2 con una imagen de
 * 64×64 px. Sin GEMINI_API_KEY no hace nada (sale con 0). Comprueba 768 dimensiones, norma ≈ 1 y que dos imágenes
 * distintas no dan el mismo vector (solo con `--dos`, que paga una segunda llamada).
 * Run: npx tsx --conditions=react-server scripts/test/test-embeber-imagen-real.ts
 * (con GEMINI_API_KEY cargada en el entorno; en desarrollo local el catálogo de capacidades viene del `dist` de
 * agente-core: si está viejo, correr con NODE_ENV=production o reconstruirlo con `npm run build --workspace=@sempertex/agente-core`).
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { DIMENSIONES_EMBEDDING, embeberImagen } from "../../src/lib/rag/embeddings";

async function imagenDePrueba(color: { r: number; g: number; b: number }): Promise<Uint8Array> {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
    .composite([{ input: Buffer.from('<svg width="64" height="64"><circle cx="32" cy="32" r="18" fill="#ffd54f"/></svg>') }])
    .jpeg({ quality: 80 })
    .toBuffer();
  return new Uint8Array(png);
}

const norma = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.log("sin GEMINI_API_KEY: se omite la prueba real de embeberImagen");
    return;
  }
  const inicio = Date.now();
  const v = await embeberImagen(await imagenDePrueba({ r: 200, g: 40, b: 90 }), "image/jpeg", { superficie: "test:embeber-imagen" });
  assert.equal(v.length, DIMENSIONES_EMBEDDING);
  assert.ok(v.every(Number.isFinite));
  assert.ok(Math.abs(norma(v) - 1) < 0.02, `norma ${norma(v)}`);
  console.log(`ok 1 - 768 dimensiones, norma ${norma(v).toFixed(4)} (${Date.now() - inicio} ms, 1 llamada)`);
  if (process.argv.includes("--dos")) {
    const w = await embeberImagen(await imagenDePrueba({ r: 20, g: 120, b: 220 }), "image/jpeg");
    const coseno = v.reduce((s, x, i) => s + x * w[i]!, 0);
    assert.ok(coseno < 0.9999, `coseno ${coseno}`);
    console.log(`ok 2 - dos imágenes distintas dan vectores distintos (coseno ${coseno.toFixed(4)})`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
