import { NIVELES_CREATIVIDAD, perfilCreatividad, type NivelCreatividad } from "@/lib/ia/escena/creatividad";
import type { NivelAmbiente } from "@/lib/ia/uzume/ambiente-fiesta";

/**
 * `presentationMode`: un modo de demostración EXPLÍCITO y APAGADO por defecto.
 *
 * Nace del feedback de la sesión «PRUEBAS ASISTENTE DE DECORACIÓN» (Customer Journey Map,
 * diapositivas 6-8; ver `informes-calidad/05-customer-journey-recomendaciones.md`). Agrupa las
 * recomendaciones RESTRICTIVAS que no se quieren como comportamiento general del producto.
 *
 * Reglas de este módulo:
 * - Es el ÚNICO dueño de `PRESENTATION_MODE_ENABLED`: nada más lee esa variable. Los puntos de
 *   aplicación reciben la política (`PoliticaPresentacion`) y no conocen el entorno.
 * - Solo el texto exacto `"true"` lo activa. Ausente, vacío, `"1"`, `"TRUE"`, `"yes"`, `" true"`
 *   o cualquier otra cosa lo dejan apagado. A diferencia de `featureEnabled`, no acepta
 *   `1`/`on`: un modo que recorta el producto no se enciende por un valor ambiguo.
 * - Apagado, la política deja pasar todo y cada punto de aplicación se comporta igual que antes.
 * - Puro: `politicaDePresentacion` no toca el entorno; `leerPoliticaDePresentacion` es el único
 *   lector. Sin proveedor, HTTP, base de datos ni logs.
 *
 * SUPUESTOS (el deck no los define; son decisiones pendientes de una persona, ver informe 05b):
 * - Aplica a TODOS los usuarios mientras está activo (no hay perfil: el deck no dice a quién).
 * - «De CERO» = una imagen sin foto de referencia del usuario ni pieza prediseñada del catálogo:
 *   ver `INTERPRETACION_DE_CERO`.
 */

/** Nombre de la variable de entorno. Documentada en `.env.example` sin valor. */
export const PRESENTATION_MODE_ENV = "PRESENTATION_MODE_ENABLED";

/** Un campo por restricción. Inmutable. */
export type PoliticaPresentacion = Readonly<{
  /** El modo está encendido (para registro y pruebas; ningún punto de aplicación decide por este campo). */
  activo: boolean;
  /** R16 (y R13 en su forma mínima): no generar una imagen «de cero». */
  bloquearGeneracionSinReferencia: boolean;
  /** R23: la imagen solo muestra producto del plan; sin ambientación ni creatividad que añadan objetos que Sempertex no vende. */
  catalogoCerrado: boolean;
}>;

const POLITICA_APAGADA: PoliticaPresentacion = Object.freeze({
  activo: false,
  bloquearGeneracionSinReferencia: false,
  catalogoCerrado: false,
});

const POLITICA_ENCENDIDA: PoliticaPresentacion = Object.freeze({
  activo: true,
  bloquearGeneracionSinReferencia: true,
  catalogoCerrado: true,
});

/** Función pura: el valor crudo de la variable de entorno → la política. Solo `"true"` enciende. */
export function politicaDePresentacion(valor: string | undefined | null): PoliticaPresentacion {
  return valor === "true" ? POLITICA_ENCENDIDA : POLITICA_APAGADA;
}

/** Lector de entorno delgado. Se llama en cada petición (no al importar) para que una prueba pueda cambiar el valor. */
export function leerPoliticaDePresentacion(): PoliticaPresentacion {
  return politicaDePresentacion(process.env[PRESENTATION_MODE_ENV]);
}

// --- R16: no generar imágenes «de cero» ---------------------------------------------------------

/**
 * QUÉ ES «DE CERO» (supuesto, fácil de cambiar). El deck dice «no abriría la opción a que la IA
 * cree imágenes de decoración de CERO» y no define el término. Interpretación adoptada: una
 * generación es «de cero» cuando NO tiene
 *   (a) una foto de referencia del usuario (una foto adjunta o un plan que salió de una foto), ni
 *   (b) una pieza prediseñada del catálogo (kit E-DECORS / FIESTAS PREDISEÑADAS en la compra).
 * Cada bandera dice si esa señal CUENTA como base; cámbiala aquí y la prueba lo refleja.
 */
