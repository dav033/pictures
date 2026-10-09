import type { ArmadaCompactaV1 } from "@/lib/globos3d/motor/v1";
import { RUTA_ARMADA_MOTOR, type CuerpoArmadaEntrada, type VistaArmada } from "@/lib/guiada-motor/armada-contrato";
import { armadaDibujable } from "./desde-armada-compacta";
import { FalloWebgl, visorDeLaPagina, type FichaSuspension, type VisorCompartido } from "./visor-compartido";

/**
 * **Quién le consigue su imagen al plan 3D** (REQ-007, fase 3): pide la armada al servidor (una vez por plan, aunque la
 * pidan la tarjeta y las miniaturas a la vez), la dibuja en el visor compartido y, si el navegador no puede con WebGL,
 * le pide al servidor el SVG de reserva. Sin React, para probarlo sin navegador: la red, el visor y el entorno se inyectan.
 *
 * Qué se guarda en la página: armadas (números) y las imágenes ya hechas, con un tope de memoria. Nada de GPU (D-017).
 */
export type FirmaPlan = Pick<CuerpoArmadaEntrada, "approval_token" | "plan_hash" | "motor" | "espec">;
export type PedidoVista = { pieza?: string; vista: VistaArmada; lado: number };
export type ModoVista = "webgl" | "svg";
export type ImagenVista = { modo: ModoVista; url: string };

/** La ruta respondió que no (o no respondió): el estado HTTP, si lo hubo. */
export class FalloArmada extends Error {
  constructor(mensaje: string, readonly estado: number | null) { super(mensaje); this.name = "FalloArmada"; }
}

export type EntornoVista = { webgl: boolean; memoriaGb: number | null; ahorroDatos: boolean };

/** Con poca memoria o ahorro de datos no se carga three.js (~200 KB gzip) ni se abre un contexto WebGL. */
export const MEMORIA_MINIMA_GB = 2;

export function modoInicial(entorno: EntornoVista): ModoVista {
  if (!entorno.webgl || entorno.ahorroDatos) return "svg";
  return entorno.memoriaGb !== null && entorno.memoriaGb < MEMORIA_MINIMA_GB ? "svg" : "webgl";
}

export function entornoDelNavegador(): EntornoVista {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    webgl: typeof WebGL2RenderingContext !== "undefined" || typeof WebGLRenderingContext !== "undefined",
    memoriaGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    ahorroDatos: nav.connection?.saveData === true,
  };
}

type Red = typeof fetch;
export type DependenciasGestor = { red: Red; entorno: EntornoVista; visor: () => VisorCompartido; presupuestoImagenes?: number };

/** Caracteres de data URL que se guardan como mucho (~8 MB): las más viejas salen primero. */
const PRESUPUESTO_IMAGENES = 8_000_000;

export type GestorVista = {
  modo: () => ModoVista;
  armada: (firma: FirmaPlan) => Promise<ArmadaCompactaV1>;
  imagen: (firma: FirmaPlan, pedido: PedidoVista) => Promise<ImagenVista>;
  /** Suelta el visor sin pantalla y pausa los pedidos hasta `soltar` (la hoja que gira abre el suyo: un solo contexto vivo). */
  suspenderVisor: () => FichaSuspension;
  /** El visor falló o se perdió: de aquí en adelante, la vista de reserva. */
  degradar: () => void;
};

const cuerpoDe = (firma: FirmaPlan, extra: Partial<CuerpoArmadaEntrada>): string => JSON.stringify({ ...firma, ...extra });

export function crearGestorVista(deps: DependenciasGestor): GestorVista {
  let modo = modoInicial(deps.entorno);
  const armadas = new Map<string, Promise<ArmadaCompactaV1>>();
  const imagenes = new Map<string, { promesa: Promise<ImagenVista>; peso: number }>();
  const presupuesto = deps.presupuestoImagenes ?? PRESUPUESTO_IMAGENES;

  async function pedir(firma: FirmaPlan, extra: Partial<CuerpoArmadaEntrada>): Promise<Response> {
    let respuesta: Response;
    try {
      respuesta = await deps.red(RUTA_ARMADA_MOTOR, { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpoDe(firma, extra) });
    } catch (causa) {
      throw new FalloArmada(causa instanceof Error ? causa.message : "sin red", null);
    }
    if (!respuesta.ok) throw new FalloArmada(`la vista respondió ${respuesta.status}`, respuesta.status);
    return respuesta;
  }

  function armada(firma: FirmaPlan): Promise<ArmadaCompactaV1> {
    const guardada = armadas.get(firma.plan_hash);
    if (guardada) return guardada;
    const promesa = (async () => {
      const respuesta = await pedir(firma, { salida: "armada" });
      const datos = (await respuesta.json().catch(() => null)) as { armada?: unknown } | null;
      if (!datos || !armadaDibujable(datos.armada)) throw new FalloArmada("la armada no se puede dibujar", respuesta.status);
      return datos.armada;
    })();
    // Un fallo no se guarda: el siguiente pedido lo vuelve a intentar.
    promesa.catch(() => armadas.delete(firma.plan_hash));
    armadas.set(firma.plan_hash, promesa);
    while (armadas.size > 8) armadas.delete(armadas.keys().next().value as string);
    return promesa;
  }

  async function svg(firma: FirmaPlan, pedido: PedidoVista): Promise<string> {
    const respuesta = await pedir(firma, { salida: "svg", vista: pedido.vista, ...(pedido.pieza ? { pieza: pedido.pieza } : {}) });
    const texto = await respuesta.text();
    if (!texto.startsWith("<svg")) throw new FalloArmada("la vista de reserva no es un SVG", respuesta.status);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texto)}`;
  }

  async function hacer(firma: FirmaPlan, pedido: PedidoVista): Promise<ImagenVista> {
    if (modo === "webgl") {
      try {
        const datos = await armada(firma);
        const url = await deps.visor().imagen({ armada: datos, ...(pedido.pieza ? { pieza: pedido.pieza } : {}), vista: pedido.vista, lado: pedido.lado });
        return { modo: "webgl", url };
      } catch (causa) {
        if (!(causa instanceof FalloWebgl)) throw causa;
        modo = "svg";
        deps.visor().liberar();
      }
    }
    return { modo: "svg", url: await svg(firma, pedido) };
  }

  function recortar(): void {
    let total = 0;
    for (const { peso } of imagenes.values()) total += peso;
    for (const [clave, { peso }] of imagenes) {
      if (total <= presupuesto) break;
      imagenes.delete(clave);
      total -= peso;
    }
  }

  return {
    modo: () => modo,
    armada,
    imagen(firma, pedido) {
      const clave = `${firma.plan_hash}|${pedido.pieza ?? "*"}|${pedido.vista}|${pedido.lado}|${modo}`;
      const guardada = imagenes.get(clave);
      if (guardada) return guardada.promesa;
      const entrada = { promesa: hacer(firma, pedido), peso: 0 };
      imagenes.set(clave, entrada);
      entrada.promesa.then((imagen) => { entrada.peso = imagen.url.length; recortar(); }, () => imagenes.delete(clave));
      return entrada.promesa;
    },
    suspenderVisor: () => deps.visor().suspender(),
    degradar: () => { modo = "svg"; },
  };
}

let delNavegador: GestorVista | null = null;

/** El gestor de la página: uno solo, con el visor sin pantalla único. */
export function gestorDeLaPagina(): GestorVista {
  delNavegador ??= crearGestorVista({ red: (...argumentos) => fetch(...argumentos), entorno: entornoDelNavegador(), visor: visorDeLaPagina });
  return delNavegador;
}
