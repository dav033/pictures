import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { FormatoGlobo } from "@/lib/globos3d/formatos";
import { centroCuerpo, contornoCorazon, perfilLink, perfilRedondo, type PuntoPerfil } from "@/lib/globos3d/geometria";
import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import type { ImpresoGlobo } from "@/lib/globos3d/estampados";
import { calcoCorazon, cascaraImpresa } from "./impresos-visor";
import { colorDeLatex, materialDe, type Calidad } from "./materiales-visor";
import { colorPropio, geometriaParteFlor, materialParteFlor, partesFlor } from "./flores-visor";
import type { TipoFlorArtificial } from "@/lib/globos3d/flores-artificiales";
import { MEDIR_VISOR, cronometrar, infoDe, registrarVisor, type VisorMedible } from "./medicion-visor";
import { camaraEstandar, type VistaEstandar } from "./camara-estandar";
import { crearEntornoEstudio } from "./entorno-estudio";
import { ambienteActivo, ambienteDe, crearLucesDeSala, lucesDeTecho, materialPiso, texturaTablones, ventanaDerecha } from "./sala-ambiente";
import { ajustarSombraDelSol } from "./sombra-sala";
import { CONFETI_PLATA, TOPE_CONFETI, discosConfeti, geometriaConfeti, materialConfeti, tinteDeConfeti, topePorGlobo } from "./confeti-visor";
import { achatadoDe } from "./deformacion-globo";
import type { AmbienteSala } from "@/lib/globos3d/escena";
import { crearEscenografiaVisor } from "./escenografia-visor";
import { letraParaCapturar } from "./fuente-rotulos";

/**
 * La escena de /3d con three.js, sin React: un globo (o la fila de todos los formatos) sobre un piso con
 * cuadrícula de 10 cm, luz de estudio (RoomEnvironment) para que el cromado y el perlado reflejen, y cámara
 * orbital. Unidades: 1 = 1 metro; los perfiles vienen en centímetros.
 */
export type GloboEnEscena = { formato: FormatoGlobo; infladoCm: number; hex: string; familia: string; cuelloExtraCm?: number };

/**
 * Un globo de un módulo: dónde queda su nudo y hacia dónde apunta su cuerpo (cm, y hacia arriba). `frente`, si
 * viene, es hacia dónde mira la cara de un globo plano (el corazón).
 */
/**
 * `nodo` (en una escena) es la pieza a la que pertenece lo dibujado: un clic sobre él la elige y al arrastrarla se
 * mueve todo lo suyo junto.
 */
export type DeNodo = { nodo?: string };
export type GloboColocadoEnEscena = GloboEnEscena & DeNodo & { nudo: Punto3; direccion: Punto3; frente?: Punto3; confeti?: boolean; /** El papel del confeti (hex); sin él, plateado. */ confetiHex?: string; estampado?: EstampadoEnEscena };
export type Punto3 = { x: number; y: number; z: number };

/**
 * Lo impreso sobre un globo redondo (iris de un ojo, cara de calabaza): polígonos de color en cm medidos sobre su
 * superficie. En la **cara** (hacia `frente`: u = eje × frente, v = eje) o en la **punta** (el polo opuesto al nudo:
 * u = −(eje × frente), v = frente). Las capas se pintan en orden (la última encima). Con `impreso`, además, una
 * textura impresa envuelta sobre el cuerpo (letrero, patrón, cara, ícono; ver `impresos-visor.ts`).
 */
export type EstampadoEnEscena = { en: "cara" | "punta"; capas: ReadonlyArray<{ hex: string; puntos: ReadonlyArray<readonly [number, number]> }>; impreso?: ImpresoGlobo };

/**
 * Un tramo de tubito que sigue una curva (lazos, burbujas, colas): el eje en cm, su grosor y su color. Con familia
 * «papel» es escenografía (fantasma, telaraña): mate, y con `relleno` (si es cerrado) se pinta la figura entera.
 */
export type TuboEnEscena = DeNodo & { puntos: readonly Punto3[]; grosorCm: number; hex: string; familia: string; cerrado: boolean; relleno?: boolean };

/** Flor artificial (follaje, no es globo) en un hueco: tipo, color, tamaño, dónde y hacia dónde mira (cm). */
export type FlorEnEscena = DeNodo & { tipo: TipoFlorArtificial; hex: string; diametroCm: number; posicion: Punto3; normal: Punto3 };
/** Un volumen simple de la escena (el pedestal): base, radio y alto en cm. */
export type CilindroEnEscena = DeNodo & { base: Punto3; radioCm: number; altoCm: number; hex: string };
/** Escenografía (paneles con contorno, mesas, tapete): no son globos; vienen con su marco en cm (ver `escenografia.ts`). */
export type SolidoEnEscena = DeNodo & SolidoEscenografia;
/**
 * La sala de una escena (cm): piso en y = 0, x de −ancho/2 a +ancho/2, z de −fondo/2 a +fondo/2, techo en y = alto;
 * la pared del fondo en z = −fondo/2 y el frente abierto. Mismo formato que `Sala` de `lib/globos3d/escena.ts`.
 */
export type SalaEnEscena = {
  anchoCm: number; fondoCm: number; altoCm: number;
  tonos: { piso: string; paredes: string; techo: string };
  mostrar: { piso: boolean; fondo: boolean; laterales: boolean; techo: boolean };
  ambiente?: AmbienteSala;
};
export type CajaEnEscena = { min: Punto3; max: Punto3 };
/**
 * Con `sala`, lo que se muestra ya viene en coordenadas del mundo (una escena): no se apoya en el piso y se dibuja
 * la sala. `resaltado` marca con una caja la pieza elegida (no sale en la captura). `encuadrar: false` deja la
 * cámara donde está (al mover una pieza no se pierde el ángulo).
 */
export type ExtrasEscena = { flores?: readonly FlorEnEscena[]; cilindros?: readonly CilindroEnEscena[]; solidos?: readonly SolidoEnEscena[]; sala?: SalaEnEscena; resaltado?: CajaEnEscena | null; encuadrar?: boolean };

export type EscenaGlobos = {
  mostrar: (globos: readonly GloboEnEscena[]) => void;
  /** Un módulo armado (pareja, trío, cuarteto…): los globos colocados, si se piden sus anclas, y los tubitos. */
  mostrarModulo: (globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos?: readonly TuboEnEscena[], extras?: ExtrasEscena) => void;
  redimensionar: () => void;
  /**
   * Dibuja ya, sin esperar al cuadro siguiente: para leer el lienzo justo después (las miniaturas). El visor dibuja
   * solo cuando algo cambia, así que en reposo el lienzo no se vuelve a pintar.
   */
  dibujar: () => void;
  /**
   * Captura para la foto con IA: JPEG grande (lado mayor 1536 px) desde el ángulo que se ve, con la decoración
   * encuadrada justa, sin cuadrícula y con fondo claro. La proporción sale de la forma (vertical, cuadrada o
   * apaisada) y es la misma que se le pide a FLUX, para que no estire ni recorte.
   */
  capturar: () => { datos: string; aspecto: AspectoCaptura };
  /**
   * Prepara la captura para la IA: con rótulos o neones en la escena, espera la letra y a que se dibujen con ella; lanza un error claro
   * si no carga (lo que se captura sin ella saldría con marcas). Llamarla antes de `capturar`.
   */
  esperarRotulos: () => Promise<void>;
  /**
   * Render estándar para las incrustaciones de imagen de la biblioteca (PNG cuadrado de `lado` px): cámara fija por
   * `vista` con lo que se ve encuadrado al 70 %, calidad alta, sin cuadrícula ni ayudas y sobre un fondo gris claro
   * opaco. No toca la cámara del visor. Se lee en el mismo instante, así que el lienzo no necesita conservar el búfer.
   */
  renderEstandar: (vista: VistaEstandar, lado: number) => string;
  /**
   * Render con una cámara dada (la de `camara-foto.ts`: la escena armada de una foto vista desde la cámara de la foto):
   * JPEG de `ancho` × `alto` px con calidad alta y sin ayudas. No toca la cámara del visor.
   */
  renderFoto: (camara: THREE.PerspectiveCamera, ancho: number, alto: number) => string;
  /**
   * La pieza (su `nodo`) que hay bajo un punto de la pantalla (coordenadas de cliente) y dónde se tocó (cm, en el
   * mundo); `null` si ahí no hay ninguna.
   */
  piezaEn: (clienteX: number, clienteY: number) => { nodo: string; punto: Punto3 } | null;
  /** Dónde corta el rayo de ese punto de la pantalla el plano que pasa por `punto` con esa `normal` (cm). */
  puntoEnPlano: (clienteX: number, clienteY: number, punto: Punto3, normal: Punto3) => Punto3 | null;
  /**
   * Corre lo dibujado de esas piezas (y la caja de la elegida) `delta` cm desde donde se armó, sin rearmar nada:
   * para arrastrar con fluidez. Lo siguiente que se muestre vuelve a dibujarlo todo en su sitio.
   */
  trasladarPiezas: (nodos: readonly string[], delta: Punto3) => void;
  /** Encender o apagar el giro de la cámara (se apaga mientras se arrastra una pieza). */
  orbitar: (activo: boolean) => void;
  /** Hacia dónde mira la cámara en el piso (horizontal, unitario) y su derecha: para las flechas del teclado. */
  ejesCamara: () => { adelante: Punto3; derecha: Punto3 };
  /**
   * Lo primero que hay bajo el puntero entre las piezas `nodos` y (si `sala`) el piso, las paredes y el techo. Con
   * `preferir`, si el rayo toca esa pieza en algún punto, gana ella (deslizar por la superficie de su estructura).
   */
  lugarEn: (clienteX: number, clienteY: number, opciones: { nodos: readonly string[]; sala: boolean; preferir?: string | null }) => LugarEnEscena | null;
  /** Mientras se arrastra una decoración: marca las piezas que la aceptan (cajas verdes) y tiñe la sala si también vale. */
  resaltarLugares: (cajas: readonly CajaEnEscena[], sala: boolean) => void;
  /** La caja de UNA copia bajo el puntero (lo que se puede coger), o nada. */
  resaltarEncima: (caja: CajaEnEscena | null) => void;
  /** La vista previa (fantasma, semitransparente) de una decoración donde caería; listas vacías la quitan. */
  mostrarFantasma: (globos: readonly GloboColocadoEnEscena[], tubos: readonly TuboEnEscena[]) => void;
  /** Esconde lo de esa pieza que cae dentro de `caja` (la copia que se está moviendo); `null` lo vuelve a mostrar todo. */
  ocultarCopia: (nodo: string | null, caja?: CajaEnEscena | null) => void;
  /** Dónde está la cámara (para volver a ese mismo ángulo: al salir del editor solitario la escena queda como estaba). */
  vistaCamara: () => VistaCamara;
  /** Pone la cámara en una vista guardada con `vistaCamara`. */
  ponerVistaCamara: (vista: VistaCamara) => void;
  /** Dónde cae en la pantalla (coordenadas de cliente) un punto del mundo (cm); `null` si queda detrás de la cámara. */
  aPantalla: (punto: Punto3) => { x: number; y: number } | null;
  /**
   * La cámara de frente, de lado, desde arriba o en el ángulo de siempre («3d»), con todo lo que se ve en cuadro (sin
   * la sala). No rearma nada: solo mueve la cámara.
   */
  verDesde: (vista: VistaFija) => void;
  /**
   * Avisa cada vez que el visor dibuja un cuadro (giró la cámara, cambió lo que se ve o el tamaño): para lo que va pegado
   * a una pieza en la pantalla (su etiqueta, la regla de alturas). Devuelve cómo dejar de escuchar. En reposo no avisa.
   */
  alDibujar: (oyente: () => void) => () => void;
  destruir: () => void;
};

/** Las vistas fijas de la barra del visor. */
export type VistaFija = "frente" | "lado" | "arriba" | "3d";

/** Una vista de la cámara (m): posición, a dónde mira y sus límites de acercar. */
export type VistaCamara = { posicion: Punto3; objetivo: Punto3; near: number; far: number; minDistancia: number; maxDistancia: number };

/** Superficies de la sala que reciben una decoración al soltarla. */
export type SuperficieSalaEnEscena = "piso" | "techo" | "fondo" | "izquierda" | "derecha";
/**
 * Dónde cae el puntero al soltar una decoración: sobre una pieza (punto y normal de la cara tocada, en cm del mundo)
 * o sobre una superficie de la sala.
 */
export type LugarEnEscena =
  | { tipo: "nodo"; nodo: string; punto: Punto3; normal: Punto3 }
  | { tipo: "sala"; superficie: SuperficieSalaEnEscena; punto: Punto3 };

