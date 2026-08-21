import { actualizarDecoracion, eliminarDecoracion } from "@/lib/decoraciones";
import { guardarImagen } from "@/lib/store";
import type { Decoracion } from "@/lib/types";

function parsearElementos(valor: FormDataEntryValue | null): string[] | undefined {
  if (typeof valor !== "string") return undefined;
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista.filter((x) => typeof x === "string") : undefined;
  } catch {
    return undefined;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const form = await request.formData();
  const cambios: Partial<Omit<Decoracion, "id">> = {};

  const nombre = form.get("nombre");
  if (typeof nombre === "string" && nombre.trim()) cambios.nombre = nombre.trim();

  if (form.has("descripcion")) {
    const descripcion = String(form.get("descripcion") ?? "").trim();
    cambios.descripcion = descripcion || undefined;
  }

  const elementos = parsearElementos(form.get("elementos"));
  if (elementos) cambios.elementos = elementos;

  const imagen = form.get("imagen");
  if (imagen instanceof File && imagen.size > 0) {
    try {
      cambios.imagen = await guardarImagen(imagen, "decoraciones");
    } catch (error) {
      const detalle = error instanceof Error ? error.message : "Error desconocido";
      return Response.json({ error: detalle }, { status: 400 });
    }
  }

  try {
    const actualizada = await actualizarDecoracion(id, cambios);
    return Response.json(actualizada);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: detalle }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await eliminarDecoracion(id);
  return Response.json({ ok: true });
}
