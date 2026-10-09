import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { herramientasDePasos, leerPasosAuditoria, pasoDesdeLinea } from "./pasos-auditoria";

const linea = (solicitud: string, tipo: string, ts: string, datos: unknown, ms?: number) => JSON.stringify({ ts, seq: 1, tipo, solicitud, conversacion: "conv-1", datos, ...(ms ? { ms } : {}) });

test("convierte las líneas de herramienta, decisión y modelo en pasos legibles", () => {
  const herramienta = pasoDesdeLinea({ ts: "t1", tipo: "herramienta", datos: { nombre: "colocar_pieza", ok: false, argumentos: { id: "a" }, ms: 40 } });
  assert.deepEqual(herramienta, { ts: "t1", tipo: "herramienta", nombre: "colocar_pieza", resumen: 'falló {"id":"a"}', ms: 40 });
  const decision = pasoDesdeLinea({ ts: "t2", tipo: "decision", datos: { quien: "modelo:escena_ia", que: "respuesta final", resultado: { ok: true } } });
  assert.equal(decision?.nombre, "modelo:escena_ia");
  assert.match(decision?.resumen ?? "", /respuesta final → \{"ok":true\}/);
  assert.equal(pasoDesdeLinea({ ts: "t3", tipo: "entrada_usuario", datos: {} }), null);
  assert.equal(pasoDesdeLinea("basura"), null);
});

test("recorta los resúmenes largos y deduplica las herramientas", () => {
  const paso = pasoDesdeLinea({ ts: "t", tipo: "decision", datos: { quien: "x", que: "y".repeat(1000), resultado: 1 } });
  assert.ok((paso?.resumen.length ?? 0) <= 300);
  const pasos = ["a", "b", "a"].map((nombre) => ({ ts: "t", tipo: "herramienta", nombre, resumen: "" }));
  assert.deepEqual(herramientasDePasos([...pasos, { ts: "t", tipo: "decision", nombre: "z", resumen: "" }]), ["a", "b"]);
});

test("lee de la auditoría solo los pasos de la solicitud pedida, en orden, y tolera archivos ausentes o corruptos", async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), "pasos-"));
  try {
    const carpeta = path.join(raiz, "conversaciones", "2026-10-09");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(path.join(carpeta, "conv-1.jsonl"), [
      linea("req-2", "herramienta", "2026-10-09T10:00:05Z", { nombre: "otra", ok: true }),
      linea("req-1", "herramienta", "2026-10-09T10:00:02Z", { nombre: "pintar", ok: true }),
      "{esto no es json req-1",
      linea("req-1", "salida", "2026-10-09T10:00:03Z", {}),
      linea("req-1", "herramienta", "2026-10-09T10:00:01Z", { nombre: "colocar", ok: true }),
    ].join("\n"));
    const pasos = await leerPasosAuditoria("conv-1", "req-1", [path.join(raiz, "no-existe"), raiz]);
    assert.deepEqual(pasos.map((p) => p.nombre), ["colocar", "pintar"]);
    assert.deepEqual(await leerPasosAuditoria("conv-9", "req-1", [raiz]), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
