import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { crearAnalizadorV13, detectarDetecciones } from "@/lib/eval/estructuras/adaptador-v13";
import type { ItemSuite } from "@/lib/eval/estructuras/runner";
import type { ChatPort, PeticionChat, TurnoChat } from "@/lib/ia/nucleo/tipos";

/**
 * Plan A §A0.3: v13 adapter over the production analyzer with a simulated
 * Gemini port. Detector types survive (hoop stays aro), attached pieces and
 * non-structures are excluded, and drift fails loudly.
 */

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const elemento = (nombre: string, box: number[], structure?: Record<string, unknown>, category = "balloon_structure") => ({
  name: nombre, category, detection_confidence: 0.9, visible_evidence: "visible", box_2d: box, composition_relevance: "essential",
  ...(structure ? { structure } : {}),
  model_decision: { action: "include", match_type: "none", reason: "r", adaptation: "a" },
});

function chatSimulado(opciones: { auditoriaMalformada?: boolean } = {}): ChatPort {
  return {
    id: "gemini",
    modelo: "gemini-simulado",
    thinkingLevel: "default",
    async turno(peticion: PeticionChat): Promise<TurnoChat> {
      const nombre = peticion.herramientas[0]!.nombre;
      const uso = { entrada: 3000, salida: 900 };
      if (nombre === "return_reference_inventory") {
        return { texto: "", modelo: "gemini-simulado", uso, finishReason: "STOP", llamadas: [{ nombre, args: { images: [{ image_id: "REF_01", elements: [
          elemento("Balloon hoop", [100, 300, 700, 700], { structure_type: "hoop", horizontal_position: "center" }),
          elemento("Tall organic column", [50, 20, 950, 250], { structure_type: "column", top_overhang: "slight", horizontal_position: "left" }),
          elemento("Wooden table", [700, 400, 1000, 800], undefined, "furniture"),
        ] }] } }] };
      }
      if (opciones.auditoriaMalformada) return { texto: "{roto", modelo: "gemini-simulado", uso, llamadas: [] };
      return { texto: "", modelo: "gemini-simulado", uso, finishReason: "STOP", llamadas: [{ nombre, args: { images: [{ image_id: "REF_01", elements: [
        elemento("Balloon bouquet", [600, 750, 950, 950], { structure_type: "bouquet", horizontal_position: "right" }),
      ] }] } }] };
    },
    async *turnoStream() {
      throw new Error("not used");
    },
  };
}

function itemCon(base64: string): ItemSuite {
  return { image_sha256: createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"), ruta_privada: "privado/x.jpg", evaluacion_con_proveedor_externo: true, envio_proveedores_ia_permitido: true };
}

async function run(): Promise<void> {
  await caso("ok: tipos del detector conservados (hoop → aro), muebles fuera y salida cruda guardada por hash", async () => {
    const base64 = randomBytes(96).toString("base64");
    const guardados: string[] = [];
    const analizar = crearAnalizadorV13({ chat: chatSimulado(), leerImagen: async () => ({ base64, mime: "image/jpeg" }), guardarSalidaCruda: async (contenido) => { guardados.push(contenido); return createHash("sha256").update(contenido).digest("hex"); } });
    const resultado = await analizar(itemCon(base64), AbortSignal.timeout(10_000));
    assert.equal(resultado.resultado, "ok");
    if (resultado.resultado !== "ok") return;
    assert.deepEqual(resultado.detecciones.map((d) => [d.elementId, d.structure.type]), [["REF_01_E01", "hoop"], ["REF_01_E02", "column"], ["REF_01_E04", "bouquet"]]);
    assert.equal(guardados.length, 1);
    assert.equal(resultado.rawOutputSha256, createHash("sha256").update(guardados[0]!).digest("hex"));
    assert.doesNotMatch(guardados[0]!, new RegExp(base64.slice(0, 40).replace(/[+/]/g, "\\$&")), "raw output keeps model arguments, never the image");
    assert.deepEqual(resultado.pases.map((p) => [p.capacidad, p.malformado, p.finishReason]), [["analisis_referencia_inventario", false, "STOP"], ["analisis_referencia_auditoria", false, "STOP"]]);
  });

  await caso("auditoría malformada dos veces: se usa solo el inventario, como producción, y los intentos quedan marcados", async () => {
    const base64 = randomBytes(96).toString("base64");
    const analizar = crearAnalizadorV13({ chat: chatSimulado({ auditoriaMalformada: true }), leerImagen: async () => ({ base64, mime: "image/jpeg" }), guardarSalidaCruda: async () => "f".repeat(64) });
    const resultado = await analizar(itemCon(base64), AbortSignal.timeout(10_000));
    assert.equal(resultado.resultado, "ok");
    if (resultado.resultado !== "ok") return;
    assert.deepEqual(resultado.detecciones.map((d) => d.structure.type), ["hoop", "column"]);
    assert.deepEqual(resultado.pases.filter((p) => p.malformado).map((p) => [p.capacidad, p.intento]), [["analisis_referencia_auditoria", 1], ["analisis_referencia_auditoria", 2]]);
  });

  await caso("integridad: una imagen que no coincide con su hash se rechaza antes de llamar", async () => {
    let llamadas = 0;
    const chat = chatSimulado();
    const turno = chat.turno.bind(chat);
    chat.turno = async (p) => { llamadas += 1; return turno(p); };
    const analizar = crearAnalizadorV13({ chat, leerImagen: async () => ({ base64: randomBytes(10).toString("base64"), mime: "image/jpeg" }), guardarSalidaCruda: async () => "f".repeat(64) });
    await assert.rejects(analizar(itemCon(randomBytes(10).toString("base64")), AbortSignal.timeout(1_000)), /no coincide/);
    assert.equal(llamadas, 0);
  });

  await caso("deriva: si candidatos y blueprint no se alinean, falla en vez de predecir mal", () => {
    const pases = [{ capacidad: "analisis_referencia_inventario" as const, intento: 1, ms: 1, uso: { entrada: 0, salida: 0 }, args: { images: [{ image_id: "REF_01", elements: [elemento("Arch", [0, 0, 500, 500], { structure_type: "arch" })] }] } }];
    assert.throws(() => detectarDetecciones(pases, []), /1 candidatos frente a 0 elementos/);
    assert.throws(() => detectarDetecciones(pases, [{ element_id: "REF_01_E09", approved: true, reference_bbox: { x: 0, y: 0, width: 0.5, height: 0.5 }, visual_semantics: {} }]), /fuera de orden/);
    assert.throws(() => detectarDetecciones(pases, [{ element_id: "REF_01_E01", approved: true, reference_bbox: { x: 0.1, y: 0, width: 0.5, height: 0.5 }, visual_semantics: {} }]), /caja distinta/);
    assert.throws(() => detectarDetecciones([], []), /no hay inventario válido/);
  });

  console.log(`[PASS] ${casos} casos del adaptador v13`);
}

run().catch((error: unknown) => {
  console.error("[FAIL]", error);
  process.exitCode = 1;
});
