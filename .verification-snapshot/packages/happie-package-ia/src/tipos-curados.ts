import type { HappiaPackage } from "./tipos";

export interface TipoEventoCurado {
  etiqueta: string;
  clave: string;
}

interface DefinicionTipoCurado extends TipoEventoCurado {
  patrones: RegExp[];
}

/**
 * El catálogo de Happia hoy solo tiene paquetes de cumpleaños (y basura de
 * prueba con nombres como "Paquete Prueba"). Derivar el tipo de evento
 * únicamente del endpoint dejaba el paso 1 del wizard mostrando "Paquete" y
 * "Comida" como si fueran tipos de evento reales — ver `tipos-evento.ts`
 * (retirado). Esta es una taxonomía fija de tipos de evento reales; el
 * conteo de cada uno sí sale del catálogo real, y 0 es un estado válido:
 * significa que Happia todavía no tiene paquetes para ese tipo, no que el
 * tipo no exista.
 */
const DEFINICIONES: DefinicionTipoCurado[] = [
  { etiqueta: "Cumpleaños", clave: "cumpleanos", patrones: [/cumplea/i] },
  { etiqueta: "Fiesta infantil", clave: "fiesta-infantil", patrones: [/infantil/i, /ni[ñn]os?/i] },
  { etiqueta: "Boda", clave: "boda", patrones: [/boda/i, /matrimonio/i, /nupcias/i] },
  { etiqueta: "XV años", clave: "xv-anos", patrones: [/\bxv\b/i, /quince/i, /15\s*a[ñn]os/i] },
  { etiqueta: "San Valentín", clave: "san-valentin", patrones: [/valent[ií]n/i] },
  { etiqueta: "Aniversario", clave: "aniversario", patrones: [/aniversario/i] },
];

export function tiposEventoCurados(paquetes: HappiaPackage[]): (TipoEventoCurado & { cantidad: number })[] {
  const activos = paquetes.filter((p) => p.is_active);
  return DEFINICIONES.map(({ etiqueta, clave, patrones }) => ({
    etiqueta,
    clave,
    cantidad: activos.filter((p) => patrones.some((patron) => patron.test(p.name))).length,
  }));
}

export interface CandidatosTipoCurado {
  paquetes: HappiaPackage[];
  coincidenciaExacta: boolean;
}

/**
 * Si el usuario elige "San Valentín" y no hay ningún paquete categorizado
 * así, la respuesta correcta no es rendirse sin mirar el catálogo — un
 * "Cumpleaños Corazones" literalmente temático de corazones podría encajar.
 * Por eso, sin coincidencia exacta, se manda el catálogo activo completo:
 * la decisión de si algo aplica o no queda en manos del LLM (que sí puede
 * razonar sobre temática/color), no de un filtro de texto que solo sabe
 * decir que no. `coincidenciaExacta` le avisa al caller cuál fue el caso,
 * para ajustar el prompt.
 */
export function paquetesParaTipoCurado(etiqueta: string, paquetes: HappiaPackage[]): CandidatosTipoCurado {
  const activos = paquetes.filter((p) => p.is_active);
  const definicion = DEFINICIONES.find((d) => d.etiqueta === etiqueta);
  const coincidencias = definicion
    ? activos.filter((p) => definicion.patrones.some((patron) => patron.test(p.name)))
    : [];

  return coincidencias.length > 0
    ? { paquetes: coincidencias, coincidenciaExacta: true }
    : { paquetes: activos, coincidenciaExacta: false };
}
