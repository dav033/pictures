/**
 * Una línea al arrancar con el valor efectivo de las banderas de imagen y de los
 * modelos, y un aviso si se pagan lecturas de la foto que nadie consume. Solo
 * nombres, booleanos y nombres de modelo: ningún secreto (ver `resumenBanderas`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { lecturasSinConsumidor, resumenBanderas } = await import("@/lib/ia/nucleo/feature-flags");
  const { MODELO_CHAT, MODELO_IMAGEN } = await import("@/lib/gemini");
  console.info(JSON.stringify({ evento: "banderas_efectivas", servicio: "next", ...resumenBanderas(), GEMINI_CHAT_MODEL: MODELO_CHAT, GEMINI_IMAGE_MODEL: MODELO_IMAGEN }));
  const perdidas = lecturasSinConsumidor();
  if (perdidas.length) console.warn(JSON.stringify({ evento: "lecturas_sin_consumidor", lecturas: perdidas }));
}
