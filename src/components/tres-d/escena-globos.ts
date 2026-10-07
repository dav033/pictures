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
export type GloboColocadoEnEscena = GloboEnEscena & { nudo: Punto3; direccion: Punto3; frente?: Punto3; confeti?: boolean };
export type Punto3 = { x: number; y: number; z: number };

/** Un tramo de tubito que sigue una curva (lazos, burbujas, colas): el eje en cm, su grosor y su color. */
export type TuboEnEscena = { puntos: readonly Punto3[]; grosorCm: number; hex: string; familia: string; cerrado: boolean };

/** Flor artificial (follaje, no es globo) en un hueco: tipo, color, tamaño, dónde y hacia dónde mira (cm). */
export type FlorEnEscena = { tipo: "hortensia" | "rosa" | "gypsophila"; hex: string; diametroCm: number; posicion: Punto3; normal: Punto3 };
/** Un volumen simple de la escena (el pedestal): base, radio y alto en cm. */
export type CilindroEnEscena = { base: Punto3; radioCm: number; altoCm: number; hex: string };
export type ExtrasEscena = { flores?: readonly FlorEnEscena[]; cilindros?: readonly CilindroEnEscena[] };

export type EscenaGlobos = {
  mostrar: (globos: readonly GloboEnEscena[]) => void;
  /** Un módulo armado (pareja, trío, cuarteto…): los globos colocados, si se piden sus anclas, y los tubitos. */
  mostrarModulo: (globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos?: readonly TuboEnEscena[], extras?: ExtrasEscena) => void;
  redimensionar: () => void;
  destruir: () => void;
};

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

  function liberar(objeto: THREE.Object3D) {
    objeto.traverse((hijo) => {
      if (hijo instanceof THREE.Mesh) {
        hijo.geometry.dispose();
        const materiales = Array.isArray(hijo.material) ? hijo.material : [hijo.material];
        for (const m of materiales) m.dispose();
      }
    });
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
    const modulo = new THREE.Group();
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
      modulo.add(objeto);
    }
    for (const tramo of tubos) {
      const objeto = tuboEnCurva(tramo, materialDe(tramo.familia, tramo.hex));
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      modulo.add(objeto);
    }
    // Follaje (no es globo): flores artificiales mirando hacia fuera de su hueco.
    for (const [indice, flor] of (extras.flores ?? []).entries()) {
      const objeto = florArtificial(flor, indice + 7);
      objeto.quaternion.setFromUnitVectors(ARRIBA, new THREE.Vector3(flor.normal.x, flor.normal.y, flor.normal.z).normalize());
      objeto.position.set(flor.posicion.x * CM, flor.posicion.y * CM, flor.posicion.z * CM);
      objeto.traverse((hijo) => { if (hijo instanceof THREE.Mesh) hijo.castShadow = true; });
      modulo.add(objeto);
    }
    // Volúmenes de la escena (el pedestal).
    for (const c of extras.cilindros ?? []) {
      const cilindro = new THREE.Mesh(new THREE.CylinderGeometry(c.radioCm * CM, c.radioCm * CM, c.altoCm * CM, 48), new THREE.MeshStandardMaterial({ color: new THREE.Color(c.hex), roughness: 0.55 }));
      cilindro.position.set(c.base.x * CM, (c.base.y + c.altoCm / 2) * CM, c.base.z * CM);
      cilindro.castShadow = true;
      cilindro.receiveShadow = true;
      modulo.add(cilindro);
    }
    // Anclas: puntos donde se cuelga una decoración hija (una flor, un moño).
    const materialAncla = new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x7c3aed, emissiveIntensity: 0.6 });
    for (const ancla of anclas) {
      const punto = new THREE.Mesh(new THREE.SphereGeometry(1.4 * CM, 20, 12), materialAncla.clone());
      punto.position.set(ancla.x * CM, ancla.y * CM, ancla.z * CM);
      modulo.add(punto);
    }
    materialAncla.dispose();
    // Apoyado sobre el piso.
    const caja = new THREE.Box3().setFromObject(modulo);
    modulo.position.y = -caja.min.y + 0.005;
    contenido.add(modulo);
    encuadrar();
  }

  function redimensionar() {
    const { clientWidth, clientHeight } = lienzo;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camara.aspect = clientWidth / clientHeight;
    camara.updateProjectionMatrix();
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
    destruir() {
      cancelAnimationFrame(cuadro);
      controles.dispose();
      liberar(contenido);
      entorno.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
