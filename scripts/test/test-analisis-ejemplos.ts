import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ANALISIS_EJEMPLOS, analisisFijoDeEjemplo, sha256Base64 } from "@/lib/ia/amaterasu/analisis-ejemplos";
import { analizarReferenciasV2, ANALYSIS_PARSER_VERSION } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { tieneEstructurasDeGlobos } from "@/lib/ia/referencia/reference-structure";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "@/lib/referencias-ejemplo/manifiesto";
import type { ChatPort, PeticionChat, TurnoChat } from "@/lib/ia/nucleo/tipos";

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
    assert.equal(ANALISIS_EJEMPLOS.parser_version, ANALYSIS_PARSER_VERSION, "regenera con scripts/ops/generar-analisis-ejemplos.ts");
    for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
      const ejemplo = ANALISIS_EJEMPLOS.ejemplos.find((item) => item.id === foto.id);
      assert.ok(ejemplo, `falta ${foto.id}`);
      assert.equal(ejemplo.sha256, sha256Base64(archivoEjemplo(foto.archivo)), `${foto.id}: la foto cambió`);
      const blueprint = ReferenceBlueprintV2Schema.parse(ejemplo.resultado.blueprint);
      assert.ok(tieneEstructurasDeGlobos(blueprint), `${foto.id} sin estructuras de globos`);
      assert.equal(ejemplo.resultado.tieneEstructurasDeGlobos, true);
    }
  });

  await caso("A0.2 cajas por defecto 0,1/0,1/0,2/0,2 del análisis fijo: solo las excepciones explícitas", () => {
    // Known default box (Plan A F10). Removal condition: A7 merged (regenerates
    // the stored analysis, fixes E03 and replaces this list with a test that
    // forbids default boxes outright).
    const EXCEPCIONES_CAJA_POR_DEFECTO = ["ejemplo-10/REF_01_E03"];
    const encontradas = ANALISIS_EJEMPLOS.ejemplos.flatMap((ejemplo) =>
      ejemplo.resultado.blueprint.elements
        .filter(({ reference_bbox: caja }) => caja.x === 0.1 && caja.y === 0.1 && caja.width === 0.2 && caja.height === 0.2)
        .map((element) => `${ejemplo.id}/${element.element_id}`),
    );
    assert.deepEqual(encontradas, EXCEPCIONES_CAJA_POR_DEFECTO, "caja por defecto nueva o excepción obsoleta");
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

  await caso("A0.2 vectores box_2d: fuera de rango, ejes invertidos, área mínima y caja inválida", async () => {
    const cajaDe = async (box2d: unknown): Promise<number[]> => {
      const [imagen] = inventario.images;
      const conCaja = { images: [{ ...imagen, elements: [{ ...imagen!.elements[0], box_2d: box2d }] }] };
      const resultado = await analizarReferenciasV2(mockChat(conCaja, "vacio"), [fotoPrueba()], [], "perceptual");
      const columna = resultado.blueprint.elements.find((element) => element.name === "Left balloon column");
      assert.ok(columna, `sin elemento para ${JSON.stringify(box2d)}`);
      const caja = columna.reference_bbox;
      return [caja.x, caja.y, caja.width, caja.height].map((valor) => Math.round(valor * 1000) / 1000);
    };
    // Out of range is clamped to 0-1000 before normalizing.
    assert.deepEqual(await cajaDe([-50, -10, 1200, 1500]), [0, 0, 1, 1]);
    // Inverted axes (ymax < ymin, xmax < xmin) give the same box as the ordered ones.
    assert.deepEqual(await cajaDe([880, 370, 0, 20]), await cajaDe([0, 20, 880, 370]));
    // A zero-area box keeps the 0.01 minimum and stays inside the image.
    assert.deepEqual(await cajaDe([500, 500, 500, 500]), [0.5, 0.5, 0.01, 0.01]);
    assert.deepEqual(await cajaDe([1000, 1000, 1000, 1000]), [0.99, 0.99, 0.01, 0.01]);
    // Characterization of F10: an unusable box_2d falls back to the default
    // 0.1/0.1/0.2/0.2 box. Removal condition: A2.2a/A7 ("sin caja válida no se aprueba").
    assert.deepEqual(await cajaDe([0, 0, "x", 100]), [0.1, 0.1, 0.2, 0.2]);
    assert.deepEqual(await cajaDe([0, 0, 100]), [0.1, 0.1, 0.2, 0.2]);
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
