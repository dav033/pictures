import { decoracionPredefinida } from "./figuras";
import { SALA_INICIAL, type Colocacion, type Escena, type NodoEscena, type Sala } from "./escena";
import type { Pieza } from "./piezas";

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

export const ESCENAS_PREDEFINIDAS: readonly PresetEscena[] = [ARCO_CON_COLUMNAS, PARED_Y_COLUMNAS, TECHO_RACIMOS];

/** Copia profunda de una escena predefinida (para editarla sin tocar el original). */
export function escenaPredefinida(id: string): Escena {
  const preset = ESCENAS_PREDEFINIDAS.find((p) => p.id === id) ?? ESCENAS_PREDEFINIDAS[0]!;
  return structuredClone(preset.escena);
}
