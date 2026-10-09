import { createHash } from "node:crypto";
import { claveObjeto, claveRender, configCanonica, VERSION_PIPELINE } from "./clave-render";
import type { ConfigModulo } from "./configuracion";
import type { AlmacenImagenes, CapturaBase, FilaRender, GeneradorRender, ObjetoImagen, RepositorioRendersModulo } from "./puertos";

/**
 * El caché de renders del estudio (REQ-011): la misma petición (módulo, tamaño y colores, en cualquier orden equivalente)
 * devuelve la imagen guardada y no vuelve a pagar a FLUX.
 *
 * - **Acierto** (R4): la fila está `lista` y su objeto existe en el almacén → se devuelve; no se llama a nadie de pago.
 * - **Fallo** (R5): se reserva la clave (insert con clave única), se genera una vez, se guarda el objeto y SOLO DESPUÉS se
 *   marca la fila como lista: nunca hay una fila lista sin imagen ni una imagen servida sin fila.
 * - **Una sola generación** (R6): dos peticiones iguales a la vez comparten la reserva; la que pierde espera a que la
 *   ganadora termine (en esta instancia, además, comparten la misma promesa). Una reserva que lleva demasiado tiempo
 *   (la función murió) se toma de nuevo.
 * - **Degradado**: sin base o sin almacén CONFIGURADOS (variables ausentes) el render se genera igual y se devuelve, pero
 *   `guardada: false` y no se escribe nada. Con ellos configurados pero caídos NO se paga una imagen a ciegas (podría estar ya
 *   guardada o en curso): se lanza `CacheCaidoError` y la persona reintenta. Un fallo o el tope por hora (R8) borra la
 *   reserva y no deja nada guardado.
 * - **Ficha de reserva**: completar y liberar solo valen para quien tiene la ficha vigente; una reserva tomada por caducada
 *   no la pisa quien tardó más.
 * - **Presupuesto de la petición**: solo se empieza a generar (o se toma una reserva caducada) si quedan al menos
 *   `minimoParaGenerarMs` del `presupuestoMs` de la petición; si no, 409 enseguida. Quien espera una generación ajena se
 *   rinde a los `esperaMaximaMs` en vez de colgarse.
 * - **Cancelación**: la señal es de cada llamante. La generación compartida no la ve: si el primero cierra la página, el
 *   render se termina y se guarda para todos (ya está pagado).
 * - **Descartar**: borra la fila y el objeto de un render malo para poder generarlo de nuevo.
 */

export class FaltaCapturaError extends Error {
  constructor() {
    super("Esta combinación todavía no tiene render: hace falta la captura 3D del módulo.");
    this.name = "FaltaCapturaError";
  }
}

export class CacheCaidoError extends Error {
  constructor() {
    super("El caché de renders no responde ahora. Vuelve a intentarlo en un momento.");
    this.name = "CacheCaidoError";
  }
}

/** Otra persona genera lo mismo, o a esta petición ya no le queda tiempo para generar: 409, vuelve a intentarlo. */
export class RenderEnCursoError extends Error {
  constructor(mensaje = "Otra persona está generando este mismo render; vuelve a intentarlo en un momento.") {
    super(mensaje);
    this.name = "RenderEnCursoError";
  }
}

export type ConsultaCache =
  | { estado: "hit"; clave: string; imagen: ObjetoImagen; huella: string }
  | { estado: "miss"; clave: string }
  | { estado: "no_disponible"; clave: string; motivo: string };

export type ResultadoRender =
  | { origen: "cache"; clave: string; imagen: ObjetoImagen; huella: string }
  | { origen: "generada"; clave: string; imagen: ObjetoImagen; guardada: boolean; costeUsd: number; aviso?: string };

