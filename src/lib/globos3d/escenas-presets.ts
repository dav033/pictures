import { decoracionPredefinida } from "./figuras";
import { SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "./escena";
import type { Pieza } from "./piezas";
import type { ParteGlobo } from "./decoraciones";
import type { DecoracionHalloween, TipoHalloween } from "./halloween";
import { fondoMarcoOndulado, mesaCilindrica, mesaConMantel, tapete } from "./escenografia";
import { opcionesArcoRectangular, opcionesAroOrganico, opcionesRacimosLibres, opcionesTroncoConBase } from "./estructuras-organicas";

/**
 * Escenas de partida del taller y las piezas que se pueden añadir a una escena. Todo es un punto de partida: cada
 * pieza se mueve, se cambia y se recolorea después.
 */
export type PresetEscena = { id: string; nombre: string; descripcion: string; escena: Escena };

const sala = (cambios: Partial<Sala> = {}): Sala => ({ ...SALA_INICIAL, tonos: { ...SALA_INICIAL.tonos }, mostrar: { ...SALA_INICIAL.mostrar }, ...cambios });

// ----------------------------------------------------------------------------------------------------------
// Piezas nuevas (lo que ofrece «Añadir»)
// ----------------------------------------------------------------------------------------------------------

export type TipoNuevo = "columna" | "arco" | "arco_organico" | "guirnalda" | "pared" | "decoracion";

export const PIEZAS_NUEVAS: ReadonlyArray<{ id: TipoNuevo; nombre: string; descripcion: string }> = [
  { id: "columna", nombre: "Columna", descripcion: "Columna clásica de cuartetos (trenza)." },
  { id: "arco", nombre: "Arco", descripcion: "Arco clásico de cuartetos de piso a piso." },
  { id: "arco_organico", nombre: "Arco orgánico", descripcion: "Globos de varios tamaños, grueso en las patas." },
  { id: "guirnalda", nombre: "Guirnalda", descripcion: "Trenza de cuartetos en festón o recta." },
  { id: "pared", nombre: "Pared", descripcion: "Mural de Link-O-Loon tipo flor." },
  { id: "decoracion", nombre: "Decoración", descripcion: "Flor, moño o estrella de globos." },
];

export function columnaClasica(alturaCm = 180, colores: string[] = ["609", "005", "570", "010"]): Pieza {
  return { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm, patron: colores.length >= 4 ? "espiral" : colores.length === 2 ? "dos_colores" : "un_color", colores };
}

export function arcoOrganico(anchoCm = 300, altoCm = 240): Pieza {
  return {
    tipo: "arco_organico",
    arco: {
      anchoCm, altoCm, radioBaseCm: 38, radioPuntaCm: 26, semilla: 7, densidad: 1,
      colores: [
        { codigo: "609", peso: 45 }, // Pastel Mate Rosado
        { codigo: "005", peso: 25, formatos: ["R-5", "R-9", "R-12", "R-18"] }, // Fashion Blanco
        { codigo: "010", peso: 15 }, // Fashion Palo de Rosa
        { codigo: "570", peso: 15, formatos: ["R-5", "R-9", "R-12"] }, // Metal Dorado
      ],
      flores: null, huecosFlores: 0,
    },
  };
}

export function guirnaldaFeston(anchoCm = 480, caidaCm = 35): Pieza {
  return { tipo: "guirnalda", guirnalda: { formatoId: "R-9", infladoCm: 18, patron: "dos_colores", colores: ["570", "005"], anchoCm, caidaCm, recorrido: null } };
}

export function piezaNueva(tipo: TipoNuevo): { pieza: Pieza; nombre: string; colocacion: Colocacion } {
  switch (tipo) {
    case "columna": return { pieza: columnaClasica(), nombre: "Columna", colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } };
    case "arco": return { pieza: { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm: 300, altoCm: 240, patron: "dos_colores", colores: ["609", "005"] }, nombre: "Arco", colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } };
    case "arco_organico": return { pieza: arcoOrganico(), nombre: "Arco orgánico", colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } };
    case "guirnalda": return { pieza: guirnaldaFeston(300, 30), nombre: "Guirnalda", colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 200 } };
    case "pared": return { pieza: { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 24, anchoCm: 300, altoCm: 225, patron: "rombos", colores: ["051", "650", "012", "009"], union: { infladoCm: 10, codigo: "609" } }, nombre: "Pared de globos", colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } };
    case "decoracion": return { pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("flor5") }, nombre: "Flor de globos", colocacion: { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 60, giroGrados: 0, volteada: true } };
  }
}

// ----------------------------------------------------------------------------------------------------------
// Escenas
// ----------------------------------------------------------------------------------------------------------

