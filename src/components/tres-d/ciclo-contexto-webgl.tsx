import { useCallback, useState, type RefObject } from "react";
import type { EscenaGlobos } from "./escena-globos";
import { BTN_PRI } from "./ui-taller";

type ControladoresContextoWebGL = {
  alPerder: () => void;
  alRestaurar: () => void;
};

// A lost context returns null from getExtension, so the restore handle is captured while the context is alive.
const extensionesPerdida = new WeakMap<HTMLCanvasElement, WEBGL_lose_context>();

/** Owns the browser events and manual retry path for a viewer's WebGL context. */
export function suscribirContextoWebGL(canvas: HTMLCanvasElement, controladores: ControladoresContextoWebGL): () => void {
  const viva = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = viva?.getExtension("WEBGL_lose_context");
  if (extension) extensionesPerdida.set(canvas, extension);
  const alPerder = (evento: Event) => {
    evento.preventDefault();
    controladores.alPerder();
  };
  const alRestaurar = () => controladores.alRestaurar();
  canvas.addEventListener("webglcontextlost", alPerder);
  canvas.addEventListener("webglcontextrestored", alRestaurar);
  return () => {
    canvas.removeEventListener("webglcontextlost", alPerder);
    canvas.removeEventListener("webglcontextrestored", alRestaurar);
  };
}

/** Requests browser restoration when lost; otherwise rebuilds the live scene immediately. */
export function intentarRecuperarContexto(canvas: HTMLCanvasElement, reconstruir: () => void): void {
  const contexto = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (contexto?.isContextLost()) {
    const extension = extensionesPerdida.get(canvas);
    if (!extension) throw new Error("El navegador no permite restaurar el contexto WebGL");
    extension.restoreContext();
    return;
  }
  reconstruir();
}

/** Owns the viewer's recoverable error state, context subscriptions, and retry action. */
export function useRecuperacionWebGL(
  lienzoRef: RefObject<HTMLCanvasElement | null>,
  escenaRef: RefObject<EscenaGlobos | null>,
) {
  const [error, setError] = useState<string | null>(null);
  const reportarError = useCallback((mensaje: string) => setError(mensaje), []);
  const reconstruir = useCallback(() => {
    try {
      const escena = escenaRef.current;
      if (!escena) throw new Error("El visor todavía no está disponible");
      escena.reconstruir();
      setError(null);
    } catch (causa) {
      setError("El visor 3D sigue sin estar disponible. Vuelve a intentarlo cuando WebGL se haya recuperado.");
      console.error("[3d] No se pudo reconstruir el visor", causa);
    }
  }, [escenaRef]);
  const reintentar = useCallback(() => {
    const lienzo = lienzoRef.current;
    if (!lienzo) return;
    try {
      intentarRecuperarContexto(lienzo, reconstruir);
    } catch (causa) {
      setError("No se pudo recuperar el visor 3D. Recarga la página para volver a abrirlo.");
      console.error("[3d] No se pudo restaurar el contexto", causa);
    }
  }, [lienzoRef, reconstruir]);
  const prepararContexto = useCallback((canvas: HTMLCanvasElement, escena: EscenaGlobos) => suscribirContextoWebGL(canvas, {
    alPerder: () => setError("Se perdió la conexión con el visor 3D. Espera a que WebGL se recupere o inténtalo de nuevo."),
    alRestaurar: () => {
      try {
        escena.reconstruir();
        setError(null);
      } catch (causa) {
        setError("No se pudo reconstruir el visor 3D. Puedes volver a intentarlo.");
        console.error("[3d] No se pudo reconstruir el visor", causa);
      }
    },
  }), []);

  return { error, reportarError, reintentar, prepararContexto };
}

export function AvisoRecuperacionWebGL({ error, reintentar }: { error: string; reintentar: () => void }) {
  return <div role="alert" className="absolute inset-0 z-20 grid content-center justify-items-center gap-3 bg-taller-visor/90 p-6 text-center text-sm">
    <p>{error}</p>
    <button type="button" onClick={reintentar} className={BTN_PRI}>Reintentar visor</button>
  </div>;
}