export type DependenciasServicio = {
  /** `null` si la base no está configurada. */
  repositorio: RepositorioRendersModulo | null;
  /** `null` si el almacén no está configurado (sin variables ALMACEN_S3_*). */
  almacen: AlmacenImagenes | null;
  generar: GeneradorRender;
  version?: string;
  /** Espera entre revisiones de una reserva ajena y tope total (ms); las pruebas los acortan. */
  pasoEsperaMs?: number;
  esperaMaximaMs?: number;
  /** Una reserva pendiente más vieja que esto se considera muerta (FLUX tarda 20–40 s; la ruta vive 120 s). */
  caducaReservaMs?: number;
  /** Lo que dura una petición (la ruta tiene `maxDuration = 120`) y lo que debe quedar para empezar a generar. */
  presupuestoMs?: number;
  minimoParaGenerarMs?: number;
  dormir?: (ms: number) => Promise<void>;
  /** Reloj en ms (las pruebas lo mueven): el tope de espera es tiempo real, no la suma de las pausas. */
  ahora?: () => number;
  /** Para el registro de decisiones (auditoría); opcional. */
  anotar?: (evento: string, detalle: Record<string, unknown>) => void;
};

export type OpcionesPeticion = {
  /** La señal de ESTE llamante (cierre de la página). */
  senal?: AbortSignal;
  /** Cuándo empezó la petición (ms del reloj del servicio); por defecto, ahora. */
  inicioMs?: number;
  /** Huella de la sesión que pide (se guarda con el render; nunca la cookie). */
  sesion?: string | null;
};

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const sha256 = (datos: Uint8Array | Buffer): string => createHash("sha256").update(datos).digest("hex");

/** Una huella corta del CONTENIDO de la imagen: la versión que va en su URL (cambia al descartar y regenerar). */
export const huellaImagen = (imagen: ObjetoImagen): string => sha256(imagen.bytes).slice(0, 16);

function cancelable<T>(trabajo: Promise<T>, senal?: AbortSignal): Promise<T> {
  if (!senal) return trabajo;
  if (senal.aborted) return Promise.reject(new DOMException("La petición se canceló.", "AbortError"));
  return new Promise<T>((resolver, rechazar) => {
    const alAbortar = () => rechazar(new DOMException("La petición se canceló.", "AbortError"));
    senal.addEventListener("abort", alAbortar, { once: true });
    trabajo.then(
      (valor) => { senal.removeEventListener("abort", alAbortar); resolver(valor); },
      (error: unknown) => { senal.removeEventListener("abort", alAbortar); rechazar(error); },
    );
  });
}

