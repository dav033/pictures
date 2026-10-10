import { idCortoDeFondo } from "@/lib/catalogo/asignacion-fondos";
import { avisar, avisosDe, type AvisoUsuario } from "./avisos-usuario";
import { z } from "zod";
import { armarEscena, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { AcabadoEscenografia } from "./escenografia";
import { entradaDeCatalogo, FONDOS_CATALOGO } from "./fondos-escenografia";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { hexDeColor } from "./mobiliario-colores";
import { colocacionPorDefecto } from "./mobiliario-colocar";
import { comprobarNombreMueble } from "./descripcion-mobiliario";
import { muebleDe } from "./mobiliario-catalogo";
import { puestosAlrededor, puestosEnFila, type Puesto } from "./mobiliario-disposicion";
import { ACABADOS_MUEBLE, admiteRotulo, conTextoPieza, tintarFondo, nombreDeMueble, opcionesDeMueble, piezaDeEntrada, piezaDeMueble, portadorDeRotulo, type OpcionesGuardadas, type PiezaEscenografia } from "./mobiliario-pieza";
import { ACABADOS_ROTULO, avisoDeTexto, caraDe, esAcabadoRotulo, NOMBRE_ACABADO_ROTULO, textoEnUnaLinea, type PedidoRotulo } from "./rotulos";
import { asientosDeEntrada, descripcionConColores, retiroDe, tinteDe, type FondoCatalogo, type MuebleCatalogo } from "./mobiliario-tipos";
import { esGrupoDeSillas, esMesaParametrica, MANTEL_TEXTO, medidaDeMesa, mesaDePieza, sillasDePieza } from "./mobiliario-conjunto";
import { NOMBRE_MESA } from "./mobiliario-conjunto-tipos";
import { SILLAS } from "./mobiliario-sillas-param";
import { esAcabadoMueble, limitesDeMueble, MAX_TEXTO_MUEBLE } from "./mobiliario-pieza";
import { armarPieza, type Pieza } from "./piezas";

/**
 * **agregar_mobiliario**: la herramienta con que la IA de escena pone fondos y muebles que no son globos (sillas,
 * mesas, sofás, aros y arcos metálicos, carrito de dulces, neón…; la lista sale de `FONDOS_CATALOGO`) con sus medidas
 * y colores, y los reparte: `cantidad` en fila o alrededor de una mesa que ya está («6 sillas alrededor de la mesa
 * redonda»). Es escenografía: no cotiza. El mueble queda guardado con sus medidas y colores (`mueble.opciones`), y
 * `cambiar_pieza` los cambia después (`cambiarMobiliario`). Un nombre en cursiva (`texto`) es el rótulo de un panel, un arco o un marco con tela
 * (vinilo, con `color_texto`, `acabado_texto`, `alto_texto_cm`, `altura_texto_cm`) o el nombre de acrílico suelto.
 */

const IDS = FONDOS_CATALOGO.map((f) => f.id) as [string, ...string[]];
const ACABADOS = ACABADOS_MUEBLE;

const MobiliarioSchema = z.object({
  id: z.enum(IDS).describe(FONDOS_CATALOGO.map((f) => `${f.id}: ${descripcionConColores(f)}`).join(" ")),
  nombre: z.string().min(1).max(60).optional().describe("nombre visible (por defecto, el del catálogo)"),
  cantidad: z.number().int().min(1).max(24).optional().describe("cuántos iguales (1 por defecto); más de uno se reparte con disposicion"),
  disposicion: z.enum(["fila", "alrededor"]).optional().describe("fila: en línea de izquierda a derecha, centrados en x_cm/z_cm; alrededor: repartidos alrededor de la mesa alrededor_de, mirando a ella (sillas y taburetes)"),
  alrededor_de: z.string().min(1).max(80).optional().describe("disposicion alrededor: id de la mesa (u otra pieza) que ya está en la escena (los da ver_escena)"),
  holgura_cm: z.number().min(0).max(80).optional().describe("alrededor: separación entre el borde de la mesa y el frente de cada asiento (8 por defecto)"),
  separacion_cm: z.number().min(10).max(600).optional().describe("fila: distancia entre centros (el ancho de cada uno + 8 por defecto)"),
  ancho_cm: z.number().min(5).max(1200).optional().describe("ancho TOTAL de la pieza armada (en lo redondo, el diámetro); si falta, el del catálogo"),
  fondo_cm: z.number().min(2).max(600).optional().describe("fondo total (de frente a atrás); si falta, el del catálogo"),
  alto_cm: z.number().min(1).max(500).optional().describe("alto total; si falta, el del catálogo"),
  colores: z.array(z.string().min(1).max(40)).min(1).max(3).optional().describe("colores en el orden que dice cada mueble en «Colores en orden» (el primero es el principal); nombre común («blanco», «dorado», «azul marino», «rosa») o #rrggbb"),
  acabado: z.enum(ACABADOS).optional().describe("material del color principal (madera, metal, tela, mate, satinado, brillante, acrilico = transparente: el tablero de un neón)"),
  texto: z.string().min(1).max(MAX_TEXTO_MUEBLE).optional().describe("lo que dice, en cursiva (hasta 24 letras; varias líneas separadas por un salto de línea): neon_cursiva, rotulo_acrilico, y el nombre en vinilo de panel_redondo, arcos_chiara, lentejuelas, letrero o marco_tela"),
  color_texto: z.string().min(1).max(40).optional().describe("solo con texto en un panel, arco, marco o letrero: color de las letras (nombre común o #rrggbb; por defecto el que se lee sobre el fondo)"),
  acabado_texto: z.enum(ACABADOS_ROTULO).optional().describe("solo con texto en un panel, arco, marco o letrero: vinilo (por defecto), acrilico_espejo o acrilico_mate"),
  alto_texto_cm: z.number().min(1).max(600).optional().describe("solo con texto en un panel, arco, marco o letrero: alto de todo el texto (30 % del fondo por defecto; se achica si no cabe a lo ancho)"),
  altura_texto_cm: z.number().min(0).max(1500).optional().describe("solo con texto en un panel, arco, marco o letrero: altura del centro del texto sobre el borde de abajo del fondo (a media altura por defecto)"),
  x_cm: z.number().optional().describe("izquierda (−) a derecha (+) desde el centro de la sala; el centro de la fila o del mueble"),
  z_cm: z.number().optional().describe("fondo (−) a frente (+); la pared del fondo está en z = −fondo/2"),
  giro_grados: z.number().min(-180).max(180).optional().describe("giro sobre el eje vertical; 0 = de frente al público"),
  a_lo_largo_cm: z.number().optional().describe("solo de pared (neón, letrero, cortina): desde el centro de la pared del fondo, + a la derecha"),
  altura_cm: z.number().min(0).max(500).optional().describe("solo de pared: altura del borde de abajo"),
});
type Pedido = z.infer<typeof MobiliarioSchema>;

const r0 = (n: number) => Math.round(n);

/** Un mueble con materiales propios (el nombre de acrílico: metal = espejo, mate) no acepta otro: se dice cuáles valen en vez de dibujar otra cosa. */
function comprobarAcabadoPropio(m: MuebleCatalogo, acabado: string | undefined) {
  if (acabado && m.acabadosPropios && !m.acabadosPropios.some(([id]) => id === acabado)) fallar(`«${m.nombre}» solo se hace en ${m.acabadosPropios.map(([id, nombre]) => `${id} (${nombre.toLowerCase()})`).join(" o ")}, no en ${acabado}.`);
}

/** Un fondo fijo que admite color (`tinte` del catálogo) va en el primer color pedido; los demás se avisan. Si no encuentra su color principal, lo dice. */
function conColorPedido(pieza: PiezaEscenografia, colores: readonly string[], notas: string[], nombre: string): PiezaEscenografia {
  if (!colores.length) return pieza;
  const tintada = tintarFondo(pieza, hexDeColor(colores[0]!, notas)) ?? fallar(`No pude cambiar el color de «${nombre}»: no encuentro su color principal entre sus partes.`);
  if (colores.length > 1) notas.push("Un fondo tiene un solo color: usé el primero.");
  return tintada;
}

/** Las medidas reales (cm) de una pieza armada, para decirlas tal cual quedaron. */
function medidasReales(pieza: Pieza): { anchoCm: number; fondoCm: number; altoCm: number } {
  const { min, max } = armarPieza(pieza).caja;
  return { anchoCm: max.x - min.x, fondoCm: max.z - min.z, altoCm: max.y - min.y };
}
const textoMedidas = (m: { anchoCm: number; fondoCm: number; altoCm: number }) => `${r0(m.anchoCm)}×${r0(m.fondoCm)}×${r0(m.altoCm)} cm (ancho×fondo×alto)`;

/** Una medida pedida (cm): mayor que 0 y dentro de lo razonable para ese mueble (0,4–2,5 veces su medida de catálogo); si se pasa, se acota y se dice. */
function medidaAcotada(valor: number, rango: { min: number; max: number }, etiqueta: string, notas: string[]): number {
  if (!Number.isFinite(valor) || valor <= 0) return fallar(`${etiqueta} tiene que ser mayor que 0 (me pasaron ${valor}).`);
  const v = Math.min(rango.max, Math.max(rango.min, valor));
  if (v !== valor) notas.push(`${etiqueta} ${r0(valor)} cm no es razonable para este mueble (de ${rango.min} a ${rango.max} cm): quedó en ${r0(v)} cm.`);
  return v;
}

/** El `id` puede llegar calificado (`mobiliario:silla_tiffany`, REQ-013): se guarda el corto; uno de otro repositorio no vale. */
function conIdCorto(argumentos: unknown): unknown {
  if (typeof argumentos !== "object" || argumentos === null || !("id" in argumentos) || typeof argumentos.id !== "string") return argumentos;
  const corto = idCortoDeFondo(argumentos.id);
  return corto !== null ? { ...argumentos, id: corto } : fallar(`«${argumentos.id}» no es de ese repositorio del catálogo: usa el id sin prefijo.`);
}

function aplicar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string; avisos: AvisoUsuario[] } {
  const a = MobiliarioSchema.parse(conIdCorto(argumentos ?? {}));
  const entrada = FONDOS_CATALOGO.find((f) => f.id === a.id) ?? fallar(`No hay «${a.id}» en el catálogo de mobiliario.`);
  const notas: string[] = [];
  const veredicto = comprobarNombreMueble(entrada, a.nombre);
  if (veredicto.tipo === "error") fallar(veredicto.error);
  if (veredicto.tipo === "corregido") notas.push(veredicto.aviso);
  const nombreBase = veredicto.tipo === "corregido" ? veredicto.nombre : a.nombre ?? entrada.nombre;
  const mueble = entrada.clase === "mueble" ? entrada : undefined;
  if (mueble?.sillas) notas.push(`«${entrada.nombre}» es un conjunto fijo de ${asientosDeEntrada(mueble)} sillas Tiffany en una sola pieza: para otro número de sillas, otro tipo de silla o de mesa usa cambiar_sillas / cambiar_mesas con su id (la pasa a mesa con sillas editables) o agregar_mesas con sillas_por_mesa.`);
  if (mueble) comprobarAcabadoPropio(mueble, a.acabado);
  if (!mueble && (a.ancho_cm || a.fondo_cm || a.alto_cm || a.acabado || (a.colores && !tinteDe(entrada)))) notas.push(`«${entrada.nombre}» es un fondo de foto: va con sus medidas${tinteDe(entrada) ? "" : " y colores"} de catálogo (el mobiliario sí cambia de medida y color${tinteDe(entrada) ? "; este fondo cambia su color principal con colores" : ""}).`);
  if (a.texto && !mueble?.conTexto && !entrada.rotulable) notas.push(`«${entrada.nombre}» no lleva texto: lo ignoré.`);
  if (a.texto && mueble?.conTexto) { const aviso = avisoDeTexto(a.texto, mueble.lineasTexto ?? 1); if (aviso) notas.push(aviso); }
  if (!entrada.rotulable && (a.color_texto || a.acabado_texto || a.alto_texto_cm || a.altura_texto_cm)) notas.push(`«${entrada.nombre}» no lleva un rótulo aparte: ignoré color_texto, acabado_texto, alto_texto_cm y altura_texto_cm (el nombre de acrílico cambia con colores y acabado).`);
  const limites = mueble ? limitesDeMueble(mueble) : undefined;
  if (mueble && a.fondo_cm !== undefined && mueble.fondo && mueble.fondo !== "libre") notas.push(`«${mueble.nombre}» no cambia de fondo por separado (${mueble.fondo === "igual_ancho" ? "es redondo: su fondo es su ancho" : mueble.fondo === "proporcional" ? "su fondo sale de su ancho" : "su fondo es fijo"}): ignoré fondo_cm.`);
  const opciones = mueble && limites ? opcionesDeMueble(mueble, {
    ...(a.ancho_cm ? { anchoCm: medidaAcotada(a.ancho_cm, limites.ancho, "ancho_cm", notas) } : {}), ...(a.fondo_cm ? { fondoCm: medidaAcotada(a.fondo_cm, limites.fondo, "fondo_cm", notas) } : {}), ...(a.alto_cm ? { altoCm: medidaAcotada(a.alto_cm, limites.alto, "alto_cm", notas) } : {}),
    ...(a.colores ? { colores: a.colores.map((c) => hexDeColor(c, notas)) } : {}), ...(a.acabado ? { acabado: a.acabado } : {}), ...(mueble.conTexto && a.texto ? { texto: a.texto } : {}),
  }) : undefined;
  const sinRotulo: Pieza = mueble && opciones ? piezaDeMueble(mueble, opciones) : piezaDeEntrada(entrada);
  const conColor = a.colores && tinteDe(entrada) !== undefined && sinRotulo.tipo === "escenografia" ? conColorPedido(sinRotulo, a.colores, notas, nombreBase) : sinRotulo;
  const pieza = entrada.rotulable && conColor.tipo === "escenografia" ? conRotuloPedido(conColor, a, notas, entrada.nombre) : conColor;
  const real = medidasReales(pieza);
  const n = a.cantidad ?? 1;

  const sitios = repartir(escena, a, entrada, real, n, notas);
  const sola = () => colocacionSola(escena, a, entrada, real, notas);
  let actual = escena;
  const nuevos: NodoEscena[] = [];
  sitios.forEach((sitio, i) => {
    const id = idNuevo(actual, a.id.replace(/_/g, "-"));
    const colocacion: Colocacion = sitio.colocacion ?? (sitio.puesto ? { en: "piso", xCm: sitio.puesto.x, zCm: sitio.puesto.z, giroGrados: sitio.puesto.giroGrados } : sola());
    const nodo: NodoEscena = { id, nombre: `${nombreBase}${sitios.length > 1 ? ` ${i + 1}` : ""}`, pieza, colocacion };
    actual = { ...actual, nodos: [...actual.nodos, nodo] };
    nuevos.push(nodo);
  });
  const trae = mueble ? asientosDeEntrada(mueble, opciones) : 0;
  const asientos = trae ? ` Trae ${trae} ${trae === 1 ? "asiento" : "asientos"} cada una${mueble?.asiento ? "" : " (con el conjunto fijo: otro número de sillas va con agregar_mesas)"}.` : "";
  const resumen = `Agregué ${nuevos.length} «${entrada.nombre}» de ${textoMedidas(real)}${mueble ? "" : " (medidas del catálogo)"}: ${nuevos.map((x) => x.id).join(", ")}. Es escenografía (no cotiza).${asientos}`;
  return { escena: actual, resumen: [resumen, ...new Set(notas)].join(" "), avisos: avisosDe(notas) };
}