/**
 * Lo que pidió el dueño (2026-10-07): «un arco orgánico con dos columnas normales y una guirnalda», en una sala con
 * pared de fondo y techo. El arco (3 m entre patas, 2,4 m de alto) está a 1 m de la pared del fondo; las dos
 * columnas de cuartetos (1,8 m, espiralada) a cada lado de sus patas, y la guirnalda en festón (4,8 m, cuelga
 * 35 cm) colgada en la pared del fondo por encima del arco, enmarcándolo.
 */
const ARCO_CON_COLUMNAS: PresetEscena = {
  id: "arco_organico_columnas_guirnalda",
  nombre: "Arco orgánico con dos columnas y guirnalda",
  descripcion: "Arco orgánico de 3 × 2,4 m, dos columnas clásicas de 1,8 m a los lados y una guirnalda en festón en la pared del fondo.",
  escena: {
    sala: sala(),
    nodos: [
      { id: "arco", nombre: "Arco orgánico", pieza: arcoOrganico(300, 240), colocacion: { en: "piso", xCm: 0, zCm: -150, giroGrados: 0 } },
      { id: "columna-izq", nombre: "Columna izquierda", pieza: columnaClasica(), colocacion: { en: "piso", xCm: -225, zCm: -150, giroGrados: 0 } },
      { id: "columna-der", nombre: "Columna derecha", pieza: columnaClasica(), colocacion: { en: "piso", xCm: 225, zCm: -150, giroGrados: 0 } },
      { id: "guirnalda", nombre: "Guirnalda en festón", pieza: guirnaldaFeston(480, 35), colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 240 } },
    ],
  },
};

const PARED_Y_COLUMNAS: PresetEscena = {
  id: "pared_fondo_columnas",
  nombre: "Pared de globos al fondo y dos columnas",
  descripcion: "Mural flor de Link-O-Loon (3 × 2,25 m) contra la pared del fondo, flores colgadas de él y dos columnas a los lados.",
  escena: {
    sala: sala({ mostrar: { piso: true, fondo: true, laterales: true, techo: false } }),
    nodos: [
      { id: "pared", nombre: "Pared de globos", pieza: piezaNueva("pared").pieza, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 } },
      { id: "flores-pared", nombre: "Flores en la pared", pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("margarita") }, colocacion: { en: "ancla", padreId: "pared", ancla: 3, cada: 8, giroGrados: 0 } },
      { id: "columna-izq", nombre: "Columna izquierda", pieza: columnaClasica(200, ["051", "650"]), colocacion: { en: "piso", xCm: -200, zCm: -190, giroGrados: 0 } },
      { id: "columna-der", nombre: "Columna derecha", pieza: columnaClasica(200, ["051", "650"]), colocacion: { en: "piso", xCm: 200, zCm: -190, giroGrados: 0 } },
    ],
  },
};

/** Tiras de cuartetos y flores colgando del techo a distintas alturas, sobre una mesa imaginaria al centro. */
function techoConRacimos(): Escena {
  const nodos: NodoEscena[] = [];
  const tiras = [{ x: -160, z: -60, cuelga: 20, alto: 110 }, { x: 0, z: -110, cuelga: 10, alto: 140 }, { x: 160, z: -60, cuelga: 20, alto: 110 }, { x: -80, z: 40, cuelga: 40, alto: 80 }, { x: 80, z: 40, cuelga: 40, alto: 80 }];
  tiras.forEach((t, i) => nodos.push({
    id: `tira-${i + 1}`, nombre: `Tira ${i + 1}`,
    pieza: { tipo: "columna", formatoId: "R-9", infladoCm: 18, alturaCm: t.alto, patron: "dos_colores", colores: ["640", "005"] },
    colocacion: { en: "techo", xCm: t.x, zCm: t.z, cuelgaCm: t.cuelga, giroGrados: 0, volteada: false },
  }));
  const flores = [{ x: -80, z: -110, cuelga: 70 }, { x: 80, z: -110, cuelga: 85 }, { x: -170, z: 50, cuelga: 95 }, { x: 170, z: 50, cuelga: 80 }, { x: 0, z: 30, cuelga: 120 }];
  flores.forEach((f, i) => nodos.push({
    id: `flor-${i + 1}`, nombre: `Flor colgante ${i + 1}`,
    pieza: { tipo: "decoracion", decoracion: decoracionPredefinida(i % 2 ? "flor5" : "flor_grande") },
    colocacion: { en: "techo", xCm: f.x, zCm: f.z, cuelgaCm: f.cuelga, giroGrados: i * 20, volteada: true },
  }));
  return { sala: sala({ mostrar: { piso: true, fondo: true, laterales: false, techo: true } }), nodos };
}

const TECHO_RACIMOS: PresetEscena = {
  id: "techo_racimos",
  nombre: "Techo con tiras y flores colgando",
  descripcion: "Cinco tiras de cuartetos azul y blanco y cinco flores de globos colgadas del techo a distintas alturas.",
  escena: techoConRacimos(),
};

