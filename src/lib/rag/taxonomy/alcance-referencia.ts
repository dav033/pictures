import type { ReferenceElement } from "@/lib/ia/reference-blueprint";
import { CATEGORIAS_CATALOGO_V2, type CategoriaCatalogoV2 } from "./v2";

export type AlcanceReferencia = "cubierto" | "parcial" | "emulable" | "fuera_de_catalogo";

export type AlcanceCategoria = {
  alcance: AlcanceReferencia;
  categorias: readonly CategoriaCatalogoV2[];
  nota: string;
  emulacion?: string;
};

const {
  globoLatex,
  globoMetalizado,
  globoNumeroLetra,
  banderolaCartel,
  vela,
  kit,
  guirnaldaArco,
  complemento,
  desechable,
} = {
  globoLatex: CATEGORIAS_CATALOGO_V2[0],
  globoMetalizado: CATEGORIAS_CATALOGO_V2[1],
  globoNumeroLetra: CATEGORIAS_CATALOGO_V2[2],
  banderolaCartel: CATEGORIAS_CATALOGO_V2[3],
  vela: CATEGORIAS_CATALOGO_V2[4],
  kit: CATEGORIAS_CATALOGO_V2[5],
  guirnaldaArco: CATEGORIAS_CATALOGO_V2[6],
  complemento: CATEGORIAS_CATALOGO_V2[7],
  desechable: CATEGORIAS_CATALOGO_V2[9],
} as const;

/**
 * Alcance comercial fijo para cada categoría detectada en una referencia.
 * No consulta inventario: debe poder usarse al construir el prompt y en el
 * cliente con exactamente el mismo resultado.
 */
export const ALCANCE_POR_CATEGORIA_REFERENCIA: Record<ReferenceElement["category"], AlcanceCategoria> = {
  balloon_structure: {
    alcance: "cubierto",
    categorias: [globoLatex, globoMetalizado, globoNumeroLetra, guirnaldaArco, kit],
    nota: "Las estructuras de globos sí se pueden construir con categorías del catálogo.",
  },
  curtain: {
    alcance: "emulable",
    categorias: [globoLatex, globoMetalizado],
    nota: "La tela observada no se vende como tal en el catálogo, pero puede reinterpretarse con globos.",
    emulacion: "Plano vertical de globos (pared o fondo orgánico) en la paleta observada.",
  },
  drape: {
    alcance: "emulable",
    categorias: [globoLatex, globoMetalizado],
    nota: "El drapeado observado no se vende como tal en el catálogo, pero puede reinterpretarse con globos.",
    emulacion: "Plano vertical de globos (pared o fondo orgánico) en la paleta observada.",
  },
  backdrop: {
    alcance: "emulable",
    categorias: [globoLatex, globoMetalizado],
    nota: "El fondo observado puede reinterpretarse con un plano vertical de globos; no se promete una tela idéntica.",
    emulacion: "Plano vertical de globos (pared o fondo orgánico) en la paleta observada.",
  },
  panel: {
    alcance: "emulable",
    categorias: [globoLatex, globoMetalizado],
    nota: "El panel observado puede reinterpretarse con un plano vertical de globos; no se promete un panel rígido.",
    emulacion: "Plano vertical de globos (pared o fondo orgánico) en la paleta observada.",
  },
  signage: {
    alcance: "emulable",
    categorias: [globoNumeroLetra, banderolaCartel],
    nota: "El mensaje puede resolverse con globos de letras o una banderola del catálogo; no se fabrica rotulación personalizada.",
    emulacion: "Globos de letras o una banderola del catálogo, sin prometer lettering personalizado.",
  },
  tableware: {
    alcance: "parcial",
    categorias: [vela, desechable, complemento],
    nota: "Hay velas, desechables y complementos; vajilla y cristalería no forman parte del catálogo.",
  },
  furniture: {
    alcance: "fuera_de_catalogo",
    categorias: [],
    nota: "El catálogo no vende mobiliario; no se emula con globos.",
  },
  floral: {
    alcance: "fuera_de_catalogo",
    categorias: [],
    nota: "El catálogo no vende flores frescas ni secas; no se emulan.",
  },
  lighting: {
    alcance: "fuera_de_catalogo",
    categorias: [],
    nota: "El catálogo no vende iluminación; no se emula.",
  },
  plinth: {
    alcance: "fuera_de_catalogo",
    categorias: [],
    nota: "El catálogo no vende soportes estructurales; no se emulan.",
  },
  other: {
    alcance: "fuera_de_catalogo",
    categorias: [],
    nota: "No hay señal suficiente para clasificar este elemento como una categoría vendida.",
  },
};

export type CategoriaReferencia = ReferenceElement["category"];

