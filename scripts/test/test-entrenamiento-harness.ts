/**
 * Núcleo del arnés por foto (W4, `correr-foto.ts`): una foto de prueba por el camino real del Taller con el transporte seco
 * (respuestas grabadas, coste simulado, sin red, sin base de datos):
 *   npx tsx --conditions=react-server scripts/test/test-entrenamiento-harness.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-harness-"));
Object.assign(process.env, { REGISTRO_ACTIVO: "1", REGISTRO_DIR: path.join(tmp, "registro"), REGISTRO_NIVEL_STDOUT: "error" });
delete process.env.DATABASE_URL;

async function main(): Promise<void> {
  let pruebas = 0;
  const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
  const { default: sharp } = await import("sharp");
  const { correrFoto, validarEntrada } = await import("../entrenamiento/correr-foto");
  const bytes = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: "#eeeeee" } }).jpeg().toBuffer());
  const base = {
    nombre: "images (25).jpg", bytes, turnos: 1, topeUsd: 1, maxLlamadas: 400, seco: true, corrida: "2026-10-14T00-00-00-000Z",
    modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "test", dirCacheDeteccion: path.join(tmp, "cache"),
  };

  console.log("Núcleo del arnés por foto (W4):");

  await prueba("una foto en seco da un resultado JSON: escena, puntajes de las métricas, vueltas, coste y captura pendiente", async () => {
    const r = await correrFoto(base);
    assert.equal(r.registro.error, null);
    assert.equal(r.registro.modo, "seco");
    assert.equal(r.registro.transporte, "seco");
    assert.ok(r.escena && r.escena.nodos.length > 0);
    assert.equal(r.registro.turnos, 1);
    assert.ok(r.registro.puntajes.proporciones !== null && r.registro.puntajes.proporciones >= 0 && r.registro.puntajes.proporciones <= 1);
    assert.ok(r.registro.piezas.globosFoto > 0, "la medida usa los globos detectados de la foto");
    assert.ok(r.llamadas >= 3 && r.gastadoUsd > 0, "lectura, detección y una vuelta, con coste simulado");
    assert.equal(r.captura, "pendiente");
    assert.equal(r.registro.captura, "pendiente");
    assert.deepEqual(JSON.parse(JSON.stringify(r.registro)), r.registro, "el registro es JSON puro");
    assert.equal(readdirSync(tmp).includes("cache"), false, "en seco no se escribe la caché de la detección");
  });

  await prueba("no edita la escena a mano: sin vueltas, dos corridas dan la misma escena", async () => {
    const sin = await correrFoto({ ...base, turnos: 0 });
    const otra = await correrFoto({ ...base, turnos: 0 });
    assert.equal(sin.registro.turnos, 0);
    assert.deepEqual(sin.escena, otra.escena, "mismo camino, misma escena: nada la retoca");
    assert.equal(sin.registro.turnoConservado, 0);
  });

  await prueba("el tope de gasto corta la pasada: se aborta con su motivo", async () => {
    const r = await correrFoto({ ...base, topeUsd: 0.0001 });
    assert.equal(r.topeAlcanzado, true);
    assert.match(String(r.registro.abortada), /Tope de gasto/);
  });

  await prueba("el tope de llamadas también corta, y la entrada inválida se rechaza antes de llamar", async () => {
    const r = await correrFoto({ ...base, maxLlamadas: 1 });
    assert.equal(r.topeAlcanzado, true);
    assert.throws(() => validarEntrada({ ...base, turnos: 5 }), /0 a 4/);
    assert.throws(() => validarEntrada({ ...base, bytes: new Uint8Array() }), /vacía/);
    await assert.rejects(correrFoto({ ...base, turnos: -1 }), /0 a 4/);
  });

  rmSync(tmp, { recursive: true, force: true });
  console.log(`test-entrenamiento-harness: ok (${pruebas} pruebas)`);
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
