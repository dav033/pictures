/**
 * La capacidad que falta de una pasada en vivo: la evidencia de lo que la pasada acaba de hacer (la lectura medida, lo que la compilación no
 * armó, la escena final) más los errores de las herramientas del asistente, que solo quedan en su auditoría. Nunca lanza: lo que no se pueda
 * leer queda en `avisos` y la clasificación sigue con lo que sí hay.
 */
import type { Escena } from "@/lib/globos3d/escena";
import type { Modelado } from "@/lib/globos3d/modelar-desde-foto";
import { diagnosticoEscritor, esperarRegistros } from "@/lib/registro/servidor";
import { erroresDeHerramientas, eventosDeConversacion } from "./lib-auditoria";
import { clasificarCapacidad, type ConteoCapacidad, type EvidenciaCapacidad } from "./lib-capacidad";
import { evidenciaDePasada } from "./lib-evidencia";

export type CapacidadDePasada = { conteo: ConteoCapacidad; evidencia: EvidenciaCapacidad };

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** La auditoría se escribe en segundo plano: se espera a que se vacíe y se lee la conversación de la pasada. */
async function erroresDeLaPasada(idConversacion: string, avisos: string[]): Promise<string[]> {
  try {
    await esperarRegistros();
    const { eventos, lineasRotas } = eventosDeConversacion(diagnosticoEscritor().raizActiva, idConversacion);
    if (!eventos.length) avisos.push("Sin auditoría de la pasada: la capacidad que falta no cuenta los errores de las herramientas.");
    if (lineasRotas) avisos.push(`${lineasRotas} línea(s) de la auditoría de la pasada no se pudieron leer: pueden faltar errores de las herramientas.`);
    return erroresDeHerramientas(eventos);
  } catch (fallo) {
    avisos.push(`No se pudo leer la auditoría de la pasada (sin los errores de las herramientas): ${mensajeDe(fallo)}`);
    return [];
  }
}

export async function capacidadDeLaPasada(entrada: { modelado: Modelado; escena: Escena; idConversacion: string }, avisos: string[]): Promise<CapacidadDePasada | undefined> {
  const erroresHerramientas = await erroresDeLaPasada(entrada.idConversacion, avisos);
  try {
    const evidencia = evidenciaDePasada({ piezas: entrada.modelado.lectura.piezas, escena: entrada.escena, omitidas: entrada.modelado.omitidas, erroresHerramientas });
    return { evidencia, conteo: clasificarCapacidad(evidencia) };
  } catch (fallo) {
    avisos.push(`No se pudo clasificar la capacidad que falta: ${mensajeDe(fallo)}`);
    return undefined;
  }
}
