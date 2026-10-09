import { centroCuerpo } from "@/lib/globos3d/geometria";
import { formatoPorId } from "@/lib/globos3d/formatos";
import { armarEscena, type Caja, type Escena, type EscenaArmada, type Sala } from "@/lib/globos3d/escena";
import type { ConfigModulo } from "./configuracion";

/**
 * La escena del estudio: UN módulo apoyado en el piso, centrado, y una sala vacía (sin piso, paredes ni techo dibujados:
 * el visor deja solo la sombra suave bajo el módulo y el fondo lo pone la página). Es el mismo `armarEscena` del taller,
 * así que el módulo sale idéntico al del Taller 3D. Sin three.js: sirve al visor y a las pruebas.
 */

/** Sala sin superficies: con ella el visor no dibuja la cuadrícula y solo deja el piso que recibe la sombra. */
export const SALA_ESTUDIO: Sala = {
  anchoCm: 600, fondoCm: 500, altoCm: 320,
  tonos: { piso: "#e6e6e9", paredes: "#e6e6e9", techo: "#e6e6e9" },
  mostrar: { piso: false, fondo: false, laterales: false, techo: false },
};

export const NODO_MODULO = "modulo";

export function escenaEstudio(config: ConfigModulo): Escena {
  const formato = formatoPorId(config.formatoId);
  if (!formato) throw new Error(`Formato desconocido: ${config.formatoId}`);
  return {
    sala: SALA_ESTUDIO,
    nodos: [{
      id: NODO_MODULO,
      nombre: "Módulo",
      pieza: { tipo: "modulo", modulo: config.tipo, formatoId: config.formatoId, infladoCm: formato.infladoDecoracionCm, colores: [...config.colores] },
      colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 },
    }],
  };
}

export function armarEstudio(config: ConfigModulo): EscenaArmada {
  return armarEscena(escenaEstudio(config));
}

/** La caja (cm, mundo) del cuerpo del globo `indice`: para marcarlo en el visor cuando se elige su color. */
export function cajaDeGlobo(armada: EscenaArmada, indice: number): Caja | null {
  const globo = armada.porNodo[0]?.globos[indice];
  if (!globo) return null;
  const alcance = centroCuerpo("redondo", globo.infladoCm) + globo.cuelloExtraCm;
  const centro = { x: globo.nudo.x + globo.direccion.x * alcance, y: globo.nudo.y + globo.direccion.y * alcance, z: globo.nudo.z + globo.direccion.z * alcance };
  const r = globo.infladoCm / 2;
  return { min: { x: centro.x - r, y: centro.y - r, z: centro.z - r }, max: { x: centro.x + r, y: centro.y + r, z: centro.z + r } };
}
