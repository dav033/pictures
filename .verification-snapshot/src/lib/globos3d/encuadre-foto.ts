import { z } from "zod";
import type { Sala } from "./escena";
import type { LecturaFoto } from "./lectura-foto";
import { PROFUNDIDAD_DE_LA_FOTO_CM, pisoEnLaFoto } from "./proyeccion-foto";

/**
 * **El encuadre de una foto en la escena** (REQ-001 paso 9): lo que hay que saber para volver a mirar la escena armada
 * de una foto desde donde estaba la cámara de la foto. La lectura da la escala (`altoImagenCm` cm de alto de imagen a la
 * distancia de la decoración), la proporción de la imagen y la línea del piso; el compilador puso el piso de la foto en
 * y = 0 y el centro de la imagen en x = 0, así que la cámara a la altura de la mano (`camaraYCm`), mirando inclinada al
 * centro de la imagen desde la distancia en que `altoImagenCm` llena el cuadro, ve lo mismo que la foto (las mesas por
 * arriba, como en la foto). Puro y sin three.js (lo usan el servidor, que lo devuelve junto a la lectura, y el navegador,
 * que dibuja con él).
 */

export const EncuadreSchema = z.object({
  aspecto: z.number().min(0.3).max(3),
  altoCm: z.number().min(60).max(1500),
  /** Altura (cm sobre el piso) del centro de la imagen: donde apunta la cámara. */
  centroYCm: z.number().min(-1000).max(2000),
  /** Altura (cm sobre el piso) de la cámara, que mira inclinada al centro; sin ella (encuadres viejos), a la del centro y de frente. */
  camaraYCm: z.number().min(-1000).max(2000).optional(),
});
export type Encuadre = z.infer<typeof EncuadreSchema>;

/** A qué altura (cm) del piso se toma una foto cuando no se ve el piso: la cámara en la mano, a la altura del pecho y la cara. */
const ALTURA_DE_LA_CAMARA_CM = 140;

/**
 * La línea del piso de la foto (y de 0 a 1). La leída; si no se ve, el pie de lo que se apoya en el piso (columnas, ramos,
 * fondos, globos); y si lo único que hay cuelga de la pared (guirnaldas, letras), el piso queda donde lo deja una foto
 * tomada a `ALTURA_DE_LA_CAMARA_CM` (el centro de la imagen a esa altura: en las 13 fotos del dueño la línea leída a mano
 * coincide con esta a ±0,1), nunca más arriba de lo más bajo que cuelga (antes se ponía justo ahí y la guirnalda quedaba
 * tirada en el piso).
 */
export function pisoDeLectura(l: LecturaFoto): number {
  if (l.pisoY !== null) return l.pisoY;
  const apoyadas = l.piezas.flatMap((p) => ("yBase" in p ? [p.yBase] : p.tipo === "globo" && p.en === "piso" ? [p.y + p.diametro / 2] : []));
  if (apoyadas.length) return Math.max(...apoyadas);
  const colgadas = l.piezas.flatMap((p) => ("puntos" in p ? p.puntos.map((q) => q.y + q.grosor / 2) : "y" in p ? [p.y] : []));
  return Math.max(0.5 + ALTURA_DE_LA_CAMARA_CM / l.escala.altoImagenCm, ...colgadas);
}

/** Fondo (de la pared al frente) de la sala que arma el compilador de la lectura. */
export const FONDO_SALA_FOTO_CM = 500;
/** Lo que queda libre entre lo más cercano a la cámara y el borde de la sala. */
const MARGEN_AL_FRENTE_CM = 30;
/** Lo más que se acerca algo a la cámara, como fracción de la distancia a la decoración. */
const FRACCION_MAXIMA_AL_FRENTE = 0.6;

/**
 * Cuánto más cerca de la cámara (cm, desde el plano de la decoración) está algo apoyado en el piso cuyo pie se ve en la
 * foto a la altura `yPie`, más abajo que la línea del piso, y cuánto hay que achicar lo que mide en la foto (`factor` < 1:
 * lo cercano se ve más grande). Con la cámara del encuadre (`pisoEnLaFoto`), la misma que la captura. Sin pasarse de
 * lo que cabe en la sala (`fondoSalaCm`, de la pared al frente, menos la profundidad de la decoración y un margen).
 */
