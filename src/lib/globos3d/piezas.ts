import { formatoPorId } from "./formatos";
import type { Vec3 } from "./modulos";
import { armarColumna, type PatronColumna } from "./columnas";
import { armarArco, type FormaArco } from "./arcos";
import { armarPared, type PatronMalla } from "./paredes";
import { armarParedTrenzas, type OpcionesParedTrenzas } from "./pared-trenzas";
import { armarOrganico, type OpcionesOrganico } from "./organico";
import { repartirFlores, type OpcionesFlores } from "./flores-artificiales";
import { armarDecoracion, type Decoracion, type MaterialDecoracion } from "./figuras";
import { materialesPorFormato, type GloboDecoracion, type TuboDecoracion } from "./decoraciones";
import { sumarMateriales } from "./mezcla";
import { armarTrenza } from "./trenza";
import { opcionesArcoOrganico, recorridoGuirnalda, type OpcionesArcoOrganico, type OpcionesGuirnalda } from "./formas-escena";

/**
 * Una **pieza**: cualquier cosa que sabe armar el taller, descrita solo con datos (JSON) para poder guardarla,
 * repetirla y componer escenas con varias. `armarPieza` la convierte en lo que dibuja el visor y en su lista de
 * materiales, en su propio espacio (cm, y hacia arriba, apoyada en y = 0 cuando es una estructura de piso).
 * Las escenas (varias piezas colocadas) y el catálogo de decoraciones digitalizadas se construyen encima.
 */
export type Pieza =
  | { tipo: "columna"; formatoId: string; infladoCm: number; alturaCm: number; patron: PatronColumna; colores: string[] }
  | { tipo: "arco"; formatoId: string; infladoCm: number; forma: FormaArco; anchoCm: number; altoCm: number; patron: PatronColumna; colores: string[] }
  | { tipo: "pared_malla"; formatoId: string; infladoCm: number; anchoCm: number; altoCm: number; patron: PatronMalla; colores: string[]; union: { infladoCm: number; codigo: string } }
  | { tipo: "pared_trenzas"; opciones: OpcionesParedTrenzas }
  | { tipo: "organico"; opciones: OpcionesOrganico; flores: OpcionesFlores | null }
  | { tipo: "decoracion"; decoracion: Decoracion }
  /** Arco orgánico por medidas: dos semiarcos que se juntan en la clave (ver `formas-escena.ts`). */
  | { tipo: "arco_organico"; arco: OpcionesArcoOrganico }
  /** Guirnalda clásica: trenza de cuartetos en festón, recta o sobre una curva libre. */
  | { tipo: "guirnalda"; guirnalda: OpcionesGuirnalda };

export type TipoPieza = Pieza["tipo"];

/** Un globo listo para el visor (con confeti si es un cristal relleno). */
export type GloboDePieza = GloboDecoracion & { confeti?: boolean };
/** Flor artificial (follaje): no cotiza como globo. */
export type FlorDePieza = { tipo: "hortensia" | "rosa" | "gypsophila"; hex: string; diametroCm: number; posicion: Vec3; normal: Vec3 };
export type AnclaDePieza = { posicion: Vec3; normal: Vec3 };

export type PiezaArmada = {
  globos: GloboDePieza[];
  tubos: TuboDecoracion[];
  flores: FlorDePieza[];
  /** Donde se pueden colgar decoraciones hijas. */
  anclas: AnclaDePieza[];
  materiales: MaterialDecoracion[];
  /** Caja que ocupa (cm), contando el cuerpo de cada globo. */
  caja: { min: Vec3; max: Vec3 };
};

function cajaDe(globos: readonly GloboDecoracion[], tubos: readonly TuboDecoracion[]): PiezaArmada["caja"] {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const meter = (p: Vec3, r: number) => {
    min.x = Math.min(min.x, p.x - r); min.y = Math.min(min.y, p.y - r); min.z = Math.min(min.z, p.z - r);
    max.x = Math.max(max.x, p.x + r); max.y = Math.max(max.y, p.y + r); max.z = Math.max(max.z, p.z + r);
  };
  for (const g of globos) {
    const r = g.infladoCm / 2;
    const largo = r + g.cuelloExtraCm;
    meter({ x: g.nudo.x + g.direccion.x * largo, y: g.nudo.y + g.direccion.y * largo, z: g.nudo.z + g.direccion.z * largo }, r);
  }
  for (const t of tubos) for (const p of t.puntos) meter(p, t.grosorCm / 2);
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  return { min, max };
}

