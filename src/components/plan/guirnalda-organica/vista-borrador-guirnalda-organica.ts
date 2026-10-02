import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { FalloPlanArmado, mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { RESPALDO_VISTA_ARMADO_GUIRNALDA_ORGANICA, type VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { relojNavegador, type Reloj } from "../autoguardado";
import { claveArmadoGuirnaldaOrganica } from "./borrador-guirnalda-organica";
import type { PanelVistaGuirnaldaOrganica } from "./vista-guirnalda-organica";

/**
 * El dibujo que el motor hace del borrador del editor de guirnaldas del motor (ADR-0035, paso 3). Este módulo decide CUÁNDO
 * pedir y QUÉ dibujo vale; pedir (la petición a /api/plan-armado-guirnalda-organica) lo hace quien lo crea. Sin React: el
 * reloj se inyecta y las pruebas lo manejan con uno falso. Es el gemelo del del arco y del de la guirnalda por
 * partes (ADR-0032, E6), sin receta ni opciones aparte: el dibujo ya trae las suyas.
 *
 * - Un cambio espera `esperaMs` sin otro cambio antes de pedirse: un deslizador o varios toques seguidos son una
 *   sola petición.
 * - Gana el último borrador: mostrar otro cancela la petición en vuelo (`AbortController`) y una respuesta que
 *   llegue igual de una petición ya superada no cuenta, **nunca se pinta**.
 * - Mientras llega el dibujo del borrador se conserva el último que sí llegó, marcado como pendiente
 *   (`borrador: "pendiente"`): quien lo muestre tiene que decir que está por actualizarse.
 * - Lo que el motor ya dibujó se recuerda: volver a un borrador anterior se muestra sin pedirlo otra vez. Lo
 *   que ya falló no se vuelve a pedir solo: hace falta `reintentar` o un cambio.
 * - Un rechazo del motor (`armado_invalido`) trae su frase en español y no se reintenta: pedirlo daría lo mismo.
 *
 * Aquí no se cuenta, no se mide y no se dibuja nada: la guirnalda, su gráfica, sus avisos, las herramientas del
 * diseñador (`opciones`) y los rangos vivos (`limites`) son los de la respuesta.
 */

export const ESPERA_VISTA_GUIRNALDA_ORGANICA_MS = 300;
/** Dibujos que se recuerdan para volver a un borrador sin pedirlo. */
const MAXIMO_RECORDADOS = 40;

/** Qué se sabe del borrador: el motor lo dibujó, lo rechazó, no respondió o todavía no contesta. */
export type EstadoBorradorGuirnaldaOrganica = "listo" | "rechazado" | "fallido" | "pendiente";

export type ErrorVistaBorradorGuirnaldaOrganica = { mensaje: string; armadoInvalido: boolean };

export type EstadoVistaBorradorGuirnaldaOrganica = {
  /** Lo que se dibuja: el del borrador si ya llegó; si no, el último que llegó (viejo). */
  vista: VistaArmadoGuirnaldaOrganica | null;
  borrador: EstadoBorradorGuirnaldaOrganica;
  /** Una petición del borrador está en vuelo. */
  enVuelo: boolean;
  /** Por qué el borrador no se dibujó (`rechazado` o `fallido`). */
  error: ErrorVistaBorradorGuirnaldaOrganica | null;
  /** El borrador al que se refiere este estado; `null` antes de mostrar ninguno. */
  clave: string | null;
};

export type PedirVistaBorradorGuirnaldaOrganica = (armado: ArmadoGuirnaldaOrganicaV1, signal: AbortSignal) => Promise<VistaArmadoGuirnaldaOrganica>;

export type OpcionesVistaBorradorGuirnaldaOrganica = {
  pedir: PedirVistaBorradorGuirnaldaOrganica;
  /** El dibujo del armado que ya trae el plan: se muestra sin pedirlo otra vez. */
  inicial?: VistaArmadoGuirnaldaOrganica | null;
  esperaMs?: number;
  reloj?: Reloj;
};

export type VistaBorradorGuirnaldaOrganica = {
  estado: () => EstadoVistaBorradorGuirnaldaOrganica;
  suscribir: (oyente: () => void) => () => void;
  /** El borrador a la vista. */
  mostrar: (armado: ArmadoGuirnaldaOrganicaV1) => void;
  reintentar: () => void;
  /**
   * Los colores de la pieza cambiaron: nada de lo que el motor dibujó ni de lo que falló sirve ya (los mismos
   * índices apuntan a otros colores), así que se olvida y el borrador a la vista se vuelve a pedir.
   */
  reiniciar: () => void;
  /** Otra función de pedir (la del último render). */
  usar: (actual: Pick<OpcionesVistaBorradorGuirnaldaOrganica, "pedir">) => void;
  /** Cancela lo que quede (el editor se cerró); un `mostrar` después empieza de nuevo. */
  cerrar: () => void;
};

type Objetivo = { clave: string; armado: ArmadoGuirnaldaOrganicaV1 };
type EnVuelo = { numero: number; clave: string; controlador: AbortController };

const INICIAL: EstadoVistaBorradorGuirnaldaOrganica = { vista: null, borrador: "pendiente", enVuelo: false, error: null, clave: null };

export function crearVistaBorradorGuirnaldaOrganica(opciones: OpcionesVistaBorradorGuirnaldaOrganica): VistaBorradorGuirnaldaOrganica {
  const { esperaMs = ESPERA_VISTA_GUIRNALDA_ORGANICA_MS, reloj = relojNavegador } = opciones;
  let { pedir } = opciones;
  const recordados = new Map<string, VistaArmadoGuirnaldaOrganica>();
  let ultimo: VistaArmadoGuirnaldaOrganica | null = opciones.inicial ?? null;
  if (opciones.inicial) recordados.set(claveArmadoGuirnaldaOrganica(opciones.inicial.armado), opciones.inicial);
  // Con el dibujo del plan en la mano, el borrador a la vista es ese mismo: sin petición y sin un primer "pendiente".
  let objetivo: Objetivo | null = opciones.inicial
    ? { clave: claveArmadoGuirnaldaOrganica(opciones.inicial.armado), armado: opciones.inicial.armado }
    : null;
  let fallo: (ErrorVistaBorradorGuirnaldaOrganica & { clave: string }) | null = null;
  let vuelo: EnVuelo | null = null;
  let numero = 0;
  let cancelarEspera: (() => void) | null = null;
  let instantanea = INICIAL;
  const oyentes = new Set<() => void>();

  function recordar(clave: string, vista: VistaArmadoGuirnaldaOrganica): void {
    recordados.delete(clave);
    recordados.set(clave, vista);
    while (recordados.size > MAXIMO_RECORDADOS) recordados.delete(recordados.keys().next().value!);
  }

  function calcular(): EstadoVistaBorradorGuirnaldaOrganica {
    if (!objetivo) return { ...INICIAL, vista: ultimo };
    const respondido = recordados.get(objetivo.clave);
    const propio = fallo && fallo.clave === objetivo.clave ? fallo : null;
    const borrador: EstadoBorradorGuirnaldaOrganica = respondido ? "listo" : propio ? (propio.armadoInvalido ? "rechazado" : "fallido") : "pendiente";
    return {
      vista: respondido ?? ultimo,
      borrador,
      enVuelo: vuelo !== null,
      error: propio ? { mensaje: propio.mensaje, armadoInvalido: propio.armadoInvalido } : null,
      clave: objetivo.clave,
    };
  }

  function emitir(): void {
    const siguiente = calcular();
    const igual = (Object.keys(siguiente) as Array<keyof EstadoVistaBorradorGuirnaldaOrganica>).every((clave) => siguiente[clave] === instantanea[clave]);
    if (igual) return;
    instantanea = siguiente;
    for (const oyente of oyentes) oyente();
  }

  function detenerEspera(): void {
    cancelarEspera?.();
    cancelarEspera = null;
  }

  function lanzar(): void {
    if (!objetivo) return;
    vuelo?.controlador.abort();
    const propio: EnVuelo = { numero: ++numero, clave: objetivo.clave, controlador: new AbortController() };
    vuelo = propio;
    let respuesta: Promise<VistaArmadoGuirnaldaOrganica>;
    try {
      respuesta = pedir(objetivo.armado, propio.controlador.signal);
    } catch (error) {
      respuesta = Promise.reject(error);
    }
    respuesta.then(
      (vista) => {
        // Una petición superada (otro borrador la canceló o la reemplazó) no pinta nada, llegue cuando llegue.
        if (vuelo?.numero !== propio.numero) return;
        vuelo = null;
        recordar(propio.clave, vista);
        ultimo = vista;
        if (fallo?.clave === propio.clave) fallo = null;
        emitir();
      },
      (error: unknown) => {
        if (esCancelacion(error) || vuelo?.numero !== propio.numero) return;
        vuelo = null;
        fallo = {
          clave: propio.clave,
          mensaje: mensajeFalloPlanArmado(error, RESPALDO_VISTA_ARMADO_GUIRNALDA_ORGANICA),
          armadoInvalido: error instanceof FalloPlanArmado && error.armadoInvalido,
        };
        emitir();
      },
    );
    emitir();
  }

  function programar(): void {
    if (!objetivo) return;
    detenerEspera();
    // Lo que vuele para otro borrador ya no cuenta, aunque el nuevo espere su pausa: si no, un rechazo o un
    // fallo tardío del viejo pasaba por el del borrador a la vista.
    if (vuelo && vuelo.clave !== objetivo.clave) {
      vuelo.controlador.abort();
      vuelo = null;
    }
    if (recordados.has(objetivo.clave) || fallo?.clave === objetivo.clave) {
      emitir();
      return;
    }
    cancelarEspera = reloj(() => {
      cancelarEspera = null;
      lanzar();
    }, esperaMs);
    emitir();
  }

  // El dibujo del plan se ve desde el primer render, antes de mostrar ningún borrador.
  instantanea = calcular();

  return {
    estado: () => instantanea,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
    mostrar(armado) {
      const clave = claveArmadoGuirnaldaOrganica(armado);
      if (objetivo?.clave === clave) return;
      objetivo = { clave, armado };
      programar();
    },
    reintentar() {
      if (!objetivo) return;
      if (fallo?.clave === objetivo.clave) fallo = null;
      programar();
    },
    reiniciar() {
      recordados.clear();
      fallo = null;
      detenerEspera();
      vuelo?.controlador.abort();
      vuelo = null;
      if (objetivo) programar();
      else emitir();
    },
    usar(actual) {
      pedir = actual.pedir;
    },
    cerrar() {
      // Sin borrador: el siguiente `mostrar` (el segundo montaje de StrictMode, Fast Refresh) vuelve a pedir lo
      // que esto cancela; si no, veía la misma clave y no pedía nada.
      objetivo = null;
      detenerEspera();
      vuelo?.controlador.abort();
      vuelo = null;
    },
  };
}

/**
 * El estado para el borrador que el editor tiene a la vista EN ESTE render. El borrador llega al controlador en
 * un efecto (`mostrar`), después del render: mientras tanto la instantánea es la del borrador anterior, y su
 * "listo" no vale para el nuevo (Guardar lo tomaba por dibujado y guardaba sin que el motor lo viera). Si no son
 * el mismo, el nuevo está pendiente.
 */
export function alBorradorGuirnaldaOrganica(estado: EstadoVistaBorradorGuirnaldaOrganica, armado: ArmadoGuirnaldaOrganicaV1): EstadoVistaBorradorGuirnaldaOrganica {
  const clave = claveArmadoGuirnaldaOrganica(armado);
  if (estado.clave === clave) return estado;
  return { ...estado, clave, borrador: "pendiente", error: null };
}

/**
 * Lo que dibuja el panel del bloque mientras se edita: el dibujo del borrador si ya llegó, el último que llegó
 * marcado como "actualizando" mientras el nuevo está en camino, y, si el motor lo rechazó o no respondió, el último
 * marcado como vencido. La frase del rechazo no entra aquí: la dice el editor, junto a los mandos que la provocaron.
 */
export function panelDeBorradorGuirnaldaOrganica(estado: EstadoVistaBorradorGuirnaldaOrganica): PanelVistaGuirnaldaOrganica {
  if (!estado.vista) return { fase: "cargando" };
  const sinDibujo = estado.borrador === "rechazado" || estado.borrador === "fallido";
  return { fase: "listo", vista: estado.vista, actualizando: estado.borrador === "pendiente", fallo: null, ...(sinDibujo ? { vencido: true } : {}) };
}
