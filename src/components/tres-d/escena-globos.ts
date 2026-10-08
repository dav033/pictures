import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { FormatoGlobo } from "@/lib/globos3d/formatos";
import { centroCuerpo, contornoCorazon, perfilLink, perfilRedondo, type PuntoPerfil } from "@/lib/globos3d/geometria";

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
export type GloboColocadoEnEscena = GloboEnEscena & DeNodo & { nudo: Punto3; direccion: Punto3; frente?: Punto3; confeti?: boolean };
export type Punto3 = { x: number; y: number; z: number };

/** Un tramo de tubito que sigue una curva (lazos, burbujas, colas): el eje en cm, su grosor y su color. */
export type TuboEnEscena = DeNodo & { puntos: readonly Punto3[]; grosorCm: number; hex: string; familia: string; cerrado: boolean };

/** Flor artificial (follaje, no es globo) en un hueco: tipo, color, tamaño, dónde y hacia dónde mira (cm). */
export type FlorEnEscena = DeNodo & { tipo: "hortensia" | "rosa" | "gypsophila"; hex: string; diametroCm: number; posicion: Punto3; normal: Punto3 };
/** Un volumen simple de la escena (el pedestal): base, radio y alto en cm. */
export type CilindroEnEscena = DeNodo & { base: Punto3; radioCm: number; altoCm: number; hex: string };
/**
 * La sala de una escena (cm): piso en y = 0, x de −ancho/2 a +ancho/2, z de −fondo/2 a +fondo/2, techo en y = alto;
 * la pared del fondo en z = −fondo/2 y el frente abierto. Mismo formato que `Sala` de `lib/globos3d/escena.ts`.
 */
export type SalaEnEscena = {
  anchoCm: number; fondoCm: number; altoCm: number;
  tonos: { piso: string; paredes: string; techo: string };
  mostrar: { piso: boolean; fondo: boolean; laterales: boolean; techo: boolean };
};
export type CajaEnEscena = { min: Punto3; max: Punto3 };
/**
 * Con `sala`, lo que se muestra ya viene en coordenadas del mundo (una escena): no se apoya en el piso y se dibuja
 * la sala. `resaltado` marca con una caja la pieza elegida (no sale en la captura). `encuadrar: false` deja la
 * cámara donde está (al mover una pieza no se pierde el ángulo).
 */
export type ExtrasEscena = { flores?: readonly FlorEnEscena[]; cilindros?: readonly CilindroEnEscena[]; sala?: SalaEnEscena; resaltado?: CajaEnEscena | null; encuadrar?: boolean };

export type EscenaGlobos = {
  mostrar: (globos: readonly GloboEnEscena[]) => void;
  /** Un módulo armado (pareja, trío, cuarteto…): los globos colocados, si se piden sus anclas, y los tubitos. */
  mostrarModulo: (globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos?: readonly TuboEnEscena[], extras?: ExtrasEscena) => void;
  redimensionar: () => void;
  /**
   * Captura para la foto con IA: JPEG grande (lado mayor 1536 px) desde el ángulo que se ve, con la decoración
   * encuadrada justa, sin cuadrícula y con fondo claro. La proporción sale de la forma (vertical, cuadrada o
   * apaisada) y es la misma que se le pide a FLUX, para que no estire ni recorte.
   */
  capturar: () => { datos: string; aspecto: AspectoCaptura };
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
  destruir: () => void;
};

export type AspectoCaptura = "2:3" | "1:1" | "3:2";
const TAMANO_CAPTURA: Record<AspectoCaptura, { ancho: number; alto: number }> = { "2:3": { ancho: 1024, alto: 1536 }, "1:1": { ancho: 1024, alto: 1024 }, "3:2": { ancho: 1536, alto: 1024 } };

const CM = 0.01;

/**
 * Entorno propio de los metalizados. La escena atenúa su entorno (`environmentIntensity`) para que el látex mate no se
 * lave; un cromado que refleja ese entorno atenuado se ve casi negro. Con el mapa puesto en el material, la
 * atenuación de la escena no le aplica y la plata se ve plata.
 */
let entornoMetal: THREE.Texture | null = null;

