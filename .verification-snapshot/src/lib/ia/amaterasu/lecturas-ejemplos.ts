import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import lecturasEjemplos from "./lecturas-ejemplos.json";
import type { AnalisisV2Resultado } from "./analizar-referencias-v2";
import { huellaImagen, mismaFoto, type HuellaImagen } from "./huella-imagen";
import type { ImagenEtiquetada } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { MANIFIESTO_REFERENCIAS_EJEMPLO } from "@/lib/referencias-ejemplo/manifiesto";

/**
 * Lecturas revisadas de las 10 fotos de la galería (`public/referencias-ejemplo/`) con la variante de la ruta
 * (`VARIANTE_RUTA_ANALISIS`, hoy `v20-colores`). Es lo único no determinista de leer una foto —lo que el modelo
 * escribió—, guardado una vez, mirado contra la foto y elegido entre varias lecturas; todo lo demás (la
 * validación de las lecturas en Python, el orden de colores por píxeles, las referencias medidas, las piezas en
 * espejo) lo vuelve a hacer la ruta en cada petición, así que un arreglo de ese código se ve también en estas fotos.
 *
 * Por qué existe aparte de `analisis-ejemplos.json` (v16): la ruta lee con v20 y ese archivo solo servía a la
 * variante v16, así que la caché de la galería no respondía nunca (comparador clásica-guiada, 2026-10-06). v16 sigue
 * sirviendo al camino con `LECTURA_UNICA_REFERENCIA_ENABLED=false` y a sus pruebas.
 *
 * La clave no son los bytes: la clásica manda el archivo intacto y la guiada lo vuelve a codificar
 * (`prepararFotoReferencia`). Se reconoce la foto por su sha256 o, si no, por su huella perceptual
 * (`huella-imagen.ts`). Y para que las dos vistas reciban EXACTAMENTE la misma lectura, el resto de la ruta trabaja
 * sobre los píxeles del archivo de la galería, no sobre la copia recodificada que llegó.
 *
 * Regenerar (paga una lectura por foto y vez): `scripts/ops/generar-lecturas-ejemplos.ts`.
 */
export type LecturaEjemplo = {
  id: string;
  archivo: string;
  sha256: string;
  huella: string;
  proporcion: number;
  /** Cuál de las lecturas pagadas se eligió y por qué (lo revisó una persona mirando la foto). */
  revision: string;
  analisis: AnalisisV2Resultado;
};

export type ArchivoLecturasEjemplos = {
  parser_version: string;
  variante: string;
  /** Hash del prompt con que se leyeron; si cambia, las lecturas siguen sirviendo pero conviene regenerarlas. */
  system_prompt_hash: string;
  modelo: string;
  generado: string;
  ejemplos: LecturaEjemplo[];
};

export const LECTURAS_EJEMPLOS = lecturasEjemplos as unknown as ArchivoLecturasEjemplos;

export function sha256DeBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** La foto de la galería en disco (`public/`), o null si este despliegue no la tiene a mano. */
async function leerFotoGaleria(archivo: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), "public", "referencias-ejemplo", path.basename(archivo)));
  } catch {
    return null;
  }
}

export type LecturaDeGaleria = {
  ejemplo: LecturaEjemplo;
  /** «bytes»: el archivo intacto (galería de la clásica); «huella»: la misma foto recodificada (guiada, subida a mano). */
  coincidencia: "bytes" | "huella";
  distancia: number;
  analisis: AnalisisV2Resultado;
  /** Las referencias con que sigue la ruta: con los píxeles del archivo de la galería si está en disco. */
  referencias: ImagenEtiquetada[];
  pixeles: "galeria" | "foto_recibida";
};

type Opciones = {
  parserVersion: string;
  variante: string;
  archivo?: ArchivoLecturasEjemplos;
  leerFoto?: (archivo: string) => Promise<Buffer | null>;
};

/**
 * La lectura revisada si la petición es UNA foto de la galería (intacta o recodificada); null en cualquier otro caso
 * (otra foto, varias fotos, otra variante u otra versión del parser, una lectura guardada que ya no cumple su esquema).
 */
export async function lecturaDeEjemplo(referencias: readonly ImagenEtiquetada[], opciones: Opciones): Promise<LecturaDeGaleria | null> {
  const archivo = opciones.archivo ?? LECTURAS_EJEMPLOS;
  if (referencias.length !== 1 || archivo.parser_version !== opciones.parserVersion || archivo.variante !== opciones.variante || !archivo.ejemplos.length) return null;
  const [referencia] = referencias;
  const bytes = Buffer.from(referencia!.base64, "base64");
  const sha256 = sha256DeBytes(bytes);
  let ejemplo = archivo.ejemplos.find((item) => item.sha256 === sha256);
  let coincidencia: LecturaDeGaleria["coincidencia"] = "bytes";
  let distancia = 0;
  if (!ejemplo) {
    let recibida: HuellaImagen;
    try {
      recibida = await huellaImagen(bytes);
    } catch {
      return null;
    }
    const candidatas = archivo.ejemplos
      .map((item) => ({ item, ...mismaFoto(recibida, { huella: item.huella, proporcion: item.proporcion }) }))
      .filter((candidata) => candidata.igual)
      .sort((una, otra) => una.distancia - otra.distancia);
    if (!candidatas.length) return null;
    ejemplo = candidatas[0]!.item;
    coincidencia = "huella";
    distancia = Math.round(candidatas[0]!.distancia * 100) / 100;
  }
  if (ejemplo.analisis.blueprint.source_images[0]?.image_id !== referencia!.id || !ReferenceBlueprintV2Schema.safeParse(ejemplo.analisis.blueprint).success) return null;
  // Los píxeles del archivo de la galería, comprobados contra su sha256: con ellos el resto de la ruta (Python, el
  // orden de colores, las referencias medidas) da lo mismo en las dos vistas. Sin el archivo, la foto que llegó.
  const enDisco = coincidencia === "bytes" ? bytes : await (opciones.leerFoto ?? leerFotoGaleria)(ejemplo.archivo);
  const galeria = enDisco && sha256DeBytes(enDisco) === ejemplo.sha256 ? enDisco : null;
  const foto = MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.find((item) => item.id === ejemplo.id);
  const referenciasRuta: ImagenEtiquetada[] = galeria
    ? [{
      ...referencia!,
      base64: galeria.toString("base64"),
      mime: "image/jpeg",
      ...(foto ? { ancho: foto.ancho, alto: foto.alto, originalAncho: foto.ancho, originalAlto: foto.alto } : {}),
    }]
    : [...referencias];
  const analisis: AnalisisV2Resultado = {
    ...ejemplo.analisis,
    metadata: { ...ejemplo.analisis.metadata, cached: true, cache_key: `lectura-ejemplo:${ejemplo.id}` },
  };
  return { ejemplo, coincidencia, distancia, analisis, referencias: referenciasRuta, pixeles: galeria ? "galeria" : "foto_recibida" };
}
