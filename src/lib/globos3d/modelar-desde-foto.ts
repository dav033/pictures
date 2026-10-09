import { decidir } from "@/lib/registro/servidor";
import { compilarLectura } from "./compilar-lectura";
import { detectarGlobos, type Deteccion } from "./detectar-globos-ia";
import { medirConDetecciones } from "./medir-con-detecciones";
import { idNuevo, type Escena, type NodoEscena } from "./escena";
import type { LecturaFoto, PiezaLeida } from "./lectura-foto";
import { leerFotoConIA, type FotoLectura, type OpcionesLectura, type ResultadoLectura, type UsoModelo } from "./leer-foto-ia";

/**
 * **Foto → escena** (REQ-001 pasos 7 y 8), sin HTTP: lee la foto con Gemini (`leer-foto-ia.ts`), busca en paralelo las
 * plantillas de la biblioteca que más se le parecen (si hay con qué: una función inyectada) y compila la lectura a una
 * `Escena` con los generadores del taller (`compilar-lectura.ts`, sin modelo). Lo usan `/api/escena-desde-foto` y
 * `/api/escena-ia` (cuando el pedido trae una foto adjunta). Todo es inyectable: las pruebas corren sin red.
 */

/** Una plantilla de la biblioteca parecida a la foto; `parecido` es la similitud coseno de las imágenes (0 a 1) o null si no se midió. */
export type Plantilla = { id: string; nombre: string; parecido: number | null };

export type Modelado = {
  escena: Escena;
  lectura: LecturaFoto;
  notas: string[];
  /** Lo que no se pudo armar: piezas «otro» (no son del taller) y piezas que fallaron al compilar. */
  omitidas: string[];
  /** Piezas que el modelo escribió mal aun tras el reintento. */
  descartadas: string[];
  plantillas: Plantilla[];
  /** Avisos del camino (la búsqueda de plantillas falló…). */
  avisos: string[];
  uso: UsoModelo & { costeEstimadoUsd: number; intentos: number; modelo: string };
};

export type DependenciasModelado = {
  /**
   * La detección de los globos y fondos uno por uno (por defecto `detectarGlobos`, en paralelo con la lectura); con ella la
   * lectura se mide (`medir-con-detecciones.ts`). `null` = sin detección (la lectura queda como la escribió el modelo). Si se
   * inyecta `leer` (las pruebas, sin red) y no se dice nada, tampoco hay detección: no se llama a la IA por la puerta de atrás.
   */
  detectar?: ((foto: FotoLectura) => Promise<Deteccion>) | null;
  /** Por defecto `leerFotoConIA`. */
  leer?: (foto: FotoLectura, opciones: OpcionesLectura) => Promise<ResultadoLectura>;
  /** Plantillas parecidas (la búsqueda por imagen de la biblioteca); sin ella no hay plantillas. */
  plantillas?: (foto: FotoLectura) => Promise<Plantilla[]>;
  opciones?: OpcionesLectura;
};

