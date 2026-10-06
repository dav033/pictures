import { readFile } from "node:fs/promises";
import { adaptarAnalisisReferencia } from "../../src/lib/ia/guiado/adaptar-analisis-referencia";
import { generarPasosPlan } from "../../src/lib/ia/guiado/generar-pasos-plan";

const base = process.env.GUIADO_API_URL ?? "http://127.0.0.1:3070";
const rutaFoto = process.argv[2];
if (!rutaFoto) throw new Error("Indica ruta a una foto JPG/PNG/WebP para probar las dos rutas API.");

async function eventos(response: Response) {
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; const resultados: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const paquetes = buffer.split("\n\n"); buffer = paquetes.pop() ?? "";
    for (const paquete of paquetes) {
      const linea = paquete.split("\n").find((item) => item.startsWith("data: "));
      if (linea) { const dato = JSON.parse(linea.slice(6)) as { type: string }; if (dato.type === "error") throw new Error(JSON.stringify(dato)); if (dato.type === "fin") resultados.push(dato); }
    }
  }
  return resultados.at(-1) as Record<string, unknown>;
}
async function post(path: string, body: unknown) { return fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function main() {
  const brief = { evento: "Cumpleaños", edad: 6, tematica: "princesas" };
  const propuestaFin = await eventos(await post("/api/asistente-guiado", { schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "Propónme algo para mi cumpleaños de 6 años con princesas." }], brief }));
  const result = propuestaFin.result as { propuesta?: { piezas: Array<{ estructura: string; cantidad: number }>; colores: string[] } };
  if (!result.propuesta) throw new Error("La ruta guiada no devolvió propuesta.");
  const propuesta = result.propuesta;
  const instruccion = `Me gusta, armémosla. Diseña exactamente: ${propuesta.piezas.map((pieza) => `${pieza.cantidad} ${pieza.estructura}`).join(", ")}. Colores: ${propuesta.colores.join(", ")}.`;
  const planFin = await eventos(await post("/api/chat", { schema_version: "chat.v1", messages: [{ role: "user", content: "Cumpleaños infantil de 6 años, princesas." }, { role: "assistant", content: "Puedo proponerte una composición." }, { role: "user", content: instruccion }], brief: { tipo_evento: brief.evento, colores: propuesta.colores, estilo: brief.tematica } }));
  const plan = planFin.plan;
  if (!plan) throw new Error("/api/chat no devolvió plan resuelto después de aceptar propuesta.");
  const pasos = generarPasosPlan(plan);
  console.log(`IDEA: ${propuesta.piezas.map((pieza) => `${pieza.cantidad} ${pieza.estructura}`).join(", ")} en ${propuesta.colores.join(", ")}`);
  console.log(`ACEPTAR/PLAN: ${pasos.pasos.length} pasos; ${pasos.total} globos; ${pasos.globos.map((item) => `${item.cantidad} ${item.color} ${item.tamano}`).join(", ")}`);
  console.log("PASOS:", pasos.pasos.map((paso) => paso.texto).join(" | "));

  const bytes = await readFile(rutaFoto); const ext = rutaFoto.toLowerCase().split(".").at(-1);
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const imagen = { mime, base64: bytes.toString("base64") };
  const analisisResponse = await post("/api/references/analyze", { images: [imagen] });
  if (!analisisResponse.ok) throw new Error(`Análisis foto HTTP ${analisisResponse.status}: ${await analisisResponse.text()}`);
  const analisis = await analisisResponse.json() as unknown;
  const referencia = adaptarAnalisisReferencia(analisis);
  if (!referencia) throw new Error("La foto no produjo estructuras de globos aprobadas.");
  const lectura = analisis as { blueprint: unknown };
  const fotoPlanFin = await eventos(await post("/api/chat", { schema_version: "chat.v1", messages: [{ role: "user", content: "Adjunto una foto de inspiración." }, { role: "assistant", content: referencia.frase }, { role: "user", content: "Sí, armémoslo. Resuelve el plan con las estructuras y colores de la foto." }], brief: { tipo_evento: "Cumpleaños" }, imagenesReferencia: [imagen], referenceBlueprint: lectura.blueprint }));
  const fotoPlan = fotoPlanFin.plan;
  if (!fotoPlan) throw new Error("/api/chat no resolvió un plan para la foto.");
  const guia = generarPasosPlan(fotoPlan);
  const cotizacion = fotoPlanFin.cotizacion as { total?: number } | undefined;
  console.log(`FOTO: ${referencia.frase}; ${guia.total} globos: ${guia.globos.map((item) => `${item.cantidad} ${item.color} ${item.tamano}`).join(", ")}`);
  console.log(`FOTO/PASOS: ${guia.pasos.length}: ${guia.pasos.map((paso) => paso.texto).join(" | ")}`);
  console.log(`COSTEAR PERSONAL: materiales ${cotizacion?.total ?? "sin cotización"} COP; cotización devuelta por /api/chat/Python.`);
}
void main();