/** Material de látex según la familia Sempertex. */
function materialDe(familia: string, hex: string): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(hex);
  switch (familia) {
    case "reflex":
      // El entorno de la escena va atenuado (el látex mate se lavaba); el cromado necesita reflejar más para verse plateado y no negro.
      return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMap: entornoMetal, envMapIntensity: 1.3 });
    case "metal":
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, envMap: entornoMetal, envMapIntensity: 1.1 });
    case "silk":
    case "satin":
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.15, roughness: 0.32, sheen: 1, sheenColor: new THREE.Color("#ffffff"), sheenRoughness: 0.4, iridescence: 0.35, iridescenceIOR: 1.3, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    case "cristal":
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.04, transmission: 0.92, thickness: 0.004, ior: 1.42, transparent: true, clearcoat: 1, clearcoatRoughness: 0.02 });
    case "neon":
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.3, emissive: color, emissiveIntensity: 0.18 });
    case "pastelMate":
    case "pastelDusk":
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.68, clearcoat: 0.15, clearcoatRoughness: 0.6 });
    default:
      // Fashion: látex mate con el brillo suave de la superficie estirada.
      return new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
  }
}

/** Azar determinista (cada globo o flor siempre igual entre recargas). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/** Confeti plateado dentro de un globo de cristal: discos finos repartidos en la esfera del cuerpo (coordenadas locales). */
function confetiDentro(centroY: number, radio: number, semilla: number): THREE.InstancedMesh {
  const cantidad = Math.max(18, Math.round(radio / CM * 2.2));
  const malla = new THREE.InstancedMesh(new THREE.CircleGeometry(0.65 * CM, 10), new THREE.MeshStandardMaterial({ color: 0xd9d9e0, metalness: 1, roughness: 0.25, side: THREE.DoubleSide }), cantidad);
  const r = azar(semilla);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < cantidad; i++) {
    // Más confeti abajo (se pega por la estática al fondo y a las paredes), pero repartido por todo el globo.
    const u = r() * 2 - 1, t = r() * Math.PI * 2, k = Math.cbrt(0.35 + 0.65 * r()) * radio * 0.86;
    const s = Math.sqrt(1 - u * u);
    q.setFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    m.compose(new THREE.Vector3(s * Math.cos(t) * k, centroY + u * k - radio * 0.08, s * Math.sin(t) * k), q, new THREE.Vector3(1, 1, 1));
    malla.setMatrixAt(i, m);
  }
  return malla;
}

/** Flor artificial mirando a +Y: hortensia (bola de florecitas), rosa (capullo en capas) o gypsophila (nube de puntitos). */
function florArtificial(f: FlorEnEscena, semilla: number): THREE.Group {
  const grupo = new THREE.Group();
  const color = new THREE.Color(f.hex);
  const radio = (f.diametroCm / 2) * CM;
  const r = azar(semilla);
  if (f.tipo === "hortensia") {
    const cantidad = 34;
    // Material blanco: el color va por instancia (si el material también lo llevara, se multiplicaría y oscurecería).
    const florecita = new THREE.InstancedMesh(new THREE.SphereGeometry(radio * 0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), cantidad);
    const m = new THREE.Matrix4();
    for (let i = 0; i < cantidad; i++) {
      const u = r(), t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const tinte = 0.85 + r() * 0.3;
      m.makeTranslation(s * Math.cos(t) * radio * 0.8, u * radio * 0.75, s * Math.sin(t) * radio * 0.8);
      florecita.setMatrixAt(i, m);
      florecita.setColorAt(i, color.clone().multiplyScalar(tinte));
    }
    grupo.add(florecita);
    for (let i = 0; i < 3; i++) {
      const hoja = new THREE.Mesh(new THREE.SphereGeometry(radio * 0.45, 10, 6), new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.7 }));
      hoja.scale.set(1, 0.18, 0.55);
      const a = (i / 3) * Math.PI * 2 + r();
      hoja.position.set(Math.cos(a) * radio * 0.85, 0, Math.sin(a) * radio * 0.85);
      hoja.rotation.y = -a;
      grupo.add(hoja);
    }
  } else if (f.tipo === "rosa") {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    for (let capa = 0; capa < 3; capa++) {
      const petalo = new THREE.Mesh(new THREE.SphereGeometry(radio * (1 - capa * 0.25), 16, 10, 0, Math.PI * 2, 0, Math.PI * (0.55 + capa * 0.1)), material);
      petalo.position.y = capa * radio * 0.18;
      petalo.rotation.y = capa * 0.9;
      grupo.add(petalo);
    }
  } else {
    const cantidad = 40;
    const punto = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45 * CM, 6, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), cantidad);
    const m = new THREE.Matrix4();
    for (let i = 0; i < cantidad; i++) {
      const u = r(), t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), k = radio * (0.4 + r() * 0.6);
      m.makeTranslation(s * Math.cos(t) * k, u * k, s * Math.sin(t) * k);
      punto.setMatrixAt(i, m);
    }
    grupo.add(punto);
  }
  return grupo;
}

