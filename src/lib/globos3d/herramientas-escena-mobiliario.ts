import { z } from "zod";
import { armarEscena, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { AcabadoEscenografia } from "./escenografia";
import { FONDOS_CATALOGO } from "./fondos-escenografia";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { hexDeColor } from "./mobiliario-colores";
import { colocacionPorDefecto } from "./mobiliario-colocar";
import { muebleDe } from "./mobiliario-catalogo";
import { puestosAlrededor, puestosEnFila, type Puesto } from "./mobiliario-disposicion";
import { opcionesDeMueble, piezaDeEntrada, piezaDeMueble, type OpcionesGuardadas, type PiezaEscenografia } from "./mobiliario-pieza";
import { descripcionConColores, retiroDe, type FondoCatalogo } from "./mobiliario-tipos";
import { esAcabadoMueble, limitesDeMueble, MAX_TEXTO_MUEBLE } from "./mobiliario-pieza";
import { armarPieza, type Pieza } from "./piezas";

/**
 * **agregar_mobiliario**: la herramienta con que la IA de escena pone fondos y muebles que no son globos (sillas,
 * mesas, sofás, aros y arcos metálicos, carrito de dulces, neón…; la lista sale de `FONDOS_CATALOGO`) con sus medidas
 * y colores, y los reparte: `cantidad` en fila o alrededor de una mesa que ya está («6 sillas alrededor de la mesa
 * redonda»). Es escenografía: no cotiza. El mueble queda guardado con sus medidas y colores (`mueble.opciones`), y
 * `cambiar_pieza` los cambia después (`cambiarMobiliario`).
 */

const IDS = FONDOS_CATALOGO.map((f) => f.id) as [string, ...string[]];
const ACABADOS = ["mate", "satinado", "brillante", "tela", "madera", "metal"] as const satisfies readonly AcabadoEscenografia[];

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
  acabado: z.enum(ACABADOS).optional().describe("material del color principal (madera, metal, tela, mate, satinado, brillante)"),
  texto: z.string().min(1).max(MAX_TEXTO_MUEBLE).optional().describe("solo neon_cursiva: lo que dice (hasta 24 letras)"),
  x_cm: z.number().optional().describe("izquierda (−) a derecha (+) desde el centro de la sala; el centro de la fila o del mueble"),
  z_cm: z.number().optional().describe("fondo (−) a frente (+); la pared del fondo está en z = −fondo/2"),
  giro_grados: z.number().min(-180).max(180).optional().describe("giro sobre el eje vertical; 0 = de frente al público"),
  a_lo_largo_cm: z.number().optional().describe("solo de pared (neón, letrero, cortina): desde el centro de la pared del fondo, + a la derecha"),
  altura_cm: z.number().min(0).max(500).optional().describe("solo de pared: altura del borde de abajo"),
});
type Pedido = z.infer<typeof MobiliarioSchema>;

const r0 = (n: number) => Math.round(n);

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

function aplicar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = MobiliarioSchema.parse(argumentos ?? {});
  const entrada = FONDOS_CATALOGO.find((f) => f.id === a.id) ?? fallar(`No hay «${a.id}» en el catálogo de mobiliario.`);
  const notas: string[] = [];
  const mueble = entrada.clase === "mueble" ? entrada : undefined;
  if (!mueble && (a.ancho_cm || a.fondo_cm || a.alto_cm || a.colores || a.acabado)) notas.push(`«${entrada.nombre}» es un fondo de foto: va con sus medidas y colores de catálogo (el mobiliario sí cambia de medida y color).`);
  if (a.texto && !mueble?.conTexto) notas.push(`«${entrada.nombre}» no lleva texto: lo ignoré.`);
  const limites = mueble ? limitesDeMueble(mueble) : undefined;
  if (mueble && a.fondo_cm !== undefined && mueble.fondo && mueble.fondo !== "libre") notas.push(`«${mueble.nombre}» no cambia de fondo por separado (${mueble.fondo === "igual_ancho" ? "es redondo: su fondo es su ancho" : mueble.fondo === "proporcional" ? "su fondo sale de su ancho" : "su fondo es fijo"}): ignoré fondo_cm.`);
  const opciones = mueble && limites ? opcionesDeMueble(mueble, {
    ...(a.ancho_cm ? { anchoCm: medidaAcotada(a.ancho_cm, limites.ancho, "ancho_cm", notas) } : {}), ...(a.fondo_cm ? { fondoCm: medidaAcotada(a.fondo_cm, limites.fondo, "fondo_cm", notas) } : {}), ...(a.alto_cm ? { altoCm: medidaAcotada(a.alto_cm, limites.alto, "alto_cm", notas) } : {}),
    ...(a.colores ? { colores: a.colores.map((c) => hexDeColor(c, notas)) } : {}), ...(a.acabado ? { acabado: a.acabado } : {}), ...(mueble.conTexto && a.texto ? { texto: a.texto } : {}),
  }) : undefined;
  const pieza: Pieza = mueble && opciones ? piezaDeMueble(mueble, opciones) : piezaDeEntrada(entrada);
  const real = medidasReales(pieza);
  const n = a.cantidad ?? 1;

  const sitios = repartir(escena, a, entrada, real, n, notas);
  const sola = () => colocacionSola(escena, a, entrada, real, notas);
  let actual = escena;
  const nuevos: NodoEscena[] = [];
  sitios.forEach((sitio, i) => {
    const id = idNuevo(actual, a.id.replace(/_/g, "-"));
    const colocacion: Colocacion = sitio.colocacion ?? (sitio.puesto ? { en: "piso", xCm: sitio.puesto.x, zCm: sitio.puesto.z, giroGrados: sitio.puesto.giroGrados } : sola());
    const nodo: NodoEscena = { id, nombre: `${a.nombre ?? entrada.nombre}${sitios.length > 1 ? ` ${i + 1}` : ""}`, pieza, colocacion };
    actual = { ...actual, nodos: [...actual.nodos, nodo] };
    nuevos.push(nodo);
  });
  const resumen = `Agregué ${nuevos.length} «${entrada.nombre}» de ${textoMedidas(real)}${mueble ? "" : " (medidas del catálogo)"}: ${nuevos.map((x) => x.id).join(", ")}. Es escenografía (no cotiza).`;
  return { escena: actual, resumen: [resumen, ...new Set(notas)].join(" ") };
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
    if (puestos.length < n) notas.push(`Alrededor de «${mesa.nombre}» solo caben ${puestos.length} de ${n}: puse ${puestos.length}.`);
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
  if (aviso && a.x_cm === undefined) notas.push(aviso);
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
const CAMBIOS_MUEBLE = new Set(["id", "nombre", "ancho_cm", "alto_cm", "fondo_cm", "colores", "acabado", "texto", "reemplazar_colores"]);

