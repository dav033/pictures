import { RUTA_PLAN_MOTOR, type RazonBanderaFallida } from "@/lib/guiada-motor/plan-contrato";

type Red = typeof fetch;

/**
 * Avisa al servidor de que la bandera del motor no se leyó a tiempo y el plan se crea con Python: sin esto el plan no pasa por
 * `/api/guiada/motor/plan` y no deja ninguna fila. Dispara y olvida (`keepalive`: sobrevive a que el cliente cambie de
 * página) y nunca lanza ni retrasa el plan del cliente; si este aviso también se pierde, el plan sigue igual.
 */
export function reportarFalloBandera(razon: RazonBanderaFallida, red: Red = (...argumentos) => fetch(...argumentos)): void {
  try {
    void red(RUTA_PLAN_MOTOR, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desde: "bandera_fallida", razon }), keepalive: true }).catch(() => undefined);
  } catch {
    // El aviso es un extra: lo que lo impida no toca el plan.
  }
}