/** Un sitio del reparto: un puesto del piso, una colocación ya hecha (pared) o «el de siempre» (`porDefecto`). */
type Sitio = { puesto?: Puesto; colocacion?: Colocacion; porDefecto?: boolean };

/** Dónde va cada uno: el reparto pedido, o un solo sitio (el pedido, o el de siempre esquivando lo que ya está). */
function repartir(escena: Escena, a: Pedido, entrada: FondoCatalogo, real: { anchoCm: number; fondoCm: number }, n: number, notas: string[]): Sitio[] {
  if (entrada.lugar === "pared") {
    if (n > 1) notas.push("Los de pared van de uno en uno: puse solo uno.");
    return [{ colocacion: { en: "pared", pared: "fondo", aLoLargoCm: a.a_lo_largo_cm ?? a.x_cm ?? 0, alturaCm: a.altura_cm ?? entrada.alturaParedCm ?? 0 } }];
  }
  const disposicion = a.disposicion ?? (n > 1 ? "fila" : undefined);
  if (disposicion === "alrededor") {
    if (!a.alrededor_de) fallar("Para repartir alrededor de una mesa dime cuál (alrededor_de = su id, de ver_escena).");
    const mesa = escena.nodos.find((x) => x.id === a.alrededor_de) ?? fallar(`No hay pieza con id «${a.alrededor_de}». Usa ver_escena para ver los ids.`);
    const caja = armarEscena(escena).porNodo.find((x) => x.id === mesa.id)?.caja ?? fallar(`«${mesa.nombre}» no ocupa lugar en la escena.`);
    const puestos = puestosAlrededor({
      cx: (caja.min.x + caja.max.x) / 2, cz: (caja.min.z + caja.max.z) / 2, anchoCm: caja.max.x - caja.min.x, fondoCm: caja.max.z - caja.min.z,
      cantidad: n, holguraCm: real.fondoCm / 2 + (a.holgura_cm ?? 8), frenteCm: real.anchoCm,
    });
    if (puestos.length < n) avisar(notas, `Alrededor de «${mesa.nombre}» solo caben ${puestos.length} de ${n}: puse ${puestos.length}.`, "solo caben", "no caben", "no cupieron");
    return puestos.map((puesto) => ({ puesto }));
  }
  if (disposicion === "fila") {
    const z = a.z_cm ?? r0(-escena.sala.fondoCm / 2 + retiroDe(entrada));
    return puestosEnFila({ cx: a.x_cm ?? 0, cz: z, cantidad: n, separacionCm: a.separacion_cm ?? real.anchoCm + 8, giroGrados: a.giro_grados ?? 0 }).map((puesto) => ({ puesto }));
  }
  return [{ porDefecto: true }];
}