// ----------------------------------------------------------------------------------------------------------
// Halloween (las 5 fotos del dueño, 2026-10-07)
// ----------------------------------------------------------------------------------------------------------
//
// Medidas por el tamaño de los globos en cada foto (R-12 ≈ 25–28 cm, R-5 ≈ 12 cm, R-18 ≈ 34–40 cm, R-24 ≈ 48–55 cm)
// y colores medidos con PIL sobre la foto (mediana de cada globo) y llevados al código Sempertex más parecido que
// se fabrica en ese formato (`formatos` limita un color a los formatos donde existe). Cada escena trae sus
// estructuras, su escenografía y sus piezas pequeñas (ojos, arañas, calabazas, manos, ramo, ramas trenzadas, fantasmas,
// telarañas) donde están en la foto.

const R = (x: number, y: number, z = 0) => ({ x, y, z });

// Las piezas pequeñas de cada foto (`halloween.ts`) van sueltas (`libre`): su origen (el centro del ojo, del cuerpo de
// la araña o de la calabaza; el pie de la mano, del fantasma o de las ramas) en el punto medido en la foto, con la
// profundidad a la que tocan lo que tienen detrás (el racimo, el panel del marco, el tronco…), medida sobre la escena
// armada. La prueba `test-halloween-escenas.ts` comprueba que cada una quede apoyada: ni flotando ni metida.

type PropiedadesDe<T extends TipoHalloween> = Extract<DecoracionHalloween, { tipo: T }>["propiedades"];

/** Una predefinida de Halloween (copia) con algunas propiedades cambiadas para que se parezca a la de la foto. */
function halloween<T extends TipoHalloween>(id: string, tipo: T, cambios: Partial<PropiedadesDe<T>> = {}): Pieza {
  const d = structuredClone(decoracionPredefinida(id));
  if (d.tipo !== tipo) throw new Error(`La predefinida ${id} no es de tipo ${tipo}`);
  const decoracion = { ...d, propiedades: { ...d.propiedades, ...cambios } } as DecoracionHalloween;
  return { tipo: "decoracion", decoracion };
}

/** Suelta: el origen de la pieza en (x, y, z) del mundo, de frente y girada `giro` sobre la vertical. */
const suelta = (x: number, y: number, z: number, giro = 0): Colocacion => ({ en: "libre", xCm: x, yCm: y, zCm: z, giroGrados: giro });

/** Una pieza pequeña de la escena. */
const pequena = (id: string, nombre: string, pieza: Pieza, colocacion: Colocacion): NodoEscena => ({ id, nombre, pieza, colocacion });

/** Araña de patas articuladas de otro tamaño (las de las fotos 1 y 3 son más chicas que la predefinida). */
function aranaArticulada(cuerpo: ParteGlobo, cabeza: ParteGlobo, patas: { formatoId: string; grosorCm: number; largoCm: number }, ojos: boolean, giroGrados: number): Pieza {
  return halloween("arana_articulada", "arana", { cuerpo, cabeza, ojos: ojos ? { hexIris: "#1d1d1d" } : null, patas: { ...patas, codigo: "080", estilo: "articuladas" }, giroGrados });
}

