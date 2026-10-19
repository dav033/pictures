/**
 * Lo que la vista clásica le dice a /api/chat cuando el cliente adjunta solo fotos de referencia, sin escribir nada
 * (`enviar` en src/app/page.tsx). La guiada pide su plan con foto con este MISMO texto (`aceptarPlanFoto` en
 * VistaGuiada.tsx): el plan sale de la lectura de la foto que va en el sistema (ANALISIS_REFERENCIA_VISUAL), igual en las
 * dos vistas, y no de una lista de colores aparte. Con la lista («usa EXACTAMENTE plata, rosa y blanco; no agregues
 * otros») la guiada perdía el transparente y el acabado cromado que la clásica sí leía de la misma foto (2026-10-06).
 */
export const MENSAJE_SOLO_REFERENCIAS = "Adjunto imágenes de referencia del estilo que busco.";
