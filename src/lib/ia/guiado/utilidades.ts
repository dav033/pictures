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

/** Rutas de los campos inválidos de un ZodError, sin los valores que mandó el modelo. */
function camposInvalidos(error: unknown): string[] | null {
  if (!error || typeof error !== "object" || !("issues" in error) || !Array.isArray(error.issues)) return null;
  return error.issues.slice(0, 6).map((issue: unknown) => {
    const ruta = issue && typeof issue === "object" && "path" in issue && Array.isArray(issue.path) ? issue.path.join(".") : "";
    const codigo = issue && typeof issue === "object" && "code" in issue ? String(issue.code) : "invalido";
    return `${ruta || "(raíz)"}: ${codigo}`;
  });
}

/**
 * Ninguna herramienta tumba el turno: el error vuelve al modelo como `ok:false`. Se deja constancia en el log del servidor
 * con el nombre de la herramienta y el motivo (sin argumentos ni secretos) para poder diagnosticar fallos como «más barato».
 */
export function protegerHerramientas<T extends Record<string, HerramientaGuiada>>(registro: T): T {
  return Object.fromEntries(Object.entries(registro).map(([nombre, herramienta]) => [nombre, async (args: Record<string, unknown>) => {
    try { return await herramienta(args); }
    catch (error) {
      const campos = camposInvalidos(error);
      const motivo = campos ? `argumentos inválidos (${campos.join("; ")})` : error instanceof Error ? error.message.slice(0, 300) : "error desconocido";
      console.warn(`[asistente-guiado] la herramienta ${nombre} falló: ${motivo}`);
      return campos ? { ok: false, motivo: "argumentos_invalidos", campos } : { ok: false, motivo: "herramienta_no_disponible" };
    }
  }])) as T;
}
