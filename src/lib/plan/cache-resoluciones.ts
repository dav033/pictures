import "server-only";
import { createHash } from "node:crypto";
import type { ResolucionPlan } from "./resolver-backend";
import type { PlanDecoracion } from "./tipos";

/**
 * Resoluciones que este mismo proceso acaba de firmar, para no volver a
 * resolver el plan base de la siguiente edición (ADR-0028, guardado
 * automático del editor de patrón).
 *
 * Editar la tarjeta resolvía dos veces: el plan base, para comprobar que su
 * `plan_hash` es el del token, y el plan editado. Cuando el decorador guarda
 * cambios seguidos, el plan base es exactamente el que la edición anterior
 * acaba de resolver y firmar aquí. Solo se reutiliza si el plan que llega es
 * idéntico (mismo contenido canónico, snapshot, allowlist y variantes LoRA):
 * entonces su hash es, por construcción, el que Python calculó. El token se
 * sigue verificando siempre, y el plan editado se sigue resolviendo en Python.
 *
 * Es memoria del proceso: con varias instancias o tras un reinicio la
 * búsqueda falla y se resuelve como siempre. No es un almacén durable.
 */

const MAX_ENTRADAS = 100;
const DURACION_MS = 10 * 60_000;

type Entrada = { clave: string; resolucion: ResolucionPlan; expira: number };

const entradas = new Map<string, Entrada>();

/** JSON con las claves ordenadas: el mismo plan da el mismo texto aunque llegue con otro orden. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    return `{${Object.keys(objeto).sort().filter((clave) => objeto[clave] !== undefined).map((clave) => `${JSON.stringify(clave)}:${canonico(objeto[clave])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export type ContextoResolucion = {
  plan: PlanDecoracion;
  catalogSnapshotId: string;
  allowlist: ReadonlyArray<{ product_id: string; variant_ids: readonly string[] }>;
  loraVariantIds?: readonly string[] | null;
};

/** Huella de todo lo que decide una resolución: el plan y contra qué catálogo se resolvió. */
export function claveResolucion(contexto: ContextoResolucion): string {
  const allowlist = [...contexto.allowlist]
    .map((entrada) => ({ product_id: entrada.product_id, variant_ids: [...entrada.variant_ids].sort() }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
  const lora = contexto.loraVariantIds ? [...contexto.loraVariantIds].sort() : null;
  return createHash("sha256")
    .update(canonico({ plan: contexto.plan, snapshot: contexto.catalogSnapshotId, allowlist, lora }))
    .digest("hex");
}

export function recordarResolucion(clave: string, resolucion: ResolucionPlan, ahora = Date.now()): void {
  const planHash = resolucion.resuelto.plan_hash;
  entradas.delete(planHash);
  entradas.set(planHash, { clave, resolucion: structuredClone(resolucion), expira: ahora + DURACION_MS });
  while (entradas.size > MAX_ENTRADAS) {
    const masVieja = entradas.keys().next().value;
    if (masVieja === undefined) break;
    entradas.delete(masVieja);
  }
}

/** La resolución firmada de `planHash`, solo si se hizo con exactamente esta clave y sigue vigente. */
export function resolucionRecordada(planHash: string, clave: string, ahora = Date.now()): ResolucionPlan | undefined {
  const entrada = entradas.get(planHash);
  if (!entrada) return undefined;
  if (entrada.expira <= ahora) {
    entradas.delete(planHash);
    return undefined;
  }
  return entrada.clave === clave ? structuredClone(entrada.resolucion) : undefined;
}

/** Para pruebas: cada caso parte sin resoluciones recordadas. */
export function olvidarResoluciones(): void {
  entradas.clear();
}
