/**
 * El flujo de avance de `/api/escena-ia` (D-021): con `Accept: application/x-ndjson` la ruta responde línea a línea
 * (NDJSON) en vez de un solo JSON, para que el panel de la IA muestre los pasos mientras trabaja:
 *   {"tipo":"fase","fase":"leyendo_foto"|"pensando"}
 *   {"tipo":"paso","n":1,"herramienta":"ver_escena","resumen":"…","consulta":true,"ok":true}
 *   {"tipo":"final","estado":200,"cuerpo":{…lo mismo que devuelve la ruta sin flujo…}}
 * Sin la cabecera, la ruta responde como siempre (un JSON): el contrato de los demás clientes no cambia. Compartido por el
 * servidor (codifica) y el navegador (decodifica); puro y sin red.
 */

export const TIPO_NDJSON = "application/x-ndjson";

export type FaseIA = "leyendo_foto" | "pensando";
export type PasoIA = { n: number; herramienta: string; resumen: string; consulta: boolean; ok: boolean };

export type EventoFlujo =
  | { tipo: "fase"; fase: FaseIA }
  | ({ tipo: "paso" } & PasoIA)
  | { tipo: "final"; estado: number; cuerpo: unknown };

export const lineaNdjson = (evento: EventoFlujo): string => `${JSON.stringify(evento)}\n`;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Una línea del flujo como evento; `null` si no es un evento conocido (se ignora: el flujo puede crecer). */
export function eventoDeLinea(linea: string): EventoFlujo | null {
  const texto = linea.trim();
  if (!texto) return null;
  let dato: unknown;
  try { dato = JSON.parse(texto); } catch { return null; }
  if (!esObjeto(dato)) return null;
  if (dato.tipo === "fase" && (dato.fase === "leyendo_foto" || dato.fase === "pensando")) return { tipo: "fase", fase: dato.fase };
  if (dato.tipo === "paso" && typeof dato.n === "number" && typeof dato.herramienta === "string" && typeof dato.resumen === "string" && typeof dato.consulta === "boolean" && typeof dato.ok === "boolean") {
    return { tipo: "paso", n: dato.n, herramienta: dato.herramienta, resumen: dato.resumen, consulta: dato.consulta, ok: dato.ok };
  }
  if (dato.tipo === "final" && typeof dato.estado === "number") return { tipo: "final", estado: dato.estado, cuerpo: dato.cuerpo };
  return null;
}

/** Junta los trozos que llegan de la red y entrega cada línea completa (un trozo puede cortar una línea a la mitad). */
export function crearSeparadorDeLineas(alLinea: (linea: string) => void) {
  let resto = "";
  return {
    meter(trozo: string) {
      resto += trozo;
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const l of lineas) alLinea(l);
    },
    cerrar() {
      if (resto.trim()) alLinea(resto);
      resto = "";
    },
  };
}

/** Lee un cuerpo NDJSON hasta el final y avisa de cada evento. */
export async function leerFlujo(cuerpo: ReadableStream<Uint8Array>, alEvento: (e: EventoFlujo) => void): Promise<void> {
  const decodificador = new TextDecoder();
  const separador = crearSeparadorDeLineas((l) => { const e = eventoDeLinea(l); if (e) alEvento(e); });
  const lector = cuerpo.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    separador.meter(decodificador.decode(value, { stream: true }));
  }
  separador.meter(decodificador.decode());
  separador.cerrar();
}

export type RespuestaEscenaIA = { estado: number; datos: unknown };

/**
 * El pedido a la IA de la escena con avance en vivo. `signal` lo cancela («Detener»): el `fetch` lanza `AbortError` y
 * la ruta, que ve el corte en `request.signal`, deja de llamar al modelo. Si el servidor no responde con flujo (una
 * versión anterior, un proxy que lo junta), cae al JSON de siempre. Un flujo que se corta sin `final` es un error.
 */
export async function pedirEscenaIA(entrada: {
  cuerpo: unknown;
  cabeceras: Record<string, string>;
  signal: AbortSignal;
  alEvento?: (e: Exclude<EventoFlujo, { tipo: "final" }>) => void;
  buscar?: typeof fetch;
}): Promise<RespuestaEscenaIA> {
  const { cuerpo, cabeceras, signal, alEvento, buscar = fetch } = entrada;
  const r = await buscar("/api/escena-ia", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: `${TIPO_NDJSON}, application/json;q=0.5`, ...cabeceras },
    body: JSON.stringify(cuerpo),
    signal,
  });
  if (!(r.headers.get("content-type") ?? "").includes(TIPO_NDJSON) || !r.body) {
    return { estado: r.status, datos: await r.json().catch(() => null) };
  }
  const salida: { final: RespuestaEscenaIA | null } = { final: null };
  await leerFlujo(r.body, (e) => {
    if (e.tipo === "final") salida.final = { estado: e.estado, datos: e.cuerpo };
    else alEvento?.(e);
  });
  return salida.final ?? { estado: 502, datos: { error: "La conexión con la IA se cortó antes de terminar." } };
}
