import fs from "node:fs";
import sharp from "sharp";
import type { ImagenEtiquetada } from "../../src/lib/ia/nucleo/tipos";

/**
 * Prepara la foto del espacio igual que lo hace el navegador antes de mandarla
 * a `/api/generate`, porque el venue que ve producción NO es el archivo
 * original: `src/app/page.tsx:340-402,1604-1618` lo redimensiona a 1600 de lado
 * mayor, lo codifica en JPEG 0.82, elige el aspecto soportado más cercano,
 * RECORTA AL CENTRO a ese aspecto y vuelve a codificar en JPEG 0.85.
 *
 * El benchmark replica ese preprocesado para medir lo que produce producción y
 * no una versión mejor de la entrada. Devuelve además lo que se perdió en el
 * recorte, que es una de las hipótesis del plan (F11).
 */

/** Aspectos que acepta el servidor (`scene-spec.ts:121-125`). */
const ASPECTOS = [
  { valor: "3:2" as const, razon: 3 / 2 },
  { valor: "1:1" as const, razon: 1 },
  { valor: "2:3" as const, razon: 2 / 3 },
  { valor: "16:9" as const, razon: 16 / 9 },
];

export type AspectoSoportado = (typeof ASPECTOS)[number]["valor"];

/** Misma elección por distancia logarítmica que `aspectoDe` en `page.tsx:310-329`. */
export function aspectoDe(ancho: number, alto: number): AspectoSoportado {
  const razon = ancho / alto;
  let mejor = ASPECTOS[0]!;
  let mejorDistancia = Infinity;
  for (const candidato of ASPECTOS) {
    const distancia = Math.abs(Math.log(razon / candidato.razon));
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = candidato;
    }
  }
  return mejor.valor;
}

export type EspacioPreparado = {
  venue: ImagenEtiquetada;
  aspecto: AspectoSoportado;
  original: { ancho: number; alto: number };
  entregado: { ancho: number; alto: number };
  /** Fracción de píxeles del original que el recorte al centro descartó. */
  recortado: number;
};

export async function prepararEspacio(ruta: string): Promise<EspacioPreparado> {
  if (!fs.existsSync(ruta)) throw new Error(`No existe la foto del espacio: ${ruta}`);
  const meta = await sharp(ruta).metadata();
  if (!meta.width || !meta.height) throw new Error("No se pudieron leer las dimensiones de la foto del espacio.");
  const original = { ancho: meta.width, alto: meta.height };

  // Paso 1-2: lado mayor 1600 (sin ampliar) y JPEG 0.82.
  const redimensionado = await sharp(ruta)
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const metaRedim = await sharp(redimensionado).metadata();
  const ancho = metaRedim.width ?? original.ancho;
  const alto = metaRedim.height ?? original.alto;

  // Paso 3-4: aspecto más cercano, recorte al centro y JPEG 0.85.
  const aspecto = aspectoDe(ancho, alto);
  const razon = ASPECTOS.find((a) => a.valor === aspecto)!.razon;
  const anchoDestino = Math.min(ancho, Math.round(alto * razon));
  const altoDestino = Math.min(alto, Math.round(anchoDestino / razon));
  const recorte = await sharp(redimensionado)
    .extract({
      left: Math.round((ancho - anchoDestino) / 2),
      top: Math.round((alto - altoDestino) / 2),
      width: anchoDestino,
      height: altoDestino,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    venue: {
      id: "VENUE_01",
      descripcion: "Venue base photo. Preserve its camera, crop, architecture, perspective, and ambient lighting.",
      base64: recorte.toString("base64"),
      mime: "image/jpeg",
    },
    aspecto,
    original,
    entregado: { ancho: anchoDestino, alto: altoDestino },
    recortado: 1 - (anchoDestino * altoDestino) / (ancho * alto),
  };
}
