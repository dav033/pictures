import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "./estructuras-oficiales";

/**
 * Las **formas** que el decorador puede elegir para una pieza: cómo se construye o qué silueta tiene (una
 * pared en rombos, un aro en media luna, un techo de nube, un centro de mesa en topiario).
 *
 * Puerto 1 a 1 del campo `formas` de `clasificador-decoraciones/src/lib/referencias/variantes.ts`, que es su
 * dueño: los ids, los nombres y las ayudas son los suyos, palabra por palabra. Ante una discrepancia se
 * cambia allá primero y aquí después.
 *
 * **Solo las formas.** La lámina del dueño trae además `patrones` (cómo se reparten los colores) y esos **no
 * se portan**: este repo ya tiene su vocabulario de color con un dueño —los modos de `patron_color`
 * (ADR-0028), traducidos al patrón del dibujo por `PATRON_DEL_MODO` en `app/dibujo_estructura.py`—, y traer
 * un segundo sistema de patrones le daría dos dueños al mismo concepto. Color y forma varían por su cuenta
 * (es la razón por la que el dueño los tiene separados), así que portar uno sin el otro no parte nada.
 *
 * **Qué piezas tienen formas y por qué solo esas cinco láminas.** Las que ningún motor arma: la pared, el
 * aro circular, el techo de globos y el centro de mesa, que son justo las cuatro que `app/dibujo_estructura.py`
 * dibuja él mismo y para las que el dibujo ya sabe cuatro siluetas distintas; y el **bouquet**, que tampoco
 * lo arma un motor del plan y cuyas seis formas la vista previa del dueño traduce a las formas listas de su
 * diseñador (`RAMO_FORMA` de `referencias/vista-previa.ts`, portado en `app/guia_piezas/bouquet.py`): con
 * helio, de piso, con burbuja, con número, caja sorpresa y globo relleno se dibujan distinto. El dueño tiene
 * además láminas para el arco, la columna y la guirnalda, y **quedan fuera a propósito**: esas piezas las arma
 * el motor del diseñador, que publica sus propias formas listas (`FORMAS_LISTAS` en
 * `armado-arco-organico.ts`), y ofrecer un segundo vocabulario de formas para ellas contradiría al motor que
 * las construye. Un bouquet con armado por partes (`armado_bouquet`) se dibuja con su armado: la forma solo
 * decide el ramo que no lo trae.
 *
 * **Las claves del dueño no son los ids de las oficiales** (`LAMINA_POR_OFICIAL` es la traducción): su
 * `circulo` es `aro_circular`, su `techo-globos` es `techo_globos`, su `centro-mesa` es `centro_mesa` y su
 * `pared` cubre las tres paredes oficiales (densa, no densa y orgánica), que son la misma pieza con tres
 * densidades.
 *
 * Puro: sin proveedor, HTTP, base de datos ni variables de entorno, igual que `estructuras-oficiales.ts`.
 */

export type FormaPiezaFicha = {
  id: string;
  nombre: string;
  /** Una línea: qué es, para reconocerla en una foto. Es la `ayuda` del dueño. */
  ayuda: string;
};

/** Las láminas de formas del dueño, con su clave tal cual (`ESTILOS` de `variantes.ts`). */
export const LAMINAS_FORMAS_PIEZA = ["pared", "circulo", "techo-globos", "centro-mesa", "bouquet"] as const;
export type LaminaFormasPieza = (typeof LAMINAS_FORMAS_PIEZA)[number];

/**
 * El campo `formas` de cada lámina, en el orden del dueño (de más a menos común). Ese orden es el que ve el
 * decorador: no se reordena aquí.
 */
