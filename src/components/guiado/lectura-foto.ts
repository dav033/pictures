import type { ReferenciaGuiada } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { partesDeColorPieza } from "@/lib/plan/colores-referencia";
import { CONFIANZA_MINIMA_FLORES } from "@/lib/plan/flores-pieza";
import { clasificarColores } from "@/lib/rag/taxonomy/v2";
import { colorLeido, familiaSempertex, type AcabadoGlobo, type ColorLeido } from "./color-globo";
import { colorSempertex } from "./color-sempertex";

/**
 * La lectura de la foto de inspiración, ordenada para mostrarla: cada pieza de globos POR SEPARADO (una pareja en
 * espejo son dos fichas), con su número, su recuadro en la foto, su nombre individual («Columna izquierda»), sus
 * colores con el acabado, las referencias Sempertex medidas, los tamaños, el conteo y el remate. Solo traduce y
 * ordena lo que trae el `blueprint` de la lectura: no inventa medidas ni colores ni decide nada del plan. Puro.
 */

type Blueprint = ReferenciaGuiada["blueprint"];
type Elemento = Blueprint["elements"][number];

/** Como en `adaptarAnalisisReferencia`: las mismas piezas, el mismo tope. */
const MAX_PIEZAS = 8;

export type ColorPieza = ColorLeido & {
  /** Parte de la pieza que ocupa este color (0-1), la misma que usa el plan (`partesDeColorPieza`), si se midió. */
  parte: number | null;
  /**
   * Lo que se MUESTRA: la parte en % entero, presentada para que los colores de la pieza sumen 100 (`porcentajesQueSuman`).
   * La lectura guardada (`parte`) no cambia. null: sin cifra.
   */
  porcentaje: number | null;
  /** El globo Sempertex medido en la foto para este color («Reflex Plata», código 981), si la familia es fiable. */
  sempertex: { nombre: string; codigo: string } | null;
};

export type ClaseTamano = "chico" | "mediano" | "grande" | "gigante";

export type TamanoPieza = {
  clase: ClaseTamano;
  /** «Chicos», «Medianos», «Grandes», «Gigantes». */
  etiqueta: string;
  /** Pulgadas de la clase, como las define el conteo (`CLASES_TAMANO_CONTEO`): «5–9″», «12″», «18–24″», «36″». */
  pulgadas: string;
  /** Pulgadas para dibujar el globo de muestra. */
  dibujo: number;
  proporcion: number;
  /** La proporción en % entero, de modo que los tamaños de la pieza sumen 100. */
  porcentaje: number;
};

export type PiezaLeida = {
  /** 1, 2, 3… de izquierda a derecha: el mismo número en la ficha y en el recuadro. */
  numero: number;
  /** Índice del recuadro (dos piezas de un mismo elemento comparten recuadro). */
  caja: number;
  /** Nombre individual: «Columna izquierda», «Columna derecha», «Arco», «Columna 3». */
  nombre: string;
  /** «Columna orgánica», «Medio arco». */
  tipo: string;
  /** «a la izquierda», «inclinada hacia la derecha», «muy llena». */
  detalles: string[];
  /** «≈ 2,4 m de alto · 1 m de ancho», solo si la lectura trae medidas. */
  medidas: string | null;
  /** «≈ 45 globos a la vista», solo si la lectura contó. */
  globos: string | null;
  globosVisibles: number | null;
  /** La cifra que dice `globos` (exacta, estimada o a la vista) y de qué clase es: con ella se suma el total. */
  globosCifra: { valor: number; clase: "exacto" | "estimado" | "visibles" } | null;
  colores: ColorPieza[];
  tamanos: TamanoPieza[];
  /** Sin reparto por tamaño: lo que la lectura dijo en palabras («Sobre todo chicos, con algunos grandes»). */
  tamanosFrase: string | null;
  /** «Globo metalizado plata en el extremo izquierdo». */
  remates: string[];
  confianza: "alta" | "media" | "baja";
};

export type CajaLeida = { x: number; y: number; ancho: number; alto: number; numeros: number[]; nombre: string };

