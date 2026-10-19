import { ANGULOS_ESTANDAR, type VistaEstandar } from "@/components/tres-d/camara-estandar-datos";
import type { ArmadaCompactaV1 } from "./armada-compacta";

/**
 * **La vista de reserva del plan 3D**: la armada compacta proyectada a un SVG, sin WebGL ni three.js. La usa el cliente
 * cuando el navegador no tiene WebGL, se quedó sin memoria o perdió el contexto (REQ-007, fase 3), y la hace el servidor
 * (`/api/guiada/motor/armada`, `salida: "svg"`), así que la receta del motor sigue sin salir de él.
 *
 * Es una proyección ortogonal con los mismos ángulos que la cámara estándar del visor (`frente` y `tres-cuartos`):
 * discos con un degradado que imita el volumen del globo, ordenados del fondo al frente. Cada globo es UN `<circle
 * data-c="índice de paleta">`: el número de círculos de un color es el de globos de ese color, que es lo que cuenta la
 * lista de materiales. Los tubitos van como `<polyline data-t>` y las flores artificiales como `<circle data-f>`, así que
 * no se confunden con los globos.
 */
export type OpcionesVistaSvg = {
  vista?: VistaEstandar;
  /** Solo esta pieza, encuadrada por su caja (la miniatura de su fila). Sin ella, toda la decoración. */
  pieza?: string;
  /** Lado del cuadrado, en px (el SVG escala). */
  lado?: number;
  /** Texto accesible. */
  titulo?: string;
};

const FONDO = "#e6e6e9";
const OCUPACION = 0.74;
const LADO_POR_DEFECTO = 768;

type Dibujable =
  | { tipo: "globo"; profundidad: number; x: number; y: number; r: number; color: number }
  | { tipo: "flor"; profundidad: number; x: number; y: number; r: number; color: number }
  | { tipo: "tubo"; profundidad: number; puntos: ReadonlyArray<readonly [number, number]>; grosor: number; color: number };

const redondear = (n: number): number => Math.round(n * 10) / 10;

function mezclar(hex: string, hacia: number, cantidad: number): string {
  const canal = (inicio: number) => {
    const valor = Number.parseInt(hex.slice(inicio, inicio + 2), 16);
    return Math.max(0, Math.min(255, Math.round(valor + (hacia - valor) * cantidad)));
  };
  return `#${[1, 3, 5].map((i) => canal(i).toString(16).padStart(2, "0")).join("")}`;
}

const aclarar = (hex: string, cantidad: number) => mezclar(hex, 255, cantidad);
const oscurecer = (hex: string, cantidad: number) => mezclar(hex, 0, cantidad);

function escaparXml(texto: string): string {
  return texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function ejesDe(vista: VistaEstandar) {
  const { giro, elevacion } = ANGULOS_ESTANDAR[vista];
  const g = (giro * Math.PI) / 180, e = (elevacion * Math.PI) / 180;
  const direccion = [Math.sin(g) * Math.cos(e), Math.sin(e), Math.cos(g) * Math.cos(e)] as const;
  const derecha = [Math.cos(g), 0, -Math.sin(g)] as const;
  const arriba = [-Math.sin(e) * Math.sin(g), Math.cos(e), -Math.sin(e) * Math.cos(g)] as const;
  return { direccion, derecha, arriba };
}

const punto = (a: readonly [number, number, number], x: number, y: number, z: number): number => a[0] * x + a[1] * y + a[2] * z;

function dibujablesDe(armada: ArmadaCompactaV1, pieza: string | undefined, vista: VistaEstandar): Dibujable[] {
  const { direccion, derecha, arriba } = ejesDe(vista);
  const tramo = pieza ? armada.piezas.find((p) => p.id === pieza) : undefined;
  if (pieza && !tramo) return [];
  const globos: [number, number] = tramo ? tramo.globos : [0, armada.globos.length / 5];
  const flores: [number, number] = tramo ? tramo.flores : [0, armada.flores.length / 5];
  const tubos: [number, number] = tramo ? tramo.tubos : [0, armada.tubos.length];
  const salida: Dibujable[] = [];
  const proyectar = (x: number, y: number, z: number) => ({ x: punto(derecha, x, y, z), y: -punto(arriba, x, y, z), profundidad: punto(direccion, x, y, z) });
  for (let i = globos[0]; i < globos[0] + globos[1]; i++) {
    const [x, y, z, diametro, color] = armada.globos.slice(i * 5, i * 5 + 5) as [number, number, number, number, number];
    salida.push({ tipo: "globo", ...proyectar(x, y, z), r: diametro / 2, color });
  }
  for (let i = flores[0]; i < flores[0] + flores[1]; i++) {
    const [x, y, z, diametro, color] = armada.flores.slice(i * 5, i * 5 + 5) as [number, number, number, number, number];
    salida.push({ tipo: "flor", ...proyectar(x, y, z), r: diametro / 2, color });
  }
  for (const tubo of armada.tubos.slice(tubos[0], tubos[0] + tubos[1])) {
    const puntos: Array<readonly [number, number]> = [];
    let suma = 0;
    for (let i = 0; i + 2 < tubo.puntos.length; i += 3) {
      const p = proyectar(tubo.puntos[i]!, tubo.puntos[i + 1]!, tubo.puntos[i + 2]!);
      puntos.push([p.x, p.y]);
      suma += p.profundidad;
    }
    if (puntos.length) salida.push({ tipo: "tubo", profundidad: suma / puntos.length, puntos, grosor: tubo.grosorCm, color: tubo.color });
  }
  // Del fondo al frente: lo que está más cerca de la cámara (mayor profundidad) se pinta al final. `sort` es estable.
  return salida.sort((a, b) => a.profundidad - b.profundidad);
}

function encuadre(dibujables: readonly Dibujable[]): { x: number; y: number; lado: number; abajo: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const abarcar = (x: number, y: number, r: number) => { minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r); };
  for (const d of dibujables) {
    if (d.tipo === "tubo") for (const [x, y] of d.puntos) abarcar(x, y, d.grosor / 2);
    else abarcar(d.x, d.y, d.r);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, lado: 100, abajo: 0 };
  const lado = Math.max(maxX - minX, maxY - minY, 10) / OCUPACION;
  return { x: (minX + maxX) / 2 - lado / 2, y: (minY + maxY) / 2 - lado / 2, lado, abajo: maxY };
}

