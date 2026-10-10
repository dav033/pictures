import "server-only";
import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { exigirEscritura } from "@/lib/feedback-ia/acceso";
import {
  aplicarEdiciones, CambioPanelV1Schema, edicionDesdeCambio, edicionDesdePedido, EdicionesEspecSchema, especDesdeIdeaGuardada, sobreDelMotor,
  type ConceptoPlan, type EdicionEspecV1, type EdicionesDePedido, type EspecClienteV1, type ResultadoCotizacionBom, type ResultadoMotorV1,
} from "@/lib/globos3d/motor/v1";
import type { TomaDeFoto } from "@/lib/globos3d/tope-fotos-hora";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { PedidoEdicionPlanSchema } from "@/lib/ia/guiado/edicion-plan-chat";
import type { PlanIdeaGuardado } from "@/lib/plan/plan-de-idea";
import type { CodigoFalloEditar, RespuestaEditarMotor } from "./editar-contrato";
import { noPudeDeMotivos, TEXTO_EDICION_RECALCULO, unirNoPude } from "./mensajes-cliente";
import { planDel3dVencido } from "./continuidad";
import { huellaDeNavegador } from "./plan-motor";
import type { RespuestaMotor } from "./tipos";
import { verificarPlanConConcepto } from "./verificar-plan";

/**
 * Lógica de `POST /api/guiada/motor/editar` (REQ-007, fase 5): los cambios del cliente a un plan del motor 3D. Sin modelo y
 * sin RAG: la edición (operaciones sobre la espec, un pedido del chat o un cambio del panel) se aplica a la espec firmada,
 * se vuelve a armar (solo las piezas que cambiaron: el resto sale de la caché de piezas), se cotiza con Python (precios) y
 * se devuelve el plan nuevo con su token nuevo, atado al mismo navegador. La bandera, el armado, la cotización y la
 * auditoría se inyectan para probarla sin red ni base.
 *
 * Reglas:
 * - la bandera NO manda aquí: decide el motor de los planes nuevos, y este plan ya es del 3D, así que se sigue cambiando y
 *   cotizando en el 3D hasta el final de la conversación aunque la bandera vuelva a `python` (marcha atrás ordenada, P-045);
 * - el corte del 3D (`fuente: "corte"`) sí: responde 409 (`fallback.razon` = `motor_3d_cortado`) sin verificar el plan ni
 *   cotizar, con la frase que avisa al cliente de que habría que recalcularlo y que el precio puede cambiar; la vista lo
 *   muestra como `FalloMotor3dApagado` y el plan queda como estaba. Igual con `plan_3d_vencido`: con la bandera en `python`,
 *   una línea del 3D que empezó hace más de 24 h (`continuidad.ts`) ya no se cambia en el 3D;
 * - un navegador tiene un cupo por hora de cambios (429, `LIMITE_EDICIONES`), para que uno solo no arme sin fin;
 * - el plan se verifica como en todas las rutas del 3D (`verificar-plan.ts`): token, que sea `globos3d`, de este navegador
 *   y con la espec que el token firmó;
 * - nunca dice algo que no pasó (D-023): lo que no se pudo vuelve como «No pude: …» con un código estable, en palabras de
 *   cliente (sin códigos de formato ni jerga del armado: el motivo técnico queda en la auditoría), y el plan que el cliente
 *   tiene no se toca;
 * - un cambio que deja una pieza que el motor no arma, o que la tienda no vende, se rechaza entero: aquí no hay Python al
 *   que caer.
 */
export type DependenciasEditarMotor = {
  leerBandera: (request: Request) => Promise<RespuestaMotor>;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
  armar: (espec: EspecClienteV1) => ResultadoMotorV1;
  planGuardado: (ideaId: string) => PlanIdeaGuardado | null;
  cotizar: (bom: ResultadoMotorV1["bom"], solicitud: { requestId: string; signal: AbortSignal }) => Promise<ResultadoCotizacionBom>;
  nuevoId: () => string;
  /** El cupo por hora de cambios de este navegador (`tope-imagenes-navegador.ts`, el mismo mecanismo que la imagen). */
  tomarEdicion: (navegador: string) => TomaDeFoto;
  /** Cuántas piezas armó y cuántas sacó de la caché el `armar` (para el registro); opcional. */
  estadisticasCache?: () => { aciertos: number; fallos: number };
};

