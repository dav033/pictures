import type { Colocacion } from "./escena";
import { crearDiseno } from "./centros-mesa-diseno";
import { crearEstructura, type PedidoEstructura, type TipoEstructura } from "./herramientas-escena-estructuras";
import { MURALES_PREDEFINIDOS } from "./murales";
import { ARBOLES_PREDEFINIDOS } from "./arboles-globos";
import { armarPieza, type Pieza } from "./piezas";
import type { AcentoFondo, Composicion, FiguraFondo } from "./salon-composicion";
import { ARCO_FONDO_DELANTE_CM } from "./salon-evento";
import { arco, columna, enPared, enPiso, guirnalda, type EstiloSalon } from "./salon-piezas";
import type { ZonasSalon } from "./salon-zonas";

/**
 * **Las composiciones del fondo de fotos** (REQ-008): cada una arma, delante o sobre la pared de la que sale el panel, su propio
 * conjunto de piezas con los colores del pedido. Ninguna es «la de siempre»: el arco con dos columnas y la guirnalda es solo una de las
 * ocho. Las posiciones salen de las medidas del panel (`ZonasSalon.fondo`) y de la sala, y todo queda dentro de ella.
 * - `arco_columnas`: arco, una columna a cada lado y una guirnalda en la pared por encima;
 * - `pared_letras`: pared de trenzas con letras, número o estrella de foil delante y un racimo a cada lado;
 * - `paneles_guirnalda`: una guirnalda orgánica a todo lo ancho y racimos bajos a los lados;
 * - `semiarco_racimos`: un semiarco orgánico con racimos de varias alturas en el piso;
 * - `columnas_techo`: dos columnas altas (y, aparte, un grupo de globos en el techo: salon-decorar-zonas.ts);
 * - `mural`: un mural de globos en la pared con un racimo a cada lado;
 * - `figuras`: palmeras (safari, tropical) o una figura grande de globos (castillo, nube, estrella, corazón) con racimos;
 * - `aro_ramos`: un aro orgánico con ramos de helio alrededor.
 */

export type Adorno = { base: string; nombre: string; pieza: Pieza; colocacion: Colocacion };
export type ContextoFondo = {
  /** El panel del fondo de fotos: centro y medidas (cm). */
  f: NonNullable<ZonasSalon["fondo"]>;
  anchoSalaCm: number;
  altoSalaCm: number;
  nombres: readonly string[];
  estilo: EstiloSalon;
  composicion: Composicion;
  /** Lo que dicen las letras o el número de foil («Ana», «15», «2026»), si lo pidieron. */
  texto?: string;
  notas: string[];
};

const NOMBRE_FIGURA: Readonly<Record<Exclude<FiguraFondo, "palmeras">, string>> = { castillo: "Castillo", nube: "Nube", estrella: "Estrella", corazon: "Corazón" };

/** Una estructura de globos de los colores del pedido. */
const estructura = (c: ContextoFondo, tipo: TipoEstructura, p: PedidoEstructura): Pieza => crearEstructura(tipo, { colores: [...c.nombres], ...p }, c.notas).pieza;

const NOMBRE_ACENTO: Readonly<Record<AcentoFondo, string>> = { corazon: "Corazón", estrella: "Estrella", nube: "Nube", luna: "Luna", flor: "Flor", redondo: "Globo redondo" };

/** La figura de foil del tema, de pie delante del centro del fondo. */
function acento(c: ContextoFondo, delanteCm = 110): Adorno {
  const forma = c.composicion.acento;
  return { base: "foil", nombre: `${NOMBRE_ACENTO[forma]} de foil`, pieza: estructura(c, "metalizado", { forma_metalizado: forma, color_metalizado: "oro", pulgadas: forma === "flor" ? 27 : 32 }), colocacion: enPiso(c.f.xCm, c.f.zCm + delanteCm) };
}

/** Una palabra para el foil: el foil trae solo 0–9 y A–Z, así que sin acentos (Sofía → SOFIA, Begoña → BEGONA) ni signos. */
const limpiarPalabra = (p: string) => p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const MAX_LETRAS_FOIL = 24;

/** Dónde acaba, hacia el frente, lo que arma la composición de pie en el piso (su z más grande, con lo que sobresale de su base). */
function frenteDeLaComposicion(c: ContextoFondo, piezas: readonly Adorno[]): number {
  const frentes = piezas.flatMap((a) => (a.colocacion.en === "piso" ? [a.colocacion.zCm + armarPieza(a.pieza).caja.max.z] : []));
  return frentes.length ? Math.max(...frentes) : c.f.zCm + ARCO_FONDO_DELANTE_CM;
}

