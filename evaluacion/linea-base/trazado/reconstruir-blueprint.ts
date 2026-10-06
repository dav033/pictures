/**
 * Reconstruye el blueprint tal como lo entrega /api/references/analyze (FUERA del repo), a partir de lo que
 * guardo la linea base: blueprint crudo + lecturas crudas (v17) + la foto.
 *
 * La linea base solo aplico (medicion de color -> referencias medidas -> piezas espejo). Faltaba el paso que la
 * ruta ejecuta ANTES: `leerLecturaUnica` (validacion en Python, sin proveedor) que adjunta a cada elemento su
 * patron de color, su conteo y el armado de la guirnalda (`appearance.patron_color`, `.conteo`,
 * `.armado_guirnalda`), y refina la ubicacion de las guirnaldas. Aqui se repite el orden exacto de la ruta
 * (src/app/api/references/analyze/route.ts:66-94):
 *   leerLecturaUnica -> medirColoresSempertex -> conReferenciasMedidas -> unificarPiezasEspejo.
 * Sin llamadas de pago: Python solo valida; la medicion de color es local sobre los pixeles.
 */
import { DATOS } from "../../rutas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const LB = `${DATOS}/linea-base`;
const SALIDA = `${LB}/trazado/blueprint-app`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);

async function main(): Promise<void> {
  delete process.env.DATABASE_URL;
  delete process.env.CATALOG_DATABASE_URL;
  (globalThis as { __ragPool?: unknown }).__ragPool = { query: async () => ({ rows: [], rowCount: 0 }), on: () => undefined, end: async () => undefined };
  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
  core.configurarPersistenciaTelemetria(undefined);
  const { ReferenceBlueprintV2Schema } = await imp("src/lib/ia/referencia/reference-blueprint.ts");
  const { leerLecturaUnica } = await imp("src/lib/ia/amaterasu/lectura-unica.ts");
  const { medirColoresSempertex } = await imp("src/lib/ia/amaterasu/color-sempertex.ts");
  const { conReferenciasMedidas } = await imp("src/lib/plan/referencias-medidas.ts");
  const { unificarPiezasEspejo } = await imp("src/lib/ia/referencia/piezas-espejo.ts");
  mkdirSync(SALIDA, { recursive: true });
  const filas: string[] = [];
  for (let c = 1; c <= 8; c += 1) for (let k = 1; k <= 3; k += 1) {
    const crudo = JSON.parse(readFileSync(`${LB}/resultados/crudos/v17-lectura-unica/case-00${c}/run-${k}.json`, "utf8")) as { blueprint: unknown; lecturasCrudas: Record<string, Record<string, unknown>> | null; blueprint_post: unknown };
    const bytes = readFileSync(`${LB}/case-00${c}-ref.png`).toString("base64");
    const imagen = { id: "REF_01", mime: "image/png" as const, base64: bytes, descripcion: "Evaluation reference image." };
    const requestId = crypto.randomUUID();
    const bp = ReferenceBlueprintV2Schema.parse(crudo.blueprint);
    const conLecturas = await leerLecturaUnica(bp, crudo.lecturasCrudas ?? undefined, [imagen], { requestId, correlationId: requestId });
    const lecturasAdjuntas = conLecturas !== bp;
    const analisisColor = await medirColoresSempertex(conLecturas, [imagen]);
    const final = unificarPiezasEspejo(conReferenciasMedidas(conLecturas, analisisColor));
    writeFileSync(`${SALIDA}/case-00${c}-run-${k}.json`, JSON.stringify({ blueprint: final, lecturas_adjuntas: lecturasAdjuntas, analisisColor }, null, 1));
    const resumen = (final as { elements: Array<{ element_id: string; category: string; appearance: Record<string, unknown> }> }).elements
      .filter((e) => e.category === "balloon_structure")
      .map((e) => `${e.element_id}[patron=${(e.appearance.patron_color as { modo?: string } | undefined)?.modo ?? "-"} conteo=${e.appearance.conteo ? "si" : "-"} guirnalda=${e.appearance.armado_guirnalda ? "si" : "-"} incl=${e.appearance.inclinacion ?? "-"}]`).join(" ");
    filas.push(`case-00${c} run-${k} lecturas_adjuntas=${lecturasAdjuntas} ${resumen}`);
    console.log(filas[filas.length - 1]);
  }
}

main().catch((e) => { console.error(`[reconstruir-blueprint] ${e instanceof Error ? e.stack : String(e)}`); process.exitCode = 1; });
