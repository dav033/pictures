import type { Colocacion, Escena } from "../escena";
import type { Pieza } from "../piezas";
import { perezoso } from "../perezoso";

/**
 * Una idea de fiesta de sempertex.com (https://sempertex.com/blogs/idea-de-fiesta) digitalizada en el taller 3D.
 * Solo datos y urls públicas: ni fotos ni rutas locales en el repo. La biblioteca la convierte en item (escena o
 * pieza) y de ahí salen sus estructuras con sus decoraciones y sus decoraciones sueltas.
 */
export type ProductoDeIdea = {
  /** Nombre exacto en la tienda («GLOBO REDONDO FASHION NARANJA»). */
  nombre: string;
  /** Ruta de la tienda («/products/globo-para-fiesta-latex-redondo-fashion-naranja»). */
  url: string;
  formato: string | null;
  codigo: string | null;
  /** Cantidad si la idea la publica (lista «Materiales»), o la contada en la foto (`contada: true`). */
  cantidad: number | null;
  contada?: boolean;
};

/**
 * Qué es la idea SIN armarla (lo que la biblioteca muestra como tipo): una escena entera o, si es una pieza sola, la
 * clase de esa pieza (`clasePieza` de `biblioteca.ts`: estructura —también la escenografía—, decoración o utilería).
 * Debe casar con `contenido` (`test-biblioteca` lo comprueba en todas las ideas).
 */
export type ClaseIdea = "escena" | "estructura" | "decoracion" | "utileria";

/** La clase de una pieza sola, como la cuenta la biblioteca (`clasePieza` + `itemDePieza`): sin armar nada. */
export function claseDePieza(p: Pieza): Exclude<ClaseIdea, "escena"> {
  if (p.tipo === "decoracion" || p.tipo === "globo") return "decoracion";
  return p.tipo === "escenografia" && p.utileria ? "utileria" : "estructura";
}

export type IdeaDigitalizada = {
  /** «idea:<slug>». */
  id: string;
  /** Número en el índice local de las 987 ideas (para encontrar su foto y su clasificación). */
  numero: number;
  slug: string;
  nombre: string;
  ocasiones: string[];
  /** Foto pública de la idea en el CDN de Sempertex (https). */
  fotoUrl: string;
  /** Escena o clase de su pieza, sin armar nada (ver `ClaseIdea`). */
  clase: ClaseIdea;
  /** Perezoso: se calcula la primera vez que se pide (ver «Patrón perezoso» abajo). */
  productos: ProductoDeIdea[];
  /** Perezoso: se arma la primera vez que se pide (ver «Patrón perezoso» abajo). */
  contenido: { tipo: "escena"; escena: Escena } | { tipo: "pieza"; pieza: Pieza; sugerida?: Colocacion };
  /** Qué quedó igual a la foto y qué no (honesto y concreto). */
  nota: string;
};

export const urlDeIdea = (slug: string) => `https://sempertex.com/blogs/idea-de-fiesta/${slug}`;

// ----------------------------------------------------------------------------------------------------------
// Patrón perezoso (OBLIGATORIO en todo lote o catálogo de ideas)
// ----------------------------------------------------------------------------------------------------------
//
// Importar la biblioteca (`biblioteca.ts`, que importa TODOS los lotes) no puede armar nada: /3d y /api/escena-ia la
// cargan al abrir. En octubre de 2026 los lotes armaban sus escenas al importarse (empaque orgánico, metalizados,
// `armarPieza` para medir alturas, productos contados al armar la escena…) y /3d congelaba el navegador ~20 s.
//
// Reglas para un lote nuevo (`scripts/test/test-carga-3d.ts` falla si importar tarda más de 500 ms):
// 1. En el nivel superior del módulo solo van datos literales, constantes baratas y DEFINICIONES de funciones. Nada que
//    llame a `armarPieza`, `armarEscena`, `armarOrganico`, metalizados, empaques, ni IIFE `(() => {...})()` que calcule.
// 2. Cada idea se crea con `ideaPerezosa(fijo, contenido, productos)`: `fijo` (id, número, slug, nombre, ocasiones, foto,
//    clase y nota) se lee sin armar nada; `contenido` y `productos` son funciones que se llaman la primera vez que se
//    piden y quedan memorizadas. Las ocasiones o la nota pueden ir como getter en `fijo` (p. ej. si usan
//    `ocasionesDeEtiquetas`, que vive en `index.ts` y no está lista mientras se importa el lote).
// 3. Lo caro que comparten varias ideas (una escena base, una pieza medida) va en `perezoso(() => ...)` y se usa
//    llamándolo (`ESCENA_BASE()`), nunca calculado en el nivel superior.
// 4. La nota es texto: si necesita una medida armada, que sea un getter (se lee al buscar o al abrir la ficha).
// 5. `clase` dice qué es la idea sin armarla («escena» o `claseDePieza(pieza)`); `test-biblioteca` comprueba que case.
// Quien use ideas o items de la biblioteca no los copia con `{ ...x }` (armaría el contenido): `copiarItem` de
// `biblioteca.ts`. La pestaña Biblioteca arma todo en un Web Worker (`components/tres-d/biblioteca-motor.ts`).

/** Memoriza un cálculo (vive en `../perezoso.ts`; se reexporta aquí para los lotes). */
export { perezoso };

/** Lo que se lee de una idea sin armar nada (puede llevar getters: se copian sin evaluarlos). */
export type FijoDeIdea = Omit<IdeaDigitalizada, "contenido" | "productos">;

/**
 * Una idea perezosa (el patrón obligatorio de arriba): copia `fijo` tal cual —con sus getters, sin evaluarlos— y añade
 * `contenido` y `productos` como getters memorizados: el contenido se arma la primera vez que se pide y los productos
 * se calculan sobre ese mismo contenido (una sola vez).
 */
export function ideaPerezosa(
  fijo: FijoDeIdea,
  contenido: () => IdeaDigitalizada["contenido"],
  productos: (contenido: IdeaDigitalizada["contenido"]) => ProductoDeIdea[],
): IdeaDigitalizada {
  const elContenido = perezoso(contenido);
  const losProductos = perezoso(() => productos(elContenido()));
  const idea = Object.defineProperties({}, Object.getOwnPropertyDescriptors(fijo)) as FijoDeIdea;
  return Object.defineProperties(idea, {
    contenido: { get: elContenido, enumerable: true, configurable: true },
    productos: { get: losProductos, enumerable: true, configurable: true },
  }) as IdeaDigitalizada;
}