function torneado(perfil: readonly PuntoPerfil[]): THREE.LatheGeometry {
  return new THREE.LatheGeometry(perfil.map((p) => new THREE.Vector2(p.r * CM, p.y * CM)), 72);
}

/** Tubito o Link-O-Loon 660: cápsula curvada (un arco suave) con la boquilla y el nudo en un extremo. */
function tubo(grosorCm: number, largoCm: number, material: THREE.Material): THREE.Group {
  const grupo = new THREE.Group();
  const radio = (grosorCm / 2) * CM;
  const largo = largoCm * CM;
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-largo / 2, 0, 0),
    new THREE.Vector3(-largo / 4, largo * 0.06, 0),
    new THREE.Vector3(largo / 4, largo * 0.06, 0),
    new THREE.Vector3(largo / 2, 0, 0),
  ]);
  grupo.add(new THREE.Mesh(new THREE.TubeGeometry(curva, 120, radio, 32, false), material));
  for (const t of [0, 1]) {
    const punta = new THREE.Mesh(new THREE.SphereGeometry(radio, 32, 16), material);
    punta.position.copy(curva.getPoint(t));
    grupo.add(punta);
  }
  // Nudo en el extremo izquierdo.
  const nudo = new THREE.Mesh(new THREE.TorusGeometry(radio * 0.45, radio * 0.25, 12, 24), material);
  nudo.position.copy(curva.getPoint(0)).add(new THREE.Vector3(-radio * 1.1, 0, 0));
  nudo.rotation.y = Math.PI / 2;
  grupo.add(nudo);
  // Apoyado sobre el piso.
  grupo.position.y = radio;
  return grupo;
}

/**
 * Tubito que sigue una curva cualquiera (un lazo, un ocho, una burbuja, una cola): tubo a lo largo de la curva
 * con las puntas redondeadas; si es cerrado, sin puntas. A diferencia de `tubo`, la curva viene dada (cm).
 */
function tuboEnCurva(tramo: TuboEnEscena, material: THREE.Material): THREE.Group {
  const grupo = new THREE.Group();
  const radio = (tramo.grosorCm / 2) * CM;
  const puntos = tramo.puntos.map((p) => new THREE.Vector3(p.x * CM, p.y * CM, p.z * CM));
  if (puntos.length < 2) return grupo;
  // Con 2 puntos la curva es una recta: se añade el punto medio para que Catmull-Rom tenga con qué trabajar.
  if (puntos.length === 2) puntos.splice(1, 0, puntos[0]!.clone().lerp(puntos[1]!, 0.5));
  const curva = new THREE.CatmullRomCurve3(puntos, tramo.cerrado, "centripetal");
  const segmentos = Math.min(160, Math.max(12, puntos.length * 4));
  grupo.add(new THREE.Mesh(new THREE.TubeGeometry(curva, segmentos, radio, 14, tramo.cerrado), material));
  if (!tramo.cerrado) {
    for (const t of [0, 1]) {
      const punta = new THREE.Mesh(new THREE.SphereGeometry(radio, 16, 10), material);
      punta.position.copy(curva.getPoint(t));
      grupo.add(punta);
    }
  }
  return grupo;
}

function corazon(anchoCm: number, material: THREE.Material): THREE.Group {
  const forma = new THREE.Shape(contornoCorazon(anchoCm * CM).map((p) => new THREE.Vector2(p.x, p.y)));
  const ancho = anchoCm * CM;
  const geometria = new THREE.ExtrudeGeometry(forma, { depth: ancho * 0.22, bevelEnabled: true, bevelThickness: ancho * 0.14, bevelSize: ancho * 0.1, bevelSegments: 10, curveSegments: 64 });
  geometria.center();
  const malla = new THREE.Mesh(geometria, material);
  const grupo = new THREE.Group();
  grupo.add(malla);
  geometria.computeBoundingBox();
  const caja = geometria.boundingBox;
  const abajo = caja ? -caja.min.y : ancho / 2;
  malla.position.y = abajo + ancho * 0.05;
  const nudo = new THREE.Mesh(new THREE.TorusGeometry(ancho * 0.03, ancho * 0.015, 12, 24), material);
  nudo.position.y = ancho * 0.03;
  grupo.add(nudo);
  return grupo;
}

