import { guardarAjusteGlobal, proveedoresDisponibles } from "@/lib/ia/registro";
import type { ProveedorId } from "@/lib/ia/tipos";

type Body = {
  proveedor: ProveedorId;
  /** "cliente" → cookie de sesión. "admin" → ajuste global persistido. */
  alcance: "cliente" | "admin";
};

export async function POST(request: Request) {
  const { proveedor, alcance }: Body = await request.json();

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
