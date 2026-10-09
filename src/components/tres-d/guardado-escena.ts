import { ambienteNormalizado, type Escena } from "@/lib/globos3d/escena";
import { esPlantillaSinTocar } from "@/lib/globos3d/escenas-presets";

/**
 * La escena del taller guardada en este navegador (localStorage): se guarda sola tras cada cambio y se recupera al
 * volver a /3d. Lo que no cuadra (otra versión, datos dañados) se descarta y el taller abre la sala vacía.
 */
const CLAVE = "taller3d:escena:v1";

export type EscenaGuardada = { nombre: string; escena: Escena };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numero = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Lo mínimo para que el taller la pueda abrir: sala con medidas y piezas con id, nombre, tipo y colocación. */
function valida(v: unknown): v is EscenaGuardada {
  if (!esObjeto(v) || typeof v.nombre !== "string" || !esObjeto(v.escena)) return false;
  const { sala, nodos } = v.escena;
  if (!esObjeto(sala) || !numero(sala.anchoCm) || !numero(sala.fondoCm) || !numero(sala.altoCm) || !esObjeto(sala.tonos) || !esObjeto(sala.mostrar)) return false;
  if (!Array.isArray(nodos)) return false;
  return nodos.every((n) => esObjeto(n) && typeof n.id === "string" && typeof n.nombre === "string" && esObjeto(n.pieza) && typeof n.pieza.tipo === "string" && esObjeto(n.colocacion) && typeof n.colocacion.en === "string");
}

export function leerGuardada(): EscenaGuardada | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const datos: unknown = JSON.parse(crudo);
    if (!valida(datos)) return null;
    // La plantilla con que abría el taller, sin tocar, no es trabajo de nadie: se abre la sala vacía de ahora.
    if (esPlantillaSinTocar(datos.escena)) return null;
    // El ambiente de la sala es opcional: lo que no cuadra se descarta (la sala queda neutra), no la escena entera.
    const ambiente = ambienteNormalizado((datos.escena.sala as { ambiente?: unknown }).ambiente);
    if (ambiente) datos.escena.sala.ambiente = ambiente; else delete datos.escena.sala.ambiente;
    return datos;
  } catch {
    return null;
  }
}

/** `false` si el navegador no dejó guardarla (almacenamiento lleno o bloqueado). */
export function guardarEscena(g: EscenaGuardada): boolean {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(g));
    return true;
  } catch {
    return false;
  }
}