/** El sitio de un solo mueble sin reparto: x y z pedidos mandan; lo que falta, lo de siempre (esquivando lo que ya está, o encima de la mesa). */
function colocacionSola(escena: Escena, a: Pedido, entrada: FondoCatalogo, real: { anchoCm: number; fondoCm: number }, notas: string[]): Colocacion {
  const { colocacion: base, aviso } = colocacionPorDefecto(escena, entrada, real);
  if (aviso && a.x_cm === undefined) avisar(notas, aviso, "no hay lugar", "encima de otra pieza", "muévela");
  if (base.en !== "piso") return base;
  return { ...base, xCm: a.x_cm ?? base.xCm, zCm: a.z_cm ?? base.zCm, giroGrados: a.giro_grados ?? 0 };
}

// ----------------------------------------------------------------------------------------------------------
// cambiar_pieza sobre un mueble
// ----------------------------------------------------------------------------------------------------------

type Props = Readonly<Record<string, unknown>>;
const num = (p: Props, k: string): number | undefined => (typeof p[k] === "number" ? (p[k] as number) : undefined);
const lista = (p: Props, k: string): string[] | undefined => (Array.isArray(p[k]) && (p[k] as unknown[]).every((x) => typeof x === "string") ? (p[k] as string[]) : undefined);

