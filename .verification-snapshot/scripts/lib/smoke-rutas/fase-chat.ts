import { randomUUID } from "node:crypto";
import type { Contexto } from "./contexto";
import { esperarAuditoria } from "./evidencia-db";
import { PlanSmokeSchema, resumenPlan, verificarTokenPlan, type PlanSmoke } from "./plan";
import { extracto, prefijo, type Reporte } from "./reporte";
import { leerSse, secuenciaHerramientas, type ResultadoSse } from "./sse";

/**
 * P2: one real (paid, authorized) /api/chat conversation that must search the
 * catalog and confirm a plan through Python in the same request.
 */

const TIMEOUT_CHAT_MS = 180_000;

// Wording notes (observed 2026-09-14): "látex"/"fashion" become mandatory finish
// restrictions, "cumpleaños" pulls printed products without full size ranges,
// the lexical Python search answers NO_MATCH for long multi-color queries, and
// "arco"/"semiarco"/"guirnalda" in the request become the hard category filter
// guirnalda_arco, which excludes every latex balloon (NO_MATCH), so a column is used.
// All user turns of one conversation are joined into restricciones.texto_original,
// which the plan schema caps at 240 chars: longer conversations can never confirm.
const MAX_TEXTO_USUARIO = 240;
export const MENSAJE_INICIAL = "Quiero solo una columna de globos redondos blancos lisos para un salón. Sin preguntas: usa medidas por defecto, busca en el catálogo y confirma el plan de decoración.";
export const MENSAJE_SEGUIMIENTO = "Sí, confirma el plan con confirmar_plan_decoracion ya.";
export const MENSAJE_ALTERNATIVO = "Solo una columna de globos redondos blancos lisos para un salón. Busca \"blanco almendra\" en el catálogo y confirma el plan de decoración ya, sin preguntas.";

type Mensaje = { role: "user" | "assistant"; content: string };
type Intento = { mensajes: Mensaje[]; brief: Record<string, unknown>; etiqueta: string };

async function enviarTurno(ctx: Contexto, intento: Intento): Promise<{ status: number; contentType: string; requestIdHeader: string | null; sse: ResultadoSse | null; texto?: string }> {
  const body = { messages: intento.mensajes, brief: intento.brief };
  const textoUsuario = intento.mensajes.filter((m) => m.role === "user").map((m) => m.content).join(" ");
  ctx.reporte.check(`${intento.etiqueta} texto de usuario ≤ ${MAX_TEXTO_USUARIO} chars`, textoUsuario.length <= MAX_TEXTO_USUARIO, `chars=${textoUsuario.length}`);
  ctx.reporte.info(`REQ ${intento.etiqueta} POST /api/chat messages=[${intento.mensajes.map((m) => `${m.role}:${m.role === "user" ? JSON.stringify(m.content) : `<respuesta asistente ${m.content.length} chars>`}`).join(", ")}] brief=${JSON.stringify(intento.brief)}`);
  const response = await ctx.next.abrirStream("/api/chat", body, { "X-Correlation-ID": randomUUID(), "x-deadline-ms": "75000" }, TIMEOUT_CHAT_MS);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return { status: response.status, contentType, requestIdHeader: response.headers.get("x-request-id"), sse: null, texto: extracto(await response.text(), 300) };
  }
  return { status: response.status, contentType, requestIdHeader: response.headers.get("x-request-id"), sse: await leerSse(response) };
}

function ordenCorrecto(sse: ResultadoSse): boolean {
  const listas = sse.herramientas.filter((item) => item.estado === "lista").map((item) => item.nombre);
  const busqueda = listas.indexOf("buscar_catalogo_rag");
  const confirmacion = listas.lastIndexOf("confirmar_plan_decoracion");
  return busqueda >= 0 && confirmacion > busqueda;
}

