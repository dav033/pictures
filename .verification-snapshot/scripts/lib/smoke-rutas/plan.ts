import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { EntradaAllowlistPlan } from "../../../src/lib/plan/aprobacion";
import { prefijo, type Reporte } from "./reporte";
import { allowlistContieneA, allowlistTiene, contextoVerificado, decodificarPayload, tamanoAllowlist } from "./token";

/**
 * Runtime view of the PlanResuelto the routes return. Only the fields the smoke
 * reads are declared; everything else is kept (loose objects) so the plan can
 * be sent back to /api/plan-editar and /api/generate unchanged.
 */

const LineaSchema = z.looseObject({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  color: z.string().nullable().optional(),
  tamano_codigo: z.string().nullable().optional(),
  diam_pulg: z.number().nullable().optional(),
  forma: z.string().nullable().optional(),
});

export const PlanSmokeSchema = z.looseObject({
  plan: z.looseObject({
    estructuras: z.array(z.looseObject({
      estructura_id: z.string().min(1),
      tipo: z.string().min(1),
      materiales: z.array(z.looseObject({ product_id: z.string().min(1), variant_id: z.string().optional() })),
    })).min(1),
  }),
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/),
  approval_token: z.string().min(1),
  request_id: z.string().uuid(),
  estructuras: z.array(z.looseObject({ estructura_id: z.string().min(1), tipo: z.string(), lineas: z.array(LineaSchema) })).min(1),
  compras: z.array(z.looseObject({ product_id: z.string().min(1), variant_id: z.string().min(1) })).min(1),
  totales: z.looseObject({ total_cop: z.number() }),
  comercial: z.looseObject({ estado: z.string() }),
  sin_cobertura: z.array(z.unknown()),
});

export type PlanSmoke = z.infer<typeof PlanSmokeSchema>;
export type LineaSmoke = z.infer<typeof LineaSchema>;

export function resumenPlan(plan: PlanSmoke): string {
  return `plan_hash=${prefijo(plan.plan_hash)} request_id=${plan.request_id} total_cop=${plan.totales.total_cop} compras=${plan.compras.length} sin_cobertura=${plan.sin_cobertura.length} estado=${plan.comercial.estado}`;
}

export type ExpectativaToken = {
  snapshotId: string;
  requestId?: string;
  allowlistPrevia?: EntradaAllowlistPlan[];
  paresNuevos?: Array<{ product_id: string; variant_id: string }>;
};

/**
 * Verifies the signed provenance of a Python plan and returns its allowlist.
 * Assertions: v2, backend python, pinned snapshot, hash binding, request id,
 * unexpired, verifiable with the shared secret, and every purchase allowlisted.
 */
export function verificarTokenPlan(reporte: Reporte, nombre: string, plan: PlanSmoke, esperado: ExpectativaToken): EntradaAllowlistPlan[] {
  const payload = decodificarPayload(plan.approval_token);
  reporte.exigir(`${nombre}.token.v2`, payload !== null, payload ? "payload v2 decodificado" : "el token no decodifica como payload v2");
  reporte.check(`${nombre}.token.backend`, payload.backend === "python", `backend=${payload.backend}`);
  reporte.check(`${nombre}.token.snapshot`, payload.catalogSnapshotId === esperado.snapshotId, `catalogSnapshotId=${payload.catalogSnapshotId ?? "null"}`);
  reporte.check(`${nombre}.token.planHash`, payload.planHash === plan.plan_hash, `planHash=${prefijo(payload.planHash)} plan.plan_hash=${prefijo(plan.plan_hash)}`);
  reporte.check(`${nombre}.token.requestId`, payload.requestId === plan.request_id && (esperado.requestId === undefined || payload.requestId === esperado.requestId), `requestId=${payload.requestId}`);
  reporte.check(`${nombre}.token.expiresAt`, payload.expiresAt > Date.now(), `expira en ${Math.round((payload.expiresAt - Date.now()) / 60_000)} min`);
  reporte.check(`${nombre}.token.firma`, contextoVerificado(plan.approval_token) !== null, "abrirContextoPlan verifica con PLAN_APPROVAL_SECRET compartido");
  reporte.check(`${nombre}.token.allowlist`, payload.allowlist.length > 0, `pares=${tamanoAllowlist(payload.allowlist)} productos=${payload.allowlist.length}`);
  const faltantes = plan.compras.filter((compra) => !allowlistTiene(payload.allowlist, compra.product_id, compra.variant_id));
  reporte.check(`${nombre}.token.compras⊆allowlist`, faltantes.length === 0, faltantes.length ? `faltan ${faltantes.map((item) => item.variant_id).join(",")}` : `${plan.compras.length} compras cubiertas`);
  if (esperado.allowlistPrevia) {
    reporte.check(`${nombre}.token.allowlist⊇previa`, allowlistContieneA(payload.allowlist, esperado.allowlistPrevia), `previa=${tamanoAllowlist(esperado.allowlistPrevia)} nueva=${tamanoAllowlist(payload.allowlist)}`);
  }
  for (const par of esperado.paresNuevos ?? []) {
    reporte.check(`${nombre}.token.allowlist∋nueva`, allowlistTiene(payload.allowlist, par.product_id, par.variant_id), `${par.product_id}/${par.variant_id}`);
  }
  return payload.allowlist;
}

export function lineas(plan: PlanSmoke): Array<LineaSmoke & { estructura_id: string; tipo: string }> {
  return plan.estructuras.flatMap((estructura) => estructura.lineas.map((linea) => ({ ...linea, estructura_id: estructura.estructura_id, tipo: estructura.tipo })));
}

const EstadoSmokeSchema = z.object({
  schema_version: z.literal("smoke-rutas-python-local.state.v1"),
  saved_at: z.string(),
  snapshot_id: z.string().min(1),
  plan_chat: PlanSmokeSchema,
  plan: PlanSmokeSchema,
}).strict();

export type EstadoSmoke = z.infer<typeof EstadoSmokeSchema>;

export async function guardarEstado(ruta: string, estado: Omit<EstadoSmoke, "schema_version" | "saved_at">): Promise<void> {
  const completo: EstadoSmoke = { schema_version: "smoke-rutas-python-local.state.v1", saved_at: new Date().toISOString(), ...estado };
  await writeFile(ruta, `${JSON.stringify(completo, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function leerEstado(ruta: string): Promise<EstadoSmoke> {
  const raw: unknown = JSON.parse(await readFile(ruta, "utf8"));
  return EstadoSmokeSchema.parse(raw);
}
