import assert from "node:assert/strict";
import { DETECTED_STRUCTURE_TYPES, parseDetectedStructure } from "../../src/lib/ia/referencia/reference-structure";
import { FAMILIAS_V2, familiaDesdeDetectorV1 } from "../../src/lib/eval/estructuras/familia-v1-v2";
import { instanciasDesdeDetecciones, leerPrediccionesJsonl, lineaJsonl, PrediccionEstructurasV1Schema, type PrediccionEstructurasV1 } from "../../src/lib/eval/estructuras/prediccion";

/**
 * Plan A §A0.3: `prediccion-estructuras.v1` contract and the step-1 family
 * adapter (Fundamentos §4.7), with synthetic vectors. No network, no provider.
 */

let casos = 0;
function caso(nombre: string, fn: () => void): void {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const HASH = "a".repeat(64);

function linea(overrides: Partial<PrediccionEstructurasV1> = {}): PrediccionEstructurasV1 {
  const detecciones = [
    { elementId: "REF_01_E01", bbox: { x: 0, y: 0.1, width: 0.3, height: 0.8 }, structure: parseDetectedStructure({ structure_type: "column", top_overhang: "slight", density: "dense", horizontal_position: "left" })! },
    { elementId: "REF_01_E02", bbox: { x: 0.6, y: 0.5, width: 0.2, height: 0.3 }, structure: parseDetectedStructure({ structure_type: "cluster", horizontal_position: "right" })! },
  ];
  return {
    schema: "prediccion-estructuras.v1",
    run_id: "a0-4a-v13-20260915",
    corrida: 1,
    image_sha256: HASH,
    sistema: { id: "v13", modelo: "gemini-3.6-flash", parser_version: "semantic-layers-v13-box-2d", system_prompt_sha256: HASH, config_hash: "b".repeat(64), thinking_level: "default", taxonomy_version: "estructuras-2.0.0", commit: "6190cef" },
    resultado: "ok",
    instancias: instanciasDesdeDetecciones(detecciones),
    raw_output_sha256: "c".repeat(64),
    uso_reportado: { tokens_entrada: 3000, tokens_salida: 800, tokens_pensamiento: 0, tokens_cacheados: 0, llamadas: 2, finish_reasons: ["STOP", "STOP"] },
    latencia_ms: { total: 9000, inventario: 6000, auditoria: 3000 },
    ...overrides,
  };
}

caso("paso 1 de §4.7: los 11 tipos del detector v1 tienen familia v2 (cluster ambigua con bouquet y centro_mesa)", () => {
  const esperado: Record<string, string | null> = {
    arch: "arco", half_arch: "semiarco", column: "columna", garland: "guirnalda", balloon_wall: "pared",
    centerpiece: "centro_mesa", ceiling_installation: "techo", cluster: null, sculpture: "figura", bouquet: "bouquet", hoop: "aro",
  };
  assert.deepEqual([...DETECTED_STRUCTURE_TYPES].sort(), Object.keys(esperado).sort(), "the adapter covers every detector type");
  for (const tipo of DETECTED_STRUCTURE_TYPES) assert.equal(familiaDesdeDetectorV1(tipo).familia, esperado[tipo], tipo);
  assert.deepEqual(familiaDesdeDetectorV1("cluster"), { estado: "ambigua", familia: null, candidatos: ["bouquet", "centro_mesa"] });
  const usadas = new Set(DETECTED_STRUCTURE_TYPES.flatMap((tipo) => familiaDesdeDetectorV1(tipo).candidatos));
  assert.deepEqual([...usadas].sort(), [...FAMILIAS_V2].sort(), "every v2 family is reachable");
});

caso("hoop y ceiling_installation conservan su familia (el blueprint las perdía como arco y guirnalda)", () => {
  assert.equal(familiaDesdeDetectorV1("hoop").familia, "aro");
  assert.equal(familiaDesdeDetectorV1("ceiling_installation").familia, "techo");
  const copia = familiaDesdeDetectorV1("cluster");
  copia.candidatos.push("aro");
  assert.deepEqual(familiaDesdeDetectorV1("cluster").candidatos, ["bouquet", "centro_mesa"], "the shared table is not mutable through a result");
});

caso("instancias: atributos v1 tal como los resolvió el parser, sin inventar familia", () => {
  const [columna, grupo] = linea().instancias;
  assert.deepEqual(columna, {
    instance_id: "REF_01_E01", bbox: { x: 0, y: 0.1, width: 0.3, height: 0.8 }, familia: "columna", candidatos: ["columna"], estado: "determinada",
    atributos_v1: { structure_type: "column", outline: "asymmetric", density: "dense", horizontal_position: "left", top_overhang: "slight", grounded: true },
  });
  assert.equal(grupo!.estado, "ambigua");
  assert.equal(grupo!.familia, null);
});

caso("contrato: una línea válida hace ida y vuelta por JSONL", () => {
  const texto = lineaJsonl(linea()) + "\n" + lineaJsonl(linea({ corrida: 2 }));
  const leidas = leerPrediccionesJsonl(texto);
  assert.deepEqual(leidas.map((prediccion) => prediccion.corrida), [1, 2]);
  assert.deepEqual(leidas[0], linea());
});

caso("contrato: rechaza campos extra, texto libre, hashes inválidos e incoherencias", () => {
  const invalida = (valor: unknown, patron: RegExp) => {
    const resultado = PrediccionEstructurasV1Schema.safeParse(valor);
    assert.equal(resultado.success, false, JSON.stringify(valor).slice(0, 120));
    assert.match(JSON.stringify(resultado.error?.issues), patron);
  };
  invalida({ ...linea(), prompt: "texto del sistema" }, /unrecognized|prompt/i);
  invalida({ ...linea(), image_sha256: "no-hash" }, /image_sha256/);
  invalida(linea({ resultado: "error" }), /solo una corrida ok/);
  const [columna] = linea().instancias;
  invalida(linea({ instancias: [{ ...columna!, candidatos: ["columna", "semiarco"] }] }), /determinada/);
  invalida(linea({ instancias: [{ ...columna!, estado: "ambigua", familia: null, candidatos: ["columna"] }] }), /ambigua/);
  invalida(linea({ instancias: [{ ...columna!, bbox: { x: 0.8, y: 0, width: 0.5, height: 0.5 } }] }), /fuera de la imagen/);
  invalida(linea({ uso_reportado: { ...linea().uso_reportado, finish_reasons: ["stop libre"] } }), /finish_reasons/);
  assert.throws(() => leerPrediccionesJsonl(`${lineaJsonl(linea())}{roto\n`), /línea 2 no es JSON/);
});

console.log(`[PASS] ${casos} casos de prediccion-estructuras.v1`);