export type LecturaFoto = {
  piezas: PiezaLeida[];
  cajas: CajaLeida[];
  /** Todos los colores de las piezas, sin repetir (para la fila de arriba). */
  colores: ColorPieza[];
  /** Suma de los globos que se ven en las piezas contadas, o null si ninguna se contó. */
  globosVisibles: number | null;
  /**
   * El total para la cabecera, con la MISMA cifra que dice cada pieza (el estimado si lo hay): «≈ 160 globos en total»,
   * «≈ 90 globos a la vista» o «160 globos». Antes sumaba los visibles (≈ 90) junto a piezas de ≈ 75 y ≈ 85.
   */
  globosTotal: string | null;
  /** Lo que no es de globos y no entra en el plan: «un fondo», «flores». */
  otros: string[];
};

type Sustantivo = { nombre: string; genero: "m" | "f"; conLado: boolean };

const SUSTANTIVOS: Readonly<Record<string, Sustantivo>> = {
  arco: { nombre: "Arco", genero: "m", conLado: false },
  semiarco: { nombre: "Medio arco", genero: "m", conLado: true },
  columna: { nombre: "Columna", genero: "f", conLado: true },
  guirnalda: { nombre: "Guirnalda", genero: "f", conLado: false },
  pared: { nombre: "Pared de globos", genero: "f", conLado: false },
  centro_mesa: { nombre: "Centro de mesa", genero: "m", conLado: false },
  backdrop: { nombre: "Fondo de globos", genero: "m", conLado: false },
  kit: { nombre: "Kit de globos", genero: "m", conLado: false },
  accesorio: { nombre: "Detalle de globos", genero: "m", conLado: false },
  escultura: { nombre: "Figura de globos", genero: "f", conLado: false },
};
const PIEZA: Sustantivo = { nombre: "Pieza de globos", genero: "f", conLado: false };

const UBICACION: Readonly<Record<string, string>> = {
  lateral_izquierdo: "a la izquierda",
  lateral_derecho: "a la derecha",
  fondo_pared: "contra la pared del fondo",
  sobre_mesa_principal: "sobre la mesa principal",
  piso_frontal: "en el piso, al frente",
  mesas_invitados: "en las mesas de invitados",
  entrada: "en la entrada",
  techo: "en el techo",
  techo_multipunto: "en el techo",
  arco_central: "al centro",
  zona_central: "al centro",
  fachada: "en la fachada",
  pared_lateral: "en una pared lateral",
  alrededor_mobiliario: "alrededor de los muebles",
  esquina: "en una esquina",
  recorrido_suelo: "a lo largo del piso",
};

const OTROS: Readonly<Record<string, string>> = {
  curtain: "una cortina", drape: "telas", backdrop: "un fondo", panel: "un panel", plinth: "un pedestal",
  furniture: "muebles", floral: "flores", signage: "un letrero", lighting: "luces", tableware: "vajilla", other: "otros objetos",
};

/** Clases del conteo con sus pulgadas (`CLASES_TAMANO_CONTEO`: 5"/9" · 12" · 18"/24" · 36"). */
const CLASES: ReadonlyArray<{ clase: ClaseTamano; etiqueta: string; pulgadas: string; dibujo: number }> = [
  { clase: "chico", etiqueta: "Chicos", pulgadas: "5–9″", dibujo: 7 },
  { clase: "mediano", etiqueta: "Medianos", pulgadas: "12″", dibujo: 12 },
  { clase: "grande", etiqueta: "Grandes", pulgadas: "18–24″", dibujo: 21 },
  { clase: "gigante", etiqueta: "Gigantes", pulgadas: "36″", dibujo: 36 },
];

const TAMANOS_FRASE: Readonly<Record<string, string>> = {
  casi_todos_gigantes: "Casi todos gigantes (36″)",
  grandes_con_pocos_chicos: "Sobre todo grandes, con algunos chicos",
  chicos_con_pocos_grandes: "Sobre todo chicos, con algunos grandes",
  un_solo_tamano: "Todos del mismo tamaño",
};