/** Lee, busca plantillas y compila. Lanza `ErrorLecturaFoto` si la IA no pudo leer la foto; una búsqueda que falla solo deja un aviso. */
export async function modelarDesdeFoto(foto: FotoLectura, deps: DependenciasModelado = {}): Promise<Modelado> {
  const avisos: string[] = [];
  const buscar = deps.plantillas
    ? deps.plantillas(foto).catch((error: unknown): Plantilla[] => { avisos.push(`No se pudo buscar plantillas en la biblioteca: ${error instanceof Error ? error.message : String(error)}`); return []; })
    : Promise.resolve<Plantilla[]>([]);
  const detectar = deps.detectar !== undefined ? deps.detectar : deps.leer || deps.opciones?.generar ? null : (f: FotoLectura) => detectarGlobos(f, { signal: deps.opciones?.signal, superficie: deps.opciones?.superficie });
  const detectando = detectar
    ? detectar(foto).catch((error: unknown): null => { avisos.push(`No se pudieron detectar los globos uno por uno (la lectura va sin medir): ${error instanceof Error ? error.message : String(error)}`); return null; })
    : Promise.resolve(null);
  const [leida, plantillas, deteccion] = await Promise.all([(deps.leer ?? leerFotoConIA)(foto, deps.opciones ?? {}), buscar, detectando]);
  const medida = deteccion ? medirConDetecciones(leida.lectura, deteccion.globos, deteccion.fondos) : { lectura: leida.lectura, notas: [] };
  if (deteccion) decidir("regla:foto_medida_con_detecciones", "la lectura de la foto medida con los globos y fondos detectados", { globos: deteccion.globos.length, fondos: deteccion.fondos.length, notas: medida.notas.length, escalaLeidaCm: leida.lectura.escala.altoImagenCm, escalaMedidaCm: medida.lectura.escala.altoImagenCm });
  const compilada = compilarLectura(medida.lectura);
  return {
    escena: compilada.escena, lectura: medida.lectura, notas: [...medida.notas, ...compilada.notas], omitidas: compilada.omitidas, descartadas: leida.descartadas, plantillas, avisos,
    uso: {
      entrada: leida.uso.entrada + (deteccion?.uso.entrada ?? 0), salida: leida.uso.salida + (deteccion?.uso.salida ?? 0), pensamiento: leida.uso.pensamiento + (deteccion?.uso.pensamiento ?? 0),
      costeEstimadoUsd: Math.round((leida.costeEstimadoUsd + (deteccion?.costeEstimadoUsd ?? 0)) * 1e5) / 1e5, intentos: leida.intentos, modelo: leida.modelo,
    },
  };
}

// ----------------------------------------------------------------------------------------------------------
// Aplicar el resultado a la escena del taller
// ----------------------------------------------------------------------------------------------------------

export type ModoModelado = "reemplazar" | "sumar";

/**
 * La escena compilada de la foto aplicada a la que hay: `reemplazar` deja solo lo de la foto (con la sala de la foto);
 * `sumar` agrega sus piezas a las que hay (ids nuevos, la sala de ahora). Devuelve `null` si pasaría de `maxNodos`.
 */
export function combinarEscenaDeFoto(actual: Escena, compilada: Escena, modo: ModoModelado, maxNodos: number): Escena | null {
  if (modo === "reemplazar") return compilada.nodos.length <= maxNodos ? compilada : null;
  if (actual.nodos.length + compilada.nodos.length > maxNodos) return null;
  const nuevos = new Map<string, string>();
  let acumulada: Escena = actual;
  for (const nodo of compilada.nodos) {
    const id = idNuevo(acumulada, nodo.id);
    nuevos.set(nodo.id, id);
    acumulada = { ...acumulada, nodos: [...acumulada.nodos, { ...nodo, id }] };
  }
  // Lo que colgaba de otra pieza de la foto sigue colgando de ella con su id nuevo.
  const propios = new Set(nuevos.values());
  const reasignar = (n: NodoEscena): NodoEscena => (propios.has(n.id) && (n.colocacion.en === "ancla" || n.colocacion.en === "sobre") ? { ...n, colocacion: { ...n.colocacion, padreId: nuevos.get(n.colocacion.padreId) ?? n.colocacion.padreId } } : n);
  return { ...acumulada, nodos: acumulada.nodos.map(reasignar) };
}

// ----------------------------------------------------------------------------------------------------------
// Lo que ve el agente de escena
// ----------------------------------------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

function coloresDe(p: PiezaLeida): string {
  return "colores" in p ? p.colores.map((c) => `${c.nombre}${c.acabado !== "mate" && c.acabado !== "brillante" ? ` ${c.acabado}` : ""} ${Math.round(c.peso)}%`).join(", ") : "";
}

