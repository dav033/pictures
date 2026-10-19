import { RANGOS_ESTRUCTURA } from "../herramientas-escena-estructuras";
import type { PiezaEspec } from "./espec-cliente-v1";
import { RANGOS_CLASICOS } from "./constructores-clasicos";
import { RANGO_ARCO } from "./constructores-organicos";
import { RANGO_GROSOR_GUIADA_CM } from "./medidas-espec";

/**
 * **Qué medidas se le pueden cambiar a cada pieza y hasta dónde** (metros): los rangos con que el constructor de cada una
 * arma, que son los de `RANGOS_ESTRUCTURA` y los de los constructores de cuartetos, y el grosor del cliente (`RANGO_GROSOR_GUIADA_CM`,
 * más estrecho que el del Taller). Es lo que acota las ediciones de tamaño: una medida fuera de rango se acota y se dice, no se manda
 * al constructor para que lo haga callado.
 */
export type CampoMedida = "anchoM" | "altoM" | "largoM";
export type RangoMedida = readonly [number, number];
export type MedidasEditables = Partial<Record<CampoMedida, RangoMedida>>;

const m = (rango: readonly [number, number]): RangoMedida => [rango[0] / 100, rango[1] / 100];

const ARCO_ORGANICO: MedidasEditables = { anchoM: m(RANGO_ARCO.ancho), altoM: m(RANGO_ARCO.alto) };
const ARCO_CLASICO: MedidasEditables = { anchoM: m(RANGOS_CLASICOS.arco.ancho), altoM: m(RANGOS_CLASICOS.arco.alto) };
const COLUMNA_ORGANICA: MedidasEditables = { altoM: m(RANGOS_ESTRUCTURA.columna_organica.alto_cm), anchoM: m(RANGO_GROSOR_GUIADA_CM.columna) };
const SEMIARCO: MedidasEditables = { anchoM: m(RANGOS_ESTRUCTURA.semiarco_organico.ancho_cm), altoM: m(RANGOS_ESTRUCTURA.semiarco_organico.alto_cm) };

/**
 * Las medidas que cada pieza oficial deja cambiar, con su rango. Una pieza sin entradas (el centro de mesa, la figura, las
 * paredes que el motor no arma) no tiene medidas que editar. El aro se mide por su diámetro (`anchoM`; el alto lo sigue).
 */
export function medidasEditables(pieza: Pick<PiezaEspec, "oficial" | "tamanos">): MedidasEditables {
  const clasica = pieza.tamanos === "clasica";
  switch (pieza.oficial) {
    case "arco": return clasica ? ARCO_CLASICO : ARCO_ORGANICO;
    case "arco_asimetrico":
    case "arco_no_denso": return ARCO_ORGANICO;
    case "semiarco":
    case "semiarco_asimetrico": return SEMIARCO;
    case "columna": return clasica ? { altoM: m(RANGOS_CLASICOS.columna.alto) } : COLUMNA_ORGANICA;
    case "columna_asimetrica":
    case "columna_no_densa": return COLUMNA_ORGANICA;
    case "guirnalda": return { largoM: m(clasica ? RANGOS_CLASICOS.guirnalda.ancho : RANGOS_ESTRUCTURA.guirnalda_organica.ancho_cm) };
    case "aro_circular": return { anchoM: m(RANGOS_ESTRUCTURA.aro_organico.diametro_cm) };
    case "pared_densa": return { anchoM: m(RANGOS_CLASICOS.pared.ancho), altoM: m(RANGOS_CLASICOS.pared.alto) };
    case "techo_globos": return { anchoM: m(RANGOS_CLASICOS.techo.ancho), altoM: m(RANGOS_CLASICOS.techo.fondo) };
    case "bouquet": return { altoM: m(RANGOS_CLASICOS.ramo.alto) };
    default: return {};
  }
}