const REMATE_COLUMNA: Readonly<Record<string, string>> = { globo: "un globo", racimo: "un racimo", estrella: "una estrella", corazon: "un corazón" };
const REMATE_GUIRNALDA: Readonly<Record<string, string>> = { latex: "Globo de látex", metalizado: "Globo metalizado", burbuja: "Globo burbuja" };
const POSICION_REMATE: Readonly<Record<string, string>> = { extremo_izq: "en el extremo izquierdo", extremo_der: "en el extremo derecho", centro: "en el centro", cada_n: "repartidos a lo largo" };

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

function concordar(adjetivo: string, genero: "m" | "f"): string {
  return genero === "f" ? adjetivo.replace(/o$/, "a") : adjetivo;
}

function sustantivoDe(elemento: Elemento): Sustantivo {
  const tipo = elemento.visual_semantics?.structure_type;
  return (tipo ? SUSTANTIVOS[tipo] : undefined) ?? PIEZA;
}

function nombreColor(texto: string | undefined): string | null {
  if (!texto) return null;
  return colorLeido(texto)?.nombre ?? null;
}

/**
 * Colores de una pieza: los que nombró la lectura, con su parte y su referencia Sempertex.
 *
 * La parte es la MISMA que recibe el plan (`partesDeColorPieza`, la única fuente de proporción de la pieza en el turno
 * de /api/chat): la medida en píxeles o, cuando esa medida pone delante un neutro que la lectura de la disposición no
 * (un cromado o un perlado que refleja la luz y la cortina), las partes de la disposición. Probador 124, hallazgo 7: la
 * foto 01 se mostraba «plata cromado 57 %» (píxeles) y el plan se armaba con rosado 40 / blanco 30 / plata 30 (la
 * disposición), así que el cliente veía en la tarjeta un color dominante y en su plan otro.
 */
function coloresDe(elemento: Elemento): ColorPieza[] {
  const apariencia = elemento.appearance;
  const medidos = new Map<string, number>();
  for (const medido of partesDeColorPieza(apariencia).partes) {
    const clave = clasificarColores(medido.color);
    const paleta = clave.status === "known" ? clave.values[0] : undefined;
    if (paleta && !medidos.has(paleta)) medidos.set(paleta, medido.share);
  }
  const nombres = apariencia.resolved_colors.length ? apariencia.resolved_colors : apariencia.observed_colors;
  const colores: ColorPieza[] = [];
  const vistos = new Set<string>();
  for (const texto of [...(apariencia.color_unico ? [apariencia.color_unico] : []), ...nombres]) {
    const color = colorLeido(texto);
    if (!color || vistos.has(color.nombre)) continue;
    vistos.add(color.nombre);
    colores.push({ ...color, parte: color.clave ? medidos.get(color.clave) ?? null : null, porcentaje: null, sempertex: null });
  }
  // Las referencias Sempertex medidas: se pegan al color de su misma paleta; si no hay ninguno, entran como color.
  for (const referencia of apariencia.referencias_medidas ?? []) {
    if (!referencia.familia_fiable) continue;
    const familia = familiaSempertex(referencia.familia) ?? familiaSempertex(referencia.nombre_completo);
    const leido = colorLeido(referencia.nombre);
    const destino = leido?.clave ? colores.find((color) => color.clave === leido.clave && !color.sempertex) : undefined;
    const sempertex = { nombre: referencia.nombre_completo, codigo: referencia.codigo };
    // Con la referencia Sempertex medida, nombre y tono de la fuente única (`color-sempertex`): «Plata cromado» y el hex
    // del catálogo, como los chips, la tabla y los materiales del plan que sale de esta foto.
    const catalogo = colorSempertex(leido?.clave ?? referencia.nombre, { titulo: referencia.nombre_completo });
    if (destino) {
      destino.sempertex = sempertex;
      if (catalogo.producto) Object.assign(destino, { nombre: catalogo.nombre.toLocaleLowerCase("es"), hex: catalogo.hex });
      if (destino.parte === null) destino.parte = referencia.parte;
      if (familia && destino.acabado === "estandar") destino.acabado = familia.acabado;
      continue;
    }
    if (!leido || vistos.has(leido.nombre)) continue;
    const acabado: AcabadoGlobo = familia?.acabado ?? leido.acabado;
    const adjetivo = familia && familia.cliente !== "liso" ? familia.cliente : leido.adjetivo;
    const nombre = catalogo.producto ? catalogo.nombre.toLocaleLowerCase("es") : [leido.color, adjetivo].filter(Boolean).join(" ");
    vistos.add(nombre);
    colores.push({ ...leido, nombre, adjetivo, acabado, parte: referencia.parte, porcentaje: null, sempertex, ...(catalogo.producto ? { hex: catalogo.hex } : {}) });
  }
  const ordenados = colores.sort((a, b) => (b.parte ?? -1) - (a.parte ?? -1));
  const porcentajes = porcentajesQueSuman(ordenados.map((color) => color.parte));
  return ordenados.map((color, indice) => ({ ...color, porcentaje: porcentajes[indice] ?? null }));
}

