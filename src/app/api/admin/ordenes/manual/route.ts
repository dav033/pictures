import { mkdir, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { resolverElementosCatalogoOrden, type ElementoCatalogoOrden } from "@/lib/ordenes/catalogo";
import { generarCaption } from "@/lib/ordenes/generarCaption";
import type { Desglose, FeedbackFoto } from "@/lib/ordenes/tipos";
import { directorioOrdenes } from "@/lib/ordenes/directorio";

const TIPOS_ESTRUCTURA = ["arco", "semiarco", "guirnalda", "columna", "pared", "bouquet", "centro_mesa", "otro"] as const;
const TIPOS_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FOTO_MANUAL_BYTES = 8_000_000;

const ElementoSchema = z.object({
  sku: z.string().min(1),
  producto: z.string().min(1),
  variante: z.string().nullable(),
  precioUnitario: z.number().nonnegative(),
  cantidad: z.number().int().positive().optional().default(1),
});
const ElementosSchema = z.array(ElementoSchema).min(1, "Elegí al menos un elemento del catálogo.");

/** Entradas manuales reusan el mismo esquema de carpeta que las órdenes reales (foto-N.jpg,
 * desglose.json, feedback-N.json, caption-N.json) para heredar gratis toda la UI y las demás
 * rutas de /api/admin/ordenes/[numero]/* -- pero esas rutas exigen `numero` puramente numérico
 * (guarda contra path traversal). Un timestamp en ms más un sufijo aleatorio es numérico y no
 * choca con un número de orden real de Shopify (esos son de 4-6 dígitos).
 */
function nuevoNumeroManual(): string {
  return `${Date.now()}${randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
}

async function crearCarpetaManual(): Promise<{ numero: string; carpeta: string }> {
  const raiz = directorioOrdenes();
  await mkdir(raiz, { recursive: true });
  for (let intento = 0; intento < 5; intento += 1) {
    const numero = nuevoNumeroManual();
    const carpeta = path.join(raiz, numero);
    try {
      await mkdir(carpeta);
      return { numero, carpeta };
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("No se pudo reservar un identificador único para la orden manual.");
}

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });

  const formData = await request.formData();

  const foto = formData.get("foto");
  if (!(foto instanceof File) || foto.size === 0) {
    return Response.json({ error: "Falta la imagen." }, { status: 400 });
  }
  if (!TIPOS_IMAGEN.has(foto.type)) return Response.json({ error: "La imagen debe ser JPEG, PNG o WebP." }, { status: 415 });
  if (foto.size > MAX_FOTO_MANUAL_BYTES) return Response.json({ error: "La imagen no puede pesar más de 8 MB." }, { status: 413 });

  const tipoEstructura = String(formData.get("tipoEstructura") ?? "");
  if (!TIPOS_ESTRUCTURA.includes(tipoEstructura as (typeof TIPOS_ESTRUCTURA)[number])) {
    return Response.json({ error: "Tipo de estructura inválido." }, { status: 400 });
  }

  let elementos: z.infer<typeof ElementosSchema>;
  try {
    elementos = ElementosSchema.parse(JSON.parse(String(formData.get("elementos") ?? "[]")));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "Elementos inválidos.";
    return Response.json({ error: message ?? "Elementos inválidos." }, { status: 400 });
  }

  let elementosAutoritativos: ElementoCatalogoOrden[];
  try {
    elementosAutoritativos = await resolverElementosCatalogoOrden(elementos);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Los elementos no pertenecen al catálogo vigente." }, { status: 400 });
  }

  const { numero, carpeta: carpetaOrden } = await crearCarpetaManual();

  const extension = foto.type === "image/png" ? "png" : foto.type === "image/webp" ? "webp" : "jpg";
  const archivoFoto = `foto-1.${extension}`;
  const rutaFoto = path.join(carpetaOrden, archivoFoto);
  await writeFile(rutaFoto, Buffer.from(await foto.arrayBuffer()));

  const desglose: Desglose = {
    orden: numero,
    cliente: null,
    fecha: new Date().toISOString(),
    lineas: elementosAutoritativos.map((e) => ({
      producto: e.producto,
      variante: e.variante,
      sku: e.sku,
      cantidad: e.cantidad ?? 1,
      precioUnitario: e.precioUnitario,
    })),
  };
  await writeFile(path.join(carpetaOrden, "desglose.json"), JSON.stringify(desglose, null, 2), "utf-8");

  const feedback: FeedbackFoto = {
    orden: numero,
    foto: archivoFoto,
    esDecoracion: true,
    decoracionCompleta: true,
    elementoPrincipal: "",
    fidelidadImagen: "alta",
    productosRepresentados: desglose.lineas.map((l) => ({ producto: l.producto, representado: true })),
    aptoParaEntrenamiento: true,
    categoria: "no_asignada",
    notas: "Agregada a mano desde el panel de admin -- no viene de una orden real de Shopify.",
    revisadoEn: new Date().toISOString(),
    fuente: "humano",
  };
  await writeFile(path.join(carpetaOrden, "feedback-1.json"), JSON.stringify(feedback, null, 2), "utf-8");

  let resultado;
  try {
    resultado = generarCaption(numero, archivoFoto, rutaFoto, desglose, feedback, tipoEstructura);
  } catch (error) {
    // La foto, el desglose y el feedback ya quedaron guardados -- el usuario puede reintentar
    // el caption después con el botón "Recaption" que ya existe en la lista, sin perder nada.
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo generar el caption.", numero },
      { status: 502 },
    );
  }
  await writeFile(path.join(carpetaOrden, "caption-1.json"), JSON.stringify(resultado.caption, null, 2), "utf-8");

  return Response.json({ ok: true, numero, caption: resultado.caption, feedback });
}
