import { piezaDeGenerador } from "@/lib/globos3d/generadores-organicos";
import { MEZCLA_TRAZO, puntosDeSilueta } from "@/lib/globos3d/trazo-organico";
import type { ReactNode } from "react";
import { coloresDelFormato, FORMATOS_GLOBO, type FormatoGlobo } from "@/lib/globos3d/formatos";
import { PARED_TRENZAS_INICIAL } from "@/lib/globos3d/pared-trenzas";
import { COLUMNA_QUINCE_AZUL } from "@/lib/globos3d/organico-presets";
import { TIPOS_DECORACION, predefinidasDe, type TipoDecoracion } from "@/lib/globos3d/figuras";
import { piezaNueva } from "@/lib/globos3d/escenas-presets";
import { hexDeCodigo } from "@/lib/globos3d/decoraciones-escena";
import type { Colocacion } from "@/lib/globos3d/escena";
import type { Pieza } from "@/lib/globos3d/piezas";
import { AJUSTES_QUINCE_AZUL, opcionesDeAjustes } from "./PanelOrganico";

/** Una pieza nueva lista para entrar a la escena (y, si se pide, abrir su editor solitario). */
export type PiezaParaAnadir = {
  pieza: Pieza;
  nombre: string;
  colocacion: Colocacion;
  idBase: string;
  /** Lo que entra con ella (el pedestal de la columna orgánica de XV). */
  extras?: ReadonlyArray<{ pieza: Pieza; nombre: string; colocacion: Colocacion; idBase: string }>;
};

/** Una tarjeta de «Nuevas · ajustables»: lo que se crea y su dibujo. */
export type Nueva = { id: string; nombre: string; sub: string; descripcion: string; crear: () => PiezaParaAnadir; dibujo: () => ReactNode };

const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const EN_PARED: Colocacion = { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 140 };

const hex = (codigos: readonly string[], i: number) => hexDeCodigo(codigos[i % codigos.length] ?? "005");

/** Columna de cuartetos (dos globos por nivel, cruzados). */
function DibujoColumna({ colores }: { colores: readonly string[] }) {
  return (
    <svg viewBox="0 0 40 60" width="26" height="40" aria-hidden>
      {Array.from({ length: 5 }, (_, k) => (
        <g key={k}>
          <circle cx={k % 2 ? 20 : 14} cy={8 + k * 11} r={6} fill={hex(colores, k * 2)} />
          {k % 2 === 0 && <circle cx={26} cy={8 + k * 11} r={6} fill={hex(colores, k * 2 + 1)} />}
        </g>
      ))}
    </svg>
  );
}

/** Columna orgánica (globos de varios tamaños). */
function DibujoOrganico({ colores }: { colores: readonly string[] }) {
  const p: Array<[number, number, number]> = [[16, 8, 7], [24, 15, 5], [14, 22, 6], [25, 28, 7], [15, 36, 5], [23, 43, 6], [15, 51, 7], [26, 54, 4]];
  return <svg viewBox="0 0 40 60" width="26" height="40" aria-hidden>{p.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={hex(colores, i)} />)}</svg>;
}

/** Arco (clásico: puntos parejos; orgánico: trazo grueso de puntos). */
function DibujoArco({ colores, organico }: { colores: readonly string[]; organico: boolean }) {
  return (
    <svg viewBox="0 0 60 40" width="44" height="30" aria-hidden>
      <path d="M8 38V22a22 22 0 0 1 44 0v16" fill="none" stroke={hex(colores, 0)} strokeWidth={organico ? 10 : 7} strokeDasharray={organico ? "1 9.5" : "1 7"} strokeLinecap="round" />
      {organico && <path d="M8 38V22a22 22 0 0 1 44 0v16" fill="none" stroke={hex(colores, 1)} strokeWidth={5} strokeDasharray="1 14" strokeDashoffset={5} strokeLinecap="round" />}
    </svg>
  );
}

function DibujoGuirnalda({ colores }: { colores: readonly string[] }) {
  return <svg viewBox="0 0 60 40" width="44" height="30" aria-hidden><path d="M4 12c10 16 42 16 52 0" fill="none" stroke={hex(colores, 0)} strokeWidth={8} strokeDasharray="1 7" strokeLinecap="round" /><path d="M4 12c10 16 42 16 52 0" fill="none" stroke={hex(colores, 1)} strokeWidth={5} strokeDasharray="1 14" strokeDashoffset={4} strokeLinecap="round" /></svg>;
}

