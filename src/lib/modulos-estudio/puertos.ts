import type { ConfigModulo } from "./configuracion";

/**
 * Los dos puertos del caché de renders del estudio. El servicio (`servicio-renders.ts`) solo conoce estas interfaces:
 * Neon y el almacén S3 son adaptadores que se enchufan en `fabrica.ts`, y las pruebas usan los de memoria.
 */

export type EstadoFila = "pendiente" | "lista";

export type FilaRender = {
  clave: string;
  tipo: string;
  formatoId: string;
  /** Los colores canónicos (un código por globo). */
  colores: readonly string[];
  version: string;
  estado: EstadoFila;
  /** Dónde está la imagen en el almacén; `null` mientras la fila está pendiente. */
  objeto: string | null;
  mime: string | null;
  costeUsd: number | null;
  /** Huella (16 hex del sha256) del CONTENIDO de la imagen guardada: la versión de su URL; se calcula al guardar y evita leer el objeto para saberla. */
  huella: string | null;
  /** sha256 de la captura 3D con que se hizo (la mandó el cliente) y huella de la sesión que la pidió; `null` en una reserva. */
  capturaSha256: string | null;
  sesion: string | null;
  /** Cuánto lleva la fila como está, medido por quien la guarda (la base, no el reloj de esta instancia). */
  edadMs: number;
};

export type NuevaFila = Pick<FilaRender, "clave" | "tipo" | "formatoId" | "colores" | "version">;

export interface RepositorioRendersModulo {
  /** La fila de esa clave (pendiente o lista), o `null`. */
  buscar(clave: string): Promise<FilaRender | null>;
  /**
   * Anota que alguien va a generar esta clave. Atómica: de dos llamadas simultáneas solo una devuelve `dueno` (clave única
   * en la base); la otra recibe la fila que ya existe. `dueno` es la ficha de la reserva: solo quien la tiene puede completarla
   * o liberarla, así una reserva que otro tomó por caducada no la pisa quien tardó más de la cuenta.
   */
  reservar(fila: NuevaFila): Promise<{ reservada: true; dueno: string } | { reservada: false; existente: FilaRender }>;
  /** Toma una fila pendiente que lleva más de `edadMinimaMs` (quien la reservó murió). Devuelve la ficha nueva, o `null`. */
  reclamarCaducada(clave: string, edadMinimaMs: number): Promise<string | null>;
  /** Una fila lista cuyo objeto ya no está en el almacén vuelve a pendiente para regenerarla. Devuelve la ficha, o `null`. */
  reabrir(clave: string): Promise<string | null>;
  /** La imagen ya está en el almacén: la fila pasa a lista. Solo después de guardar el objeto y solo para el `dueno` vigente. */
  completar(clave: string, dueno: string, datos: { objeto: string; mime: string; costeUsd: number; capturaSha256: string; sesion: string | null; huella: string }): Promise<void>;
  /** Quita una fila LISTA (se descarta el render) y la devuelve para borrar su objeto; `null` si no había una lista. */
  eliminar(clave: string): Promise<FilaRender | null>;
  /** Quita la fila pendiente (la generación falló) si sigue siendo del `dueno`: no queda nada a medias ni se pisa a otro. */
  liberar(clave: string, dueno: string): Promise<void>;
}

export type ObjetoImagen = { bytes: Uint8Array; mime: string };

export interface AlmacenImagenes {
  guardar(objeto: string, imagen: ObjetoImagen): Promise<void>;
  /** `null` si el objeto no existe. */
  leer(objeto: string): Promise<ObjetoImagen | null>;
  /** ¿Está el objeto? Sin bajarlo (un HEAD). */
  existe(objeto: string): Promise<boolean>;
  /** Borrar un objeto que no existe no es un error. */
  borrar(objeto: string): Promise<void>;
}

export type CapturaBase = { mime: "image/png" | "image/jpeg"; base64: string };

/** Hace la imagen (FLUX con la captura 3D como guía). Lanza si no puede; no guarda nada. */
export type GeneradorRender = (config: ConfigModulo, captura: CapturaBase, senal?: AbortSignal) => Promise<ObjetoImagen & { costeUsd: number }>;
