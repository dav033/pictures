/**
 * Vectores dorados compartidos por los dos resolutores de plan.
 *
 * Cada vector de `contracts/domain/v1/golden/plan-resolution` describe un
 * catálogo, una allowlist same-turn y un Plan 1.0, y guarda dos expectativas:
 *
 * - `expected`: oráculo congelado, escrito a mano, en las formas que consume la
 *   UI (`PlanResuelto`, `DesignMaterialEstimate`, `Cotizacion`).
 * - `expected_python`: el payload `plan-resolution-result.v1` que produce el
 *   servicio Python, regenerado por `services/ai-api/tests/test_plan_parity.py`.
 *
 * Modos:
 * - por defecto, bloqueo de regresión del resolutor TypeScript contra `expected`;
 * - `--paridad`, compara los dos backends pasando la respuesta Python por el
 *   mapper de producción. Esa es la puerta para poder activar
 *   `PYTHON_BACKEND_ENABLED`: hoy pasa en los 28 vectores y corre en CI dentro
 *   de `plan:test` como `plan:test-paridad-python`, así que una deriva entre
 *   backends rompe el pipeline en vez de quedar verde.
 *
 * Este script ya no escribe vectores. Hasta el paso 3 del ADR-0023 tenía un
 * modo `--update` que recalculaba `expected` con el propio resolutor
 * TypeScript, así que `expected` no era un oráculo: era la salida de hoy del
 * código que decía vigilar, y cualquier cambio de conteo se legitimaba solo con
 * volver a correrlo. Ahora `expected` vale justo por haber salido de una
 * implementación independiente, y cambiarlo es editar el JSON del vector a
 * mano: un acto deliberado, que se lee en el diff y se revisa como cualquier
 * cambio de regla de negocio. Este script solo compara.
 *
 * Como consecuencia, nadie reescribe ya el archivo del vector desde aquí: los
 * flotantes enteros que escribe Python (`12.0`, que su pytest compara también
 * por tipo) sobreviven por construcción, y `PARIDAD_ACTUALIZAR=1 pytest
 * tests/test_plan_parity.py` puede correr cuando haga falta.
 *
 * Nada de esto necesita base de datos ni red: el catálogo del vector entra por
 * un doble del `Pool`, igual que en `scripts/test-resolver-plan.ts`.
 */
import assert from "node:assert/strict";
import { MaterialEstimateSchema, validateMaterialEstimate } from "../src/lib/materiales/estimacion";
import { cotizacionDesdePython, planResueltoDesdePython } from "../src/lib/plan/python-mapper";
import {
  formasDeUiDesdeTypeScript,
  isRecord,
  jsonCompatibleRecord,
  loadVectors,
  resolverVector,
  VECTORS_DIRECTORY,
  withoutNonDomainPlanFields,
  type GoldenExpected,
  type GoldenVector,
} from "./lib/vectores-golden";

/**
 * Campos deliberadamente fuera de la comparación de paridad, cada uno con su
 * razón. No son puntos ciegos: `assertCamposExcluidos` comprueba aparte que los
 * dos backends los producen bien formados.
 *
 * - `plan_hash`: el ADR 0006 lo define por backend. Un plan se re-resuelve con
 *   el backend que lo produjo, así que los dos hashes no tienen que coincidir;
 *   lo que sí tiene que coincidir es todo el valor comercial.
 * - `merma_log`: texto para una persona, no un valor comercial.
 */
const CAMPOS_FUERA_DE_PARIDAD = ["plan_hash", "merma_log"] as const;

type Diferencia = { path: string; expected: unknown; actual: unknown };

function formatValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

/**
 * Todas las diferencias, no solo la primera: lo útil de esta suite es la lista
 * completa de lo que falta para activar el backend Python, y quedarse en la
 * primera clave que difiere esconde el resto del informe.
 */
function allDifferences(expected: unknown, actual: unknown, path: string, sink: Diferencia[]): Diferencia[] {
  if (Object.is(expected, actual)) return sink;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) sink.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      allDifferences(expected[index], actual[index], `${path}[${index}]`, sink);
    }
    return sink;
  }
  if (isRecord(expected) && isRecord(actual)) {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      if (!(key in expected)) sink.push({ path: `${path}.${key}`, expected: undefined, actual: actual[key] });
      else if (!(key in actual)) sink.push({ path: `${path}.${key}`, expected: expected[key], actual: undefined });
      else allDifferences(expected[key], actual[key], `${path}.${key}`, sink);
    }
    return sink;
  }
  sink.push({ path, expected, actual });
  return sink;
}

function describirDiferencias(name: string, diferencias: readonly Diferencia[], izquierda: string, derecha: string): string {
  const detalle = diferencias
    .slice(0, 20)
    .map((item) => `    ${item.path}: ${izquierda}=${formatValue(item.expected)} ${derecha}=${formatValue(item.actual)}`)
    .join("\n");
  const extra = diferencias.length > 20 ? `\n    ... y ${diferencias.length - 20} más` : "";
  return `${name}: ${diferencias.length} diferencia(s)\n${detalle}${extra}`;
}

function assertGoldenMatch(name: string, expected: unknown, actual: unknown): void {
  const diferencias = allDifferences(expected, actual, "", []);
  if (diferencias.length === 0) return;
  throw new Error(describirDiferencias(name, diferencias, "esperado", "obtenido"));
}