/** Guirnalda libre: un trazo de bolitas de varios tamaños que cruza arriba y baja por un lado. */
function DibujoTrazo({ colores }: { colores: readonly string[] }) {
  const puntos: Array<[number, number, number]> = [[6, 12, 3], [13, 8, 4.5], [21, 7, 3.5], [29, 8, 5], [37, 10, 3.5], [44, 15, 4.5], [48, 23, 5], [47, 31, 4], [44, 36, 3]];
  return <svg viewBox="0 0 56 42" width="44" height="33" aria-hidden>{puntos.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={hex(colores, i)} />)}</svg>;
}

/** Columna de forma libre: racimos que se corren a un lado y al otro al subir. */
function DibujoTrazoColumna({ colores }: { colores: readonly string[] }) {
  const puntos: Array<[number, number, number]> = [[20, 36, 5.5], [27, 35, 4], [14, 29, 5], [22, 26, 3], [30, 21, 5], [24, 17, 3.5], [16, 12, 4.5], [24, 7, 4], [30, 9, 3]];
  return <svg viewBox="0 0 44 42" width="36" height="34" aria-hidden>{puntos.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={hex(colores, i)} />)}</svg>;
}

/** Columna orgánica de trazo: irregular (la silueta de una normal) o de forma libre (racimos apilados), de pie. */
function columnaTrazo(silueta: "columna_recta" | "columna_racimos"): PiezaParaAnadir {
  const recta = silueta === "columna_recta";
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: { silueta, puntos: puntosDeSilueta(silueta, { anchoCm: recta ? 65 : 170, altoCm: 210, grosorCm: 65 }), mezcla: { ...MEZCLA_TRAZO }, colores: [{ codigo: "040", peso: 45 }, { codigo: "570", peso: 35 }, { codigo: "005", peso: 20 }], racimos: recta ? 0.3 : 0.8, semilla: recta ? 4 : 8 } });
  return { pieza, nombre: recta ? "Columna irregular" : "Columna de forma libre", colocacion: PISO, idBase: recta ? "columna-irregular" : "columna-libre" };
}

/** Una guirnalda orgánica de trazo libre de partida: la esquina que cruza arriba y baja por la derecha, en la pared. */
function guirnaldaLibre(): PiezaParaAnadir {
  const pieza = piezaDeGenerador({ tipo: "trazo", trazo: { silueta: "esquina_derecha", puntos: puntosDeSilueta("esquina_derecha", { anchoCm: 260, altoCm: 170, grosorCm: 60 }), mezcla: { ...MEZCLA_TRAZO }, colores: [{ codigo: "609", peso: 40 }, { codigo: "005", peso: 30 }, { codigo: "570", peso: 30 }], racimos: 0.4, semilla: 7 } });
  return { pieza, nombre: "Guirnalda libre", colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 120 }, idBase: "guirnalda-libre" };
}

function DibujoPared({ colores, trenzas }: { colores: readonly string[]; trenzas: boolean }) {
  return (
    <svg viewBox="0 0 48 40" width="40" height="34" aria-hidden>
      {Array.from({ length: 4 }, (_, f) => Array.from({ length: 5 }, (_, c) => (
        <circle key={`${f}-${c}`} cx={6 + c * 9 + (trenzas ? 0 : (f % 2) * 4.5)} cy={6 + f * 9.5} r={trenzas ? (f + c) % 2 ? 3.4 : 4.6 : 4.3} fill={hex(colores, trenzas ? c : f + c)} />
      )))}
    </svg>
  );
}

function DibujoModulo({ colores }: { colores: readonly string[] }) {
  return <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>{[[13, 13], [27, 13], [13, 27], [27, 27]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={8.5} fill={hex(colores, i)} />)}</svg>;
}

