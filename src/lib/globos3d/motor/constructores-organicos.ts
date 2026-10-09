import { crearEstructura, ajustarOrganico, coloresOrganicosPedidos, RANGOS_ESTRUCTURA } from "../herramientas-escena-estructuras";
import { INFLADOS_ORGANICOS } from "../estructuras-organicas";
import { opcionesArcoOrganico } from "../formas-escena";
import { formaSemiarco, RELLENO_TUPIDO, type OpcionesOrganico } from "../organico";
import type { Pieza } from "../piezas";
import type { PiezaEspec, TamanosEspec } from "./espec-cliente-v1";
import { enCm, GROSOR_ORGANICO_POR_DEFECTO_M, type MedidasEspec } from "./medidas-espec";

/**
 * Las piezas orgánicas (mezcla de tamaños, sin cuartetos): semiarco, arco, arco asimétrico, columna, guirnalda y aro.
 * Cada constructor recibe la pieza del cliente ya con sus medidas completas y devuelve una `Pieza` del taller más
 * dónde se apoya. Los rangos son los de `RANGOS_ESTRUCTURA`: lo que no cabe se acota y se avisa.
 */
export type Apoyo = "piso" | "pared" | "techo";
export type Construida = { pieza: Pieza; apoyo: Apoyo };
export type EntradaOrganica = { espec: PiezaEspec; medidas: MedidasEspec; avisos: string[]; notas: string[] };
type Organico = Extract<Pieza, { tipo: "organico" }>;

const FORMATOS_DE_TAMANOS: Readonly<Record<TamanosEspec, readonly string[] | undefined>> = {
  clasica: ["R-12"],
  organica_fina: undefined,
  organica_gruesa: ["R-9", "R-12", "R-18", "R-24"],
  solo_grandes: ["R-18", "R-24"],
};

export const RANGO_ARCO = { ancho: [150, 500], alto: [150, 320] } as const;

const semillaDe = (...n: number[]) => (n.reduce((s, x) => (s * 31 + Math.round(x)) % 9973, 7) || 7);

const tamanosDe = (espec: PiezaEspec): string[] | undefined => {
  const formatos = FORMATOS_DE_TAMANOS[espec.tamanos];
  return formatos ? [...formatos] : undefined;
};

const codigosYPesos = (espec: PiezaEspec) => ({
  colores: espec.colores.map((c) => c.codigo),
  pesos: espec.colores.map((c) => Math.max(1, Math.round(c.peso * 100))),
});

const grosorDe = (m: MedidasEspec, defectoM: number, rango: readonly [number, number], avisos: string[]) => enCm(m.grosorM, defectoM, rango, "El grosor", avisos);

/** El espejo de una pieza orgánica sobre el plano x = 0 (el semiarco de la derecha, la columna que se inclina al otro lado). */
export function espejarOrganico(pieza: Organico): Organico {
  const x = (p: { x: number; y: number; z: number }) => ({ ...p, x: -p.x });
  const { opciones } = pieza;
  return {
    ...pieza,
    opciones: {
      ...opciones,
      tramos: opciones.tramos.map((t) => ({ ...t, recorrido: t.recorrido.map(x) })),
      ...(opciones.obstaculos ? { obstaculos: opciones.obstaculos.map((o) => ({ ...o, base: x(o.base) })) } : {}),
    },
  };
}

export function construirSemiarco({ espec, medidas, avisos, notas }: EntradaOrganica): Construida {
  const R = RANGOS_ESTRUCTURA.semiarco_organico;
  const { colores, pesos } = codigosYPesos(espec);
  const { pieza } = crearEstructura("semiarco_organico", {
    ancho_cm: enCm(medidas.anchoM, undefined, R.ancho_cm, "El ancho", avisos),
    alto_cm: enCm(medidas.altoM, undefined, R.alto_cm, "El alto", avisos),
    grosor_cm: grosorDe(medidas, espec.oficial === "semiarco_asimetrico" ? GROSOR_ORGANICO_POR_DEFECTO_M.semiarcoAsimetrico : GROSOR_ORGANICO_POR_DEFECTO_M.semiarco, R.grosor_cm, avisos),
    colores, pesos, tamanos: tamanosDe(espec),
  }, notas);
  const armada = pieza.tipo === "organico" && espec.lugar === "derecha" ? espejarOrganico(pieza) : pieza;
  return { pieza: armada, apoyo: "piso" };
}

export function construirColumnaOrganica({ espec, medidas, avisos, notas }: EntradaOrganica): Construida {
  const R = RANGOS_ESTRUCTURA.columna_organica;
  const { colores, pesos } = codigosYPesos(espec);
  const inclinada = espec.oficial === "columna_asimetrica";
  const ancho = medidas.grosorM ?? medidas.anchoM;
  const { pieza } = crearEstructura("columna_organica", {
    alto_cm: enCm(medidas.altoM, undefined, R.alto_cm, "El alto", avisos),
    grosor_cm: enCm(ancho, GROSOR_ORGANICO_POR_DEFECTO_M.columna, R.grosor_cm, "El grosor", avisos),
    ...(inclinada ? { inclinacion_cm: espec.lugar === "derecha" ? -40 : 40 } : {}),
    colores, pesos, tamanos: tamanosDe(espec),
  }, notas);
  return { pieza, apoyo: "piso" };
}

