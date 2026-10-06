/**
 * Fase 4 (FUERA del repo): el blueprint COMPLETO que produciría hoy la ruta /api/references/analyze para cada
 * análisis v18 de las capturas SIN etiquetas, sin llamar a ningún proveedor de visión: un ChatPort de repetición
 * devuelve la respuesta cruda guardada (`pases[0].args`). Repite el orden de la ruta:
 *   analizarReferenciasV2 -> leerLecturaUnica (valida en Python) -> medirColoresSempertex -> conReferenciasMedidas
 *   -> unificarPiezasEspejo.
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> --casos 1,2,3,4,5,6,7,8 --corridas 3
 * Necesita el servicio Python local (leerLecturaUnica). Escribe validacion-fase4/blueprints/case-00N-run-K.json.
 */
import { DATOS } from "../rutas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const LB = `${DATOS}/linea-base`;
const SALIDA = process.argv.includes("--salida") ? process.argv[process.argv.indexOf("--salida") + 1]! : `${DATOS}/validacion-fase4/blueprints`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };

async function main(): Promise<void> {
  delete process.env.DATABASE_URL;
  delete process.env.CATALOG_DATABASE_URL;
  (globalThis as { __ragPool?: unknown }).__ragPool = { query: async () => ({ rows: [], rowCount: 0 }), on: () => undefined, end: async () => undefined };
  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
  core.configurarPersistenciaTelemetria(undefined);
  const { analizarReferenciasV2 } = await imp("src/lib/ia/amaterasu/analizar-referencias-v2.ts");
  const { ReferenceBlueprintV2Schema } = await imp("src/lib/ia/referencia/reference-blueprint.ts");
  const { leerLecturaUnica } = await imp("src/lib/ia/amaterasu/lectura-unica.ts");
  const { medirColoresSempertex } = await imp("src/lib/ia/amaterasu/color-sempertex.ts");
  const { conReferenciasMedidas } = await imp("src/lib/plan/referencias-medidas.ts");
  const { unificarPiezasEspejo } = await imp("src/lib/ia/referencia/piezas-espejo.ts");
  const { conColoresDesdeElPie } = await imp("src/lib/ia/amaterasu/dominancia-referencia.ts");
  const { VARIANTE_RUTA_ANALISIS } = await imp("src/lib/ia/referencia/reference-structure.ts");
  mkdirSync(SALIDA, { recursive: true });
  const casos = arg("--casos", "1,2,3,4,5,6,7,8").split(",").map(Number);
  const corridas = Number(arg("--corridas", "3"));
  for (const c of casos) for (let k = 1; k <= corridas; k += 1) {
    const destino = `${SALIDA}/case-00${c}-run-${k}.json`;
    if (existsSync(destino)) continue;
    const crudo = JSON.parse(readFileSync(`${LB}/resultados/crudos-sin-etiquetas/${VARIANTE_RUTA_ANALISIS}/case-00${c}/run-${k}.json`, "utf8")) as { pases: Array<{ args: Record<string, unknown> | null }> };
    const argsCrudos = crudo.pases[0]!.args!;
    const imagen = { id: "REF_01", mime: "image/png" as const, base64: readFileSync(`${LB}/sin-etiquetas/case-00${c}-ref.png`).toString("base64"), descripcion: "Evaluation reference image." };
    let llamadasProveedor = 0;
    const chat = {
      id: "gemini", modelo: "gemini-3.6-flash", thinkingLevel: "low",
      turno: async (p: { herramientas: Array<{ nombre: string }> }) => { llamadasProveedor += 1; return { texto: "", llamadas: [{ nombre: p.herramientas[0]!.nombre, args: argsCrudos }], uso: { entrada: 0, salida: 0 }, modelo: "gemini-3.6-flash", finishReason: "STOP" }; },
      async *turnoStream() { throw new Error("no se usa"); },
    };
    const requestId = crypto.randomUUID();
    const analisis = await analizarReferenciasV2(chat, [imagen], [], "perceptual", { requestId, correlationId: requestId }, undefined, { variante: VARIANTE_RUTA_ANALISIS, forzarNuevoAnalisis: true }) as { blueprint: unknown; lecturasCrudas?: Record<string, Record<string, unknown>> };
    const bp = ReferenceBlueprintV2Schema.parse(analisis.blueprint);
    const conLecturas = await conColoresDesdeElPie(await leerLecturaUnica(bp, analisis.lecturasCrudas, [imagen], { requestId, correlationId: requestId }), [imagen]);
    const analisisColor = await medirColoresSempertex(conLecturas, [imagen]);
    const final = unificarPiezasEspejo(conReferenciasMedidas(conLecturas, analisisColor));
    writeFileSync(destino, JSON.stringify({ blueprint: final, lecturas_adjuntas: conLecturas !== bp, llamadas_a_proveedor: llamadasProveedor }, null, 1));
    const piezas = (final as { elements: Array<{ category: string; visual_semantics?: { structure_type?: string } }> }).elements.filter((e) => e.category === "balloon_structure").map((e) => e.visual_semantics?.structure_type).join("+");
    console.log(`caso ${c} corrida ${k}: piezas=${piezas} lecturas=${conLecturas !== bp} llamadas_proveedor=${llamadasProveedor}`);
  }
}

main().catch((e) => { console.error(`[regenerar-blueprint-v18] ${e instanceof Error ? e.stack : String(e)}`); process.exitCode = 1; });
