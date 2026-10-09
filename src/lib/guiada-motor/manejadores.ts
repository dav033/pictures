import "server-only";
import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { exigirAdministradorMismoOrigen } from "@/lib/feedback-ia/acceso";
import { COOKIE_MOTOR } from "./bandera";
import { MotorGuiadaSchema, PARA_PLAN_NUEVO, type RespuestaMotor } from "./tipos";

/** Lógica de `/api/guiada/motor`, con la bandera y la auditoría inyectadas para probarla sin Neon ni registro. */
export type DependenciasMotor = {
  leer: (request: Request) => Promise<RespuestaMotor>;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown }) => void;
};

const SIN_CACHE = { "Cache-Control": "no-store" } as const;
const MAX_BYTES_CUERPO = 512;
const DURACION_COOKIE_S = 60 * 60 * 24 * 7;
const CuerpoSchema = z.object({ motor: z.union([MotorGuiadaSchema, z.literal("defecto")]) }).strict();

function error(codigo: string, mensaje: string, estado: number): Response {
  return Response.json({ error: mensaje, codigo }, { status: estado, headers: SIN_CACHE });
}

/**
 * GET: el motor con el que se crea un plan nuevo. Nunca se cachea (la página /asistente está prerenderizada y no lo
 * puede leer). Con `?para=plan_nuevo` la lectura queda en la auditoría de la conversación (`regla:motor_guiada`).
 */
export async function atenderLecturaMotor(request: Request, deps: DependenciasMotor): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return error("SESION_REQUERIDA", "Sesión requerida.", 401);
  const lectura = await deps.leer(request);
  if (new URL(request.url).searchParams.get("para") === PARA_PLAN_NUEVO) {
    deps.auditar("regla:motor_guiada", "motor con el que se crea el plan de la guiada (bandera de ejecución)", lectura, { entrada: { para: PARA_PLAN_NUEVO } });
  }
  return Response.json(lectura, { headers: SIN_CACHE });
}

/**
 * POST (solo administrador, mismo origen): fija la cookie `guiada_motor` de ESE navegador para probar el 3D en
 * producción sin tocar a los clientes. `defecto` la borra. La cookie solo vale mientras la sesión de administrador sea
 * válida (`leerMotorGuiada` la ignora sin ella).
 */
export async function atenderFijarMotor(request: Request): Promise<Response> {
  const acceso = exigirAdministradorMismoOrigen(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const texto = await request.text().catch(() => "");
  if (!texto || texto.length > MAX_BYTES_CUERPO) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return error("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400); }
  const cuerpo = CuerpoSchema.safeParse(json);
  if (!cuerpo.success) return error("CUERPO_INVALIDO", "motor debe ser «3d», «python» o «defecto».", 400);
  const { motor } = cuerpo.data;
  const seguro = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const atributos = `; Path=/; HttpOnly; SameSite=Strict; Max-Age=${motor === "defecto" ? 0 : DURACION_COOKIE_S}${seguro}`;
  const respuesta = Response.json({ ok: true, cookie: motor === "defecto" ? null : motor }, { headers: SIN_CACHE });
  respuesta.headers.append("set-cookie", `${COOKIE_MOTOR}=${motor === "defecto" ? "" : motor}${atributos}`);
  return respuesta;
}