/** Lo que `cambiar_pieza` sabe cambiar en un mueble, para el aviso de lo que no. */
const CAMBIOS_ROTULO = ["texto", "color_texto", "acabado_texto", "alto_texto_cm", "altura_texto_cm"] as const;
const CAMBIOS_MUEBLE = new Set<string>(["id", "nombre", "ancho_cm", "alto_cm", "fondo_cm", "colores", "acabado", "reemplazar_colores", ...CAMBIOS_ROTULO]);

/**
 * El rótulo en cursiva de un panel, arco, letrero o marco con tela según lo pedido (`texto`, `color_texto`, `acabado_texto`,
 * `alto_texto_cm`, `altura_texto_cm`): con texto lo pone o lo cambia, un texto vacío lo quita, y sin texto cambia el que ya tiene.
 */
function conRotuloPedido(pieza: PiezaEscenografia, props: Props, notas: string[], nombre: string): Pieza {
  const pide = CAMBIOS_ROTULO.filter((k) => props[k] !== undefined);
  if (!pide.length) return pieza;
  const previo = pieza.mueble?.rotulo;
  if (!previo && !(typeof props.texto === "string" && props.texto.trim())) {
    if (typeof props.texto === "string") return pieza;
    return fallar(`«${nombre}» todavía no tiene texto: pásame también el texto para ponerle un nombre (${pide.join(", ")}).`);
  }
  const acabado = props.acabado_texto;
  if (acabado !== undefined && !esAcabadoRotulo(acabado)) fallar(`El acabado del texto va entre ${ACABADOS_ROTULO.join(", ")}, no «${String(acabado)}».`);
  const alto = num(props, "alto_texto_cm"), altura = num(props, "altura_texto_cm");
  if (alto !== undefined && (!Number.isFinite(alto) || alto <= 0)) fallar(`alto_texto_cm tiene que ser mayor que 0 (me pasaron ${alto}).`);
  const avisoTexto = typeof props.texto === "string" ? avisoDeTexto(props.texto) : null;
  if (avisoTexto) notas.push(avisoTexto);
  const pedido: PedidoRotulo = {
    ...(typeof props.texto === "string" ? { texto: props.texto } : {}),
    ...(typeof props.color_texto === "string" ? { color: hexDeColor(props.color_texto, notas) } : {}),
    ...(typeof acabado === "string" && esAcabadoRotulo(acabado) ? { acabado } : {}),
    ...(alto !== undefined ? { altoCm: alto } : {}), ...(altura !== undefined ? { yCm: altura } : {}),
  };
  const hecha = conTextoPieza(pieza, pedido);
  const cara = caraDe(portadorDeRotulo(pieza)!);
  const rotulo = hecha.tipo === "escenografia" ? hecha.mueble?.rotulo : undefined;
  if (rotulo && cara) {
    if (alto !== undefined && alto > cara.altoCm + 0.05) notas.push(`alto_texto_cm ${r0(alto)} no cabe en «${nombre}» (alto de ${r0(cara.altoCm)} cm): se dibuja de ${r0(cara.altoCm)} cm o menos, según lo ancho que quede el texto.`);
    if (altura !== undefined && altura > cara.altoCm + 0.05) notas.push(`altura_texto_cm ${r0(altura)} se sale de «${nombre}» (alto de ${r0(cara.altoCm)} cm): el texto se dibuja dentro de él.`);
  }
  return hecha;
}

