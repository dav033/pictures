/**
 * Lo que sobrevive en TypeScript del motor geométrico tras el paso 5 del
 * ADR-0023: la tabla de mezclas y el parseo de los tamaños obligatorios.
 *
 * Nada de esto cuenta globos. El conteo, el despiece y las medidas son de
 * `services/ai-api/app/plan.py`, que es el único dueño. Aquí quedan dos
 * comprobaciones de conversación, que ocurren ANTES de resolver y sirven para
 * que el modelo corrija el plan por sí mismo en vez de que el resolutor lo
 * rechace:
 *
 * - `mezclasCompatiblesConDiametros`, que le dice al modelo qué mezclas puede
 *   cubrir un producto con los diámetros que tiene en el catálogo;
 * - `tamanosObligatorios`, para avisar de que lo que falta de cubrir es
 *   justamente el tamaño que pidió el cliente.
 *
 * Este archivo es el ÚNICO dueño de la tabla de mezclas, los diámetros
 * estándar, el tope de sustitución y la gramática de los tamaños obligatorios.
 * `reglasMezclas()` los exporta al contrato `plan-decoracion.v1` como
 * `x-reglas-mezclas` (`scripts/ops/export-domain-contract-schemas.ts`), el mismo
 * patrón que `x-geometria-estructuras-oficiales`, y `plan.py` los lee de ahí.
 * Cambiar un valor es: editarlo aquí, `npm run contracts:export:domain` y
 * `generate_models.py`; los vectores dorados dicen si movió alguna cifra.
 *
 * Lo que sigue escrito en los dos lenguajes es solo la FORMA de la regla de
 * sustitución (escalón contiguo y razón máxima), dos líneas por lado. El
 * contrato lleva además la tabla `sustituciones_admisibles` que produce esta
 * implementación, y `services/ai-api/tests/test_reglas_mezclas.py` exige que
 * la de Python dé exactamente lo mismo par por par.
 */

import type { Densidad } from "./tipos";

export type Mezcla = "clasica" | "organica_fina" | "organica_gruesa" | "solo_grandes";

/** Una línea del despiece de una estructura, tal como la devuelve el resolutor. */
export type LineaDespiece = { tamano: string; pulgadas: number; cantidad: number; color?: string };

type ProporcionTamano = { pulgadas: number; proporcion: number };

/**
 * "organica_fina" refleja un orgánico de referencia de cobertura media: R-12
 * domina el volumen, R-5/R-9 llenan huecos y R-18/R-24 son acentos visibles.
 * Las demás son variaciones razonables que requieren su propia calibración.
 */
const MEZCLAS: Record<Mezcla, ProporcionTamano[]> = {
  clasica: [{ pulgadas: 12, proporcion: 1 }],
  organica_fina: [
    { pulgadas: 5, proporcion: 0.21 },
    { pulgadas: 9, proporcion: 0.18 },
    { pulgadas: 12, proporcion: 0.54 },
    { pulgadas: 18, proporcion: 0.05 },
    { pulgadas: 24, proporcion: 0.02 },
  ],
  organica_gruesa: [
    { pulgadas: 9, proporcion: 0.25 },
    { pulgadas: 12, proporcion: 0.45 },
    { pulgadas: 18, proporcion: 0.2 },
    { pulgadas: 24, proporcion: 0.1 },
  ],
  solo_grandes: [
    { pulgadas: 18, proporcion: 0.6 },
    { pulgadas: 24, proporcion: 0.4 },
  ],
};

export const MEZCLAS_DISPONIBLES = Object.keys(MEZCLAS) as Mezcla[];

/** Diámetros (pulgadas) que pide cada mezcla, de menor a mayor. */
export function pulgadasDeMezcla(mezcla: Mezcla): number[] {
  return MEZCLAS[mezcla].map((tamano) => tamano.pulgadas);
}

const DIAMETROS_ESTANDAR = [5, 9, 12, 18, 24] as const;

/**
 * A cuántas **pulgadas reales** queda inflado un globo de cada tamaño nominal.
 *
 * No es `nominal × un factor`: un globo no se infla proporcional a su etiqueta.
 * Un R-5 queda en 4″ (un 80 % del nominal) y un R-12 en 10,5″ (un 87,5 %). Es la
 * tabla `INFLADO_PULG` del diseñador de arcos y columnas del clasificador
 * (`src/lib/arco/tipos.ts`), y es dato del oficio medido sobre globos inflados,
 * no una fórmula.
 *
 * Sustituye al factor lineal `0,92` que usaba `silueta.diametro_inflado_m`. Ese
 * 0,92 **sigue vivo** en la fórmula de densidad λ de `plan.py`, escrito a mano,
 * y ahí se queda a propósito: λ se calibró con él, así que cambiárselo movería
 * el precio de paredes, guirnaldas y semiarcos sin que nadie lo pidiera. Son dos
 * definiciones de cuánto mide un globo conviviendo, y eso es deuda: la de aquí
 * es la buena y λ es la que falta migrar.
 *
 * Los cinco tamaños del catálogo (`DIAMETROS_ESTANDAR`) están todos en la tabla,
 * así que ningún tamaño que se cotice necesita el respaldo.
 */
