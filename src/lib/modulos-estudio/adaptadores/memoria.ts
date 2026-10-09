import type { AlmacenImagenes, FilaRender, NuevaFila, ObjetoImagen, RepositorioRendersModulo } from "../puertos";

/**
 * Adaptadores en memoria de los dos puertos: para las pruebas y para desarrollar sin Neon ni almacén. Comparten la
 * semántica del adaptador real (clave única, reservar atómico, ficha de la reserva) con un reloj inyectable para probar
 * las reservas caducadas.
 */

type FilaInterna = Omit<FilaRender, "edadMs"> & { desde: number; dueno: string | null };

export function crearRepositorioMemoria(ahora: () => number = () => 0): RepositorioRendersModulo & { filas: Map<string, FilaInterna> } {
  const filas = new Map<string, FilaInterna>();
  let fichas = 0;
  const nuevaFicha = () => `ficha-${++fichas}`;
  const publica = (f: FilaInterna): FilaRender => ({
    clave: f.clave, tipo: f.tipo, formatoId: f.formatoId, colores: f.colores, version: f.version, estado: f.estado,
    objeto: f.objeto, mime: f.mime, costeUsd: f.costeUsd, edadMs: ahora() - f.desde,
  });
  return {
    filas,
    async buscar(clave) {
      const f = filas.get(clave);
      return f ? publica(f) : null;
    },
    async reservar(nueva: NuevaFila) {
      const previa = filas.get(nueva.clave);
      if (previa) return { reservada: false, existente: publica(previa) };
      const dueno = nuevaFicha();
      filas.set(nueva.clave, { ...nueva, estado: "pendiente", objeto: null, mime: null, costeUsd: null, desde: ahora(), dueno });
      return { reservada: true, dueno };
    },
    async reclamarCaducada(clave, edadMinimaMs) {
      const f = filas.get(clave);
      if (!f || f.estado !== "pendiente" || ahora() - f.desde <= edadMinimaMs) return null;
      f.desde = ahora();
      f.dueno = nuevaFicha();
      return f.dueno;
    },
    async reabrir(clave) {
      const f = filas.get(clave);
      if (!f || f.estado !== "lista") return null;
      Object.assign(f, { estado: "pendiente", objeto: null, mime: null, costeUsd: null, desde: ahora(), dueno: nuevaFicha() });
      return f.dueno;
    },
    async completar(clave, dueno, datos) {
      const f = filas.get(clave);
      if (!f || f.estado !== "pendiente" || f.dueno !== dueno) throw new Error(`La reserva de ${clave} ya no es de quien la completa.`);
      Object.assign(f, { estado: "lista", objeto: datos.objeto, mime: datos.mime, costeUsd: datos.costeUsd, dueno: null });
    },
    async liberar(clave, dueno) {
      const f = filas.get(clave);
      if (f?.estado === "pendiente" && f.dueno === dueno) filas.delete(clave);
    },
  };
}

export function crearAlmacenMemoria(): AlmacenImagenes & { objetos: Map<string, ObjetoImagen> } {
  const objetos = new Map<string, ObjetoImagen>();
  return {
    objetos,
    async guardar(objeto, imagen) { objetos.set(objeto, { bytes: new Uint8Array(imagen.bytes), mime: imagen.mime }); },
    async leer(objeto) { return objetos.get(objeto) ?? null; },
  };
}
