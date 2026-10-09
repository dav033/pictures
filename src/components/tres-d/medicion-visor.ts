import type * as THREE from "three";

/**
 * Medición del visor 3D, solo en desarrollo: `window.__visor3d` deja ver desde la consola (o desde un script de
 * medición) cuánto dibuja cada visor (llamadas, triángulos, geometrías, texturas, programas), cuánto tardó cada
 * actualización de la escena y cuánto cuesta un cuadro. En producción no se registra nada.
 */
export const MEDIR_VISOR = process.env.NODE_ENV !== "production";

export type InfoVisor = { calls: number; triangles: number; geometries: number; textures: number; programs: number };

export type VisorMedible = {
  lienzo: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  /** Cuántos cuadros se han dibujado desde que se creó el visor (para ver que en reposo no dibuja). */
  cuadros: () => number;
  /** Lo que tardó cada operación (ms), la última primero. */
  tiempos: Array<{ que: string; ms: number; t: number }>;
  /** `n` cuadros seguidos, sincrónicos y esperando a la tarjeta (`gl.finish`): ms por cuadro y lo dibujado. */
  medirRender: (n: number, conSombra: boolean) => { msPorCuadro: number; info: InfoVisor };
  /** La pieza bajo un punto de la pantalla (para que el script de medición sepa dónde hacer clic). */
  piezaEn: (clienteX: number, clienteY: number) => { nodo: string } | null;
  /**
   * Si hay un cuadro pedido y, con `correr`, dibujarlo ya: en una pestaña de fondo Chrome no corre
   * requestAnimationFrame y así el script de medición puede hacer de reloj (y contar cuántos cuadros pide el visor).
   */
  cuadroPendiente?: (correr: boolean) => boolean;
  /** Cuántas mallas visibles hay de cada clase de geometría (para saber qué suma llamadas de dibujo). */
  desglose?: () => Record<string, number>;
  /** La captura para la IA (JPEG en data URL), para comparar la imagen antes y después de un cambio. */
  capturar?: (opciones?: { escenaEntera?: boolean }) => string;
};

type Registro = {
  visores: Set<VisorMedible>;
  /** El visor más grande que sigue en la página (el del editor). */
  principal: () => VisorMedible | null;
  info: () => InfoVisor | null;
  medirRender: (n?: number, conSombra?: boolean) => { msPorCuadro: number; info: InfoVisor } | null;
  tiempos: () => VisorMedible["tiempos"];
  cuadros: () => number;
};

declare global {
  interface Window { __visor3d?: Registro }
}

export function infoDe(renderer: THREE.WebGLRenderer): InfoVisor {
  const { render, memory, programs } = renderer.info;
  return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0 };
}

function registro(): Registro | null {
  if (!MEDIR_VISOR || typeof window === "undefined") return null;
  if (window.__visor3d) return window.__visor3d;
  const visores = new Set<VisorMedible>();
  const principal = () => {
    let mejor: VisorMedible | null = null, area = -1;
    for (const v of visores) {
      const a = v.lienzo.isConnected ? v.lienzo.clientWidth * v.lienzo.clientHeight : -1;
      if (a > area) { area = a; mejor = v; }
    }
    return mejor;
  };
  const nuevo: Registro = {
    visores,
    principal,
    info: () => { const v = principal(); return v ? infoDe(v.renderer) : null; },
    medirRender: (n = 30, conSombra = false) => principal()?.medirRender(n, conSombra) ?? null,
    tiempos: () => principal()?.tiempos ?? [],
    cuadros: () => principal()?.cuadros() ?? 0,
  };
  window.__visor3d = nuevo;
  return nuevo;
}

/** Registra un visor (devuelve cómo quitarlo al destruirlo). */
export function registrarVisor(visor: VisorMedible): () => void {
  const r = registro();
  if (!r) return () => {};
  r.visores.add(visor);
  return () => { r.visores.delete(visor); };
}

/** Mide lo que tarda `hacer` y lo anota en el visor (si se mide). */
export function cronometrar<T>(visor: VisorMedible | null, que: string, hacer: () => T): T {
  if (!visor) return hacer();
  const t0 = performance.now();
  const salida = hacer();
  const t1 = performance.now();
  visor.tiempos.unshift({ que, ms: Math.round((t1 - t0) * 100) / 100, t: Math.round(t1) });
  if (visor.tiempos.length > 60) visor.tiempos.length = 60;
  return salida;
}

/** Mide algo que no es del visor (armar la escena) y lo anota en el visor principal (si se mide). */
export function medirFuera<T>(que: string, hacer: () => T): T {
  const r = registro();
  return cronometrar(r?.principal() ?? null, que, hacer);
}