export const INFLADO_PULGADAS: Record<string, number> = { 5: 4, 9: 8, 12: 10.5, 18: 14, 24: 20, 36: 30 };

/** Cuánto puede crecer (o encoger) un globo al servirse con el escalón contiguo. */
const RAZON_MAXIMA_SUSTITUCION = 1.5;

/**
 * Un tamaño se puede servir con el escalón contiguo si no crece más de la mitad.
 * Sin ese tope, un R-5 que no existía se sustituía por un R-24 y convertía una
 * columna corriente en 29 paquetes de globos gigantes.
 */
function sustitucionAdmisible(pedido: number, disponible: number): boolean {
  if (pedido === disponible) return true;
  const pedidoIndex = DIAMETROS_ESTANDAR.indexOf(pedido as (typeof DIAMETROS_ESTANDAR)[number]);
  const disponibleIndex = DIAMETROS_ESTANDAR.indexOf(disponible as (typeof DIAMETROS_ESTANDAR)[number]);
  if (pedidoIndex < 0 || disponibleIndex < 0 || Math.abs(pedidoIndex - disponibleIndex) !== 1) return false;
  return Math.max(pedido, disponible) / Math.min(pedido, disponible) <= RAZON_MAXIMA_SUSTITUCION;
}

/**
 * Mezclas que un producto puede cubrir con sus diámetros redondos disponibles,
 * aplicando la misma sustitución admisible que usa la resolución. Sirve para
 * que el modelo elija una mezcla que el catálogo real puede servir: en el
 * catálogo local solo el 18 % de los productos redondos cubre `organica_fina`.
 */
export function mezclasCompatiblesConDiametros(diametros: readonly number[]): Mezcla[] {
  return MEZCLAS_DISPONIBLES.filter((mezcla) =>
    pulgadasDeMezcla(mezcla).every((pedido) => diametros.some((disponible) => sustitucionAdmisible(pedido, disponible))),
  );
}

/**
 * `restricciones.tamanos[].valor` es texto libre del modelo: solo se acepta un
 * entero positivo de hasta tres cifras, con "R-", "R" o sin prefijo ("R-12",
 * "R12", "12"), que es lo único que emite el extractor determinista
 * (`restricciones.ts`). Los espacios ASCII se toleran a los lados porque el
 * esquema Python no recorta el valor como sí hace zod. Lo que no encaja se
 * ignora: no se redondea ni se rechaza el plan.
 */
const TAMANO_OBLIGATORIO = /^[ \t\n\r\f\v]*R?-?(\d{1,3})[ \t\n\r\f\v]*$/i;

/** Pulgadas que el cliente hizo obligatorias, de menor a mayor y sin repetir. */
export function tamanosObligatorios(
  restricciones?: { tamanos?: readonly { valor: string; polaridad?: string }[] } | null,
): number[] {
  const pulgadas = new Set<number>();
  for (const tamano of restricciones?.tamanos ?? []) {
    if ((tamano.polaridad ?? "obligatorio") !== "obligatorio") continue;
    const encontrado = TAMANO_OBLIGATORIO.exec(tamano.valor);
    if (!encontrado) continue;
    const valor = Number(encontrado[1]);
    if (valor > 0) pulgadas.add(valor);
  }
  return [...pulgadas].sort((a, b) => a - b);
}