/**
 * Porcentajes enteros para MOSTRAR las partes (0-1) de una pieza, que la lectura mide con bases distintas (píxeles por
 * color y referencia Sempertex): una columna salía con 57 + 32 + 27 + 10 = 126 % y otra con 65 + 15 + 3 = 83 % más un
 * «Transparente» sin cifra (probador 124, hallazgo 13). La lectura guardada no se toca; solo lo que se lee:
 *  - lo medido suma más de 100, o todo está medido: se reparte en proporción hasta sumar 100;
 *  - suma menos de 100 y queda UN color sin medir: los medidos quedan como están y ese color es el resto;
 *  - con varios sin medir: los medidos se reparten hasta 100 y los demás quedan sin cifra (no se inventa un reparto).
 * Redondeo por mayor resto, sin que ningún color medido baje de 1 %. Puro.
 */
export function porcentajesQueSuman(partes: ReadonlyArray<number | null>): Array<number | null> {
  const salida: Array<number | null> = partes.map(() => null);
  const indices = partes.flatMap((parte, indice) => (parte !== null && Number.isFinite(parte) && parte > 0 ? [indice] : []));
  if (!indices.length) return salida;
  const valor = (indice: number) => partes[indice] as number;
  const suma = indices.reduce((total, indice) => total + valor(indice), 0);
  const sinMedir = partes.length - indices.length;
  if (suma < 1 && sinMedir === 1) {
    const medidos = repartirEnteros(indices.map((indice) => valor(indice) * 100), Math.max(indices.length, Math.round(suma * 100)));
    indices.forEach((indice, posicion) => { salida[indice] = medidos[posicion]!; });
    const resto = 100 - medidos.reduce((total, parte) => total + parte, 0);
    const faltante = partes.findIndex((_, indice) => !indices.includes(indice));
    if (resto >= 1 && faltante >= 0) salida[faltante] = resto;
    return salida;
  }
  const enteros = repartirEnteros(indices.map((indice) => (valor(indice) / suma) * 100), 100);
  indices.forEach((indice, posicion) => { salida[indice] = enteros[posicion]!; });
  return salida;
}

/** Enteros (cada uno ≥ 1) que suman `total`, lo más cerca posible de `exactos`: mayor resto. */
function repartirEnteros(exactos: readonly number[], total: number): number[] {
  const enteros = exactos.map((exacto) => Math.max(1, Math.floor(exacto)));
  let falta = total - enteros.reduce((suma, entero) => suma + entero, 0);
  const porResto = exactos.map((exacto, indice) => ({ indice, resto: exacto - Math.floor(exacto) })).sort((a, b) => b.resto - a.resto || exactos[b.indice]! - exactos[a.indice]!);
  for (let vuelta = 0; falta > 0 && porResto.length; vuelta += 1) {
    enteros[porResto[vuelta % porResto.length]!.indice]! += 1;
    falta -= 1;
  }
  while (falta < 0) {
    // Los mínimos de 1 % pasaron del total: se descuenta del mayor que pueda ceder.
    const mayor = enteros.reduce((elegido, entero, indice) => (entero > 1 && entero > (enteros[elegido] ?? 0) ? indice : elegido), 0);
    if ((enteros[mayor] ?? 0) <= 1) break;
    enteros[mayor]! -= 1;
    falta += 1;
  }
  return enteros;
}

