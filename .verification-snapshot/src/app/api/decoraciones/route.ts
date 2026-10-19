import { crearDecoracion, obtenerDecoraciones } from "@/lib/decoraciones";
import { guardarImagen } from "@/lib/store";

function parsearElementos(valor: FormDataEntryValue | null): string[] {
  if (typeof valor !== "string") return [];
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function GET() {
  return Response.json(await obtenerDecoraciones());
}

export async function POST(request: Request) {
  const form = await request.formData();

  const nombre = String(form.get("nombre") ?? "").trim();
  const descripcion = String(form.get("descripcion") ?? "").trim();
  const elementos = parsearElementos(form.get("elementos"));
  const imagen = form.get("imagen");

  if (!nombre) return Response.json({ error: "Falta el nombre de la decoración." }, { status: 400 });
  if (!(imagen instanceof File) || imagen.size === 0) {
    return Response.json({ error: "Sube una imagen de portada para la decoración." }, { status: 400 });
  }

  try {
    const rutaImagen = await guardarImagen(imagen, "decoraciones");
    const decoracion = await crearDecoracion({
      nombre,
      descripcion: descripcion || undefined,
      imagen: rutaImagen,
      elementos,
    });
    return Response.json(decoracion, { status: 201 });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: detalle }, { status: 400 });
  }
}
