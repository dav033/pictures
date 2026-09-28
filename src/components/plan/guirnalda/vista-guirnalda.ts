import type { ArmadoGuirnaldaResuelto, ArmadoGuirnaldaV1 } from "@/lib/plan/armado-guirnalda";
import { FalloPlanArmado, mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { RESPALDO_VISTA_ARMADO_GUIRNALDA, type OpcionesArmadoGuirnalda, type VistaArmadoGuirnalda } from "@/lib/plan/peticion-armado-guirnalda";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { relojNavegador, type Reloj } from "../autoguardado";
import { claveArmadoGuirnalda } from "./borrador-guirnalda";

/**
 * Vista previa de Python para el borrador del editor de armado de una
 * guirnalda (ADR-0032, E6). Este módulo decide CUÁNDO pedir y QUÉ dibujo
 * vale; pedir (la petición a /api/plan-armado-guirnalda) lo hace quien lo
 * crea. Sin React: el reloj se inyecta y las pruebas lo manejan con uno falso.
 *
 * - Un cambio espera `esperaMs` sin otro cambio antes de pedirse; la receta
 *   (`null`) sale en seguida.
 * - Gana el último borrador: mostrar otro cancela la petición en vuelo y una
 *   respuesta vieja que llegue igual no cuenta.
 * - Mientras llega la respuesta se conserva el último dibujo.
 * - Lo que Python ya dibujó se guarda: deshacer o volver a la receta lo
 *   muestra sin pedirlo otra vez. Lo que ya falló no se vuelve a pedir solo:
 *   "Reintentar" o un cambio.
 * - Las opciones de la pieza llegan con cada respuesta. Al abrir con el
 *   armado del plan (ya dibujado) se pide igual una vez, sin tapar ese dibujo,
 *   solo para saberlas.
 * - Un rechazo de Python (`armado_invalido`) de un borrador del decorador
 *   avisa con su frase (`alRechazar`): el editor lo deshace.
 */

export const CLAVE_RECETA = "receta";
export const ESPERA_VISTA_GUIRNALDA_MS = 300;
/** Dibujos que se recuerdan para deshacer y rehacer sin pedirlos. */
const MAXIMO_RECORDADOS = 40;

/** Qué se sabe del borrador: Python lo dibujó, lo rechazó, no respondió o todavía no contesta. */
export type EstadoBorradorGuirnalda = "listo" | "rechazado" | "fallido" | "pendiente";

export type ErrorVistaGuirnalda = { mensaje: string; armadoInvalido: boolean };

export type EstadoVistaGuirnalda = {
  /** Lo que se dibuja: el del borrador si ya llegó; si no, el último que llegó. */
  vista: ArmadoGuirnaldaResuelto | null;
  /** Lo que Python admite para la pieza; `null` mientras no lo dijo. */
  opciones: OpcionesArmadoGuirnalda | null;
  borrador: EstadoBorradorGuirnalda;
  /** Una petición del borrador está en vuelo ("Dibujando…"). */
  enVuelo: boolean;
  /** El fallo del borrador a la vista (o el de las opciones, si el dibujo es el del plan). */
  error: ErrorVistaGuirnalda | null;
  /** El borrador es la receta de Python (la pieza sin armado en la propuesta). */
  receta: boolean;
  /** El borrador al que se refiere este estado (`CLAVE_RECETA` para la receta); `null` antes de mostrar ninguno. */
  clave: string | null;
};

export type PedirVistaGuirnalda = (armado: ArmadoGuirnaldaV1 | null, signal: AbortSignal) => Promise<VistaArmadoGuirnalda>;

export type OpcionesVistaGuirnalda = {
  pedir: PedirVistaGuirnalda;
  /** El armado que ya trae el plan: se dibuja sin esperar otro. */
  inicial?: ArmadoGuirnaldaResuelto | null;
  esperaMs?: number;
  reloj?: Reloj;
  /** Python rechazó un borrador del decorador (no la receta ni la petición de opciones). */
  alRechazar?: (mensaje: string) => void;
};

export type VistaGuirnalda = {
  estado: () => EstadoVistaGuirnalda;
  suscribir: (oyente: () => void) => () => void;
  /** El borrador a la vista; `null` pide la receta. */
  mostrar: (armado: ArmadoGuirnaldaV1 | null) => void;
  reintentar: () => void;
  /** Otra función de pedir y otro aviso de rechazo (los del último render). */
  usar: (actual: Pick<OpcionesVistaGuirnalda, "pedir" | "alRechazar">) => void;
  /** Cancela lo que quede (el editor se cerró). */
  cerrar: () => void;
};

type Objetivo = { clave: string; armado: ArmadoGuirnaldaV1 | null };
type EnVuelo = { numero: number; clave: string; controlador: AbortController; soloOpciones: boolean };

const INICIAL: EstadoVistaGuirnalda = { vista: null, opciones: null, borrador: "pendiente", enVuelo: false, error: null, receta: false, clave: null };

export function crearVistaGuirnalda(opciones: OpcionesVistaGuirnalda): VistaGuirnalda {
  const { esperaMs = ESPERA_VISTA_GUIRNALDA_MS, reloj = relojNavegador } = opciones;
  let { pedir, alRechazar } = opciones;
  const recordados = new Map<string, ArmadoGuirnaldaResuelto>();
  let ultimo: ArmadoGuirnaldaResuelto | null = opciones.inicial ?? null;
  if (opciones.inicial) recordados.set(claveArmadoGuirnalda(opciones.inicial.armado), opciones.inicial);
  let admitidas: OpcionesArmadoGuirnalda | null = null;
  let objetivo: Objetivo | null = null;
  let fallo: (ErrorVistaGuirnalda & { clave: string; soloOpciones: boolean }) | null = null;
  let vuelo: EnVuelo | null = null;
  let numero = 0;
  let cancelarEspera: (() => void) | null = null;
  let instantanea = INICIAL;
  const oyentes = new Set<() => void>();

  function recordar(clave: string, vista: ArmadoGuirnaldaResuelto): void {
    recordados.delete(clave);
    recordados.set(clave, vista);
    while (recordados.size > MAXIMO_RECORDADOS) recordados.delete(recordados.keys().next().value!);
  }

  function calcular(): EstadoVistaGuirnalda {
    if (!objetivo) return { ...INICIAL, vista: ultimo, opciones: admitidas };
    const respondido = recordados.get(objetivo.clave);
    const propio = fallo && fallo.clave === objetivo.clave ? fallo : null;
    const borrador: EstadoBorradorGuirnalda = respondido
      ? "listo"
      : propio && !propio.soloOpciones ? (propio.armadoInvalido ? "rechazado" : "fallido") : "pendiente";
    return {
      vista: respondido ?? ultimo,
      opciones: admitidas,
      borrador,
      enVuelo: vuelo !== null && !vuelo.soloOpciones,
      error: propio ? { mensaje: propio.mensaje, armadoInvalido: propio.armadoInvalido } : null,
      receta: objetivo.clave === CLAVE_RECETA,
      clave: objetivo.clave,
    };
  }

  function emitir(): void {
    const siguiente = calcular();
    const igual = (Object.keys(siguiente) as Array<keyof EstadoVistaGuirnalda>).every((clave) => siguiente[clave] === instantanea[clave]);
    if (igual) return;
    instantanea = siguiente;
    for (const oyente of oyentes) oyente();
  }

  function detenerEspera(): void {
    cancelarEspera?.();
    cancelarEspera = null;
  }

  function lanzar(soloOpciones: boolean): void {
    if (!objetivo) return;
    vuelo?.controlador.abort();
    const propio: EnVuelo = { numero: ++numero, clave: objetivo.clave, controlador: new AbortController(), soloOpciones };
    vuelo = propio;
    let respuesta: Promise<VistaArmadoGuirnalda>;
    try {
      respuesta = pedir(objetivo.armado, propio.controlador.signal);
    } catch (error) {
      respuesta = Promise.reject(error);
    }
    respuesta.then(
      ({ armado: vista, opciones: llegadas }) => {
        if (vuelo?.numero !== propio.numero) return;
        vuelo = null;
        recordar(propio.clave, vista);
        recordar(claveArmadoGuirnalda(vista.armado), vista);
        admitidas = llegadas;
        ultimo = vista;
        if (fallo?.clave === propio.clave) fallo = null;
        emitir();
      },
      (error: unknown) => {
        if (esCancelacion(error) || vuelo?.numero !== propio.numero) return;
        vuelo = null;
        const armadoInvalido = error instanceof FalloPlanArmado && error.armadoInvalido;
        const mensaje = mensajeFalloPlanArmado(error, RESPALDO_VISTA_ARMADO_GUIRNALDA);
        fallo = { clave: propio.clave, mensaje, armadoInvalido, soloOpciones };
        emitir();
        if (armadoInvalido && !soloOpciones && propio.clave !== CLAVE_RECETA) alRechazar?.(mensaje);
      },
    );
    emitir();
  }

  function programar(): void {
    if (!objetivo) return;
    detenerEspera();
    // Lo que vuele para otro borrador ya no cuenta, aunque el nuevo espere su pausa: si no, un
    // rechazo tardío del viejo pasaba por el del borrador a la vista y el editor deshacía el nuevo.
    if (vuelo && vuelo.clave !== objetivo.clave) {
      vuelo.controlador.abort();
      vuelo = null;
    }
    const respondido = recordados.has(objetivo.clave);
    if (respondido) {
      // Ya dibujado; faltando las opciones, se piden sin tapar el dibujo.
      if (admitidas === null && !vuelo && fallo?.clave !== objetivo.clave) lanzar(true);
      emitir();
      return;
    }
    if (fallo?.clave === objetivo.clave) {
      emitir();
      return;
    }
    const espera = objetivo.clave === CLAVE_RECETA ? 0 : esperaMs;
    cancelarEspera = reloj(() => {
      cancelarEspera = null;
      lanzar(false);
    }, espera);
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
      const clave = armado ? claveArmadoGuirnalda(armado) : CLAVE_RECETA;
      if (objetivo?.clave === clave) return;
      objetivo = { clave, armado };
      programar();
    },
    reintentar() {
      if (!objetivo) return;
      if (fallo?.clave === objetivo.clave) fallo = null;
      programar();
    },
    usar(actual) {
      pedir = actual.pedir;
      alRechazar = actual.alRechazar;
    },
    cerrar() {
      detenerEspera();
      vuelo?.controlador.abort();
      vuelo = null;
    },
  };
}