/** Un globo suelto según su forma (redondo, Link-O-Loon, tubito o corazón), a escala relativa. */
export function DibujoGlobo({ formato, codigo }: { formato: FormatoGlobo; codigo: string }) {
  const c = hexDeCodigo(codigo);
  if (formato.tipo === "tubito") return <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden><path d="M6 34C14 22 24 14 34 6" stroke={c} strokeWidth={2 + formato.diametroMaxCm / 2} strokeLinecap="round" fill="none" /></svg>;
  if (formato.tipo === "corazon") return <svg viewBox="-12 -12 24 24" width="34" height="34" aria-hidden><path d="M0 9C-6 4-10 1-10-4C-10-9-4-11 0-6C4-11 10-9 10-4C10 1 6 4 0 9Z" fill={c} transform={`scale(${formato.id === "C-6" ? 0.6 : 1})`} /></svg>;
  const r = Math.max(3, Math.min(17, formato.diametroMaxCm / 4));
  if (formato.tipo === "link") return <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden><ellipse cx={20} cy={18} rx={r * 0.9} ry={r} fill={c} /><path d={`M20 ${18 + r}v${Math.max(4, 16 - r)}`} stroke={c} strokeWidth={2} /></svg>;
  return <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden><ellipse cx={20} cy={20} rx={r * 0.92} ry={r} fill={c} /><circle cx={20 - r * 0.3} cy={20 - r * 0.35} r={r * 0.25} fill="#fff" opacity={0.35} /></svg>;
}

function colocada(base: { pieza: Pieza; nombre: string; colocacion: Colocacion }, idBase: string): PiezaParaAnadir {
  return { ...base, idBase };
}

const colores = (p: Pieza): readonly string[] => {
  switch (p.tipo) {
    case "columna": case "arco": case "pared_malla": case "modulo": return p.colores;
    case "guirnalda": return p.guirnalda.colores;
    case "arco_organico": return p.arco.colores.map((c) => c.codigo);
    case "organico": return p.opciones.colores.map((c) => c.codigo);
    case "pared_trenzas": return p.opciones.colores;
    default: return ["005"];
  }
};

/** El pedestal blanco de la columna orgánica de XV (escenografía, aparte de la columna). */
const PEDESTAL_XV: Pieza = { tipo: "escenografia", elementos: [{ forma: "cilindro", base: { x: 0, y: 0, z: 0 }, radioCm: COLUMNA_QUINCE_AZUL.escena.pedestal.radioCm, altoCm: COLUMNA_QUINCE_AZUL.escena.pedestal.altoCm, hex: "#f4f2ee", acabado: "satinado" }] };

function columnaOrganica(): PiezaParaAnadir {
  const pedestal = COLUMNA_QUINCE_AZUL.escena.pedestal.base;
  return {
    pieza: { tipo: "organico", opciones: opcionesDeAjustes(AJUSTES_QUINCE_AZUL), flores: structuredClone(COLUMNA_QUINCE_AZUL.flores) },
    nombre: "Columna orgánica", colocacion: PISO, idBase: "columna-organica",
    extras: [{ pieza: PEDESTAL_XV, nombre: "Pedestal blanco", colocacion: { en: "piso", xCm: pedestal.x, zCm: pedestal.z, giroGrados: 0 }, idBase: "pedestal" }],
  };
}

function modulo(): PiezaParaAnadir {
  return { pieza: { tipo: "modulo", modulo: "cuarteto", formatoId: "R-12", infladoCm: 25, colores: ["009", "009", "009", "009", "009", "009"] }, nombre: "Cuarteto", colocacion: PISO, idBase: "modulo" };
}

const paredTrenzas = (): PiezaParaAnadir => ({ pieza: { tipo: "pared_trenzas", opciones: structuredClone(PARED_TRENZAS_INICIAL) }, nombre: "Pared de trenzas", colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 0 }, idBase: "pared-trenzas" });

