import { strict as assert } from "node:assert";
import { AsistenteGuiadoRequestSchema, PlanActualGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { cotizacionCorrespondeASeleccion, decoracionCotizableCoincide, normalizarCiudad, prepararHistorialGuiado, protegerHerramientas, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";

const base = { schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "Quiero un cumpleaños de 8 años, con estrellas" }], brief: { evento: "cumpleaños", edad: 8, tematica: "estrellas" } };
assert.equal(AsistenteGuiadoRequestSchema.safeParse(base).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, loraMode: "inventado" }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { decoracionId: "deco-no-real" } }).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, fotoInspiracion: { mime: "image/gif", base64: "abc" } }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, messages: [{ role: "assistant", content: "" }] }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, messages: Array.from({ length: 81 }, () => ({ role: "user", content: "hola" })) }).success, false);
// Cliente anterior: `propuesta: true` / `opcion` se descartan en silencio (sin 400). Estado nuevo: alcance, pieza y plan vigente.
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { propuesta: true, opcion: "costear" } }).success, true);
assert.deepEqual(AsistenteGuiadoRequestSchema.parse({ ...base, estadoGuiado: { propuesta: true, uso: "personal" } }).estadoGuiado, { uso: "personal" });
const planActual = { piezas: [{ estructura: "arco_asimetrico", cantidad: 1, nombre: "Arco orgánico" }, { estructura: "columna", cantidad: 2 }], colores: ["azul", "blanco", "dorado"], totalGlobos: 180, resumen: "Tu plan: 1 arco orgánico y 2 columnas, en azul, blanco y dorado; 180 globos en total." };
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { alcancePropuesta: "individual", piezaPedida: "columna", planActual } }).success, true);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { piezaPedida: "pieza_falsa" } }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { planActual: { ...planActual, piezas: [] } } }).success, false);
assert.equal(AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado: { planActual: { ...planActual, sku: "x" } } }).success, false);
assert.equal(PlanActualGuiadoSchema.safeParse({ ...planActual, resumen: "x".repeat(401) }).success, false);
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
  // Un error de validación vuelve al modelo con las rutas de los campos (sin los valores) y queda en el log del servidor.
  const avisos: string[] = [];
  const warnOriginal = console.warn;
  console.warn = (...partes: unknown[]) => { avisos.push(partes.map(String).join(" ")); };
  try {
    const zodProtegido = protegerHerramientas({ proponer: async () => PlanActualGuiadoSchema.parse({ piezas: [], colores: ["secreto-del-modelo"] }) });
    const resultado = (await zodProtegido.proponer()) as unknown as { ok: boolean; motivo: string; campos: string[] };
    assert.equal(resultado.motivo, "argumentos_invalidos");
    assert.ok(resultado.campos.some((campo) => campo.startsWith("piezas")));
  } finally { console.warn = warnOriginal; }
  assert.ok(avisos.some((aviso) => aviso.includes("proponer") && aviso.includes("piezas")), "deja constancia con el nombre de la herramienta");
  assert.ok(avisos.every((aviso) => !aviso.includes("secreto-del-modelo")), "sin argumentos en el log");
  console.log("test-asistente-guiado-contrato: 27 comprobaciones correctas");
}
void verificarHerramientaProtegida();
