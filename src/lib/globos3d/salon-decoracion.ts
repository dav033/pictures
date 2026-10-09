import type { Escena, NodoEscena } from "./escena";
import type { Composicion } from "./salon-composicion";
import { ARCO_ENTRADA_DELANTE_CM } from "./salon-evento";
import { adornosDelFondo, type Adorno } from "./salon-fondos";
import { arco, columna, coloresReconocidos, enPiso, type EstiloSalon } from "./salon-piezas";
import { conPieza, idLibre } from "./salon-registro";
import type { ZonaSalon, ZonasSalon } from "./salon-zonas";

/**
 * Lo que decora un salón armado con globos (REQ-008): el fondo de fotos (la composición que pide el tema: salon-fondos.ts) y la entrada
 * (un arco o dos columnas). Los colores son los del pedido, resueltos con el resolvedor de colores de siempre; el estilo es `organico`
 * (globos de varios tamaños) o `clasico` (cuartetos). Las piezas quedan anotadas en el registro del salón como adornos de su zona,
 * así que `mover_zona` y `quitar_zona` las llevan con ella.
 */

export type PedidoDecoracion = {
  colores: readonly string[];
  estilo: EstiloSalon;
  composicion: Composicion;
  texto?: string;
  fondo: boolean;
  entrada: boolean;
};

/**
 * Agrega la decoración de las zonas pedidas que existan. `fondo: false` (la zona ya tiene decoración del usuario, que el salón
 * conservó delante del panel) no le suma otra composición encima.
 */
export function decorarSalon(escena: Escena, zonas: ZonasSalon, p: PedidoDecoracion, notas: string[]): Escena {
  const registro = escena.salon;
  if (!registro) return escena;
  const nombres = coloresReconocidos(p.colores, notas);
  let actual = escena;
  const agregar = (zona: ZonaSalon, a: Adorno) => {
    const nodo: NodoEscena = { id: idLibre(actual, `salon-${zona === "fondo_fotos" ? "fondo" : "entrada"}-${a.base}`), nombre: a.nombre, pieza: a.pieza, colocacion: a.colocacion };
    actual = conPieza(actual, nodo, { zona, rol: "adorno" }, registro);
  };

  if (p.fondo && zonas.fondo) {
    const contexto = { f: zonas.fondo, anchoSalaCm: escena.sala.anchoCm, altoSalaCm: escena.sala.altoCm, nombres, estilo: p.estilo, composicion: p.composicion, texto: p.texto, notas };
    let adornos: Adorno[];
    try { adornos = adornosDelFondo(contexto); } catch (error) {
      // Una composición que no se puede armar (un color, una medida) no tumba el evento: se cae al arco con columnas y se dice.
      notas.push(`No pude armar la composición «${p.composicion.fondo}» del fondo (${error instanceof Error ? error.message : String(error)}): puse el arco con columnas.`);
      adornos = adornosDelFondo({ ...contexto, composicion: { ...p.composicion, fondo: "arco_columnas" } });
    }
    for (const a of adornos) agregar("fondo_fotos", a);
  }
  if (p.entrada && zonas.entrada) {
    const e = zonas.entrada, z = e.zCm + ARCO_ENTRADA_DELANTE_CM;
    if (p.composicion.entrada === "arco") {
      agregar("entrada", { base: "arco", nombre: "Arco de la entrada", pieza: arco(p.estilo, nombres, 400, Math.min(280, Math.max(150, escena.sala.altoCm - 60)), notas), colocacion: enPiso(e.xCm, z) });
    } else {
      const alto = Math.min(230, escena.sala.altoCm - 60);
      for (const [lado, x] of [["izquierda", -150], ["derecha", 150]] as const) agregar("entrada", { base: "columna", nombre: `Columna de la entrada (${lado})`, pieza: columna(p.estilo, nombres, alto, notas), colocacion: enPiso(e.xCm + x, z) });
    }
  }
  return actual;
}
