import { NOMBRES_CATEGORIA } from "@/lib/catalog-data";
import { crearProducto, eliminarTodosLosProductos, obtenerProductos } from "@/lib/products";
import { guardarImagen } from "@/lib/store";
import type { Categoria } from "@/lib/types";

const CATEGORIAS_VALIDAS = Object.keys(NOMBRES_CATEGORIA) as Categoria[];

function separarLista(valor: FormDataEntryValue | null): string[] {
  if (typeof valor !== "string") return [];
  return valor
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET() {
  return Response.json(await obtenerProductos());
}

/** Borra TODOS los productos del catálogo (y sus fotos). No se resiembran solos. */
export async function DELETE() {
  await eliminarTodosLosProductos();
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const form = await request.formData();

  const nombre = String(form.get("nombre") ?? "").trim();
  const categoria = String(form.get("categoria") ?? "") as Categoria;
  const descripcion = String(form.get("descripcion") ?? "").trim();
  const precio = Number(form.get("precio"));
  const imagen = form.get("imagen");

  if (!nombre) return Response.json({ error: "Falta el nombre del producto." }, { status: 400 });
  if (!CATEGORIAS_VALIDAS.includes(categoria)) {
    return Response.json({ error: "Categoría inválida." }, { status: 400 });
  }
  if (!descripcion) {
    return Response.json(
      { error: "Falta la descripción visual — es lo que usa la IA para generar imágenes." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(precio) || precio < 0) {
    return Response.json({ error: "El precio debe ser un número mayor o igual a 0." }, { status: 400 });
  }
  if (!(imagen instanceof File) || imagen.size === 0) {
    return Response.json({ error: "Sube una foto real del producto." }, { status: 400 });
  }

  try {
    const foto = await guardarImagen(imagen, "productos");
    const producto = await crearProducto({
      nombre,
      categoria,
      descripcion,
      precio,
      estilos: separarLista(form.get("estilos")),
      colores: separarLista(form.get("colores")),
      foto,
    });
    return Response.json(producto, { status: 201 });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: detalle }, { status: 400 });
  }
}