/**
 * Las letras o el número de foil que pidió el usuario, de pie delante de TODO lo de la composición (a su frente más la mitad de lo
 * que miden de fondo), en cualquier composición; `null` si no pidió texto. Caben entre las piezas de los lados y dentro de la sala:
 * si no caben todas las palabras se dejan las primeras que sí (palabras enteras), y si ni la primera cabe se recorta por letras. El foil no
 * trae acentos ni signos: se dice.
 */
function letrasDeFoil(c: ContextoFondo, composicion: readonly Adorno[]): Adorno | null {
  const crudo = c.texto?.trim();
  if (!crudo) return null;
  const palabras = crudo.split(/\s+/).map(limpiarPalabra).filter(Boolean);
  if (!palabras.length) { c.notas.push(`El texto «${crudo}» no tiene letras ni números que el foil traiga: no puse letras.`); return null; }
  const disponible = Math.max(60, Math.min(c.anchoSalaCm - 160, 2 * separacion(c)));
  const medir = (texto: string) => {
    const pieza = estructura(c, "metalizado", { color_metalizado: "oro", texto, ...(texto.length > 1 ? { forma_metalizado: "letras" } : {}) });
    const { min, max } = armarPieza(pieza).caja;
    return { pieza, ancho: max.x - min.x, atrasCm: min.z, fondoCm: max.z - min.z };
  };
  let texto = "", medida = medir(palabras[0]!.slice(0, 1));
  for (let k = palabras.length; k >= 1 && !texto; k--) {
    const t = palabras.slice(0, k).join("");
    if (t.length <= MAX_LETRAS_FOIL && (medida = medir(t)).ancho <= disponible) texto = t;
  }
  for (let t = palabras[0]!.slice(0, MAX_LETRAS_FOIL); !texto && t.length >= 1; t = t.slice(0, -1)) if ((medida = medir(t)).ancho <= disponible || t.length === 1) texto = t;
  const completo = palabras.join("");
  const enteras = palabras.some((_, i) => palabras.slice(0, i + 1).join("") === texto);
  const cambios = [
    /[̀-ͯ]/.test(crudo.normalize("NFD")) && "sin acentos",
    crudo.replace(/\s+/g, "").normalize("NFD").replace(/[̀-ͯ]/g, "").length !== completo.length && "sin signos",
    texto !== completo && `${enteras ? "solo las primeras palabras" : "recortado por letras"}, lo que cabe en ${Math.round(disponible)} cm`,
  ].filter(Boolean);
  if (cambios.length) c.notas.push(`Las letras de foil van como «${texto}» (${cambios.join(", ")}): el foil trae solo 0–9 y A–Z.`);
  return { base: "foil", nombre: /^\d+$/.test(texto) ? "Número de foil" : "Letras de foil", pieza: medida.pieza, colocacion: enPiso(c.f.xCm, frenteDeLaComposicion(c, composicion) + 25 - medida.atrasCm) };
}

/** Lo que cabe en la sala: el borde a 80 cm de cada pared lateral. */
const dentroX = (c: ContextoFondo, x: number) => Math.max(-c.anchoSalaCm / 2 + 80, Math.min(c.anchoSalaCm / 2 - 80, x));

function arcoYColumnas(c: ContextoFondo): Adorno[] {
  const { f, estilo, nombres, notas } = c;
  const z = f.zCm + ARCO_FONDO_DELANTE_CM;
  const anchoArco = Math.min(380, Math.max(150, f.anchoCm - 60)), altoArco = Math.min(300, Math.max(150, c.altoSalaCm - 60));
  const lado = anchoArco / 2 + 70;
  const alto = Math.min(230, c.altoSalaCm - 60);
  const salida: Adorno[] = [
    { base: "arco", nombre: "Arco del fondo de fotos", pieza: arco(estilo, nombres, anchoArco, altoArco, notas), colocacion: enPiso(f.xCm, z) },
    { base: "columna", nombre: "Columna del fondo (izquierda)", pieza: columna(estilo, nombres, alto, notas), colocacion: enPiso(f.xCm - lado, z) },
    { base: "columna", nombre: "Columna del fondo (derecha)", pieza: columna(estilo, nombres, alto, notas), colocacion: enPiso(f.xCm + lado, z) },
  ];
  const altura = f.altoCm + 20;
  if (c.altoSalaCm - altura >= 110) salida.push({ base: "guirnalda", nombre: "Guirnalda del fondo", pieza: guirnalda(estilo, nombres, Math.min(600, Math.max(100, f.anchoCm + 80)), notas), colocacion: enPared(f.xCm, altura) });
  return salida;
}