/** Foto 1: marco verde ondulado con pared de lentejuelas, cuatro racimos orgánicos, dos mesas negras y tapete naranja. */
function marcoOrganicoConMesas(): Escena {
  // Racimos medidos en la foto (1 px ≈ 0,385 cm; x desde el centro del marco, y desde el piso).
  const arriba = [{ t: 0, pesos: { "R-18": 0.18, "R-12": 0.57, "R-9": 0.25 } }, { t: 1, pesos: { "R-18": 0.12, "R-12": 0.55, "R-9": 0.33 } }];
  const abajo = [{ t: 0, pesos: { "R-18": 0.22, "R-12": 0.55, "R-9": 0.23 } }, { t: 1, pesos: { "R-18": 0.15, "R-12": 0.55, "R-9": 0.3 } }];
  const racimos: Pieza = {
    tipo: "organico", flores: null,
    opciones: opcionesRacimosLibres({
      semilla: 41, suelo: true,
      racimos: [
        { id: "arriba_izquierda", nombre: "Racimo de arriba a la izquierda", puntos: [R(-110, 205), R(-102, 242), R(-73, 260), R(-50, 250)], radioInicioCm: 34, radioFinCm: 30, mezcla: arriba, tapas: { inicio: true, fin: true } },
        { id: "arriba_derecha", nombre: "Racimo que baja por la derecha", puntos: [R(38, 227), R(77, 248), R(112, 222), R(127, 196), R(119, 176)], radioInicioCm: 34, radioFinCm: 28, mezcla: arriba, tapas: { inicio: true, fin: true } },
        { id: "abajo_izquierda", nombre: "Montículo de abajo a la izquierda", puntos: [R(-142, 30, 12), R(-119, 50, 12), R(-85, 62, 12), R(-64, 38, 12)], radioInicioCm: 36, radioFinCm: 30, mezcla: abajo, tapas: { inicio: true, fin: true } },
        { id: "abajo_derecha", nombre: "Montículo de abajo a la derecha", puntos: [R(73, 30, 12), R(85, 69, 12), R(119, 85, 12), R(140, 58, 12), R(135, 30, 12)], radioInicioCm: 34, radioFinCm: 32, mezcla: abajo, tapas: { inicio: true, fin: true } },
      ],
      colores: [
        { codigo: "031", peso: 20 }, // Fashion Verde Lima
        { codigo: "061", peso: 22 }, // Fashion Naranja
        { codigo: "023", peso: 18 }, // Fashion Mostaza (el amarillo anaranjado)
        { codigo: "060", peso: 16 }, // Fashion Durazno
        { codigo: "850", peso: 24, formatos: ["R-5", "R-9"] }, // Silk Amatista (los chiquitos lila cromado)
      ],
    }),
  };
  return {
    sala: sala({ anchoCm: 520, fondoCm: 420, altoCm: 320, tonos: { piso: "#d9d2ca", paredes: "#ece9ef", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } }),
    nodos: [
      { id: "fondo-marco", nombre: "Marco verde y lentejuelas", pieza: { tipo: "escenografia", elementos: fondoMarcoOndulado({ anchoCm: 240, altoCm: 245, bandaCm: 42, bandaArribaCm: 40, capas: ["#4f9e7b", "#8fcab5"], lentejuelas: "#1d1c21" }) }, colocacion: { en: "piso", xCm: 0, zCm: -205, giroGrados: 0 } },
      { id: "tapete", nombre: "Tapete naranja", pieza: { tipo: "escenografia", elementos: tapete({ anchoCm: 330, fondoCm: 125, hex: "#e35a40", borde: { hex: "#1a1414", cm: 6 } }) }, colocacion: { en: "piso", xCm: 0, zCm: -128, giroGrados: 0 } },
      { id: "racimos", nombre: "Marco orgánico (4 racimos)", pieza: racimos, colocacion: { en: "piso", xCm: 0, zCm: -158, giroGrados: 0 } },
      { id: "mesa-baja", nombre: "Mesa cilíndrica baja", pieza: { tipo: "escenografia", elementos: mesaCilindrica({ diametroCm: 62, altoCm: 62, hex: "#141012" }) }, colocacion: { en: "piso", xCm: -28, zCm: -105, giroGrados: 0 } },
      { id: "mesa-alta", nombre: "Mesa cilíndrica alta", pieza: { tipo: "escenografia", elementos: mesaCilindrica({ diametroCm: 70, altoCm: 84, hex: "#141012" }) }, colocacion: { en: "piso", xCm: 34, zCm: -150, giroGrados: 0 } },
      // El ramo de helio de la izquierda llega tan alto como los racimos (~2,8 m), con el peso en el piso.
      pequena("ramo", "Ramo de helio", halloween("ramo_helio", "ramo_helio", { alturaCm: 280 }), { en: "piso", xCm: -165, zCm: -110, giroGrados: 0 }),
      // Ojos saltones metidos en los cuatro racimos.
      pequena("ojos-1", "Ojos saltones (arriba a la izquierda)", halloween("ojos_saltones", "racimo_ojos"), suelta(-91, 235, -128.5)),
      pequena("ojos-2", "Ojos saltones (arriba a la derecha)", halloween("ojos_saltones", "racimo_ojos"), suelta(92, 212, -128)),
      pequena("ojos-3", "Ojos saltones (abajo a la izquierda)", halloween("ojos_saltones", "racimo_ojos"), suelta(-134, 69, -115)),
      pequena("ojos-4", "Ojos saltones (abajo a la derecha)", halloween("ojos_saltones", "racimo_ojos"), suelta(113, 83, -114)),
      // Manos verdes sobre el marco (el giro va con el reloj desde los dedos arriba): una cuelga del travesaño con los dedos hacia abajo a la izquierda y la otra
      // baja por el lado izquierdo hacia la derecha. El panel de delante del marco da a z = −201,75.
      pequena("mano-1", "Mano verde (arriba)", halloween("mano_verde", "mano", { giroGrados: -135 }), suelta(-37, 208, -199.5)),
      pequena("mano-2", "Mano verde (lado izquierdo)", halloween("mano_verde", "mano", { giroGrados: 135 }), suelta(-80, 155, -199.5)),
      // Arañas negras chicas (≈ 45–50 cm de patas) sobre los lados del marco.
      pequena("arana-1", "Araña (lado izquierdo)", aranaArticulada({ formatoId: "R-9", infladoCm: 14, codigo: "080" }, { formatoId: "R-5", infladoCm: 10, codigo: "080" }, { formatoId: "T-260", grosorCm: 3, largoCm: 20 }, false, 15), suelta(-81, 126, -191)),
      pequena("arana-2", "Araña (lado derecho)", aranaArticulada({ formatoId: "R-9", infladoCm: 16, codigo: "080" }, { formatoId: "R-5", infladoCm: 11, codigo: "080" }, { formatoId: "T-260", grosorCm: 3, largoCm: 22 }, false, -10), suelta(75, 153, -194.5)),
      // Telaraña naranja de papel en el lado derecho del marco y la guirnalda de papel bajo el travesaño (fantasmitas).
      pequena("telarana", "Telaraña naranja", halloween("telarana", "telarana", { radioCm: 17, radios: 8, anillos: 4, hex: "#ea6a2a", grosorCm: 0.5 }), suelta(82, 132, -201.35)),
      pequena("fantasma-1", "Fantasmita de la guirnalda de papel 1", halloween("fantasma", "fantasma", { altoCm: 13, cola: null }), suelta(-37, 198, -197.5)),
      pequena("fantasma-2", "Fantasmita de la guirnalda de papel 2", halloween("fantasma", "fantasma", { altoCm: 13, cola: null }), suelta(0, 198, -201.3)),
      pequena("fantasma-3", "Fantasmita de la guirnalda de papel 3", halloween("fantasma", "fantasma", { altoCm: 13, cola: null }), suelta(46, 198, -139)),
    ],
  };
}

