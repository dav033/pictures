/**
 * Parte `capacidad_faltante` (la clase de fallo que marca casi todas las fotos) en las causas concretas que se pueden leer de lo
 * que el arnés ya tiene, sin modelo: lo que la lectura pide contra lo que la escena final tiene, por familia de estructura; las
 * piezas `otro` que el taller no sabe armar; y los rechazos de las herramientas y de la compilación (fondo fijo, medida fuera de
 * rango, color que no está en la tabla, cuerpo que no cabe). `capacidad_faltante` sigue siendo la clase madre de todas: las filas
 * viejas, que no traen detalle, se siguen agrupando bajo ella. Puro: recibe la evidencia ya reunida.
 */
import { resolverOtro } from "@/lib/globos3d/lectura-otro";
import { clavePedida, clavePedidaDeFigura, clavePuesta, familiaDeClave, familiaDeOtro, type NodoResumido, type PiezaResumida } from "./lib-familias";

export const CLASES_CAPACIDAD = [
  "falta_arco", "falta_columna", "falta_guirnalda", "falta_pared", "falta_figura", "falta_mueble_fondo",
  "otro_pendiente", "fondo_fijo", "tamano_fuera_de_rango", "color_no_disponible", "presupuesto_cuerpo",
] as const;
export type ClaseCapacidad = (typeof CLASES_CAPACIDAD)[number];

/** La clase de fallo de la que cuelgan todas las de capacidad (`ClaseFallo` en `lib-fallos.ts`). */
export const PADRE_DE_CAPACIDAD = "capacidad_faltante" as const;

/** Cuántas causas distintas de cada clase hubo en una pasada: una por pieza que falta o por mensaje de rechazo distinto. Ausente = ninguna. */
export type ConteoCapacidad = Partial<Record<ClaseCapacidad, number>>;

export type EvidenciaCapacidad = {
  /** Las piezas que leyó el lector. */
  piezasLeidas: readonly PiezaResumida[];
  /** Los nodos de la escena final (tras el refino). */
  nodosFinales: readonly NodoResumido[];
  /** Lo que la compilación no armó (`Modelado.omitidas`): descripciones de «otro» y motivos de rechazo. */
  omitidas: readonly string[];
  /** Los errores de las herramientas del asistente (`ok: false`), uno por llamada que falló. */
  erroresHerramientas: readonly string[];
};

const sinAcentos = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Cómo se reconoce cada rechazo por su texto (sin acentos). El primero que encaja manda. */
const PATRONES_DE_RECHAZO: ReadonlyArray<readonly [ClaseCapacidad, RegExp]> = [
  ["fondo_fijo", /es un fondo fijo del catalogo/],
  ["tamano_fuera_de_rango", /fuera de rango|se infla entre \d+ y \d+ cm/],
  ["color_no_disponible", /no encontre el color|no esta en la tabla sempertex/],
  ["presupuesto_cuerpo", /armarlo de una vez/],
];

/** Cada mensaje distinto cuenta una vez: reintentar lo mismo con otra cifra («60 cm», «36 cm») no es otra capacidad que falta. */
const huellaDeRechazo = (textoSinAcentos: string) => textoSinAcentos.replace(/\d+(?:[.,]\d+)?/g, "N").replace(/\s+/g, " ").trim();

function clasesDeRechazos(rechazos: readonly string[]): ClaseCapacidad[] {
  const vistos = new Set<string>();
  const clases: ClaseCapacidad[] = [];
  for (const rechazo of rechazos) {
    const texto = sinAcentos(rechazo);
    const huella = huellaDeRechazo(texto);
    if (vistos.has(huella)) continue;
    vistos.add(huella);
    const clase = PATRONES_DE_RECHAZO.find(([, patron]) => patron.test(texto))?.[0];
    if (clase) clases.push(clase);
  }
  return clases;
}

const sumarA = <K extends string>(mapa: Map<K, number>, clave: K, n = 1) => { mapa.set(clave, (mapa.get(clave) ?? 0) + n); };

/** El conteo en el orden de `CLASES_CAPACIDAD` y sin las clases que no se vieron. */
function aConteo(mapa: ReadonlyMap<ClaseCapacidad, number>): ConteoCapacidad {
  const conteo: ConteoCapacidad = {};
  for (const clase of CLASES_CAPACIDAD) {
    const n = mapa.get(clase);
    if (n) conteo[clase] = n;
  }
  return conteo;
}