/**
 * Cómo se arma un **arco clásico** según la densidad declarada: globos a lo
 * ancho de la banda y separación entre filas.
 *
 * Es una regla comercial, no una perilla estética: decide cuántos globos lleva
 * el arco y por tanto lo que cuesta (`services/ai-api/app/arco_clasico.py`, que
 * la lee del contrato igual que lee la tabla de mezclas).
 *
 * **Los dos valores están dentro del rango que el motor admite, y antes no lo
 * estaban** (2026-10-01). La separación entre filas del motor porteado es la
 * misma perilla que el diseñador del clasificador deja mover entre **0,7 y 1,4**
 * (`src/components/arco/Disenador.tsx`), con 1 por defecto: 1 es el
 * empaquetado hexagonal, donde dos filas vecinas se tocan. Aquí valía de 0,485
 * a 0,5975, por debajo de ese suelo: con R-12 eso deja **0,10 m entre centros de
 * fila para un globo de 0,28 m**, o sea un 63 % de solape. Ese arco no se puede
 * armar —dos anillos no caben uno dentro de otro— y el dibujo salía, con razón,
 * como un montón de globos. Los valores viejos se habían elegido para que el
 * CONTEO no se desviara más de un 3,1 % de la fórmula λ anterior, y mientras ese
 * número mandara el arco no podía verse bien.
 *
 * **La densidad es la separación entre filas, y nada más**, que es como está
 * hecho el motor de referencia: allá la banda es una perilla de forma con un
 * solo valor por defecto (4) y lo que llena la pieza es cuánto se aprietan las
 * filas. Las tres separaciones recorren casi todo el rango del deslizador —1,3 /
 * 1,0 / 0,7—; 1,3 es el tope con el que dos filas vecinas todavía se tocan
 * (`paso · 0,866 · sep ≤ diámetro`), medido y dan un reparto parejo de 2× entre sencilla y lujosa en todas las
 * medidas de catálogo.
 *
 * **Por qué la banda no la mueve la densidad**, que fue un intento anterior de
 * este mismo día (3/4/5): el ancho del arco limita la banda al 36 % (la regla
 * `RAZON_GROSOR_MAX`, en `arco_saneado`), así que en un arco de 2,4 m las tres
 * densidades caían igualmente a 3 y dejaban de distinguirse —un 20 % de
 * diferencia entre sencilla y lujosa, cuando es lo que el cliente paga—. Y
 * peor: con la banda en 3 el ciclo de color de una espiral no cabe en las filas
 * cortas y la cinta se parte. Una sola banda arregla las dos cosas.
 *
 * Contra la fórmula λ anterior esto baja el conteo de un 31 % a un 46 % según la
 * medida (medido el 2026-10-01 sobre ocho tamaños de catálogo). Esa bajada es el
 * cambio buscado y lo decidió el usuario: λ estaba calibrada para guirnaldas
 * orgánicas, que llevan racimos, y pedía para un arco clásico más globos de los
 * que caben físicamente en la pieza.
 */
export const ARMADO_ARCO_CLASICO: Record<Densidad, { globosAncho: number; separacionFilas: number }> = {
  sencilla: { globosAncho: 4, separacionFilas: 1.3 },
  media: { globosAncho: 4, separacionFilas: 1 },
  lujosa: { globosAncho: 4, separacionFilas: 0.7 },
};

/**
 * Cómo se arma una **columna clásica** según la densidad declarada: globos por
 * capa y alto de la capa en diámetros de globo.
 *
 * Igual que la del arco, es una regla comercial: decide cuántos globos lleva la
 * pieza (`services/ai-api/app/columna_clasica.py`, porteado del diseñador de
 * columnas del clasificador).
 *
 * **La densidad es el anillo, y nada más.** Una columna se arma en capas de
 * tres, cuatro, cinco o seis globos alrededor del eje, y el oficio ya les tiene
 * nombre: `NOMBRE_DEL_RACIMO` de este mismo archivo las llama cuarteto,
 * quinteto y sexteto, y `RACIMO_DE_LA_FOTO` ya mapeaba esas tres a sencilla,
 * media y lujosa al leerlas de una foto. Esto no hace más que usar el mismo
 * vocabulario para armarlas.
 *
 * La **compresión** —el alto de una capa en diámetros— se queda en 0,80 en las
 * tres. El deslizador del motor de referencia la llama «la fórmula profesional»
 * en ese valor y la acota a 0,7–1,0; apretarla o soltarla cambia la altura a la
 * que llega la pieza, no lo llena que se ve, así que no es la perilla de la
 * densidad. Está aquí porque es la otra mitad del armado y porque, si algún día
 * se mueve, se mueve en un solo sitio.
 *
 * Contra la fórmula λ que contaba las columnas hasta ahora, esto queda entre
 * **−6 % y +8 %** según la medida (medido el 2026-10-01 sobre seis alturas de
 * catálogo): la λ de las columnas sí estaba bien calibrada, y lo que faltaba era
 * el motor que las dibuja. Por eso esta tabla **no** es un cambio de precio
 * como lo fue la del arco.
 */
export const ARMADO_COLUMNA_CLASICA: Record<Densidad, { globosCapa: number; compresion: number }> = {
  sencilla: { globosCapa: 4, compresion: 0.8 },
  media: { globosCapa: 5, compresion: 0.8 },
  lujosa: { globosCapa: 6, compresion: 0.8 },
};