/** Foto 2: arco orgánico rectangular naranja, negro y gris con huecos para las calabazas, y la mesa con mantel. */
function arcoConCalabazas(): Escena {
  const arco: Pieza = {
    tipo: "organico", flores: null,
    opciones: opcionesArcoRectangular({
      anchoEjeCm: 195, altoEjeCm: 232, radioEsquinaCm: 40, radioBaseCm: 34, radioPataCm: 28, radioArribaCm: 30,
      // La calabaza (R-24 a 46 cm) va entre la base y la pata: hueco libre de ~68 a ~111 cm del piso, como en la foto.
      hueco: { desdeCm: 58, hastaCm: 122 },
      mezcla: { base: { "R-18": 0.15, "R-12": 0.65, "R-9": 0.2 }, pata: { "R-12": 0.7, "R-9": 0.3 }, arriba: { "R-18": 0.15, "R-12": 0.6, "R-9": 0.25 } },
      colores: [
        { codigo: "061", peso: 36 }, // Fashion Naranja
        { codigo: "080", peso: 32 }, // Fashion Negro
        { codigo: "806", peso: 32 }, // Silk Blanco Nácar (el gris claro; los impresos de salpicado, lisos)
      ],
      semilla: 13,
    }),
  };
  return {
    sala: sala({ anchoCm: 520, fondoCm: 420, altoCm: 320, tonos: { piso: "#e3b47c", paredes: "#f2f2ef", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } }),
    nodos: [
      { id: "arco", nombre: "Arco orgánico rectangular", pieza: arco, colocacion: { en: "piso", xCm: 0, zCm: -150, giroGrados: 0 } },
      {
        id: "mesa", nombre: "Mesa con mantel",
        pieza: { tipo: "escenografia", elementos: mesaConMantel({ anchoCm: 120, fondoCm: 60, altoCm: 75, mantel: "#e96d3b", camino: { anchoCm: 88, hex: "#251d19", caidaCm: 62 }, tarimas: [{ xCm: -30, anchoCm: 40, fondoCm: 28, altoCm: 8, hex: "#8a5a34" }, { xCm: 30, anchoCm: 40, fondoCm: 28, altoCm: 8, hex: "#8a5a34" }] }) },
        colocacion: { en: "piso", xCm: 0, zCm: -100, giroGrados: 0 },
      },
      // Las calabazas grandes (R-24 a 46 cm, como en la foto) en los huecos de las patas, asomadas al frente.
      pequena("calabaza-izq", "Calabaza grande (izquierda)", halloween("calabaza_grande", "calabaza", { globo: { formatoId: "R-24", infladoCm: 46, codigo: "061" } }), suelta(-97.5, 90, -136)),
      pequena("calabaza-der", "Calabaza grande (derecha)", halloween("calabaza_grande", "calabaza", { globo: { formatoId: "R-24", infladoCm: 46, codigo: "061" } }), suelta(97.5, 86, -143)),
      // El globo naranja grande de remate, asentado sobre el travesaño.
      pequena("globo-remate", "Globo de remate R-24", { tipo: "globo", formatoId: "R-24", infladoCm: 42, codigo: "061" }, suelta(10, 284, -150)),
      // La calabaza con sombrero de bruja, de pie sobre la mesa (la tapa está a 75 cm).
      pequena("bruja", "Calabaza con sombrero de bruja", halloween("calabaza_bruja", "calabaza_bruja"), suelta(0, 90, -112)),
    ],
  };
}

