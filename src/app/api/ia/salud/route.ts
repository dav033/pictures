import { connection } from "next/server";
import { MODELO_CHAT as MODELO_CHAT_GEMINI, MODELO_IMAGEN as MODELO_IMAGEN_GEMINI } from "@/lib/gemini";
import { obtenerAjusteGlobal, proveedoresDisponibles, resolverProveedor } from "@/lib/ia/registro";
import { ultimosEventos } from "@/lib/ia/telemetria";
import type { ProveedorId } from "@/lib/ia/tipos";
import { PLAN_DECORACION_ENABLED } from "@/lib/plan/flags";

const PROVEEDORES_CHAT = ["gemini"] as const satisfies readonly ProveedorId[];
const MODELOS: Record<(typeof PROVEEDORES_CHAT)[number], { chat: string; imagen: string }> = {
  gemini: { chat: MODELO_CHAT_GEMINI, imagen: MODELO_IMAGEN_GEMINI },
};

export async function GET() {
  // Sin esto, `cacheComponents` prerenderiza esta ruta en el build (no ve
  // el acceso a node:sqlite ni a process.env como "dinámico") y sirve ese
  // snapshot congelado — sin llaves, sin ajuste global, sin telemetría — a
  // todas las peticiones en producción.
  await connection();
  const disponibles = proveedoresDisponibles();
  const proveedores = PROVEEDORES_CHAT;

  // El mismo que resolvería una petición real sin override de cookie ni de
  // body: respeta IA_PROVEEDOR y el ajuste global, no solo "el primero que
  // haya en la lista fija".
  const predeterminado = disponibles.length ? resolverProveedor({}) : null;

  return Response.json({
    proveedores: proveedores.map((id) => ({
      id,
      disponible: disponibles.includes(id),
      modelo: MODELOS[id],
    })),
    ajusteGlobal: obtenerAjusteGlobal() ?? null,
    predeterminado,
    planDecoracionActivo: PLAN_DECORACION_ENABLED,
    telemetria: ultimosEventos().slice(0, 20),
  });
}
