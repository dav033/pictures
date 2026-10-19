import { z } from "zod";
import type { Escena, NodoEscena } from "./escena";
import { cajaDeCentros, indicesDentroDelDibujo, type DibujoRepinte } from "./dibujo-repinte";
import { CONTORNOS_PREDEFINIDOS, regionDeContorno, type ContornoForma, type ContornoPredefinido } from "./formas";
import { fallar, nombreColor, resolverColorFlexible } from "./herramientas-escena-colores";
import { NOMBRE_TIPO } from "./herramientas-escena-estructuras";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { centroDe, componerTexto, normalizarTexto } from "./letras";
import { armarPieza, type Pieza } from "./piezas";
import type { Repinte } from "./repintes";

/**
 * **pintar_en_malla**: una letra, un número o una figura pintado DENTRO de una pared de globos («pinta la letra W de la
 * malla», «un corazón rojo en la pared», «el número 5 en negro»): los globos que caen dentro del dibujo toman otro color
 * y el resto de la pared se queda como estaba. Sirve para la malla de Link-O-Loon, la pared de trenzas y el mural.
 * Va como un repinte con `dibujo` (ver `dibujo-repinte.ts`): se guarda la definición, no los globos. El esqueleto de
 * las letras y las figuras son los de `letras.ts` y `formas.ts`.
 */

const TIPOS_PARED = ["pared_malla", "pared_trenzas", "mural"] as const;
const FIGURAS = CONTORNOS_PREDEFINIDOS.map((c) => c.id) as [ContornoPredefinido, ...ContornoPredefinido[]];

const PintarSchema = z.object({
  id: z.string().min(1).max(80).describe("id de la pared (malla de Link-O-Loon, pared de trenzas o mural)"),
  texto: z.string().min(1).max(12).optional().describe("la letra, el número o la palabra que se pinta («W», «5», «ANA»); una de texto o figura"),
  figura: z.enum(FIGURAS).optional().describe("en vez de texto, una figura: corazon, estrella, circulo, aro, ancla, cruz, nube, castillo"),
  color: z.string().min(1).max(60).optional().describe("color del dibujo (nombre o código); obligatorio salvo con quitar"),
  alto_cm: z.number().min(20).max(600).optional().describe("alto del dibujo (cm); por defecto, un 60 % del alto de la pared (menos si el texto no cabe a lo ancho)"),
  grosor_cm: z.number().min(5).max(200).optional().describe("grosor del trazo de las letras (cm); por defecto, lo que se lea con los globos de esa pared"),
  x_pct: z.number().min(0).max(100).optional().describe("centro del dibujo, % del ancho desde la izquierda (50 = al medio)"),
  y_pct: z.number().min(0).max(100).optional().describe("centro del dibujo, % del alto desde abajo (50 = al medio)"),
  quitar: z.boolean().optional().describe("true: borrar todo lo pintado con esta herramienta en la pared (vuelve a su color)"),
});

const r0 = (n: number) => Math.round(n);

/** Distancia típica entre globos vecinos (mediana de la más cercana de cada uno): cuánto «pixel» da la pared. */
function pasoDe(centros: readonly { x: number; y: number }[]): number {
  const cercanas = centros.slice(0, 400).map((a, i) => centros.reduce((m, b, j) => (i === j ? m : Math.min(m, Math.hypot(a.x - b.x, a.y - b.y))), Infinity)).filter(Number.isFinite).sort((x, y) => x - y);
  return cercanas[Math.floor(cercanas.length / 2)] ?? 10;
}

const esDibujo = (r: Repinte) => r.dibujo !== undefined;