/** Foto 3: aro orgánico de 1,6 m en la pared: fila de R-12 verde por fuera y mezcla verde, café, naranja y beige por dentro. */
function aroDeOjos(): Escena {
  const aro: Pieza = {
    tipo: "organico", flores: null,
    opciones: opcionesAroOrganico({
      diametroCm: 152, exterior: { formatoId: "R-12", radioCm: 13 }, interior: { pesos: { "R-9": 0.75, "R-5": 0.25 }, radioCm: 15, adelanteCm: 6 },
      colores: [
        // Los R-12 de fuera solo pueden ser Eucalipto; su peso cubre esa fila y unos pocos salvia de dentro.
        { codigo: "027", peso: 28 }, // Fashion Eucalipto (el R-12 verde moteado de fuera, liso; y el salvia)
        { codigo: "030", peso: 22, formatos: ["R-9", "R-5"] }, // Fashion Verde
        { codigo: "071", peso: 12, formatos: ["R-9", "R-5"] }, // Fashion Arena
        { codigo: "074", peso: 14, formatos: ["R-9", "R-5"] }, // Fashion Café
        { codigo: "023", peso: 12, formatos: ["R-9", "R-5"] }, // Fashion Mostaza (el naranja ámbar)
      ],
      semilla: 31,
    }),
  };
  return {
    sala: sala({ anchoCm: 400, fondoCm: 320, altoCm: 280, tonos: { piso: "#d8cbbb", paredes: "#efece6", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } }),
    nodos: [
      { id: "aro", nombre: "Aro orgánico", pieza: aro, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 70 } },
      ...ojosDelAro(),
      // La araña grande sobre la cara del aro, abajo a la derecha, con la cabeza hacia el centro.
      pequena("arana-grande", "Araña grande", halloween("arana_articulada", "arana", { giroGrados: -50 }), suelta(43, 108, -107.5)),
      // La chiquita en el hueco del centro, colgada de los globos de dentro.
      pequena("arana-chica", "Araña chica", aranaArticulada({ formatoId: "R-5", infladoCm: 12, codigo: "080" }, { formatoId: "R-5", infladoCm: 8, codigo: "080" }, { formatoId: "T-160", grosorCm: 2, largoCm: 15 }, true, -30), suelta(-7, 145, -134)),
    ],
  };
}

/**
 * Los 14 ojos con venas del aro (foto 3): en la cara del aro, por el arco de dentro de arriba, en dos filas (radio 53
 * y 39 cm desde el centro del aro, a 149,6 cm del piso), alternando R-9 a 14 cm y R-5 a 12 cm y cada uno mirando a
 * un lado. La profundidad de cada uno es donde toca los globos del aro.
 */
function ojosDelAro(): NodoEscena[] {
  const filas = [
    { radio: 53, desde: 14, hasta: 168, z: [-115.5, -115.5, -112, -113, -114.5, -115, -114, -111] },
    { radio: 39, desde: 24, hasta: 158, z: [-111.5, -117, -113.5, -110.5, -113.5, -113.5] },
  ];
  const salida: NodoEscena[] = [];
  for (const fila of filas) {
    fila.z.forEach((z, i) => {
      const k = salida.length;
      const a = ((fila.desde + ((fila.hasta - fila.desde) * i) / (fila.z.length - 1)) * Math.PI) / 180;
      const globo: ParteGlobo = k % 2 ? { formatoId: "R-5", infladoCm: 12, codigo: "005" } : { formatoId: "R-9", infladoCm: 14, codigo: "005" };
      const pieza = halloween("ojo_venas", "ojo", { globo, miradaGrados: (200 + k * 67) % 360 });
      salida.push(pequena(`ojo-${k + 1}`, `Ojo con venas ${k + 1}`, pieza, suelta(Math.round(fila.radio * Math.cos(a)), Math.round(149.6 + fila.radio * Math.sin(a)), z)));
    });
  }
  return salida;
}