/** Cambios por hora y por navegador: holgado para un cliente que ajusta su plan, corto para un bucle. */
export const TOPE_EDICIONES_POR_NAVEGADOR_HORA = 60;

const SIN_CACHE = { "Cache-Control": "no-store" } as const;
const MAX_CARACTERES_CUERPO = 700_000;
const MAX_DESCRIPCION = 160;

const CuerpoSchema = z.object({
  plan: PlanGuiadoSchema,
  turnoId: z.string().trim().min(1).max(100).optional(),
  edicion: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("ops"), ediciones: EdicionesEspecSchema }).strict(),
    z.object({ tipo: z.literal("pedido"), pedido: PedidoEdicionPlanSchema }).strict(),
    z.object({ tipo: z.literal("cambio"), cambio: CambioPanelV1Schema }).strict(),
  ]),
}).strict();

function error(codigo: CodigoFalloEditar, mensaje: string, estado: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: mensaje, codigo, ...extra }, { status: estado, headers: SIN_CACHE });
}

export async function atenderEditarMotor(request: Request, deps: DependenciasEditarMotor): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return error("SESION_REQUERIDA", "Sesión requerida.", 401);
  // La identidad del navegador (cookie aleatoria por navegador): ata el token del plan al navegador que lo pidió.
  const acceso = exigirEscritura(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  return acceso.conCookie(await atender(request, deps, huellaDeNavegador(acceso.usuarioId)));
}

const mayuscula = (texto: string): string => texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);

/** La línea corta de «Último ajuste»: lo hecho, sin pasar de `MAX_DESCRIPCION` ni cortar a media frase. */
function acotarDescripcion(hechas: readonly string[]): string {
  let dicho = hechas[0] ?? "";
  for (const hecha of hechas.slice(1)) {
    if (`${dicho}; ${hecha}`.length > MAX_DESCRIPCION) return `${dicho}; …`.slice(0, MAX_DESCRIPCION);
    dicho = `${dicho}; ${hecha}`;
  }
  return dicho.length > MAX_DESCRIPCION ? `${dicho.slice(0, MAX_DESCRIPCION - 1).trimEnd()}…` : dicho;
}

function confirmacionDe(hechas: readonly string[], noAplicadas: readonly string[]): string {
  const hecho = hechas.join("; ");
  return noAplicadas.length ? `Listo: ${hecho}. ${noAplicadas.join(" ")}` : `Listo: ${hecho}; lo demás quedó igual.`;
}

function aEdiciones(cuerpo: z.infer<typeof CuerpoSchema>, espec: EspecClienteV1): EdicionesDePedido {
  switch (cuerpo.edicion.tipo) {
    case "ops": return { ok: true, ediciones: cuerpo.edicion.ediciones, avisos: [] };
    case "pedido": return edicionDesdePedido(espec, cuerpo.edicion.pedido);
    case "cambio": return edicionDesdeCambio(espec, cuerpo.edicion.cambio);
  }
}

const resumenDe = (ediciones: readonly EdicionEspecV1[]): string[] => ediciones.map((e) => e.op);