function aplicar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = PintarSchema.parse(argumentos ?? {});
  const nodo = escena.nodos.find((n) => n.id === a.id) ?? fallar(`No hay ninguna pieza con id «${a.id}». Ids: ${escena.nodos.map((n) => n.id).join(", ") || "(la sala está vacía)"}.`);
  if (!(TIPOS_PARED as readonly string[]).includes(nodo.pieza.tipo)) fallar(`«${nodo.nombre}» es ${NOMBRE_TIPO[nodo.pieza.tipo]}: pintar_en_malla es para paredes de globos (malla de Link-O-Loon, pared de trenzas o mural).`);
  const conPieza = (pieza: Pieza): Escena => ({ ...escena, nodos: escena.nodos.map((n): NodoEscena => (n.id === nodo.id ? { ...n, pieza } : n)) });

  if (a.quitar) {
    const previos = nodo.pieza.repintes ?? [];
    const quedan = previos.filter((r) => !esDibujo(r));
    if (quedan.length === previos.length) return { escena, resumen: `«${nodo.nombre}» (${nodo.id}) no tenía ningún dibujo pintado: no cambió nada.` };
    const { repintes: _fuera, ...resto } = nodo.pieza;
    return { escena: conPieza((quedan.length ? { ...resto, repintes: quedan } : resto) as Pieza), resumen: `Borré el dibujo pintado en «${nodo.nombre}» (${nodo.id}): la pared vuelve a su color.` };
  }
  if ((a.texto === undefined) === (a.figura === undefined)) fallar("Pasa texto (una letra, un número o una palabra) o figura, uno de los dos.");
  const colorPedido = a.color ?? fallar("Falta color: ¿de qué color se pinta el dibujo?");

  // Los globos que se pintan: los de la malla sin sus uniones R-5 (la pareja de amarre queda como estaba).
  const armada = armarPieza(nodo.pieza);
  const caja = cajaDeCentros(armada.globos);
  const anchoPared = caja.maxX - caja.minX, altoPared = caja.maxY - caja.minY;
  const esMalla = nodo.pieza.tipo === "pared_malla";
  const candidatos = armada.globos.filter((g) => !esMalla || g.parte === "malla");
  if (candidatos.length < 4) fallar(`«${nodo.nombre}» tiene muy pocos globos para pintar un dibujo.`);
  const paso = pasoDe(candidatos.map(centroDe));
  const notas: string[] = [];
  const codigo = resolverColorFlexible(colorPedido, [...new Set(candidatos.map((g) => g.formatoId))], notas);

  let contorno: ContornoForma;
  let alto = a.alto_cm ?? altoPared * 0.6;
  let nombreDibujo: string;
  let grosor = 0;
  if (a.texto !== undefined) {
    const texto = normalizarTexto(a.texto);
    if (!componerTexto(texto, { altoCm: 10, separacionCm: 1, disposicion: "fila" }).trazos.length) fallar(`No sé dibujar «${a.texto}»: usa letras, números o espacios.`);
    const medida = componerTexto(texto, { altoCm: alto, separacionCm: alto * 0.15, disposicion: "fila" });
    if (a.alto_cm === undefined && medida.anchoCm > anchoPared * 0.9) alto = Math.max(20, alto * ((anchoPared * 0.9) / medida.anchoCm));
    grosor = a.grosor_cm ?? Math.max(alto * 0.2, paso * 1.1);
    contorno = { tipo: "texto", texto, altoCm: r0(alto), grosorCm: r0(grosor) };
    nombreDibujo = `«${texto}»`;
  } else {
    const ancho = alto * (a.figura === "cruz" || a.figura === "castillo" ? 0.8 : 1);
    contorno = { tipo: "predefinido", id: a.figura!, anchoCm: r0(ancho), altoCm: r0(alto) };
    nombreDibujo = CONTORNOS_PREDEFINIDOS.find((c) => c.id === a.figura)!.nombre.toLowerCase();
  }
  const dibujo: DibujoRepinte = { contorno, fx: (a.x_pct ?? 50) / 100, fy: (a.y_pct ?? 50) / 100, holguraCm: r0(paso * 0.3) };
  const regla: Repinte = { ...(esMalla ? { partes: ["malla"] } : {}), codigo, dibujo };

  const dentro = indicesDentroDelDibujo(dibujo, armada.globos, caja);
  const pintados = [...dentro].filter((i) => candidatos.includes(armada.globos[i]!)).length;
  const medidas = regionDeContorno(contorno).caja;
  const dim = `${r0(medidas.maxX - medidas.minX)}×${r0(medidas.maxY - medidas.minY)} cm${grosor ? `, trazo de ${r0(grosor)} cm` : ""}`;
  if (pintados < 4) fallar(`El dibujo es muy chico para esta pared: solo ${pintados} globos caen dentro (el dibujo mide ${dim}). Sube alto_cm (la pared mide ${r0(anchoPared)}×${r0(altoPared)} cm entre centros) o usa una letra o figura más sencilla.`);
  const aviso = pintados < 12 ? " Son pocos globos: se leerá apenas; sube alto_cm si hace falta." : "";
  const nueva = { ...nodo.pieza, repintes: [...(nodo.pieza.repintes ?? []), regla] } as Pieza;
  return {
    escena: conPieza(nueva),
    resumen: `Pinté ${nombreDibujo} (${dim}) en ${nombreColor(codigo)} dentro de «${nodo.nombre}» (${nodo.id}): ${pintados} de ${candidatos.length} globos${esMalla ? " de la malla (las uniones quedan igual)" : ""} cambian de color; el resto de la pared sigue igual.${aviso} ${[...new Set(notas)].join(" ")}`.trim(),
  };
}

export const HERRAMIENTAS_PINTAR: Readonly<Record<string, HerramientaExtra>> = {
  pintar_en_malla: {
    esquema: PintarSchema,
    descripcion: "Pinta una letra, un número, una palabra corta o una figura (corazón, estrella…) DENTRO de una pared de globos: los globos que caen dentro del dibujo toman otro color y el resto no cambia. Para la malla de Link-O-Loon, la pared de trenzas o el mural. «pinta la letra W de la malla», «un corazón rojo en la pared», «el 5 en negro arriba a la derecha». quitar: true borra el dibujo. NO crea una pieza de letras aparte (para eso, agregar_pieza tipo letras).",
    aplicar,
  },
};