/** Cómo se dice un rótulo en `ver_escena`. */
const dichoRotulo = (r: NonNullable<NonNullable<PiezaEscenografia["mueble"]>["rotulo"]>) =>
  `texto ${JSON.stringify(textoEnUnaLinea(r.texto))} en ${NOMBRE_ACABADO_ROTULO[r.acabado].toLowerCase()} ${r.color}, ${r0(r.altoCm)} cm de alto, centrado a ${r0(r.yCm)} cm del borde de abajo`;

/** Por qué una escenografía que no es un mueble no cambia de medida ni de color, y qué hacer. */
function motivoFija(p: PiezaEscenografia, nombre: string, pedidos: readonly string[]): string {
  const que = `(${pedidos.join(", ")})`;
  if (esMesaParametrica(p)) return `«${nombre}» es una mesa de agregar_mesas: su tipo, medida y mantel se cambian con cambiar_mesas ${que}.`;
  if (esGrupoDeSillas(p)) return `«${nombre}» es el grupo de sillas de una mesa: su cantidad, tipo, color y disposición se cambian con cambiar_sillas ${que}.`;
  if (p.utileria || p.productos?.length) return `«${nombre}» es utilería de fiesta (un producto de la tienda): no cambia de medida ni de color desde aquí ${que}.`;
  if (p.mueble) return `«${nombre}» es un fondo fijo del catálogo: no cambia de medida, y su color solo cambia en el panel redondo, la media luna, las lentejuelas, el tapete, la cortina y el letrero ${que}. Quítalo con quitar_pieza y agrega otro con agregar_mobiliario (los muebles sí se cambian).`;
  return `«${nombre}» es escenografía armada (de una idea o de la biblioteca): no cambia de medida ni de color ${que}. Si hace falta otra, quítala con quitar_pieza.`;
}

