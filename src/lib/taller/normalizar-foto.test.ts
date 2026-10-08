import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { LADO_MAXIMO_FOTO } from "./buscar-foto";
import { normalizarFoto } from "./normalizar-foto";

test("una foto grande sale como JPEG de hasta 1024 px por su lado mayor, sin deformarse", async () => {
  const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#cc3366" } }).png().toBuffer();
  const salida = await normalizarFoto(new Uint8Array(png));
  const meta = await sharp(salida).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, LADO_MAXIMO_FOTO);
  assert.equal(meta.height, 512);
});

test("una foto chica no se agranda; el fondo transparente queda blanco", async () => {
  const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const salida = await normalizarFoto(new Uint8Array(png));
  const { data, info } = await sharp(salida).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [40, 30]);
  assert.ok(data[0]! > 250 && data[1]! > 250 && data[2]! > 250);
});

test("lo que no es una imagen lanza", async () => {
  await assert.rejects(() => normalizarFoto(new TextEncoder().encode("esto no es una imagen")));
});