function conCaja(p: Omit<PiezaArmada, "caja">): PiezaArmada {
  return { ...p, caja: cajaDe(p.globos, p.tubos) };
}

export function armarPieza(pieza: Pieza): PiezaArmada {
  switch (pieza.tipo) {
    case "columna":
    case "arco": {
      const formato = formatoPorId(pieza.formatoId);
      if (!formato) throw new Error(`Formato desconocido: ${pieza.formatoId}`);
      const armada = pieza.tipo === "columna"
        ? armarColumna({ formato, infladoCm: pieza.infladoCm, alturaCm: pieza.alturaCm, patron: pieza.patron, colores: pieza.colores })
        : armarArco({ formato, infladoCm: pieza.infladoCm, forma: pieza.forma, anchoCm: pieza.anchoCm, altoCm: pieza.altoCm, patron: pieza.patron, colores: pieza.colores });
      const globos: GloboDePieza[] = armada.globos.map((g) => ({ formatoId: formato.id, infladoCm: pieza.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armada.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: materialesPorFormato(globos) });
    }
    case "pared_malla": {
      const formato = formatoPorId(pieza.formatoId);
      const r5 = formatoPorId("R-5");
      if (!formato || !r5) throw new Error(`Formato desconocido: ${pieza.formatoId}`);
      const armada = armarPared({ formato, infladoCm: pieza.infladoCm, anchoCm: pieza.anchoCm, altoCm: pieza.altoCm, patron: pieza.patron, colores: pieza.colores, union: { formato: r5, infladoCm: pieza.union.infladoCm, codigo: pieza.union.codigo } });
      const globos: GloboDePieza[] = armada.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armada.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: armada.materiales });
    }
    case "pared_trenzas": {
      const armada = armarParedTrenzas(pieza.opciones);
      const globos: GloboDePieza[] = armada.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armada.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: armada.materiales });
    }
    case "organico": {
      const resultado = armarOrganico(pieza.opciones);
      const flores = pieza.flores ? repartirFlores(resultado.anclas, pieza.flores) : null;
      const globos: GloboDePieza[] = resultado.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.confeti ? { confeti: true } : {}) }));
      return conCaja({
        globos, tubos: [],
        flores: flores ? flores.racimos.flatMap((r) => r.flores.map((f) => ({ tipo: f.tipo, hex: f.hex, diametroCm: f.diametroCm, posicion: f.posicion, normal: f.normal }))) : [],
        anclas: resultado.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })),
        materiales: sumarMateriales(resultado.materiales.map((m) => ({ formatoId: m.formatoId, codigo: m.codigo, cantidad: m.cantidad }))),
      });
    }
    case "arco_organico":
      return armarPieza({ tipo: "organico", opciones: opcionesArcoOrganico(pieza.arco), flores: pieza.arco.flores });
    case "guirnalda": {
      const g = pieza.guirnalda;
      const formato = formatoPorId(g.formatoId);
      if (!formato) throw new Error(`Formato desconocido: ${g.formatoId}`);
      const trenza = armarTrenza({ formato, infladoCm: g.infladoCm, patron: g.patron, colores: g.colores, recorrido: recorridoGuirnalda(g), reparto: "extremos" });
      const globos: GloboDePieza[] = trenza.globos.map((x) => ({ formatoId: formato.id, infladoCm: g.infladoCm, codigo: x.codigo, nudo: x.nudo, direccion: x.direccion, cuelloExtraCm: x.cuelloExtraCm }));
      return conCaja({ globos, tubos: [], flores: [], anclas: trenza.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: materialesPorFormato(globos) });
    }
    case "decoracion": {
      const armada = armarDecoracion(pieza.decoracion);
      return conCaja({ globos: armada.globos, tubos: armada.tubos, flores: [], anclas: [], materiales: armada.materiales });
    }
  }
}
