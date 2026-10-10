/**
 * La telemetría de IA de la app (`ai_call_log`) se escribe en Postgres con la conexión de `.env.local`: un entrenamiento
 * no debe ensuciar la base del dueño. La traza del arnés es el registro de auditoría en archivos (`corridas/registro`), que
 * guarda cada decisión y llamada de IA; el búfer en memoria de la telemetría sigue funcionando.
 */
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";

/**
 * Apaga solo la escritura a la base. Cargar `telemetria-llamadas` configura la persistencia al evaluarse el módulo (una vez
 * por proceso), así que se carga aquí primero: apagarla antes dejaría que la primera carga la volviera a encender.
 */
export async function desactivarTelemetriaEnBaseDeDatos(): Promise<void> {
  await import("@/lib/ia/nucleo/telemetria-llamadas");
  configurarPersistenciaTelemetria(undefined);
}
