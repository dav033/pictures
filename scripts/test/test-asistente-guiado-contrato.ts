import { strict as assert } from "node:assert";
import { AsistenteGuiadoRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { cotizacionCorrespondeASeleccion, decoracionCotizableCoincide, normalizarCiudad, prepararHistorialGuiado, protegerHerramientas, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";

const base = { schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "Quiero un cumpleaños de 8 años, con estrellas" }], brief: { evento: "cumpleaños", edad: 8, tematica: "estrellas" } };
assert.equal(AsistenteGuiadoRequestSchema.safeParse(base).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, loraMode: "inventado" }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { decoracionId: "deco-no-real" } }).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, fotoInspiracion: { mime: "image/gif", base64: "abc" } }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, messages: [{ role: "assistant", content: "" }] }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, messages: Array.from({ length: 81 }, () => ({ role: "user", content: "hola" })) }).success, false);
const historial = prepararHistorialGuiado(Array.from({ length: 80 }, (_, indice) => ({ role: "user" as const, content: `m${indice}` })), "x".repeat(7000));
assert.equal(historial.length, 80);
assert.equal(historial.at(-1)?.content.length, 6000);
assert.equal(historial.some((mensaje) => mensaje.content === "m0"), false);
const turnoFallido = [{ role: "user" as const, content: "anterior" }, { role: "assistant" as const, content: "respuesta previa" }, { role: "user" as const, content: "falló" }, { role: "assistant" as const, content: "parcial" }];
const reintento = prepararHistorialGuiado(turnoFallido, "falló", true);
assert.deepEqual(reintento, [{ role: "user", content: "anterior" }, { role: "assistant", content: "respuesta previa" }, { role: "user", content: "falló" }]);
assert.deepEqual(sinUltimoTurnoGuiado(turnoFallido), turnoFallido.slice(0, 2));
assert.equal(cotizacionCorrespondeASeleccion("deco-a", "deco-b"), false);
assert.equal(decoracionCotizableCoincide("deco-a", "deco-b"), false);
assert.equal(decoracionCotizableCoincide("deco-a", "deco-a"), true);
assert.equal(normalizarCiudad(" Bogotá "), normalizarCiudad("Bogota"));
const protegido = protegerHerramientas({ falla: async () => { throw new Error("fuera de snapshot"); } });
async function verificarHerramientaProtegida(): Promise<void> {
  assert.deepEqual(await protegido.falla(), { ok: false, motivo: "herramienta_no_disponible" });
  console.log("test-asistente-guiado-contrato: 16 comprobaciones correctas");
}
void verificarHerramientaProtegida();