export function profundidadEnElPiso(l: LecturaFoto, yPie: number, fondoSalaCm = FONDO_SALA_FOTO_CM): { delanteCm: number; factor: number } {
  const piso = pisoDeLectura(l);
  // Con la línea del piso por encima del centro de la foto, el centro cae en el piso y no en el plano de la decoración: la escala no vale para medir profundidad.
  if (!Number.isFinite(yPie) || piso <= 0.5 || yPie <= piso) return { delanteCm: 0, factor: 1 };
  // El piso que ve la cámara de la foto (la misma de la captura) en la línea del piso y en el pie: lo que separa los dos es lo que el pie está delante.
  const encuadre = encuadreDeLectura(l);
  const linea = pisoEnLaFoto(encuadre, piso), pie = pisoEnLaFoto(encuadre, yPie);
  if (!linea || !pie) return { delanteCm: 0, factor: 1 };
  const cabeEnLaSala = Math.max(0, fondoSalaCm - PROFUNDIDAD_DE_LA_FOTO_CM - MARGEN_AL_FRENTE_CM);
  const delanteCm = Math.max(0, Math.min(linea.prof * FRACCION_MAXIMA_AL_FRENTE, pie.z - linea.z, cabeEnLaSala));
  // Lo que está más cerca se ve más grande en la misma proporción en que baja su profundidad hasta la cámara.
  const prof = Math.max(1, linea.prof - delanteCm * (linea.prof - pie.prof) / Math.max(1e-6, pie.z - linea.z));
  return { delanteCm: Math.round(delanteCm), factor: Math.round((prof / linea.prof) * 1000) / 1000 };
}

/** El encuadre de la foto leída (el que usa `compilarLectura` para colocar las piezas). */
export function encuadreDeLectura(l: LecturaFoto): Encuadre {
  const altoCm = l.escala.altoImagenCm;
  const centroYCm = Math.round((pisoDeLectura(l) - 0.5) * altoCm * 10) / 10;
  // La foto se toma de pie: si el centro de la imagen queda más bajo que la mano, la cámara mira hacia abajo (se ven las mesas por arriba).
  return { aspecto: l.aspecto, altoCm, centroYCm, camaraYCm: Math.max(centroYCm, ALTURA_DE_LA_CAMARA_CM) };
}

/** Alto y ancho (px) de la captura: el lado mayor es `ladoMax` y la proporción la de la foto. */
export function medidasCaptura(aspecto: number, ladoMax: number): { ancho: number; alto: number } {
  const ancho = aspecto >= 1 ? ladoMax : Math.round(ladoMax * aspecto);
  const alto = aspecto >= 1 ? Math.round(ladoMax / aspecto) : ladoMax;
  return { ancho: Math.max(64, ancho), alto: Math.max(64, alto) };
}

/** Lo más ancho y alto (cm) que ve la cámara de la foto a la pared del fondo, con aire por si la pared de la sala era corta. */
const AIRE_CM = 120;

/**
 * La sala para la captura: la de la escena (sus colores) con la pared del fondo y el piso lo bastante grandes para que no
 * se vean sus bordes, sin techo ni paredes laterales (la foto no los enseña).
 */
export function salaParaFoto(sala: Sala, e: Encuadre): Sala {
  return {
    ...sala,
    anchoCm: Math.max(sala.anchoCm, Math.ceil(e.altoCm * e.aspecto * 1.6 + AIRE_CM * 2)),
    altoCm: Math.max(sala.altoCm, Math.ceil(e.centroYCm + e.altoCm / 2 + AIRE_CM)),
    mostrar: { piso: true, fondo: true, laterales: false, techo: false },
    // La captura para comparar con la foto va con la luz y el piso neutros: lo que la foto tenga de ambiente lo dice la lectura, no esta sala.
    ambiente: { piso: "liso", luces: false, ventana: false },
  };
}
