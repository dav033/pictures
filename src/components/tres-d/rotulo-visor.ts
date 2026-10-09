import * as THREE from "three";
import type { RotuloEscenografia, SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { cajaDeTinta, contornosDeMascara, type Mascara } from "@/lib/globos3d/rotulo-contornos";
import { aspectoEstimado, caraDe, colocarRotulo, type CaraRotulo, GROSOR_ACRILICO_CM, GROSOR_VINILO_CM, lineasDeRotulo } from "@/lib/globos3d/rotulos";
import { cargarFuenteRotulos, estadoFuenteRotulos, FUENTE_ROTULOS, fuenteDeRotulos, reintentarFuenteRotulos } from "./fuente-rotulos";
import { colorDeLatex } from "./materiales-visor";

/**
 * **El rótulo de un sólido en el visor**: el texto en cursiva como letras recortadas de verdad (un vinilo de 0,8 mm o acrílico de
 * 6 mm), con las letras unidas como las de la letra manuscrita. El texto se dibuja en un lienzo con la letra de los rótulos (Great
 * Vibes, `fuente-rotulos.ts`: la misma en todos los equipos), se saca el contorno de la tinta (`rotulo-contornos.ts`) y se extruye.
 * Mientras la letra carga, o si falla, el rótulo es una marca (gris al cargar, roja si falló) del tamaño que tendría el texto. La geometría es de proporción 1 (alto 1, profundidad 1): cada
 * rótulo la escala a su tamaño, así que un mismo texto cuesta una sola geometría en todo el visor aunque salga en varios sólidos.
 *
 * Todo es de ESTE visor (regla D-017): la geometría de cada texto y los materiales (el espejo lleva el entorno de su contexto
 * WebGL) viven en la fábrica y `liberar()` los suelta con el visor; nunca hay cachés de módulo con recursos de la GPU.
 */

const CM = 0.01;
/**
 * Cuántos textos SIN USAR se guardan por visor (los que ninguna malla viva usa): al escribir un nombre letra por letra pasan por aquí
 * los intermedios, y al llegar al tope sale el que lleva más tiempo sin usarse. Los textos en uso (una escena con 20 números de mesa
 * son 20) no cuentan y nunca salen: cada texto cuesta de 3,5 a 10 mil triángulos (~0,3 MB de GPU) y se rehace en 12–50 ms.
 */
const MAXIMO_TEXTOS = 12;
const LETRA_PX = 150;

/**
 * Convierte un texto en la máscara de su tinta (recortada a ella). `"pendiente"`: la letra aún carga (hay que volver a pedirlo
 * cuando esté); `null`: no se puede dibujar (la letra falló o no hay lienzo).
 */
export type Rasterizador = (texto: string) => Mascara | "pendiente" | null;

/** El texto dibujado con la letra de los rótulos: tinta = píxeles con opacidad. Las letras se engrosan un poco (el recorte de acrílico no tiene pelos). */
export const rasterizarTexto: Rasterizador = (texto) => {
  if (typeof document === "undefined") return null;
  const estado = estadoFuenteRotulos();
  if (estado === "pendiente" || estado === "cargando") { void cargarFuenteRotulos(); return "pendiente"; }
  if (estado === "fallo") { reintentarFuenteRotulos(); return null; }
  const lineas = lineasDeRotulo(texto);
  const medidor = document.createElement("canvas").getContext("2d");
  if (!medidor || !lineas.length) return null;
  medidor.font = fuenteDeRotulos(LETRA_PX);
  const ancho = Math.ceil(Math.max(...lineas.map((l) => medidor.measureText(l).width)) + LETRA_PX * 1.2);
  const paso = LETRA_PX * 1.3;
  const alto = Math.ceil(paso * lineas.length + LETRA_PX * 0.8);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const p = lienzo.getContext("2d", { willReadFrequently: true });
  if (!p) return null;
  p.font = fuenteDeRotulos(LETRA_PX);
  p.textAlign = "center";
  p.textBaseline = "middle";
  p.lineJoin = "round";
  p.fillStyle = "#000";
  p.strokeStyle = "#000";
  p.lineWidth = LETRA_PX * 0.035;
  lineas.forEach((l, i) => { const y = LETRA_PX * 0.4 + paso * (i + 0.5); p.strokeText(l, ancho / 2, y); p.fillText(l, ancho / 2, y); });
  const rgba = p.getImageData(0, 0, ancho, alto).data;
  const datos = new Uint8Array(ancho * alto);
  for (let i = 0; i < datos.length; i++) datos[i] = rgba[i * 4 + 3]! > 110 ? 1 : 0;
  return recortada({ datos, ancho, alto });
};

/** La máscara recortada a su tinta (null si no tiene). */
function recortada(m: Mascara): Mascara | null {
  const caja = cajaDeTinta(m);
  if (!caja) return null;
  const ancho = caja.x1 - caja.x0, alto = caja.y1 - caja.y0;
  const datos = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) datos.set(m.datos.subarray((caja.y0 + y) * m.ancho + caja.x0, (caja.y0 + y) * m.ancho + caja.x1), y * ancho);
  return { datos, ancho, alto };
}

