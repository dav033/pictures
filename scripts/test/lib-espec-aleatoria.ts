/**
 * Especificaciones y ediciones aleatorias, válidas por construcción, para las pruebas de propiedades del motor 3D.
 * Salen de la propuesta real (`especDesdePropuesta`) y se les cambian los campos que el motor lee: tamaños, densidad,
 * medidas, acabados (reflex, mate, metal) y flores. Todo pasa el esquema del contrato antes de devolverse.
 */
import { nombreClienteDeReferencia } from "../../src/lib/globos3d/motor/colores-espec";
import { especDesdePropuesta, EspecClienteV1Schema, planActualDesdeEspec, type EdicionEspecV1, type EspecClienteV1, type PiezaEspec } from "../../src/lib/globos3d/motor/v1";
import { ESTRUCTURAS_OFICIALES_IDS } from "../../src/lib/plan/estructuras-oficiales";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { plegarTexto } from "../../src/lib/rag/taxonomy/v2";
import { Azar } from "./lib-semilla";
import { semillaDeNombre } from "./lib-config-propiedades";
import { FRASES_DEL_CLIENTE } from "./lib-oraculo-color";

export const TAMANOS_ALEATORIOS = ["clasica", "organica_fina", "organica_gruesa", "solo_grandes"] as const;
export const DENSIDADES_ALEATORIAS = ["sencilla", "media", "lujosa"] as const;
/** Acabados reales del catálogo (código Sempertex y el nombre con que los dice el cliente). */
export const ACABADOS = [
  { codigo: "915", nombre: "rojo reflex" },
  { codigo: "640", nombre: "azul mate" },
  { codigo: "570", nombre: "dorado metal" },
  { codigo: "040", nombre: "azul" },
  { codigo: "005", nombre: "blanco" },
  { codigo: "970", nombre: "dorado reflex" },
  // Los dos rosas que se confunden: la tarjeta «Rosa» es el 011 y «rosa» y «rosado» son, para la tienda, el 009.
  { codigo: "011", nombre: "fashion rosa" },
  { codigo: "009", nombre: "rosado" },
] as const;

/** El nombre con que la pieza guarda un acabado: el de catálogo («Reflex Dorado») o el que dijo el cliente («dorado reflex»). */
function nombreEnLaPieza(azar: Azar, acabado: (typeof ACABADOS)[number]): string {
  return azar.booleano(0.6) ? nombreClienteDeReferencia(referenciaPorCodigo(acabado.codigo)!) : acabado.nombre;
}

/** La palabra de la paleta que dice lo mismo que la tarjeta con otra forma: «rosa» ante la tarjeta «Rosado», y al revés. */
const HERMANA_DE_TARJETA: Readonly<Record<string, string>> = { rosa: "rosado", rosado: "rosa" };

/**
 * Cómo nombra el cliente un color: la misma palabra de la paleta que una tarjeta de la pieza dice de otro modo (el paso en que
 * una orden repetida podría cambiar el otro rosa), una frase suya que puede ser algo de la pieza (así la pieza con dos dorados
 * se topa con «dorado»), una frase cualquiera (que puede no nombrar nada), o un nombre de la tarjeta, de esa pieza o de todo el
 * plan, que es lo que lee el modelo del chat (`planActualDesdeEspec`) y lo que más se repite.
 */
function comoLoDice(azar: Azar, espec: EspecClienteV1, pieza: PiezaEspec): string {
  const codigos = pieza.colores.map((color) => color.codigo);
  const delaPieza = FRASES_DEL_CLIENTE.filter((frase) => frase.puedeSer.some((codigo) => codigos.includes(codigo)));
  const hermanas = pieza.colores.flatMap((color) => HERMANA_DE_TARJETA[plegarTexto(color.nombre)] ?? []);
  const suerte = azar.real();
  if (suerte < 0.2 && hermanas.length) return azar.elegir(hermanas);
  if (suerte < 0.45 && delaPieza.length) return azar.elegir(delaPieza).dice;
  if (suerte < 0.55) return azar.elegir(FRASES_DEL_CLIENTE).dice;
  if (suerte < 0.78) return azar.elegir(pieza.colores.map((color) => color.nombre));
  return azar.elegir(planActualDesdeEspec(espec).colores);
}

/** La misma espec como queda tras una orden anterior: el motor lo sabe por `origen.tipo` y de ahí decide si una frase puede ser la repetición de la orden. */
export const comoEditada = (espec: EspecClienteV1): EspecClienteV1 => ({ ...espec, origen: { tipo: "edicion" } });

const LUGARES = ["centro", "izquierda", "derecha", "fondo", "techo", "mesa"] as const;

/** Una espec de 1 a 3 piezas oficiales, con acabados, tamaños, densidad, medidas y a veces flores. */
export function especAleatoria(azar: Azar): EspecClienteV1 {
  const piezas = Array.from({ length: azar.entero(1, 3) }, () => ({ estructura: azar.elegir(ESTRUCTURAS_OFICIALES_IDS), cantidad: azar.entero(1, 2) }));
  const { espec } = especDesdePropuesta({ frase: "Propuesta de prueba.", colores: ["azul", "blanco"], piezas });
  return EspecClienteV1Schema.parse({ ...espec, piezas: espec.piezas.map((pieza) => piezaAleatoria(azar, pieza)) });
}

