import { z } from "zod";

/**
 * El contrato entre las rutas que pagan una imagen de FLUX.1 Kontext y el navegador, cuando fal sigue trabajando al acabarse el
 * plazo de la petición (Kontext max tardó 112,9 s de inferencia en una toma y la ruta cortaba a los 105 s: la imagen, ya pagada,
 * se perdía). Sin dependencias de servidor: lo usan las dos partes.
 *
 * La ruta responde 202 con `{ estado: "en_curso", codigo, solicitud_kontext }` y el navegador repite LA MISMA petición con el
 * encabezado `x-solicitud-kontext` con ese valor: la ruta no envía otra solicitud ni gasta otro cupo, solo espera la que ya existe.
 * El valor es un token firmado (`solicitud-kontext.ts`) atado a esa petición (su texto, su vista —captura y aspecto— y, donde hay identidad, el navegador) y con vida corta.
 */
export const CABECERA_SOLICITUD_KONTEXT = "x-solicitud-kontext";
export const CODIGO_KONTEXT_EN_CURSO = "KONTEXT_EN_CURSO";
export const CODIGO_SOLICITUD_KONTEXT_INVALIDA = "SOLICITUD_KONTEXT_INVALIDA";
/** Cuántas veces retoma el navegador una solicitud en curso: con el plazo de 100 s de cada petición son unos 5 minutos en total. */
export const MAX_REANUDACIONES_KONTEXT = 2;

export const KontextEnCursoSchema = z.object({
  estado: z.literal("en_curso"),
  codigo: z.literal(CODIGO_KONTEXT_EN_CURSO),
  solicitud_kontext: z.string().min(1).max(400),
}).passthrough();