/** Foto 4: árbol café de 2,5 m: montículo de R-18 en el piso y tronco fino de R-12 y R-5 (las ramas y fantasmas, aparte). */
function arbolConFantasmas(): Escena {
  const arbol: Pieza = {
    tipo: "organico", flores: null,
    opciones: opcionesTroncoConBase({
      base: { radioAnilloCm: 30, radioCm: 36, mezcla: { "R-18": 0.8, "R-12": 0.2 } },
      tronco: { desdeCm: 55, altoCm: 250, radioCm: 22, radioCopaCm: 27, mezcla: { "R-12": 0.55, "R-5": 0.45 } },
      // Inflados medidos: el tronco va de R-12 a medio inflar (~21 cm) y R-5 de 11 cm.
      inflados: { "R-18": 36, "R-12": 21, "R-5": 11 },
      // El Chocolate no se fabrica en R-9: sin R-9 de relleno, solo tríos de R-5.
      relleno: [{ formatoId: "R-5", infladoCm: 11, trios: true }],
      colores: [
        { codigo: "076", peso: 60, formatos: ["R-5", "R-12"] }, // Fashion Chocolate
        { codigo: "880", peso: 18, formatos: ["R-18"] }, // Silk Gris Medianoche (el café grisáceo de los grandes; el Chocolate no viene en R-18)
        { codigo: "968", peso: 9, formatos: ["R-5"] }, // Reflex Dorado Rosa (los cobrizos)
        { codigo: "071", peso: 8, formatos: ["R-5"] }, // Fashion Arena (los crema de la base)
        { codigo: "970", peso: 5, formatos: ["R-5"] }, // Reflex Dorado
      ],
      semilla: 5,
    }),
  };
  return {
    sala: sala({ anchoCm: 450, fondoCm: 360, altoCm: 300, tonos: { piso: "#d9d0c5", paredes: "#f4f3f1", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } }),
    nodos: [
      { id: "arbol", nombre: "Árbol (base y tronco)", pieza: arbol, colocacion: { en: "piso", xCm: 0, zCm: -60, giroGrados: 0 } },
      // Cuatro ramas trenzadas que salen del tronco (eje en x ≈ 1, z ≈ −61; ~20 cm de radio): las de arriba a 1,72 m
      // se levantan como brazos y las de abajo, a 1,06 m, salen casi derechas.
      pequena("ramas", "Ramas trenzadas", halloween("arbol_trenzado", "arbol_trenzado", { alturaCm: 250, cintas: null, ojos: false, soloRamas: { radioTroncoCm: 17, alturasCm: [172, 106] } }), suelta(1, 0, -61)),
      // Los ojos bravos (cobre, con pupila y ceja) en el frente de la copa.
      pequena("ojo-izq", "Ojo bravo izquierdo", ojoBravo("izquierdo"), suelta(-6, 199, -32.5)),
      pequena("ojo-der", "Ojo bravo derecho", ojoBravo("derecho"), suelta(9, 199, -35.5)),
      // Fantasmas de papel: el grande colgado de la rama de arriba a la izquierda, uno sobre el tronco, uno bajo la rama
      // de la derecha y uno delante de la base.
      pequena("fantasma-izq", "Fantasma (rama izquierda)", halloween("fantasma", "fantasma", { altoCm: 45, cola: { vueltas: 3, largoCm: 55 } }), suelta(-75, 152, -55)),
      pequena("fantasma-centro", "Fantasma (tronco)", halloween("fantasma", "fantasma", { altoCm: 30, cola: { vueltas: 2, largoCm: 30 } }), suelta(14, 132, -44.5)),
      pequena("fantasma-der", "Fantasma (rama derecha)", halloween("fantasma", "fantasma", { altoCm: 28, cola: { vueltas: 2, largoCm: 28 } }), suelta(56, 150, -56.5)),
      pequena("fantasma-abajo", "Fantasma (base)", halloween("fantasma", "fantasma", { altoCm: 33, cola: { vueltas: 2, largoCm: 25 } }), suelta(5, 52, 4.5)),
    ],
  };
}

/** Ojo bravo de la copa (foto 4): R-5 Reflex Dorado Rosa con pupila café que mira al centro y la ceja impresa. */
function ojoBravo(lado: "izquierdo" | "derecho"): Pieza {
  return halloween("ojo_salton", "ojo", {
    globo: { formatoId: "R-5", infladoCm: 11, codigo: "968" },
    estilo: { iris: null, pupila: { hex: "#1b120d", proporcion: 0.3 }, brillo: true, venas: null },
    miradaGrados: lado === "derecho" ? 200 : -20,
    ceja: { hex: "#1b120d", lado },
  });
}