/**
 * La densidad que corresponde a los racimos que se ven en la foto de una pieza
 * clásica: cuarteto `sencilla`, quinteto `media`, sexteto `lujosa`.
 *
 * Ya no es que la densidad SEA el racimo. Desde que el motor de arcos se porteó
 * entero (2026-10-01), lo que cambia con la densidad es cuánto se aprietan las
 * filas, no cuántos globos van a lo ancho. Pero la lectura sigue valiendo
 * porque mide lo mismo: **globos por metro de recorrido**. Medido sobre un arco
 * de 3 × 2,4 m:
 *
 * | racimo de la foto | globos/m | densidad | globos/m |
 * |---|---|---|---|
 * | cuarteto | 18,7 | `sencilla` | 19,6 |
 * | quinteto | 23,4 | `media`    | 24,3 |
 * | sexteto  | 28,1 | `lujosa`   | 32,4 |
 *
 * Sin esto el modelo elige la densidad por el aspecto general, y un arco de
 * cuartetos sale declarado `lujosa`: un 50 % más de globos de los que se ven en
 * la foto. Pasó el 2026-10-01, justo después de quitar esta función por creer
 * —mal— que el porteo del motor la había dejado sin sentido.
 */
export function densidadDeRacimoEnFoto(globosPorRacimo: number): Densidad | null {
  return RACIMO_DE_LA_FOTO[globosPorRacimo] ?? null;
}

const RACIMO_DE_LA_FOTO: Record<number, Densidad> = { 4: "sencilla", 5: "media", 6: "lujosa" };

/** Cómo se llama en el oficio un racimo de ese tamaño. */
export const NOMBRE_DEL_RACIMO: Record<number, string> = {
  4: "cuarteto",
  5: "quinteto",
  6: "sexteto",
};

/** Lo que viaja en `plan-decoracion.v1` como `x-reglas-mezclas`. */
export type ReglasMezclasContrato = {
  mezclas: Record<Mezcla, ProporcionTamano[]>;
  diametros_estandar: number[];
  razon_maxima_sustitucion: number;
  /** Diámetros disponibles que sirven cada diámetro estándar pedido, además del mismo. */
  sustituciones_admisibles: Record<string, number[]>;
  /**
   * Fuente del regex, sin banderas. Las banderas son fijas: sin distinguir
   * mayúsculas, y `\d` solo en dígitos ASCII (lo que ya hace JS; Python
   * necesita `re.ASCII`).
   */
  patron_tamano_obligatorio: string;
  /** Globos a lo ancho y separación entre filas de un arco clásico, por densidad. */
  armado_arco_clasico: Record<string, { globos_ancho: number; separacion_filas: number }>;
  /** Globos por capa y alto de capa de una columna clásica, por densidad. */
  armado_columna_clasica: Record<string, { globos_capa: number; compresion: number }>;
  /** A cuántas pulgadas reales queda inflado cada tamaño nominal. */
  inflado_pulgadas: Record<string, number>;
};

export function reglasMezclas(): ReglasMezclasContrato {
  return {
    mezclas: MEZCLAS,
    diametros_estandar: [...DIAMETROS_ESTANDAR],
    razon_maxima_sustitucion: RAZON_MAXIMA_SUSTITUCION,
    sustituciones_admisibles: Object.fromEntries(
      DIAMETROS_ESTANDAR.map((pedido) => [
        String(pedido),
        DIAMETROS_ESTANDAR.filter((disponible) => disponible !== pedido && sustitucionAdmisible(pedido, disponible)),
      ]),
    ),
    patron_tamano_obligatorio: TAMANO_OBLIGATORIO.source,
    armado_arco_clasico: Object.fromEntries(
      (Object.keys(ARMADO_ARCO_CLASICO) as Densidad[]).map((densidad) => [
        densidad,
        {
          globos_ancho: ARMADO_ARCO_CLASICO[densidad].globosAncho,
          separacion_filas: ARMADO_ARCO_CLASICO[densidad].separacionFilas,
        },
      ]),
    ),
    inflado_pulgadas: { ...INFLADO_PULGADAS },
    armado_columna_clasica: Object.fromEntries(
      (Object.keys(ARMADO_COLUMNA_CLASICA) as Densidad[]).map((densidad) => [
        densidad,
        {
          globos_capa: ARMADO_COLUMNA_CLASICA[densidad].globosCapa,
          compresion: ARMADO_COLUMNA_CLASICA[densidad].compresion,
        },
      ]),
    ),
  };
}

/**
 * Prefijo con el que el resolutor marca sus advertencias de puerta física
 * dentro de `advertencias` (ADR-0023 paso 4, espejo de `PHYSICAL_GATE_PREFIX`
 * en `services/ai-api/app/plan.py`). El resto de advertencias del plan son
 * avisos que no bloquean (ADR-0022): estas sí, y por eso van marcadas. Python
 * es dueño de la medición; Next, de la política de bloqueo.
 */
export const PREFIJO_PUERTA_FISICA = "puerta_fisica:";

/** Advertencias de puerta física de un plan ya resuelto, sin el prefijo. */
export function advertenciasPuertaFisica(advertencias: readonly string[]): string[] {
  return advertencias
    .filter((aviso) => aviso.startsWith(PREFIJO_PUERTA_FISICA))
    .map((aviso) => aviso.slice(PREFIJO_PUERTA_FISICA.length));
}
