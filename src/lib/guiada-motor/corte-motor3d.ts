import { CABECERA_CONVERSACION } from "@/lib/registro/tipos";

/**
 * Lo que comparten las rutas del 3D cuando el corte está puesto (P-045, P-049): el código con que responden y la auditoría de
 * cada rechazo. La decisión (`fuente: "corte"`) la toma `bandera.ts`; aquí solo se etiqueta y se deduplica el registro.
 * También lo importa el navegador (el código): nada de Node aquí.
 */
export const CODIGO_MOTOR_3D_CORTADO = "MOTOR_3D_CORTADO";

/**
 * Cuánto del cuerpo se mira para etiquetar. El cliente manda `{ approval_token, plan_hash, motor, espec, … }` y la captura va al
 * final (1-3 MB): el hash está en las primeras líneas. El tope vale con o sin `Content-Length` (un cuerpo en trozos no lo trae).
 */
const BYTES_PARA_ETIQUETAR = 4096;
const PLAN_HASH_EN_LA_CABEZA = /"plan_hash"\s*:\s*"([0-9a-f]{64})"/;
const MAX_ETIQUETAS_AUDITADAS = 200;
const LARGO_MAX_CONVERSACION = 64;

/**
 * El `plan_hash` del cuerpo, solo para etiquetar la auditoría de un rechazo. No valida nada: el cuerpo no se usa para decidir.
 * Lee una copia (`clone`) y solo sus primeros bytes: cancela la lectura al llegar al tope, así que la copia no baja el cuerpo
 * entero. La petición original sigue sin leer: quien responde el rechazo la drena con `drenarCuerpo`.
 */
export async function planHashDeLaPeticion(request: Request): Promise<string | undefined> {
  let lector: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    lector = request.clone().body?.getReader();
    if (!lector) return undefined;
    const cabeza = new Uint8Array(BYTES_PARA_ETIQUETAR);
    let leidos = 0;
    while (leidos < BYTES_PARA_ETIQUETAR) {
      const trozo = await lector.read();
      if (trozo.done) break;
      const util = trozo.value.subarray(0, BYTES_PARA_ETIQUETAR - leidos);
      cabeza.set(util, leidos);
      leidos += util.length;
    }
    return PLAN_HASH_EN_LA_CABEZA.exec(new TextDecoder().decode(cabeza.subarray(0, leidos)))?.[1];
  } catch {
    return undefined;
  } finally {
    // Sin `await`: el `cancel` de una rama de `clone()` no se resuelve hasta que la otra rama (la original) también se cancela.
    void lector?.cancel().catch(() => undefined);
  }
}

/**
 * Consume el cuerpo original de un rechazo del corte. Con el registro apagado nadie más lo lee, y una conexión keep-alive puede
 * quedarse esperando a que se vacíe. Sin `await`, y no lanza: si el cuerpo ya se leyó (el registro de Next), no hace nada.
 */
export function drenarCuerpo(request: Request): void {
  void request.body?.pipeTo(new WritableStream({ write() {} })).catch(() => undefined);
}

/** Qué identifica a un rechazo en la auditoría: la conversación que lo pidió y el plan que quería dibujar. */
export type EtiquetaDeCorte = { planHash: string | undefined; conversacion: string | undefined };

export async function etiquetaDelCorte(request: Request): Promise<EtiquetaDeCorte> {
  return {
    planHash: await planHashDeLaPeticion(request),
    conversacion: request.headers.get(CABECERA_CONVERSACION)?.slice(0, LARGO_MAX_CONVERSACION) || undefined,
  };
}

/**
 * Una fila de auditoría por conversación y plan, no por cada miniatura: la vista pide la armada en cada tarjeta y, con el corte,
 * cada una responde 409. Dos conversaciones con el mismo plan se auditan por separado. Guarda las últimas
 * `MAX_ETIQUETAS_AUDITADAS` etiquetas vistas; al pasarse, vacía el conjunto.
 */
export function crearAuditoriaDeCortes(): { primeraVez: (etiqueta: EtiquetaDeCorte) => boolean } {
  const vistas = new Set<string>();
  return {
    primeraVez({ planHash, conversacion }) {
      const clave = `${conversacion ?? ""}\n${planHash ?? ""}`;
      if (vistas.has(clave)) return false;
      if (vistas.size >= MAX_ETIQUETAS_AUDITADAS) vistas.clear();
      vistas.add(clave);
      return true;
    },
  };
}