const FORMAS_POR_LAMINA: Readonly<Record<LaminaFormasPieza, readonly FormaPiezaFicha[]>> = {
  pared: [
    { id: "organica", nombre: "Orgánica", ayuda: "Tamaños mezclados en racimos irregulares: textura con relieve." },
    { id: "cuadriculada", nombre: "Cuadriculada", ayuda: "Cara plana, globos en filas y columnas rectas." },
    { id: "rombos", nombre: "En rombos", ayuda: "Cada fila corrida medio globo: las líneas van en diagonal." },
    { id: "malla-links", nombre: "Malla de links", ayuda: "Retícula abierta de globos link: se ve el fondo." },
  ],
  circulo: [
    { id: "organico", nombre: "Aro orgánico completo", ayuda: "Guirnalda de tamaños mezclados que cubre todo el aro." },
    { id: "parcial", nombre: "Parcial o diagonal", ayuda: "La guirnalda cubre parte del aro y se ve el metal." },
    { id: "con-fondo", nombre: "Con fondo o forro", ayuda: "Tela o panel impreso dentro del aro, con guirnalda en el borde." },
    { id: "clasico", nombre: "Aro clásico de cuartetos", ayuda: "Racimos de cuatro globos iguales: un tubo parejo." },
    { id: "doble", nombre: "Doble o entrelazado", ayuda: "Dos o más aros, lado a lado o cruzados." },
    { id: "media-luna", nombre: "Media luna", ayuda: "Marco de medio círculo o de luna en vez del aro completo." },
  ],
  "techo-globos": [
    { id: "helio", nombre: "Helio con cintas", ayuda: "Globos flotando contra el techo, con cintas colgando." },
    { id: "colgantes", nombre: "Globos colgantes", ayuda: "Globos con aire colgados de hilo a distintas alturas." },
    { id: "nube", nombre: "Nube de techo", ayuda: "Racimos orgánicos pegados al techo, con huecos entre ellos." },
    { id: "malla", nombre: "Malla o red", ayuda: "Una capa pareja de globos que cubre el techo, en red." },
    { id: "candelabro", nombre: "Candelabro", ayuda: "Una pieza escultórica colgando sobre la mesa o la pista." },
    { id: "cortina", nombre: "Cortina o columnas colgantes", ayuda: "Tiras o columnitas que bajan del techo." },
  ],
  "centro-mesa": [
    { id: "helio", nombre: "Bouquet de helio", ayuda: "De tres a siete globos con helio atados a una pesa: alto." },
    { id: "base", nombre: "Base baja", ayuda: "Racimo con aire o mini guirnalda alrededor de una base: bajo." },
    { id: "burbuja", nombre: "Globo burbuja", ayuda: "Burbuja transparente con confeti, plumas o minis." },
    { id: "figura", nombre: "Figura o personaje", ayuda: "Una figura modelada (personaje, animal, corazón) sobre una base." },
    { id: "topiario", nombre: "Topiario", ayuda: "Una bola de globos pequeños sobre un palo, en una matera." },
    { id: "varillas", nombre: "Varillas", ayuda: "Globos con aire en varillas que abren desde una base." },
    { id: "mini-aro", nombre: "Mini aro", ayuda: "Un aro pequeño con mini guirnalda, parado sobre la mesa." },
  ],
  bouquet: [
    { id: "helio", nombre: "Con helio", ayuda: "Globos flotando en cintas a distintas alturas, atados a una pesa." },
    { id: "piso", nombre: "Sin helio, de piso", ayuda: "Globos con aire en varillas o soporte: se para en vez de flotar." },
    { id: "burbuja", nombre: "Globo burbuja", ayuda: "Globo transparente con nombre, con confeti o minis adentro." },
    { id: "con-numero", nombre: "Con número o letra", ayuda: "Un número o una letra metalizada rodeada de globos." },
    { id: "caja", nombre: "Caja sorpresa", ayuda: "Una caja o canasta de la que sale el bouquet." },
    { id: "relleno", nombre: "Globo relleno", ayuda: "Globo burbuja con un regalo adentro: peluche, flores, dulces." },
  ],
};

/**
 * De la estructura oficial a su lámina de formas. Las tres paredes comparten la del dueño porque son la
 * misma pieza con tres densidades, igual que comparten dibujo (`DIBUJO_POR_OFICIAL`).
 *
 * Una oficial que no está aquí **no ofrece formas**: o la arma un motor, que publica las suyas, o no tiene
 * forma fija (la figura). Es lo que valida `incoherenciasFormaPieza`, y el mismo reparto que viaja al
 * contrato.
 */
export const LAMINA_POR_OFICIAL: Readonly<Partial<Record<EstructuraOficialId, LaminaFormasPieza>>> = {
  pared_densa: "pared",
  pared_no_densa: "pared",
  pared_organica: "pared",
  aro_circular: "circulo",
  techo_globos: "techo-globos",
  centro_mesa: "centro-mesa",
  bouquet: "bouquet",
};

/** Las oficiales que ofrecen formas, derivadas de la tabla y no escritas a mano. */
export const OFICIALES_CON_FORMAS: readonly EstructuraOficialId[] = ESTRUCTURAS_OFICIALES_IDS.filter(
  (id) => LAMINA_POR_OFICIAL[id] !== undefined,
);

