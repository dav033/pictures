import type { Escena, NodoEscena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import { MAX_NODOS, SALA_MAXIMA_CM } from "./limites-escena";
import { ALTO_SALON_CM, falloDeCapacidad, metros, rangoSala, type ResultadoSalon } from "./salon-armar";
import {
  distribuirSalon, MAX_INVITADOS_SALON, aforoDeMesas, falloDeMesas, falloDeSillas, mesasNecesarias, medidasDeMesa, MESAS_SALON, rectDeElemento, type Celda, type DistribucionSalon, type ElementoSalon, type ParamsSalon, type TipoMesaSalon,
} from "./salon-evento";
import { desplazarNodo, nodoDeElemento, paletaDeMesas, ponerElemento, quitarConLoSuyo } from "./salon-nodos";
import { anclaDeZona, conAnotacion, estaMovida, mesasVivas, miembrosDeZona, registroVivo, type PiezaViva } from "./salon-registro";
import { resumenDeSalon } from "./salon-resumen";
import { conSalaNueva } from "./salon-techos";
import { piezasDeUsuarioEnElPiso } from "./salon-usuario";
import { cajaDeMueble, cajaDeZona, dentroDe, inflar, seCruzan, ZONAS_SALON, zonasPresentes, type RectCm, type ZonaSalon } from "./salon-zonas";

/**
 * `ajustar_salon`: cambia un salón armado sin rehacerlo, y respeta lo que el usuario hizo (lo dice el registro, no los ids):
 * una mesa que quitó a mano no se vuelve a poner, una que movió se queda donde la dejó (y las demás la esquivan), una zona movida
 * (a mano o con `mover_zona`) no vuelve a su sitio y la decoración del usuario sigue a su zona.
 * - Más invitados: las mesas nuevas van a los primeros sitios libres. Menos: se quitan las de número más alto, con lo que tengan encima.
 * - Otras medidas de la sala u otro tipo de mesa: se rehace la cuadrícula de mesas (las movidas a mano se quedan) y cada zona se corre con su pared.
 * - Si las mesas no caben y la sala no es fija, la agranda (y rehace la cuadrícula).
 */

export type PedidoAjuste = { invitados?: number; /** Número exacto de mesas de invitados (manda sobre `invitados`). */ mesas?: number; mesa?: TipoMesaSalon; sillas?: number; anchoCm?: number; fondoCm?: number; agregarZonas?: readonly ZonaSalon[] };

const elementoDeMesa = (mesa: TipoMesaSalon, sillas: number | undefined, c: Celda): ElementoSalon => {
  const m = medidasDeMesa(mesa, sillas);
  return { id: "salon-mesa", zona: null, rol: "mesa", mueble: m.mueble, anchoCm: m.anchoCm, fondoCm: m.fondoCm, altoCm: m.altoCm, ...(sillas !== undefined ? { sillas } : {}), xCm: c.xCm, zCm: c.zCm, giroGrados: 0 };
};

const cajaDe = (v: PiezaViva): RectCm => cajaDeMueble(v.nodo) ?? { x0: 0, x1: 0, z0: 0, z1: 0 };

export function ajustarSalon(escena: Escena, p: PedidoAjuste, notas: string[]): ResultadoSalon {
  const registro = registroVivo(escena) ?? fallar("No hay un salón armado en la escena: usa armar_salon (o planificar_evento) primero.");
  const mesa = p.mesa ?? registro.mesa;
  if (p.sillas !== undefined) { const fallo = falloDeSillas(mesa, p.sillas); if (fallo) fallar(fallo); }
  // Sin pedir sillas se siguen las de ahora, si valen para ese tipo de mesa; las de siempre del tipo no se guardan.
  const sillas = p.sillas !== undefined ? (p.sillas === MESAS_SALON[mesa].puestos ? undefined : p.sillas) : registro.sillas !== undefined && falloDeSillas(mesa, registro.sillas) === null ? registro.sillas : undefined;
  if (p.sillas === undefined && registro.sillas !== undefined && sillas === undefined) notas.push(`Las ${registro.sillas} sillas por mesa no valen para mesas ${mesa}: puse las de siempre (${MESAS_SALON[mesa].puestos}).`);
  const mismaMesa = mesa === registro.mesa && sillas === registro.sillas;
  const falloMesas = p.mesas === undefined ? null : falloDeMesas(p.mesas);
  if (falloMesas) fallar(falloMesas);
  const invitados = p.mesas !== undefined ? aforoDeMesas(p.mesas, mesa, sillas) : p.invitados ?? registro.invitados;
  if (p.mesas !== undefined) notas.push(`${p.mesas} mesas de ${medidasDeMesa(mesa, sillas).puestos} dan un aforo de ${invitados} invitados${p.invitados !== undefined && p.invitados !== invitados ? ` (no usé invitados = ${p.invitados}: con mesas manda mesas × sillas)` : ""}.`);
  if (invitados > MAX_INVITADOS_SALON) fallar(`Un salón admite hasta ${MAX_INVITADOS_SALON} invitados (me pasaron ${invitados}).`);
  const presentes = zonasPresentes(escena);
  const agregar = ZONAS_SALON.filter((z) => !presentes.includes(z) && p.agregarZonas?.includes(z));
  const zonas = ZONAS_SALON.filter((z) => presentes.includes(z) || agregar.includes(z));
  const ancho = rangoSala(p.anchoCm, SALA_MAXIMA_CM.ancho, "ancho_cm"), fondo = rangoSala(p.fondoCm, SALA_MAXIMA_CM.fondo, "fondo_cm");
  const fija = ancho !== undefined || fondo !== undefined;
  const actual = { anchoCm: ancho ?? escena.sala.anchoCm, fondoCm: fondo ?? escena.sala.fondoCm };

  const necesarias = mesasNecesarias(invitados, mesa, sillas), previas = mesasNecesarias(registro.invitados, registro.mesa, registro.sillas);
  const delSalon = mesasVivas(escena);
  const movidas = delSalon.filter(estaMovida);
  const zonasMovidas = presentes.filter((z) => estaMovida(anclaDeZona(escena, z)!));
  const reservas: RectCm[] = [
    ...piezasDeUsuarioEnElPiso(escena, false).map((x) => x.caja),
    ...movidas.map(cajaDe),
    ...zonasMovidas.flatMap((z) => { const c = cajaDeZona(escena, z); return c ? [c] : []; }),
  ];
  const pista = anclaDeZona(escena, "pista");
  const cajaPista = pista && cajaDeMueble(pista.nodo);
  const parametros: ParamsSalon = { invitados, mesa, ...(sillas !== undefined ? { sillas } : {}), zonas, reservas, profundidadFondoCm: registro.profundidadFondoCm, altoSalaCm: escena.sala.altoCm, ...(cajaPista ? { pistaCm: cajaPista.x1 - cajaPista.x0 } : {}) };

  let rehacer = actual.anchoCm !== escena.sala.anchoCm || actual.fondoCm !== escena.sala.fondoCm || !mismaMesa;
  let d: DistribucionSalon = distribuirSalon({ ...parametros, sala: actual });
  const sitiosLibres = (dist: DistribucionSalon): Celda[] => dist.celdas.filter((c) => { const r = rectDeElemento(elementoDeMesa(mesa, sillas, c)); return !delSalon.some((v) => seCruzan(r, inflar(cajaDe(v), 40))); });
  const faltaSitio = (dist: DistribucionSalon, redo: boolean) => (redo ? dist.celdas.length < necesarias - movidas.length : sitiosLibres(dist).length < Math.max(0, necesarias - previas));
  if (faltaSitio(d, rehacer)) {
    if (fija) falloDeCapacidad({ ...d, capacidad: d.celdas.length + movidas.length, mesasNecesarias: necesarias }, mesa, invitados, sillas);
    d = distribuirSalon({ ...parametros, salaMinima: actual });
    rehacer = true;
    if (faltaSitio(d, true)) falloDeCapacidad({ ...d, capacidad: d.celdas.length + movidas.length, mesasNecesarias: necesarias }, mesa, invitados, sillas);
  }

  const paleta = paletaDeMesas(escena);
  const inicial = { invitados, mesa, ...(sillas !== undefined ? { sillas } : {}), profundidadFondoCm: registro.profundidadFondoCm };
  const salaCambia = d.sala.anchoCm !== escena.sala.anchoCm || d.sala.fondoCm !== escena.sala.fondoCm;
  const salaNueva = salaCambia ? conSalaNueva(escena, { ...escena.sala, anchoCm: d.sala.anchoCm, fondoCm: d.sala.fondoCm, altoCm: Math.max(d.sala.anchoCm, d.sala.fondoCm) >= 900 ? Math.max(escena.sala.altoCm, ALTO_SALON_CM) : escena.sala.altoCm }) : null;
  let e: Escena = salaNueva?.escena ?? escena;
  if (salaNueva) notas.push(...salaNueva.avisos);

  // Las zonas que estaban: con otra sala se corren con su pared (con todo lo suyo, también la decoración adoptada); las movidas se quedan.
  if (salaCambia) {
    for (const z of presentes) {
      const ancla = anclaDeZona(e, z)!;
      const destino = d.elementos.find((x) => x.zona === z && x.rol === "ancla");
      if (estaMovida(ancla)) { const c = cajaDeZona(e, z); if (c && !dentroDe(c, d.sala.anchoCm, d.sala.fondoCm)) notas.push(`${z} (que moviste) quedó fuera de la sala nueva: muévela con mover_zona.`); continue; }
      if (!destino || ancla.nodo.colocacion.en !== "piso") { notas.push(`La zona ${z} no cabe en la sala nueva: se queda donde estaba.`); continue; }
      const dx = destino.xCm - ancla.nodo.colocacion.xCm, dz = destino.zCm - ancla.nodo.colocacion.zCm;
      const ids = new Set(miembrosDeZona(e, z).map((v) => v.nodo.id));
      e = { ...e, nodos: e.nodos.map((n) => (ids.has(n.id) ? desplazarNodo(n, dx, dz) : n)) };
      e = conAnotacion(e, ancla.nodo.id, { pos: { x: Math.round(destino.xCm), z: Math.round(destino.zCm) } });
    }
  }
  // Las zonas que se piden y no estaban (lo que quedó suelto de una que se quitó a mano se limpia antes).
  for (const z of agregar) {
    const sueltas = miembrosDeZona(e, z).filter((v) => v.info.rol !== "adoptada").map((v) => v.nodo.id);
    if (sueltas.length) e = quitarConLoSuyo(e, sueltas).escena;
    const elementos = d.elementos.filter((x) => x.zona === z);
    if (!elementos.length) { notas.push(`La zona ${z} no cabe en la sala: no se armó.`); continue; }
    for (const el of elementos) e = ponerElemento(e, el, paleta, inicial);
  }

  // Las mesas de invitados.
  let quitadas = 0, quitar: string[] = [];
  let siguiente = Math.max(0, ...delSalon.map((v) => v.info.ranura ?? 0)) + 1;
  const cambiarTipo = (n: NodoEscena, c: Celda): NodoEscena => ({ ...n, pieza: nodoDeElemento(elementoDeMesa(mesa, sillas, c), paleta, n.id).pieza });
  if (rehacer) {
    const sueltas = delSalon.filter((v) => !movidas.includes(v));
    const objetivo = Math.max(0, necesarias - movidas.length);
    const retocadas = new Map<string, NodoEscena>();
    sueltas.forEach((v, i) => {
      const celda = d.celdas[i];
      if (i >= objetivo || !celda) { quitar.push(v.nodo.id); return; }
      const movida = { ...v.nodo, colocacion: { en: "piso" as const, xCm: Math.round(celda.xCm), zCm: Math.round(celda.zCm), giroGrados: 0 } };
      retocadas.set(v.nodo.id, mismaMesa ? movida : cambiarTipo(movida, celda));
    });
    if (!mismaMesa) for (const v of movidas) retocadas.set(v.nodo.id, cambiarTipo(v.nodo, { xCm: 0, zCm: 0 }));
    e = { ...e, nodos: e.nodos.map((n) => retocadas.get(n.id) ?? n) };
    for (const [id, n] of retocadas) { const c = n.colocacion; if (c.en === "piso" && !movidas.some((v) => v.nodo.id === id)) e = conAnotacion(e, id, { pos: { x: c.xCm, z: c.zCm } }); }
    for (let i = sueltas.length; i < objetivo && d.celdas[i]; i++) { e = ponerElemento(e, elementoDeMesa(mesa, sillas, d.celdas[i]!), paleta, inicial, siguiente++); }
  } else {
    const sobran = necesarias < previas ? Math.max(0, delSalon.length - necesarias) : 0;
    quitar = delSalon.slice(delSalon.length - sobran).map((v) => v.nodo.id);
    for (const celda of sitiosLibres(d).slice(0, Math.max(0, necesarias - previas))) { e = ponerElemento(e, elementoDeMesa(mesa, sillas, celda), paleta, inicial, siguiente++); }
  }
  if (quitar.length) { const r = quitarConLoSuyo(e, quitar); e = r.escena; quitadas = r.deMas; }
  if (e.nodos.length > MAX_NODOS) fallar(`El ajuste dejaría ${e.nodos.length} piezas y el máximo es ${MAX_NODOS}.`);
  if (e.salon) { const { sillas: _antes, ...registroSinSillas } = e.salon; e = { ...e, salon: { ...registroSinSillas, invitados, mesa, ...(sillas !== undefined ? { sillas } : {}) } }; }

  if (salaCambia) {
    const fuera = piezasDeUsuarioEnElPiso(e, false).filter((x) => !dentroDe(x.caja, e.sala.anchoCm, e.sala.fondoCm)).length;
    if (fuera) notas.push(`${fuera} pieza(s) tuyas quedaron fuera de la sala nueva: muévelas (no las toqué).`);
  }
  if (quitar.length) notas.push(`Quité ${quitar.length} mesa(s) del final${quitadas ? ` y ${quitadas} pieza(s) que estaban sobre ellas` : ""}.`);
  if (movidas.length) notas.push(`${movidas.length} mesa(s) que moviste a mano se quedaron donde las pusiste.`);
  for (const z of d.sinLugar) if (!presentes.includes(z)) notas.push(`La zona ${z} no cabe en la sala: no se armó.`);
  return { escena: e, resumen: `${resumenDeSalon(e)} (${invitados} invitados, caben ${(d.celdas.length + movidas.length) * medidasDeMesa(mesa, sillas).puestos}; sala ${metros(e.sala.anchoCm)} × ${metros(e.sala.fondoCm)}).` };
}