export function construirGuirnaldaOrganica({ espec, medidas, avisos, notas }: EntradaOrganica): Construida {
  const R = RANGOS_ESTRUCTURA.guirnalda_organica;
  const { colores, pesos } = codigosYPesos(espec);
  const { pieza } = crearEstructura("guirnalda_organica", {
    ancho_cm: enCm(medidas.largoM ?? medidas.anchoM, undefined, R.ancho_cm, "El largo", avisos),
    grosor_cm: grosorDe(medidas, GROSOR_ORGANICO_POR_DEFECTO_M.guirnalda, R.grosor_cm, avisos),
    colores, pesos, tamanos: tamanosDe(espec),
  }, notas);
  return { pieza, apoyo: "pared" };
}

export function construirAro({ espec, medidas, avisos, notas }: EntradaOrganica): Construida {
  const R = RANGOS_ESTRUCTURA.aro_organico;
  const { colores, pesos } = codigosYPesos(espec);
  const { pieza } = crearEstructura("aro_organico", {
    ancho_cm: enCm(medidas.anchoM ?? medidas.altoM, undefined, R.diametro_cm, "El diámetro", avisos),
    grosor_cm: grosorDe(medidas, GROSOR_ORGANICO_POR_DEFECTO_M.aro, R.grosor_cm, avisos),
    colores, pesos, tamanos: tamanosDe(espec),
  }, notas);
  return { pieza, apoyo: "piso" };
}

export function construirArcoOrganico({ espec, medidas, avisos, notas }: EntradaOrganica): Construida {
  const { colores, pesos } = codigosYPesos(espec);
  const ancho = enCm(medidas.anchoM, undefined, RANGO_ARCO.ancho, "El ancho", avisos);
  const alto = enCm(medidas.altoM, undefined, RANGO_ARCO.alto, "El alto", avisos);
  const grosor = grosorDe(medidas, GROSOR_ORGANICO_POR_DEFECTO_M.arco, RANGOS_ESTRUCTURA.organico.grosor_cm, avisos);
  const base: Organico = {
    tipo: "organico", flores: null,
    opciones: opcionesArcoOrganico({
      anchoCm: ancho, altoCm: alto, radioBaseCm: grosor / 2, radioPuntaCm: Math.round(grosor * 0.34), semilla: semillaDe(ancho, alto, grosor), densidad: 1,
      colores: coloresOrganicosPedidos(colores, pesos, notas), flores: null, huecosFlores: 0,
    }),
  };
  const tamanos = tamanosDe(espec);
  return { pieza: tamanos ? ajustarOrganico(base, { tamanos }, notas) : base, apoyo: "piso" };
}

/**
 * Arco con un lado más cargado: dos semiarcos que se juntan en la clave, el pesado más grueso y que cubre más del
 * claro (la clave queda corrida hacia el lado ligero), como lo describe la estructura oficial.
 */
export function construirArcoAsimetrico({ espec, medidas, avisos, notas }: EntradaOrganica): Construida {
  const { colores, pesos } = codigosYPesos(espec);
  const ancho = enCm(medidas.anchoM, undefined, RANGO_ARCO.ancho, "El ancho", avisos);
  const alto = enCm(medidas.altoM, undefined, RANGO_ARCO.alto, "El alto", avisos);
  const grosor = grosorDe(medidas, GROSOR_ORGANICO_POR_DEFECTO_M.arco, RANGOS_ESTRUCTURA.organico.grosor_cm, avisos);
  const mitad = Math.max(30, ancho / 2);
  const claveX = mitad * 0.2;
  const pesadaALaIzquierda = espec.lugar !== "derecha";
  const lado = (pesado: boolean, signo: 1 | -1) => ({
    ...formaSemiarco({
      id: signo === 1 ? "pata_izquierda" : "pata_derecha", nombre: signo === 1 ? "Pata izquierda" : "Pata derecha",
      anchoCm: signo * (pesado ? mitad + claveX : mitad - claveX), altoCm: alto,
      radioBaseCm: grosor * (pesado ? 0.56 : 0.36), radioPuntaCm: Math.round(grosor * (pesado ? 0.38 : 0.27)),
      origen: { x: -signo * mitad, y: 0, z: 0 },
    }),
    tapas: {},
  });
  const opciones: OpcionesOrganico = {
    semilla: semillaDe(ancho, alto, grosor), tramos: [lado(pesadaALaIzquierda, 1), lado(!pesadaALaIzquierda, -1)], inflados: INFLADOS_ORGANICOS, variacionInflado: 0.07,
    relleno: RELLENO_TUPIDO, colores: coloresOrganicosPedidos(colores, pesos, notas), suelo: true, huecosFlores: 0, vista: { x: 0, y: 0, z: 1 }, densidad: 1,
  };
  const base: Organico = { tipo: "organico", opciones, flores: null };
  const tamanos = tamanosDe(espec);
  return { pieza: tamanos ? ajustarOrganico(base, { tamanos }, notas) : base, apoyo: "piso" };
}