function tamanosDe(elemento: Elemento): { tamanos: TamanoPieza[]; frase: string | null } {
  const reparto = elemento.appearance.conteo?.por_tamano ?? [];
  const presentes = CLASES.flatMap((clase) => {
    const item = reparto.find((entrada) => entrada.clase === clase.clase);
    return item ? [{ ...clase, proporcion: item.proporcion }] : [];
  });
  // Los tamaños también suman 100 al mostrarse (los redondeos daban 99 o 101).
  const porcentajes = porcentajesQueSuman(presentes.map((tamano) => tamano.proporcion));
  const tamanos = presentes.map((tamano, indice) => ({ ...tamano, porcentaje: porcentajes[indice] ?? Math.max(1, Math.round(tamano.proporcion * 100)) }));
  const leido = elemento.appearance.tamanos_leidos;
  return { tamanos, frase: tamanos.length ? null : (leido ? TAMANOS_FRASE[leido] ?? null : null) };
}

function remateDe(elemento: Elemento): string[] {
  const remates: string[] = [];
  const columna = elemento.appearance.remate_columna;
  if (columna && columna.tipo !== "ninguno") {
    const color = nombreColor(columna.color);
    remates.push(`Remata en ${REMATE_COLUMNA[columna.tipo] ?? columna.tipo}${color ? ` ${color}` : ""}`);
  }
  for (const remate of elemento.appearance.armado_guirnalda?.remates ?? []) {
    const color = nombreColor(remate.color);
    remates.push(`${REMATE_GUIRNALDA[remate.clase] ?? "Globo"}${color ? ` ${color}` : ""} ${POSICION_REMATE[remate.posicion] ?? ""}`.trim());
  }
  return [...new Set(remates)];
}

function globosDe(elemento: Elemento): { texto: string | null; visibles: number | null; cifra: PiezaLeida["globosCifra"] } {
  const conteo = elemento.appearance.conteo;
  if (!conteo || conteo.globos_visibles <= 0) return { texto: null, visibles: null, cifra: null };
  if (conteo.exacto) return { texto: `${NUMERO.format(conteo.globos_visibles)} globos`, visibles: conteo.globos_visibles, cifra: { valor: conteo.globos_visibles, clase: "exacto" } };
  if (conteo.estimado_total) return { texto: `≈ ${NUMERO.format(conteo.estimado_total)} globos (se ven ${NUMERO.format(conteo.globos_visibles)})`, visibles: conteo.globos_visibles, cifra: { valor: conteo.estimado_total, clase: "estimado" } };
  return { texto: `≈ ${NUMERO.format(conteo.globos_visibles)} globos a la vista`, visibles: conteo.globos_visibles, cifra: { valor: conteo.globos_visibles, clase: "visibles" } };
}

/**
 * El total de la cabecera con la misma cifra que dice cada pieza: todas exactas → «160 globos»; alguna estimada →
 * «≈ 160 globos en total»; solo las que se ven → «≈ 90 globos a la vista». Null si ninguna pieza se contó.
 */
export function totalGlobosLeidos(cifras: ReadonlyArray<PiezaLeida["globosCifra"]>): string | null {
  const contadas = cifras.filter((cifra): cifra is NonNullable<PiezaLeida["globosCifra"]> => cifra !== null);
  if (!contadas.length) return null;
  const total = contadas.reduce((suma, cifra) => suma + cifra.valor, 0);
  if (contadas.every((cifra) => cifra.clase === "exacto")) return `${NUMERO.format(total)} ${total === 1 ? "globo" : "globos"}`;
  if (contadas.some((cifra) => cifra.clase === "estimado")) return `≈ ${NUMERO.format(total)} globos en total`;
  return `≈ ${NUMERO.format(total)} globos a la vista`;
}