export type AspectoCaptura = "2:3" | "1:1" | "3:2";
const TAMANO_CAPTURA: Record<AspectoCaptura, { ancho: number; alto: number }> = { "2:3": { ancho: 1024, alto: 1536 }, "1:1": { ancho: 1024, alto: 1024 }, "3:2": { ancho: 1536, alto: 1024 } };

const CM = 0.01;
/** Sin pieza a la que referirse (la vista previa, un globo suelto): la referencia es el origen. */
const SIN_REFERENCIA = { x: 0, y: 0, z: 0 };
/** Fondo del render estándar (gris claro neutro, como las fotos de decoración sobre pared lisa). */
const FONDO_ESTANDAR = 0xe6e6e9;
/** Cuántas piezas que dejaron de verse se guardan dibujadas por si vuelven (ver `aparcados`). */
const MAX_APARCADOS = 160;

export type { Calidad };
const CALIDAD: Readonly<Record<Calidad, { pasos: number; vueltas: number; tubo: readonly [number, number]; curva: number; bisel: number }>> = {
  alta: { pasos: 48, vueltas: 72, tubo: [120, 32], curva: 64, bisel: 10 },
  editor: { pasos: 24, vueltas: 32, tubo: [60, 16], curva: 24, bisel: 4 },
};

/** Azar determinista (cada globo o flor siempre igual entre recargas). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/** Confeti dentro de un globo de cristal suelto (no por instancias): las escamas pegadas a la pared del cuerpo (coordenadas locales). */
function confetiDentro(centroY: number, radio: number, semilla: number, hex: string, entorno: THREE.Texture): THREE.InstancedMesh {
  const discos = discosConfeti(radio, semilla, TOPE_CONFETI);
  const malla = new THREE.InstancedMesh(geometriaConfeti(), materialConfeti(hex, entorno), discos.length);
  const sube = new THREE.Matrix4().makeTranslation(0, centroY, 0), m = new THREE.Matrix4();
  discos.forEach((d, i) => malla.setMatrixAt(i, m.multiplyMatrices(sube, d)));
  malla.castShadow = false;
  return malla;
}

function torneado(perfil: readonly PuntoPerfil[], vueltas: number = CALIDAD.alta.vueltas): THREE.LatheGeometry {
  return new THREE.LatheGeometry(perfil.map((p) => new THREE.Vector2(p.r * CM, p.y * CM)), vueltas);
}

/** Una parte de un globo: su geometría y dónde va en el marco del globo (nudo en el origen, cuerpo hacia +Y). */
type ParteGlobo = { geometria: THREE.BufferGeometry; local: THREE.Matrix4 };

const enY = (y: number) => new THREE.Matrix4().makeTranslation(0, y, 0);

/** Tubito o Link-O-Loon 660: cápsula curvada (un arco suave) con la boquilla y el nudo en un extremo. */
function partesTubo(grosorCm: number, largoCm: number, calidad: Calidad): ParteGlobo[] {
  const radio = (grosorCm / 2) * CM;
  const largo = largoCm * CM;
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-largo / 2, 0, 0),
    new THREE.Vector3(-largo / 4, largo * 0.06, 0),
    new THREE.Vector3(largo / 4, largo * 0.06, 0),
    new THREE.Vector3(largo / 2, 0, 0),
  ]);
  const [tramos, lados] = CALIDAD[calidad].tubo;
  const partes: ParteGlobo[] = [{ geometria: new THREE.TubeGeometry(curva, tramos, radio, lados, false), local: new THREE.Matrix4() }];
  for (const t of [0, 1]) {
    const p = curva.getPoint(t);
    partes.push({ geometria: new THREE.SphereGeometry(radio, lados, lados / 2), local: new THREE.Matrix4().makeTranslation(p.x, p.y, p.z) });
  }
  // Nudo en el extremo izquierdo.
  const nudo = curva.getPoint(0).add(new THREE.Vector3(-radio * 1.1, 0, 0));
  partes.push({ geometria: new THREE.TorusGeometry(radio * 0.45, radio * 0.25, 12, 24), local: new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(nudo) });
  return partes;
}

/** Un grupo con las partes de un globo, todas con el mismo material. */
function grupoDePartes(partes: readonly ParteGlobo[], material: THREE.Material): THREE.Group {
  const grupo = new THREE.Group();
  for (const parte of partes) {
    const malla = new THREE.Mesh(parte.geometria, material);
    parte.local.decompose(malla.position, malla.quaternion, malla.scale);
    grupo.add(malla);
  }
  return grupo;
}

/** La curva (m) de un tramo de tubito; `null` si no tiene con qué. */
function curvaDeTubo(tramo: TuboEnEscena): THREE.CatmullRomCurve3 | null {
  const puntos = tramo.puntos.map((p) => new THREE.Vector3(p.x * CM, p.y * CM, p.z * CM));
  if (puntos.length < 2) return null;
  // Con 2 puntos la curva es una recta: se añade el punto medio para que Catmull-Rom tenga con qué trabajar.
  if (puntos.length === 2) puntos.splice(1, 0, puntos[0]!.clone().lerp(puntos[1]!, 0.5));
  return new THREE.CatmullRomCurve3(puntos, tramo.cerrado, "centripetal");
}

/**
 * Tubito que sigue una curva cualquiera (un lazo, un ocho, una burbuja, una cola): tubo a lo largo de la curva
 * con las puntas redondeadas; si es cerrado, sin puntas. A diferencia de `tubo`, la curva viene dada (cm).
 */
function tuboEnCurva(tramo: TuboEnEscena, material: THREE.Material, conPuntas = true): THREE.Group {
  const grupo = new THREE.Group();
  const radio = (tramo.grosorCm / 2) * CM;
  const curva = curvaDeTubo(tramo);
  if (!curva) return grupo;
  const segmentos = Math.min(160, Math.max(12, curva.points.length * 4));
  grupo.add(new THREE.Mesh(new THREE.TubeGeometry(curva, segmentos, radio, 14, tramo.cerrado), material));
  if (!tramo.cerrado && conPuntas) {
    for (const t of [0, 1]) {
      const punta = new THREE.Mesh(new THREE.SphereGeometry(radio, 16, 10), material);
      punta.position.copy(curva.getPoint(t));
      grupo.add(punta);
    }
  }
  return grupo;
}

/**
 * La figura que encierra un contorno plano (la silueta de un fantasma de papel): se proyecta en su plano (normal de
 * Newell), se triangula y se vuelve a llevar al espacio. `null` si no hay figura.
 */
function rellenoPlano(puntos: readonly Punto3[], material: THREE.Material): THREE.Mesh | null {
  if (puntos.length < 3) return null;
  const v = puntos.map((p) => new THREE.Vector3(p.x * CM, p.y * CM, p.z * CM));
  const centro = v.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(v.length);
  const normal = new THREE.Vector3();
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!, b = v[(i + 1) % v.length]!;
    normal.x += (a.y - b.y) * (a.z + b.z); normal.y += (a.z - b.z) * (a.x + b.x); normal.z += (a.x - b.x) * (a.y + b.y);
  }
  if (normal.lengthSq() < 1e-14) return null;
  normal.normalize();
  const e1 = v[0]!.clone().sub(centro);
  e1.addScaledVector(normal, -e1.dot(normal));
  if (e1.lengthSq() < 1e-14) return null;
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(normal, e1);
  const plano = v.map((p) => { const d = p.clone().sub(centro); return new THREE.Vector2(d.dot(e1), d.dot(e2)); });
  const caras = THREE.ShapeUtils.triangulateShape(plano, []);
  const geometria = new THREE.BufferGeometry().setFromPoints(v);
  geometria.setIndex(caras.flat());
  geometria.computeVertexNormals();
  return new THREE.Mesh(geometria, material);
}

/** Radio del perfil torneado a la altura `y` (0 fuera de él). */
function radioDelPerfil(perfil: readonly PuntoPerfil[], y: number): number {
  for (let i = 1; i < perfil.length; i++) {
    const a = perfil[i - 1]!, b = perfil[i]!;
    if (y >= a.y && y <= b.y) return b.y - a.y < 1e-9 ? Math.max(a.r, b.r) : a.r + ((b.r - a.r) * (y - a.y)) / (b.y - a.y);
  }
  return 0;
}

/** Lo ya calculado de cada estampado (posiciones y normales), por globo y capa: los ojos repetidos no se rehacen. */
const cacheEstampado = new Map<string, { posiciones: Float32Array; normales: Float32Array }>();

/**
 * Lo impreso sobre un globo redondo, en el marco local del globo (Y = eje, Z = frente): cada capa se triangula en
 * el plano (u, v), se subdivide para que siga la curva, y cada punto se lleva al látex midiendo sobre la superficie
 * (equidistante) y buscando el borde del perfil a lo largo del rayo desde el centro del cuerpo. Las capas salen un
 * poco del globo (y del de abajo) para no parpadear.
 */
function estampadoSobre(infladoCm: number, cuelloExtraCm: number, estampado: EstampadoEnEscena): THREE.Group {
  const grupo = new THREE.Group();
  const perfil = perfilRedondo(infladoCm, cuelloExtraCm);
  const yc = centroCuerpo("redondo", infladoCm) + cuelloExtraCm;
  const r = infladoCm / 2;
  const punta = estampado.en === "punta";
  const d = punta ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const u = punta ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
  const v = punta ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const fuera = (dir: THREE.Vector3, t: number) => Math.hypot(dir.x * t, dir.z * t) >= radioDelPerfil(perfil, yc + dir.y * t);
  const superficie = (dir: THREE.Vector3): number => {
    let a = 0, b = r * 0.6;
    while (!fuera(dir, b) && b < r * 3) { a = b; b += r * 0.1; }
    for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (fuera(dir, m)) b = m; else a = m; }
    return b;
  };
  estampado.capas.forEach((capa, k) => {
    if (capa.puntos.length < 3) return;
    const clave = `${infladoCm}|${cuelloExtraCm}|${estampado.en}|${k}|${JSON.stringify(capa.puntos)}`;
    let datos = cacheEstampado.get(clave);
    if (!datos) {
      const contorno = capa.puntos.map(([pu, pv]) => new THREE.Vector2(pu, pv));
      let triangulos = THREE.ShapeUtils.triangulateShape(contorno, []).map(([a, b, c]) => [contorno[a]!, contorno[b]!, contorno[c]!]);
      // Subdividir: un triángulo grande (la boca de una calabaza) cortaría por dentro del globo.
      const niveles = r > 10 ? 3 : 2;
      for (let n = 0; n < niveles; n++) {
        triangulos = triangulos.flatMap(([a, b, c]) => {
          const ab = a.clone().lerp(b, 0.5), bc = b.clone().lerp(c, 0.5), ca = c.clone().lerp(a, 0.5);
          return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
        });
      }
      const posiciones = new Float32Array(triangulos.length * 9), normales = new Float32Array(triangulos.length * 9);
      const salida = 0.05 + 0.04 * k;
      let i = 0;
      for (const tri of triangulos) for (const p of tri) {
        const largo = Math.hypot(p.x, p.y), t = largo / r;
        const dir = d.clone().multiplyScalar(Math.cos(t));
        if (largo > 1e-9) dir.addScaledVector(u, (p.x / largo) * Math.sin(t)).addScaledVector(v, (p.y / largo) * Math.sin(t));
        dir.normalize();
        const s = superficie(dir) + salida;
        posiciones.set([dir.x * s * CM, (yc + dir.y * s) * CM, dir.z * s * CM], i);
        normales.set([dir.x, dir.y, dir.z], i);
        i += 3;
      }
      datos = { posiciones, normales };
      cacheEstampado.set(clave, datos);
      if (cacheEstampado.size > 400) { const primera = cacheEstampado.keys().next().value; if (primera !== undefined) cacheEstampado.delete(primera); }
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(datos.posiciones, 3));
    geometria.setAttribute("normal", new THREE.BufferAttribute(datos.normales, 3));
    const material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(capa.hex), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - k, polygonOffsetUnits: -1 - k });
    grupo.add(new THREE.Mesh(geometria, material));
  });
  return grupo;
}

/** Corazón: la figura extruida con bisel redondo (la primera parte: ahí va la calcomanía) y el nudo. */
function partesCorazon(anchoCm: number, calidad: Calidad): ParteGlobo[] {
  const forma = new THREE.Shape(contornoCorazon(anchoCm * CM).map((p) => new THREE.Vector2(p.x, p.y)));
  const ancho = anchoCm * CM;
  const { curva, bisel } = CALIDAD[calidad];
  const geometria = new THREE.ExtrudeGeometry(forma, { depth: ancho * 0.22, bevelEnabled: true, bevelThickness: ancho * 0.14, bevelSize: ancho * 0.1, bevelSegments: bisel, curveSegments: curva });
  geometria.center();
  geometria.computeBoundingBox();
  const caja = geometria.boundingBox;
  const abajo = caja ? -caja.min.y : ancho / 2;
  return [
    { geometria, local: enY(abajo + ancho * 0.05) },
    { geometria: new THREE.TorusGeometry(ancho * 0.03, ancho * 0.015, 12, 24), local: enY(ancho * 0.03) },
  ];
}

