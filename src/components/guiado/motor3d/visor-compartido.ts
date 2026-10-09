import type { EscenaGlobos } from "@/components/tres-d/escena-globos";
import type { EscenaArmada } from "@/lib/globos3d/escena";
import type { ArmadaCompactaV1 } from "@/lib/globos3d/motor/v1";
import type { VistaArmada } from "@/lib/guiada-motor/armada-contrato";
import { escenaDesdeArmada } from "./desde-armada-compacta";

/**
 * **UN visor sin pantalla por página** (REQ-007, fase 3): dibuja las imágenes fijas (~768 px) de todas las tarjetas de plan
 * y las miniaturas de sus piezas, una tras otra. Así una conversación con diez planes usa un solo contexto WebGL (los
 * celulares dan 8 a 16 y los pierden sin avisar), y la hoja que gira (`HojaOrbita`) es el único contexto vivo a la vez.
 *
 * Reglas:
 * - se pide y se hace en fila: nunca dos dibujos a la vez sobre el mismo visor;
 * - se recicla como `CapturaRender` (cada `RENDERS_POR_VISOR` dibujos, uno nuevo) y se libera tras unos segundos sin
 *   pedidos, al irse de la página y al perderse el contexto. Liberar es destruir el visor Y perder el contexto a propósito
 *   (`WEBGL_lose_context`): `renderer.dispose()` solo suelta los recursos, no el contexto;
 * - todo recurso de GPU vive dentro del visor (D-017): aquí no hay cachés de materiales ni de geometrías;
 * - todo lo que falla por WebGL sale como `FalloWebgl`: quien llama pasa a la vista de reserva (SVG).
 */
export class FalloWebgl extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = "FalloWebgl"; }
}

/** Cada cuántos dibujos se rehace el visor: los materiales y geometrías en caché no se liberan solos. */
export const RENDERS_POR_VISOR = 40;
export const OCIO_MS = 5000;
/** El lienzo sin pantalla es chico a propósito: `renderEstandar` fija su propio tamaño al dibujar y lo restaura. */
const LADO_LIENZO = 64;

export type PedidoImagen = { armada: ArmadaCompactaV1; pieza?: string; vista: VistaArmada; lado: number };

export type MotorDelVisor = {
  crearEscena: (lienzo: HTMLCanvasElement) => EscenaGlobos;
  mostrarArmada: (visor: EscenaGlobos, armada: EscenaArmada, sala?: EscenaArmada["sala"]) => void;
};

export type DependenciasVisor = {
  /** Carga perezosa del visor (three.js entra aquí y en ningún otro sitio de la tarjeta). */
  cargarMotor: () => Promise<MotorDelVisor>;
  crearLienzo: () => HTMLCanvasElement;
  esperarCuadro: () => Promise<void>;
  ocioMs: number;
};

/**
 * Una suspensión del visor: `listo` llega cuando lo que ya estaba en la fila terminó y el visor quedó suelto; hasta que se
 * llame `soltar`, los pedidos nuevos esperan (no abren otro contexto). `soltar` es idempotente y también cancela una
 * suspensión que aún no empezó.
 */
export type FichaSuspension = { listo: Promise<void>; soltar: () => void };

export type VisorCompartido = {
  /** La imagen fija (data URL) de la armada o de una de sus piezas. */
  imagen: (pedido: PedidoImagen) => Promise<string>;
  /** Destruye el visor y pierde su contexto ya, sin esperar a la fila: al irse de la página o tras un fallo. */
  liberar: () => void;
  /** Deja el visor suelto EN LA FILA (después de lo que ya se estaba dibujando) y pausa los pedidos nuevos: la hoja que gira es el único contexto vivo. */
  suspender: () => FichaSuspension;
};

/** Pierde el contexto WebGL de un lienzo a propósito: libera la memoria de la GPU sin esperar al recolector. */
export function perderContexto(lienzo: HTMLCanvasElement): void {
  try {
    const gl = (lienzo.getContext("webgl2") ?? lienzo.getContext("webgl")) as WebGL2RenderingContext | WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* el lienzo ya no tiene contexto: nada que perder */ }
}

const mensaje = (causa: unknown) => (causa instanceof Error ? causa.message : String(causa));

/** Un cuadro para que el visor termine de armar lotes; con la pestaña oculta `requestAnimationFrame` no corre, así que hay tope. */
export const esperarCuadroConTope = (): Promise<void> => new Promise((resolver) => {
  const tope = setTimeout(resolver, 250);
  requestAnimationFrame(() => { clearTimeout(tope); resolver(); });
});