export async function faseChat(ctx: Contexto): Promise<PlanSmoke> {
  const reporte: Reporte = ctx.reporte;
  const snapshotId = ctx.snapshotId;
  const intentos: Intento[] = [{ mensajes: [{ role: "user", content: MENSAJE_INICIAL }], brief: {}, etiqueta: "P2.chat intento 1" }];
  let plan: PlanSmoke | null = null;
  let sseFinal: ResultadoSse | null = null;

  for (let numero = 1; numero <= 3 && plan === null; numero += 1) {
    const intento = intentos[numero - 1]!;
    const resultado = await enviarTurno(ctx, intento);
    reporte.exigir(`P2.chat intento ${numero} HTTP 200 SSE`, resultado.status === 200 && resultado.sse !== null && resultado.requestIdHeader !== null, `status=${resultado.status} content-type=${resultado.contentType} x-request-id=${resultado.requestIdHeader ?? "(ausente)"}${resultado.texto ? ` body=${resultado.texto}` : ""}`);
    const sse = resultado.sse;
    if (!sse) break;
    reporte.check(`P2.chat intento ${numero} contrato SSE`, sse.erroresContrato.length === 0 && sse.terminales === 1, `frames=${sse.frames} deltas=${sse.deltasTexto} terminales=${sse.terminales}${sse.erroresContrato.length ? ` errores=${sse.erroresContrato.join(" | ")}` : ""}`);
    reporte.info(`P2.chat intento ${numero} herramientas=${secuenciaHerramientas(sse)} reply="${extracto(sse.fin?.reply)}"`);
    if (sse.error) {
      reporte.fail(`P2.chat intento ${numero} evento error`, `code=${sse.error.code} causa=${sse.error.causa ?? "-"} error=${extracto(sse.error.error, 200)}`);
    }
    const planRaw: unknown = sse.fin ? sse.fin.plan : undefined;
    if (sse.fin && planRaw !== undefined && planRaw !== null) {
      const parsed = PlanSmokeSchema.safeParse(planRaw);
      reporte.exigir(`P2.chat intento ${numero} fin.plan válido`, parsed.success, parsed.success ? resumenPlan(parsed.data) : parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "));
      plan = parsed.data;
      sseFinal = sse;
      break;
    }
    reporte.info(`P2.chat intento ${numero} sin plan en fin`);
    if (numero === 1 && sse.fin) {
      intentos.push({
        mensajes: [...intento.mensajes, { role: "assistant", content: sse.fin.reply.trim() || "(sin texto)" }, { role: "user", content: MENSAJE_SEGUIMIENTO }],
        brief: sse.fin.brief,
        etiqueta: "P2.chat intento 2 (segundo turno)",
      });
    } else {
      intentos.push({ mensajes: [{ role: "user", content: MENSAJE_ALTERNATIVO }], brief: {}, etiqueta: `P2.chat intento ${numero + 1} (mensaje alternativo)` });
    }
  }

  reporte.exigir("P2.chat plan confirmado", plan !== null && sseFinal !== null, plan ? resumenPlan(plan) : "ningún intento devolvió fin.plan (ver secuencias de herramientas arriba)");
  reporte.check("P2.chat buscar_catalogo_rag antes de confirmar_plan_decoracion", ordenCorrecto(sseFinal), secuenciaHerramientas(sseFinal));
  verificarTokenPlan(reporte, "P2.chat", plan, { snapshotId });
  reporte.check("P2.chat plan sin faltantes ni presupuesto excedido", plan.sin_cobertura.length === 0 && plan.comercial.estado !== "PRESUPUESTO_EXCEDIDO", `sin_cobertura=${plan.sin_cobertura.length} estado=${plan.comercial.estado}`);

  const filas = await esperarAuditoria(ctx.pool, { requestId: plan.request_id, planHash: plan.plan_hash, estados: ["VERIFICADO", "APROBACION_REQUERIDA"] });
  reporte.check("P2.chat plan_audit_log en PostgreSQL local", filas.length > 0, filas.length ? `status=${filas[0]!.status} plan_hash=${prefijo(filas[0]!.plan_hash)}` : "sin fila: Next no escribe en el DATABASE_URL loopback");
  return plan;
}
