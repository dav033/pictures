import { z } from "zod";
import { idNuevo, type Escena, type NodoEscena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { MAX_NODOS } from "./limites-escena";
import { grupoDeSillasDe, sillasDeMesaNodo, textoSillasDeMesa } from "./mobiliario-asientos-mesa";
import { hexDeColor } from "./mobiliario-colores";
import { esquivarEnElPiso } from "./mobiliario-colocar";
import {
  armarConjuntoMesa, mesaDePedido, mesaDePieza, medidaDeMesa, nombreDeMesa, PLURAL_MESA, sillasDePieza, MANTEL_TEXTO, type PedidoMesa, type PedidoSillas,
} from "./mobiliario-conjunto";
import {
  cambiarMesa, cambiarSillas, conjuntoDe, conjuntosDe, cuadricula, esConjuntoFijo, pasarAConjunto,
} from "./mobiliario-conjunto-escena";
import {
  DISPOSICIONES, FONDO_DEL_ANCHO, MANTELES, MAX_SILLAS_POR_MESA, NOMBRE_MESA, TIPOS_MESA, TIPOS_SILLA, type MesaGuardada,
} from "./mobiliario-conjunto-tipos";
import { ADMITE_CAMINO } from "./mobiliario-mesas-param";
import { medidaDeAsiento, SILLAS } from "./mobiliario-sillas-param";

/**
 * **Mesas y sillas desacopladas** para la IA de escena (REQ-012): `agregar_mesas` pone N mesas (de cualquier tipo y medida) con M sillas
 * cada una, repartidas en cuadrícula; `cambiar_sillas` cambia la cantidad, el tipo, el color o la disposición de las sillas de una, varias o
 * todas las mesas (o las quita); `cambiar_mesas` cambia el tipo, la medida o el mantel dejando sus sillas y lo que tiene encima. Cada
 * mesa es una pieza y sus sillas OTRA (un grupo, una sola pieza aunque sean 40): se mueven, giran y duplican juntas. Todo resumen sale
 * de las piezas ya hechas —tipos, medidas y conteos reales—, nunca de lo que se pidió ni del nombre de una pieza.
 */

const MIRANDO = ["fondo", "frente", "izquierda", "derecha"] as const;
/** Hacia dónde miran los comensales (grados de la sala: 0 = hacia el público, 180 = hacia la pared del fondo). */
const GRADOS_MIRANDO: Readonly<Record<(typeof MIRANDO)[number], number>> = { fondo: 180, frente: 0, izquierda: -90, derecha: 90 };

const SillasCampos = {
  tipo_silla: z.enum(TIPOS_SILLA).optional().describe("tiffany (chiavari), crossback, ghost (acrílica), plegable, moderna, banca, taburete"),
  color_silla: z.string().min(1).max(40).optional().describe("color de la silla (nombre o #rrggbb)"),
  color_cojin: z.string().min(1).max(40).optional().describe("color del cojín; «ninguno» = sin cojín"),
  disposicion: z.enum(DISPOSICIONES).optional().describe("alrededor (todo el borde), un_lado, dos_lados (los largos), cabeceras (las puntas), frente (solo el lado que mira a mirando_a)"),
  mirando_a: z.enum(MIRANDO).optional().describe("con disposicion frente: hacia qué pared miran los comensales (fondo = el escenario)"),
};

const AgregarSchema = z.object({
  cantidad: z.number().int().min(1).max(60).optional().describe("cuántas mesas iguales (1)"),
  preset: z.enum(["redonda_8", "imperial_10"]).optional().describe("redonda_8 = redonda Ø150 con 8 sillas; imperial_10 = rectangular 240×90 con 10; lo demás que pidas manda"),
  tipo: z.enum(TIPOS_MESA).optional().describe("redonda (por defecto), cuadrada, rectangular, ovalada, coctel, media_luna, serpentina, u (banquete en U)"),
  ancho_cm: z.number().min(40).max(800).optional().describe("diámetro (redonda, cóctel, media luna), lado (cuadrada) o largo (las demás)"),
  fondo_cm: z.number().min(40).max(800).optional().describe("ancho de la mesa (rectangular, ovalada, serpentina) o fondo de la U"),
  alto_cm: z.number().min(30).max(125).optional().describe("alto de la tapa (75; cóctel 110)"),
  mantel: z.enum(MANTELES).optional().describe("piso (hasta el piso), corto o ninguno"),
  color_mantel: z.string().min(1).max(40).optional().describe("color del mantel (o de la tapa sin mantel)"),
  color_patas: z.string().min(1).max(40).optional(),
  camino: z.string().min(1).max(40).optional().describe("color del camino de mesa (redonda, cuadrada, rectangular, ovalada)"),
  sillas_por_mesa: z.number().int().min(0).max(MAX_SILLAS_POR_MESA).optional().describe("sillas de cada mesa («mesas de 4 personas» = 4); 0 o sin decir = sin sillas"),
  ...SillasCampos,
  columnas: z.number().int().min(1).max(20).optional().describe("columnas de la cuadrícula (por defecto, las que caben)"),
  separacion_cm: z.number().min(0).max(400).optional().describe("pasillo entre conjuntos (40)"),
  x_cm: z.number().optional().describe("centro del grupo, desde el centro de la sala"),
  z_cm: z.number().optional().describe("fondo (−) a frente (+)"),
  giro_grados: z.number().min(-180).max(180).optional(),
  nombre: z.string().min(1).max(60).optional(),
});

const IdsCampo = z.array(z.string().min(1).max(80)).max(60).optional().describe("ids de las mesas o de sus sillas; sin ids = todas las mesas");

const SillasSchema = z.object({
  ids: IdsCampo,
  cantidad: z.number().int().min(0).max(MAX_SILLAS_POR_MESA).optional().describe("sillas por mesa; 0 = quitar todas las sillas"),
  ...SillasCampos,
});

const MesasSchema = z.object({
  ids: IdsCampo,
  tipo: z.enum(TIPOS_MESA).optional(),
  ancho_cm: z.number().min(40).max(800).optional().describe("diámetro, lado o largo, como en agregar_mesas"),
  fondo_cm: z.number().min(40).max(800).optional(),
  alto_cm: z.number().min(30).max(125).optional(),
  mantel: z.enum(MANTELES).optional(),
  color_mantel: z.string().min(1).max(40).optional(),
  color_patas: z.string().min(1).max(40).optional(),
  camino: z.string().min(1).max(40).optional().describe("color del camino; «ninguno» lo quita"),
});

// ----------------------------------------------------------------------------------------------------------
// Lectura: el resumen sale de las piezas
// ----------------------------------------------------------------------------------------------------------

const SINGULAR_MESA: Readonly<Record<MesaGuardada["tipo"], string>> = {
  redonda: "mesa redonda", cuadrada: "mesa cuadrada", rectangular: "mesa rectangular", ovalada: "mesa ovalada", coctel: "mesa cóctel",
  media_luna: "mesa media luna", serpentina: "mesa serpentina", u: "banquete en U",
};

const cuenta = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

function descripcionMesas(mesas: readonly MesaGuardada[]): string {
  const grupos = new Map<string, { m: MesaGuardada; n: number }>();
  for (const m of mesas) {
    const clave = `${m.tipo}|${medidaDeMesa(m)}|${Math.round(m.altoCm)}|${m.mantel}`;
    const g = grupos.get(clave);
    if (g) g.n++; else grupos.set(clave, { m, n: 1 });
  }
  return [...grupos.values()].map(({ m, n }) => `${cuenta(n, SINGULAR_MESA[m.tipo], PLURAL_MESA[m.tipo])} ${medidaDeMesa(m)} cm (${Math.round(m.altoCm)} cm de alto, ${MANTEL_TEXTO[m.mantel]})`).join(", ");
}

/**
 * «6 mesas redondas Ø150 cm, 4 sillas Tiffany cada una (24 sillas en total)»: el conteo sale de las piezas de la escena (mesas y
 * grupos de sillas), no de lo que se pidió. `ids`: las mesas de las que se habla.
 */
export function resumenDeConjuntos(escena: Escena, ids: readonly string[]): string {
  const conjuntos = ids.flatMap((id) => { const c = conjuntoDe(escena, id); return c ? [c] : []; });
  const mesas = conjuntos.map((c) => mesaDePieza(c.mesa.pieza)).filter((m): m is MesaGuardada => m !== null);
  if (!mesas.length) return "sin mesas";
  const porSillas = new Map<string, { texto: string; n: number }>();
  let total = 0;
  for (const c of conjuntos) {
    const s = c.sillas ? sillasDePieza(c.sillas.pieza) : null;
    const cuantas = sillasDeMesaNodo(escena, c.mesa).total;
    total += cuantas;
    const clave = s ? `${s.tipo}|${cuantas}|${s.disposicion}` : "ninguna";
    const previo = porSillas.get(clave);
    if (previo) previo.n++;
    else porSillas.set(clave, { texto: s ? `${cuenta(cuantas, SILLAS[s.tipo].nombre.toLowerCase(), SILLAS[s.tipo].plural)}${s.disposicion === "alrededor" ? "" : ` (${s.disposicion.replace(/_/g, " ")})`}` : "sin sillas", n: 1 });
  }
  const grupos = [...porSillas.values()];
  const sillas = grupos.length === 1 ? `${grupos[0]!.texto}${mesas.length > 1 && total ? " cada una" : ""}` : grupos.map((g) => `${cuenta(g.n, "mesa", "mesas")} con ${g.texto}`).join(", ");
  return `${descripcionMesas(mesas)}, ${sillas} (${cuenta(total, "silla", "sillas")} en total)`;
}

/** Cómo se cuenta una mesa paramétrica o su grupo de sillas en `ver_escena`: lo que de verdad es. */
export function lineaDeMobiliarioParametrico(escena: Escena, n: NodoEscena): { medidas: string; colores: string } | null {
  const mesa = mesaDePieza(n.pieza), sillas = sillasDePieza(n.pieza);
  if (mesa) {
    const suyas = sillasDeMesaNodo(escena, n);
    const conSillas = suyas.total ? ` · ${textoSillasDeMesa(suyas)} en el grupo ${suyas.nodos.join(", ")}` : " · sin sillas";
    return {
      medidas: `${NOMBRE_MESA[mesa.tipo]} ${medidaDeMesa(mesa)} cm · tapa a ${Math.round(mesa.altoCm)} cm · ${MANTEL_TEXTO[mesa.mantel]}${conSillas}`,
      colores: `${mesa.mantel === "ninguno" ? "tapa" : "mantel"} ${mesa.colorMantel}, patas ${mesa.colorPatas}${mesa.camino ? `, camino ${mesa.camino}` : ""}`,
    };
  }
  if (sillas) {
    const mesaId = n.colocacion.en === "sobre" ? n.colocacion.padreId : "?";
    const pidio = sillas.pedida > sillas.puestos.length ? ` (se pidieron ${sillas.pedida}, no caben más)` : "";
    return {
      medidas: `${cuenta(sillas.puestos.length, SILLAS[sillas.tipo].nombre.toLowerCase(), SILLAS[sillas.tipo].plural)}${pidio} · ${sillas.disposicion.replace(/_/g, " ")} de la mesa ${mesaId}`,
      colores: `estructura ${sillas.colorEstructura}${sillas.colorCojin ? `, cojín ${sillas.colorCojin}` : ""}`,
    };
  }
  return null;
}

// ----------------------------------------------------------------------------------------------------------
// Resolver ids
// ----------------------------------------------------------------------------------------------------------

/**
 * Las mesas de un pedido: por ids (de la mesa, de sus sillas o de un conjunto fijo de antes, que se pasa a mesa paramétrica) o, sin
 * ids, todas las de la escena. Devuelve la escena (con los fijos ya pasados) y los ids de las mesas.
 */
function mesasDelPedido(escena: Escena, ids: readonly string[] | undefined, notas: string[]): { escena: Escena; mesas: string[] } {
  let actual = escena;
  const fijos = (ids?.length ? ids.filter((id) => escena.nodos.some((n) => n.id === id && esConjuntoFijo(n))) : escena.nodos.filter(esConjuntoFijo).map((n) => n.id));
  for (const id of fijos) {
    // Cada conjunto fijo pasa a ser dos piezas (mesa y sillas): sin lugar en el tope, se queda como estaba.
    if (actual.nodos.length >= MAX_NODOS) { notas.push(`«${id}» no se pudo pasar a mesa con sillas editables: la escena llegó al tope de ${MAX_NODOS} piezas.`); continue; }
    const nueva = pasarAConjunto(actual, id, notas);
    if (nueva) { actual = nueva; notas.push(`«${id}» era un conjunto fijo: lo pasé a mesa con sillas editables (mismos colores; la mesa y las sillas se rehacen por su perímetro).`); }
  }
  if (!ids?.length) {
    const todas = conjuntosDe(actual).map((c) => c.mesa.id);
    if (!todas.length) return fallar("No hay mesas con sillas editables en la escena. Agrégalas con agregar_mesas.");
    return { escena: actual, mesas: todas };
  }
  const mesas = new Set<string>();
  for (const id of ids) {
    const c = conjuntoDe(actual, id);
    if (!c) {
      const existe = actual.nodos.some((n) => n.id === id);
      fallar(existe ? `«${id}» no es una mesa de las que se editan aquí (mesas de agregar_mesas). Una mesa suelta del catálogo se cambia con cambiar_pieza; para esto agrega la mesa con agregar_mesas.` : `No hay pieza con id «${id}». Mesas: ${conjuntosDe(actual).map((x) => x.mesa.id).join(", ") || "ninguna"}.`);
      continue;
    }
    mesas.add(c.mesa.id);
  }
  return { escena: actual, mesas: [...mesas] };
}

/** Los grados de «mirando_a» (de la sala) en el marco de una mesa que está girada `giro`. */
const enMarcoDeMesa = (gradosSala: number, giro: number) => { let g = gradosSala - giro; while (g > 180) g -= 360; while (g <= -180) g += 360; return g; };
const giroDe = (n: NodoEscena) => (n.colocacion.en === "piso" ? n.colocacion.giroGrados : 0);

// ----------------------------------------------------------------------------------------------------------
// agregar_mesas
// ----------------------------------------------------------------------------------------------------------

type Agregar = z.infer<typeof AgregarSchema>;

function agregarMesas(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a: Agregar = AgregarSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const preset = a.preset === "imperial_10" ? { tipo: "rectangular" as const, sillas: 10 } : a.preset === "redonda_8" ? { tipo: "redonda" as const, sillas: 8 } : null;
  const tipo = a.tipo ?? preset?.tipo ?? "redonda";
  const mesa: PedidoMesa = {
    tipo,
    ...(a.ancho_cm !== undefined ? { anchoCm: a.ancho_cm } : {}), ...(a.fondo_cm !== undefined ? { fondoCm: a.fondo_cm } : {}), ...(a.alto_cm !== undefined ? { altoCm: a.alto_cm } : {}),
    ...(a.mantel ? { mantel: a.mantel } : {}),
    ...(a.color_mantel ? { colorMantel: hexDeColor(a.color_mantel, notas) } : {}), ...(a.color_patas ? { colorPatas: hexDeColor(a.color_patas, notas) } : {}),
    ...(a.camino && a.camino.trim().toLowerCase() !== "ninguno" ? { camino: hexDeColor(a.camino, notas) } : {}),
  };
  if (a.fondo_cm !== undefined && FONDO_DEL_ANCHO[tipo]) notas.push(`${NOMBRE_MESA[tipo]} no lleva fondo aparte (sale de su ancho): ignoré fondo_cm.`);
  if (a.camino && !ADMITE_CAMINO.has(tipo)) notas.push(`El camino de mesa no va en ${NOMBRE_MESA[tipo].toLowerCase()}: lo ignoré.`);
  const guardada = mesaDePedido(mesa);
  const cantidad = a.cantidad ?? 1;
  const sillasPorMesa = a.sillas_por_mesa ?? preset?.sillas ?? 0;
  const giro = Math.round(a.giro_grados ?? 0);
  if (sillasPorMesa === 0 && (a.tipo_silla || a.color_silla || a.disposicion)) notas.push("Sin sillas_por_mesa no puse sillas: dime cuántas por mesa.");
  const sillas: PedidoSillas | null = sillasPorMesa > 0 ? {
    cantidad: sillasPorMesa, ...(a.tipo_silla ? { tipo: a.tipo_silla } : {}), ...(a.color_silla ? { colorEstructura: hexDeColor(a.color_silla, notas) } : {}),
    ...(a.color_cojin ? { colorCojin: a.color_cojin.trim().toLowerCase() === "ninguno" ? null : hexDeColor(a.color_cojin, notas) } : {}),
    ...(a.disposicion ? { disposicion: a.disposicion } : {}),
    ...(a.disposicion === "frente" || (a.mirando_a && !a.disposicion) ? { haciaGrados: enMarcoDeMesa(GRADOS_MIRANDO[a.mirando_a ?? "fondo"], giro) } : {}),
  } : null;
  if (a.mirando_a && a.disposicion !== "frente") notas.push("mirando_a solo cuenta con disposicion «frente»: lo ignoré.");

  // Cuántos conjuntos caben en el tope de piezas (cada uno es una mesa y, si lleva, su grupo de sillas).
  const porConjunto = sillas ? 2 : 1;
  const libres = Math.max(0, MAX_NODOS - escena.nodos.length);
  const caben = Math.min(cantidad, Math.floor(libres / porConjunto));
  if (caben < 1) fallar(`La escena ya tiene ${escena.nodos.length} piezas y el máximo es ${MAX_NODOS}: no cabe ni una mesa${sillas ? " con sus sillas" : ""}. Quita algo antes.`);
  if (caben < cantidad) notas.push(`Pediste ${cantidad} mesas pero solo caben ${caben} (la escena admite ${MAX_NODOS} piezas y cada mesa${sillas ? " con sillas usa 2" : " usa 1"}): puse ${caben}.`);

  // La celda de cada conjunto: la mesa más lo que sobresalen sus sillas por cada lado, y un pasillo.
  const pasillo = a.separacion_cm ?? 40;
  const sobresale = sillas ? medidaDeAsiento(sillas.tipo ?? "tiffany").fondoCm + 14 : 0;
  const giraDe90 = Math.abs(giro) === 90;
  const celdaAncho = (giraDe90 ? guardada.fondoCm : guardada.anchoCm) + 2 * sobresale + pasillo, celdaFondo = (giraDe90 ? guardada.anchoCm : guardada.fondoCm) + 2 * sobresale + pasillo;
  const centro = { x: Math.round(a.x_cm ?? 0), z: Math.round(a.z_cm ?? 0) };
  const rejilla = cuadricula({ cantidad: caben, anchoCm: celdaAncho, fondoCm: celdaFondo, ...(a.columnas ? { columnas: a.columnas } : {}), cx: centro.x, cz: centro.z, salaAnchoCm: escena.sala.anchoCm });
  let puntos = rejilla.puntos;
  if (caben === 1 && a.x_cm === undefined) {
    const libre = esquivarEnElPiso(escena, centro.x, centro.z, celdaAncho - pasillo, celdaFondo - pasillo);
    if (libre) puntos = [{ x: libre.x, z: libre.z }]; else notas.push("No hay un hueco libre para la mesa con sus sillas: quedó en el centro, encima de otra pieza. Muévela.");
  }
  const ocupaAncho = rejilla.columnas * celdaAncho - pasillo, ocupaFondo = rejilla.filas * celdaFondo - pasillo;
  if (caben > 1 && (ocupaAncho > escena.sala.anchoCm || ocupaFondo > escena.sala.fondoCm)) {
    notas.push(`Los ${caben} conjuntos ocupan ${Math.round(ocupaAncho) / 100} × ${Math.round(ocupaFondo) / 100} m y la sala mide ${Math.round(escena.sala.anchoCm) / 100} × ${Math.round(escena.sala.fondoCm) / 100} m: se salen de la sala. Agrándala, pon menos mesas o usa una separacion_cm menor.`);
  }

  let actual = escena;
  const creadas: string[] = [];
  const base = tipo === "u" ? "mesa-u" : `mesa-${tipo.replace(/_/g, "-")}`;
  puntos.forEach((p, i) => {
    const idMesa = idNuevo(actual, base);
    const idSillas = idNuevo({ ...actual, nodos: [...actual.nodos, { id: idMesa } as NodoEscena] }, `sillas-${idMesa}`);
    const conjunto = armarConjuntoMesa({
      ids: { mesa: idMesa, sillas: idSillas }, mesa, sillas,
      nombre: a.nombre ? `${a.nombre}${caben > 1 ? ` ${i + 1}` : ""}` : caben > 1 ? `${nombreDeMesa(guardada)} ${i + 1}` : undefined, colocacion: { en: "piso", xCm: p.x, zCm: p.z, giroGrados: giro },
    });
    for (const nota of conjunto.notas) notas.push(nota);
    actual = { ...actual, nodos: [...actual.nodos, ...conjunto.nodos] };
    creadas.push(idMesa);
  });
  const resumen = `Agregué ${resumenDeConjuntos(actual, creadas)}: ${creadas.join(", ")}.`;
  return { escena: actual, resumen: [resumen, ...new Set(notas)].join(" ") };
}

// ----------------------------------------------------------------------------------------------------------
// cambiar_sillas
// ----------------------------------------------------------------------------------------------------------

function cambiarSillasTool(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = SillasSchema.parse(argumentos ?? {});
  if (a.cantidad === undefined && !a.tipo_silla && !a.color_silla && a.color_cojin === undefined && !a.disposicion && !a.mirando_a) fallar("No pediste ningún cambio: dime cantidad, tipo_silla, color_silla, color_cojin, disposicion o mirando_a.");
  const notas: string[] = [];
  const { escena: base, mesas } = mesasDelPedido(escena, a.ids, notas);
  let actual = base;
  const sinSillas: string[] = [];
  const sobrantes = (MAX_NODOS - actual.nodos.length);
  let nuevosGrupos = 0;
  for (const id of mesas) {
    const mesaNodo = actual.nodos.find((n) => n.id === id)!;
    const previas = grupoDeSillasDe(actual, id);
    if (!previas && (a.cantidad === undefined || a.cantidad === 0)) { sinSillas.push(id); continue; }
    if (!previas) { nuevosGrupos++; if (nuevosGrupos > sobrantes) { notas.push(`La escena llegó al tope de ${MAX_NODOS} piezas: «${mesaNodo.nombre}» (${id}) se quedó sin sillas.`); continue; } }
    const pedido: PedidoSillas = {
      cantidad: a.cantidad ?? sillasDePieza(previas!.pieza)?.pedida ?? 0,
      ...(a.tipo_silla ? { tipo: a.tipo_silla } : {}), ...(a.color_silla ? { colorEstructura: hexDeColor(a.color_silla, notas) } : {}),
      ...(a.color_cojin !== undefined ? { colorCojin: a.color_cojin.trim().toLowerCase() === "ninguno" ? null : hexDeColor(a.color_cojin, notas) } : {}),
      ...(a.disposicion ? { disposicion: a.disposicion } : {}),
      ...(a.mirando_a || a.disposicion === "frente" ? { haciaGrados: enMarcoDeMesa(GRADOS_MIRANDO[a.mirando_a ?? "fondo"], giroDe(mesaNodo)) } : {}),
    };
    actual = cambiarSillas(actual, id, pedido, notas);
  }
  if (a.mirando_a && a.disposicion !== undefined && a.disposicion !== "frente") notas.push("mirando_a solo cuenta con disposicion «frente»: lo ignoré.");
  if (sinSillas.length) notas.push(`${cuenta(sinSillas.length, "mesa no tenía", "mesas no tenían")} sillas (${sinSillas.slice(0, 6).join(", ")}${sinSillas.length > 6 ? "…" : ""}): dime cuántas poner con cantidad.`);
  const verbo = a.cantidad === 0 ? "Quité las sillas" : "Cambié las sillas";
  const resumen = `${verbo} de ${cuenta(mesas.length, "mesa", "mesas")}: ${resumenDeConjuntos(actual, mesas)}.`;
  return { escena: actual, resumen: [resumen, ...new Set(notas)].join(" ") };
}

// ----------------------------------------------------------------------------------------------------------
// cambiar_mesas
// ----------------------------------------------------------------------------------------------------------

function cambiarMesasTool(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = MesasSchema.parse(argumentos ?? {});
  if (!a.tipo && a.ancho_cm === undefined && a.fondo_cm === undefined && a.alto_cm === undefined && !a.mantel && !a.color_mantel && !a.color_patas && !a.camino) fallar("No pediste ningún cambio: dime tipo, ancho_cm, fondo_cm, alto_cm, mantel, color_mantel, color_patas o camino.");
  const notas: string[] = [];
  const { escena: base, mesas } = mesasDelPedido(escena, a.ids, notas);
  let actual = base;
  const quitaCamino = a.camino?.trim().toLowerCase() === "ninguno";
  for (const id of mesas) {
    const nodo = actual.nodos.find((n) => n.id === id)!;
    const vieja = mesaDePieza(nodo.pieza)!;
    const tipo = a.tipo ?? vieja.tipo;
    const cambio: Partial<MesaGuardada> = {
      ...(a.tipo ? { tipo: a.tipo } : {}),
      ...(a.ancho_cm !== undefined ? { anchoCm: a.ancho_cm } : {}), ...(a.fondo_cm !== undefined && !FONDO_DEL_ANCHO[tipo] ? { fondoCm: a.fondo_cm } : {}), ...(a.alto_cm !== undefined ? { altoCm: a.alto_cm } : {}),
      ...(a.mantel ? { mantel: a.mantel } : {}),
      ...(a.color_mantel ? { colorMantel: hexDeColor(a.color_mantel, notas) } : {}), ...(a.color_patas ? { colorPatas: hexDeColor(a.color_patas, notas) } : {}),
      ...(a.camino && (quitaCamino || ADMITE_CAMINO.has(tipo)) ? { camino: quitaCamino ? null : hexDeColor(a.camino, notas) } : {}),
    };
    if (a.fondo_cm !== undefined && FONDO_DEL_ANCHO[tipo]) notas.push(`${NOMBRE_MESA[tipo]} no lleva fondo aparte (sale de su ancho): ignoré fondo_cm.`);
    if (a.camino && !quitaCamino && !ADMITE_CAMINO.has(tipo)) notas.push(`El camino de mesa no va en ${NOMBRE_MESA[tipo].toLowerCase()}: lo ignoré.`);
    actual = cambiarMesa(actual, id, cambio, notas);
  }
  const resumen = `Cambié ${cuenta(mesas.length, "mesa", "mesas")}, con sus sillas y lo que tienen encima en su sitio: ${resumenDeConjuntos(actual, mesas)}.`;
  return { escena: actual, resumen: [resumen, ...new Set(notas)].join(" ") };
}

export const HERRAMIENTAS_MESAS: Readonly<Record<string, HerramientaExtra>> = {
  agregar_mesas: {
    esquema: AgregarSchema,
    descripcion: "Pone N mesas de cualquier tipo y medida (redonda, cuadrada, rectangular, ovalada, coctel, media_luna, serpentina, u) con M sillas cada una (tiffany, crossback, ghost, plegable, moderna, banca, taburete), repartidas en cuadrícula; cada mesa y su grupo de sillas son piezas separadas que se mueven juntas. «6 mesas de 4 sillas» = cantidad 6, sillas_por_mesa 4; «mesas de N personas» = N sillas por mesa. Si no caben todas las sillas pedidas pone las que caben y lo dice. No cotiza. Úsala SIEMPRE para mesas con sillas (nunca mesa_redonda_sillas ni sillas sueltas una a una).",
    aplicar: agregarMesas,
  },
  cambiar_sillas: {
    esquema: SillasSchema,
    descripcion: "Cambia las sillas de una, varias o todas las mesas de agregar_mesas (ids; sin ids = todas): cantidad (0 las quita), tipo_silla, color, cojín, disposicion (alrededor, un_lado, dos_lados, cabeceras, frente). Reparte por el perímetro real de cada mesa y, si no caben, pone las que caben y lo avisa. Pasa a editables los conjuntos fijos mesa_redonda_sillas y mesa_imperial_sillas.",
    aplicar: cambiarSillasTool,
  },
  cambiar_mesas: {
    esquema: MesasSchema,
    descripcion: "Cambia el tipo, la medida, el alto, el mantel o los colores de una, varias o todas las mesas de agregar_mesas (ids; sin ids = todas) conservando sus sillas (se vuelven a repartir) y lo que hay sobre la tapa (centros de mesa, torta).",
    aplicar: cambiarMesasTool,
  },
};
