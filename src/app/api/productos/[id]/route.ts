import { NOMBRES_CATEGORIA } from "@/lib/catalog-data";
import { actualizarProducto, eliminarProducto } from "@/lib/products";
import { guardarImagen } from "@/lib/store";
import type { Categoria, Producto } from "@/lib/types";

const CATEGORIAS_VALIDAS = Object.keys(NOMBRES_CATEGORIA) as Categoria[];

function separarLista(valor: FormDataEntryValue | null): string[] {
  if (typeof valor !== "string") return [];
  return valor
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const form = await request.formData();
  const cambios: Partial<Omit<Producto, "id">> = {};

  const nombre = form.get("nombre");
  if (typeof nombre === "string" && nombre.trim()) cambios.nombre = nombre.trim();

  const categoria = form.get("categoria");
  if (typeof categoria === "string") {
    if (!CATEGORIAS_VALIDAS.includes(categoria as Categoria)) {
      return Response.json({ error: "Categoría inválida." }, { status: 400 });
    }
    cambios.categoria = categoria as Categoria;
  }

  const descripcion = form.get("descripcion");
  if (typeof descripcion === "string" && descripcion.trim()) cambios.descripcion = descripcion.trim();

  const precioRaw = form.get("precio");
  if (typeof precioRaw === "string" && precioRaw.trim()) {
    const precio = Number(precioRaw);
    if (!Number.isFinite(precio) || precio < 0) {
      return Response.json({ error: "El precio debe ser un número mayor o igual a 0." }, { status: 400 });
    }
    cambios.precio = precio;
  }

  if (form.has("estilos")) cambios.estilos = separarLista(form.get("estilos"));
  if (form.has("colores")) cambios.colores = separarLista(form.get("colores"));

  const imagen = form.get("imagen");
  if (imagen instanceof File && imagen.size > 0) {
    try {
      cambios.foto = await guardarImagen(imagen, "productos");
    } catch (error) {
      const detalle = error instanceof Error ? error.message : "Error desconocido";
      return Response.json({ error: detalle }, { status: 400 });
    }
  }

  try {
    const actualizado = await actualizarProducto(id, cambios);
    return Response.json(actualizado);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: detalle }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await eliminarProducto(id);
  return Response.json({ ok: true });
}