/** Las formas que ofrece una estructura oficial, en el orden del dueño; vacío si no ofrece ninguna. */
export function formasDeOficial(oficial: string | null | undefined): readonly FormaPiezaFicha[] {
  const lamina = oficial === null || oficial === undefined ? undefined : LAMINA_POR_OFICIAL[oficial as EstructuraOficialId];
  return lamina === undefined ? [] : FORMAS_POR_LAMINA[lamina];
}

/**
 * La ficha de una forma elegida (su nombre y su ayuda), o `null` si esa oficial no la ofrece.
 *
 * El `id` solo tiene sentido junto a su oficial: el dueño repite ids entre láminas con significados
 * distintos (`helio` es «Helio con cintas» en un techo y «Bouquet de helio» en un centro de mesa; `figura`
 * solo existe en el centro de mesa). Por eso no hay un enum global de ids y la unidad de validación es el
 * par (oficial, forma).
 */
export function fichaDeForma(oficial: string | null | undefined, forma: string): FormaPiezaFicha | null {
  return formasDeOficial(oficial).find((ficha) => ficha.id === forma) ?? null;
}

/** Longitud máxima del id de una forma en el contrato: la más larga del dueño («malla-links», 11) con holgura. */
export const MAX_LARGO_FORMA_PIEZA = 40;

/**
 * Incoherencias entre la forma elegida y la estructura oficial de la pieza. Vacío = coherente.
 *
 * Es la misma tabla que las reglas `allOf` del JSON Schema exportado (`reglasJsonSchemaFormaPieza`), para
 * que Zod y el esquema que valida Python rechacen exactamente lo mismo: una `media-luna` en una pared no
 * existe, y un arco no elige forma aquí porque la elige su motor.
 */
export function incoherenciasFormaPieza(estructura: { estructura_oficial?: string; forma?: string }): Array<{ campo: "forma"; mensaje: string }> {
  if (estructura.forma === undefined) return [];
  if (estructura.estructura_oficial === undefined) {
    return [{ campo: "forma", mensaje: "Una forma elegida necesita declarar estructura_oficial." }];
  }
  const formas = formasDeOficial(estructura.estructura_oficial);
  const nombre = ESTRUCTURAS_OFICIALES[estructura.estructura_oficial as EstructuraOficialId]?.nombre ?? estructura.estructura_oficial;
  if (formas.length === 0) {
    return [{ campo: "forma", mensaje: `${nombre} no elige forma: la define su motor de armado.` }];
  }
  if (!formas.some((ficha) => ficha.id === estructura.forma)) {
    return [{ campo: "forma", mensaje: `${nombre} admite las formas ${formas.map((ficha) => ficha.id).join(", ")}.` }];
  }
  return [];
}

export type FormasPiezaContrato = Partial<Record<EstructuraOficialId, readonly string[]>>;

/**
 * Las formas de cada oficial en la forma que se exporta al contrato (`x-formas-pieza`), para que Python las
 * lea de aquí en vez de repetirlas: `app/dibujo_estructura.py` las usa para no creerle a ciegas a una forma
 * que no es de esa pieza, y `app/plan_edicion.py` para rechazar la edición que la pondría.
 */
export function formasPiezaPorOficial(): FormasPiezaContrato {
  return Object.fromEntries(
    OFICIALES_CON_FORMAS.map((oficial) => [oficial, formasDeOficial(oficial).map((ficha) => ficha.id)]),
  ) as FormasPiezaContrato;
}

/**
 * La tabla de coherencia como reglas `allOf` de JSON Schema para un objeto estructura, igual que
 * `reglasJsonSchemaEstructuraOficial` hace con el tipo, la densidad y la ubicación. La exportación del
 * contrato las inyecta, así que el servicio Python —que solo ve el JSON Schema generado— aplica la misma
 * tabla que `incoherenciasFormaPieza` y este archivo sigue siendo el único dueño.
 *
 * Tres reglas, no una por oficial: la forma no vale sin su oficial, cada oficial con lámina acota su enum y
 * cualquier otra oficial no admite forma.
 */
export function reglasJsonSchemaFormaPieza(): Array<Record<string, unknown>> {
  const conFormas = [...OFICIALES_CON_FORMAS];
  return [
    { if: { required: ["forma"] }, then: { required: ["estructura_oficial"] } },
    ...conFormas.map((oficial) => ({
      if: { properties: { estructura_oficial: { const: oficial } }, required: ["estructura_oficial"] },
      then: { properties: { forma: { enum: formasDeOficial(oficial).map((ficha) => ficha.id) } } },
    })),
    {
      if: { properties: { estructura_oficial: { not: { enum: conFormas } } }, required: ["estructura_oficial"] },
      then: { not: { required: ["forma"] } },
    },
  ];
}
