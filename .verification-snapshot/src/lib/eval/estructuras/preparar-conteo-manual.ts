import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dentroDe, SuiteSchema } from "./cli-reconocimiento";
import { construirPagina, type FotoPagina } from "./pagina-conteo-manual";

/**
 * Prepara el conteo humano de las fotos que evalúa `npm run eval:conteo`
 * (ADR-0031, E2; SEGUIMIENTO-conteo.md §4): elige hasta N fotos de una carpeta
 * privada, escribe la suite, la plantilla de la verdad, el índice sha256→archivo
 * y la página `contar.html` con la que una persona cuenta. Toda la E/S se
 * inyecta: la selección, los archivos y las compuertas se prueban sin disco.
 *
 * Nada de esto entra al repositorio: ni las fotos, ni el índice (nombres de
 * archivo), ni el conteo humano. `--fotos` y `--salida` se rechazan si quedan
 * dentro de él.
 */

export const MAX_ARCHIVOS_ESCANEADOS = 5000;
/** Hasta este total de bytes en las fotos elegidas la página las incrusta (data URI); por encima las enlaza con `file://`. */
export const UMBRAL_INCRUSTAR_BYTES = 20 * 1024 * 1024;
export const ARCHIVOS_SALIDA = { suite: "suite.json", indice: "indice.csv", verdad: "verdad.csv", pagina: "contar.html" } as const;
const TAXONOMIA_SUITE = "estructuras-2.0.0";

// --- Argumentos -------------------------------------------------------------------

export type ModoImagenes = "auto" | "incrustar" | "enlazar";

export type OpcionesPreparar = {
  fotos: string;
  salida: string;
  max: number;
  semilla: string;
  suiteId: string;
  imagenes: ModoImagenes;
  /** La persona declara que puede enviar estas fotos a un proveedor externo para evaluar (Fundamentos §8.1). */
  permisoProveedor: boolean;
  escribir: boolean;
  sobrescribir: boolean;
};

export function leerArgumentosPreparar(argv: readonly string[]): OpcionesPreparar {
  const opciones: OpcionesPreparar = {
    fotos: "", salida: "", max: 30, semilla: "conteo-manual", suiteId: "conteo-manual-v1", imagenes: "auto",
    permisoProveedor: false, escribir: false, sobrescribir: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--escribir") { opciones.escribir = true; continue; }
    if (arg === "--preview") { opciones.escribir = false; continue; }
    if (arg === "--sobrescribir") { opciones.sobrescribir = true; continue; }
    if (arg === "--permiso-proveedor") { opciones.permisoProveedor = true; continue; }
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith("--")) throw new Error(`${arg} necesita un valor`);
    i += 1;
    switch (arg) {
      case "--fotos": opciones.fotos = valor; break;
      case "--salida": opciones.salida = valor; break;
      case "--max":
        if (!/^\d+$/.test(valor) || Number(valor) < 1 || Number(valor) > 500) throw new Error("--max debe ser un entero 1-500");
        opciones.max = Number(valor);
        break;
      case "--semilla":
        if (valor.length > 80) throw new Error("--semilla admite hasta 80 caracteres");
        opciones.semilla = valor;
        break;
      case "--suite-id":
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(valor)) throw new Error("--suite-id inválido");
        opciones.suiteId = valor;
        break;
      case "--imagenes":
        if (valor !== "auto" && valor !== "incrustar" && valor !== "enlazar") throw new Error("--imagenes debe ser auto, incrustar o enlazar");
        opciones.imagenes = valor;
        break;
      default: throw new Error(`opción desconocida: ${arg}`);
    }
  }
  for (const [nombre, valor] of [["--fotos", opciones.fotos], ["--salida", opciones.salida]] as const) {
    if (!valor) throw new Error(`${nombre} es obligatorio`);
  }
  return opciones;
}

// --- Imágenes ----------------------------------------------------------------------

export type MimeImagen = "image/jpeg" | "image/png" | "image/webp";

const EXTENSIONES = /\.(jpe?g|png|webp)$/i;

