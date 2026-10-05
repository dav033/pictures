/**
 * Armado de guirnaldas por partes (ADR-0032), del lado de Next.
 *
 * - `armado-guirnalda.v1` (Zod) solo valida la forma, sin `.default()`: lo que
 *   entra es lo que se firma. Plan 1.0 y 1.1 lo aceptan como campo opcional.
 * - `ArmadoGuirnaldaResueltoSchema` acepta lo que Python escribe de verdad
 *   (`scripts/fixtures/armado-guirnalda/resueltos.json`, generado con
 *   `services/ai-api` sobre el catálogo de prueba) y el mapeador lo deja pasar.
 * - `GUIRNALDAS_ARMADO_V1` arranca apagada y `completar_armados_guirnalda` solo
 *   viaja cuando se pide, en la resolución y en la edición.
 * - La acción `armado_guirnalda` de la edición y el re-sugerido tras editar.
 *
 * Qué NO se prueba aquí: qué armado elige Python ni cómo reparte los globos
 * (eso es de `armado_guirnalda.py` y sus pruebas). Offline.
 * Run: npx tsx --conditions=react-server scripts/test/test-armado-guirnalda.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

process.env.PYTHON_BACKEND_URL ??= "http://python.test";
process.env.INTERNAL_HMAC_SECRET ??= "local-only-secret-0123456789abcdef";

type Json = Record<string, unknown>;

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

function instalarPython(): Json[] {
  const cuerpos: Json[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)) as Json);
    return new Response("sin respuesta", { status: 503 });
  }) as typeof fetch;
  return cuerpos;
}

const ARMADO = {
  version: "armado-guirnalda.v1",
  origen: "decorador",
  soporte: "colgada",
  forma: "arco_caido",
  caida_m: 0.4,
  puntos_de_anclaje: 3,
  racimo: { unidad: "cuarteto", tamano_pulg_base: 12 },
  relleno: { material: 1, proporcion: 0.2 },
  remates: [{ material: 0, posicion: "extremo_izq" }],
} as const;

async function main(): Promise<void> {
  const { ArmadoGuirnaldaV1Schema, ArmadoGuirnaldaResueltoSchema, LecturaGuirnaldaSchema } = await import("../../src/lib/plan/armado-guirnalda");
  const { PlanDecoracionSchema, EstructuraPlan1_1Schema } = await import("../../src/lib/plan/tipos");

  // ---------------------------------------------------------------------------
  assert.deepEqual(ArmadoGuirnaldaV1Schema.parse(ARMADO), ARMADO, "sin defaults: sale lo que entra");
  const sinRelleno = { ...ARMADO, soporte: "pared", forma: "recta", caida_m: undefined, puntos_de_anclaje: undefined, relleno: null, remates: [] };
  delete (sinRelleno as Json).caida_m;
  delete (sinRelleno as Json).puntos_de_anclaje;
  assert.deepEqual(ArmadoGuirnaldaV1Schema.parse(sinRelleno), sinRelleno);
  const malos: Json[] = [
    { ...ARMADO, soporte: "techo" },
    { ...ARMADO, puntos_de_anclaje: 1 },
    { ...ARMADO, puntos_de_anclaje: 7 },
    { ...ARMADO, caida_m: 0 },
    { ...ARMADO, relleno: { material: 0, proporcion: 0.6 } },
    { ...ARMADO, remates: Array.from({ length: 7 }, () => ({ material: 0, posicion: "centro" })) },
    { ...ARMADO, racimo: { unidad: "sexteto", tamano_pulg_base: 12 } },
    { ...ARMADO, racimo: { unidad: "cuarteto", tamano_pulg_base: 10 } },
    { ...ARMADO, estructura_id: "arco" },
    { ...ARMADO, extra: 1 },
  ];
  const sinCampoRelleno: Json = { ...ARMADO };
  delete sinCampoRelleno.relleno;
  malos.push(sinCampoRelleno);
  for (const malo of malos) assert.equal(ArmadoGuirnaldaV1Schema.safeParse(malo).success, false, JSON.stringify(malo));
  ok("armado-guirnalda.v1: solo forma, sin defaults, relleno y remates obligatorios");

  // ---------------------------------------------------------------------------
  // Decisión 27: el desnivel entre los extremos, en metros y con signo; opcional.
  for (const desnivel of [-0.6, 0.25, -5, 5]) {
    assert.equal(ArmadoGuirnaldaV1Schema.parse({ ...ARMADO, desnivel_m: desnivel }).desnivel_m, desnivel);
  }
  for (const desnivel of [-5.01, 5.5, "0,4", null]) {
    assert.equal(ArmadoGuirnaldaV1Schema.safeParse({ ...ARMADO, desnivel_m: desnivel }).success, false, `desnivel_m ${String(desnivel)}`);
  }
  assert.equal("desnivel_m" in ArmadoGuirnaldaV1Schema.parse(ARMADO), false, "sin desnivel no aparece: el plan firmado es el de antes");
  ok("armado-guirnalda.v1: desnivel_m opcional, con signo y dentro de ±5 m");

  // ADR-0032, decisión 28: arqueo_m, cuánto SUBE el centro sobre la recta entre los extremos.
  for (const arqueo of [0.01, 0.35, 5]) {
    assert.equal(ArmadoGuirnaldaV1Schema.parse({ ...ARMADO, forma: "curva", arqueo_m: arqueo }).arqueo_m, arqueo);
  }
  for (const arqueo of [0, -0.3, 5.01, Number.NaN]) {
    assert.equal(ArmadoGuirnaldaV1Schema.safeParse({ ...ARMADO, forma: "curva", arqueo_m: arqueo }).success, false, `arqueo_m ${String(arqueo)}`);
  }
  assert.equal("arqueo_m" in ArmadoGuirnaldaV1Schema.parse(ARMADO), false, "sin arqueo no aparece: el plan firmado es el de antes");
  // La lectura dice el sentido de la curva y su flecha, relativa al largo (nunca metros).
  const lectura = { soporte: "pared", forma: "curva", racimos_visibles: 12, colores_por_racimo: [], relleno: null, remates: [], confianza: 0.8 } as const;
  assert.ok(LecturaGuirnaldaSchema.safeParse({ ...lectura, sentido_curva: "arriba", flecha_relativa: 0.1, desnivel_relativo: -0.25 }).success);
  assert.ok(LecturaGuirnaldaSchema.safeParse({ ...lectura, sentido_curva: null, flecha_relativa: null }).success);
  assert.ok(LecturaGuirnaldaSchema.safeParse({ ...lectura, caida_relativa: 0.2 }).success, "una lectura v2 guardada sigue valiendo");
  assert.ok(LecturaGuirnaldaSchema.safeParse(lectura).success, "y una de antes de la decisión 27");
  for (const mala of [{ sentido_curva: "lados" }, { flecha_relativa: 0.61 }, { flecha_relativa: -0.1 }, { arqueo_m: 0.3 }]) {
    assert.equal(LecturaGuirnaldaSchema.safeParse({ ...lectura, ...mala }).success, false, JSON.stringify(mala));
  }
  ok("decisión 28: arqueo_m opcional y positivo; la lectura trae sentido_curva y flecha_relativa, y las lecturas v2 siguen valiendo");

  // ---------------------------------------------------------------------------
  const esquema = JSON.stringify(z.toJSONSchema(ArmadoGuirnaldaV1Schema, { target: "draft-7" }));
  assert.doesNotMatch(esquema, /"default"/, "ningún default llega al contrato que firma plan_hash");
  const contrato = JSON.parse(readFileSync(path.join(process.cwd(), "contracts/domain/v1/plan-decoracion.schema.json"), "utf8")) as {
    properties: { estructuras: { items: { properties: Json; required: string[] } } };
    "x-geometria-estructuras-oficiales": { guirnalda: { eje: string; formas: Record<string, { conCaida: boolean; factorPerfil: number }> } };
    "x-reglas-guirnalda": { soportesConCaida: string[]; formasConArqueo: string[] };
  };
  const estructura = contrato.properties.estructuras.items;
  assert.ok("armado_guirnalda" in estructura.properties && !estructura.required.includes("armado_guirnalda"));
  const geometria = contrato["x-geometria-estructuras-oficiales"].guirnalda;
  assert.equal(geometria.eje, "largo");
  assert.deepEqual(Object.entries(geometria.formas).filter(([, forma]) => forma.conCaida).map(([nombre]) => nombre), ["u_invertida", "arco_caido"]);
  assert.deepEqual(contrato["x-reglas-guirnalda"].soportesConCaida, ["pared", "colgada"], "dónde se cuelga y dónde un extremo va más alto: una sola regla para Python y el editor");
  assert.equal("soportesConCaida" in geometria, false, "la tabla de geometría no cambia (instantánea de los prompts sin armado)");
  const armadoExportado = estructura.properties.armado_guirnalda as { properties: Json };
  assert.deepEqual(armadoExportado.properties.desnivel_m, { type: "number", minimum: -5, maximum: 5 });
  assert.deepEqual(contrato["x-reglas-guirnalda"].formasConArqueo, ["curva"], "qué forma se arquea hacia arriba: una sola regla para Python y el editor");
  assert.deepEqual(armadoExportado.properties.arqueo_m, { type: "number", exclusiveMinimum: 0, maximum: 5 });
  ok("el contrato exportado lleva el campo opcional, la geometría por forma, los soportes con caída y el desnivel");

  // ---------------------------------------------------------------------------
  const estructuraPlan = {
    estructura_id: "EST_01_GUIRNALDA",
    nombre: "Guirnalda",
    tipo: "guirnalda",
    estructura_oficial: "guirnalda",
    rol_escena: "focal",
    ubicacion: "fondo_pared",
    medidas: { largo_m: 2.5 },
    repeticiones: 1,
    densidad: "media",
    mezcla: "organica_fina",
    materiales: [
      { product_id: "prod-rosado", color: "rosado", participacion: 0.6, rol_material: "principal" },
      { product_id: "prod-blanco", color: "blanco", participacion: 0.4, rol_material: "secundario" },
    ],
    porque: "Prueba.",
    armado_guirnalda: ARMADO,
  };
  const plan = {
    plan_version: "1.0",
    plan_id: "32323232-3232-4232-8232-323232323232",
    concepto: { titulo: "Prueba", descripcion: "Guirnalda.", paleta: ["rosado"] },
    espacio: { tipo: "salon", fuente: "cliente" },
    estructuras: [estructuraPlan],
    supuestos: [],
    referencia_omitida: [],
  };
  assert.deepEqual(PlanDecoracionSchema.parse(plan).estructuras[0]!.armado_guirnalda, ARMADO);
  assert.equal(PlanDecoracionSchema.safeParse({ ...plan, estructuras: [{ ...estructuraPlan, armado_guirnalda: { ...ARMADO, forma: "espiral" } }] }).success, false);
  assert.deepEqual(EstructuraPlan1_1Schema.parse(estructuraPlan).armado_guirnalda, ARMADO);
  ok("Plan 1.0 y 1.1 aceptan armado_guirnalda y rechazan uno mal formado");

  // ---------------------------------------------------------------------------
  const resueltos = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/fixtures/armado-guirnalda/resueltos.json"), "utf8")) as unknown[];
  assert.equal(resueltos.length, 3);
  for (const resuelto of resueltos) {
    const leido = ArmadoGuirnaldaResueltoSchema.parse(resuelto);
    assert.ok(leido.prompt_gemini.startsWith("GARLAND ASSEMBLY — "));
    assert.match(leido.prompt_lora, /^[\x20-\x7e]+$/, "LoRA en ASCII");
    assert.doesNotMatch(leido.prompt_lora, /\d/, "LoRA sin cifras");
    assert.equal(leido.duracion_estimada.estimado, true);
    const enLeyenda = leido.leyenda.reduce((suma, entrada) => suma + entrada.unidades_por_instancia, 0);
    assert.equal(enLeyenda, leido.globos_por_instancia);
  }
  const { planResueltoDesdePython } = await import("../../src/lib/plan/python-mapper");
  const mapeado = planResueltoDesdePython({ schema_version: "plan-resuelto.v1", estructuras: [], costes_por_estructura: [], armados_guirnalda: resueltos } as never);
  assert.deepEqual(mapeado.armados_guirnalda, resueltos);
  assert.ok(!("armados_guirnalda" in planResueltoDesdePython({ schema_version: "plan-resuelto.v1", estructuras: [], costes_por_estructura: [] } as never)));
  ok("lo que Python escribe cumple el Zod y el mapeador lo deja pasar tal cual");

  // ---------------------------------------------------------------------------
  const { featureEnabled } = await import("../../src/lib/ia/nucleo/feature-flags");
  const antes = process.env.GUIRNALDAS_ARMADO_V1;
  process.env.GUIRNALDAS_ARMADO_V1 = "false";
  assert.equal(featureEnabled("GUIRNALDAS_ARMADO_V1"), false, "apagada por defecto");
  process.env.GUIRNALDAS_ARMADO_V1 = "true";
  assert.equal(featureEnabled("GUIRNALDAS_ARMADO_V1"), true);
  process.env.GUIRNALDAS_ARMADO_V1 = "false";
  assert.equal(featureEnabled("GUIRNALDAS_ARMADO_V1"), false);
  if (antes === undefined) process.env.GUIRNALDAS_ARMADO_V1 = "false";
  else process.env.GUIRNALDAS_ARMADO_V1 = antes;
  ok("GUIRNALDAS_ARMADO_V1 arranca apagada");

  // ---------------------------------------------------------------------------
  const { llamarPythonPlanResolution, llamarPythonPlanEdit } = await import("../../src/lib/ia/nucleo/python-adapter");
  const cuerpos = instalarPython();
  const ids = { requestId: "22222222-2222-4222-8222-222222222222", correlationId: "22222222-2222-4222-8222-222222222222" };
  const base = { plan: {} as never, allowlist: [], catalogSnapshotId: "s", ...ids };
  await assert.rejects(llamarPythonPlanResolution(base));
  await assert.rejects(llamarPythonPlanResolution({ ...base, completarArmadosGuirnalda: true, completarArmadosDe: ["EST_01_GUIRNALDA"] }));
  assert.ok(!("completar_armados_guirnalda" in cuerpos[0]!), "sin la bandera la petición es la de siempre");
  assert.equal(cuerpos[1]!.completar_armados_guirnalda, true);
  assert.deepEqual(cuerpos[1]!.completar_armados_de, ["EST_01_GUIRNALDA"]);
  assert.ok(!("completar_armados" in cuerpos[1]!), "no enciende el armado de los bouquets");
  const edicion = { accion: "armado_guirnalda" as const, estructura_id: "EST_01_GUIRNALDA", armado_guirnalda: null };
  const edicionBase = { plan: {} as never, lineasBase: [], edicion, coloresVariante: [], completarPatrones: false, ...ids };
  await assert.rejects(llamarPythonPlanEdit(edicionBase));
  await assert.rejects(llamarPythonPlanEdit({ ...edicionBase, completarArmadosGuirnalda: true }));
  assert.ok(!("completar_armados_guirnalda" in cuerpos[2]!));
  assert.equal(cuerpos[3]!.completar_armados_guirnalda, true);
  assert.deepEqual(cuerpos[3]!.edicion, edicion);
  ok("completar_armados_guirnalda solo viaja cuando se pide (resolución y edición)");

  // ---------------------------------------------------------------------------
  const { EdicionArmadoGuirnaldaSchema } = await import("../../src/lib/plan/edicion-esquemas");
  assert.deepEqual(EdicionArmadoGuirnaldaSchema.parse(edicion), edicion);
  assert.equal(EdicionArmadoGuirnaldaSchema.parse({ ...edicion, armado_guirnalda: ARMADO }).armado_guirnalda?.soporte, "colgada");
  assert.equal(EdicionArmadoGuirnaldaSchema.safeParse({ ...edicion, armado_guirnalda: { version: "otra" } }).success, false);
  const { armadoQuitadoPorLaEdicion } = await import("../../src/lib/plan/aplicar-edicion");
  const con = { estructuras: [{ estructura_id: "EST_01_GUIRNALDA", armado_guirnalda: ARMADO }] };
  const sin = { estructuras: [{ estructura_id: "EST_01_GUIRNALDA" }] };
  assert.equal(armadoQuitadoPorLaEdicion(con, sin, "EST_01_GUIRNALDA", "armado_guirnalda"), true);
  assert.equal(armadoQuitadoPorLaEdicion(con, con, "EST_01_GUIRNALDA", "armado_guirnalda"), false);
  assert.equal(armadoQuitadoPorLaEdicion(sin, sin, "EST_01_GUIRNALDA", "armado_guirnalda"), false, "sin armado antes no hay nada que re-sugerir");
  assert.equal(armadoQuitadoPorLaEdicion(con, sin, "EST_01_GUIRNALDA"), false, "el de los bouquets es otro campo");
  ok("la acción armado_guirnalda y el re-sugerido solo de la pieza que lo perdió");

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
