import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ANALISIS_EJEMPLOS, analisisFijoDeEjemplo, sha256Base64 } from "@/lib/ia/analisis-ejemplos";
import { analizarReferenciasV2, ANALYSIS_PARSER_VERSION } from "@/lib/ia/analizar-referencias-v2";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { tieneEstructurasDeGlobos } from "@/lib/ia/reference-structure";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "@/lib/referencias-ejemplo/manifiesto";
import type { ChatPort, PeticionChat, TurnoChat } from "@/lib/ia/tipos";

/**
 * Stored analyses of the gallery photos, `box_2d` boxes and the audit
 * fallback (iteración 5). No network, no key.
 */

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

function mockChat(inventario: Record<string, unknown>, audit: "vacio" | "malformado"): ChatPort & { llamadas: () => number } {
  let llamadas = 0;
  return {
    id: "gemini",
    modelo: "mock-ejemplos",
    llamadas: () => llamadas,
    async turno(peticion: PeticionChat): Promise<TurnoChat> {
      llamadas += 1;
      const nombre = peticion.herramientas[0]!.nombre;
      if (nombre === "return_reference_audit" && audit === "malformado") return { texto: "{roto", llamadas: [], uso: { entrada: 0, salida: 0 }, modelo: "mock-ejemplos" };
      const args = nombre === "return_reference_inventory" ? inventario : { images: [{ image_id: "REF_01", elements: [] }] };
      return { texto: "", llamadas: [{ nombre, args }], uso: { entrada: 0, salida: 0 }, modelo: "mock-ejemplos" };
    },
    async *turnoStream() {
      throw new Error("not used");
    },
  };
}

const archivoEjemplo = (nombre: string) => readFileSync(path.join(process.cwd(), "public", "referencias-ejemplo", nombre)).toString("base64");

async function run(): Promise<void> {
  await caso("cada foto de la galería tiene su análisis revisado con la versión actual del parser", () => {
    assert.equal(ANALISIS_EJEMPLOS.parser_version, ANALYSIS_PARSER_VERSION, "regenera con scripts/generar-analisis-ejemplos.ts");
    for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
      const ejemplo = ANALISIS_EJEMPLOS.ejemplos.find((item) => item.id === foto.id);
      assert.ok(ejemplo, `falta ${foto.id}`);
      assert.equal(ejemplo.sha256, sha256Base64(archivoEjemplo(foto.archivo)), `${foto.id}: la foto cambió`);
      const blueprint = ReferenceBlueprintV2Schema.parse(ejemplo.resultado.blueprint);
      assert.ok(tieneEstructurasDeGlobos(blueprint), `${foto.id} sin estructuras de globos`);
      assert.equal(ejemplo.resultado.tieneEstructurasDeGlobos, true);
    }
  });

  await caso("la foto de ejemplo sin recomprimir devuelve su análisis sin llamar al proveedor", async () => {
    const foto = MANIFIESTO_REFERENCIAS_EJEMPLO.fotos[0]!;
    const chat = mockChat({ images: [] }, "vacio");
    const resultado = await analizarReferenciasV2(chat, [{ id: "REF_01", mime: "image/jpeg", base64: archivoEjemplo(foto.archivo), descripcion: "ejemplo" }], [], "perceptual");
    assert.equal(chat.llamadas(), 0);
    assert.equal(resultado.metadata.cached, true);
    assert.equal(resultado.blueprint.elements.length, ANALISIS_EJEMPLOS.ejemplos[0]!.resultado.blueprint.elements.length);
  });

  await caso("con otra foto, dos fotos, otra versión o Reintentar no se usa el análisis guardado", () => {
    const base64 = archivoEjemplo(MANIFIESTO_REFERENCIAS_EJEMPLO.fotos[1]!.archivo);
    const referencia = { id: "REF_01", mime: "image/jpeg", base64, descripcion: "ejemplo" };
    assert.ok(analisisFijoDeEjemplo([referencia], ANALYSIS_PARSER_VERSION));
    assert.equal(analisisFijoDeEjemplo([referencia], "otra-version"), null);
    assert.equal(analisisFijoDeEjemplo([referencia, { ...referencia, id: "REF_02" }], ANALYSIS_PARSER_VERSION), null);
    assert.equal(analisisFijoDeEjemplo([{ ...referencia, base64: Buffer.from("otra").toString("base64") }], ANALYSIS_PARSER_VERSION), null);
  });

  const inventario = {
    images: [{
      image_id: "REF_01",
      suggested_roles: ["composition_reference"],
      composition: { focal_point: "x", density: "moderate", symmetry: "symmetric" },
      palette: { observed: ["pink"] },
      elements: [{
        name: "Left balloon column",
        category: "balloon_structure",
        detection_confidence: 0.9,
        visible_evidence: "column",
        box_2d: [0, 20, 880, 370],
        composition_relevance: "essential",
        structure: { structure_type: "column", horizontal_position: "left", top_overhang: "none" },
        model_decision: { action: "include", match_type: "none", reason: "r", adaptation: "a" },
      }],
    }],
  };
  const fotoPrueba = () => ({ id: "REF_01", mime: "image/jpeg", base64: Buffer.from(`prueba-${Math.random()}`).toString("base64"), descripcion: "test" });

  await caso("box_2d [ymin, xmin, ymax, xmax] 0-1000 se convierte a reference_bbox normalizado", async () => {
    const resultado = await analizarReferenciasV2(mockChat(inventario, "vacio"), [fotoPrueba()], [], "perceptual");
    const columna = resultado.blueprint.elements.find((element) => element.name === "Left balloon column");
    assert.ok(columna);
    const caja = columna.reference_bbox;
    assert.deepEqual([caja.x, caja.y, caja.width, caja.height].map((valor) => Math.round(valor * 100) / 100), [0.02, 0, 0.35, 0.88]);
  });

  await caso("una verificación mal formada deja el inventario en vez de tumbar el análisis", async () => {
    const resultado = await analizarReferenciasV2(mockChat(inventario, "malformado"), [fotoPrueba()], [], "perceptual");
    assert.ok(tieneEstructurasDeGlobos(ReferenceBlueprintV2Schema.parse(resultado.blueprint)));
  });

  console.log(`\n${casos} casos OK`);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
