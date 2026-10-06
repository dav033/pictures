export type MensajeGuiado = { role: "user" | "assistant"; content: string };

export function sinUltimoTurnoGuiado<T extends MensajeGuiado>(mensajes: T[]): T[] {
  const indiceReverso = [...mensajes].reverse().findIndex((mensaje) => mensaje.role === "user");
  return indiceReverso < 0 ? mensajes : mensajes.slice(0, mensajes.length - indiceReverso - 1);
}

export function prepararHistorialGuiado(mensajes: MensajeGuiado[], texto: string, reintentar = false): MensajeGuiado[] {
  const base = reintentar ? sinUltimoTurnoGuiado(mensajes) : mensajes;
  const previo = base.filter((mensaje) => mensaje.content.trim().length > 0).slice(-79)
    .map((mensaje) => ({ role: mensaje.role, content: mensaje.content.slice(0, 6000) }));
  return [...previo, { role: "user", content: texto.slice(0, 6000) }];
}

export function cotizacionCorrespondeASeleccion(cotizacionId: string | null, seleccionId: string): boolean {
  return cotizacionId === seleccionId;
}

export function decoracionCotizableCoincide(confirmada: string | undefined, solicitada: string | undefined): boolean {
  return confirmada !== undefined && confirmada === solicitada;
}

export function normalizarCiudad(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

export type HerramientaGuiada = (args: Record<string, unknown>) => Promise<unknown>;

export function protegerHerramientas<T extends Record<string, HerramientaGuiada>>(registro: T): T {
  return Object.fromEntries(Object.entries(registro).map(([nombre, herramienta]) => [nombre, async (args: Record<string, unknown>) => {
    try { return await herramienta(args); }
    catch { return { ok: false, motivo: "herramienta_no_disponible" }; }
  }])) as T;
}
