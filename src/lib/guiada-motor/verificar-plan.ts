import "server-only";
import type { z } from "zod";
import { EspecClienteV1Schema, especHashDe, type ConceptoPlan, type EspecClienteV1 } from "@/lib/globos3d/motor/v1";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { abrirContextoPlan, verificarTokenAprobacion } from "@/lib/plan/aprobacion";

/**
 * Lo que toda ruta del motor 3D comprueba antes de fiarse de un plan que mandó el navegador (REQ-007): el token de
 * aprobación (firma, vigencia y hash), que sea del motor 3D, que lo haya pedido ESTE navegador y que la espec que trae
 * sea la que el token firmó. La comparten `/api/guiada/motor/plan` (la base de una suma o un rehacer) y
 * `/api/guiada/motor/armada` (la vista). Nada de esto se toma del navegador sin comprobar.
 */
export type PlanFirmado = { approval_token: string; plan_hash: string; espec?: unknown; motor?: { version?: unknown } };
export type RechazoPlan = { codigo: "APROBACION_INVALIDA" | "PLAN_NO_ES_DEL_MOTOR_3D" | "ESPEC_INVALIDA" | "PLAN_ALTERADO"; mensaje: string; estado: number; motivo: string };

export type PlanVerificado = { espec: EspecClienteV1; /** La hora del primer plan de su línea (`ContextoPlan.origenEn`). */ origenEn: number };

export function verificarPlanFirmado(plan: PlanFirmado, navegador: string): PlanVerificado | RechazoPlan {
  const contexto = abrirContextoPlan(plan.approval_token);
  if (!contexto || !verificarTokenAprobacion(plan.approval_token, plan.plan_hash)) return { codigo: "APROBACION_INVALIDA", mensaje: "La aprobación del plan expiró o no corresponde a este plan.", estado: 409, motivo: contexto ? "hash_distinto" : "token_invalido_o_vencido" };
  if (contexto.backend !== "globos3d") return { codigo: "PLAN_NO_ES_DEL_MOTOR_3D", mensaje: "Este plan lo armó el motor de Python: el motor 3D no lo toca.", estado: 409, motivo: `backend_${contexto.backend}` };
  if (contexto.navegador !== navegador) return { codigo: "APROBACION_INVALIDA", mensaje: "La aprobación del plan expiró o no corresponde a este plan.", estado: 409, motivo: contexto.navegador === null ? "token_sin_navegador" : "navegador_distinto" };
  const espec = EspecClienteV1Schema.safeParse(plan.espec);
  const version = plan.motor?.version;
  if (!espec.success || typeof version !== "string") return { codigo: "ESPEC_INVALIDA", mensaje: "El plan no trae su especificación.", estado: 400, motivo: "espec_ausente_o_invalida" };
  // El token firma el hash de la espec: si el navegador la cambió, el hash ya no coincide.
  if (especHashDe(espec.data, version) !== plan.plan_hash) return { codigo: "PLAN_ALTERADO", mensaje: "El plan no corresponde a su aprobación.", estado: 409, motivo: "hash_de_la_espec_distinto" };
  return { espec: espec.data, origenEn: contexto.origenEn };
}

/**
 * El plan vigente que el navegador manda como base (una suma, un rehacer o una edición): lo que comprueba
 * `verificarPlanFirmado` y, de él, el concepto (título y descripción) que el plan nuevo conserva.
 */
export function verificarPlanConConcepto(plan: z.infer<typeof PlanGuiadoSchema>, navegador: string): PlanVerificado & { concepto: ConceptoPlan } | RechazoPlan {
  const extra = plan as typeof plan & { espec?: unknown; motor?: { version?: unknown } };
  const firmado = verificarPlanFirmado({ approval_token: plan.approval_token, plan_hash: plan.plan_hash, espec: extra.espec, motor: extra.motor }, navegador);
  if ("codigo" in firmado) return firmado;
  const { concepto } = plan.plan;
  return { espec: firmado.espec, origenEn: firmado.origenEn, concepto: { titulo: concepto.titulo, descripcion: concepto.descripcion, ...(concepto.estilo ? { estilo: concepto.estilo } : {}), ...(concepto.ocasion ? { ocasion: concepto.ocasion } : {}) } };
}
