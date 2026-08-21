import { z } from "zod";
import {
  actualizarCategoria,
  actualizarTipo,
  buscarProductosShopifyArquitectura,
  crearCategoria,
  crearTipo,
  eliminarCategoria,
  eliminarElemento,
  eliminarTipo,
  guardarElemento,
  obtenerArquitectura,
} from "@/lib/arquitectura";

const NivelSchema = z.enum(["component", "module", "composition"]);
const PresupuestoSchema = z.enum(["low", "mid", "high"]);

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_category"), nombre: z.string().trim().min(2).max(80), descripcion: z.string().max(280).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }),
  z.object({ action: z.literal("update_category"), id: z.string().min(1), nombre: z.string().trim().min(2).max(80), descripcion: z.string().max(280).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), activa: z.boolean().optional() }),
  z.object({ action: z.literal("delete_category"), id: z.string().min(1) }),
  z.object({ action: z.literal("create_type"), nombre: z.string().trim().min(2).max(80), nivel: NivelSchema, descripcion: z.string().max(280).optional() }),
  z.object({ action: z.literal("update_type"), id: z.string().min(1), nombre: z.string().trim().min(2).max(80), nivel: NivelSchema, descripcion: z.string().max(280).optional(), activo: z.boolean().optional() }),
  z.object({ action: z.literal("delete_type"), id: z.string().min(1) }),
  z.object({
    action: z.literal("save_element"),
    id: z.string().optional(),
    shopifyProductoId: z.string().min(1),
    tipoId: z.string().min(1),
    nombre: z.string().trim().max(120).optional(),
    categoriaIds: z.array(z.string()).max(30),
    presupuestos: z.array(PresupuestoSchema).max(3),
    notas: z.string().max(500).optional(),
    activo: z.boolean().optional(),
  }),
  z.object({ action: z.literal("delete_element"), id: z.string().min(1) }),
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "shopify") {
    const texto = url.searchParams.get("q") ?? "";
    return Response.json({ productos: buscarProductosShopifyArquitectura(texto) });
  }
  return Response.json(obtenerArquitectura());
}

export async function POST(request: Request) {
  try {
    const input = ActionSchema.parse(await request.json());
    switch (input.action) {
      case "create_category": crearCategoria(input); break;
      case "update_category": actualizarCategoria(input); break;
      case "delete_category": eliminarCategoria(input.id); break;
      case "create_type": crearTipo(input); break;
      case "update_type": actualizarTipo(input); break;
      case "delete_type": eliminarTipo(input.id); break;
      case "save_element": guardarElemento(input); break;
      case "delete_element": eliminarElemento(input.id); break;
    }
    return Response.json({ ok: true, ...obtenerArquitectura() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "No se pudo guardar el cambio.";
    const status = /FOREIGN KEY constraint failed/i.test(message) ? 409 : 400;
    return Response.json({ error: status === 409 ? "Este registro todavía está siendo usado por otros elementos." : message }, { status });
  }
}