const dependenciasDelNavegador: DependenciasVisor = {
  cargarMotor: async () => {
    const [{ crearEscena }, { mostrarArmada }] = await Promise.all([import("@/components/tres-d/escena-globos"), import("@/components/tres-d/armada-visor")]);
    return { crearEscena, mostrarArmada };
  },
  crearLienzo: () => {
    const lienzo = document.createElement("canvas");
    lienzo.setAttribute("aria-hidden", "true");
    Object.assign(lienzo.style, { position: "fixed", left: "-10000px", top: "0", width: `${LADO_LIENZO}px`, height: `${LADO_LIENZO}px`, pointerEvents: "none" });
    lienzo.width = LADO_LIENZO;
    lienzo.height = LADO_LIENZO;
    document.body.appendChild(lienzo);
    return lienzo;
  },
  esperarCuadro: esperarCuadroConTope,
  ocioMs: OCIO_MS,
};

export function crearVisorCompartido(deps: DependenciasVisor = dependenciasDelNavegador): VisorCompartido {
  let lienzo: HTMLCanvasElement | null = null;
  let visor: EscenaGlobos | null = null;
  let motor: MotorDelVisor | null = null;
  let dibujos = 0;
  let contextoPerdido = false;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let cola: Promise<unknown> = Promise.resolve();
  let suspensiones = 0;
  let pausa: Promise<void> | null = null;
  let terminarPausa: (() => void) | null = null;

  const alPerderContexto = (evento: Event) => {
    // `preventDefault` deja que el navegador lo restaure; aun así este visor no se reutiliza: el siguiente pedido arma otro.
    evento.preventDefault();
    contextoPerdido = true;
  };

  function liberar(): void {
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    const actual = lienzo;
    try { visor?.destruir(); } catch { /* un visor a medias no impide soltar el lienzo */ }
    visor = null;
    lienzo = null;
    dibujos = 0;
    contextoPerdido = false;
    if (actual) {
      actual.removeEventListener("webglcontextlost", alPerderContexto);
      perderContexto(actual);
      actual.remove();
    }
  }

  async function obtenerVisor(): Promise<EscenaGlobos> {
    if (visor && (contextoPerdido || dibujos >= RENDERS_POR_VISOR)) liberar();
    if (visor) return visor;
    try { motor ??= await deps.cargarMotor(); } catch (causa) { throw new FalloWebgl(`No se pudo cargar el visor: ${mensaje(causa)}`); }
    const nuevo = deps.crearLienzo();
    nuevo.addEventListener("webglcontextlost", alPerderContexto);
    try {
      visor = motor.crearEscena(nuevo);
    } catch (causa) {
      nuevo.removeEventListener("webglcontextlost", alPerderContexto);
      nuevo.remove();
      throw new FalloWebgl(`No se pudo crear el visor: ${mensaje(causa)}`);
    }
    lienzo = nuevo;
    dibujos = 0;
    contextoPerdido = false;
    return visor;
  }

  function programarOcio(): void {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(liberar, deps.ocioMs);
  }

  async function dibujar(pedido: PedidoImagen): Promise<string> {
    const escena = escenaDesdeArmada(pedido.armada, pedido.pieza === undefined ? {} : { pieza: pedido.pieza });
    if (escena.porNodo.every((nodo) => nodo.globos.length + nodo.tubos.length + nodo.flores.length === 0)) throw new Error("No hay nada que dibujar");
    // Con la hoja que gira abierta no se abre otro contexto: el pedido espera a que la suelten.
    while (pausa) await pausa;
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    const actual = await obtenerVisor();
    try {
      motor!.mostrarArmada(actual, escena, escena.sala);
      await deps.esperarCuadro();
      const imagen = actual.renderEstandar(pedido.vista, pedido.lado);
      if (contextoPerdido) throw new FalloWebgl("Se perdió el contexto WebGL al dibujar");
      dibujos += 1;
      return imagen;
    } catch (causa) {
      // Un visor que falló a medias no se reutiliza.
      liberar();
      throw causa instanceof FalloWebgl ? causa : new FalloWebgl(mensaje(causa));
    } finally {
      if (visor) programarOcio();
    }
  }

  return {
    imagen(pedido) {
      const tarea = cola.then(() => dibujar(pedido));
      cola = tarea.catch(() => undefined);
      return tarea;
    },
    liberar,
    suspender() {
      let soltada = false, activa = false;
      const listo = cola.then(() => {
        if (soltada) return;
        activa = true;
        suspensiones += 1;
        pausa ??= new Promise<void>((resolver) => { terminarPausa = resolver; });
        liberar();
      });
      cola = listo.catch(() => undefined);
      const soltar = () => {
        if (soltada) return;
        soltada = true;
        if (!activa) return;
        suspensiones -= 1;
        if (suspensiones === 0) { terminarPausa?.(); terminarPausa = null; pausa = null; }
      };
      return { listo, soltar };
    },
  };
}

let delNavegador: VisorCompartido | null = null;

/** El visor de la página: se crea al primer pedido y se libera al irse. */
export function visorDeLaPagina(): VisorCompartido {
  if (!delNavegador) {
    delNavegador = crearVisorCompartido();
    window.addEventListener("pagehide", () => delNavegador?.liberar());
  }
  return delNavegador;
}
