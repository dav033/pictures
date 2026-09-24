import { guardarAjusteGlobal, proveedoresDisponibles } from "@/lib/ia/nucleo/registro";
import type { ProveedorId } from "@/lib/ia/nucleo/tipos";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { z } from "zod";

type Body = {
  proveedor: ProveedorId;
  /** "cliente" → cookie de sesión. "admin" → ajuste global persistido. */
  alcance: "cliente" | "admin";
};

const BodySchema = z.object({
  proveedor: z.literal("gemini"),
  alcance: z.enum(["cliente", "admin"]),
}).strict() satisfies z.ZodType<Body>;

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });

  let body: Body;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Solicitud de proveedor inválida." }, { status: 400 });
  }
  const { proveedor, alcance } = body;

  if (proveedor !== "gemini") {
    return Response.json({ error: "Proveedor inválido." }, { status: 400 });
  }
  if (!proveedoresDisponibles().includes(proveedor)) {
    return Response.json({ error: `No hay llave configurada para ${proveedor}.` }, { status: 409 });
  }

  if (alcance === "admin") {
    guardarAjusteGlobal(proveedor);
    return Response.json({ ok: true, alcance: "admin", proveedor });
  }

  const respuesta = Response.json({ ok: true, alcance: "cliente", proveedor });
  respuesta.headers.set(
    "Set-Cookie",
    `ia_proveedor=${proveedor}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`,
  );
  return respuesta;
}