/** Un globo completo con sus propias geometrías y su material (calidad alta): el globo suelto y lo que no va por instancias. */
function construir(globo: GloboEnEscena, entorno: THREE.Texture): THREE.Object3D {
  const material = materialDe(globo.familia, globo.hex, "alta", entorno);
  const { formato, infladoCm } = globo;
  const largoTubo = formato.tipo === "tubito" ? formato.largoCm ?? 150 : formato.tipo === "link" ? formato.largoCm : undefined;
  if (largoTubo) {
    const grupo = grupoDePartes(partesTubo(infladoCm, largoTubo, "alta"), material);
    // Apoyado sobre el piso (en un módulo, la posición del nudo lo reemplaza).
    grupo.position.y = (infladoCm / 2) * CM;
    return grupo;
  }
  if (formato.tipo === "corazon") return grupoDePartes(partesCorazon(infladoCm, "alta"), material);
  const extra = globo.cuelloExtraCm ?? 0;
  const perfil = formato.tipo === "link" ? perfilLink(infladoCm, extra) : perfilRedondo(infladoCm, extra);
  const malla = new THREE.Mesh(torneado(perfil), material);
  malla.castShadow = true;
  return malla;
}

/** Tope de píxeles del lienzo (ancho × alto × densidad²): lo que cuesta dibujar cada cuadro. */
const PIXELES_MAXIMOS = 3_500_000;

function ancho(objeto: THREE.Object3D): number {
  const caja = new THREE.Box3().setFromObject(objeto);
  return caja.max.x - caja.min.x;
}

const ARRIBA = new THREE.Vector3(0, 1, 0);
const NADA: readonly never[] = [];
const BLANCO = new THREE.Color(0xffffff);
/** Diámetro (cm) con que se tornea la geometría de un globo que luego se escala a su tamaño (el perfil es proporcional desde 10 cm). */
const DIAMETRO_BASE = 30;

/** Hacia dónde mira un globo colocado: su eje (+Y local) y, si es plano, su cara (+Z local). */
function orientacionDe(globo: GloboColocadoEnEscena, q: THREE.Quaternion): THREE.Quaternion {
  const eje = new THREE.Vector3(globo.direccion.x, globo.direccion.y, globo.direccion.z).normalize();
  if (!globo.frente) return q.setFromUnitVectors(ARRIBA, eje);
  // Globo plano: Y local = dirección del cuerpo, Z local (la cara del corazón) = frente.
  const z = new THREE.Vector3(globo.frente.x, globo.frente.y, globo.frente.z);
  z.addScaledVector(eje, -z.dot(eje)).normalize();
  const x = new THREE.Vector3().crossVectors(eje, z);
  return q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, eje, z));
}

/** El marco de un globo colocado (del espacio del globo, en m, a la escena). */
function marcoDeGlobo(globo: GloboColocadoEnEscena): THREE.Matrix4 {
  const q = orientacionDe(globo, new THREE.Quaternion());
  return new THREE.Matrix4().compose(new THREE.Vector3(globo.nudo.x * CM, globo.nudo.y * CM, globo.nudo.z * CM), q, new THREE.Vector3(1, 1, 1));
}

/** Lo impreso de un globo redondo (estampado, cáscara impresa) y, si se pide, su confeti: en el marco del globo. */
function extrasDeGlobo(globo: GloboColocadoEnEscena, indice: number, conConfeti: boolean, entorno: THREE.Texture): THREE.Object3D[] {
  const salida: THREE.Object3D[] = [];
  if (globo.formato.tipo !== "redondo") return salida;
  const extra = globo.cuelloExtraCm ?? 0;
  if (conConfeti && globo.confeti) salida.push(confetiDentro((centroCuerpo("redondo", globo.infladoCm) + extra) * CM, (globo.infladoCm / 2) * CM, indice + 1, globo.confetiHex ?? CONFETI_PLATA, entorno));
  // Lo impreso (iris, cara de calabaza) pegado a la superficie, en el marco del globo.
  if (globo.estampado) salida.push(estampadoSobre(globo.infladoCm, extra, globo.estampado));
  // Lo impreso como textura (letrero, patrón, cara): cáscara sobre el redondo.
  const impreso = globo.estampado?.impreso;
  if (impreso) {
    const cascara = cascaraImpresa(perfilRedondo(globo.infladoCm, extra), centroCuerpo("redondo", globo.infladoCm) + extra, impreso, entorno);
    if (cascara) salida.push(cascara);
  }
  return salida;
}

/** Un globo colocado entero, con sus propias geometrías y material (calidad alta): lo que no va por instancias. */
function objetoCompleto(globo: GloboColocadoEnEscena, indice: number, entorno: THREE.Texture): THREE.Object3D {
  const objeto = construir(globo, entorno);
  objeto.add(...extrasDeGlobo(globo, indice, true, entorno));
  const impreso = globo.estampado?.impreso;
  if (impreso && globo.formato.tipo === "corazon") {
    // La calcomanía en la cara del corazón.
    const malla = objeto.children.find((hijo): hijo is THREE.Mesh => hijo instanceof THREE.Mesh && hijo.geometry instanceof THREE.ExtrudeGeometry);
    const calco = malla ? calcoCorazon(malla, globo.infladoCm, impreso, entorno) : null;
    if (malla && calco) malla.add(calco);
  }
  orientacionDe(globo, objeto.quaternion);
  objeto.position.set(globo.nudo.x * CM, globo.nudo.y * CM, globo.nudo.z * CM);
  // El mismo achatado que el de los globos por instancias (el nudo no se mueve).
  if (globo.formato.tipo === "redondo") objeto.scale.setFromMatrixScale(achatadoDe(globo.nodo ?? "", globo.nudo, SIN_REFERENCIA, globo.infladoCm, globo.formato.id));
  objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
  return objeto;
}

/**
 * Huella numérica (dos hashes de 32 bits) de lo que dibuja una pieza, con las posiciones relativas a un punto suyo: si
 * no cambia, la pieza no se rehace (y si solo cambió ese punto, se corre entera).
 */
class Huella {
  private a = 0x811c9dc5;
  private b = 0x2545f491;
  entero(k: number) {
    this.a = Math.imul(this.a ^ k, 16777619);
    this.b = Math.imul(this.b ^ (k + 0x9e3779b9), 2246822507) ^ (this.b >>> 15);
  }
  num(v: number, escala: number) { this.entero(Math.round(v * escala) | 0); }
  texto(t: string) { for (let i = 0; i < t.length; i++) this.entero(t.charCodeAt(i)); this.entero(-1); }
  valor(): string { return `${(this.a >>> 0).toString(36)}:${(this.b >>> 0).toString(36)}`; }
}

/** El JSON de un estampado (los objetos se reutilizan entre armados: se calcula una vez por objeto). */
const jsonEstampado = new WeakMap<object, string>();
function jsonDe(objeto: object): string {
  let texto = jsonEstampado.get(objeto);
  if (texto === undefined) { texto = JSON.stringify(objeto); jsonEstampado.set(objeto, texto); }
  return texto;
}

/** Lo que dibuja una pieza (con el índice de cada globo y flor en su lista: de ahí sale el azar del confeti y la flor). */
type ContenidoNodo = {
  globos: Array<{ g: GloboColocadoEnEscena; i: number }>;
  tubos: TuboEnEscena[];
  flores: Array<{ f: FlorEnEscena; i: number }>;
  cilindros: CilindroEnEscena[];
  solidos: SolidoEnEscena[];
};

/** Un punto de la pieza (cm) al que se refieren las posiciones de su huella. */
function referenciaDe(c: ContenidoNodo): THREE.Vector3 {
  const p = c.globos[0]?.g.nudo ?? c.tubos[0]?.puntos[0] ?? c.flores[0]?.f.posicion ?? c.cilindros[0]?.base ?? c.solidos[0]?.origen;
  return p ? new THREE.Vector3(p.x, p.y, p.z) : new THREE.Vector3();
}

function huellaDe(c: ContenidoNodo, ref: THREE.Vector3, topeConfeti: number): string {
  const h = new Huella();
  const pos = (p: Punto3) => { h.num(p.x - ref.x, 100); h.num(p.y - ref.y, 100); h.num(p.z - ref.z, 100); };
  const dir = (p: Punto3) => { h.num(p.x, 1e4); h.num(p.y, 1e4); h.num(p.z, 1e4); };
  for (const { g, i } of c.globos) {
    h.texto(g.formato.id); h.num(g.infladoCm, 1000); h.texto(g.hex); h.texto(g.familia); h.num(g.cuelloExtraCm ?? 0, 1000);
    pos(g.nudo); dir(g.direccion);
    if (g.frente) dir(g.frente); else h.entero(-3);
    h.entero(g.confeti ? i + 1 : 0);
    if (g.confeti) { h.texto(g.confetiHex ?? ""); h.entero(topeConfeti); }
    if (g.estampado) h.texto(jsonDe(g.estampado)); else h.entero(-4);
  }
  h.entero(-5);
  for (const t of c.tubos) {
    h.entero(t.puntos.length);
    for (const p of t.puntos) pos(p);
    h.num(t.grosorCm, 1000); h.texto(t.hex); h.texto(t.familia); h.entero((t.cerrado ? 1 : 0) + (t.relleno ? 2 : 0));
  }
  h.entero(-6);
  for (const { f, i } of c.flores) { h.texto(f.tipo); h.texto(f.hex); h.num(f.diametroCm, 1000); pos(f.posicion); dir(f.normal); h.entero(i + 7); }
  h.entero(-7);
  for (const x of c.cilindros) { pos(x.base); h.num(x.radioCm, 1000); h.num(x.altoCm, 1000); h.texto(x.hex); }
  h.entero(-8);
  const fuera = new Set(["origen", "ejeX", "ejeY", "ejeZ", "nodo"]);
  for (const s of c.solidos) {
    h.texto(JSON.stringify(s, (clave: string, valor: unknown) => (fuera.has(clave) ? undefined : valor)));
    pos(s.origen); dir(s.ejeX); dir(s.ejeY); dir(s.ejeZ);
  }
  return h.valor();
}

/** Lo dibujado de una pieza: su grupo (lo que no va por instancias) y sus instancias en los lotes. */
type NodoDibujado = {
  huella: string;
  /** El punto de referencia de su huella (cm). */
  ref: THREE.Vector3;
  /** Dónde está su grupo (m): se corre si la pieza se movió sin cambiar. */
  base: THREE.Vector3;
  grupo: THREE.Group;
  instancias: Instancia[];
  caja: THREE.Box3 | null;
  /** Lleva un rótulo o un letrero de neón: si su letra aún no había cargado, se rehace cuando cargue. */
  conRotulo: boolean;
};
/** Una copia de una geometría compartida: en qué lote va, su marco (en el módulo) y su color (`null`: el del material). */
type Instancia = { lote: string; matriz: THREE.Matrix4; color: THREE.Color | null };
/** Cómo es un lote: su geometría y su material en cada calidad, y si cada copia lleva su color. */
type DefLote = { geometria: (calidad: Calidad) => THREE.BufferGeometry; material: (calidad: Calidad) => THREE.Material; conColor: boolean };
/** Todas las copias de una geometría con un material: una sola llamada de dibujo. */
type Lote = { def: DefLote; malla: THREE.InstancedMesh; capacidad: number; nodos: Array<string | null>; bases: Float32Array; ocultos: Set<number> };