export function crearServicioRenders(deps: DependenciasServicio) {
  const version = deps.version ?? VERSION_PIPELINE;
  const paso = deps.pasoEsperaMs ?? 1500;
  const esperaMaxima = deps.esperaMaximaMs ?? 45_000;
  const caduca = deps.caducaReservaMs ?? 150_000;
  const presupuesto = deps.presupuestoMs ?? 120_000;
  const minimoParaGenerar = deps.minimoParaGenerarMs ?? 100_000;
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ahora = deps.ahora ?? Date.now;
  const anotar = deps.anotar ?? (() => undefined);
  const { repositorio, almacen } = deps;
  /** Generaciones en curso en ESTA instancia, por clave: dos clics iguales comparten el mismo trabajo. */
  const enVuelo = new Map<string, Promise<ResultadoRender>>();

  async function leerFila(fila: FilaRender): Promise<ObjetoImagen | null> {
    if (!almacen || fila.estado !== "lista" || !fila.objeto) return null;
    return almacen.leer(fila.objeto);
  }

  /** Sin generar nada: ¿está ya en el caché? */
  async function consultar(config: ConfigModulo): Promise<ConsultaCache> {
    const clave = claveRender(config, version);
    if (!repositorio || !almacen) return { estado: "no_disponible", clave, motivo: "El caché no está configurado." };
    try {
      const fila = await repositorio.buscar(clave);
      const imagen = fila ? await leerFila(fila) : null;
      return imagen ? { estado: "hit", clave, imagen, huella: huellaImagen(imagen) } : { estado: "miss", clave };
    } catch (error) {
      anotar("cache_consulta_fallo", { clave, error: mensaje(error) });
      return { estado: "no_disponible", clave, motivo: "El caché no respondió." };
    }
  }

  /** Borra el render guardado (fila y objeto) para poder generarlo de nuevo. `false` si no había uno guardado. */
  async function descartar(config: ConfigModulo): Promise<boolean> {
    const clave = claveRender(config, version);
    if (!repositorio || !almacen) throw new CacheCaidoError();
    try {
      // Primero la fila (nadie vuelve a servirlo); un objeto que no se pudo borrar queda huérfano, sin efecto.
      const fila = await repositorio.eliminar(clave);
      if (!fila) return false;
      if (fila.objeto) await almacen.borrar(fila.objeto).catch((error: unknown) => anotar("cache_objeto_huerfano", { clave, objeto: fila.objeto, error: mensaje(error) }));
      anotar("cache_descartado", { clave, objeto: fila.objeto, capturaSha256: fila.capturaSha256, sesion: fila.sesion });
      return true;
    } catch (error) {
      if (error instanceof CacheCaidoError) throw error;
      anotar("cache_descarte_fallo", { clave, error: mensaje(error) });
      throw new CacheCaidoError();
    }
  }

  async function generarSinGuardar(canon: ConfigModulo, clave: string, captura: CapturaBase | null, aviso: string, hayTiempo: () => boolean, senal?: AbortSignal): Promise<ResultadoRender> {
    if (!captura) throw new FaltaCapturaError();
    if (!hayTiempo()) throw new RenderEnCursoError("A esta petición ya no le queda tiempo para generar; vuelve a intentarlo.");
    // Sin caché nadie más puede aprovechar el resultado: si quien lo pidió se va, se cancela (no se paga una imagen que se pierde).
    const imagen = await deps.generar(canon, captura, senal);
    return { origen: "generada", clave, imagen, guardada: false, costeUsd: imagen.costeUsd, aviso };
  }

  /** Quien llama ya tiene la reserva de la clave: genera, guarda el objeto y, solo entonces, marca la fila como lista. */
  async function generarYGuardar(canon: ConfigModulo, clave: string, dueno: string, captura: CapturaBase, sesion: string | null): Promise<ResultadoRender> {
    if (!repositorio || !almacen) throw new Error("generarYGuardar sin caché");
    let generada: ObjetoImagen & { costeUsd: number };
    try {
      // Sin la señal de la petición: otros pueden estar esperando este resultado y se va a guardar de todos modos.
      generada = await deps.generar(canon, captura);
    } catch (error) {
      await repositorio.liberar(clave, dueno).catch(() => undefined);
      throw error;
    }
    const objeto = claveObjeto(clave, generada.mime, dueno);
    try {
      await almacen.guardar(objeto, generada);
      await repositorio.completar(clave, dueno, { objeto, mime: generada.mime, costeUsd: generada.costeUsd, capturaSha256: sha256(Buffer.from(captura.base64, "base64")), sesion });
    } catch (error) {
      anotar("cache_guardado_fallo", { clave, error: mensaje(error) });
      await repositorio.liberar(clave, dueno).catch(() => undefined);
      return { origen: "generada", clave, imagen: generada, guardada: false, costeUsd: generada.costeUsd, aviso: "El render se generó pero no se pudo guardar; se volverá a generar la próxima vez." };
    }
    anotar("cache_guardado", { clave, objeto, costeUsd: generada.costeUsd, sesion });
    return { origen: "generada", clave, imagen: generada, guardada: true, costeUsd: generada.costeUsd };
  }

  async function trabajar(config: ConfigModulo, clave: string, captura: CapturaBase | null, inicio: number, sesion: string | null, senalSinCache?: AbortSignal): Promise<ResultadoRender> {
    const canon = configCanonica(config);
    const hayTiempo = () => inicio + presupuesto - ahora() >= minimoParaGenerar;
    if (!repositorio || !almacen) return generarSinGuardar(canon, clave, captura, "El caché no está disponible: el render no se guardará.", hayTiempo, senalSinCache);
    const limite = ahora() + esperaMaxima;
    for (;;) {
      let fila: FilaRender | null;
      let imagen: ObjetoImagen | null = null;
      try {
        fila = await repositorio.buscar(clave);
        imagen = fila ? await leerFila(fila) : null;
      } catch (error) {
        anotar("cache_consulta_fallo", { clave, error: mensaje(error) });
        throw new CacheCaidoError();
      }
      if (imagen) return { origen: "cache", clave, imagen, huella: huellaImagen(imagen) };

      const nueva = { clave, tipo: canon.tipo, formatoId: canon.formatoId, colores: canon.colores, version };
      let dueno: string | null = null;
      try {
        if (!fila) {
          if (!captura) throw new FaltaCapturaError();
          if (!hayTiempo()) throw new RenderEnCursoError("A esta petición ya no le queda tiempo para generar; vuelve a intentarlo.");
          const reserva = await repositorio.reservar(nueva);
          dueno = reserva.reservada ? reserva.dueno : null;
        } else if (fila.estado === "lista") {
          // La fila dice que hay imagen y el almacén no la tiene: se regenera (no se sirve media entrada).
          if (!captura) throw new FaltaCapturaError();
          if (!hayTiempo()) throw new RenderEnCursoError("A esta petición ya no le queda tiempo para generar; vuelve a intentarlo.");
          dueno = await repositorio.reabrir(clave);
        } else if (fila.edadMs > caduca) {
          if (!captura) throw new FaltaCapturaError();
          if (!hayTiempo()) throw new RenderEnCursoError("A esta petición ya no le queda tiempo para generar; vuelve a intentarlo.");
          dueno = await repositorio.reclamarCaducada(clave, caduca);
        }
      } catch (error) {
        if (error instanceof FaltaCapturaError || error instanceof RenderEnCursoError) throw error;
        anotar("cache_reserva_fallo", { clave, error: mensaje(error) });
        throw new CacheCaidoError();
      }
      if (dueno && captura) return generarYGuardar(canon, clave, dueno, captura, sesion);

      if (ahora() >= limite) throw new RenderEnCursoError();
      await dormir(paso);
    }
  }

  /**
   * Devuelve la imagen del caché o la genera (una vez). `captura` solo hace falta si no está guardada: sin ella y sin
   * caché lanza `FaltaCapturaError` sin reservar nada.
   */
  function obtenerOGenerar(config: ConfigModulo, captura: CapturaBase | null, opciones: OpcionesPeticion = {}): Promise<ResultadoRender> {
    const clave = claveRender(config, version);
    if (opciones.senal?.aborted) return Promise.reject(new DOMException("La petición se canceló.", "AbortError"));
    // Sin caché no hay nada que compartir: cada llamante genera para sí y su cancelación sí cancela su generación.
    if (!repositorio || !almacen) return trabajar(config, clave, captura, opciones.inicioMs ?? ahora(), opciones.sesion ?? null, opciones.senal);
    let trabajo = enVuelo.get(clave);
    if (!trabajo) {
      trabajo = trabajar(config, clave, captura, opciones.inicioMs ?? ahora(), opciones.sesion ?? null).finally(() => { enVuelo.delete(clave); });
      // Si el único llamante ya se fue, nadie escucha el resultado: que un fallo no sea una promesa rechazada sin dueño.
      trabajo.catch(() => undefined);
      enVuelo.set(clave, trabajo);
    }
    return cancelable(trabajo, opciones.senal);
  }

  return { consultar, descartar, obtenerOGenerar, clave: (config: ConfigModulo) => claveRender(config, version) };
}

export type ServicioRenders = ReturnType<typeof crearServicioRenders>;
