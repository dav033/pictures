/**
 * Brazo B (FUERA del repo): regenera el blueprint con el CODIGO NUEVO (UI-1a en `buildBlueprint`) a partir de la
 * MISMA respuesta cruda del analizador que guardo la linea base (`pases[0].args`), sin llamar a ningun proveedor:
 * un ChatPort de repeticion devuelve esos args como llamada de herramienta a `analizarReferenciasV2`.
 * Despues repite el orden de la ruta /api/references/analyze, igual que `reconstruir-blueprint.ts`:
 *   analizarReferenciasV2 -> leerLecturaUnica -> medirColoresSempertex -> conReferenciasMedidas -> unificarPiezasEspejo.
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> --casos 1,2
 * Escribe despues-ui1a-ui2/blueprint-regenerado/case-00N-run-K.json y un diff contra blueprint-app/.
 */
import { DATOS } from "../../../rutas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const LB = `${DATOS}/linea-base`;
const SALIDA = `${LB}/trazado/despues-ui1a-ui2/blueprint-regenerado`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };

function diff(a: unknown, b: unknown, ruta: string, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const claves = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of claves) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${ruta}.${k}`, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) { a.forEach((x, i) => diff(x, b[i], `${ruta}[${i}]`, out)); return; }
  out.push(`${ruta}: ${JSON.stringify(a)?.slice(0, 120)} -> ${JSON.stringify(b)?.slice(0, 120)}`);
}

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
  mkdirSync(SALIDA, { recursive: true });
  const casos = arg("--casos", "1,2").split(",").map(Number);
  const resumen: string[] = [];
  for (const c of casos) for (let k = 1; k <= 3; k += 1) {
    const crudo = JSON.parse(readFileSync(`${LB}/resultados/crudos/v17-lectura-unica/case-00${c}/run-${k}.json`, "utf8")) as { pases: Array<{ args: Record<string, unknown> | null }> };
    const argsCrudos = crudo.pases[0]!.args!;
    const imagen = { id: "REF_01", mime: "image/png" as const, base64: readFileSync(`${LB}/case-00${c}-ref.png`).toString("base64"), descripcion: "Evaluation reference image." };
    let llamadasProveedor = 0;
    const chat = {
      id: "gemini", modelo: "gemini-3.6-flash", thinkingLevel: "low",
      turno: async (p: { herramientas: Array<{ nombre: string }> }) => { llamadasProveedor += 1; return { texto: "", llamadas: [{ nombre: p.herramientas[0]!.nombre, args: argsCrudos }], uso: { entrada: 0, salida: 0 }, modelo: "gemini-3.6-flash", finishReason: "STOP" }; },
      async *turnoStream() { throw new Error("no se usa"); },
    };
    const requestId = crypto.randomUUID();
    const analisis = await analizarReferenciasV2(chat, [imagen], [], "perceptual", { requestId, correlationId: requestId }, undefined, { variante: "v17-lectura-unica", forzarNuevoAnalisis: true }) as { blueprint: unknown; lecturasCrudas?: Record<string, Record<string, unknown>> };
    const bp = ReferenceBlueprintV2Schema.parse(analisis.blueprint);
    const conLecturas = await leerLecturaUnica(bp, analisis.lecturasCrudas, [imagen], { requestId, correlationId: requestId });
    const analisisColor = await medirColoresSempertex(conLecturas, [imagen]);
    const final = unificarPiezasEspejo(conReferenciasMedidas(conLecturas, analisisColor));
    writeFileSync(`${SALIDA}/case-00${c}-run-${k}.json`, JSON.stringify({ blueprint: final, lecturas_adjuntas: conLecturas !== bp, analisisColor }, null, 1));
    const viejo = (JSON.parse(readFileSync(`${LB}/trazado/blueprint-app/case-00${c}-run-${k}.json`, "utf8")) as { blueprint: unknown }).blueprint;
    const d: string[] = [];
    diff(viejo, final, "blueprint", d);
    const inc = (final as { elements: Array<{ element_id: string; category: string; appearance: { inclinacion?: number } }> }).elements.filter((e) => e.category === "balloon_structure").map((e) => `${e.element_id}.inclinacion=${e.appearance.inclinacion ?? "ausente"}`).join(" ");
    resumen.push(`caso ${c} corrida ${k}: llamadas_a_proveedor=${llamadasProveedor} ${inc} | diferencias_vs_blueprint-app=${d.length}\n  ${d.slice(0, 12).join("\n  ")}`);
    console.log(resumen[resumen.length - 1]);
  }
  writeFileSync(`${SALIDA}/DIFF-vs-blueprint-app.txt`, resumen.join("\n"));
}

main().catch((e) => { console.error(`[regenerar-blueprint] ${e instanceof Error ? e.stack : String(e)}`); process.exitCode = 1; });
