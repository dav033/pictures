import { RANGOS_ESTRUCTURA, grosorDeAro } from "./herramientas-escena-estructuras";
import { conGrosor, opcionesDe, type PiezaOrganica } from "./organico-ajustes";
import { LARGO_MAXIMO_CUERPO_CM, PRESUPUESTO_CUERPO_CM3, cuerpoDeOrganico, grosorQueCabe, volumenDeCuerpoCm3, type Cuerpo } from "./presupuesto-cuerpo";
import { GROSOR_CUERPO_CM } from "./trazo-organico";

/**
 * Los topes de armado (`presupuesto-cuerpo.ts`) en lo que engruesa o abulta `ajustar_tamanos` («más tupida», «más R-24» cuando ya no
 * caben, «más abultada»): la pieza se mide igual que al crearla o cambiarla, por las opciones con que se arma (un arco por medidas, por
 * las mismas que tiene cuando pasa a orgánico), y nunca se engruesa por encima del tope: se acota y se dice. El aro, además, no pasa
 * de su rango de grosor.
 */

/** Lo menos que vale la pena engrosar todo el cuerpo (fracción): por debajo, ya está en el tope. */
const ENGROSAR_MINIMO = 0.01;
/** Pasos de la búsqueda del mayor factor que cabe (cada uno parte en dos lo que queda). */
const PASOS_BUSQUEDA = 12;
const TOPE_ARO_CM = RANGOS_ESTRUCTURA.aro_organico.grosor_cm[1];

export const cuerpoDePieza = (p: PiezaOrganica): Cuerpo => cuerpoDeOrganico(opcionesDe(p));

/** El grosor de la pieza tal como se pide: el diámetro de la base del arco, el mayor de los puntos del trazo o el de lo más grueso. */
function grosorDePieza(p: PiezaOrganica): number {
  if (p.tipo === "arco_organico") return 2 * p.arco.radioBaseCm;
  if (p.generador?.tipo === "trazo") return Math.max(...p.generador.trazo.puntos.map((q) => q.grosor));
  return 2 * Math.max(0, ...p.opciones.tramos.flatMap((t) => t.grosor.map((g) => g.radioCm)));
}

/** El tope de armado, dicho para el modelo: «pasaría del presupuesto de armado (con 879 cm de largo, lo más grueso …)». Engrosar es `conGrosor`, todo a escala. */
export function textoTope(p: PiezaOrganica): string {
  const grosor = grosorDePieza(p);
  const queCabe = grosorQueCabe((g) => cuerpoDePieza(conGrosor(p, g / grosor)), GROSOR_CUERPO_CM.max);
  return `pasaría del presupuesto de armado (con ${Math.round(cuerpoDePieza(p).largoCm)} cm de largo, lo más grueso que se arma de una vez es ${queCabe} cm)`;
}

/** Qué tope pasaría el cambio (el rango del aro, o los de armado), o null si cabe. Lo que ya pasaba de un tope no cuenta si no empeora. */
function topePasado(antes: PiezaOrganica, despues: PiezaOrganica): "aro" | "armado" | null {
  const aro = grosorDeAro(opcionesDe(despues));
  if (aro !== null && aro > TOPE_ARO_CM && aro > (grosorDeAro(opcionesDe(antes)) ?? 0)) return "aro";
  const a = cuerpoDePieza(antes), d = cuerpoDePieza(despues);
  const volumen = (c: Cuerpo) => volumenDeCuerpoCm3(c.largoCm, c.grosorCm);
  return volumen(d) > Math.max(PRESUPUESTO_CUERPO_CM3, volumen(a)) || d.largoCm > Math.max(LARGO_MAXIMO_CUERPO_CM, a.largoCm) ? "armado" : null;
}

/** Por qué no se deja el cambio, dicho para el modelo, o null si cabe. */
export function porQueNoCabe(antes: PiezaOrganica, despues: PiezaOrganica): string | null {
  const tope = topePasado(antes, despues);
  return tope === "aro" ? `un aro orgánico va hasta ${TOPE_ARO_CM} cm de grosor` : tope === "armado" ? textoTope(antes) : null;
}

/**
 * Todo el cuerpo × factor (`conGrosor`), acotado al mayor factor que cabe; `tope` dice por qué se quedó por debajo de lo pedido. Sin
 * pieza si no cabe ni un 1 % más.
 */
export type Engrosado = { pieza: PiezaOrganica; factor: number; tope: string | null } | { pieza: null; tope: string };

export function engrosarEnPresupuesto(p: PiezaOrganica, factor: number): Engrosado {
  const tope = porQueNoCabe(p, conGrosor(p, factor));
  if (tope === null) return { pieza: conGrosor(p, factor), factor, tope: null };
  let cabe = 1, noCabe = factor;
  for (let i = 0; i < PASOS_BUSQUEDA; i++) {
    const medio = (cabe + noCabe) / 2;
    if (topePasado(p, conGrosor(p, medio)) === null) cabe = medio; else noCabe = medio;
  }
  return cabe < 1 + ENGROSAR_MINIMO ? { pieza: null, tope } : { pieza: conGrosor(p, cabe), factor: cabe, tope };
}
