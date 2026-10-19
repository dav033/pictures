import assert from "node:assert/strict";
import { compararConCarpeta } from "../../src/lib/eval/estructuras/analisis-carpeta";
import type { InstanciaPrediccion, PrediccionEstructurasV1 } from "../../src/lib/eval/estructuras/prediccion";

/** Directional folder comparison with synthetic runs (no provider). */

const hash = (n: number) => n.toString(16).padStart(64, "0");
const instancia = (familia: "arco" | "columna" | "semiarco", tamano: number, outline: "symmetric" | "asymmetric" = "symmetric", density: "dense" | "airy" = "dense"): InstanciaPrediccion => ({
  instance_id: `E${tamano}`, bbox: { x: 0, y: 0, width: tamano, height: tamano }, familia, candidatos: [familia], estado: "determinada",
  atributos_v1: { structure_type: familia === "arco" ? "arch" : familia === "columna" ? "column" : "half_arch", outline, density, horizontal_position: "center", top_overhang: null, grounded: true },
});
const linea = (imagen: number, corrida: number, instancias: InstanciaPrediccion[], resultado: "ok" | "error" = "ok"): PrediccionEstructurasV1 => ({
  schema: "prediccion-estructuras.v1", run_id: "r", corrida, image_sha256: hash(imagen), resultado, instancias: resultado === "ok" ? instancias : [], raw_output_sha256: null,
  sistema: { id: "v13", modelo: "m", parser_version: "p", system_prompt_sha256: "a".repeat(64), config_hash: "b".repeat(64), thinking_level: "low", taxonomy_version: "t", commit: "abc1234" },
  uso_reportado: { tokens_entrada: 0, tokens_salida: 0, tokens_pensamiento: 0, tokens_cacheados: 0, llamadas: 0, finish_reasons: [] }, latencia_ms: { total: 1, inventario: null, auditoria: null },
});

const etiquetas = { [hash(1)]: "columna_organica", [hash(2)]: "semiarco_organico", [hash(3)]: "arco" };
const lineas = [
  // Organic column: found as column both runs, asymmetric once.
  linea(1, 1, [instancia("columna", 0.5, "asymmetric")]), linea(1, 2, [instancia("columna", 0.5)]),
  // Organic half-arch seen as column (bigger) plus a small half-arch, then nothing.
  linea(2, 1, [instancia("columna", 0.6, "asymmetric"), instancia("semiarco", 0.2, "asymmetric")]), linea(2, 2, []),
  // Regular arch: arch, reported asymmetric once (false organic); an error run is ignored.
  linea(3, 1, [instancia("arco", 0.7, "asymmetric", "airy")]), linea(3, 2, [instancia("arco", 0.7)]), linea(3, 3, [], "error"),
  // Image without folder label is ignored.
  linea(9, 1, [instancia("arco", 0.4)]),
];

const r = compararConCarpeta(lineas, etiquetas);
assert.deepEqual([r.imagenes, r.corridas_ok], [3, 6]);
const clase = (nombre: string) => r.por_clase.find((c) => c.clase === nombre)!;
assert.deepEqual([clase("columna_organica").tasa_familia_principal, clase("columna_organica").tasa_contorno_asimetrico], [1, 0.5]);
assert.deepEqual([clase("semiarco_organico").tasa_familia_presente, clase("semiarco_organico").tasa_familia_principal, clase("semiarco_organico").tasa_sin_estructura], [0.5, 0, 0.5]);
assert.deepEqual([clase("arco").tasa_contorno_asimetrico, clase("arco").tasa_densidad_airy], [0.5, 0.5]);
// Organic folders: columna 1/2 + semiarco 1/1 → 2/3; regular: arco 1/2.
assert.ok(Math.abs(r.global.organico_detectado_en_carpetas_organicas! - 2 / 3) < 1e-12);
assert.equal(r.global.asimetrico_en_carpetas_regulares, 0.5);
assert.deepEqual(r.confusion_familia_carpeta_vs_principal.semiarco, { columna: 1, sin_estructura: 1 });
assert.deepEqual(r.imagenes_inestables.map((i) => i.clase), ["semiarco_organico"]);
assert.deepEqual(r.tipos_detector_por_clase.semiarco_organico, { column: 1, half_arch: 1 });
console.log("[PASS] 1 caso del análisis contra carpeta");