async function atender(request: Request, deps: DependenciasEditarMotor, navegador: string): Promise<Response> {
  const texto = await request.text().catch(() => "");
  if (!texto || texto.length > MAX_CARACTERES_CUERPO) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return error("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400); }
  const leido = CuerpoSchema.safeParse(json);
  if (!leido.success) return error("CUERPO_INVALIDO", "La solicitud no tiene un formato válido.", 400, { detalles: leido.error.issues.slice(0, 5).map((i) => ({ ruta: i.path.join("."), mensaje: i.message })) });
  const cuerpo = leido.data;
  const inicio = Date.now();
  const bandera = await deps.leerBandera(request);
  const entrada = { via: cuerpo.edicion.tipo, plan_hash: cuerpo.plan.plan_hash, ...(cuerpo.edicion.tipo === "ops" ? { ops: resumenDe(cuerpo.edicion.ediciones) } : cuerpo.edicion.tipo === "pedido" ? { pedido: cuerpo.edicion.pedido } : { cambio: cuerpo.edicion.cambio }) };
  // `extra` va a la respuesta; `auditoria` solo al registro (los motivos técnicos del motor no llegan al cliente).
  const rechazar = (codigo: CodigoFalloEditar, mensaje: string, estado: number, motivo: string, extra: Record<string, unknown> = {}, auditoria: Record<string, unknown> = {}): Response => {
    deps.auditar("regla:motor_guiada", "edición del plan 3D: no se aplica y el plan queda como estaba", { bandera: bandera.motor, fuente: bandera.fuente, codigo, motivo, ...extra, ...auditoria }, { entrada, motivo: mensaje });
    return error(codigo, mensaje, estado, extra);
  };

  if (bandera.fuente === "corte") {
    deps.auditar("regla:motor_guiada", "edición del plan 3D: el motor 3D está cortado; el plan no cambia y el cliente lee que habría que recalcularlo", { bandera: bandera.motor, fuente: bandera.fuente, efectivo: "ninguno", razon: "motor_3d_cortado" }, { entrada, motivo: TEXTO_EDICION_RECALCULO });
    return error("MOTOR_3D_CORTADO", TEXTO_EDICION_RECALCULO, 409, { fallback: { razon: "motor_3d_cortado" } });
  }
  const cupo = deps.tomarEdicion(navegador);
  if (!cupo.ok) return rechazar("LIMITE_EDICIONES", "No pude: hiciste demasiados cambios en una hora. Espera un rato y vuelve a intentarlo; tu plan sigue como estaba.", 429, "tope_por_navegador", { tope: cupo.tope });
  const base = verificarPlanConConcepto(cuerpo.plan, navegador);
  if ("codigo" in base) {
    // Una aprobación que ya no sirve (vencida tras 24 h sin cambios, de otro navegador): en palabras de cliente, con el recálculo.
    if (base.codigo === "APROBACION_INVALIDA") return rechazar(base.codigo, TEXTO_EDICION_RECALCULO, base.estado, base.motivo, { fallback: { razon: "aprobacion_invalida" } });
    return rechazar(base.codigo, base.mensaje, base.estado, base.motivo);
  }
  if (planDel3dVencido(bandera, base.origenEn, Date.now())) return rechazar("PLAN_3D_VENCIDO", TEXTO_EDICION_RECALCULO, 409, "plan_3d_vencido", { fallback: { razon: "plan_3d_vencido" } }, { origen_en: base.origenEn });

  try {
    const mapeo = aEdiciones(cuerpo, base.espec);
    if (!mapeo.ok) return rechazar(mapeo.tipo === "no_soportado" ? "EDICION_NO_SOPORTADA" : "EDICION_NO_APLICADA", mapeo.mensaje, 422, mapeo.motivo, { noAplicadas: [mapeo.mensaje] });
    const hecho = aplicarEdiciones(base.espec, mapeo.ediciones, { idea: (ideaId) => {
      const guardado = deps.planGuardado(ideaId);
      return guardado ? especDesdeIdeaGuardada(guardado.plan, ideaId).espec : null;
    } });
    if (!hecho.aplicadas) return rechazar("EDICION_NO_APLICADA", hecho.noAplicadas.length ? unirNoPude(hecho.noAplicadas) : "No pude: ese cambio no cambió nada en tu plan.", 422, "ninguna_edicion_aplicada", { noAplicadas: hecho.noAplicadas, avisos: hecho.avisos });

    const armado = deps.armar(hecho.espec);
    if (armado.noRepresentable.length) {
      const frase = noPudeDeMotivos(armado.noRepresentable.map((pieza) => pieza.motivo));
      return rechazar("EDICION_NO_ARMABLE", frase, 422, "no_representable", { noAplicadas: [frase] }, { piezas: armado.noRepresentable });
    }
    const requestId = deps.nuevoId();
    const cotizada = await deps.cotizar(armado.bom, { requestId, signal: request.signal });
    if (!cotizada.ok) {
      if (cotizada.razon === "sin_cobertura" || cotizada.razon === "material_no_disponible") {
        const faltantes = cotizada.razon === "sin_cobertura" ? cotizada.faltantes.map((f) => `${f.formatoId} ${f.codigo}`).join(", ") : "";
        return rechazar("SIN_COBERTURA", "No pude: la tienda no vende algún globo de ese cambio en esa talla o color.", 422, cotizada.razon, { noAplicadas: ["No pude: la tienda no vende algún globo de ese cambio en esa talla o color."] }, faltantes ? { faltantes } : {});
      }
      return rechazar("PRECIO_FALLIDO", "No pude: no logré calcular el precio de ese cambio. Tu plan sigue como estaba.", 422, cotizada.razon, { noAplicadas: ["No pude: no logré calcular el precio de ese cambio."] });
    }
    const concepto: ConceptoPlan = base.concepto;
    const sobre = sobreDelMotor({ espec: hecho.espec, resultado: armado, cotizacion: cotizada, concepto, requestId, navegador, origenEn: base.origenEn });
    if (!sobre.ok) return rechazar("ERROR_DEL_MOTOR", "No pude: ese cambio no cabe en el plan. Tu plan sigue como estaba.", 422, sobre.motivo);

    const descripcion = acotarDescripcion(hecho.hechas);
    const respuesta: RespuestaEditarMotor = {
      plan: sobre.plan,
      cotizacion: sobre.cotizacion,
      descripcion,
      confirmacion: mayuscula(confirmacionDe(hecho.hechas, hecho.noAplicadas)),
      avisos: [...new Set([...mapeo.avisos, ...hecho.avisos].map(mayuscula))].slice(0, 6),
      noAplicadas: hecho.noAplicadas,
      tocadas: hecho.tocadas,
      turno: {
        turnoId: cuerpo.turnoId ?? requestId,
        antes: { especHash: cuerpo.plan.plan_hash, espec: base.espec },
        despues: { especHash: armado.especHash, espec: hecho.espec },
      },
    };
    deps.auditar("regla:motor_guiada", "edición del plan 3D hecha por el cliente, armada solo en lo que cambió y cotizada con Python", {
      bandera: bandera.motor, fuente: bandera.fuente, efectivo: "3d", plan_hash_base: cuerpo.plan.plan_hash, plan_hash: armado.especHash, motor: armado.motor,
      turno_id: respuesta.turno.turnoId, hechas: hecho.hechas, no_aplicadas: hecho.noAplicadas, avisos: respuesta.avisos, tocadas: hecho.tocadas,
      globos: armado.bom.total.reduce((suma, linea) => suma + linea.cantidad, 0), total_cop: cotizada.total, snapshot_precios: cotizada.snapshot,
      ...(deps.estadisticasCache ? { cache_piezas: deps.estadisticasCache() } : {}), ms: Date.now() - inicio,
    }, { entrada });
    return Response.json(respuesta, { headers: SIN_CACHE });
  } catch (causa) {
    console.warn("[guiada-motor] no se pudo editar el plan con el motor 3D", causa instanceof Error ? causa.message : causa);
    deps.auditar("regla:motor_guiada", "edición del plan 3D: error inesperado del motor", { bandera: bandera.motor, fuente: bandera.fuente, razon: "error_inesperado", detalle: causa instanceof Error ? causa.message : "error" }, { entrada });
    return error("ERROR_DEL_MOTOR", "No pude: tuve un problema técnico al hacer ese cambio. Tu plan sigue como estaba.", 500);
  }
}
