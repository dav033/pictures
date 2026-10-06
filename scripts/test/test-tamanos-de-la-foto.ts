/**
 * UI-4 (2026-10-05): las dos lecturas de tamaño de una pieza se reconcilian antes de decidir su mezcla.
 *
 * La categoría `tamanos_leidos` casi siempre dice «chicos_con_pocos_grandes». Cuando el conteo de la misma
 * pieza cuenta un 40 % o más de globos grandes y gigantes (columna dorada del CASE-001 de images-judge: 0,4-0,5,
 * comprada con un 7 % de 18"/24"), manda la cifra. En cualquier otro caso, la categoría tal cual.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-tamanos-de-la-foto.ts
 */
import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { PARTE_GRANDES_CONTRADICE, tamanosDeLaFoto } from "@/lib/ia/herramientas/registro-herramientas";

configurarPersistenciaTelemetria(undefined);

type Apariencia = Parameters<typeof tamanosDeLaFoto>[0];
const apariencia = (tamanos: string | undefined, porTamano: Array<[string, number]> | null, confianza = 0.8) => ({
  observed_colors: ["chrome gold"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "column", composition: "",
  ...(tamanos ? { tamanos_leidos: tamanos } : {}),
  ...(porTamano ? { conteo: { globos_visibles: 35, exacto: false, estimado_total: null, racimos: null, globos_por_racimo: null, por_tamano: porTamano.map(([clase, proporcion]) => ({ clase, proporcion })), largo_relativo: null, alto_relativo: null, confianza } } : {}),
}) as unknown as Apariencia;

// La columna dorada del CASE-001: la categoría dice «pocos grandes» y el conteo cuenta 0,4 de grandes.
const dorada = apariencia("chicos_con_pocos_grandes", [["chico", 0.3], ["mediano", 0.3], ["grande", 0.3], ["gigante", 0.1]]);
assert.equal(tamanosDeLaFoto(dorada), "grandes_con_pocos_chicos", "la contradicción la resuelve la cifra");
// Las demás piezas de la línea base (0,15-0,3 de grandes) no cambian.
assert.equal(tamanosDeLaFoto(apariencia("chicos_con_pocos_grandes", [["chico", 0.4], ["mediano", 0.3], ["grande", 0.3]])), "chicos_con_pocos_grandes");
assert.ok(PARTE_GRANDES_CONTRADICE > 0.3, "el umbral queda por encima de lo que midieron las piezas de grandes escasos");
// Un conteo poco fiable no contradice nada.
assert.equal(tamanosDeLaFoto(apariencia("chicos_con_pocos_grandes", [["grande", 0.6], ["chico", 0.4]], 0.3)), "chicos_con_pocos_grandes");
// Sin conteo, o con otra categoría, la categoría tal cual: esto solo resuelve una contradicción.
assert.equal(tamanosDeLaFoto(apariencia("chicos_con_pocos_grandes", null)), "chicos_con_pocos_grandes");
assert.equal(tamanosDeLaFoto(apariencia("un_solo_tamano", [["gigante", 1]])), "un_solo_tamano");
assert.equal(tamanosDeLaFoto(apariencia(undefined, [["gigante", 1]])), undefined, "sin categoría no se inventa una");

console.log("test-tamanos-de-la-foto: OK");
