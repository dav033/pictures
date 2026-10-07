import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { FormatoGlobo } from "@/lib/globos3d/formatos";
import { contornoCorazon, perfilLink, perfilRedondo, type PuntoPerfil } from "@/lib/globos3d/geometria";

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
export type GloboColocadoEnEscena = GloboEnEscena & { nudo: Punto3; direccion: Punto3; frente?: Punto3 };
export type Punto3 = { x: number; y: number; z: number };

/** Un tramo de tubito que sigue una curva (lazos, burbujas, colas): el eje en cm, su grosor y su color. */
export type TuboEnEscena = { puntos: readonly Punto3[]; grosorCm: number; hex: string; familia: string; cerrado: boolean };

export type EscenaGlobos = {
  mostrar: (globos: readonly GloboEnEscena[]) => void;
  /** Un módulo armado (pareja, trío, cuarteto…): los globos colocados, si se piden sus anclas, y los tubitos. */
  mostrarModulo: (globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos?: readonly TuboEnEscena[]) => void;
  redimensionar: () => void;
  destruir: () => void;
};

const CM = 0.01;

/** Material de látex según la familia Sempertex. */
function materialDe(familia: string, hex: string): THREE.MeshPhysicalMaterial {
  const color = new THREE.Color(hex);
  switch (familia) {
    case "reflex":
      return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
    case "metal":
      return new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
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
  function mostrarModulo(globos: readonly GloboColocadoEnEscena[], anclas: readonly Punto3[], tubos: readonly TuboEnEscena[] = []) {
    for (const hijo of [...contenido.children]) { contenido.remove(hijo); liberar(hijo); }
    const modulo = new THREE.Group();
    for (const globo of globos) {
      const objeto = construir(globo);
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