function medidasDe(elemento: Elemento): string | null {
  const medidas = elemento.visual_semantics?.dimensions_m;
  if (!medidas) return null;
  const partes = [
    medidas.height ? `${NUMERO.format(medidas.height)} m de alto` : null,
    medidas.width ? `${NUMERO.format(medidas.width)} m de ancho` : null,
    medidas.length ? `${NUMERO.format(medidas.length)} m de largo` : null,
  ].filter((parte): parte is string => parte !== null);
  return partes.length ? `≈ ${partes.join(" · ")}` : null;
}

function confianzaDe(valor: number): PiezaLeida["confianza"] {
  return valor >= 0.85 ? "alta" : valor >= 0.6 ? "media" : "baja";
}

type Instancia = { elemento: Elemento; caja: number; indice: number; total: number; centro: number };

/** Lado de cada pieza dentro de su grupo (mismo sustantivo): la ubicación leída manda; si no, su posición en la foto. */
function ladosDe(grupo: Instancia[]): Array<"izquierda" | "derecha" | null> {
  if (grupo.length !== 2) return grupo.map(() => null);
  const leidos = grupo.map((instancia) => {
    const ubicacion = instancia.elemento.visual_semantics?.placement;
    return ubicacion === "lateral_izquierdo" ? "izquierda" : ubicacion === "lateral_derecho" ? "derecha" : null;
  });
  if (leidos[0] && leidos[1] && leidos[0] !== leidos[1]) return leidos;
  // Una pareja leída como un solo elemento (2 instancias, mismo recuadro): la primera a la izquierda.
  const [a, b] = grupo;
  if (a!.caja === b!.caja) return a!.indice <= b!.indice ? ["izquierda", "derecha"] : ["derecha", "izquierda"];
  return a!.centro <= b!.centro ? ["izquierda", "derecha"] : ["derecha", "izquierda"];
}