function construir(globo: GloboEnEscena): THREE.Object3D {
  const material = materialDe(globo.familia, globo.hex);
  const { formato, infladoCm } = globo;
  if (formato.tipo === "tubito") return tubo(infladoCm, formato.largoCm ?? 150, material);
  if (formato.tipo === "link" && formato.largoCm) return tubo(infladoCm, formato.largoCm, material);
  if (formato.tipo === "corazon") return corazon(infladoCm, material);
  const extra = globo.cuelloExtraCm ?? 0;
  const perfil = formato.tipo === "link" ? perfilLink(infladoCm, extra) : perfilRedondo(infladoCm, extra);
  const malla = new THREE.Mesh(torneado(perfil), material);
  malla.castShadow = true;
  return malla;
}

function ancho(objeto: THREE.Object3D): number {
  const caja = new THREE.Box3().setFromObject(objeto);
  return caja.max.x - caja.min.x;
}

export function crearEscena(lienzo: HTMLCanvasElement): EscenaGlobos {
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x000000, 0);

  const escena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  escena.environment = entorno;
  entornoMetal = entorno;
  // Menos luz de entorno: con la sala completa el látex mate se veía lavado (el rosado 009 salía casi blanco).
  escena.environmentIntensity = 0.55;

  const sol = new THREE.DirectionalLight(0xffffff, 1.4);
  sol.position.set(1.5, 3, 2);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  escena.add(sol, new THREE.AmbientLight(0xffffff, 0.08));

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
  // La sala de una escena (piso, paredes y techo) y las ayudas (la caja de la pieza elegida): fuera de `contenido`
  // para que el encuadre y la captura se centren en los globos.
  const sala = new THREE.Group();
  const ayudas = new THREE.Group();
  escena.add(sala, ayudas);
  /** Lo dibujado de cada pieza de una escena, en su propio grupo (para elegirla y arrastrarla). */
  let gruposPorNodo = new Map<string, THREE.Group>();
  /** La caja de la pieza elegida tal como se armó (al arrastrar se corre desde aquí). */
  let resaltado: { caja: THREE.Box3; ayuda: THREE.Box3Helper } | null = null;

  function liberar(objeto: THREE.Object3D) {
    objeto.traverse((hijo) => {
      if (hijo instanceof THREE.Mesh) {
        hijo.geometry.dispose();
        const materiales = Array.isArray(hijo.material) ? hijo.material : [hijo.material];
        for (const m of materiales) m.dispose();
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
   */
  function dibujarSala(datos: SalaEnEscena | undefined) {
    vaciar(sala);
    vaciar(ayudas);
    resaltado = null;
    const conPiso = Boolean(datos?.mostrar.piso);
    piso.visible = !conPiso;
    cuadricula.visible = !datos;
    if (!datos) return;
    const ancho = datos.anchoCm * CM, fondo = datos.fondoCm * CM, alto = datos.altoCm * CM;
    const plano = (w: number, h: number, hex: string, colocar: (m: THREE.Mesh) => void) => {
      const malla = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.92, metalness: 0, side: THREE.FrontSide }));
      malla.receiveShadow = true;
      colocar(malla);
      sala.add(malla);
    };
    if (datos.mostrar.piso) plano(ancho, fondo, datos.tonos.piso, (m) => { m.rotation.x = -Math.PI / 2; m.position.y = -0.001; });
    if (datos.mostrar.fondo) plano(ancho, alto, datos.tonos.paredes, (m) => { m.position.set(0, alto / 2, -fondo / 2); });
    if (datos.mostrar.laterales) {
      plano(fondo, alto, datos.tonos.paredes, (m) => { m.rotation.y = Math.PI / 2; m.position.set(-ancho / 2, alto / 2, 0); });
      plano(fondo, alto, datos.tonos.paredes, (m) => { m.rotation.y = -Math.PI / 2; m.position.set(ancho / 2, alto / 2, 0); });
    }
    if (datos.mostrar.techo) plano(ancho, fondo, datos.tonos.techo, (m) => { m.rotation.x = Math.PI / 2; m.position.y = alto; });
  }

  function resaltar(caja: CajaEnEscena | null | undefined) {
    resaltado = null;
    if (!caja) return;
    const margen = 3;
    const box = new THREE.Box3(
      new THREE.Vector3((caja.min.x - margen) * CM, (caja.min.y - margen) * CM, (caja.min.z - margen) * CM),
      new THREE.Vector3((caja.max.x + margen) * CM, (caja.max.y + margen) * CM, (caja.max.z + margen) * CM),
    );
    const ayuda = new THREE.Box3Helper(box.clone(), new THREE.Color(0x7c3aed));
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

  function mostrar(globos: readonly GloboEnEscena[]) {
    for (const hijo of [...contenido.children]) { contenido.remove(hijo); liberar(hijo); }
    gruposPorNodo = new Map();
    dibujarSala(undefined);
    let x = 0;
    const objetos = globos.map((globo) => construir(globo));
    const separacion = 0.06;
    const total = objetos.reduce((suma, o) => suma + ancho(o), 0) + separacion * Math.max(0, objetos.length - 1);
    x = -total / 2;
    for (const objeto of objetos) {
      const a = ancho(objeto);
      const caja = new THREE.Box3().setFromObject(objeto);
      objeto.position.x += x - caja.min.x;
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      contenido.add(objeto);
      x += a + separacion;
    }
    encuadrar();
  }

  const ARRIBA = new THREE.Vector3(0, 1, 0);
  function mostrarModulo(globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos: readonly TuboEnEscena[] = [], extras: ExtrasEscena = {}) {
    for (const hijo of [...contenido.children]) { contenido.remove(hijo); liberar(hijo); }
    dibujarSala(extras.sala);
    resaltar(extras.resaltado);
    const modulo = new THREE.Group();
    gruposPorNodo = new Map();
    // Lo de cada pieza va en su grupo (marcado con su id); lo que no es de ninguna, directo al módulo.
    const grupoDe = (nodo: string | undefined): THREE.Group => {
      if (!nodo) return modulo;
      let grupo = gruposPorNodo.get(nodo);
      if (!grupo) {
        grupo = new THREE.Group();
        grupo.userData.nodo = nodo;
        gruposPorNodo.set(nodo, grupo);
        modulo.add(grupo);
      }
      return grupo;
    };
    for (const [indice, globo] of globos.entries()) {
      const objeto = construir(globo);
      if (globo.confeti && globo.formato.tipo === "redondo") {
        const centroY = (centroCuerpo("redondo", globo.infladoCm) + (globo.cuelloExtraCm ?? 0)) * CM;
        objeto.add(confetiDentro(centroY, (globo.infladoCm / 2) * CM, indice + 1));
      }
      const eje = new THREE.Vector3(globo.direccion.x, globo.direccion.y, globo.direccion.z).normalize();
      if (globo.frente) {
        // Globo plano: Y local = dirección del cuerpo, Z local (la cara del corazón) = frente.
        const z = new THREE.Vector3(globo.frente.x, globo.frente.y, globo.frente.z);
        z.addScaledVector(eje, -z.dot(eje)).normalize();
        const x = new THREE.Vector3().crossVectors(eje, z);
        objeto.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, eje, z));
      } else {
        objeto.quaternion.setFromUnitVectors(ARRIBA, eje);
      }
      objeto.position.set(globo.nudo.x * CM, globo.nudo.y * CM, globo.nudo.z * CM);
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      grupoDe(globo.nodo).add(objeto);
    }
    for (const tramo of tubos) {
      const objeto = tuboEnCurva(tramo, materialDe(tramo.familia, tramo.hex));
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      grupoDe(tramo.nodo).add(objeto);
    }
    // Follaje (no es globo): flores artificiales mirando hacia fuera de su hueco.
    for (const [indice, flor] of (extras.flores ?? []).entries()) {
      const objeto = florArtificial(flor, indice + 7);
      objeto.quaternion.setFromUnitVectors(ARRIBA, new THREE.Vector3(flor.normal.x, flor.normal.y, flor.normal.z).normalize());
      objeto.position.set(flor.posicion.x * CM, flor.posicion.y * CM, flor.posicion.z * CM);
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      grupoDe(flor.nodo).add(objeto);
    }
    // Volúmenes de la escena (el pedestal).
    for (const c of extras.cilindros ?? []) {
      const cilindro = new THREE.Mesh(new THREE.CylinderGeometry(c.radioCm * CM, c.radioCm * CM, c.altoCm * CM, 48), new THREE.MeshStandardMaterial({ color: new THREE.Color(c.hex), roughness: 0.55 }));
      cilindro.position.set(c.base.x * CM, (c.base.y + c.altoCm / 2) * CM, c.base.z * CM);
      cilindro.castShadow = true;
      cilindro.receiveShadow = true;
      grupoDe(c.nodo).add(cilindro);
    }
    // Anclas: puntos donde se cuelga una decoración hija (una flor, un moño).
    const materialAncla = new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x7c3aed, emissiveIntensity: 0.6 });
    for (const ancla of anclas) {
      const punto = new THREE.Mesh(new THREE.SphereGeometry(1.4 * CM, 20, 12), materialAncla.clone());
      punto.position.set(ancla.x * CM, ancla.y * CM, ancla.z * CM);
      modulo.add(punto);
    }
    materialAncla.dispose();
    // Apoyado sobre el piso (una escena ya viene en coordenadas del mundo).
    if (!extras.sala) {
      const caja = new THREE.Box3().setFromObject(modulo);
      modulo.position.y = -caja.min.y + 0.005;
    }
    contenido.add(modulo);
    if (extras.encuadrar !== false) encuadrar();
  }

  function redimensionar() {
    const { clientWidth, clientHeight } = lienzo;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camara.aspect = clientWidth / clientHeight;
    camara.updateProjectionMatrix();
  }

  const rayo = new THREE.Raycaster();
  function apuntar(clienteX: number, clienteY: number) {
    const r = lienzo.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    rayo.setFromCamera(new THREE.Vector2(((clienteX - r.left) / r.width) * 2 - 1, -((clienteY - r.top) / r.height) * 2 + 1), camara);
    return true;
  }

  function piezaEn(clienteX: number, clienteY: number): { nodo: string; punto: Punto3 } | null {
    if (!gruposPorNodo.size || !apuntar(clienteX, clienteY)) return null;
    for (const toque of rayo.intersectObjects([...gruposPorNodo.values()], true)) {
      // De lo tocado hacia arriba hasta el grupo de su pieza.
      for (let o: THREE.Object3D | null = toque.object; o; o = o.parent) {
        const nodo: unknown = o.userData.nodo;
        if (typeof nodo === "string") return { nodo, punto: { x: toque.point.x / CM, y: toque.point.y / CM, z: toque.point.z / CM } };
      }
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

  function trasladarPiezas(nodos: readonly string[], delta: Punto3) {
    const d = new THREE.Vector3(delta.x * CM, delta.y * CM, delta.z * CM);
    for (const id of nodos) gruposPorNodo.get(id)?.position.copy(d);
    if (resaltado) resaltado.ayuda.box.copy(resaltado.caja).translate(d);
  }

  function ejesCamara(): { adelante: Punto3; derecha: Punto3 } {
    const f = camara.getWorldDirection(new THREE.Vector3());
    f.y = 0;
    if (f.lengthSq() < 1e-8) f.set(0, 0, -1);
    f.normalize();
    return { adelante: { x: f.x, y: 0, z: f.z }, derecha: { x: -f.z, y: 0, z: f.x } };
  }

  let cuadro = 0;
  const animar = () => {
    cuadro = requestAnimationFrame(animar);
    controles.update();
    renderer.render(escena, camara);
  };
  redimensionar();
  animar();

  return {
    mostrar,
    mostrarModulo,
    redimensionar,
    piezaEn,
    puntoEnPlano,
    trasladarPiezas,
    orbitar(activo: boolean) { controles.enabled = activo; },
    ejesCamara,
    capturar() {
      // 1. Render cuadrado grande desde el mismo ángulo, con la decoración entera en cuadro y fondo transparente.
      const L = 2304;
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
      cuadricula.visible = cuadriculaVisible;
      ayudas.visible = true;
      renderer.setPixelRatio(antes.ratio);
      renderer.setSize(antes.tamano.x, antes.tamano.y, false);
      camara.position.copy(antes.posicion);
      camara.aspect = antes.aspecto;
      camara.near = antes.near;
      camara.far = antes.far;
      camara.updateProjectionMatrix();
      camara.lookAt(controles.target);
      renderer.render(escena, camara);

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
    destruir() {
      cancelAnimationFrame(cuadro);
      controles.dispose();
      liberar(contenido);
      vaciar(sala);
      vaciar(ayudas);
      entorno.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