/**
 * Las causas concretas de que la escena no iguale a la foto, con su cuenta.
 * - Una pieza `otro` que el taller no sabe armar cuenta como `falta_<familia>` por lo que dice su nombre, o `otro_pendiente` si no dice ninguna.
 * - Una figura que el taller arma con otro nombre («calabazas», «número 5 lleno de globos»: `resolverOtro` la da como `figura`) pide la
 *   pieza con que se arma: `decoracion:<id>` o `forma:texto` (una por figura, como una pieza del catálogo: «dos calabazas» es una causa).
 * - Una pieza que sí es del taller (o un «otro» con nombre del catálogo, si no estaba ya leído como fondo) pide una clave a la escena
 *   (`clavePedida`); si la escena final tiene menos nodos de esa clave (`clavePuesta`), falta, y cuenta como `falta_<familia de la clave>`:
 *   la compilación la omitió o el asistente la quitó.
 * - Cada mensaje distinto de rechazo (de la compilación o de una herramienta) cuenta en su clase: `fondo_fijo`, `tamano_fuera_de_rango`,
 *   `color_no_disponible`, `presupuesto_cuerpo`. Una omisión de la compilación por medida también la marca `compilacion` (`lib-fallos.ts`).
 */
export function clasificarCapacidad(evidencia: EvidenciaCapacidad): ConteoCapacidad {
  const cuenta = new Map<ClaseCapacidad, number>();
  const pedidas = new Map<string, number>();
  const fondosLeidos = new Set(evidencia.piezasLeidas.flatMap((p) => (p.tipo === "fondo" && p.id ? [p.id] : [])));
  for (const pieza of evidencia.piezasLeidas) {
    if (pieza.tipo !== "otro") {
      const clave = clavePedida(pieza);
      if (clave) sumarA(pedidas, clave);
      continue;
    }
    const resolucion = resolverOtro(pieza.descripcion ?? "");
    if (resolucion.tipo === "escenografia") continue;
    if (resolucion.tipo === "catalogo") {
      if (!fondosLeidos.has(resolucion.id)) sumarA(pedidas, `fondo:${resolucion.id}`);
      continue;
    }
    if (resolucion.tipo === "figura") {
      for (const figura of resolucion.figuras) sumarA(pedidas, clavePedidaDeFigura(figura));
      continue;
    }
    const familia = familiaDeOtro(pieza.descripcion ?? "");
    sumarA(cuenta, familia ? `falta_${familia}` : "otro_pendiente");
  }
  const puestas = new Map<string, number>();
  for (const nodo of evidencia.nodosFinales) {
    const clave = clavePuesta(nodo);
    if (clave) sumarA(puestas, clave);
  }
  for (const [clave, pedidasDeLaClave] of pedidas) {
    const faltan = pedidasDeLaClave - (puestas.get(clave) ?? 0);
    if (faltan > 0) sumarA(cuenta, `falta_${familiaDeClave(clave)}`, faltan);
  }
  for (const clase of clasesDeRechazos([...evidencia.omitidas, ...evidencia.erroresHerramientas])) sumarA(cuenta, clase);
  return aConteo(cuenta);
}

export const hayCapacidadFaltante = (conteo: ConteoCapacidad | undefined) => conteo !== undefined && Object.keys(conteo).length > 0;

/** Suma los conteos de varias pasadas (las comparables de una foto). */
export function sumarConteos(conteos: ReadonlyArray<ConteoCapacidad | undefined>): ConteoCapacidad {
  const total = new Map<ClaseCapacidad, number>();
  for (const conteo of conteos) for (const clase of CLASES_CAPACIDAD) if (conteo?.[clase]) sumarA(total, clase, conteo[clase]);
  return aConteo(total);
}

/** En cuántas pasadas se vio cada clase: una pasada cuenta una vez por clase, sea cual sea su cuenta. */
export function pasadasPorClase(conteos: ReadonlyArray<ConteoCapacidad | undefined>): ConteoCapacidad {
  const pasadas = new Map<ClaseCapacidad, number>();
  for (const conteo of conteos) for (const clase of CLASES_CAPACIDAD) if (conteo?.[clase]) sumarA(pasadas, clase);
  return aConteo(pasadas);
}

/** La clase que más se repite; en empate gana la primera en el orden de `CLASES_CAPACIDAD`. `null` si no hubo ninguna. */
export function claseDominanteDeCapacidad(conteos: ReadonlyArray<ConteoCapacidad | undefined>): ClaseCapacidad | null {
  const total = sumarConteos(conteos);
  let mejor: ClaseCapacidad | null = null;
  for (const clase of CLASES_CAPACIDAD) if ((total[clase] ?? 0) > (mejor ? total[mejor] ?? 0 : 0)) mejor = clase;
  return mejor;
}
