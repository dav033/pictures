import type { Pieza } from "./piezas";
import { decoracionPredefinida } from "./figuras";
import { CELEBRA_27 } from "./mezcla";

/**
 * Decoraciones reales digitalizadas: cada una reproduce una foto del banco de estructuras de Sempertex (revistas
 * Celebra y PDF de técnicas) como una `Pieza` del taller. `fotoId` es el id de la foto en el banco
 * (p. ej. «e01-p007-000»). Las escenas las ofrecen para añadirlas con un clic.
 *
 * Cómo se digitalizaron (2026-10-07): se contaron en la foto los cuartetos por nivel, los niveles y el orden de los
 * colores; los formatos e inflados son los de la revista cuando los da y, si no, R-12 a 25 cm; los colores son la
 * referencia oficial más cercana al color medido en la foto (k-medias sobre los píxeles, cruzado con
 * `cruzarColor`) que se fabrica en ese formato, o la que nombra la revista cuando la medida no decide.
 * Ojo con la altura: en casi todas las fotos los cuartetos van más apretados (0,6–0,7 diámetros por nivel) que
 * el paso de Sempertex que usa el taller (0,8 d: 5 cuartetos de R-12 por metro). Se respetó el número de
 * cuartetos de la foto, así que esas columnas quedan algo más altas que la real; cada descripción lo dice.
 */
export type DecoracionDigitalizada = {
  id: string;
  nombre: string;
  /** Id de la foto del banco de estructuras. */
  fotoId: string;
  /** «Celebra ed. 1 (2011), p. 7». */
  fuente: string;
  /** Qué se reprodujo y qué no (en español, corto). */
  descripcion: string;
  pieza: Pieza;
};