export function lecturaFoto(blueprint: Blueprint): LecturaFoto | null {
  const elementos = blueprint.elements.filter((elemento) => elemento.approved && elemento.category === "balloon_structure").slice(0, MAX_PIEZAS);
  if (!elementos.length) return null;

  // Cajas en el orden de la foto (de izquierda a derecha, luego de arriba abajo).
  const ordenados = [...elementos].sort((a, b) => (a.reference_bbox.x + a.reference_bbox.width / 2) - (b.reference_bbox.x + b.reference_bbox.width / 2) || a.reference_bbox.y - b.reference_bbox.y);
  const instancias: Instancia[] = [];
  ordenados.forEach((elemento, caja) => {
    const total = elemento.quantity_semantics === "physical_instances" ? Math.max(1, elemento.quantity.max) : 1;
    for (let indice = 0; indice < total && instancias.length < MAX_PIEZAS; indice += 1) {
      instancias.push({ elemento, caja, indice, total, centro: elemento.reference_bbox.x + elemento.reference_bbox.width / 2 });
    }
  });

  // Nombres individuales por grupo de piezas iguales: 1 → su nombre; 2 con lado → izquierda/derecha; si no, numeradas.
  const nombres = new Map<Instancia, string>();
  const porSustantivo = new Map<string, Instancia[]>();
  for (const instancia of instancias) {
    const clave = sustantivoDe(instancia.elemento).nombre;
    porSustantivo.set(clave, [...(porSustantivo.get(clave) ?? []), instancia]);
  }
  for (const grupo of porSustantivo.values()) {
    const sustantivo = sustantivoDe(grupo[0]!.elemento);
    const lados = sustantivo.conLado ? ladosDe(grupo) : grupo.map(() => null);
    grupo.forEach((instancia, posicion) => {
      const lado = lados[posicion];
      nombres.set(instancia, grupo.length === 1 ? sustantivo.nombre
        : lado ? `${sustantivo.nombre} ${concordar(lado === "izquierda" ? "izquierdo" : "derecho", sustantivo.genero)}`
          : `${sustantivo.nombre} ${posicion + 1}`);
    });
  }

  const piezas: PiezaLeida[] = instancias.map((instancia, posicion) => {
    const { elemento } = instancia;
    const sustantivo = sustantivoDe(elemento);
    const organica = /\borgan/i.test(`${elemento.name} ${elemento.appearance.shape}`);
    const tipo = organica ? `${sustantivo.nombre} ${concordar("orgánico", sustantivo.genero)}` : sustantivo.nombre;
    const detalles: string[] = [];
    const nombre = nombres.get(instancia) ?? sustantivo.nombre;
    const ubicacion = elemento.visual_semantics?.placement;
    const textoUbicacion = ubicacion ? UBICACION[ubicacion] : undefined;
    // «a la izquierda» sobra si el nombre ya lo dice.
    if (textoUbicacion && !(textoUbicacion.endsWith("izquierda") && /izquierd/.test(nombre)) && !(textoUbicacion.endsWith("derecha") && /derech/.test(nombre))) detalles.push(textoUbicacion);
    const inclinacion = elemento.appearance.inclinacion;
    if (typeof inclinacion === "number" && Math.abs(inclinacion) >= 0.08) detalles.push(`${concordar("inclinado", sustantivo.genero)} hacia la ${inclinacion > 0 ? "derecha" : "izquierda"}`);
    const densidad = elemento.visual_semantics?.density;
    if (densidad === "lujosa") detalles.push(`muy ${concordar("lleno", sustantivo.genero)}`);
    if (densidad === "sencilla") detalles.push(concordar("sencillo", sustantivo.genero));
    if (instancia.total > 1) detalles.push(`${instancia.indice + 1} de ${instancia.total} iguales`);
    // Las flores de globo que la lectura vio sobre la pieza (flores-pieza.ts): el plan las arma con sus globos.
    const flores = elemento.appearance.flores;
    if (flores && flores.confianza >= CONFIANZA_MINIMA_FLORES) {
      detalles.push(`con ${flores.cantidad === 1 ? "una flor" : `${flores.cantidad} flores`} de globo ${flores.color_petalo}${flores.petalos ? ` de ${flores.petalos} pétalos` : ""}${flores.color_centro ? ` y centro ${flores.color_centro}` : ""}`);
    }
    const globos = globosDe(elemento);
    const { tamanos, frase } = tamanosDe(elemento);
    return {
      numero: posicion + 1,
      caja: instancia.caja,
      nombre,
      tipo,
      detalles,
      medidas: medidasDe(elemento),
      // Dos piezas leídas como un solo elemento comparten el conteo: se dice en la primera, no se reparte.
      globos: instancia.indice === 0 ? globos.texto : null,
      globosVisibles: instancia.indice === 0 ? globos.visibles : null,
      globosCifra: instancia.indice === 0 ? globos.cifra : null,
      colores: coloresDe(elemento),
      tamanos,
      tamanosFrase: frase,
      remates: remateDe(elemento),
      confianza: confianzaDe(elemento.detection_confidence),
    };
  });

  const cajas: CajaLeida[] = ordenados.map((elemento, indice) => {
    const deEsta = piezas.filter((pieza) => pieza.caja === indice);
    return {
      x: elemento.reference_bbox.x,
      y: elemento.reference_bbox.y,
      ancho: elemento.reference_bbox.width,
      alto: elemento.reference_bbox.height,
      numeros: deEsta.map((pieza) => pieza.numero),
      nombre: deEsta.length === 1 ? deEsta[0]!.nombre : deEsta.map((pieza) => pieza.nombre).join(" y "),
    };
  }).filter((caja) => caja.numeros.length > 0);

  const colores: ColorPieza[] = [];
  for (const pieza of piezas) for (const color of pieza.colores) if (!colores.some((otro) => otro.nombre === color.nombre)) colores.push(color);
  const contadas = piezas.map((pieza) => pieza.globosVisibles).filter((valor): valor is number => valor !== null);
  const otros = [...new Set(blueprint.elements
    .filter((elemento) => elemento.approved && elemento.category !== "balloon_structure")
    .map((elemento) => OTROS[elemento.category])
    .filter((texto): texto is string => Boolean(texto)))];

  return { piezas, cajas, colores, globosVisibles: contadas.length ? contadas.reduce((suma, valor) => suma + valor, 0) : null, globosTotal: totalGlobosLeidos(piezas.map((pieza) => pieza.globosCifra)), otros };
}

/** «un fondo, flores y otros objetos». */
export function unirConY(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}