/**
 * `cambiar_pieza` sobre escenografía: medidas (ancho_cm, fondo_cm, alto_cm), colores, acabado y texto de un mueble
 * paramétrico. Las medidas van de 0,4 a 2,5 veces la del catálogo (lo de más se acota y se avisa; 0 o negativo es error).
 * Un fondo fijo (panel, cortina, pedestales), la utilería o una pieza de la biblioteca no cambia de medida ni de color:
 * error claro en vez de no hacer nada.
 */
export function cambiarMobiliario(base: PiezaEscenografia, props: Props, notas: string[], nombre: string): Pieza {
  const pedidos = Object.keys(props).filter((k) => k !== "id" && k !== "nombre" && props[k] !== undefined);
  const m = base.mueble ? muebleDe(base.mueble.id) : undefined;
  const o = base.mueble?.opciones;
  if (!m || !o) {
    // Un fondo fijo con rótulo (panel, arcos, lentejuelas, letrero) solo cambia su texto; lo demás avisa.
    const delRotulo = admiteRotulo(base) ? pedidos.filter((k) => k === "reemplazar_colores" || (CAMBIOS_ROTULO as readonly string[]).includes(k)) : [];
    const fijoBase = base.mueble ? entradaDeCatalogo(base.mueble.id) : undefined;
    const admiteColor = fijoBase !== undefined && tinteDe(fijoBase) !== undefined;
    const delColor: string[] = admiteColor ? pedidos.filter((k) => k === "colores") : [];
    const otros = pedidos.filter((k) => !delRotulo.includes(k) && !delColor.includes(k));
    if (otros.length) fallar(motivoFija(base, nombre, otros));
    const colores = lista(props, "colores") ?? [];
    const conColor = delColor.length ? conColorPedido(base, colores, notas, nombre) : base;
    // En un fondo fijo el único color que se cambia es el del texto: reemplazar_colores de ese color.
    let propsDeTexto: Props = props;
    for (const r of Array.isArray(props.reemplazar_colores) ? (props.reemplazar_colores as Array<{ de?: unknown; a?: unknown }>) : []) {
      if (typeof r.de !== "string" || typeof r.a !== "string") continue;
      const actual = base.mueble?.rotulo?.color;
      if (!actual || hexDeColor(r.de, notas) !== actual) fallar(`«${nombre}» es un fondo fijo: solo cambia el color de su texto${actual ? ` (texto ${actual})` : " (todavía no lleva texto)"}.`);
      propsDeTexto = { ...propsDeTexto, color_texto: hexDeColor(r.a, notas) };
    }
    return delRotulo.length ? conRotuloPedido(conColor, propsDeTexto, notas, nombre) : conColor;
  }
  const fuera = pedidos.filter((k) => !CAMBIOS_MUEBLE.has(k));
  if (fuera.length) notas.push(`Un mueble solo cambia de medidas, colores, acabado y texto: ignoré ${fuera.join(", ")}.`);
  const limites = limitesDeMueble(m);
  const medida = (clave: string, rango: { min: number; max: number }, actual: number) => { const v = num(props, clave); return v === undefined ? actual : medidaAcotada(v, rango, clave, notas); };
  if (num(props, "fondo_cm") !== undefined && m.fondo && m.fondo !== "libre") notas.push(`«${nombre}» no cambia de fondo por separado (${m.fondo === "igual_ancho" ? "es redondo: su fondo es su ancho" : m.fondo === "proporcional" ? "su fondo sale de su ancho" : "su fondo es fijo"}): ignoré fondo_cm.`);
  const colores = lista(props, "colores");
  const acabado = typeof props.acabado === "string" ? props.acabado : undefined;
  if (acabado && !esAcabadoMueble(acabado)) fallar(`El acabado de un mueble va entre ${ACABADOS.join(", ")}, no «${acabado}».`);
  comprobarAcabadoPropio(m, acabado);
  if (typeof props.texto === "string" && !m.conTexto && !m.rotulable) notas.push(`«${nombre}» no lleva texto: lo ignoré.`);
  if (typeof props.texto === "string" && m.conTexto) { const aviso = avisoDeTexto(props.texto, m.lineasTexto ?? 1); if (aviso) notas.push(aviso); }
  if (colores && colores.length > m.coloresDe.length) notas.push(`«${nombre}» lleva ${m.coloresDe.length} color(es) (${m.coloresDe.join(", ")}): ignoré los demás.`);
  const pedidosHex = colores?.slice(0, m.coloresDe.length).map((c) => hexDeColor(c, notas));
  // Si todos sus colores eran el primero (la alfombra sin ribete), un solo color pedido los lleva a todos.
  const siguePrimero = Boolean(m.seguirPrimero) && o.colores.every((c) => c === o.colores[0]) && pedidosHex?.length === 1;
  const nuevas: OpcionesGuardadas = {
    ...o,
    anchoCm: medida("ancho_cm", limites.ancho, o.anchoCm), fondoCm: medida("fondo_cm", limites.fondo, o.fondoCm), altoCm: medida("alto_cm", limites.alto, o.altoCm),
    colores: Array.from({ length: Math.min(m.coloresDe.length, Math.max(o.colores.length, pedidosHex?.length ?? 0)) }, (_, i) => pedidosHex?.[i] ?? (siguePrimero ? pedidosHex![0]! : o.colores[i] ?? m.colores[i] ?? m.colores[0]!)),
    ...(acabado && esAcabadoMueble(acabado) ? { acabado } : {}),
    ...(typeof props.texto === "string" && m.conTexto ? { texto: props.texto } : {}),
  };
  const reemplazos = Array.isArray(props.reemplazar_colores) ? (props.reemplazar_colores as Array<{ de?: unknown; a?: unknown }>) : [];
  let colorDelTexto: string | undefined;
  for (const r of reemplazos) {
    if (typeof r.de !== "string" || typeof r.a !== "string") continue;
    const de = hexDeColor(r.de, notas);
    const i = nuevas.colores.findIndex((c) => c === de);
    if (i < 0 && de === base.mueble?.rotulo?.color) { colorDelTexto = hexDeColor(r.a, notas); continue; }
    if (i < 0) fallar(`«${nombre}» no usa el color «${r.de}». Usa: ${[...nuevas.colores.map((c, k) => `${m.coloresDe[k]} ${c}`), ...(base.mueble?.rotulo ? [`texto ${base.mueble.rotulo.color}`] : [])].join(", ")}.`);
    nuevas.colores[i] = hexDeColor(r.a, notas);
  }
  const cambiada = piezaDeMueble(m, nuevas, base.mueble?.rotulo);
  if (m.rotulable && cambiada.tipo === "escenografia") return conRotuloPedido(cambiada, colorDelTexto ? { ...props, color_texto: colorDelTexto } : props, notas, nombre);
  if (CAMBIOS_ROTULO.slice(1).some((k) => props[k] !== undefined)) notas.push(`«${nombre}» no lleva un rótulo aparte: ignoré color_texto, acabado_texto, alto_texto_cm y altura_texto_cm.`);
  return cambiada;
}