/**
 * El estado para el borrador que el editor tiene a la vista EN ESTE render.
 * El borrador llega al controlador en un efecto (`mostrar`), después del
 * render: mientras tanto la instantánea es la del borrador anterior, y su
 * "listo" no vale para el nuevo (el autoguardado lo tomaba por dibujado y lo
 * guardaba sin que Python lo viera). Si no son el mismo, el nuevo está pendiente.
 */
export function alBorrador(estado: EstadoVistaGuirnalda, armado: ArmadoGuirnaldaV1 | null): EstadoVistaGuirnalda {
  const clave = armado ? claveArmadoGuirnalda(armado) : CLAVE_RECETA;
  if (estado.clave === clave) return estado;
  return { ...estado, clave, borrador: "pendiente", error: null, receta: armado === null };
}

/** Lo que muestra el panel de la vista previa, con cada estado explícito. */
export type PanelVistaGuirnalda =
  /** Nada que dibujar todavía: Python está armando. */
  | { fase: "cargando" }
  /** Python no puede armar esta guirnalda sin cambiar la compra (la receta se rechazó). */
  | { fase: "vacio"; mensaje: string }
  /** Nada que dibujar y Python no respondió (o rechazó un borrador sin dibujo previo). */
  | { fase: "error"; mensaje: string; reintentable: boolean }
  /** Un dibujo de Python; `actualizando`: el del borrador nuevo está en camino; `fallo`: el último no llegó. */
  | { fase: "listo"; vista: ArmadoGuirnaldaResuelto; actualizando: boolean; fallo: string | null };

export function panelVistaGuirnalda(estado: EstadoVistaGuirnalda): PanelVistaGuirnalda {
  if (estado.vista) {
    return {
      fase: "listo",
      vista: estado.vista,
      actualizando: estado.borrador === "pendiente",
      fallo: estado.borrador === "fallido" ? estado.error?.mensaje ?? RESPALDO_VISTA_ARMADO_GUIRNALDA : null,
    };
  }
  if (estado.borrador === "pendiente") return { fase: "cargando" };
  if (estado.error?.armadoInvalido && estado.receta) return { fase: "vacio", mensaje: estado.error.mensaje };
  return { fase: "error", mensaje: estado.error?.mensaje ?? RESPALDO_VISTA_ARMADO_GUIRNALDA, reintentable: !estado.error?.armadoInvalido };
}
