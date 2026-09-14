import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isAuthenticatedRequest } from "@/lib/auth/request";
import { getDb } from "@/lib/db";
import { directorioOrdenes } from "@/lib/ordenes/directorio";
import type { FeedbackFoto } from "@/lib/ordenes/tipos";

export type { FeedbackFoto };

export type ProductoCatalogo = {
  titulo: string;
  imagen: string | null;
  precio: number;
  disponible: boolean;
  colores: string[];
  tamanoCodigo: string | null;
};

type LineaDesglose = {
  producto: string;
  variante: string | null;
  sku: string | null;
  cantidad: number;
  precioUnitario: number;
  catalogo?: ProductoCatalogo | null;
};
type Desglose = { orden: string; cliente: string | null; fecha: string | null; lineas: LineaDesglose[] };

type FilaCatalogoPorSku = {
  titulo_limpio: string;
  imagen_principal: string | null;
  colores: string;
  precio: number;
  disponible: number;
  tamano_codigo: string | null;
};

/** Cruza el SKU real de la orden contra el catálogo local — mismo precio/imagen que ve el
 * cliente en el chat, no el precio que quedó congelado en la orden vieja. */
function productoCatalogoPorSku(sku: string): ProductoCatalogo | null {
  const fila = getDb()
    .prepare(
      `SELECT p.titulo_limpio, p.imagen_principal, p.colores, v.precio, v.disponible, v.tamano_codigo
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.sku = ?
       LIMIT 1`,
    )
    .get(sku) as FilaCatalogoPorSku | undefined;
  if (!fila) return null;
  return {
    titulo: fila.titulo_limpio,
    imagen: fila.imagen_principal,
    precio: fila.precio,
    disponible: Boolean(fila.disponible),
    colores: JSON.parse(fila.colores || "[]"),
    tamanoCodigo: fila.tamano_codigo,
  };
}
export type Caption = {
  orden: string;
  foto: string;
  trigger_token: string;
  tipo_estructura: string;
  elementos_no_comprados: string[];
  proporcion_relativa_presente: boolean;
  proporcion_relativa_descripcion: string;
  caption: string;
  caption_status: string;
};

export type FotoOrden = {
  indice: number;
  archivo: string;
  caption: Caption | null;
  feedback: FeedbackFoto | null;
};

export type OrdenRevision = {
  numero: string;
  fotos: FotoOrden[];
  desglose: Desglose | null;
};

async function leerJsonSiExiste<T>(ruta: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(ruta, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Una orden puede tener más de una reseña con foto (productos distintos reseñados por
 * separado dentro de la misma orden) -- crear-carpeta-orden.ts numera foto-1, foto-2, ... */
async function fotosDeLaCarpeta(carpetaOrden: string, archivos: string[]): Promise<FotoOrden[]> {
  const fotos = archivos
    .map((archivo) => {
      const m = archivo.match(/^foto-(\d+)\.(jpg|jpeg|png|webp)$/i);
      return m ? { archivo, indice: Number(m[1]) } : null;
    })
    .filter((x): x is { archivo: string; indice: number } => x !== null)
    .sort((a, b) => a.indice - b.indice);

  return Promise.all(
    fotos.map(async ({ archivo, indice }) => ({
      indice,
      archivo,
      caption: await leerJsonSiExiste<Caption>(path.join(carpetaOrden, `caption-${indice}.json`)),
      feedback: await leerJsonSiExiste<FeedbackFoto>(path.join(carpetaOrden, `feedback-${indice}.json`)),
    })),
  );
}

function ordenarNumerosDesc(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length;
  return b.localeCompare(a);
}

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });

  const rutaOrdenes = directorioOrdenes();
  let carpetas: string[];
  try {
    carpetas = (await readdir(/*turbopackIgnore: true*/ rutaOrdenes, { withFileTypes: true }))
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => entrada.name)
      .sort(ordenarNumerosDesc);
  } catch {
    return Response.json({ ordenes: [], error: `No se encontró la carpeta ${rutaOrdenes}` });
  }

  const ordenes: OrdenRevision[] = await Promise.all(
    carpetas.map(async (numero) => {
      const carpetaOrden = path.join(/*turbopackIgnore: true*/ rutaOrdenes, numero);
      const archivos = await readdir(/*turbopackIgnore: true*/ carpetaOrden).catch(() => [] as string[]);
      const [desglose, fotos] = await Promise.all([
        leerJsonSiExiste<Desglose>(path.join(carpetaOrden, "desglose.json")),
        fotosDeLaCarpeta(carpetaOrden, archivos),
      ]);
      if (desglose) {
        for (const linea of desglose.lineas) {
          linea.catalogo = linea.sku ? productoCatalogoPorSku(linea.sku) : null;
        }
      }
      return { numero, fotos, desglose };
    }),
  );

  return Response.json({ ordenes });
}
