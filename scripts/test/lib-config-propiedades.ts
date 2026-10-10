/**
 * La configuración de las pruebas de propiedades, leída del entorno y validada: un valor que no es un entero positivo
 * falla con su nombre, no se convierte en NaN ni en un barrido vacío que pasa en silencio.
 * - `PROPIEDADES_CASOS`: cuántos casos por propiedad (por defecto 40; en CI, 12).
 * - `PROPIEDADES_SEMILLA`: la semilla base (por defecto 20261009); cambiarla explora otros casos y se reproduce igual.
 */
export type ConfigPropiedades = { casos: number; semilla: number };

const POR_DEFECTO = { casos: "40", semilla: "20261009" };

export function enteroPositivo(texto: string, nombre: string): number {
  if (!/^\d+$/.test(texto.trim())) throw new Error(`${nombre} tiene que ser un entero positivo, no «${texto}»`);
  const valor = Number(texto.trim());
  if (!Number.isSafeInteger(valor) || valor < 1) throw new Error(`${nombre} tiene que ser un entero positivo, no «${texto}»`);
  return valor;
}

export function configPropiedades(entorno: Record<string, string | undefined> = process.env): ConfigPropiedades {
  return {
    casos: enteroPositivo(entorno.PROPIEDADES_CASOS ?? POR_DEFECTO.casos, "PROPIEDADES_CASOS"),
    semilla: enteroPositivo(entorno.PROPIEDADES_SEMILLA ?? POR_DEFECTO.semilla, "PROPIEDADES_SEMILLA"),
  };
}

/** Una semilla por nombre (FNV-1a de 32 bits): cada herramienta o caso tiene su propia secuencia, no depende del largo del nombre. */
export function semillaDeNombre(nombre: string): number {
  let hash = 0x811c9dc5;
  for (const caracter of nombre) {
    hash ^= caracter.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * La semilla de un caso: el hash de la semilla base, la propiedad y el número de caso. Con la suma (`semilla + caso`) la
 * semilla 2 repetía los casos de la 1 corridos en uno, y barrer las semillas 1 a 10 probaba casi las mismas especificaciones.
 */
export const semillaDeCaso = (semilla: number, propiedad: string, caso: number): number => semillaDeNombre(`${semilla}|${propiedad}|${caso}`);