/** El tipo de pieza que falta en un `switch`: si se agrega una pieza a la lectura, esto no compila hasta que se cuente aquí. */
function exhaustivo(p: never): never {
  throw new Error(`Pieza leída sin línea para el agente: ${JSON.stringify(p)}`);
}

/** Una línea por pieza leída: tipo, lo que la distingue y sus colores. */
export function lineaDePiezaLeida(p: PiezaLeida, i: number, altoImagenCm: number): string {
  const cm = (f: number) => `${Math.round(f * altoImagenCm)} cm`;
  const detalle = (() => {
    switch (p.tipo) {
      case "guirnalda_organica": return `${p.puntos.length} puntos, grosor medio ${cm(p.puntos.reduce((s, q) => s + q.grosor, 0) / p.puntos.length)}${p.follaje?.length ? `, follaje: ${p.follaje.join(", ")}` : ""}`;
      case "columna_organica": return `forma ${p.forma}, alto ${cm(Math.abs(p.yBase - p.yArriba))}`;
      case "racimo_piso": return `montón de piso de ${cm(p.ancho)} de ancho y ${cm(Math.abs(p.yPie - p.yArriba))} de alto`;
      case "columna_clasica": return `alto ${cm(Math.abs(p.yBase - p.yArriba))}`;
      case "guirnalda_clasica": return `largo ${cm(Math.abs(p.x2 - p.x1))}`;
      case "globo": return `${cm(p.diametro)} de diámetro, ${p.en}`;
      case "ramo_helio": return `${p.cantidad} globos`;
      case "decoracion": return `${p.id} ×${p.cantidad}`;
      case "metalizado": return `«${p.texto}»${p.cursiva ? " cursiva" : ""}`;
      case "fondo": return `${p.id}${p.cantidad && p.cantidad > 1 ? ` ×${p.cantidad}` : ""}${p.texto ? ` «${p.texto}»${p.colorTexto ? ` en ${p.colorTexto}` : ""}${p.acabadoTexto ? ` (${p.acabadoTexto})` : ""}` : ""}`;
      case "otro": return p.descripcion;
      default: return exhaustivo(p);
    }
  })();
  const colores = coloresDe(p);
  return `${i + 1}) ${p.tipo}: ${detalle}${colores ? ` · ${colores}` : ""}`;
}

/**
 * El resumen que lee el modelo del agente: qué dice la lectura, qué se armó, qué no, y las plantillas de la biblioteca
 * más parecidas (con su id, para `insertar_de_biblioteca`). `estado` dice si la escena ya se armó o falta llamar la herramienta.
 */
export function resumenParaAgente(m: Modelado, estado: string): string {
  const l = m.lectura;
  const lineas = [
    `[Foto adjunta, leída por la IA de visión. Resumen: ${l.resumen} Escala: la foto mide ${Math.round(l.escala.altoImagenCm)} cm de alto (${l.escala.referencia}).`,
    `Piezas leídas (${l.piezas.length}):`,
    ...l.piezas.map((p, i) => lineaDePiezaLeida(p, i, l.escala.altoImagenCm)),
  ];
  if (m.omitidas.length) lineas.push(`No se arman (no son del taller o fallaron): ${m.omitidas.join(" | ")}`);
  if (m.descartadas.length) lineas.push(`Piezas de la lectura descartadas por mal formato: ${m.descartadas.join(" | ")}`);
  if (m.notas.length) lineas.push(`Notas: ${m.notas.join(" | ")}`);
  lineas.push(m.plantillas.length
    ? `Plantillas de la biblioteca más parecidas a la foto (parecido 0 a 1; sobre 0,9 es casi la misma decoración):\n${m.plantillas.map((p) => `- ${p.id} «${p.nombre}»${p.parecido === null ? "" : ` (parecido ${r2(p.parecido)})`}`).join("\n")}`
    : "No hay plantillas de la biblioteca para esta foto.");
  lineas.push(`Estado: ${estado}]`);
  return lineas.join("\n");
}