function sinCamposExcluidos(valor: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(valor).filter(([key]) => !(CAMPOS_FUERA_DE_PARIDAD as readonly string[]).includes(key)),
  );
}

async function resolveWithTypeScript(vector: GoldenVector): Promise<GoldenExpected> {
  return formasDeUiDesdeTypeScript(await resolverVector(vector));
}

/**
 * Lo excluido de la comparación no queda sin comprobar: los dos backends deben
 * seguir produciendo un hash de plan bien formado y un log de merma legible.
 */
function assertCamposExcluidos(name: string, lado: string, plan: Record<string, unknown>): void {
  const hash = plan["plan_hash"];
  assert.ok(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash), `${name} (${lado}): plan_hash no es un sha256 hexadecimal`);
  const log = plan["merma_log"];
  assert.ok(typeof log === "string" && log.trim().length > 0, `${name} (${lado}): merma_log vacío`);
}

/**
 * Paridad real: la respuesta Python pasa por el mapper de producción y se
 * compara contra la salida TypeScript en las mismas formas que consume la UI.
 * Hacer la comparación aquí evita además el ruido de 12 frente a 12.0: el JSON
 * que emite Python se parsea a números de JavaScript.
 */
function compararParidad(vector: GoldenVector, expectedTs: GoldenExpected): void {
  const resultadoPython = vector.expected_python;
  if (!resultadoPython) {
    throw new Error(`${vector.name}: falta expected_python; regenéralo con PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py`);
  }
  const planPython = withoutNonDomainPlanFields(planResueltoDesdePython(resultadoPython.plan_resuelto));
  const cotizacionPython = jsonCompatibleRecord(cotizacionDesdePython(resultadoPython) as unknown as Record<string, unknown>);
  assertCamposExcluidos(vector.name, "typescript", expectedTs.plan_resuelto);
  assertCamposExcluidos(vector.name, "python", planPython);

  const diferencias: Diferencia[] = [];
  allDifferences(sinCamposExcluidos(expectedTs.plan_resuelto), sinCamposExcluidos(planPython), "plan_resuelto", diferencias);
  allDifferences(expectedTs.material_estimate, resultadoPython.material_estimate, "material_estimate", diferencias);
  allDifferences(sinCamposExcluidos(expectedTs.quote), sinCamposExcluidos(cotizacionPython), "cotizacion", diferencias);
  if (diferencias.length > 0) throw new Error(describirDiferencias(vector.name, diferencias, "typescript", "python"));

  // La estimación de Python atraviesa en producción la misma puerta que la de
  // TypeScript (`registro-herramientas.ts`), y esa puerta recalcula los totales
  // desde las líneas. Una estimación TypeScript no puede fallarla, porque la
  // construye con la misma función; la de Python sí, si una de las dos
  // definiciones cambia sin la otra. Hasta ahora ningún test la ejercía.
  const estimacionPython = MaterialEstimateSchema.parse(resultadoPython.material_estimate);
  const validacion = validateMaterialEstimate(estimacionPython);
  assert.ok(validacion.ok, `${vector.name}: la estimación de Python no pasa validateMaterialEstimate: ${validacion.errors.join("; ")}`);
}

const USO = "Usage: tsx --conditions=react-server scripts/test-paridad-plan-python.ts [--paridad]";

/**
 * Aquí vivía `--update`, que reescribía `expected` con la salida del resolutor
 * TypeScript. Se retiró en el paso 3 del ADR-0023: un oráculo que se regenera
 * desde el código que vigila no vigila nada.
 *
 * Para cambiar un `expected` a propósito, edita a mano el JSON del vector en
 * `contracts/domain/v1/golden/plan-resolution/` y explica en el commit por qué
 * el valor nuevo es el correcto. El bloque `expected_python` no se toca a mano:
 * lo escribe `PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py`.
 */
async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  if (argumentos.length > 1 || argumentos.some((argumento) => argumento !== "--paridad")) {
    throw new Error(USO);
  }
  const paridad = argumentos[0] === "--paridad";

  const vectors = loadVectors();
  if (vectors.length === 0) throw new Error(`No golden vectors found in ${VECTORS_DIRECTORY}`);

  const fallos: string[] = [];
  for (const { vector } of vectors) {
    const generated = await resolveWithTypeScript(vector);
    if (!vector.expected) {
      throw new Error(`${vector.name}: falta expected; escríbelo a mano en el JSON del vector (ADR-0023, paso 3)`);
    }
    assertGoldenMatch(vector.name, vector.expected, generated);
    if (!paridad) {
      console.log(`[PASS] ${vector.name}`);
      continue;
    }
    // En modo paridad se recorren todos los vectores antes de fallar.
    try {
      compararParidad(vector, vector.expected);
      console.log(`[PARIDAD OK] ${vector.name}`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      fallos.push(mensaje);
      console.log(`[PARIDAD FAIL] ${mensaje}`);
    }
  }
  if (fallos.length > 0) {
    throw new Error(`${fallos.length} vector(es) divergen entre el resolutor TypeScript y el Python.`);
  }
}

main().catch((error: unknown) => {
  console.error("[FAIL] plan parity golden vectors", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