type TextoListo = { geometria: THREE.BufferGeometry; aspecto: number };
/** Un texto guardado y cuántas mallas vivas lo usan (cada una avisa al liberarse: `userData.alLiberar`). */
type TextoGuardado = TextoListo & { usos: number };

/** La geometría de unas letras de alto 1, centradas en x e y y de profundidad 1 (de z = 0 a z = 1). */
function geometriaDeMascara(m: Mascara): TextoListo | null {
  const contornos = contornosDeMascara(m);
  if (!contornos.length) return null;
  const punto = (p: { x: number; y: number }) => new THREE.Vector2((p.x - m.ancho / 2) / m.alto, (m.alto / 2 - p.y) / m.alto);
  const formas = contornos.map((c) => {
    const forma = new THREE.Shape(c.externo.map(punto));
    for (const hueco of c.huecos) forma.holes.push(new THREE.Path(hueco.map(punto)));
    return forma;
  });
  return { geometria: new THREE.ExtrudeGeometry(formas, { depth: 1, bevelEnabled: false, curveSegments: 1 }), aspecto: m.ancho / m.alto };
}

export type RotulosVisor = {
  /**
   * Las letras de un sólido (hijas de su malla, en su marco); null si no lleva rótulo. Si la letra aún carga o falló, una marca del
   * tamaño que tendría el texto (gris al cargar, roja si falló).
   */
  malla: (s: SolidoEscenografia) => THREE.Mesh | null;
  /**
   * ¿Está lista la letra para dibujar texto con ella? Si aún carga, avisa (`alFuenteLista`) cuando llegue; si falló, la reintenta. Lo usa
   * lo que dibuja texto por su cuenta con esta letra (el letrero de neón), que no se dibuja hasta que la letra esté.
   */
  letraLista: () => boolean;
  /** Suelta las geometrías y los materiales de este visor. */
  liberar: () => void;
};

export type OpcionesRotulos = {
  /** Convierte un texto en su tinta (el lienzo del navegador por defecto): para las pruebas. */
  rasterizar?: Rasterizador;
  /** Se llama (una vez por espera) cuando la letra termina de cargar: el visor rehace las piezas con rótulo. */
  alFuenteLista?: () => void;
};

/**
 * Los rótulos de UN visor: `entorno` es el reflejo de ese visor. El visor es el DUEÑO de todo lo que crea aquí (la geometría de cada
 * texto, los materiales, la marca): las mallas de las piezas lo usan prestado y nunca lo liberan (todo va marcado `compartido`).
 * Cada malla cuenta como un uso de su texto y avisa al liberarse (`userData.alLiberar`, que llama el visor al vaciar la pieza): un
 * texto en uso no sale nunca del caché y uno sin uso sale (y se suelta de la GPU) solo al llegar un texto nuevo y si hay más de `MAXIMO_TEXTOS` sin usar.
 */