export const INTERPRETACION_DE_CERO = Object.freeze({
  /** Una foto de referencia adjunta, o un plan cuyas estructuras materializan elementos de una foto: cuenta. */
  fotoDeReferenciaCuentaComoBase: true,
  /** Un kit/decoración prediseñada del catálogo en la compra: cuenta. */
  piezaPrediseniadaDeCatalogoCuentaComoBase: true,
  /** La foto del espacio (el salón vacío del cliente) NO es una decoración: no cuenta. */
  fotoDelEspacioCuentaComoBase: false,
  /** Una imagen generada antes (una revisión parte de ella): cuenta; la primera ya pasó por esta misma puerta. */
  imagenPreviaCuentaComoBase: true,
} as const);

export type SenalesDeBase = Readonly<{
  /** Fotos adjuntas por el cliente como referencia, o un plan que salió de una foto (`planConReferencia`). */
  fotoDeReferencia: boolean;
  /** El plan compra al menos un kit/decoración prediseñada del catálogo. */
  piezaPrediseniadaDeCatalogo: boolean;
  /** Foto del espacio del cliente. */
  fotoDelEspacio: boolean;
  /** Imagen generada previamente (revisión). */
  imagenPrevia: boolean;
}>;

/** `true` si la generación no tiene ninguna base que `INTERPRETACION_DE_CERO` reconozca. */
export function esGeneracionDeCero(senales: SenalesDeBase): boolean {
  const base =
    (INTERPRETACION_DE_CERO.fotoDeReferenciaCuentaComoBase && senales.fotoDeReferencia) ||
    (INTERPRETACION_DE_CERO.piezaPrediseniadaDeCatalogoCuentaComoBase && senales.piezaPrediseniadaDeCatalogo) ||
    (INTERPRETACION_DE_CERO.fotoDelEspacioCuentaComoBase && senales.fotoDelEspacio) ||
    (INTERPRETACION_DE_CERO.imagenPreviaCuentaComoBase && senales.imagenPrevia);
  return !base;
}

/** Prefijo estable del error (lo traduce `traducir-error-servidor.ts` y lo mapea `/api/generate` a 422). */
export const CODIGO_GENERACION_SIN_REFERENCIA = "MODO_PRESENTACION_SIN_REFERENCIA";

/**
 * Mensaje de bloqueo, o `null` si la generación puede seguir. Con el modo apagado SIEMPRE `null`,
 * sean cuales sean las señales: es la equivalencia con el comportamiento anterior.
 */
export function bloqueoPorGeneracionSinReferencia(politica: PoliticaPresentacion, senales: SenalesDeBase): string | null {
  if (!politica.bloquearGeneracionSinReferencia) return null;
  if (!esGeneracionDeCero(senales)) return null;
  return `${CODIGO_GENERACION_SIN_REFERENCIA}: en este modo la imagen se crea a partir de una foto de referencia o de una decoración del catálogo. Adjunta una foto de la decoración que te gusta.`;
}

// --- R23: catálogo cerrado en la imagen ---------------------------------------------------------

/**
 * Techo de creatividad con el catálogo cerrado. Los niveles 3-5 añaden flores, velas, mesa de
 * postres e invitados (`ambientacion` y `pistasPrompt` de `creatividad.ts`): objetos que Sempertex
 * no vende. El nivel 2 («Equilibrado») es el más alto sin ninguno; la prueba lo comprueba contra
 * la tabla, no contra este número.
 */
export const NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO: NivelCreatividad = 2;

/** Con el catálogo cerrado, el nivel no pasa del techo; sin él, se devuelve tal cual. */
export function nivelCreatividadConPolitica(nivel: NivelCreatividad, politica: PoliticaPresentacion): NivelCreatividad {
  if (!politica.catalogoCerrado) return nivel;
  return nivel > NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO ? NIVEL_CREATIVIDAD_MAXIMO_CATALOGO_CERRADO : nivel;
}

/** Con el catálogo cerrado no hay props de ambiente (mesa, sillas, luces, mesa de torta): ninguno se vende. */
export function nivelAmbienteConPolitica(nivel: NivelAmbiente, politica: PoliticaPresentacion): NivelAmbiente {
  return politica.catalogoCerrado ? "ninguno" : nivel;
}

/** Niveles de creatividad que NO añaden ambientación ni pistas: la prueba comprueba que el techo es el mayor de ellos. */
export function nivelesSinAmbientacion(): readonly NivelCreatividad[] {
  return NIVELES_CREATIVIDAD.filter((nivel) => {
    const perfil = perfilCreatividad(nivel);
    return perfil.imagen.ambientacion.length === 0 && perfil.pistasPrompt.length === 0;
  });
}
