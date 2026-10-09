import "server-only";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import {
  EspecClienteV1Schema, armarDesdeEspec, especDesdeIdeaGuardada, especDesdePropuesta, especHashDe, sobreDelMotor, sumarIdeaAEspec,
  type ConceptoPlan, type EspecClienteV1, type ResultadoCotizacionBom, type ResultadoMotorV1,
} from "@/lib/globos3d/motor/v1";
import { abrirContextoPlan, verificarTokenAprobacion } from "@/lib/plan/aprobacion";
import type { PlanIdeaGuardado } from "@/lib/plan/plan-de-idea";
import { CuerpoPlanMotorSchema, type CuerpoPlanMotor, type RazonFallback } from "./plan-contrato";
import type { RespuestaMotor } from "./tipos";

/**
 * Lógica de `POST /api/guiada/motor/plan` (REQ-007, fase 2): el plan de la vista guiada armado por el motor 3D y cotizado
 * con el servicio de precios de Python. Sin modelo y sin RAG: la propuesta y las ideas del catálogo ya traen sus piezas
 * y colores, y el motor cuenta. La bandera, la cotización y la auditoría se inyectan para probarla sin red ni base.
 *
 * Reglas:
 * - un plan NUEVO (propuesta, o idea sin plan) pide la bandera en `3d`; sumar una idea a un plan DEL MOTOR 3D sigue en el
 *   motor aunque la bandera haya cambiado (un plan conserva su motor);
 * - un token de Python (`backend: python`) se rechaza: cada plan tiene un solo dueño de sus cantidades;
 * - todo lo que impida el plan 3D es un fallo TIPADO (`fallback.razon`) y la vista resuelve por Python.
 */
export type DependenciasPlanMotor = {
  leerBandera: (request: Request) => Promise<RespuestaMotor>;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
  planGuardado: (ideaId: string) => PlanIdeaGuardado | null;
  cotizar: (bom: ResultadoMotorV1["bom"], solicitud: { requestId: string; signal: AbortSignal }) => Promise<ResultadoCotizacionBom>;
  nuevoId: () => string;
};

const SIN_CACHE = { "Cache-Control": "no-store" } as const;
const MAX_CARACTERES_CUERPO = 700_000;

function error(codigo: string, mensaje: string, estado: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: mensaje, codigo, ...extra }, { status: estado, headers: SIN_CACHE });
}

class FalloDelPlan extends Error {
  constructor(readonly razon: RazonFallback, readonly detalle?: string, readonly piezas?: Array<{ piezaId: string; motivo: string }>) { super(detalle ?? razon); }
}

const FRASE_POR_RAZON: Readonly<Record<RazonFallback, string>> = {
  bandera_python: "Este plan se arma con el motor de siempre.",
  no_representable: "Alguna pieza de este plan todavía no la arma el motor 3D.",
  sin_cobertura: "La tienda no vende algún globo de este plan en esa talla o color.",
  precio_fallido: "No pude cotizar los materiales de este plan.",
  sin_plan_guardado: "Esa idea no tiene un plan guardado.",
  tope_de_piezas: "Sumar esa idea pasaría del máximo de piezas de un plan.",
  sobre_invalido: "No pude armar el plan con el motor 3D.",
};

type BaseVerificada = { espec: EspecClienteV1; concepto: ConceptoPlan };

