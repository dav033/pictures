/**
 * Ambiente del visor del taller: luz (neutra, cálida, fría, UV) y lente (gran angular, normal, tele). Son valores de
 * óptica para el visor: el color y la fuerza del sol y de la luz de ambiente, la luz de entorno y el campo de visión de
 * la cámara. La luz «neutra» no reemplaza nada: la luz de la sala (cálida si la sala tiene ambiente) sigue como está, y
 * la lente «normal» deja la cámara de siempre.
 */

export type IdLuz = "neutra" | "calida" | "fria" | "uv";
export type IdLente = "gran_angular" | "normal" | "tele";
export type AmbienteVisor = { luz: IdLuz; lente: IdLente };

/** El color y la fuerza del sol y de la luz de ambiente que reemplazan a los de la sala. */
export type AjusteLuzVisor = { colorSol: string; intensidadSol: number; colorAmbiente: string; intensidadAmbiente: number };

/** Lo que el visor aplica: `luz` null es «la de la sala»; la intensidad del entorno y el campo de visión siempre van. */
export type AjusteOpticoVisor = { luz: AjusteLuzVisor | null; intensidadEntorno: number; fovGrados: number };

const ENTORNO_BASE = 0.55;
const FOV_BASE = 35;

const LUCES: Readonly<Record<IdLuz, { nombre: string; luz: AjusteLuzVisor | null; intensidadEntorno: number }>> = {
  neutra: { nombre: "Neutra", luz: null, intensidadEntorno: ENTORNO_BASE },
  calida: { nombre: "Cálida", luz: { colorSol: "#ffd9a8", intensidadSol: 1.4, colorAmbiente: "#ffe9c9", intensidadAmbiente: 0.12 }, intensidadEntorno: 0.6 },
  fria: { nombre: "Fría", luz: { colorSol: "#d4e6ff", intensidadSol: 1.4, colorAmbiente: "#dfeaff", intensidadAmbiente: 0.1 }, intensidadEntorno: ENTORNO_BASE },
  uv: { nombre: "UV (luz negra)", luz: { colorSol: "#8f6bff", intensidadSol: 0.9, colorAmbiente: "#6a4cff", intensidadAmbiente: 0.03 }, intensidadEntorno: 0.12 },
};

export const LENTES_VISOR: Readonly<Record<IdLente, { nombre: string; fovGrados: number }>> = {
  gran_angular: { nombre: "Gran angular", fovGrados: 55 },
  normal: { nombre: "Normal", fovGrados: FOV_BASE },
  tele: { nombre: "Tele", fovGrados: 18 },
};

export const NOMBRES_LUZ_VISOR: Readonly<Record<IdLuz, string>> = { neutra: LUCES.neutra.nombre, calida: LUCES.calida.nombre, fria: LUCES.fria.nombre, uv: LUCES.uv.nombre };

export const AJUSTE_VISOR_DEFECTO: AmbienteVisor = { luz: "neutra", lente: "normal" };

/** El visor sin ambiente elegido: la luz de la sala, el entorno y la cámara de siempre. */
export const OPTICO_NEUTRO: AjusteOpticoVisor = { luz: null, intensidadEntorno: ENTORNO_BASE, fovGrados: FOV_BASE };

const CLAVE_AMBIENTE_VISOR = "taller3d.visor.ambiente.v1";

/** Lo que el visor aplica para ese ambiente. */
export function ajusteOpticoDe(ambiente: AmbienteVisor): AjusteOpticoVisor {
  const luz = LUCES[ambiente.luz];
  return { luz: luz.luz, intensidadEntorno: luz.intensidadEntorno, fovGrados: LENTES_VISOR[ambiente.lente].fovGrados };
}

const esLuz = (v: unknown): v is IdLuz => typeof v === "string" && Object.hasOwn(LUCES, v);
const esLente = (v: unknown): v is IdLente => typeof v === "string" && Object.hasOwn(LENTES_VISOR, v);

/** El ambiente guardado en este navegador; cada campo que falte o no sea válido sale por su defecto. Nunca lanza. */
export function leerAmbienteVisor(almacen: Pick<Storage, "getItem"> | undefined): AmbienteVisor {
  try {
    const crudo = almacen?.getItem(CLAVE_AMBIENTE_VISOR);
    if (!crudo) return AJUSTE_VISOR_DEFECTO;
    const datos = JSON.parse(crudo) as Partial<Record<keyof AmbienteVisor, unknown>> | null;
    return {
      luz: esLuz(datos?.luz) ? datos.luz : AJUSTE_VISOR_DEFECTO.luz,
      lente: esLente(datos?.lente) ? datos.lente : AJUSTE_VISOR_DEFECTO.lente,
    };
  } catch {
    return AJUSTE_VISOR_DEFECTO;
  }
}

/** Guarda el ambiente; `false` si el navegador no deja escribir. Nunca lanza. */
export function guardarAmbienteVisor(almacen: Pick<Storage, "setItem"> | undefined, ambiente: AmbienteVisor): boolean {
  try {
    almacen?.setItem(CLAVE_AMBIENTE_VISOR, JSON.stringify(ambiente));
    return almacen !== undefined;
  } catch {
    return false;
  }
}