export function esArchivoDeImagen(archivo: string): boolean {
  return EXTENSIONES.test(archivo);
}

/** El formato lo dicen los primeros bytes, no la extensión. */
export function mimeDe(bytes: Uint8Array): MimeImagen | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((valor, i) => bytes[i] === valor)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

function ascii(bytes: Uint8Array, desde: number, hasta: number): string {
  return String.fromCharCode(...bytes.subarray(desde, hasta));
}

const u16be = (bytes: Uint8Array, i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
const u16le = (bytes: Uint8Array, i: number) => bytes[i]! | (bytes[i + 1]! << 8);

/** Tamaño en píxeles leído de la cabecera (sin decodificar ni mirar EXIF); `null` si no se puede. */
export function dimensionesImagen(bytes: Uint8Array): { ancho: number; alto: number } | null {
  const mime = mimeDe(bytes);
  const valida = (ancho: number, alto: number) => (ancho > 0 && alto > 0 ? { ancho, alto } : null);
  if (mime === "image/png" && bytes.length >= 24) {
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return valida(vista.getUint32(16), vista.getUint32(20));
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marcador = bytes[i + 1]!;
      if (marcador === 0xff) { i += 1; continue; }
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }
      if (marcador === 0xd9) return null;
      // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC): alto y ancho de 16 bits tras la precisión.
      if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
        return i + 8 < bytes.length ? valida(u16be(bytes, i + 7), u16be(bytes, i + 5)) : null;
      }
      i += 2 + u16be(bytes, i + 2);
    }
    return null;
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const trozo = ascii(bytes, 12, 16);
    if (trozo === "VP8 ") return valida(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
    if (trozo === "VP8L") {
      const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0;
      return valida((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (trozo === "VP8X") return valida((bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1, (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1);
  }
  return null;
}

// --- Inventario --------------------------------------------------------------------

export type FotoCandidata = {
  sha256: string;
  /** Ruta relativa a `--fotos`, con `/`. */
  archivo: string;
  bytes: number;
  ancho: number | null;
  alto: number | null;
  /** Primera carpeta de la ruta, o «(raíz)». */
  carpeta: string;
};

export type MotivoExclusion = "ilegible" | "formato_no_admitido" | "duplicado_exacto";

export type Inventario = {
  candidatas: FotoCandidata[];
  excluidas: Array<{ archivo: string; motivo: MotivoExclusion }>;
  /** Archivos que no son jpg/jpeg/png/webp por extensión: ni se leen. */
  ignorados: number;
};

const porTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Lee cada imagen una vez (sha256 de los bytes) y descarta los duplicados exactos: se queda la de menor ruta. */
export function inventariarFotos(archivos: readonly string[], leerBytes: (archivo: string) => Uint8Array | null): Inventario {
  const candidatas: FotoCandidata[] = [];
  const excluidas: Inventario["excluidas"] = [];
  const vistos = new Set<string>();
  let ignorados = 0;
  for (const archivo of [...archivos].sort(porTexto)) {
    if (!esArchivoDeImagen(archivo)) { ignorados += 1; continue; }
    const bytes = leerBytes(archivo);
    if (!bytes) { excluidas.push({ archivo, motivo: "ilegible" }); continue; }
    if (mimeDe(bytes) === null) { excluidas.push({ archivo, motivo: "formato_no_admitido" }); continue; }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (vistos.has(sha256)) { excluidas.push({ archivo, motivo: "duplicado_exacto" }); continue; }
    vistos.add(sha256);
    const dimensiones = dimensionesImagen(bytes);
    candidatas.push({
      sha256, archivo, bytes: bytes.length, ancho: dimensiones?.ancho ?? null, alto: dimensiones?.alto ?? null,
      carpeta: archivo.includes("/") ? archivo.split("/")[0]! : "(raíz)",
    });
  }
  return { candidatas, excluidas, ignorados };
}

// --- Selección ---------------------------------------------------------------------

export type Orientacion = "horizontal" | "vertical" | "cuadrada" | "desconocida";

export function orientacionDe(foto: Pick<FotoCandidata, "ancho" | "alto">): Orientacion {
  if (!foto.ancho || !foto.alto) return "desconocida";
  const razon = foto.ancho / foto.alto;
  return razon > 1.05 ? "horizontal" : razon < 0.95 ? "vertical" : "cuadrada";
}

const TAMANOS = ["chico", "medio", "grande"] as const;

/** Tercil de tamaño de archivo de cada foto dentro del conjunto: 0 chico, 1 medio, 2 grande. */
function tercilesDeTamano(fotos: readonly FotoCandidata[]): Map<string, 0 | 1 | 2> {
  const orden = [...fotos].sort((a, b) => a.bytes - b.bytes || porTexto(a.sha256, b.sha256));
  return new Map(orden.map((foto, rango) => [foto.sha256, Math.floor((rango * 3) / orden.length) as 0 | 1 | 2]));
}

/** Aleatorio reproducible (mulberry32) sembrado con el sha256 del texto de la semilla. */
export function crearAleatorio(semilla: string): () => number {
  let estado = createHash("sha256").update(semilla).digest().readUInt32LE(0);
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar<T>(items: readonly T[], azar: () => number): T[] {
  const copia = [...items];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia;
}

/** Una de cada lista por ronda, hasta agotarlas. */
function entrelazar<T>(listas: ReadonlyArray<readonly T[]>): T[] {
  const salida: T[] = [];
  for (let ronda = 0; ; ronda += 1) {
    let hubo = false;
    for (const lista of listas) {
      if (ronda < lista.length) { salida.push(lista[ronda]!); hubo = true; }
    }
    if (!hubo) return salida;
  }
}

export type SeleccionConteo = {
  elegidas: FotoCandidata[];
  criterio: "carpeta+orientacion+tamano" | "orientacion+tamano";
  /** Fotos elegidas por estrato (carpeta cuando se usa, orientación y tamaño de archivo). */
  estratos: Record<string, number>;
};

/**
 * Selección estratificada y reproducible. No hay metadato barato de la
 * estructura (el reconocedor es de pago y no se llama aquí), así que se
 * estratifica por lo que hay: la carpeta de primer nivel, si las fotos vienen en
 * 2 o más carpetas (p. ej. una por clase), y dentro de cada una por orientación
 * y tercil de tamaño de archivo (una foto de pocos KB suele ser de pocos
 * globos o muy comprimida; es una pista débil, no una verdad). Se reparte una
 * foto por estrato y ronda, no en proporción: una carpeta con 200 fotos no
 * tapa a otra con 3. El resultado depende solo de los bytes, los tamaños y la
 * semilla, no del orden en que el sistema de archivos lista, y su orden ya sale
 * mezclado (no sigue el nombre del archivo).
 */
export function seleccionarFotos(candidatas: readonly FotoCandidata[], max: number, semilla: string): SeleccionConteo {
  const azar = crearAleatorio(semilla);
  const base = [...candidatas].sort((a, b) => porTexto(a.sha256, b.sha256));
  const usarCarpeta = new Set(base.map((foto) => foto.carpeta)).size > 1;
  const terciles = tercilesDeTamano(base);
  const etiqueta = (foto: FotoCandidata) => `${orientacionDe(foto)}|${TAMANOS[terciles.get(foto.sha256)!]}`;

  const porCarpeta = new Map<string, Map<string, FotoCandidata[]>>();
  for (const foto of base) {
    const carpeta = usarCarpeta ? foto.carpeta : "";
    const estratos = porCarpeta.get(carpeta) ?? new Map<string, FotoCandidata[]>();
    estratos.set(etiqueta(foto), [...(estratos.get(etiqueta(foto)) ?? []), foto]);
    porCarpeta.set(carpeta, estratos);
  }
  const colas = barajar([...porCarpeta.keys()].sort(porTexto), azar).map((carpeta) => {
    const estratos = porCarpeta.get(carpeta)!;
    return entrelazar(barajar([...estratos.keys()].sort(porTexto), azar).map((clave) => barajar(estratos.get(clave)!, azar)));
  });
  const elegidas = entrelazar(colas).slice(0, max);

  const estratos: Record<string, number> = {};
  for (const foto of elegidas) {
    const clave = `${usarCarpeta ? `${foto.carpeta}|` : ""}${etiqueta(foto)}`;
    estratos[clave] = (estratos[clave] ?? 0) + 1;
  }
  return { elegidas, criterio: usarCarpeta ? "carpeta+orientacion+tamano" : "orientacion+tamano", estratos };
}

// --- Archivos de salida --------------------------------------------------------------

function campoCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** `sha256,archivo`: la persona sabe qué foto es cuál. Lleva nombres de archivo: vive fuera del repo. */
export function indiceCsv(elegidas: readonly FotoCandidata[]): string {
  return ["sha256,archivo", ...elegidas.map((foto) => `${foto.sha256},${campoCsv(foto.archivo)}`)].join("\n") + "\n";
}

/**
 * Plantilla de la verdad: una fila por foto con la cuenta en blanco. Es a
 * propósito inválida para `leerVerdadConteo` (globos exige un entero): una
 * plantilla sin rellenar no puede pasar por una verdad.
 */
export function verdadPlantillaCsv(elegidas: readonly FotoCandidata[]): string {
  return ["sha256,globos,exacto,familia", ...elegidas.map((foto) => `${foto.sha256},,,`)].join("\n") + "\n";
}

export function suiteConteo(elegidas: readonly FotoCandidata[], suiteId: string, permisoProveedor: boolean) {
  return SuiteSchema.parse({
    suite_id: suiteId,
    taxonomy_version: TAXONOMIA_SUITE,
    items: elegidas.map((foto) => ({
      image_sha256: foto.sha256,
      ruta_privada: foto.archivo,
      // El permiso lo declara una persona (`--permiso-proveedor`); la herramienta no lo supone.
      evaluacion_con_proveedor_externo: permisoProveedor,
      envio_proveedores_ia_permitido: permisoProveedor,
    })),
  });
}

/** Identifica el juego de fotos: separa el avance guardado en el navegador de otra suite (todo `file://` comparte el almacenamiento). */
export function claveDeSuite(elegidas: readonly FotoCandidata[]): string {
  return createHash("sha256").update(elegidas.map((foto) => foto.sha256).join("\n")).digest("hex").slice(0, 16);
}

// --- Orquestación ----------------------------------------------------------------------

export type DependenciasPreparar = {
  repo: string;
  /** Rutas relativas (con `/`) de todos los archivos bajo la carpeta, recursivo, sin seguir enlaces simbólicos. */
  listarArchivos: (raiz: string) => string[];
  leerBytes: (ruta: string) => Uint8Array | null;
  existe: (ruta: string) => boolean;
  escribirTexto: (ruta: string, texto: string) => void;
  log: (mensaje: string) => void;
};

export type ResultadoPreparar = {
  modo: "preview" | "escritura";
  elegidas: FotoCandidata[];
  imagenes: "incrustar" | "enlazar";
  archivos: string[];
};

export function prepararConteoManual(argv: readonly string[], deps: DependenciasPreparar): ResultadoPreparar {
  const opciones = leerArgumentosPreparar(argv);
  if (dentroDe(deps.repo, opciones.fotos)) throw new Error("--fotos debe quedar fuera del repositorio: ninguna imagen entra al repo");
  if (dentroDe(deps.repo, opciones.salida)) throw new Error("--salida debe quedar fuera del repositorio: el índice y la verdad son datos de evaluación privados");
  if (dentroDe(opciones.fotos, deps.repo)) throw new Error("--fotos no puede contener el repositorio: se recorrería todo su contenido");

  const archivos = deps.listarArchivos(opciones.fotos);
  if (archivos.length > MAX_ARCHIVOS_ESCANEADOS) throw new Error(`--fotos tiene ${archivos.length} archivos (máximo ${MAX_ARCHIVOS_ESCANEADOS}): apunta a una carpeta de fotos`);
  const inventario = inventariarFotos(archivos, (archivo) => deps.leerBytes(resolve(opciones.fotos, archivo)));
  if (inventario.candidatas.length === 0) throw new Error("no hay imágenes jpg/jpeg/png/webp legibles en --fotos");
  const seleccion = seleccionarFotos(inventario.candidatas, opciones.max, opciones.semilla);
  const { elegidas } = seleccion;

  const motivos = inventario.excluidas.reduce<Record<string, number>>((acumulado, { motivo }) => ({ ...acumulado, [motivo]: (acumulado[motivo] ?? 0) + 1 }), {});
  const totalBytes = elegidas.reduce((suma, foto) => suma + foto.bytes, 0);
  const imagenes: "incrustar" | "enlazar" = opciones.imagenes === "auto" ? (totalBytes <= UMBRAL_INCRUSTAR_BYTES ? "incrustar" : "enlazar") : opciones.imagenes;
  deps.log(`[conteo-manual] imágenes=${inventario.candidatas.length} duplicadas/excluidas=${inventario.excluidas.length} ${JSON.stringify(motivos)} otros archivos ignorados=${inventario.ignorados}`);
  deps.log(`[conteo-manual] elegidas=${elegidas.length} de ${inventario.candidatas.length} (--max ${opciones.max}, semilla "${opciones.semilla}") criterio=${seleccion.criterio}`);
  deps.log(`[conteo-manual] por estrato: ${JSON.stringify(seleccion.estratos)}`);
  deps.log(`[conteo-manual] contar.html: fotos ${imagenes === "incrustar" ? "incrustadas (data URI)" : "enlazadas por file://"}, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB elegidos`);
  if (!opciones.permisoProveedor) deps.log("[conteo-manual] suite.json queda SIN permiso de proveedor externo: eval:conteo la rechaza hasta que una persona lo declare (--permiso-proveedor)");

  const destino = (nombre: string) => resolve(opciones.salida, nombre);
  const nombres = Object.values(ARCHIVOS_SALIDA);
  if (!opciones.escribir) {
    deps.log("[conteo-manual] vista previa: agrega --escribir para guardar los 4 archivos");
    return { modo: "preview", elegidas, imagenes, archivos: [] };
  }
  const existentes = nombres.filter((nombre) => deps.existe(destino(nombre)));
  if (existentes.length > 0 && !opciones.sobrescribir) {
    throw new Error(`ya existen ${existentes.join(", ")} en --salida: verdad.csv puede tener trabajo humano. Usa otra carpeta o --sobrescribir`);
  }

  const fotosPagina: FotoPagina[] = elegidas.map((foto) => {
    const ruta = resolve(opciones.fotos, foto.archivo);
    if (imagenes === "enlazar") return { sha256: foto.sha256, src: pathToFileURL(ruta).href };
    const bytes = deps.leerBytes(ruta);
    const mime = bytes ? mimeDe(bytes) : null;
    if (!bytes || !mime) throw new Error("una foto elegida dejó de ser legible mientras se preparaba la página");
    return { sha256: foto.sha256, src: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
  });
  const pagina = construirPagina({ suiteId: opciones.suiteId, clave: claveDeSuite(elegidas), fotos: fotosPagina });
  const suite = suiteConteo(elegidas, opciones.suiteId, opciones.permisoProveedor);
  // Reproducible: la misma carpeta y semilla regeneran estos archivos; una escritura interrumpida se repite con --sobrescribir.
  deps.escribirTexto(destino(ARCHIVOS_SALIDA.verdad), verdadPlantillaCsv(elegidas));
  deps.escribirTexto(destino(ARCHIVOS_SALIDA.indice), indiceCsv(elegidas));
  deps.escribirTexto(destino(ARCHIVOS_SALIDA.suite), `${JSON.stringify(suite, null, 2)}\n`);
  deps.escribirTexto(destino(ARCHIVOS_SALIDA.pagina), pagina);
  deps.log(`[conteo-manual] escritos ${nombres.join(", ")} en --salida`);
  return { modo: "escritura", elegidas, imagenes, archivos: nombres.map(destino) };
}