/** El plan vigente que se envía como base: token del motor 3D, firma y hash de la espec que trae. Nada de esto se toma del navegador sin comprobar. */
function verificarBase(base: NonNullable<CuerpoPlanMotor["base"]>): BaseVerificada | Response {
  const contexto = abrirContextoPlan(base.approval_token);
  if (!contexto || !verificarTokenAprobacion(base.approval_token, base.plan_hash)) return error("APROBACION_INVALIDA", "La aprobación del plan expiró o no corresponde a este plan.", 409);
  if (contexto.backend !== "globos3d") return error("PLAN_NO_ES_DEL_MOTOR_3D", "Este plan lo armó el motor de Python: el motor 3D no lo toca.", 409);
  const espec = EspecClienteV1Schema.safeParse((base as { espec?: unknown }).espec);
  const version = (base as { motor?: { version?: unknown } }).motor?.version;
  if (!espec.success || typeof version !== "string") return error("ESPEC_INVALIDA", "El plan no trae su especificación.", 400);
  // El token firma el hash de la espec: si el navegador la cambió, el hash ya no coincide.
  if (especHashDe(espec.data, version) !== base.plan_hash) return error("PLAN_ALTERADO", "El plan no corresponde a su aprobación.", 409);
  return { espec: espec.data, concepto: { titulo: base.plan.concepto.titulo, descripcion: base.plan.concepto.descripcion, ...(base.plan.concepto.estilo ? { estilo: base.plan.concepto.estilo } : {}), ...(base.plan.concepto.ocasion ? { ocasion: base.plan.concepto.ocasion } : {}) } };
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

function conceptoDePropuesta(cuerpo: Extract<CuerpoPlanMotor, { desde: "propuesta" }>, espec: EspecClienteV1): ConceptoPlan {
  const { brief, propuesta } = cuerpo;
  const nombres = [...new Set(espec.piezas.map((pieza) => pieza.nombre))];
  return {
    titulo: brief?.tematica ? mayuscula(brief.tematica) : nombres.length ? mayuscula(nombres.slice(0, 3).join(", ").toLocaleLowerCase("es")) : "Tu decoración",
    descripcion: propuesta.frase,
    ...(brief?.tematica ? { estilo: brief.tematica } : {}),
    ...(brief?.evento ? { ocasion: brief.evento } : {}),
  };
}

type Armado = { espec: EspecClienteV1; concepto: ConceptoPlan; nuevas: string[]; globosIdea: number | null; avisosConversion: string[] };

function armarEspec(cuerpo: CuerpoPlanMotor, base: BaseVerificada | null, deps: DependenciasPlanMotor): Armado {
  if (cuerpo.desde === "propuesta") {
    const { espec, avisos } = especDesdePropuesta(cuerpo.propuesta, cuerpo.brief);
    return { espec, concepto: conceptoDePropuesta(cuerpo, espec), nuevas: espec.piezas.map((pieza) => pieza.id), globosIdea: null, avisosConversion: avisos };
  }
  const guardado = deps.planGuardado(cuerpo.idea_id);
  if (!guardado) throw new FalloDelPlan("sin_plan_guardado", cuerpo.idea_id);
  const { espec: deLaIdea, avisos } = especDesdeIdeaGuardada(guardado.plan, cuerpo.idea_id);
  const concepto: ConceptoPlan = { titulo: guardado.plan.concepto.titulo, descripcion: guardado.plan.concepto.descripcion, ...(guardado.plan.concepto.estilo ? { estilo: guardado.plan.concepto.estilo } : {}), ...(guardado.plan.concepto.ocasion ? { ocasion: guardado.plan.concepto.ocasion } : {}) };
  if (!base) return { espec: deLaIdea, concepto, nuevas: deLaIdea.piezas.map((pieza) => pieza.id), globosIdea: guardado.globos, avisosConversion: avisos };
  const suma = sumarIdeaAEspec(base.espec, deLaIdea, cuerpo.idea_id);
  if (!suma.ok) throw new FalloDelPlan("tope_de_piezas", `máximo ${suma.maximo} piezas`);
  return { espec: suma.espec, concepto: base.concepto, nuevas: suma.nuevas, globosIdea: guardado.globos, avisosConversion: avisos };
}

export async function atenderPlanMotor(request: Request, deps: DependenciasPlanMotor): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return error("SESION_REQUERIDA", "Sesión requerida.", 401);
  const texto = await request.text().catch(() => "");
  if (!texto || texto.length > MAX_CARACTERES_CUERPO) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return error("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400); }
  const leido = CuerpoPlanMotorSchema.safeParse(json);
  if (!leido.success) return error("CUERPO_INVALIDO", "La solicitud no tiene un formato válido.", 400, { detalles: leido.error.issues.slice(0, 5).map((i) => ({ ruta: i.path.join("."), mensaje: i.message })) });
  const cuerpo = leido.data;
  const entrada = { desde: cuerpo.desde, conBase: Boolean(cuerpo.base), ...(cuerpo.desde === "idea" ? { idea_id: cuerpo.idea_id } : { piezas: cuerpo.propuesta.piezas.map((p) => p.estructura), colores: cuerpo.propuesta.colores }) };
  const inicio = Date.now();
  const bandera = await deps.leerBandera(request);

  const fallo = (razon: RazonFallback, detalle?: string, piezas?: Array<{ piezaId: string; motivo: string }>): Response => {
    deps.auditar("regla:motor_guiada", "plan de la guiada: el motor 3D no lo arma y se resuelve con Python", {
      bandera: bandera.motor, fuente: bandera.fuente, efectivo: "python", razon, ...(detalle ? { detalle } : {}), ...(piezas ? { piezas } : {}),
    }, { entrada, motivo: FRASE_POR_RAZON[razon] });
    return error(razon === "bandera_python" ? "MOTOR_PYTHON" : "PLAN_NO_ARMABLE_EN_3D", FRASE_POR_RAZON[razon], razon === "bandera_python" ? 409 : 422, { fallback: { razon, ...(detalle ? { detalle } : {}), ...(piezas ? { piezas } : {}) } });
  };

  let base: BaseVerificada | null = null;
  if (cuerpo.base) {
    const verificada = verificarBase(cuerpo.base);
    if (verificada instanceof Response) return verificada;
    base = verificada;
  } else if (bandera.motor !== "3d") {
    return fallo("bandera_python");
  }

  try {
    const { espec, concepto, nuevas, globosIdea, avisosConversion } = armarEspec(cuerpo, base, deps);
    const resultado = armarDesdeEspec(espec);
    if (resultado.noRepresentable.length) return fallo("no_representable", undefined, resultado.noRepresentable);
    const requestId = deps.nuevoId();
    const avisos = [...new Set([...avisosConversion, ...resultado.avisos])];
    const cotizada = await deps.cotizar(resultado.bom, { requestId, signal: request.signal });
    if (!cotizada.ok) {
      if (cotizada.razon === "sin_cobertura") return fallo("sin_cobertura", cotizada.faltantes.map((f) => `${f.formatoId} ${f.codigo}: ${f.motivo}`).join("; "));
      return fallo(cotizada.razon === "material_no_disponible" ? "sin_cobertura" : "precio_fallido", cotizada.detalle);
    }
    const sobre = sobreDelMotor({ espec, resultado: { ...resultado, avisos }, cotizacion: cotizada, concepto, requestId });
    if (!sobre.ok) return fallo("sobre_invalido", sobre.motivo);
    deps.auditar("regla:motor_guiada", "plan de la guiada armado por el motor 3D y cotizado con Python", {
      bandera: bandera.motor, fuente: bandera.fuente, efectivo: "3d", plan_hash: resultado.especHash, motor: resultado.motor,
      piezas: espec.piezas.map((p) => ({ id: p.id, oficial: p.oficial })), globos: resultado.bom.total.reduce((suma, l) => suma + l.cantidad, 0),
      lineas: cotizada.compras.length, total_cop: cotizada.total, snapshot: cotizada.snapshot, avisos, ms: Date.now() - inicio,
    }, { entrada });
    return Response.json({ plan: sobre.plan, cotizacion: sobre.cotizacion, nuevas, globosIdea, exacto: avisos.length === 0, avisos: avisos.slice(0, 4) }, { headers: SIN_CACHE });
  } catch (causa) {
    if (causa instanceof FalloDelPlan) return fallo(causa.razon, causa.detalle, causa.piezas);
    console.warn("[guiada-motor] no se pudo armar el plan con el motor 3D", causa instanceof Error ? causa.message : causa);
    deps.auditar("regla:motor_guiada", "plan de la guiada: error inesperado del motor 3D", { bandera: bandera.motor, fuente: bandera.fuente, efectivo: "python", razon: "error_inesperado", detalle: causa instanceof Error ? causa.message : "error" }, { entrada });
    return error("ERROR_DEL_MOTOR", "No pude armar el plan con el motor 3D.", 500);
  }
}