function degradado(indice: number, hex: string): string {
  return `<radialGradient id="g${indice}" cx="0.36" cy="0.3" r="0.78"><stop offset="0" stop-color="${aclarar(hex, 0.5)}"/><stop offset="0.3" stop-color="${aclarar(hex, 0.14)}"/><stop offset="0.72" stop-color="${hex}"/><stop offset="1" stop-color="${oscurecer(hex, 0.32)}"/></radialGradient>`;
}

export function svgDeArmada(armada: ArmadaCompactaV1, opciones: OpcionesVistaSvg = {}): string {
  const { vista = "frente", pieza, lado = LADO_POR_DEFECTO, titulo = "Vista del plan" } = opciones;
  const dibujables = dibujablesDe(armada, pieza, vista);
  const marco = encuadre(dibujables);
  const usados = [...new Set(dibujables.flatMap((d) => (d.tipo === "globo" ? [d.color] : [])))].sort((a, b) => a - b);
  const defs = usados.map((i) => degradado(i, armada.paleta[i] ?? "#9ca3af")).join("");
  const cuerpo = dibujables.map((d) => {
    if (d.tipo === "globo") return `<circle data-c="${d.color}" cx="${redondear(d.x)}" cy="${redondear(d.y)}" r="${redondear(d.r)}" fill="url(#g${d.color})" stroke="#00000024" stroke-width="${redondear(Math.max(d.r * 0.012, 0.2))}"/>`;
    if (d.tipo === "flor") return `<circle data-f="${d.color}" cx="${redondear(d.x)}" cy="${redondear(d.y)}" r="${redondear(d.r)}" fill="${armada.paleta[d.color] ?? "#9ca3af"}" stroke="#00000033" stroke-width="${redondear(Math.max(d.r * 0.04, 0.2))}"/>`;
    return `<polyline data-t="${d.color}" points="${d.puntos.map(([x, y]) => `${redondear(x)},${redondear(y)}`).join(" ")}" fill="none" stroke="${armada.paleta[d.color] ?? "#9ca3af"}" stroke-width="${redondear(Math.max(d.grosor, 1))}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  // Una sombra suave bajo la decoración: la asienta en el cuadro sin inventar un piso.
  const sombra = dibujables.length ? `<ellipse cx="${redondear(marco.x + marco.lado / 2)}" cy="${redondear(marco.abajo)}" rx="${redondear(marco.lado * 0.28)}" ry="${redondear(marco.lado * 0.025)}" fill="#000" opacity="0.08"/>` : "";
  const caja = `${redondear(marco.x)} ${redondear(marco.y)} ${redondear(marco.lado)} ${redondear(marco.lado)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caja}" width="${lado}" height="${lado}" role="img" aria-label="${escaparXml(titulo)}"><title>${escaparXml(titulo)}</title><defs>${defs}</defs><rect x="${redondear(marco.x)}" y="${redondear(marco.y)}" width="${redondear(marco.lado)}" height="${redondear(marco.lado)}" fill="${FONDO}"/>${sombra}${cuerpo}</svg>`;
}