/** Una pieza de pared a la altura pedida (su borde de abajo), o más baja si no cabe bajo el techo. */
function enLaPared(c: ContextoFondo, pieza: Pieza, alturaCm: number): Colocacion {
  const { min, max } = armarPieza(pieza).caja;
  return enPared(c.f.xCm, Math.max(0, Math.min(alturaCm, c.altoSalaCm - (max.y - min.y) - 10)));
}

/** Un racimo de globos orgánicos a cada lado del panel. */
function racimosLaterales(c: ContextoFondo, altoCm: number, grosorCm: number, separacionCm: number): Adorno[] {
  const z = c.f.zCm + ARCO_FONDO_DELANTE_CM;
  return (["izquierda", "derecha"] as const).map((lado, i) => ({
    base: "racimo", nombre: `Racimo del fondo (${lado})`, pieza: estructura(c, "columna_organica", { alto_cm: altoCm, grosor_cm: grosorCm }), colocacion: enPiso(dentroX(c, c.f.xCm + (i === 0 ? -1 : 1) * separacionCm), z),
  }));
}

/** La separación del centro a las columnas o racimos de los lados. */
const separacion = (c: ContextoFondo) => c.f.anchoCm / 2 + 110;

function paredYLetras(c: ContextoFondo): Adorno[] {
  const { f } = c;
  const ancho = Math.min(560, c.anchoSalaCm - 160, f.anchoCm + 200), alto = Math.min(280, c.altoSalaCm - 50);
  return [
    { base: "pared", nombre: "Pared de globos del fondo", pieza: estructura(c, "pared_trenzas", { ancho_cm: ancho, alto_cm: alto, colores: c.nombres.slice(0, 3) }), colocacion: enPared(f.xCm, 0) },
    ...racimosLaterales(c, 130, 65, separacion(c)),
  ];
}

function guirnaldaYRacimos(c: ContextoFondo): Adorno[] {
  const { f } = c;
  const ancho = Math.min(700, c.anchoSalaCm - 120, f.anchoCm + 320);
  const altura = Math.max(120, Math.min(f.altoCm - 40, c.altoSalaCm - 130));
  const pieza = estructura(c, "guirnalda_organica", { ancho_cm: ancho, caida_cm: 90, grosor_cm: 60 });
  return [
    { base: "guirnalda", nombre: "Guirnalda orgánica a lo ancho", pieza, colocacion: enLaPared(c, pieza, altura) },
    ...racimosLaterales(c, 110, 70, separacion(c)),
  ];
}

function semiarcoYRacimos(c: ContextoFondo): Adorno[] {
  const { f } = c;
  const z = f.zCm + ARCO_FONDO_DELANTE_CM;
  const alto = Math.min(260, c.altoSalaCm - 60);
  const racimo = (x: number, altoCm: number, grosorCm: number, nombre: string): Adorno => ({ base: "racimo", nombre, pieza: estructura(c, "columna_organica", { alto_cm: altoCm, grosor_cm: grosorCm }), colocacion: enPiso(dentroX(c, f.xCm + x), z) });
  return [
    { base: "semiarco", nombre: "Semiarco orgánico del fondo", pieza: estructura(c, "semiarco_organico", { ancho_cm: 240, alto_cm: alto, grosor_cm: 70 }), colocacion: enPiso(dentroX(c, f.xCm - 90), z) },
    racimo(150, 130, 80, "Racimo alto del fondo"), racimo(235, 80, 70, "Racimo bajo del fondo"), racimo(-250, 80, 60, "Racimo chico del fondo"),
  ];
}

function columnasAltas(c: ContextoFondo): Adorno[] {
  const { f, estilo, nombres, notas } = c;
  const z = f.zCm + ARCO_FONDO_DELANTE_CM, alto = Math.min(260, c.altoSalaCm - 50);
  return [
    { base: "columna", nombre: "Columna alta del fondo (izquierda)", pieza: columna(estilo, nombres, alto, notas), colocacion: enPiso(dentroX(c, f.xCm - separacion(c)), z) },
    { base: "columna", nombre: "Columna alta del fondo (derecha)", pieza: columna(estilo, nombres, alto, notas), colocacion: enPiso(dentroX(c, f.xCm + separacion(c)), z) },
  ];
}

function muralYRacimos(c: ContextoFondo): Adorno[] {
  const modelo = MURALES_PREDEFINIDOS[c.composicion.semilla % MURALES_PREDEFINIDOS.length]!;
  const pieza = crearEstructura("mural", { modelo: modelo.id }, c.notas).pieza;
  return [{ base: "mural", nombre: `Mural de globos del fondo (${modelo.nombre.toLowerCase()})`, pieza, colocacion: enLaPared(c, pieza, 20) }, ...racimosLaterales(c, 150, 70, separacion(c) + 40)];
}