export function crearRotulosVisor(entorno: () => THREE.Texture, opciones: OpcionesRotulos = {}): RotulosVisor {
  const rasterizar = opciones.rasterizar ?? rasterizarTexto;
  const textos = new Map<string, TextoGuardado>();
  const materiales = new Map<string, THREE.Material>();
  let marca: THREE.BoxGeometry | null = null;
  let esperando = false, vivo = true, avisoFallo = false;

  /** La letra aún carga: cuando esté lista, el visor rehace lo que dibujó como marca. */
  const avisarCuandoEsteLista = () => {
    if (esperando) return;
    esperando = true;
    void cargarFuenteRotulos().then((lista) => { esperando = false; if (vivo && lista) opciones.alFuenteLista?.(); });
  };

  /** Suelta los textos sin uso que pasan del tope, el que lleva más tiempo sin usarse primero (el Map guarda el orden de uso). El recién llegado es el último: no sale. */
  const podar = () => {
    let sinUso = [...textos].filter(([, t]) => t.usos === 0);
    for (const [clave, t] of sinUso) {
      if (sinUso.length <= MAXIMO_TEXTOS) break;
      t.geometria.dispose();
      textos.delete(clave);
      sinUso = sinUso.filter(([k]) => k !== clave);
    }
  };

  const textoListo = (texto: string): TextoGuardado | "pendiente" | null => {
    const clave = `${FUENTE_ROTULOS.version}|${texto}`;
    const guardado = textos.get(clave);
    if (guardado) { textos.delete(clave); textos.set(clave, guardado); return guardado; }
    const mascara = rasterizar(texto);
    if (mascara === "pendiente") return "pendiente";
    const hecho = mascara ? geometriaDeMascara(mascara) : null;
    if (!hecho) return null;
    hecho.geometria.userData.compartido = true;
    const nuevo = { ...hecho, usos: 0 };
    textos.set(clave, nuevo);
    // Se poda al llegar un texto nuevo (no al soltarse una malla): rehacer una escena suelta primero todas sus mallas y las pide de nuevo.
    podar();
    return nuevo;
  };

  const material = (acabado: "vinilo" | "acrilico_espejo" | "acrilico_mate" | "marca" | "falla", hex: string): THREE.Material => {
    const clave = `${acabado}|${hex}`;
    let m = materiales.get(clave);
    if (!m) {
      // El espejo refleja el estudio con fuerza y casi sin brillo propio: las letras toman el color de lo que las rodea, como un espejo.
      if (acabado === "acrilico_espejo") m = new THREE.MeshStandardMaterial({ color: colorDeLatex("metal", hex), metalness: 1, roughness: 0.08, envMap: entorno(), envMapIntensity: 3.2, emissive: colorDeLatex("metal", hex), emissiveIntensity: 0.05 });
      else if (acabado === "acrilico_mate") m = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.05, roughness: 0.4 });
      else if (acabado === "marca" || acabado === "falla") m = new THREE.MeshBasicMaterial({ color: acabado === "falla" ? 0xd94b4b : 0x9a9a9a, transparent: true, opacity: 0.4 });
      else m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      m.userData.compartido = true;
      materiales.set(clave, m);
    }
    return m;
  };

  /** La marca de un texto que no se pudo dibujar (todavía o nunca): una placa del tamaño que tendría, con la proporción estimada del texto. */
  const placa = (r: RotuloEscenografia, cara: CaraRotulo, falla: boolean): THREE.Mesh => {
    marca ??= new THREE.BoxGeometry(1, 1, 1);
    const colocado = colocarRotulo(cara, r, aspectoEstimado(r.texto));
    const objeto = new THREE.Mesh(marca, material(falla ? "falla" : "marca", "#000000"));
    objeto.scale.set(colocado.anchoCm * CM, colocado.altoCm * CM, 0.2 * CM);
    objeto.position.set(colocado.xCm * CM, colocado.yCm * CM, (colocado.zCm + 0.1) * CM);
    return objeto;
  };

  return {
    letraLista() {
      const estado = estadoFuenteRotulos();
      if (estado === "lista") return true;
      if (estado === "fallo") reintentarFuenteRotulos();
      if (estadoFuenteRotulos() !== "lista") { void cargarFuenteRotulos(); avisarCuandoEsteLista(); }
      return false;
    },
    malla(s) {
      const r = s.rotulo, cara = s.forma === "cilindro" ? null : caraDe(s);
      if (!r || !cara) return null;
      const texto = textoListo(r.texto);
      if (texto === "pendiente") { avisarCuandoEsteLista(); return placa(r, cara, false); }
      if (!texto) {
        // La letra falló: se reintenta (como mucho cada pocos segundos) y, si llega, se rehace lo que quedó como marca roja.
        reintentarFuenteRotulos();
        if (estadoFuenteRotulos() === "cargando") avisarCuandoEsteLista();
        if (!avisoFallo && typeof document !== "undefined") { avisoFallo = true; console.warn("[rótulos] No se pudo dibujar un texto (la letra cursiva no cargó): se muestra una marca roja en su lugar."); }
        return typeof document === "undefined" ? null : placa(r, cara, true);
      }
      const colocado = colocarRotulo(cara, r, texto.aspecto);
      const vinilo = r.acabado === "vinilo";
      const objeto = new THREE.Mesh(texto.geometria, material(r.acabado, r.color));
      // La malla usa este texto hasta que se libere (la pieza se vacía o se rehace): entonces el texto puede salir del caché.
      texto.usos++;
      objeto.userData.alLiberar = () => { texto.usos = Math.max(0, texto.usos - 1); };
      objeto.scale.set(colocado.altoCm * CM, colocado.altoCm * CM, (vinilo ? GROSOR_VINILO_CM : GROSOR_ACRILICO_CM) * CM);
      objeto.position.set(colocado.xCm * CM, colocado.yCm * CM, (colocado.zCm + (vinilo ? 0.02 : 0)) * CM);
      objeto.castShadow = !vinilo;
      objeto.receiveShadow = true;
      return objeto;
    },
    liberar() {
      vivo = false;
      for (const t of textos.values()) t.geometria.dispose();
      marca?.dispose();
      for (const m of materiales.values()) m.dispose();
      textos.clear();
      materiales.clear();
      marca = null;
    },
  };
}