/** Foto 5: media guirnalda orgánica en curva (óxido, latte, grafito y dorado chico) colgada en la pared. */
function guirnaldaConArana(): Escena {
  // Eje medido en la foto (1 px ≈ 0,125 cm), de abajo a la izquierda hacia arriba a la derecha.
  const guirnalda: Pieza = {
    tipo: "organico", flores: null,
    opciones: opcionesRacimosLibres({
      semilla: 23, suelo: false,
      // Guirnalda suelta, no tupida: los huecos se tapan con R-9 y los R-5 dorados van como estructura (sueltos y en
      // grupitos), no como tríos de relleno por todas partes.
      relleno: [{ formatoId: "R-9", infladoCm: 17, trios: false }],
      racimos: [{
        id: "guirnalda", nombre: "Media guirnalda", puntos: [R(-2, 32), R(-10, 82), R(0, 126), R(22, 165), R(54, 186), R(85, 185), R(105, 157)],
        radioInicioCm: 34, radioFinCm: 28, tapas: { inicio: true, fin: true },
        mezcla: [{ t: 0, pesos: { "R-18": 0.25, "R-12": 0.5, "R-9": 0.1, "R-5": 0.35 } }, { t: 0.5, pesos: { "R-18": 0.12, "R-12": 0.58, "R-9": 0.15, "R-5": 0.35 } }, { t: 1, pesos: { "R-18": 0.3, "R-12": 0.45, "R-9": 0.1, "R-5": 0.35 } }],
      }],
      colores: [
        { codigo: "062", peso: 30, formatos: ["R-9", "R-12", "R-18"] }, // Fashion Naranja Cobrizo (el óxido)
        { codigo: "073", peso: 30, formatos: ["R-9", "R-12", "R-18"] }, // Fashion Latte
        { codigo: "880", peso: 25, formatos: ["R-9", "R-12", "R-18"] }, // Silk Gris Medianoche (el grafito)
        { codigo: "971", peso: 15, formatos: ["R-5"] }, // Reflex Champaña (los dorados chicos)
      ],
    }),
  };
  return {
    sala: sala({ anchoCm: 400, fondoCm: 320, altoCm: 300, tonos: { piso: "#d8cbbb", paredes: "#f6f5f3", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } }),
    nodos: [
      { id: "guirnalda", nombre: "Media guirnalda orgánica", pieza: guirnalda, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 45 } },
      // La araña de lazos abraza la parte baja de la guirnalda, con la cabeza hacia la telaraña.
      pequena("arana", "Araña de lazos", halloween("arana_lazos", "arana", { giroGrados: 100 }), suelta(-62, 112, -92)),
      // La telaraña de papel (~90 cm) en la pared, a la derecha de la parte baja y metida bajo el arco de arriba.
      pequena("telarana", "Telaraña de papel", halloween("telarana", "telarana", { radioCm: 45 }), { en: "pared", pared: "fondo", aLoLargoCm: 22, alturaCm: 90 }),
    ],
  };
}

export const ESCENAS_HALLOWEEN: readonly PresetEscena[] = [
  { id: "halloween_marco_mesas", nombre: "Halloween: marco orgánico con mesas", descripcion: "Marco verde ondulado de 2,4 m con pared de lentejuelas, cuatro racimos orgánicos, dos mesas cilíndricas negras, tapete naranja, ramo de helio, ojos saltones, manos verdes, arañas, telaraña y fantasmitas.", escena: marcoOrganicoConMesas() },
  { id: "halloween_arco_calabazas", nombre: "Halloween: arco con calabazas", descripcion: "Arco orgánico rectangular naranja, negro y gris de 2,6 × 2,6 m con dos calabazas en las patas, un R-24 de remate y la calabaza bruja sobre la mesa con mantel.", escena: arcoConCalabazas() },
  { id: "halloween_aro_ojos", nombre: "Halloween: aro de ojos y arañas", descripcion: "Aro orgánico de 1,6 m en la pared: R-12 verde por fuera y mezcla verde, café, naranja y beige por dentro, 14 ojos con venas y dos arañas.", escena: aroDeOjos() },
  { id: "halloween_arbol_fantasmas", nombre: "Halloween: árbol con fantasmas", descripcion: "Árbol café de 2,5 m: montículo de R-18 y tronco de R-12 y R-5 chocolate con cobre y crema, cuatro ramas trenzadas, ojos bravos y cuatro fantasmas.", escena: arbolConFantasmas() },
  { id: "halloween_guirnalda_arana", nombre: "Halloween: guirnalda con araña", descripcion: "Media guirnalda orgánica en curva de 1,2 × 1,9 m en óxido, latte, grafito y tríos dorados, colgada en la pared, con la araña de lazos y una telaraña.", escena: guirnaldaConArana() },
];

export const ESCENAS_PREDEFINIDAS: readonly PresetEscena[] = [ARCO_CON_COLUMNAS, PARED_Y_COLUMNAS, TECHO_RACIMOS, ...ESCENAS_HALLOWEEN];

/** Copia profunda de una escena predefinida (para editarla sin tocar el original). */
export function escenaPredefinida(id: string): Escena {
  const preset = ESCENAS_PREDEFINIDAS.find((p) => p.id === id) ?? ESCENAS_PREDEFINIDAS[0]!;
  return structuredClone(preset.escena);
}