/** Cómo se cuenta un mueble en `ver_escena`: nombre del catálogo, medidas totales y colores con para qué sirve cada uno. */
export function resumenDeEscenografia(p: PiezaEscenografia): { medidas: string; colores: string } | null {
  if (p.mueble?.mesa || p.mueble?.sillas) return resumenDeConjuntoParametrico(p);
  const m = p.mueble ? muebleDe(p.mueble.id) : undefined;
  const o = p.mueble?.opciones;
  const rotulo = p.mueble?.rotulo;
  if (!m || !o) {
    // Un fondo fijo: su nombre, sus medidas, su color si lo admite (`tinte`) y lo que dice su rótulo (panel redondo, arcos, letrero…).
    const fijo = p.mueble ? entradaDeCatalogo(p.mueble.id) : undefined;
    if (!fijo || (!rotulo && !tinteDe(fijo))) return null;
    const colores = [...(tinteDe(fijo) ? [`fondo ${p.mueble?.tinte ?? tinteDe(fijo)}`] : []), ...(rotulo ? [`texto ${rotulo.color}`] : [])];
    return { medidas: `${fijo.nombre} · ${textoMedidas(medidasReales(p))}${rotulo ? ` · ${dichoRotulo(rotulo)}` : ""}`, colores: colores.join(", ") };
  }
  const acabadoPropio = m.acabadosPropios?.find(([id]) => id === (o.acabado ?? "metal"))?.[1];
  return {
    medidas: `${nombreDeMueble(m, o)} · ${textoMedidas(medidasReales(p))}${o.texto ? ` · texto ${JSON.stringify(textoEnUnaLinea(o.texto))}` : ""}${acabadoPropio ? ` · ${acabadoPropio.toLowerCase()}` : ""}${rotulo ? ` · ${dichoRotulo(rotulo)}` : ""}`,
    colores: o.colores.map((c, i) => `${m.coloresDe[i] ?? "color"} ${c}`).join(", "),
  };
}

