/**
 * Planes resueltos congelados para los tests que sólo necesitaban un
 * `PlanResuelto` como entrada.
 *
 * Por qué existe. Media docena de scripts llamaba a `resolverPlan` y a
 * `estimateFromPlan` como fábrica de fixtures: lo que prueban es otra cosa —el
 * prompt de imagen, el QA visual, el caption LoRA, el desglose, la calibración
 * de creatividad—, no el resolutor. El paso 5 del ADR-0023 deja a Python como
 * único dueño de las reglas de conteo y borra ese resolutor TypeScript.
 * Sustituirlo por una llamada al servicio Python volvería estas pruebas
 * dependientes de red y de un proceso levantado, cuando hoy corren offline y
 * son deterministas.
 *
 * Qué hay aquí. Un plan resuelto y su estimado de materiales por escenario, en
 * `scripts/fixtures/planes-fijados/`, escritos una sola vez con la forma exacta
 * que el resolutor producía para ese escenario declarado y fijados desde
 * entonces: son datos, no una segunda implementación de las reglas. Cambiar uno
 * es editar su JSON a mano, igual que el bloque `expected` de un vector dorado
 * desde el paso 3 del mismo ADR. Se separan del código por la regla de
 * `AGENTS.md` ("Separate executable logic, generated data, fixtures, and runtime
 * artifacts"); el módulo que los lee no tiene CLI ni efectos al cargar.
 *
 * Qué NO son. No son un oráculo de conteo: ningún test de aquí afirma que el
 * total de globos de un escenario sea el correcto. Ese cerrojo son los 28
 * vectores dorados de `contracts/domain/v1/golden/plan-resolution/`, que
 * ejercita el pytest del resolutor Python (`test_plan_parity.py`).
 *
 * Cómo se validan. `plan_resuelto` se repone con `schema_version` y un
 * `request_id` fijo, pasa por `PlanResueltoV1Schema` y por el mismo mapeador que
 * usa producción con las respuestas de Python (`planResueltoDesdePython`), en
 * vez de por un cast; `material_estimate` pasa por `MaterialEstimateSchema`. Un
 * fixture corrupto falla en el parseo, nombrando el campo, en lugar de propagar
 * basura hasta una aserción lejana.
 *
 * Lo que NO hace: emitir `approval_token`. Un plan congelado es una entrada de
 * prueba, no una propuesta aprobada.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PLAN_RESUELTO_CONTRACT_VERSION, PlanResueltoV1Schema } from "@/lib/ia/contracts/domain-v1";
import { MaterialEstimateSchema, type DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { REQUEST_ID_PLAN_FIJADO } from "./vectores-golden";

const DIRECTORIO_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "planes-fijados",
);

const PlanFijadoFileSchema = z.object({
  plan_resuelto: z.record(z.string(), z.unknown()),
  material_estimate: z.record(z.string(), z.unknown()),
}).strict();

export type PlanFijadoDeFixture = {
  plan: PlanResuelto;
  materialEstimate: DesignMaterialEstimate;
};

/**
 * El plan congelado de un escenario, por el nombre de su fichero sin extensión
 * (`"piezas-separadas"`). Falla nombrando los escenarios disponibles: un nombre
 * mal escrito en un test es un error del test, no un fixture que haya que
 * inventar.
 */
export function planFijado(nombre: string): PlanFijadoDeFixture {
  const fichero = join(DIRECTORIO_FIXTURES, `${nombre}.json`);
  let contenido: string;
  try {
    contenido = readFileSync(fichero, "utf8");
  } catch {
    const disponibles = readdirSync(DIRECTORIO_FIXTURES, { withFileTypes: true })
      .filter((entrada) => entrada.isFile() && entrada.name.endsWith(".json"))
      .map((entrada) => entrada.name.replace(/\.json$/, ""))
      .sort();
    throw new Error(`No existe el plan fijado "${nombre}". Disponibles: ${disponibles.join(", ")}`);
  }
  const { plan_resuelto: planResuelto, material_estimate: materialEstimate } =
    PlanFijadoFileSchema.parse(JSON.parse(contenido) as unknown);
  return {
    plan: planResueltoDesdePython(PlanResueltoV1Schema.parse({
      schema_version: PLAN_RESUELTO_CONTRACT_VERSION,
      request_id: REQUEST_ID_PLAN_FIJADO,
      ...planResuelto,
    })),
    materialEstimate: MaterialEstimateSchema.parse(materialEstimate),
  };
}