export function crearEscena(lienzo: HTMLCanvasElement): EscenaGlobos {
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  // La sombra se rehace solo cuando cambia lo dibujado (girar la cámara no la cambia).
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);

  const escena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  escena.environment = entorno;
  // Lo que refleja (cromado, metal, foil, lentejuelas, piso) mira un estudio con luces fuertes, no la sala blanca. Es de ESTE
  // visor (un recurso de su contexto WebGL: nunca va a una variable de módulo) y se hornea la primera vez que hace falta.
  let entornoEstudio: THREE.Texture | null = null;
  const entornoMetal = (): THREE.Texture => (entornoEstudio ??= crearEntornoEstudio(renderer));
  // La escenografía (muebles, paneles, utilería) de este visor, con sus materiales y geometrías compartidos.
  const escenografia = crearEscenografiaVisor(entornoMetal, { alFuenteLista: () => rehacerRotulos() });
  // Menos luz de entorno: con la sala completa el látex mate se veía lavado (el rosado 009 salía casi blanco).
  escena.environmentIntensity = 0.55;

  const sol = new THREE.DirectionalLight(0xffffff, 1.4);
  sol.position.set(1.5, 3, 2);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  // Sin sesgo, las caras casi verticales y algo inclinadas (la falda de un mantel) se autosombrean en rayas: 1,5 cm de sesgo por la normal las quita.
  sol.shadow.normalBias = 0.015;
  escena.add(sol, new THREE.AmbientLight(0xffffff, 0.08));
  // Con una sala con ambiente, luz de estudio cálida; sin él, la neutra de siempre.
  const lucesDeSala = crearLucesDeSala(escena, sol);
  /** La textura de tablones (una sola, neutra: el tono lo pone el material), hecha la primera vez que un piso la pide. */
  let tablones: THREE.CanvasTexture | null | undefined;
  const anisotropia = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const piso = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  escena.add(piso);
  // Cuadrícula de 10 cm: la escala real a la vista.
  const cuadricula = new THREE.GridHelper(4, 40, 0x9a8fb0, 0xd4cde0);
  const materialesCuadricula = Array.isArray(cuadricula.material) ? cuadricula.material : [cuadricula.material];
  for (const m of materialesCuadricula) { m.transparent = true; m.opacity = 0.45; }
  escena.add(cuadricula);

  const camara = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controles = new OrbitControls(camara, lienzo);
  controles.enableDamping = true;
  controles.maxPolarAngle = Math.PI * 0.495;

  const contenido = new THREE.Group();
  escena.add(contenido);
  // Lo de un módulo o una escena (por piezas y lotes) y la fila de globos sueltos de la pestaña Globos.
  const modulo = new THREE.Group();
  const fila = new THREE.Group();
  contenido.add(modulo, fila);
  // La sala de una escena (piso, paredes y techo) y las ayudas (la caja de la pieza elegida): fuera de `contenido`
  // para que el encuadre y la captura se centren en los globos.
  const sala = new THREE.Group();
  const ayudas = new THREE.Group();
  // Ayudas de arrastrar decoraciones (piezas que las aceptan, la copia bajo el puntero y la vista previa): las maneja
  // quien arrastra, no se borran al redibujar ni salen en la captura.
  const lienzoAyudas = new THREE.Group();
  const fantasma = new THREE.Group();
  const marcasLugares = new THREE.Group();
  const marcaEncima = new THREE.Group();
  lienzoAyudas.add(marcasLugares, marcaEncima, fantasma);
  escena.add(sala, ayudas, lienzoAyudas);
  /** La caja de la pieza elegida tal como se armó (al arrastrar se corre desde aquí). */
  let resaltado: { caja: THREE.Box3; ayuda: THREE.Box3Helper } | null = null;

  // ----------------------------------------------------------------------------------------------------------
  // Dibujar solo cuando algo cambia (la cámara, lo que se ve, el tamaño o las ayudas): en reposo no se dibuja.
  // ----------------------------------------------------------------------------------------------------------
  let pendiente = 0;
  let cuadros = 0;
  let vivo = true;
  const dibujar = () => { renderer.render(escena, camara); cuadros++; };
  const alCuadro = () => {
    pendiente = 0;
    // Con inercia, `update` sigue moviendo la cámara (y avisa `change`, que pide el cuadro siguiente) hasta pararse.
    controles.update();
    dibujar();
    for (const oyente of oyentesCuadro) oyente();
  };
  const pedirCuadro = () => { if (!pendiente && vivo) pendiente = requestAnimationFrame(alCuadro); };
  /** Quien sigue lo dibujado en la pantalla (etiquetas pegadas a una pieza): se avisa después de cada cuadro. */
  const oyentesCuadro = new Set<() => void>();
  /** Cambió lo que proyecta sombra: se rehace la sombra en el próximo cuadro. */
  const cambioConSombra = () => { renderer.shadowMap.needsUpdate = true; pedirCuadro(); };
  controles.addEventListener("change", pedirCuadro);

  // ----------------------------------------------------------------------------------------------------------
  // Recursos compartidos: geometrías y materiales que usan muchos globos (nunca se liberan al redibujar).
  // ----------------------------------------------------------------------------------------------------------
  const compartido = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => { x.userData.compartido = true; return x; };
  /** Las partes de cada plantilla de globo por calidad (`clave|calidad`). */
  const juegos = new Map<string, ParteGlobo[]>();
  const constructores = new Map<string, (calidad: Calidad) => ParteGlobo[]>();
  const juego = (clave: string, calidad: Calidad): ParteGlobo[] => {
    const k = `${clave}|${calidad}`;
    let partes = juegos.get(k);
    if (!partes) {
      const construirJuego = constructores.get(clave);
      partes = construirJuego ? construirJuego(calidad) : [];
      for (const parte of partes) compartido(parte.geometria);
      juegos.set(k, partes);
    }
    return partes;
  };
  const materiales = new Map<string, THREE.Material>();
  const material = (clave: string, crear: () => THREE.Material): THREE.Material => {
    let m = materiales.get(clave);
    if (!m) { m = compartido(crear()); materiales.set(clave, m); }
    return m;
  };
  const geometriasSueltas = new Map<string, THREE.BufferGeometry>();
  const geometria = (clave: string, crear: () => THREE.BufferGeometry): THREE.BufferGeometry => {
    let g = geometriasSueltas.get(clave);
    if (!g) { g = compartido(crear()); geometriasSueltas.set(clave, g); }
    return g;
  };

  /**
   * La plantilla de un globo: qué juego de partes usa y con qué escala. Los redondos y los Link-O-Loon se tornean una
   * vez con 30 cm y se escalan (el perfil es proporcional al diámetro desde 10 cm: el mismo dibujo, exacto). `null`:
   * va entero aparte (corazón con calcomanía).
   */
  function plantillaDe(globo: GloboColocadoEnEscena): { clave: string; escala: number } | null {
    const { formato, infladoCm } = globo;
    const largoTubo = formato.tipo === "tubito" ? formato.largoCm ?? 150 : formato.tipo === "link" ? formato.largoCm : undefined;
    if (largoTubo) {
      const clave = `tubo|${infladoCm}|${largoTubo}`;
      if (!constructores.has(clave)) constructores.set(clave, (c) => partesTubo(infladoCm, largoTubo, c));
      return { clave, escala: 1 };
    }
    if (formato.tipo === "corazon") {
      if (globo.estampado?.impreso) return null;
      const clave = `corazon|${infladoCm}`;
      if (!constructores.has(clave)) constructores.set(clave, (c) => partesCorazon(infladoCm, c));
      return { clave, escala: 1 };
    }
    const tipo = formato.tipo === "link" ? "link" : "redondo";
    const perfil = tipo === "link" ? perfilLink : perfilRedondo;
    const extra = globo.cuelloExtraCm ?? 0;
    if (infladoCm >= 10) {
      // El cuello extra va proporcional al diámetro (redondeado a 0,1 %: menos de medio milímetro en un globo grande).
      const razon = Math.round((extra / infladoCm) * 1000) / 1000;
      const clave = `torno|${tipo}|${razon}`;
      if (!constructores.has(clave)) constructores.set(clave, (c) => [{ geometria: torneado(perfil(DIAMETRO_BASE, razon * DIAMETRO_BASE, CALIDAD[c].pasos), CALIDAD[c].vueltas), local: new THREE.Matrix4() }]);
      return { clave, escala: infladoCm / DIAMETRO_BASE };
    }
    const d = Math.round(infladoCm * 10) / 10, e = Math.round(extra * 20) / 20;
    const clave = `torno|${tipo}|${d}|${e}`;
    if (!constructores.has(clave)) constructores.set(clave, (c) => [{ geometria: torneado(perfil(d, e, CALIDAD[c].pasos), CALIDAD[c].vueltas), local: new THREE.Matrix4() }]);
    return { clave, escala: d > 0 ? infladoCm / d : 1 };
  }

  /** El material de látex de una familia (blanco: el color va por copia), salvo el neón, que brilla en su propio color. */
  const materialGlobo = (familia: string, hex: string, calidad: Calidad) => {
    const propio = familia === "neon";
    return material(`globo|${familia}|${propio ? hex : ""}|${calidad}`, () => materialDe(familia, propio ? hex : "#ffffff", calidad, entornoMetal()));
  };

  // ----------------------------------------------------------------------------------------------------------
  // Piezas y lotes
  // ----------------------------------------------------------------------------------------------------------
  const defs = new Map<string, DefLote>();
  const lotes = new Map<string, Lote>();
  const nodos = new Map<string, NodoDibujado>();
  /**
   * Piezas que dejaron de verse pero pueden volver tal cual (entrar y salir del editor solitario, ir a otra pestaña y
   * volver): se guardan con sus recursos y, si vuelven con la misma huella, no se rehacen. Las más viejas se liberan.
   */
  const aparcados = new Map<string, NodoDibujado>();
  /** Lo corrido (m) de cada pieza que se arrastra sin rearmar. */
  const desplazamientos = new Map<string, THREE.Vector3>();
  let anclasMalla: THREE.InstancedMesh | null = null;
  /** Lo que se mostró la última vez (si llega lo mismo, no se mira pieza por pieza). */
  let repetirModulo: (() => void) | null = null;
  let entrada: { globos: unknown; tubos: unknown; flores: unknown; cilindros: unknown; solidos: unknown } | null = null;
  let claveSala: string | null = null;
  /** Escamas de confeti por globo: el presupuesto de confeti del visor repartido entre los globos que lo llevan. */
  let topeConfeti = TOPE_CONFETI;

  function asegurarDef(clave: string, crear: () => DefLote) { if (!defs.has(clave)) defs.set(clave, crear()); }

  /** Un globo de una pieza: por instancias en sus lotes (y lo impreso aparte, en su marco). */
  function agregarGlobo(globo: GloboColocadoEnEscena, indice: number, grupo: THREE.Group, instancias: Instancia[], nodoId: string, ref: THREE.Vector3) {
    const plantilla = plantillaDe(globo);
    if (!plantilla) { grupo.add(objetoCompleto(globo, indice, entornoMetal())); return; }
    // El látex de verdad no es una esfera perfecta: cada globo sale un poco apretado o alargado (solo al dibujar).
    const marco = globo.formato.tipo === "redondo" ? marcoDeGlobo(globo).multiply(achatadoDe(nodoId, globo.nudo, ref, globo.infladoCm, globo.formato.id)) : marcoDeGlobo(globo);
    const propio = globo.familia === "neon";
    const confetiHex = globo.confetiHex ?? CONFETI_PLATA;
    const base = propio ? null : colorDeLatex(globo.familia, globo.hex);
    const color = base && globo.confeti ? base.lerp(tinteDeConfeti(confetiHex), 0.5) : base;
    const escalado = plantilla.escala !== 1 ? marco.clone().scale(new THREE.Vector3(plantilla.escala, plantilla.escala, plantilla.escala)) : marco;
    juego(plantilla.clave, "editor").forEach((parte, k) => {
      const lote = `${plantilla.clave}#${k}|${globo.familia}|${propio ? globo.hex : ""}`;
      asegurarDef(lote, () => ({
        geometria: (c) => juego(plantilla.clave, c)[k]?.geometria ?? juego(plantilla.clave, "editor")[k]!.geometria,
        material: (c) => materialGlobo(globo.familia, globo.hex, c),
        conColor: !propio,
      }));
      instancias.push({ lote, matriz: escalado.clone().multiply(parte.local), color });
    });
    if (globo.confeti && globo.formato.tipo === "redondo") {
      // Las escamas van en un lote por color de papel, sin sombra propia (miles de discos que no se notan en el piso).
      const loteConfeti = `confeti|${confetiHex}`;
      asegurarDef(loteConfeti, () => {
        const g = geometria("confeti", geometriaConfeti), m = material(loteConfeti, () => materialConfeti(confetiHex, entornoMetal()));
        return { geometria: () => g, material: () => m, conColor: false };
      });
      const centroY = (centroCuerpo("redondo", globo.infladoCm) + (globo.cuelloExtraCm ?? 0)) * CM;
      const sobre = marco.clone().multiply(new THREE.Matrix4().makeTranslation(0, centroY, 0));
      for (const disco of discosConfeti((globo.infladoCm / 2) * CM, indice + 1, topeConfeti)) instancias.push({ lote: loteConfeti, matriz: sobre.clone().multiply(disco), color: null });
    }
    const extras = extrasDeGlobo(globo, indice, false, entornoMetal());
    if (extras.length) {
      const soporte = new THREE.Group();
      marco.decompose(soporte.position, soporte.quaternion, soporte.scale);
      soporte.add(...extras);
      soporte.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      grupo.add(soporte);
    }
  }

  /** El material (compartido) del cuerpo de un tubito; el de cristal, sin transmisión (como en el editor). */
  const materialTubo = (familia: string, hex: string) => material(`tubo|${familia}|${hex}`, () => materialDe(familia, hex, familia === "cristal" ? "editor" : "alta", entornoMetal()));

  function agregarTubo(tramo: TuboEnEscena, grupo: THREE.Group, instancias: Instancia[]) {
    const m = materialTubo(tramo.familia, tramo.hex);
    const objeto = tuboEnCurva(tramo, m, false);
    if (tramo.relleno && tramo.cerrado) { const relleno = rellenoPlano(tramo.puntos, m); if (relleno) objeto.add(relleno); }
    objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
    grupo.add(objeto);
    // Las puntas redondeadas, por instancias.
    const curva = tramo.cerrado ? null : curvaDeTubo(tramo);
    if (!curva) return;
    const propio = tramo.familia === "neon";
    const lote = `punta|${tramo.familia}|${propio ? tramo.hex : ""}`;
    asegurarDef(lote, () => {
      const g = geometria("punta", () => new THREE.SphereGeometry(1, 16, 10));
      return { geometria: () => g, material: (c) => materialGlobo(tramo.familia, tramo.hex, c), conColor: !propio };
    });
    const radio = (tramo.grosorCm / 2) * CM;
    const color = propio ? null : colorDeLatex(tramo.familia, tramo.hex);
    for (const t of [0, 1]) instancias.push({ lote, matriz: new THREE.Matrix4().makeScale(radio, radio, radio).setPosition(curva.getPoint(t)), color });
  }

  function agregarFlor(flor: FlorEnEscena, indice: number, instancias: Instancia[]) {
    const q = new THREE.Quaternion().setFromUnitVectors(ARRIBA, new THREE.Vector3(flor.normal.x, flor.normal.y, flor.normal.z).normalize());
    const marco = new THREE.Matrix4().compose(new THREE.Vector3(flor.posicion.x * CM, flor.posicion.y * CM, flor.posicion.z * CM), q, new THREE.Vector3(1, 1, 1));
    for (const pieza of partesFlor(flor, indice + 7)) {
      const lote = `flor|${pieza.parte}`;
      asegurarDef(lote, () => {
        const g = geometria(lote, () => geometriaParteFlor(pieza.parte)), m = material(lote, () => materialParteFlor(pieza.parte));
        return { geometria: () => g, material: () => m, conColor: !colorPropio(pieza.parte) };
      });
      instancias.push({ lote, matriz: marco.clone().multiply(pieza.local), color: pieza.color });
    }
  }

  function construirNodo(id: string, c: ContenidoNodo, ref: THREE.Vector3, huella: string): NodoDibujado {
    const grupo = new THREE.Group();
    if (id) grupo.userData.nodo = id;
    const instancias: Instancia[] = [];
    for (const { g, i } of c.globos) agregarGlobo(g, i, grupo, instancias, id, ref);
    for (const tramo of c.tubos) agregarTubo(tramo, grupo, instancias);
    // Follaje (no es globo): flores artificiales mirando hacia fuera de su hueco.
    for (const { f, i } of c.flores) agregarFlor(f, i, instancias);
    // Volúmenes de la escena (el pedestal, los hilos de lo que cuelga del techo).
    for (const x of c.cilindros) {
      const cilindro = new THREE.Mesh(new THREE.CylinderGeometry(x.radioCm * CM, x.radioCm * CM, x.altoCm * CM, 48), new THREE.MeshStandardMaterial({ color: new THREE.Color(x.hex), roughness: 0.55 }));
      cilindro.position.set(x.base.x * CM, (x.base.y + x.altoCm / 2) * CM, x.base.z * CM);
      cilindro.castShadow = true;
      cilindro.receiveShadow = true;
      grupo.add(cilindro);
    }
    // Escenografía (paneles, mesas, tapete): con su pieza, para elegirla y arrastrarla como a las demás.
    // Lo oculto (amarres internos) sostiene y da su caja, pero no se dibuja.
    for (const malla of escenografia.piezas(c.solidos)) grupo.add(malla);
    modulo.add(grupo);
    return { huella, ref: ref.clone(), base: new THREE.Vector3(), grupo, instancias, caja: null, conRotulo: c.solidos.some((x) => x.rotulo !== undefined || x.motivo?.estilo === "neon") };
  }

  function quitarNodo(dibujado: NodoDibujado) {
    modulo.remove(dibujado.grupo);
    liberar(dibujado.grupo);
  }

  /** Guarda una pieza que dejó de verse (sin liberarla) por si vuelve. */
  function aparcar(id: string, dibujado: NodoDibujado) {
    modulo.remove(dibujado.grupo);
    const previo = aparcados.get(id);
    if (previo) { aparcados.delete(id); liberar(previo.grupo); }
    aparcados.set(id, dibujado);
    while (aparcados.size > MAX_APARCADOS) {
      const [viejo, nodo] = aparcados.entries().next().value ?? [];
      if (viejo === undefined || !nodo) break;
      aparcados.delete(viejo);
      liberar(nodo.grupo);
    }
  }

  /** Saca una pieza aparcada (vuelve a estar en el módulo, donde se dejó). */
  function desaparcar(id: string): NodoDibujado | undefined {
    const dibujado = aparcados.get(id);
    if (!dibujado) return undefined;
    aparcados.delete(id);
    dibujado.grupo.position.copy(dibujado.base);
    dibujado.caja = null;
    modulo.add(dibujado.grupo);
    return dibujado;
  }

  /** Pieza por pieza: rehace solo las que cambiaron y corre las que solo se movieron. Devuelve si cambió algo. */
  function actualizarNodos(globos: readonly GloboColocadoEnEscena[], tubos: readonly TuboEnEscena[], flores: readonly FlorEnEscena[], cilindros: readonly CilindroEnEscena[], solidos: readonly SolidoEnEscena[]): boolean {
    topeConfeti = topePorGlobo(globos.reduce((n, g) => n + (g.confeti ? 1 : 0), 0));
    const porNodo = new Map<string, ContenidoNodo>();
    const de = (nodo: string | undefined): ContenidoNodo => {
      const id = nodo ?? "";
      let c = porNodo.get(id);
      if (!c) { c = { globos: [], tubos: [], flores: [], cilindros: [], solidos: [] }; porNodo.set(id, c); }
      return c;
    };
    globos.forEach((g, i) => de(g.nodo).globos.push({ g, i }));
    for (const t of tubos) de(t.nodo).tubos.push(t);
    flores.forEach((f, i) => de(f.nodo).flores.push({ f, i }));
    for (const x of cilindros) de(x.nodo).cilindros.push(x);
    for (const s of solidos) de(s.nodo).solidos.push(s);
    let cambio = false;
    for (const [id, dibujado] of nodos) if (!porNodo.has(id)) { aparcar(id, dibujado); nodos.delete(id); cambio = true; }
    for (const [id, c] of porNodo) {
      const ref = referenciaDe(c);
      const huella = huellaDe(c, ref, topeConfeti);
      let previo = nodos.get(id);
      if (!previo) {
        // Una pieza que vuelve (salir del editor solitario): se recupera la dibujada, sin rehacerla.
        previo = desaparcar(id);
        if (previo) { nodos.set(id, previo); cambio = true; }
      }
      if (previo && previo.huella === huella) {
        if (!previo.ref.equals(ref)) {
          // La misma pieza, corrida: se mueve su grupo y sus copias, sin rehacer nada.
          const d = ref.clone().sub(previo.ref).multiplyScalar(CM);
          previo.ref.copy(ref);
          previo.base.add(d);
          previo.grupo.position.copy(previo.base);
          for (const inst of previo.instancias) { const e = inst.matriz.elements; e[12] += d.x; e[13] += d.y; e[14] += d.z; }
          previo.caja = null;
          cambio = true;
        }
        continue;
      }
      if (previo) quitarNodo(previo);
      nodos.set(id, construirNodo(id, c, ref, huella));
      cambio = true;
    }
    return cambio;
  }

  function quitarLote(lote: Lote) {
    modulo.remove(lote.malla);
    lote.malla.dispose();
  }

  /** Escribe las matrices de un lote: la de cada copia, corrida si su pieza se arrastra; las ocultas, sin tamaño. */
  function escribirLote(lote: Lote) {
    const destino = lote.malla.instanceMatrix.array as Float32Array;
    for (let i = 0; i < lote.malla.count; i++) {
      const o = i * 16;
      destino.set(lote.bases.subarray(o, o + 16), o);
      const nodo = lote.nodos[i];
      const d = nodo ? desplazamientos.get(nodo) : undefined;
      if (d) { destino[o + 12]! += d.x; destino[o + 13]! += d.y; destino[o + 14]! += d.z; }
      if (lote.ocultos.has(i)) for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) destino[o + k] = 0;
    }
    lote.malla.instanceMatrix.needsUpdate = true;
    lote.malla.boundingBox = null;
    lote.malla.boundingSphere = null;
  }

  /** Reparte las copias de todas las piezas en sus lotes (una malla por geometría y material). */
  function armarLotes() {
    const porLote = new Map<string, Array<{ nodo: string | null; inst: Instancia }>>();
    for (const [id, dibujado] of nodos) for (const inst of dibujado.instancias) {
      let lista = porLote.get(inst.lote);
      if (!lista) { lista = []; porLote.set(inst.lote, lista); }
      lista.push({ nodo: id || null, inst });
    }
    for (const [clave, lote] of lotes) if (!porLote.has(clave)) { quitarLote(lote); lotes.delete(clave); }
    for (const [clave, lista] of porLote) {
      const def = defs.get(clave);
      if (!def) continue;
      let lote = lotes.get(clave);
      if (!lote || lote.capacidad < lista.length) {
        if (lote) quitarLote(lote);
        const capacidad = Math.ceil(lista.length * 1.25) + 4;
        const malla = new THREE.InstancedMesh(def.geometria("editor"), def.material("editor"), capacidad);
        // Ni el confeti (miles de discos) ni las hebras de la pampa (translúcidas) echan sombra: no se nota y cuesta una pasada más.
        malla.castShadow = !clave.startsWith("confeti|") && clave !== "flor|pluma";
        malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        lote = { def, malla, capacidad, nodos: [], bases: new Float32Array(capacidad * 16), ocultos: new Set() };
        // Con qué pieza va cada copia (para elegirla con un clic).
        malla.userData.nodos = lote.nodos;
        lotes.set(clave, lote);
        modulo.add(malla);
      }
      lote.nodos.length = 0;
      lote.ocultos.clear();
      lote.malla.count = lista.length;
      lista.forEach(({ nodo, inst }, i) => {
        lote.nodos.push(nodo);
        inst.matriz.toArray(lote.bases, i * 16);
        if (def.conColor) lote.malla.setColorAt(i, inst.color ?? BLANCO);
      });
      if (lote.malla.instanceColor) lote.malla.instanceColor.needsUpdate = true;
      escribirLote(lote);
    }
  }

  /** Lo de la pestaña Globos y lo de un módulo no conviven: al pasar de uno a otro se vacía el otro. */
  function vaciarModulo() {
    for (const dibujado of nodos.values()) quitarNodo(dibujado);
    nodos.clear();
    for (const dibujado of aparcados.values()) liberar(dibujado.grupo);
    aparcados.clear();
    for (const lote of lotes.values()) quitarLote(lote);
    lotes.clear();
    if (anclasMalla) { modulo.remove(anclasMalla); anclasMalla.dispose(); anclasMalla = null; }
    desplazamientos.clear();
    entrada = null;
    modulo.position.set(0, 0, 0);
  }

  function liberar(objeto: THREE.Object3D) {
    objeto.traverse((hijo) => {
      if (hijo instanceof THREE.Mesh) {
        // Lo que una malla usa prestado de su visor (el texto de un rótulo) se avisa al liberarla: una sola vez.
        const alLiberar: unknown = hijo.userData.alLiberar;
        if (typeof alLiberar === "function") { hijo.userData.alLiberar = undefined; alLiberar(); }
        if (!hijo.geometry.userData.compartido) hijo.geometry.dispose();
        const materialesHijo = Array.isArray(hijo.material) ? hijo.material : [hijo.material];
        for (const m of materialesHijo) {
          if (m.userData.compartido) continue;
          if ((m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial) && m.map && !m.map.userData.compartido) m.map.dispose();
          m.dispose();
        }
        if (hijo instanceof THREE.InstancedMesh) hijo.dispose();
      }
    });
  }

  function vaciar(grupo: THREE.Group) {
    for (const hijo of [...grupo.children]) {
      grupo.remove(hijo);
      liberar(hijo);
      if (hijo instanceof THREE.Box3Helper) { hijo.geometry.dispose(); (hijo.material as THREE.Material).dispose(); }
    }
  }

  /**
   * Piso, paredes y techo como planos que miran hacia dentro (`FrontSide`): desde fuera no se dibujan, así que al
   * girar la cámara por detrás de una pared o por encima del techo, esa superficie desaparece y se ve el interior.
   * Solo se rehace si la sala cambió.
   */
  function dibujarSala(datos: SalaEnEscena | undefined): boolean {
    const clave = datos ? JSON.stringify(datos) : "";
    if (clave === claveSala) return false;
    claveSala = clave;
    vaciar(sala);
    const conPiso = Boolean(datos?.mostrar.piso);
    piso.visible = !conPiso;
    cuadricula.visible = !datos;
    ajustarSombraDelSol(sol, datos ? { anchoM: datos.anchoCm * CM, fondoM: datos.fondoCm * CM, altoM: datos.altoCm * CM } : null);
    if (!datos) { lucesDeSala.aplicar(false); return true; }
    const ancho = datos.anchoCm * CM, fondo = datos.fondoCm * CM, alto = datos.altoCm * CM;
    const ambiente = ambienteDe(datos.ambiente);
    lucesDeSala.aplicar(ambienteActivo(datos.ambiente));
    const plano = (w: number, h: number, hex: string, colocar: (m: THREE.Mesh) => void, superficie: SuperficieSalaEnEscena, material?: THREE.Material) => {
      const malla = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material ?? new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.92, metalness: 0, side: THREE.FrontSide }));
      malla.receiveShadow = true;
      malla.userData.superficie = superficie;
      colocar(malla);
      sala.add(malla);
    };
    if (datos.mostrar.piso) {
      if (ambiente.piso === "madera" && tablones === undefined) tablones = texturaTablones(anisotropia);
      const material = ambiente.piso === "madera" && tablones ? materialPiso(datos.tonos.piso, tablones, entornoMetal(), ancho, fondo) : undefined;
      plano(ancho, fondo, datos.tonos.piso, (m) => { m.rotation.x = -Math.PI / 2; m.position.y = -0.001; }, "piso", material);
    }
    if (datos.mostrar.fondo) plano(ancho, alto, datos.tonos.paredes, (m) => { m.position.set(0, alto / 2, -fondo / 2); }, "fondo");
    if (datos.mostrar.laterales) {
      plano(fondo, alto, datos.tonos.paredes, (m) => { m.rotation.y = Math.PI / 2; m.position.set(-ancho / 2, alto / 2, 0); }, "izquierda");
      plano(fondo, alto, datos.tonos.paredes, (m) => { m.rotation.y = -Math.PI / 2; m.position.set(ancho / 2, alto / 2, 0); }, "derecha");
    }
    if (datos.mostrar.techo) {
      // El techo mira hacia abajo y casi no le llega luz: un poco de emisión lo deja del tono que se eligió.
      const techo = new THREE.MeshStandardMaterial({ color: new THREE.Color(datos.tonos.techo), roughness: 0.92, metalness: 0, side: THREE.FrontSide });
      if (ambiente.luces) {
        techo.emissive = new THREE.Color(datos.tonos.techo);
        techo.emissiveIntensity = 0.5;
        techo.userData.emisionBase = { color: techo.emissive.clone(), intensidad: 0.5 };
      }
      plano(ancho, fondo, datos.tonos.techo, (m) => { m.rotation.x = Math.PI / 2; m.position.y = alto; }, "techo", techo);
      if (ambiente.luces) sala.add(lucesDeTecho(ancho, fondo, alto));
    }
    if (ambiente.ventana && datos.mostrar.laterales) sala.add(ventanaDerecha(ancho, fondo));
    return true;
  }

  function resaltar(caja: CajaEnEscena | null | undefined) {
    vaciar(ayudas);
    resaltado = null;
    if (!caja) return;
    const margen = 3;
    const box = new THREE.Box3(
      new THREE.Vector3((caja.min.x - margen) * CM, (caja.min.y - margen) * CM, (caja.min.z - margen) * CM),
      new THREE.Vector3((caja.max.x + margen) * CM, (caja.max.y + margen) * CM, (caja.max.z + margen) * CM),
    );
    const ayuda = new THREE.Box3Helper(box.clone(), new THREE.Color(0x8f6ef5));
    ayudas.add(ayuda);
    resaltado = { caja: box, ayuda };
  }

  function encuadrar() {
    const caja = new THREE.Box3().setFromObject(contenido);
    const centro = caja.getCenter(new THREE.Vector3());
    const tamano = caja.getSize(new THREE.Vector3());
    const radio = Math.max(tamano.x, tamano.y, tamano.z, 0.05) * 0.62;
    const distancia = radio / Math.tan(THREE.MathUtils.degToRad(camara.fov / 2)) * 0.9;
    camara.position.set(centro.x + distancia * 0.35, centro.y + distancia * 0.25, centro.z + distancia);
    camara.near = distancia / 100;
    camara.far = distancia * 20;
    camara.updateProjectionMatrix();
    controles.target.copy(centro);
    controles.minDistance = distancia * 0.25;
    controles.maxDistance = distancia * 4;
    controles.update();
  }

  /** La cámara mirando a lo que se ve desde una dirección fija, con todo en cuadro (`3d`: el ángulo de siempre). */
  function verDesde(vista: VistaFija) {
    if (vista === "3d") { encuadrar(); pedirCuadro(); return; }
    const caja = new THREE.Box3().setFromObject(contenido);
    if (caja.isEmpty()) return;
    const centro = caja.getCenter(new THREE.Vector3());
    const tamano = caja.getSize(new THREE.Vector3());
    // Ancho y alto de lo que se ve en pantalla, y lo hondo (la cámara se aleja además media profundidad).
    const [ancho, alto, hondo, direccion] = vista === "frente" ? [tamano.x, tamano.y, tamano.z, new THREE.Vector3(0, 0, 1)]
      : vista === "lado" ? [tamano.z, tamano.y, tamano.x, new THREE.Vector3(1, 0, 0)]
        // Desde arriba, apenas inclinada (justo encima, los controles de órbita no saben hacia dónde es «arriba»).
        : [tamano.x, tamano.z, tamano.y, new THREE.Vector3(0, 1, 0.002).normalize()];
    const medioFov = THREE.MathUtils.degToRad(camara.fov / 2);
    const lejos = Math.max(alto / 2 / Math.tan(medioFov), ancho / 2 / (Math.tan(medioFov) * Math.max(camara.aspect, 0.1)), 0.05) * 1.12 + hondo / 2;
    camara.position.copy(centro).addScaledVector(direccion, lejos);
    camara.near = lejos / 100;
    camara.far = lejos * 20;
    camara.updateProjectionMatrix();
    controles.target.copy(centro);
    controles.minDistance = lejos * 0.25;
    controles.maxDistance = lejos * 4;
    controles.update();
    pedirCuadro();
  }

  function mostrar(globos: readonly GloboEnEscena[]) {
    vaciarModulo();
    vaciar(fila);
    dibujarSala(undefined);
    resaltar(null);
    let x = 0;
    const objetos = globos.map((globo) => construir(globo, entornoMetal()));
    const separacion = 0.06;
    const total = objetos.reduce((suma, o) => suma + ancho(o), 0) + separacion * Math.max(0, objetos.length - 1);
    x = -total / 2;
    for (const objeto of objetos) {
      const a = ancho(objeto);
      const caja = new THREE.Box3().setFromObject(objeto);
      objeto.position.x += x - caja.min.x;
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      fila.add(objeto);
      x += a + separacion;
    }
    escena.updateMatrixWorld();
    encuadrar();
    cambioConSombra();
  }

  /** Las anclas a la vista (puntos donde se cuelga una decoración hija): una malla por instancias. */
  function dibujarAnclas(anclas: readonly Punto3[]): boolean {
    const antes = anclasMalla;
    if (!antes && !anclas.length) return false;
    if (antes) {
      const iguales = antes.count === anclas.length && anclas.every((a, i) => {
        const e = antes.instanceMatrix.array;
        return Math.abs(e[i * 16 + 12]! - a.x * CM) < 1e-9 && Math.abs(e[i * 16 + 13]! - a.y * CM) < 1e-9 && Math.abs(e[i * 16 + 14]! - a.z * CM) < 1e-9;
      });
      if (iguales) return false;
      modulo.remove(antes);
      antes.dispose();
      anclasMalla = null;
    }
    if (!anclas.length) return true;
    const malla = new THREE.InstancedMesh(
      geometria("ancla", () => new THREE.SphereGeometry(1.4 * CM, 20, 12)),
      material("ancla", () => new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x7c3aed, emissiveIntensity: 0.6 })),
      anclas.length,
    );
    const m = new THREE.Matrix4();
    anclas.forEach((a, i) => malla.setMatrixAt(i, m.makeTranslation(a.x * CM, a.y * CM, a.z * CM)));
    modulo.add(malla);
    anclasMalla = malla;
    return true;
  }

  /** Vuelve a mostrar lo último que se mostró, con las piezas con rótulo rehechas (la letra cursiva terminó de cargar: antes eran una marca). */
  function rehacerRotulos() {
    if (!vivo || !repetirModulo) return;
    for (const d of [...nodos.values(), ...[...aparcados.values()]]) if (d.conRotulo) d.huella = "";
    entrada = null;
    repetirModulo();
  }

  function mostrarModulo(globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos: readonly TuboEnEscena[] = NADA, extras: ExtrasEscena = {}) {
    repetirModulo = () => mostrarModulo(globos, anclas, tubos, extras);
    vaciar(fila);
    const flores = extras.flores ?? NADA, cilindros = extras.cilindros ?? NADA, solidos = extras.solidos ?? NADA;
    // Lo corrido al arrastrar y lo oculto vuelve a su sitio (lo siguiente que se muestra lo dibuja todo en su sitio).
    let reescribir = desplazamientos.size > 0;
    if (reescribir) {
      desplazamientos.clear();
      for (const dibujado of nodos.values()) { dibujado.grupo.position.copy(dibujado.base); dibujado.caja = null; }
    }
    for (const dibujado of nodos.values()) for (const hijo of dibujado.grupo.children) hijo.visible = true;
    for (const lote of lotes.values()) if (lote.ocultos.size) { lote.ocultos.clear(); reescribir = true; }
    // Si llega exactamente lo mismo (elegir otra pieza, ver sus anclas) no se mira pieza por pieza.
    const mismo = entrada !== null && entrada.globos === globos && entrada.tubos === tubos && entrada.flores === flores && entrada.cilindros === cilindros && entrada.solidos === solidos;
    let cambio = false;
    if (!mismo) {
      cambio = actualizarNodos(globos, tubos, flores, cilindros, solidos);
      entrada = { globos, tubos, flores, cilindros, solidos };
    }
    if (cambio) armarLotes();
    else if (reescribir) for (const lote of lotes.values()) escribirLote(lote);
    const cambioSala = dibujarSala(extras.sala);
    resaltar(extras.resaltado);
    const cambioAnclas = dibujarAnclas(anclas);
    if (cambio || cambioAnclas || cambioSala) {
      // Apoyado sobre el piso (una escena ya viene en coordenadas del mundo).
      modulo.position.set(0, 0, 0);
      if (!extras.sala) {
        const caja = new THREE.Box3().setFromObject(modulo);
        if (!caja.isEmpty()) modulo.position.y = -caja.min.y + 0.005;
      }
    }
    escena.updateMatrixWorld();
    if (extras.encuadrar !== false) encuadrar();
    if (cambio || reescribir || cambioAnclas || cambioSala) cambioConSombra();
    else pedirCuadro();
  }

  function redimensionar() {
    const { clientWidth, clientHeight } = lienzo;
    if (!clientWidth || !clientHeight) return;
    // Densidad con tope: hasta 2× y nunca más de ~3,5 millones de píxeles dibujados (un teléfono de 3×, una tablet
    // grande o una pantalla 4K no se calientan; el escritorio común queda igual que antes).
    const porPresupuesto = Math.sqrt(PIXELES_MAXIMOS / (clientWidth * clientHeight));
    const densidad = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, porPresupuesto));
    if (Math.abs(renderer.getPixelRatio() - densidad) > 0.01) renderer.setPixelRatio(densidad);
    renderer.setSize(clientWidth, clientHeight, false);
    camara.aspect = clientWidth / clientHeight;
    camara.updateProjectionMatrix();
    // Cambiar el tamaño borra el lienzo: se dibuja ya (no en el cuadro siguiente) para que no parpadee.
    dibujar();
  }

  const rayo = new THREE.Raycaster();
  function apuntar(clienteX: number, clienteY: number) {
    const r = lienzo.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    rayo.setFromCamera(new THREE.Vector2(((clienteX - r.left) / r.width) * 2 - 1, -((clienteY - r.top) / r.height) * 2 + 1), camara);
    return true;
  }

  /** La pieza de lo tocado: la de su copia en un lote o la del grupo que lo contiene; `null` si no es de ninguna. */
  function nodoDeToque(toque: THREE.Intersection): string | null {
    const o = toque.object;
    if (o instanceof THREE.InstancedMesh && toque.instanceId !== undefined) {
      const lista: unknown = o.userData.nodos;
      if (Array.isArray(lista)) { const nodo: unknown = lista[toque.instanceId]; return typeof nodo === "string" ? nodo : null; }
    }
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      const nodo: unknown = p.userData.nodo;
      if (typeof nodo === "string") return nodo;
    }
    return null;
  }

  /** Lo que se puede tocar de las piezas `ids` (o de todas): sus grupos y los lotes (filtrar luego por pieza). */
  function objetivos(ids?: Iterable<string>): THREE.Object3D[] {
    const salida: THREE.Object3D[] = [];
    if (ids) { for (const id of ids) { const d = id ? nodos.get(id) : undefined; if (d) salida.push(d.grupo); } }
    else for (const [id, d] of nodos) if (id) salida.push(d.grupo);
    for (const lote of lotes.values()) salida.push(lote.malla);
    return salida;
  }

  const hayPiezas = () => { for (const id of nodos.keys()) if (id) return true; return false; };

  function piezaEn(clienteX: number, clienteY: number): { nodo: string; punto: Punto3 } | null {
    if (!hayPiezas() || !apuntar(clienteX, clienteY)) return null;
    for (const toque of rayo.intersectObjects(objetivos(), true)) {
      const nodo = nodoDeToque(toque);
      if (nodo) return { nodo, punto: { x: toque.point.x / CM, y: toque.point.y / CM, z: toque.point.z / CM } };
    }
    return null;
  }

  function puntoEnPlano(clienteX: number, clienteY: number, punto: Punto3, normal: Punto3): Punto3 | null {
    if (!apuntar(clienteX, clienteY)) return null;
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(punto.x * CM, punto.y * CM, punto.z * CM));
    // Casi de canto el corte se va lejísimos: mejor no mover.
    if (Math.abs(rayo.ray.direction.dot(n)) < 0.05) return null;
    const corte = rayo.ray.intersectPlane(plano, new THREE.Vector3());
    return corte ? { x: corte.x / CM, y: corte.y / CM, z: corte.z / CM } : null;
  }

  function trasladarPiezas(ids: readonly string[], delta: Punto3) {
    const d = new THREE.Vector3(delta.x * CM, delta.y * CM, delta.z * CM);
    for (const id of ids) {
      const dibujado = nodos.get(id);
      if (!dibujado) continue;
      if (d.lengthSq() > 0) desplazamientos.set(id, d.clone()); else desplazamientos.delete(id);
      dibujado.grupo.position.copy(dibujado.base).add(d);
      dibujado.caja = null;
    }
    for (const lote of lotes.values()) if (lote.nodos.some((n) => n !== null && ids.includes(n))) escribirLote(lote);
    if (resaltado) resaltado.ayuda.box.copy(resaltado.caja).translate(d);
    escena.updateMatrixWorld();
    cambioConSombra();
  }

  function ejesCamara(): { adelante: Punto3; derecha: Punto3 } {
    const f = camara.getWorldDirection(new THREE.Vector3());
    f.y = 0;
    if (f.lengthSq() < 1e-8) f.set(0, 0, -1);
    f.normalize();
    return { adelante: { x: f.x, y: 0, z: f.z }, derecha: { x: -f.z, y: 0, z: f.x } };
  }

  /** Una caja (cm) como ayuda de líneas, con un margen. */
  function cajaDeAyuda(caja: CajaEnEscena, color: number, margen: number): THREE.Box3Helper {
    const box = new THREE.Box3(
      new THREE.Vector3((caja.min.x - margen) * CM, (caja.min.y - margen) * CM, (caja.min.z - margen) * CM),
      new THREE.Vector3((caja.max.x + margen) * CM, (caja.max.y + margen) * CM, (caja.max.z + margen) * CM),
    );
    return new THREE.Box3Helper(box, new THREE.Color(color));
  }

  /** El marco en el mundo de la copia `i` de un lote (con lo corrido u oculto). */
  function marcoDeCopia(malla: THREE.InstancedMesh, i: number, salida: THREE.Matrix4): THREE.Matrix4 {
    malla.getMatrixAt(i, salida);
    return salida.premultiply(malla.matrixWorld);
  }

  /** La caja (m, en el mundo) de lo dibujado de una pieza: su grupo y sus copias. */
  function cajaDeNodo(id: string): THREE.Box3 | null {
    const dibujado = nodos.get(id);
    if (!dibujado) return null;
    if (dibujado.caja) return dibujado.caja;
    const caja = new THREE.Box3().setFromObject(dibujado.grupo);
    const m = new THREE.Matrix4(), b = new THREE.Box3();
    for (const lote of lotes.values()) {
      const g = lote.malla.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      lote.nodos.forEach((n, i) => { if (n === id && g.boundingBox) caja.union(b.copy(g.boundingBox).applyMatrix4(marcoDeCopia(lote.malla, i, m))); });
    }
    dibujado.caja = caja;
    return caja;
  }

  function lugarEn(clienteX: number, clienteY: number, opciones: { nodos: readonly string[]; sala: boolean; preferir?: string | null }): LugarEnEscena | null {
    if (!apuntar(clienteX, clienteY)) return null;
    const deToque = (toque: THREE.Intersection): LugarEnEscena | null => {
      const punto = { x: toque.point.x / CM, y: toque.point.y / CM, z: toque.point.z / CM };
      const nodo = nodoDeToque(toque);
      if (nodo) {
        let n: THREE.Vector3;
        if (!toque.face) n = rayo.ray.direction.clone().negate();
        else if (toque.object instanceof THREE.InstancedMesh && toque.instanceId !== undefined) n = toque.face.normal.clone().transformDirection(marcoDeCopia(toque.object, toque.instanceId, new THREE.Matrix4()));
        else n = toque.face.normal.clone().transformDirection(toque.object.matrixWorld);
        return { tipo: "nodo", nodo, punto, normal: { x: n.x, y: n.y, z: n.z } };
      }
      for (let o: THREE.Object3D | null = toque.object; o; o = o.parent) {
        const superficie: unknown = o.userData.superficie;
        if (typeof superficie === "string") return { tipo: "sala", superficie: superficie as SuperficieSalaEnEscena, punto };
      }
      return null;
    };
    /** Lo primero que toca el rayo entre esas piezas (y, si se pide, la sala). */
    const tocar = (permitidas: ReadonlySet<string>, conSala: boolean): THREE.Intersection | null => {
      const objetos = objetivos(permitidas);
      if (conSala) objetos.push(...sala.children);
      for (const toque of rayo.intersectObjects(objetos, true)) {
        const nodo = nodoDeToque(toque);
        if (nodo ? permitidas.has(nodo) : conSala && deToque(toque)) return toque;
      }
      return null;
    };
    const preferir = opciones.preferir;
    if (preferir && nodos.has(preferir)) {
      const toque = tocar(new Set([preferir]), false);
      if (toque) return deToque(toque);
    }
    const permitidas = new Set(opciones.nodos.filter((id) => nodos.has(id)));
    const primero = tocar(permitidas, opciones.sala);
    const lugar = primero ? deToque(primero) : null;
    if (lugar?.tipo !== "sala") return lugar;
    // El rayo pasó por un hueco de una estructura (los rombos de una malla, entre los globos de un aro) y dio en la
    // pared de detrás: si cruza la caja de una estructura, se busca esa estructura unos píxeles alrededor.
    const cruzadas = new Set([...permitidas].filter((id) => { const caja = cajaDeNodo(id); return caja ? rayo.ray.intersectsBox(caja) : false; }));
    if (!cruzadas.size) return lugar;
    for (let radio = 4; radio <= 16; radio += 4) {
      let mejor: THREE.Intersection | null = null;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        if (!apuntar(clienteX + Math.cos(a) * radio, clienteY + Math.sin(a) * radio)) continue;
        const toque = tocar(cruzadas, false);
        if (toque && (!mejor || toque.distance < mejor.distance)) mejor = toque;
      }
      if (mejor) return deToque(mejor) ?? lugar;
    }
    return lugar;
  }

  function resaltarLugares(cajas: readonly CajaEnEscena[], conSala: boolean) {
    vaciar(marcasLugares);
    for (const caja of cajas) marcasLugares.add(cajaDeAyuda(caja, 0x10b981, 4));
    sala.traverse((hijo) => {
      if (hijo instanceof THREE.Mesh && hijo.material instanceof THREE.MeshStandardMaterial) {
        const base = hijo.material.userData.emisionBase as { color: THREE.Color; intensidad: number } | undefined;
        hijo.material.emissive.set(conSala ? 0x10b981 : base?.color ?? 0x000000);
        hijo.material.emissiveIntensity = conSala ? 0.16 : base?.intensidad ?? 1;
      }
    });
    pedirCuadro();
  }

  function resaltarEncima(caja: CajaEnEscena | null) {
    if (!caja && !marcaEncima.children.length) return;
    vaciar(marcaEncima);
    if (caja) marcaEncima.add(cajaDeAyuda(caja, 0xf59e0b, 2));
    pedirCuadro();
  }

  /** Un globo suelto con las geometrías compartidas del editor y el material que se pida (la vista previa). */
  function objetoSuelto(globo: GloboColocadoEnEscena, indice: number, materialPara: (familia: string, hex: string) => THREE.Material): THREE.Object3D {
    const plantilla = plantillaDe(globo);
    if (!plantilla) return objetoCompleto(globo, indice, entornoMetal());
    const objeto = new THREE.Group();
    const m = materialPara(globo.familia, globo.hex);
    const escala = new THREE.Matrix4().makeScale(plantilla.escala, plantilla.escala, plantilla.escala);
    for (const parte of juego(plantilla.clave, "editor")) {
      const malla = new THREE.Mesh(parte.geometria, m);
      escala.clone().multiply(parte.local).decompose(malla.position, malla.quaternion, malla.scale);
      objeto.add(malla);
    }
    const extras = extrasDeGlobo(globo, indice, true, entornoMetal());
    if (extras.length) objeto.add(...extras);
    orientacionDe(globo, objeto.quaternion);
    objeto.position.set(globo.nudo.x * CM, globo.nudo.y * CM, globo.nudo.z * CM);
    // El mismo achatado que el de las piezas dibujadas (la vista previa no sabe a qué pieza irá: se guía por su sitio).
    if (globo.formato.tipo === "redondo") objeto.scale.setFromMatrixScale(achatadoDe(globo.nodo ?? "", globo.nudo, SIN_REFERENCIA, globo.infladoCm, globo.formato.id));
    return objeto;
  }

  function mostrarFantasma(globos: readonly GloboColocadoEnEscena[], tubos: readonly TuboEnEscena[]) {
    const habia = fantasma.children.length > 0;
    vaciar(fantasma);
    if (!habia && !globos.length && !tubos.length) return;
    const translucido = (m: THREE.Material) => { m.transparent = true; m.opacity = 0.6; m.depthWrite = false; };
    // Un material translúcido por color (propio de la vista previa: se libera con ella).
    const propios = new Map<string, THREE.Material>();
    const materialPara = (familia: string, hex: string) => {
      const clave = `${familia}|${hex}`;
      let m = propios.get(clave);
      if (!m) { m = materialDe(familia, hex, "editor", entornoMetal()); translucido(m); propios.set(clave, m); }
      return m;
    };
    for (const [indice, globo] of globos.entries()) fantasma.add(objetoSuelto(globo, indice, materialPara));
    for (const tramo of tubos) fantasma.add(tuboEnCurva(tramo, materialPara(tramo.familia, tramo.hex)));
    fantasma.traverse((hijo) => {
      if (!(hijo instanceof THREE.Mesh)) return;
      hijo.castShadow = false;
      (Array.isArray(hijo.material) ? hijo.material : [hijo.material]).forEach((m: THREE.Material) => { if (!m.userData.compartido) translucido(m); });
    });
    pedirCuadro();
  }

  function ocultarCopia(nodo: string | null, caja?: CajaEnEscena | null) {
    const dentro = (centro: THREE.Vector3) => {
      if (!caja) return false;
      const c = centro.divideScalar(CM);
      const en = (eje: "x" | "y" | "z") => c[eje] >= caja.min[eje] - 3 && c[eje] <= caja.max[eje] + 3;
      return en("x") && en("y") && en("z");
    };
    for (const [id, dibujado] of nodos) {
      for (const hijo of dibujado.grupo.children) {
        if (id !== nodo || !caja) { hijo.visible = true; continue; }
        hijo.visible = !dentro(new THREE.Box3().setFromObject(hijo).getCenter(new THREE.Vector3()));
      }
    }
    const m = new THREE.Matrix4(), b = new THREE.Box3();
    for (const lote of lotes.values()) {
      const antes = lote.ocultos.size;
      lote.ocultos.clear();
      if (nodo && caja) {
        const g = lote.malla.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        lote.nodos.forEach((n, i) => {
          if (n !== nodo || !g.boundingBox) return;
          m.fromArray(lote.bases, i * 16).premultiply(lote.malla.matrixWorld);
          if (dentro(b.copy(g.boundingBox).applyMatrix4(m).getCenter(new THREE.Vector3()))) lote.ocultos.add(i);
        });
      }
      if (antes || lote.ocultos.size) escribirLote(lote);
    }
    const dibujado = nodo ? nodos.get(nodo) : undefined;
    if (dibujado) dibujado.caja = null;
    cambioConSombra();
  }

  /** Cambia la calidad de lo que va por lotes (la captura para la IA se hace en alta). */
  function usarCalidad(calidad: Calidad) {
    for (const lote of lotes.values()) {
      lote.malla.geometry = lote.def.geometria(calidad);
      lote.malla.material = lote.def.material(calidad);
      lote.malla.boundingBox = null;
      lote.malla.boundingSphere = null;
    }
    renderer.shadowMap.needsUpdate = true;
  }

  redimensionar();
  pedirCuadro();

  const medible: VisorMedible | null = MEDIR_VISOR ? {
    lienzo, renderer, cuadros: () => cuadros, tiempos: [], piezaEn: (x, y) => piezaEn(x, y),
    medirRender(n, conSombra) {
      const gl = renderer.getContext();
      renderer.render(escena, camara);
      gl.finish();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { if (conSombra) renderer.shadowMap.needsUpdate = true; renderer.render(escena, camara); }
      gl.finish();
      const ms = (performance.now() - t0) / n;
      return { msPorCuadro: Math.round(ms * 100) / 100, info: infoDe(renderer) };
    },
  } : null;
  const quitarMedicion = medible ? registrarVisor(medible) : () => {};

  const api: EscenaGlobos = {
    mostrar: (globos) => cronometrar(medible, "mostrar", () => mostrar(globos)),
    mostrarModulo: (globos, anclas, tubos, extras) => cronometrar(medible, "mostrarModulo", () => mostrarModulo(globos, anclas, tubos, extras)),
    redimensionar,
    dibujar,
    piezaEn,
    puntoEnPlano,
    trasladarPiezas: (ids, delta) => cronometrar(medible, "trasladarPiezas", () => trasladarPiezas(ids, delta)),
    orbitar(activo: boolean) { controles.enabled = activo; },
    ejesCamara,
    lugarEn,
    resaltarLugares,
    resaltarEncima,
    mostrarFantasma: (globos, tubos) => cronometrar(medible, "mostrarFantasma", () => mostrarFantasma(globos, tubos)),
    ocultarCopia,
    vistaCamara: () => ({
      posicion: { x: camara.position.x, y: camara.position.y, z: camara.position.z }, objetivo: { x: controles.target.x, y: controles.target.y, z: controles.target.z },
      near: camara.near, far: camara.far, minDistancia: controles.minDistance, maxDistancia: controles.maxDistance,
    }),
    ponerVistaCamara(v) {
      camara.position.set(v.posicion.x, v.posicion.y, v.posicion.z);
      controles.target.set(v.objetivo.x, v.objetivo.y, v.objetivo.z);
      camara.near = v.near;
      camara.far = v.far;
      camara.updateProjectionMatrix();
      controles.minDistance = v.minDistancia;
      controles.maxDistance = v.maxDistancia;
      controles.update();
      pedirCuadro();
    },
    verDesde,
    alDibujar(oyente) { oyentesCuadro.add(oyente); return () => { oyentesCuadro.delete(oyente); }; },
    aPantalla(p) {
      const v = new THREE.Vector3(p.x * CM, p.y * CM, p.z * CM).project(camara);
      if (v.z > 1) return null;
      const r = lienzo.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    esperarRotulos: () => letraParaCapturar([...nodos.values(), ...aparcados.values()].some((d) => d.conRotulo), rehacerRotulos),
    capturar() {
      // 1. Render cuadrado grande desde el mismo ángulo, con la decoración entera en cuadro y fondo transparente.
      const L = 2304;
      usarCalidad("alta");
      const caja = new THREE.Box3().setFromObject(contenido);
      const esfera = caja.getBoundingSphere(new THREE.Sphere());
      const direccion = camara.position.clone().sub(controles.target).normalize();
      const antes = { posicion: camara.position.clone(), aspecto: camara.aspect, ratio: renderer.getPixelRatio(), tamano: renderer.getSize(new THREE.Vector2()), near: camara.near, far: camara.far };
      const distancia = esfera.radius / Math.sin(THREE.MathUtils.degToRad(camara.fov) / 2) * 1.02;
      camara.position.copy(esfera.center).addScaledVector(direccion, distancia);
      camara.lookAt(esfera.center);
      camara.aspect = 1;
      camara.near = distancia / 100;
      camara.far = distancia * 20;
      camara.updateProjectionMatrix();
      renderer.setPixelRatio(1);
      renderer.setSize(L, L, false);
      const cuadriculaVisible = cuadricula.visible;
      const conSala = sala.children.length > 0;
      cuadricula.visible = false;
      ayudas.visible = false;
      lienzoAyudas.visible = false;
      // Con sala, primero sin ella (para medir dónde queda la decoración) y luego con ella (es el fondo de la foto).
      sala.visible = false;
      renderer.setClearColor(0x000000, 0);
      renderer.render(escena, camara);
      const cuadro = document.createElement("canvas");
      cuadro.width = L;
      cuadro.height = L;
      const pincel = cuadro.getContext("2d", { willReadFrequently: true });
      pincel?.drawImage(lienzo, 0, 0);
      const medida = pincel?.getImageData(0, 0, L, L) ?? null;
      sala.visible = true;
      if (conSala && pincel) {
        renderer.render(escena, camara);
        pincel.clearRect(0, 0, L, L);
        pincel.drawImage(lienzo, 0, 0);
      }

      // Volver al visor tal como estaba.
      usarCalidad("editor");
      cuadricula.visible = cuadriculaVisible;
      ayudas.visible = true;
      lienzoAyudas.visible = true;
      renderer.setPixelRatio(antes.ratio);
      renderer.setSize(antes.tamano.x, antes.tamano.y, false);
      camara.position.copy(antes.posicion);
      camara.aspect = antes.aspecto;
      camara.near = antes.near;
      camara.far = antes.far;
      camara.updateProjectionMatrix();
      camara.lookAt(controles.target);
      dibujar();

      // 2. Lo que de verdad se dibujó (píxeles no transparentes, sombra incluida) y su proporción.
      let x0 = L, y0 = L, x1 = 0, y1 = 0;
      if (medida) {
        const { data } = medida;
        for (let y = 0; y < L; y += 2) for (let x = 0; x < L; x += 2) {
          if (data[(y * L + x) * 4 + 3]! > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = L; y1 = L; }
      const razon = (x1 - x0) / (y1 - y0);
      const aspecto: AspectoCaptura = razon < 0.8 ? "2:3" : razon > 1.25 ? "3:2" : "1:1";
      const { ancho, alto } = TAMANO_CAPTURA[aspecto];

      // 3. Recorte con un 6 % de aire, en la proporción que se le pide a FLUX, sobre fondo claro.
      const anchoCaja = (x1 - x0) * 1.12, altoCaja = (y1 - y0) * 1.12;
      const escala = Math.min(ancho / anchoCaja, alto / altoCaja);
      const salida = document.createElement("canvas");
      salida.width = ancho;
      salida.height = alto;
      const destino = salida.getContext("2d");
      if (!destino) return { datos: lienzo.toDataURL("image/jpeg", 0.92), aspecto };
      destino.fillStyle = "#efedf2";
      destino.fillRect(0, 0, ancho, alto);
      destino.imageSmoothingQuality = "high";
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      destino.drawImage(cuadro, ancho / 2 - cx * escala, alto / 2 - cy * escala, L * escala, L * escala);
      return { datos: salida.toDataURL("image/jpeg", 0.92), aspecto };
    },
    renderEstandar(vista, lado) {
      const caja = new THREE.Box3().setFromObject(contenido);
      if (caja.isEmpty()) throw new Error("No hay nada que dibujar");
      // Se dibuja al doble y se reduce: los tubos y los cuellos finos salen sin dientes.
      const grande = lado * 2;
      const antes = { ratio: renderer.getPixelRatio(), tamano: renderer.getSize(new THREE.Vector2()) };
      usarCalidad("alta");
      const camaraFija = camaraEstandar(caja, vista);
      renderer.setPixelRatio(1);
      renderer.setSize(grande, grande, false);
      const cuadriculaVisible = cuadricula.visible;
      cuadricula.visible = false;
      ayudas.visible = false;
      lienzoAyudas.visible = false;
      renderer.setClearColor(FONDO_ESTANDAR, 1);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(escena, camaraFija);
      const salida = document.createElement("canvas");
      salida.width = lado;
      salida.height = lado;
      const pincel = salida.getContext("2d");
      if (!pincel) throw new Error("Sin lienzo 2D");
      pincel.imageSmoothingQuality = "high";
      pincel.drawImage(lienzo, 0, 0, lado, lado);
      const datos = salida.toDataURL("image/png");

      renderer.setClearColor(0x000000, 0);
      usarCalidad("editor");
      cuadricula.visible = cuadriculaVisible;
      ayudas.visible = true;
      lienzoAyudas.visible = true;
      renderer.setPixelRatio(antes.ratio);
      renderer.setSize(antes.tamano.x, antes.tamano.y, false);
      return datos;
    },
    renderFoto(camaraFija, ancho, alto) {
      // Al doble y reducido, como `renderEstandar`: los tubos y los cuellos finos salen sin dientes.
      const antes = { ratio: renderer.getPixelRatio(), tamano: renderer.getSize(new THREE.Vector2()) };
      usarCalidad("alta");
      renderer.setPixelRatio(1);
      renderer.setSize(ancho * 2, alto * 2, false);
      const cuadriculaVisible = cuadricula.visible;
      cuadricula.visible = false;
      ayudas.visible = false;
      lienzoAyudas.visible = false;
      renderer.setClearColor(FONDO_ESTANDAR, 1);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(escena, camaraFija);
      const salida = document.createElement("canvas");
      salida.width = ancho;
      salida.height = alto;
      const pincel = salida.getContext("2d");
      if (!pincel) throw new Error("Sin lienzo 2D");
      pincel.imageSmoothingQuality = "high";
      pincel.drawImage(lienzo, 0, 0, ancho, alto);
      const datos = salida.toDataURL("image/jpeg", 0.88);
      renderer.setClearColor(0x000000, 0);
      usarCalidad("editor");
      cuadricula.visible = cuadriculaVisible;
      ayudas.visible = true;
      lienzoAyudas.visible = true;
      renderer.setPixelRatio(antes.ratio);
      renderer.setSize(antes.tamano.x, antes.tamano.y, false);
      return datos;
    },
    destruir() {
      vivo = false;
      oyentesCuadro.clear();
      quitarMedicion();
      cancelAnimationFrame(pendiente);
      controles.removeEventListener("change", pedirCuadro);
      controles.dispose();
      vaciarModulo();
      vaciar(fila);
      vaciar(sala);
      vaciar(ayudas);
      for (const g of [marcasLugares, marcaEncima, fantasma]) vaciar(g);
      for (const partes of juegos.values()) for (const parte of partes) parte.geometria.dispose();
      for (const g of geometriasSueltas.values()) g.dispose();
      for (const m of materiales.values()) m.dispose();
      entorno.dispose();
      escenografia.liberar();
      entornoEstudio?.dispose();
      tablones?.dispose();
      lucesDeSala.liberar();
      pmrem.dispose();
      renderer.dispose();
    },
  };
  if (medible) medible.capturar = () => api.capturar().datos;
  if (medible) medible.desglose = () => {
    const cuenta: Record<string, number> = {};
    escena.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      const clave = `${o instanceof THREE.InstancedMesh ? "lote " : ""}${o.geometry.type}`;
      cuenta[clave] = (cuenta[clave] ?? 0) + 1;
    });
    return cuenta;
  };
  if (medible) medible.cuadroPendiente = (correr) => {
    if (!pendiente) return false;
    if (correr) { cancelAnimationFrame(pendiente); alCuadro(); }
    return true;
  };
  return api;
}