/** Una mesa paramétrica o su grupo de sillas en `ver_escena` cuando se lee la pieza sola (sin la escena: las sillas de la mesa las cuenta `resumenEscena`). */
function resumenDeConjuntoParametrico(p: PiezaEscenografia): { medidas: string; colores: string } {
  const mesa = mesaDePieza(p), sillas = sillasDePieza(p);
  if (mesa) return { medidas: `${NOMBRE_MESA[mesa.tipo]} ${medidaDeMesa(mesa)} cm · tapa a ${r0(mesa.altoCm)} cm · ${MANTEL_TEXTO[mesa.mantel]}`, colores: `${mesa.mantel === "ninguno" ? "tapa" : "mantel"} ${mesa.colorMantel}, patas ${mesa.colorPatas}${mesa.camino ? `, camino ${mesa.camino}` : ""}` };
  const s = sillas!;
  return { medidas: `${s.puestos.length} ${s.puestos.length === 1 ? SILLAS[s.tipo].nombre.toLowerCase() : SILLAS[s.tipo].plural} · ${s.disposicion.replace(/_/g, " ")}${s.pedida > s.puestos.length ? ` (se pidieron ${s.pedida}, no caben más)` : ""}`, colores: `estructura ${s.colorEstructura}${s.colorCojin ? `, cojín ${s.colorCojin}` : ""}` };
}

export const HERRAMIENTAS_MOBILIARIO: Readonly<Record<string, HerramientaExtra>> = {
  agregar_mobiliario: {
    esquema: MobiliarioSchema,
    descripcion: "Pone mobiliario o un fondo que NO es de globos (sillas Tiffany o modernas, bancas, taburetes, sofás, mesas imperiales, redondas, cóctel, de postres, de regalos, mesas nido, carrito de dulces, aros y arcos metálicos, peldaños, biombo, pampas, lámpara, neón…) con medidas totales y colores; no cotiza. Con cantidad y disposicion reparte varios: «fila», o «alrededor» de una mesa que ya está (alrededor_de = su id; cada asiento queda mirando a la mesa): «6 sillas alrededor de una mesa redonda» = primero agregar_mobiliario mesa_redonda_mantel, luego agregar_mobiliario silla_tiffany con cantidad 6, disposicion alrededor y alrededor_de = el id que devolvió la mesa. Después se cambia con cambiar_pieza (ancho_cm, fondo_cm, alto_cm, colores, acabado, texto); quitar_pieza y mover_pieza para lo demás. Mesas CON sillas: agregar_mesas (cualquier número de sillas y tipo de mesa); mesa_redonda_sillas y mesa_imperial_sillas son fijas (8 y 10 sillas).",
    aplicar,
  },
};