/** Una palmera o árbol de globos con el tronco más alto que quepa: las hojas suben sobre el tronco y no deben pasar el techo. */
function palmera(c: ContextoFondo, modelo: string): Pieza {
  for (let tronco = 280; ; tronco -= 20) {
    const pieza = crearEstructura("arbol", { modelo, alto_cm: tronco }, []).pieza;
    const { min, max } = armarPieza(pieza).caja;
    if (max.y - min.y <= c.altoSalaCm - 15 || tronco <= 100) return pieza;
  }
}

function figuras(c: ContextoFondo): Adorno[] {
  const { f, composicion } = c;
  if (composicion.figura === "palmeras") {
    const z = f.zCm + ARCO_FONDO_DELANTE_CM;
    const modelo = ARBOLES_PREDEFINIDOS[composicion.semilla % ARBOLES_PREDEFINIDOS.length]!;
    const unaPalmera = (x: number, lado: string): Adorno => ({ base: "palmera", nombre: `${modelo.nombre} (${lado})`, pieza: palmera(c, modelo.id), colocacion: enPiso(dentroX(c, x), z) });
    const ancho = Math.min(520, c.anchoSalaCm - 120, f.anchoCm + 200);
    const entre = estructura(c, "guirnalda_organica", { ancho_cm: ancho, caida_cm: 60, grosor_cm: 55 });
    return [
      unaPalmera(f.xCm - separacion(c) - 20, "izquierda"), unaPalmera(f.xCm + separacion(c) + 20, "derecha"),
      { base: "guirnalda", nombre: "Guirnalda orgánica entre las palmeras", pieza: entre, colocacion: enLaPared(c, entre, f.altoCm - 20) },
    ];
  }
  const grande = Math.min(c.altoSalaCm - 90, composicion.figura === "castillo" ? 230 : 200);
  const figura = estructura(c, "forma", { figura: composicion.figura, ancho_cm: grande, alto_cm: grande });
  return [
    { base: composicion.figura, nombre: `${NOMBRE_FIGURA[composicion.figura]} de globos del fondo`, pieza: figura, colocacion: enLaPared(c, figura, 90) },
    ...racimosLaterales(c, 120, 65, separacion(c) + 20),
  ];
}

function aroYRamos(c: ContextoFondo): Adorno[] {
  const { f } = c;
  const z = f.zCm + ARCO_FONDO_DELANTE_CM;
  const diametro = Math.min(260, c.altoSalaCm - 60);
  const ramo = crearDiseno({ tipo: "ramo_helio", colores: [...c.nombres], alto_cm: 170 }, c.notas).pieza;
  const ramos: Adorno[] = [-1, 1].flatMap((lado) => [0, 1].map((k) => ({
    base: "ramo", nombre: `Ramo de helio ${lado < 0 ? "izquierdo" : "derecho"} ${k + 1}`, pieza: structuredClone(ramo), colocacion: enPiso(dentroX(c, f.xCm + lado * (diametro / 2 + 70 + k * 65)), z + k * 25),
  })));
  return [{ base: "aro", nombre: "Aro de globos del fondo", pieza: estructura(c, "aro_organico", { ancho_cm: diametro, grosor_cm: 45 }), colocacion: enPiso(f.xCm, z) }, ...ramos];
}

/** Las piezas de la composición elegida para el fondo de fotos, con las letras de foil si pidieron texto o, si no, la figura de foil del tema (salvo en las que ya la llevan). */
export function adornosDelFondo(c: ContextoFondo): Adorno[] {
  const con = (piezas: Adorno[], delanteCm?: number): Adorno[] => [...piezas, letrasDeFoil(c, piezas) ?? acento(c, delanteCm)];
  const conLetras = (piezas: Adorno[]): Adorno[] => { const letras = letrasDeFoil(c, piezas); return letras ? [...piezas, letras] : piezas; };
  switch (c.composicion.fondo) {
    case "arco_columnas": return conLetras(arcoYColumnas(c));
    case "pared_letras": return con(paredYLetras(c));
    case "paneles_guirnalda": return con(guirnaldaYRacimos(c));
    case "semiarco_racimos": return con(semiarcoYRacimos(c));
    case "columnas_techo": return con(columnasAltas(c));
    case "mural": return con(muralYRacimos(c), 140);
    case "figuras": return conLetras(figuras(c));
    case "aro_ramos": return con(aroYRamos(c), 150);
  }
}