/** Por qué una escenografía que no es un mueble no cambia de medida ni de color, y qué hacer. */
function motivoFija(p: PiezaEscenografia, nombre: string, pedidos: readonly string[]): string {
  const que = `(${pedidos.join(", ")})`;
  if (p.utileria || p.productos?.length) return `«${nombre}» es utilería de fiesta (un producto de la tienda): no cambia de medida ni de color desde aquí ${que}.`;
  if (p.mueble) return `«${nombre}» es un fondo fijo del catálogo: no cambia de medida ni de color ${que}. Quítalo con quitar_pieza y agrega otro con agregar_mobiliario (los muebles sí se cambian).`;
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
    if (pedidos.length) fallar(motivoFija(base, nombre, pedidos));
    return base;
  }
  const fuera = pedidos.filter((k) => !CAMBIOS_MUEBLE.has(k));
  if (fuera.length) notas.push(`Un mueble solo cambia de medidas, colores, acabado y texto: ignoré ${fuera.join(", ")}.`);
  const limites = limitesDeMueble(m);
  const medida = (clave: string, rango: { min: number; max: number }, actual: number) => { const v = num(props, clave); return v === undefined ? actual : medidaAcotada(v, rango, clave, notas); };
  if (num(props, "fondo_cm") !== undefined && m.fondo && m.fondo !== "libre") notas.push(`«${nombre}» no cambia de fondo por separado (${m.fondo === "igual_ancho" ? "es redondo: su fondo es su ancho" : m.fondo === "proporcional" ? "su fondo sale de su ancho" : "su fondo es fijo"}): ignoré fondo_cm.`);
  const colores = lista(props, "colores");
  const acabado = typeof props.acabado === "string" ? props.acabado : undefined;
  if (acabado && !esAcabadoMueble(acabado)) fallar(`El acabado de un mueble va entre ${ACABADOS.join(", ")}, no «${acabado}».`);
  if (typeof props.texto === "string" && !m.conTexto) notas.push(`«${nombre}» no lleva texto: lo ignoré.`);
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
  for (const r of reemplazos) {
    if (typeof r.de !== "string" || typeof r.a !== "string") continue;
    const de = hexDeColor(r.de, notas);
    const i = nuevas.colores.findIndex((c) => c === de);
    if (i < 0) fallar(`«${nombre}» no usa el color «${r.de}». Usa: ${nuevas.colores.map((c, k) => `${m.coloresDe[k]} ${c}`).join(", ")}.`);
    nuevas.colores[i] = hexDeColor(r.a, notas);
  }
  return piezaDeMueble(m, nuevas);
}

/** Cómo se cuenta un mueble en `ver_escena`: nombre del catálogo, medidas totales y colores con para qué sirve cada uno. */
export function resumenDeEscenografia(p: PiezaEscenografia): { medidas: string; colores: string } | null {
  const m = p.mueble ? muebleDe(p.mueble.id) : undefined;
  const o = p.mueble?.opciones;
  if (!m || !o) return null;
  return { medidas: `${m.nombre} · ${textoMedidas(medidasReales(p))}${o.texto ? ` · «${o.texto}»` : ""}`, colores: o.colores.map((c, i) => `${m.coloresDe[i] ?? "color"} ${c}`).join(", ") };
}

export const HERRAMIENTAS_MOBILIARIO: Readonly<Record<string, HerramientaExtra>> = {
  agregar_mobiliario: {
    esquema: MobiliarioSchema,
    descripcion: "Pone mobiliario o un fondo que NO es de globos (sillas Tiffany o modernas, bancas, taburetes, sofás, mesas imperiales, redondas, cóctel, de postres, de regalos, mesas nido, carrito de dulces, aros y arcos metálicos, peldaños, biombo, pampas, lámpara, neón…) con medidas totales y colores; no cotiza. Con cantidad y disposicion reparte varios: «fila», o «alrededor» de una mesa que ya está (alrededor_de = su id; cada asiento queda mirando a la mesa): «6 sillas alrededor de una mesa redonda» = primero agregar_mobiliario mesa_redonda_mantel, luego agregar_mobiliario silla_tiffany con cantidad 6, disposicion alrededor y alrededor_de = el id que devolvió la mesa. Después se cambia con cambiar_pieza (ancho_cm, fondo_cm, alto_cm, colores, acabado, texto); quitar_pieza y mover_pieza para lo demás.",
    aplicar,
  },
};