export const CATALOGO_DECORACIONES: readonly DecoracionDigitalizada[] = [
  {
    id: "columna_bloques_pirata",
    nombre: "Columna por bloques de 4 colores",
    fotoId: "e15-p007-002",
    fuente: "Celebra ed. 15 (2016), p. 7",
    // Medido: negro #312624, blanco #ded8d4, azul #2f3f8b (Azul Rey, ΔE 8,6), rojo #d33427 (Rojo, ΔE 4,7).
    descripcion: "8 cuartetos de R-9 en bloques de 2 (de abajo arriba: Negro, Blanco, Azul Rey, Rojo), como la revista. Los 2 globos impresos con helio del remate no se modelan; la real mide ~1 m porque va más apretada (aquí ~1,2 m).",
    pieza: { tipo: "columna", formatoId: "R-9", infladoCm: 18, alturaCm: 115, patron: "salvavidas", colores: ["080", "005", "041", "015"] },
  },
  {
    id: "columna_franjas_alternando_tamanos",
    nombre: "Columna en franjas alternando tamaños",
    fotoId: "e02-p045-002",
    fuente: "Celebra ed. 2 (2012), p. 45",
    // Una sola trenza del mural de trenzas alternando tamaños es exactamente esta columna: grande y chico del
    // mismo color forman cada franja («franjas» = 2 cuartetos por color). Medido: fucsia #ae1c66, azul #52a8d8
    // (Fashion Azul, ΔE 7,9); la revista dice «Turquesa», que la tabla oficial no tiene en ese tono.
    descripcion: "7 cuartetos de R-9 a 18 cm alternando con 6 de R-6 (aquí R-5) a 12 cm, en franjas Negro, Fucsia y Azul: es la trenza 12 de la revista, con sus inflados. ~9 cuartetos por metro como en la foto (la revista dice «unos 8»). Sale girada 1/8 de vuelta respecto de la foto (de frente el grande muestra 2 globos, no 3): en la escena se gira.",
    pieza: { tipo: "pared_trenzas", opciones: { grande: { formatoId: "R-9", infladoCm: 18 }, chico: { formatoId: "R-5", infladoCm: 12 }, anchoCm: 33, altoCm: 144, patron: "franjas", colores: ["080", "012", "040"], empiezaCon: "grande" } },
  },
  {
    id: "columna_espiral_roja_azul",
    nombre: "Columna espiral roja y azul",
    fotoId: "e02-p017-000",
    fuente: "Celebra ed. 2 (2012), p. 17",
    // Medido: rojo #af2737, azul #3e489e (Azul Rey, ΔE 8,1). La revista lista R-9 Fashion Rojo y Azul Rey.
    descripcion: "9 cuartetos de R-9 con dos globos Rojo y dos Azul Rey opuestos: al girar 1/8 por nivel sale la espiral doble de la foto. El remate (tubitos 260, burbuja con helio y estrella metalizada) no se modela; la real mide ~0,9 m (aquí ~1,3 m, por el paso).",
    pieza: { tipo: "columna", formatoId: "R-9", infladoCm: 18, alturaCm: 130, patron: "dos_colores", colores: ["015", "041"] },
  },
  {
    id: "columna_espiral_azul_dorada",
    nombre: "Columna espiral azul y dorada",
    fotoId: "e22-p015-001",
    fuente: "Celebra ed. 22 (2018), p. 15",
    // En esta foto el paso sí es el de Sempertex (~0,8 d): 23 cuartetos de R-12 a 25 cm, de piso a techo.
    descripcion: "23 cuartetos de R-12 metalizados, dos Metal Azul y dos Metal Dorado opuestos (espiral doble), de piso a techo (~4,6 m, medido con el globo como escala). La revista dice Azul Rey y Dorado Cobre metalizados; aquí los Metal de la tabla oficial.",
    pieza: { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 460, patron: "dos_colores", colores: ["540", "570"] },
  },
  {
    id: "columna_espiral_pastel",
    nombre: "Columna espiral pastel de 4 colores",
    fotoId: "e20-p014-000",
    fuente: "Celebra ed. 20 (2017), p. 14",
    // Medido: rosado #ee7ea8, lila #9574ab, verde #5ac293 (Fashion Verde, ΔE 6). La revista lista Fashion
    // Blanco, Rosado y Lila y Pastel Verde; el verde de la foto es mucho más vivo que el Pastel Mate Verde.
    descripcion: "Cuartetos de R-12 con un globo de cada color (Blanco, Rosado, Lila y Verde) en el mismo orden: al girar 1/8 por nivel sale la espiral de 4 colores. La foto es un detalle: el alto (2 m) es el de las columnas de ese salón.",
    pieza: { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 200, patron: "espiral", colores: ["005", "009", "050", "030"] },
  },
  {
    id: "base_cuartetos_satin_rosado",
    nombre: "Base de 4 cuartetos satinados",
    fotoId: "e22-p018-003",
    fuente: "Celebra ed. 22 (2018), p. 18",
    descripcion: "4 cuartetos de R-12 Satín Rosado apilados (la base del caballito de carrusel). El poste, el caballito y el toldo no se modelan.",
    pieza: { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 80, patron: "un_color", colores: ["409"] },
  },
  {
    id: "arco_tramos_rosados",
    nombre: "Arco de tramos perla, fucsia y rosado",
    fotoId: "e02-p028-002",
    fuente: "Celebra ed. 2 (2012), p. 28",
    // Medido: fucsia #e42871 (Fucsia, ΔE 4,1), rosado claro #e27896, perla cálido #ceb2a6 (luz del salón).
    descripcion: "Arco redondo de cuartetos R-12 de 2,5 m × 2,4 m en tramos de 2 cuartetos Satín Perla, Fucsia y Satín Rosado, repetidos desde la pata izquierda. En la foto los tramos son simétricos desde las dos patas y la clave lleva un tramo lila perlado: aquí el ciclo sigue de corrido.",
    pieza: { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm: 250, altoCm: 240, patron: "salvavidas", colores: ["406", "012", "409"] },
  },
  {
    id: "arco_azul_linea_plata",
    nombre: "Arco azul con línea plateada",
    fotoId: "e10-p030-002",
    fuente: "Celebra ed. 10 (2014), p. 30",
    // Medido: azul #3759a6 (Azul Rey, ΔE 3,2), plata #a5a9b1 (Reflex Plata, ΔE 3,6). Escala: la puerta (~2,1 m).
    descripcion: "Arco de cuartetos R-12 de ~3 m × 2,5 m, patas rectas y arriba aplanado, con tres Azul Rey y un Reflex Plata por cuarteto: la línea plateada da la vuelta en espiral. El muñeco de nieve de al lado no se incluye.",
    pieza: { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "parabolico", anchoCm: 300, altoCm: 250, patron: "espiral", colores: ["041", "041", "041", "981"] },
  },
  {
    id: "malla_flor_diagonales",
    nombre: "Mural de malla flor en diagonales",
    fotoId: "e02-p040-001",
    fuente: "Celebra ed. 2 (2012), p. 40",
    // La revista: LOL 9 a 18 cm (Violeta, Lila, Fucsia, Rosado) y parejas de R-6 Pastel Rosado a 10 cm, 3 × 2,25 m.
    // El taller no tiene LOL 9: va LOL 12 a 18 cm (mismo tamaño inflado). El Lila no se fabrica en LOL 12; el lila
    // medido (#aa85c4) queda más cerca del Pastel Dusk Lavanda que del Pastel Mate Lila.
    descripcion: "Malla de Link-O-Loon a 18 cm con flores de 4 pétalos en franjas diagonales Rosado, Violeta, Lavanda y Fucsia, y parejas de R-5 Pastel Rosado en las uniones; ~2,9 × 2,2 m (revista: 3 × 2,25 m). La revista usa LOL 9 y Lila, que el taller no tiene: aquí LOL 12 a 18 cm y Lavanda. El borde izquierdo y el de abajo quedan con medias flores.",
    pieza: { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 18, anchoCm: 280, altoCm: 206, patron: "franjas", colores: ["009", "051", "150", "012"], union: { infladoCm: 10, codigo: "609" } },
  },
  {
    id: "pared_trenzas_rosada",
    nombre: "Pared de trenzas rosada",
    fotoId: "e27-p042-001",
    fuente: "Celebra ed. 27 (2020), p. 42",
    descripcion: "El fondo de la «Malla con flores orgánicas»: 5 trenzas de 13 cuartetos alternando R-12 a 25 cm y R-9 a 20 cm (la revista: 128 + 128 globos). Va en Fashion Rosado, el rosado medido en la foto (la revista dice Pastel Mate Rosado). Las flores aplicadas son decoraciones aparte.",
    pieza: { tipo: "pared_trenzas", opciones: CELEBRA_27.pared },
  },
  {
    id: "flor_corazones_c27",
    nombre: "Flor de corazones",
    fotoId: "e27-p042-001",
    fuente: "Celebra ed. 27 (2020), p. 42",
    descripcion: "Una de las flores aplicadas de la pared: 5 Corazón 6 Fashion Fucsia, 5 lazos de T-260 Fashion Rosado y centro R-5 Reflex Dorado Rosa, como la lista de la revista.",
    pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("flor_corazones") },
  },
  {
    id: "mono_fucsia_c27",
    nombre: "Moño de T-260 fucsia",
    fotoId: "e27-p042-001",
    fuente: "Celebra ed. 27 (2020), p. 42",
    descripcion: "El moño de abajo a la izquierda de la pared: T-260 Fucsia con dos lazos por lado, colas y un R-5 Rosado al centro. Las torceduras se dibujan como lazos lisos.",
    pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("mono_fucsia") },
  },
  {
    id: "flor_amarilla_centro_rojo",
    nombre: "Flor amarilla de 5 pétalos",
    fotoId: "e22-p041-012",
    fuente: "Celebra ed. 22 (2018), p. 41",
    // Medido: amarillo #d1c109 (Amarillo), rojo #bf3c30 (Rojo). Revista: R-12 a 23 cm.
    descripcion: "5 pétalos de R-12 Amarillo a 23 cm alrededor de un centro rojo. En la revista los pétalos son impresos «Emoji Amor» (aquí lisos), van en tríos con R-9 detrás, y el centro es la punta de un Link-O-Loon 660 Rojo: aquí un R-9 Rojo a 18 cm.",
    pieza: { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: { petalos: { formatoId: "R-12", infladoCm: 23, codigo: "020", cantidad: 5, aperturaGrados: 8, giroGrados: 90 }, centro: { formatoId: "R-9", infladoCm: 18, codigo: "015", cantidad: 1 } } } },
  },
];
