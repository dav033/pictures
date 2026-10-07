import type { Instrumentation } from "next";

/**
 * Una línea al arrancar con el valor efectivo de las banderas de imagen y de los
 * modelos, y un aviso si se pagan lecturas de la foto que nadie consume. Solo
 * nombres, booleanos y nombres de modelo: ningún secreto (ver `resumenBanderas`).
 * Además arranca el registro del servidor (src/lib/registro): línea `servidor.arranque`
 * en el registro general y captura de excepciones del proceso, solo observando.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { lecturasSinConsumidor, resumenBanderas } = await import("@/lib/ia/nucleo/feature-flags");
  const { MODELO_CHAT } = await import("@/lib/gemini");
  console.info(JSON.stringify({ evento: "banderas_efectivas", servicio: "next", ...resumenBanderas(), GEMINI_CHAT_MODEL: MODELO_CHAT }));
  const perdidas = lecturasSinConsumidor();
  if (perdidas.length) console.warn(JSON.stringify({ evento: "lecturas_sin_consumidor", lecturas: perdidas }));
  try {
    const { iniciarRegistroDelProceso } = await import("@/lib/registro/proceso");
    iniciarRegistroDelProceso({ banderas: resumenBanderas(), GEMINI_CHAT_MODEL: MODELO_CHAT, lecturasSinConsumidor: perdidas });
  } catch (error) {
    console.warn(JSON.stringify({ evento: "registro.no_iniciado", error: error instanceof Error ? error.message : String(error) }));
  }
}

/** Errores de render, route handlers, server actions y proxy que Next ve sin manejar: al registro general. */
export const onRequestError: Instrumentation.onRequestError = async (error, peticion, contexto) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { registrarErrorDePeticion } = await import("@/lib/registro/proceso");
    registrarErrorDePeticion(error, peticion, contexto);
  } catch {
    // El registro nunca agrava un error.
  }
};