/** «Nuevas · ajustables» de Estructuras: cada una abre su editor solitario (el generador de su tipo). */
export const NUEVAS_ESTRUCTURAS: readonly Nueva[] = [
  { id: "columna", nombre: "Columna", sub: "clásica", descripcion: "Trenza de cuartetos: patrón, alto, globo y colores.", crear: () => colocada(piezaNueva("columna"), "columna"), dibujo: () => <DibujoColumna colores={colores(piezaNueva("columna").pieza)} /> },
  { id: "columna_organica", nombre: "Columna", sub: "orgánica", descripcion: "Globos de varios tamaños con flores y pedestal (la azul de XV).", crear: columnaOrganica, dibujo: () => <DibujoOrganico colores={AJUSTES_QUINCE_AZUL.colores.map((c) => c.codigo)} /> },
  { id: "columna_irregular", nombre: "Columna", sub: "irregular", descripcion: "La silueta de una columna normal pero orgánica: globos de varios tamaños, sin cuartetos.", crear: () => columnaTrazo("columna_recta"), dibujo: () => <DibujoOrganico colores={["040", "570", "005"]} /> },
  { id: "columna_libre", nombre: "Columna", sub: "forma libre", descripcion: "Racimos apilados que se corren de lado (o en S, o inclinada): la columna de las fotos de graduación.", crear: () => columnaTrazo("columna_racimos"), dibujo: () => <DibujoTrazoColumna colores={["040", "570", "005"]} /> },
  { id: "arco", nombre: "Arco", sub: "clásico", descripcion: "Trenza de cuartetos de piso a piso: forma, ancho, alto y colores.", crear: () => colocada(piezaNueva("arco"), "arco"), dibujo: () => <DibujoArco colores={colores(piezaNueva("arco").pieza)} organico={false} /> },
  { id: "arco_organico", nombre: "Arco", sub: "orgánico", descripcion: "Globos de varios tamaños, grueso en las patas.", crear: () => colocada(piezaNueva("arco_organico"), "arco-organico"), dibujo: () => <DibujoArco colores={colores(piezaNueva("arco_organico").pieza)} organico /> },
  { id: "guirnalda", nombre: "Guirnalda", sub: "en festón", descripcion: "Trenza de cuartetos en festón o recta.", crear: () => colocada(piezaNueva("guirnalda"), "guirnalda"), dibujo: () => <DibujoGuirnalda colores={colores(piezaNueva("guirnalda").pieza)} /> },
  { id: "guirnalda_libre", nombre: "Guirnalda", sub: "orgánica libre", descripcion: "Sigue cualquier silueta (festón, arco, esquina, medio arco, asimétrica) con grosor, racimos, tamaños, colores y hojas.", crear: guirnaldaLibre, dibujo: () => <DibujoTrazo colores={["609", "005", "570"]} /> },
  { id: "pared", nombre: "Pared", sub: "malla de flores", descripcion: "Malla Link-O-Loon tipo flor.", crear: () => colocada(piezaNueva("pared"), "pared"), dibujo: () => <DibujoPared colores={colores(piezaNueva("pared").pieza)} trenzas={false} /> },
  { id: "pared_trenzas", nombre: "Pared", sub: "de trenzas", descripcion: "Trenzas de cuartetos alternando tamaños (la de Celebra ed. 27).", crear: paredTrenzas, dibujo: () => <DibujoPared colores={PARED_TRENZAS_INICIAL.colores} trenzas /> },
  { id: "modulo", nombre: "Módulo", sub: "pareja a sexteto", descripcion: "Pareja, trío, cuarteto, quinteto o sexteto, con el color de cada globo.", crear: modulo, dibujo: () => <DibujoModulo colores={["009", "005", "009", "005"]} /> },
];

/** «Nuevas · ajustables» de Decoraciones: una de cada tipo (flor, flor de tubito, moño, estrella, flor de corazones). */
export const NUEVAS_DECORACIONES: ReadonlyArray<{ tipo: TipoDecoracion; nombre: string; descripcion: string; crear: () => PiezaParaAnadir }> = TIPOS_DECORACION.map((t) => ({
  tipo: t.id, nombre: t.nombre, descripcion: t.descripcion,
  crear: () => {
    const p = predefinidasDe(t.id)[0]!;
    return { pieza: { tipo: "decoracion", decoracion: structuredClone(p.decoracion) }, nombre: p.nombre, colocacion: EN_PARED, idBase: t.id.replace(/_/g, "-") };
  },
}));

/** Un globo suelto de ese formato (en un color que se fabrica en él), de pie en el piso. */
export function globoSuelto(formato: FormatoGlobo): PiezaParaAnadir {
  const disponibles = coloresDelFormato(formato.id);
  const codigo = disponibles.find((c) => c.codigo === "009")?.codigo ?? disponibles[0]?.codigo ?? "005";
  return { pieza: { tipo: "globo", formatoId: formato.id, infladoCm: formato.infladoDecoracionCm, codigo }, nombre: `Globo ${formato.id}`, colocacion: PISO, idBase: `globo-${formato.id.toLowerCase()}` };
}

export const FORMATOS_SUELTOS = FORMATOS_GLOBO;
