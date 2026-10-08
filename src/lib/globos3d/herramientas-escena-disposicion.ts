import { z } from "zod";
import { armarEscena, descendientes, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { Pieza, PiezaArmada } from "./piezas";
import { SILUETAS_TRAZO, type SiluetaTrazo } from "./trazo-organico";
import { fallar } from "./herramientas-escena-colores";
import { idsDelPedido, nodoDe, xDeNodo, type HerramientaExtra } from "./herramientas-escena-grupos";

/**
 * **Disposición de varias piezas** para la IA de la escena (2026-10-08, lo que pide el dueño: «alinea bien las
 * palmeras», «las columnas en fila con 1 m entre ellas», «las flores parejas entre −2 y 2 m», «la misma columna al
 * otro lado»):
 * - `alinear`: en fila (borde a borde con separación, o entre centros), a la misma altura (pared/techo/suelta), en la
 *   misma línea (misma distancia a la pared del fondo) o centradas en la pared;
 * - `distribuir`: equidistantes entre dos x;
 * - `espejar`: copia simétrica de una pieza respecto del centro de la sala o de otra pieza, con lo que lleva encima
 *   (la forma también se refleja en lo orgánico: una columna inclinada a la derecha sale inclinada a la izquierda).
 * Las piezas se nombran por ids o por grupo en palabras («las dos palmeras»). Medidas en cm; x desde el centro.
 */

const r0 = (n: number) => Math.round(n);
const CACHE = new Map<string, PiezaArmada>();
const recortar = () => { while (CACHE.size > 200) { const k = CACHE.keys().next().value; if (k === undefined) break; CACHE.delete(k); } };

/** Ancho real (caja armada en la sala) y cuánto se corre su centro respecto de su x de colocación. */
function cajas(escena: Escena, ids: readonly string[]): Map<string, { ancho: number; corrimiento: number }> {
  const armada = armarEscena(escena, CACHE);
  recortar();
  const salida = new Map<string, { ancho: number; corrimiento: number }>();
  for (const id of ids) {
    const n = nodoDe(escena, id);
    const caja = armada.porNodo.find((x) => x.id === id)?.caja;
    if (!caja || !Number.isFinite(caja.min.x)) { salida.set(id, { ancho: 0, corrimiento: 0 }); continue; }
    salida.set(id, { ancho: caja.max.x - caja.min.x, corrimiento: (caja.min.x + caja.max.x) / 2 - xDeNodo(escena, n) });
  }
  return salida;
}

/** La misma colocación con otra x (a lo ancho de la sala). Solo piezas del piso, del techo, sueltas o de la pared del fondo. */
function conX(escena: Escena, n: NodoEscena, x: number): Colocacion {
  const c = n.colocacion;
  const mitad = escena.sala.anchoCm / 2;
  if (Math.abs(x) > mitad + 0.5) fallar(`«${n.nombre}» (${n.id}) quedaría en x = ${r0(x)} cm, fuera de la sala (va de −${r0(mitad)} a ${r0(mitad)}): usa menos separación o un tramo más corto.`);
  if (c.en === "piso" || c.en === "techo" || c.en === "libre") return { ...c, xCm: r0(x) };
  if (c.en === "pared" && c.pared === "fondo") return { ...c, aLoLargoCm: r0(x) };
  if (c.en === "pared") return fallar(`«${n.nombre}» está en la pared ${c.pared}: aquí solo se alinea lo del piso, el techo o la pared del fondo. Muévela con mover_pieza.`);
  return fallar(`«${n.nombre}» va ${c.en === "ancla" ? "colgada de" : "sobre"} «${c.padreId}»: se mueve con su estructura (o con mover_sobre).`);
}

const reemplazarNodos = (escena: Escena, cambios: ReadonlyMap<string, Colocacion>): Escena =>
  ({ ...escena, nodos: escena.nodos.map((n) => (cambios.has(n.id) ? { ...n, colocacion: cambios.get(n.id)! } : n)) });

const describir = (escena: Escena, ids: readonly string[]) => ids.map((id) => {
  const n = nodoDe(escena, id), c = n.colocacion;
  const extra = c.en === "piso" ? ` z=${r0(c.zCm)}` : c.en === "pared" ? ` altura=${r0(c.alturaCm)}` : c.en === "techo" ? ` cuelga=${r0(c.cuelgaCm)}` : c.en === "libre" ? ` y=${r0(c.yCm)}` : "";
  return `${id} x=${r0(xDeNodo(escena, n))}${extra}`;
}).join("; ");

const PiezasSchema = {
  ids: z.array(z.string().min(1).max(80)).max(40).optional().describe("ids de las piezas"),
  grupo: z.string().max(120).optional().describe("en vez de ids: el grupo en palabras («las dos columnas», «las palmeras», «las flores del techo»)"),
};

// ----------------------------------------------------------------------------------------------------------
// alinear
// ----------------------------------------------------------------------------------------------------------

const AlinearSchema = z.object({
  ...PiezasSchema,
  como: z.array(z.enum(["fila", "misma_altura", "misma_linea", "centrar"])).min(1).max(4)
    .describe("fila: una al lado de la otra en x, en su orden actual de izquierda a derecha; misma_altura: misma altura en la pared, mismo largo de hilo en el techo o misma y si van sueltas; misma_linea: misma z (misma distancia a la pared del fondo); centrar: el grupo centrado a lo ancho (x = 0 o centro_x_cm) sin cambiar sus distancias"),
  separacion_cm: z.number().min(0).max(1000).optional().describe("fila: hueco entre una pieza y la siguiente, de borde a borde (por defecto 30)"),
  entre_centros_cm: z.number().min(10).max(1200).optional().describe("fila: en vez de separacion_cm, distancia entre los centros"),
  centro_x_cm: z.number().optional().describe("fila/centrar: dónde queda el centro del grupo (por defecto 0 al centrar; en fila, el centro actual del grupo)"),
  z_cm: z.number().optional().describe("misma_linea (o fila en el piso): la z común; por defecto la de la primera"),
  altura_cm: z.number().optional().describe("misma_altura: la altura común (pared: borde de abajo; techo: cuelga; suelta: y); por defecto la de la primera"),
});

function alinear(escena: Escena, argumentos: unknown) {
  const a = AlinearSchema.parse(argumentos ?? {});
  const grupo = idsDelPedido(escena, a, a.como.includes("centrar") ? 1 : 2);
  const ids = [...grupo.ids].sort((p, q) => xDeNodo(escena, nodoDe(escena, p)) - xDeNodo(escena, nodoDe(escena, q)));
  const notas = [...grupo.notas];
  const cambios = new Map<string, Colocacion>();
  const actual = (id: string) => ({ ...nodoDe(escena, id), colocacion: cambios.get(id) ?? nodoDe(escena, id).colocacion });
  const medidas = cajas(escena, ids);

  if (a.como.includes("fila")) {
    const m = ids.map((id) => medidas.get(id)!);
    const centroActual = ids.reduce((s, id, i) => s + xDeNodo(escena, nodoDe(escena, id)) + m[i]!.corrimiento, 0) / ids.length;
    const centro = a.centro_x_cm ?? (a.como.includes("centrar") ? 0 : centroActual);
    const sep = a.separacion_cm ?? 30;
    // Centros de cada caja: entre centros fijo, o borde a borde con la separación pedida.
    const centros: number[] = [];
    if (a.entre_centros_cm !== undefined) ids.forEach((_, i) => centros.push(centro + (i - (ids.length - 1) / 2) * a.entre_centros_cm!));
    else {
      const total = m.reduce((s, x) => s + x.ancho, 0) + sep * (ids.length - 1);
      let borde = centro - total / 2;
      for (const x of m) { centros.push(borde + x.ancho / 2); borde += x.ancho + sep; }
    }
    ids.forEach((id, i) => cambios.set(id, conX(escena, actual(id), centros[i]! - m[i]!.corrimiento)));
  } else if (a.como.includes("centrar")) {
    const m = ids.map((id) => ({ id, ...medidas.get(id)!, x: xDeNodo(escena, nodoDe(escena, id)) }));
    const izq = Math.min(...m.map((x) => x.x + x.corrimiento - x.ancho / 2)), der = Math.max(...m.map((x) => x.x + x.corrimiento + x.ancho / 2));
    const delta = (a.centro_x_cm ?? 0) - (izq + der) / 2;
    for (const x of m) cambios.set(x.id, conX(escena, actual(x.id), x.x + delta));
  }

  if (a.como.includes("misma_linea") || (a.como.includes("fila") && ids.every((id) => nodoDe(escena, id).colocacion.en === "piso"))) {
    const enPiso = ids.filter((id) => actual(id).colocacion.en === "piso" || actual(id).colocacion.en === "techo" || actual(id).colocacion.en === "libre");
    const primera = enPiso.length ? actual(enPiso[0]!).colocacion : null;
    const z = a.z_cm ?? (primera && "zCm" in primera ? primera.zCm : undefined);
    if (z !== undefined) {
      if (Math.abs(z) > escena.sala.fondoCm / 2) fallar(`z_cm = ${z} se sale de la sala (va de −${r0(escena.sala.fondoCm / 2)} a ${r0(escena.sala.fondoCm / 2)}).`);
      for (const id of enPiso) { const c = actual(id).colocacion; if ("zCm" in c) cambios.set(id, { ...c, zCm: r0(z) }); }
    }
    if (enPiso.length < ids.length) notas.push("las de la pared ya están en la misma línea (pegadas a ella)");
  }

  if (a.como.includes("misma_altura")) {
    const primera = actual(ids[0]!).colocacion;
    const ref = a.altura_cm ?? (primera.en === "pared" ? primera.alturaCm : primera.en === "techo" ? primera.cuelgaCm : primera.en === "libre" ? primera.yCm : undefined);
    let tocadas = 0;
    for (const id of ids) {
      const c = actual(id).colocacion;
      if (ref === undefined) break;
      if (c.en === "pared") { cambios.set(id, { ...c, alturaCm: r0(ref) }); tocadas++; }
      else if (c.en === "techo") { cambios.set(id, { ...c, cuelgaCm: r0(ref) }); tocadas++; }
      else if (c.en === "libre") { cambios.set(id, { ...c, yCm: r0(ref) }); tocadas++; }
    }
    if (tocadas < ids.length) notas.push("las del piso ya apoyan a la misma altura; para que MIDAN lo mismo usa cambiar_pieza con alto_cm");
  }

  const nueva = reemplazarNodos(escena, cambios);
  const movidas = [...cambios.keys()].filter((id) => JSON.stringify(cambios.get(id)) !== JSON.stringify(nodoDe(escena, id).colocacion));
  return { escena: nueva, resumen: `Alineé (${a.como.join(" + ")}) ${ids.length} pieza${ids.length === 1 ? "" : "s"}; se movieron ${movidas.length}: ${describir(nueva, ids)}${notas.length ? ` (${notas.join("; ")})` : ""}.` };
}

// ----------------------------------------------------------------------------------------------------------
// distribuir
// ----------------------------------------------------------------------------------------------------------

const DistribuirSchema = z.object({
  ...PiezasSchema,
  desde_x_cm: z.number().describe("x del centro de la primera (la de más a la izquierda)"),
  hasta_x_cm: z.number().describe("x del centro de la última"),
});

function distribuir(escena: Escena, argumentos: unknown) {
  const a = DistribuirSchema.parse(argumentos ?? {});
  const grupo = idsDelPedido(escena, a, 2);
  const ids = [...grupo.ids].sort((p, q) => xDeNodo(escena, nodoDe(escena, p)) - xDeNodo(escena, nodoDe(escena, q)));
  const medidas = cajas(escena, ids);
  const desde = Math.min(a.desde_x_cm, a.hasta_x_cm), hasta = Math.max(a.desde_x_cm, a.hasta_x_cm);
  const paso = ids.length > 1 ? (hasta - desde) / (ids.length - 1) : 0;
  const cambios = new Map<string, Colocacion>();
  ids.forEach((id, i) => cambios.set(id, conX(escena, nodoDe(escena, id), desde + paso * i - medidas.get(id)!.corrimiento)));
  const nueva = reemplazarNodos(escena, cambios);
  return { escena: nueva, resumen: `Distribuí ${ids.length} piezas equidistantes de x=${r0(desde)} a x=${r0(hasta)} (cada ${r0(paso)} cm entre centros): ${describir(nueva, ids)}${grupo.notas.length ? ` (${grupo.notas.join("; ")})` : ""}.` };
}

// ----------------------------------------------------------------------------------------------------------
// espejar
// ----------------------------------------------------------------------------------------------------------

const SILUETAS = new Set<string>(SILUETAS_TRAZO.map((s) => s.id));
/** La silueta del otro lado («esquina_derecha» → «esquina_izquierda»), o ninguna si no tiene lado. */
function siluetaEspejo(s: SiluetaTrazo | undefined): SiluetaTrazo | undefined {
  if (!s) return undefined;
  const otra = s.includes("derech") ? s.replace("derech", "izquierd") : s.includes("izquierd") ? s.replace("izquierd", "derech") : s;
  return SILUETAS.has(otra) ? (otra as SiluetaTrazo) : undefined;
}

/** La misma pieza reflejada de izquierda a derecha (lo orgánico y las curvas libres; lo simétrico queda igual). */
export function espejarPieza(p: Pieza): { pieza: Pieza; reflejada: boolean } {
  if (p.tipo === "organico") {
    const opciones = {
      ...p.opciones,
      tramos: p.opciones.tramos.map((t) => ({ ...t, recorrido: t.recorrido.map((v) => ({ ...v, x: -v.x })) })),
      ...(p.opciones.obstaculos ? { obstaculos: p.opciones.obstaculos.map((o) => ({ ...o, base: { ...o.base, x: -o.base.x } })) } : {}),
      ...(p.opciones.vista ? { vista: { ...p.opciones.vista, x: -p.opciones.vista.x } } : {}),
    };
    const generador = p.generador?.tipo === "trazo"
      ? { tipo: "trazo" as const, trazo: { ...p.generador.trazo, puntos: p.generador.trazo.puntos.map((q) => ({ ...q, x: -q.x })), silueta: siluetaEspejo(p.generador.trazo.silueta) } }
      : p.generador;
    return { pieza: { ...p, opciones, ...(generador ? { generador } : {}) }, reflejada: true };
  }
  if (p.tipo === "guirnalda" && p.guirnalda.recorrido) return { pieza: { ...p, guirnalda: { ...p.guirnalda, recorrido: p.guirnalda.recorrido.map((q) => ({ ...q, x: -q.x })) } }, reflejada: true };
  const simetricas: readonly Pieza["tipo"][] = ["columna", "arco", "arco_organico", "guirnalda", "pared_malla", "pared_trenzas", "globo"];
  return { pieza: structuredClone(p), reflejada: simetricas.includes(p.tipo) };
}

/** La colocación reflejada respecto de x = eje (en el piso, techo, suelta o la pared del fondo; las laterales se cambian). */
function colocacionEspejo(escena: Escena, n: NodoEscena, eje: number): Colocacion {
  const c = n.colocacion;
  const giro = (g: number) => (g === 0 ? 0 : -g);
  if (c.en === "piso" || c.en === "techo" || c.en === "libre") return conX(escena, { ...n, colocacion: { ...c, giroGrados: giro(c.giroGrados) } }, 2 * eje - c.xCm);
  if (c.en === "pared" && c.pared === "fondo") return conX(escena, n, 2 * eje - c.aLoLargoCm);
  if (c.en === "pared") {
    if (Math.abs(eje) > 1) fallar(`«${n.nombre}» está en la pared ${c.pared}: solo se refleja respecto del centro de la sala.`);
    // Visto desde el salón, la derecha de la pared izquierda va hacia el fondo y la de la derecha hacia el frente.
    return { ...c, pared: c.pared === "izquierda" ? "derecha" : "izquierda", aLoLargoCm: -c.aLoLargoCm };
  }
  return fallar(`«${n.nombre}» va ${c.en === "ancla" ? "colgada de" : "sobre"} «${c.padreId}»: espeja su estructura (sus decoraciones van con ella) o usa poner_sobre/mover_sobre.`);
}

const EspejarSchema = z.object({
  id: z.string().min(1).max(80).describe("la pieza que se copia al otro lado"),
  respecto_id: z.string().min(1).max(80).optional().describe("reflejar respecto del centro de esta otra pieza (p. ej. el arco); por defecto, el centro de la sala (x = 0)"),
  eje_x_cm: z.number().optional().describe("en vez de respecto_id: la x del eje de simetría"),
  nombre: z.string().min(1).max(60).optional().describe("nombre de la copia (por defecto cambia izquierda ↔ derecha en el nombre)"),
  con_decoraciones: z.boolean().optional().describe("true (por defecto): también copia lo que cuelga de ella o va sobre ella, reflejado"),
});

/** El id del otro lado: «columna-izq» → «columna-der» (si está ocupado, idNuevo le suma un número). */
const idEspejo = (id: string) => {
  const m = id.match(/^(.*-)(izq|izquierda|der|derecha)$/);
  if (!m) return id.replace(/-\d+$/, "");
  const otro: Readonly<Record<string, string>> = { izq: "der", der: "izq", izquierda: "derecha", derecha: "izquierda" };
  return `${m[1]}${otro[m[2]!]}`;
};

const nombreEspejo = (nombre: string) => {
  const cambio = nombre.replace(/izquierd([oa])/gi, "§$1").replace(/derech([oa])/gi, "izquierd$1").replace(/§([oa])/g, "derech$1");
  return cambio !== nombre ? cambio : `${nombre} (espejo)`;
};

function espejar(escena: Escena, argumentos: unknown) {
  const a = EspejarSchema.parse(argumentos ?? {});
  const original = nodoDe(escena, a.id);
  const eje = a.respecto_id ? xDeNodo(escena, nodoDe(escena, a.respecto_id)) : a.eje_x_cm ?? 0;
  const xOriginal = xDeNodo(escena, original);
  if (Math.abs(xOriginal - eje) < 5) fallar(`«${original.nombre}» está sobre el eje (x = ${r0(xOriginal)}): su espejo caería encima. Muévela a un lado o usa duplicar_pieza.`);
  const colocacion = colocacionEspejo(escena, original, eje);
  const { pieza, reflejada } = espejarPieza(original.pieza);
  const id = idNuevo(escena, idEspejo(original.id));
  const raiz: NodoEscena = { id, nombre: a.nombre ?? nombreEspejo(original.nombre), pieza, colocacion };
  let nodos = [...escena.nodos, raiz];
  const copiadas: string[] = [];
  if (a.con_decoraciones !== false) {
    const hijos = [...descendientes(escena, original.id)].filter((x) => x !== original.id);
    const nuevoId = new Map<string, string>([[original.id, id]]);
    for (const hijoId of hijos) {
      const nuevo = idNuevo({ ...escena, nodos }, hijoId.replace(/-\d+$/, ""));
      nuevoId.set(hijoId, nuevo);
      nodos = [...nodos, { ...nodoDe(escena, hijoId), id: nuevo }];
    }
    // Cada hija cuelga ahora de la copia (o de la copia de su padre), reflejada en el espacio de su padre.
    const deHija = new Map([...nuevoId].map(([viejo, nuevo]) => [nuevo, viejo]));
    nodos = nodos.map((n) => {
      const viejo = n.id === id ? undefined : deHija.get(n.id);
      if (!viejo) return n;
      const o = nodoDe(escena, viejo), c = o.colocacion;
      const comun = { pieza: espejarPieza(o.pieza).pieza, nombre: nombreEspejo(o.nombre) };
      if (c.en === "sobre") return { ...n, ...comun, colocacion: { ...c, padreId: nuevoId.get(c.padreId) ?? c.padreId, puntoCm: { ...c.puntoCm, x: -c.puntoCm.x }, normal: { ...c.normal, x: -c.normal.x }, giroGrados: c.giroGrados === 0 ? 0 : -c.giroGrados } };
      if (c.en === "ancla") return { ...n, ...comun, colocacion: { ...c, padreId: nuevoId.get(c.padreId) ?? c.padreId } };
      return n;
    });
    copiadas.push(...hijos.map((h) => nuevoId.get(h)!));
  }
  const nueva: Escena = { ...escena, nodos };
  const nota = reflejada ? "" : " (esta pieza no se refleja por dentro: sale igual, solo cambia de lado)";
  const deco = copiadas.length ? ` Con sus decoraciones reflejadas: ${copiadas.join(", ")}.` : "";
  return { escena: nueva, resumen: `Puse «${raiz.nombre}» (id ${id}), espejo de «${original.nombre}» respecto de x=${r0(eje)}: x=${r0(xDeNodo(nueva, raiz))} (la original está en x=${r0(xOriginal)})${nota}.${deco}` };
}

export const HERRAMIENTAS_DISPOSICION: Readonly<Record<string, HerramientaExtra>> = {
  alinear: {
    esquema: AlinearSchema,
    descripcion: "Alinea varias piezas (por ids o grupo en palabras): en fila de izquierda a derecha con separación de borde a borde o entre centros, a la misma altura (pared/techo), en la misma línea (misma z) o centradas a lo ancho. Para «alinea bien las palmeras», «las columnas en fila con 1 m entre ellas», «centra el arco».",
    aplicar: alinear,
  },
  distribuir: {
    esquema: DistribuirSchema,
    descripcion: "Reparte varias piezas equidistantes entre dos x (de la primera a la última, por su centro), en su orden de izquierda a derecha. Para «las flores del techo parejas de −2 m a 2 m».",
    aplicar: distribuir,
  },
  espejar: {
    esquema: EspejarSchema,
    descripcion: "Copia una pieza al otro lado, simétrica respecto del centro de la sala o de otra pieza (respecto_id, p. ej. el arco), con sus decoraciones; lo orgánico sale reflejado (inclinada a la derecha → a la izquierda). Para «la misma columna al otro lado», «una igual a la derecha del arco».",
    aplicar: espejar,
  },
};
