import { ANGULOS_ESTANDAR, DISTANCIA_MINIMA_RADIOS, FOV_GRADOS, ITERACIONES, OCUPACION_ESTANDAR } from "@/components/tres-d/camara-estandar-datos";
import { BYTES_JPEG_YA_LIVIANO, CALIDAD_JPEG_IMAGEN_GENERADA } from "@/lib/generacion/imagen-liviana-constantes";
import { FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";
import { MODULOS, armarModulo } from "@/lib/globos3d/modulos";
import { ASPECTO_RENDER, GUIDANCE_RENDER, LADO_CAPTURA, VISTA_CAPTURA } from "./captura-estudio";
import { FORMATOS_ESTUDIO, type ConfigModulo } from "./configuracion";
import { SALA_ESTUDIO } from "./escena-estudio";
import { promptModuloEstudio } from "./prompt-estudio";

/**
 * La huella del pipeline que hace las imágenes del estudio: tres partes que, si cambian, hacen que un render viejo deje de
 * ser la respuesta a la misma petición. Se calcula sola (nadie tiene que acordarse de subir una versión):
 * - la GEOMETRÍA que arma `armarModulo` para cada tipo y cada tamaño del estudio (nudos, direcciones y cuellos, a 0,01 cm);
 * - la CAPTURA: cámara estándar, tamaño, sala del estudio, aspecto y guía de FLUX y el aligerado del resultado;
 * - el TEXTO de FLUX de un módulo de cada tipo.
 * Hash no criptográfico (cyrb53) y sin node:crypto: lo calcula también el navegador, que guarda su estado por clave.
 */

function cyrb53(texto: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 8 caracteres hexadecimales del texto. */
export const huellaDe = (texto: string): string => cyrb53(texto).toString(16).padStart(14, "0").slice(-8);

/**
 * A 0,01 cm. El corrimiento de 0,1234 centésimas aparta la frontera del redondeo de los valores «redondos» (un medio nudo de
 * 0,965 cm cae justo en ella y el ruido de coma flotante de otra máquina lo volcaría): la huella solo cambia si cambia la forma.
 */
const centesimas = (n: number): number => Math.round(n * 100 + 0.1234) / 100 + 0;

export type ArmarModuloFn = typeof armarModulo;

/** Cómo quedan colocados los globos de cada tipo en cada tamaño del estudio. `armar` se inyecta para probar que un cambio se nota. */
export function huellaGeometria(armar: ArmarModuloFn = armarModulo): string {
  const partes: number[][] = [];
  for (const modulo of MODULOS) {
    for (const id of FORMATOS_ESTUDIO) {
      const formato = FORMATOS_GLOBO.find((f) => f.id === id);
      if (!formato) continue;
      const armado = armar(modulo, formato, formato.infladoDecoracionCm);
      partes.push([armado.anchoCm, armado.altoCm, ...armado.globos.flatMap((g) => [g.nudo.x, g.nudo.y, g.nudo.z, g.direccion.x, g.direccion.y, g.direccion.z, g.cuelloExtraCm].map(centesimas))]);
    }
  }
  return huellaDe(JSON.stringify(partes));
}

/** La captura 3D y lo que se hace con la imagen de FLUX. */
export function huellaCaptura(): string {
  return huellaDe(JSON.stringify([
    LADO_CAPTURA, VISTA_CAPTURA, ASPECTO_RENDER, GUIDANCE_RENDER,
    ANGULOS_ESTANDAR[VISTA_CAPTURA], OCUPACION_ESTANDAR, FOV_GRADOS, ITERACIONES, DISTANCIA_MINIMA_RADIOS,
    SALA_ESTUDIO, CALIDAD_JPEG_IMAGEN_GENERADA, BYTES_JPEG_YA_LIVIANO,
  ]));
}

/**
 * El texto de FLUX para un módulo de cada tipo en cada tamaño (con colores de ejemplo) y para CADA referencia del catálogo
 * en cada tamaño (un dúo de ese color): así un cambio en la frase de un acabado, en un hex de la tabla o en el nombre de un
 * tamaño cambia la huella, sea cual sea la familia que toque.
 */
export function huellaTexto(texto: (config: ConfigModulo) => string = promptModuloEstudio): string {
  const ejemplo = ["915", "040", "015", "009", "570", "005"];
  const textos: string[] = [];
  for (const formatoId of FORMATOS_ESTUDIO) {
    for (const m of MODULOS) textos.push(texto({ tipo: m.id, formatoId, colores: ejemplo.slice(0, m.globos) }));
    for (const r of TABLA_SEMPERTEX.referencias) textos.push(texto({ tipo: "pareja", formatoId, colores: [r.codigo, r.codigo] }));
  }
  return huellaDe(textos.join("\n"));
}

/** Versión manual (para un cambio que ninguna huella ve) y huella automática, juntas: `estudio-v2.<huella>`. */
export const VERSION_MANUAL = "estudio-v2";

export function versionPipeline(partes: { geometria: string; captura: string; texto: string } = { geometria: huellaGeometria(), captura: huellaCaptura(), texto: huellaTexto() }): string {
  return `${VERSION_MANUAL}.${huellaDe(`${partes.geometria}|${partes.captura}|${partes.texto}`)}`;
}