function piezaAleatoria(azar: Azar, pieza: PiezaEspec): PiezaEspec {
  const elegidos = azar.subconjunto(ACABADOS, 3);
  const n = elegidos.length;
  const base = Math.floor(1000 / n) / 1000;
  const colores = elegidos.map((a, i) => ({ codigo: a.codigo, nombre: nombreEnLaPieza(azar, a), peso: i === n - 1 ? Math.round((1 - base * (n - 1)) * 1000) / 1000 : base }));
  const medidas = azar.booleano(0.5)
    ? { anchoM: azar.entero(8, 24) / 10, altoM: azar.entero(12, 28) / 10, largoM: azar.entero(15, 30) / 10 }
    : pieza.medidas;
  return {
    ...pieza,
    colores,
    medidas,
    lugar: azar.elegir(LUGARES),
    tamanos: azar.elegir(TAMANOS_ALEATORIOS),
    ...(azar.booleano(0.7) ? { densidad: azar.elegir(DENSIDADES_ALEATORIAS) } : {}),
    ...(azar.booleano(0.3) ? { flores: { cantidad: azar.entero(3, 8), petalos: azar.entero(3, 6), codigo: "040" } } : {}),
  };
}

/** La misma espec con todas las piezas en una densidad. */
export function conDensidad(espec: EspecClienteV1, densidad: PiezaEspec["densidad"]): EspecClienteV1 {
  return { ...espec, piezas: espec.piezas.map((p) => ({ ...p, densidad })) };
}

/** La misma espec con las medidas de cada pieza fijadas en `medidas` multiplicadas por `factor`. */
export function conMedidas(espec: EspecClienteV1, medidas: { anchoM: number; altoM: number; largoM: number }, factor: number): EspecClienteV1 {
  return {
    ...espec,
    piezas: espec.piezas.map((p) => ({ ...p, medidas: { anchoM: medidas.anchoM * factor, altoM: medidas.altoM * factor, largoM: medidas.largoM * factor } })),
  };
}

export const OPERACIONES_ALEATORIAS = 12;

/** `operacion` (0 a 11) elige la operación; el resto de los datos sale del azar. Pasarla en rotación cubre todas. */
export function edicionAleatoria(azar: Azar, espec: EspecClienteV1, operacion: number): EdicionEspecV1 {
  const pieza = azar.elegir(espec.piezas);
  const color = azar.elegir(ACABADOS).nombre;
  const yaEstan = ACABADOS.filter((acabado) => pieza.colores.some((otro) => otro.codigo === acabado.codigo));
  const direccion = azar.booleano() ? 1 : -1;
  switch (operacion) {
    case 0: return { op: "reemplazar_color", de: comoLoDice(azar, espec, pieza), a: yaEstan.length && azar.booleano(0.5) ? azar.elegir(yaEstan).nombre : color };
    case 1: return { op: "agregar_color", color };
    case 2: return { op: "quitar_color", color: comoLoDice(azar, espec, pieza), piezas: [pieza.id] };
    case 3: return { op: "proporcion_color", pieza: pieza.id, pesos: pieza.colores.map(() => azar.entero(1, 5)) };
    case 4: return { op: "mas_menos_color", color: comoLoDice(azar, espec, pieza), direccion };
    case 5: return { op: "tamano_pieza", pieza: pieza.id, medidas: { altoM: azar.entero(15, 30) / 10 } };
    case 6: return { op: "tamano_globos", pieza: pieza.id, direccion };
    case 7: {
      // Un lado tiene sentido en una pieza de piso o pared; la que va en el techo o sobre una mesa no tiene lado (y se dice).
      const enLado = espec.piezas.filter((p) => p.lugar !== "techo" && p.lugar !== "mesa");
      const lados = enLado.length ? enLado : espec.piezas;
      const elegida = azar.elegir(lados);
      return { op: "lado", pieza: elegida.id, lado: elegida.lugar === "izquierda" ? "derecha" : "izquierda" };
    }
    case 8: return { op: "quitar_pieza", pieza: pieza.id };
    case 9: return { op: "agregar_pieza", oficial: azar.elegir(ESTRUCTURAS_OFICIALES_IDS), lugar: azar.elegir(LUGARES), colores: [color] };
    case 10: return { op: "agregar_idea", ideaId: `idea-${azar.entero(1, 9)}` };
    default: return { op: "flores", pieza: pieza.id, flores: { cantidad: azar.entero(3, 8), petalos: azar.entero(3, 6), codigo: "040" } };
  }
}

/** La espec de una idea del catálogo de prueba: determinista por su id, para que `agregar_idea` tenga qué sumar. */
export function especDeIdeaPrueba(ideaId: string): EspecClienteV1 {
  return especAleatoria(new Azar(semillaDeNombre(ideaId)));
}
