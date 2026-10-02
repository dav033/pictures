import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { SuiteSchema } from "../../src/lib/eval/estructuras/cli-reconocimiento";
import { leerVerdadConteo } from "../../src/lib/eval/estructuras/conteo";
import { FAMILIAS_V2 } from "../../src/lib/eval/estructuras/familia-v1-v2";
import { construirPagina, jsonParaHtml, LOGICA_PAGINA } from "../../src/lib/eval/estructuras/pagina-conteo-manual";
import {
  ARCHIVOS_SALIDA,
  claveDeSuite,
  dimensionesImagen,
  indiceCsv,
  inventariarFotos,
  leerArgumentosPreparar,
  mimeDe,
  orientacionDe,
  prepararConteoManual,
  seleccionarFotos,
  UMBRAL_INCRUSTAR_BYTES,
  verdadPlantillaCsv,
  type DependenciasPreparar,
  type FotoCandidata,
} from "../../src/lib/eval/estructuras/preparar-conteo-manual";

/**
 * Preparación del conteo manual (ADR-0031, E2) con E/S simulada: argumentos y
 * rutas privadas, inventario sin duplicados, selección estratificada y
 * reproducible, los cuatro archivos de salida contra SuiteSchema y
 * `leerVerdadConteo`, y la lógica de contar.html cargada en un contexto aislado
 * y comparada con `leerVerdadConteo`. Sin red, sin disco ni proveedor.
 * Run: npx tsx scripts/test/test-preparar-conteo-manual.ts
 */

let casos = 0;
function caso(nombre: string, fn: () => void): void {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const REPO = resolve("C:/repo-simulado");
const FOTOS = resolve("C:/privado-simulado/fotos");
const SALIDA = resolve("C:/privado-simulado/conteo");

// --- Imágenes sintéticas: solo cabeceras que `mimeDe` y `dimensionesImagen` leen ---------------

function png(ancho: number, alto: number, relleno = 0): Uint8Array {
  const bytes = new Uint8Array(64 + relleno);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, ancho);
  new DataView(bytes.buffer).setUint32(20, alto);
  return bytes;
}

function jpeg(ancho: number, alto: number, relleno = 0): Uint8Array {
  // SOI, un APP0 de 16 bytes, SOF0 (precisión 8, alto, ancho).
  const bytes = new Uint8Array(40 + relleno);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  bytes.set([0xff, 0xc0, 0x00, 0x0b, 8, alto >> 8, alto & 255, ancho >> 8, ancho & 255, 1, 1, 0x11, 0], 20);
  return bytes;
}

function webpVp8x(ancho: number, alto: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46, 32, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  bytes.set([(ancho - 1) & 255, ((ancho - 1) >> 8) & 255, ((ancho - 1) >> 16) & 255, (alto - 1) & 255, ((alto - 1) >> 8) & 255, ((alto - 1) >> 16) & 255], 24);
  return bytes;
}

function webpVp8l(ancho: number, alto: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46, 32, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 10, 0, 0, 0, 0x2f]);
  const bits = ((ancho - 1) | ((alto - 1) << 14)) >>> 0;
  bytes.set([bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255], 21);
  return bytes;
}

function webpVp8(ancho: number, alto: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x52, 0x49, 0x46, 0x46, 32, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a]);
  bytes.set([ancho & 255, (ancho >> 8) & 0x3f, alto & 255, (alto >> 8) & 0x3f], 26);
  return bytes;
}

function foto(n: number, extra: Partial<FotoCandidata> = {}): FotoCandidata {
  return { sha256: createHash("sha256").update(`foto-${n}`).digest("hex"), archivo: `f${n}.jpg`, bytes: 1000 + n, ancho: 800, alto: 600, carpeta: "(raíz)", ...extra };
}

const hash = (n: number) => n.toString(16).padStart(64, "0");

/** Entorno de archivos en memoria: `fotos` por ruta relativa y lo escrito por ruta absoluta. */
function entorno(fotos: Record<string, Uint8Array>) {
  const escritos = new Map<string, string>();
  const eventos: string[] = [];
  const deps: DependenciasPreparar = {
    repo: REPO,
    listarArchivos: () => Object.keys(fotos),
    leerBytes: (ruta) => fotos[ruta.slice(FOTOS.length + 1).replace(/\\/g, "/")] ?? null,
    existe: (ruta) => escritos.has(ruta),
    escribirTexto: (ruta, texto) => { escritos.set(ruta, texto); },
    log: (mensaje) => { eventos.push(mensaje); },
  };
  return { deps, escritos, eventos };
}

const base = ["--fotos", FOTOS, "--salida", SALIDA];
const salidaDe = (nombre: string) => resolve(SALIDA, nombre);

// --- Argumentos y compuertas ---------------------------------------------------------------

caso("argumentos: --fotos y --salida obligatorios, vista previa por defecto, 30 fotos", () => {
  const opciones = leerArgumentosPreparar(base);
  assert.deepEqual([opciones.max, opciones.escribir, opciones.sobrescribir, opciones.permisoProveedor, opciones.imagenes], [30, false, false, false, "auto"]);
  assert.throws(() => leerArgumentosPreparar(["--salida", SALIDA]), /--fotos es obligatorio/);
  assert.throws(() => leerArgumentosPreparar(["--fotos", FOTOS]), /--salida es obligatorio/);
  assert.throws(() => leerArgumentosPreparar([...base, "--max"]), /--max necesita un valor/);
  assert.throws(() => leerArgumentosPreparar([...base, "--max", "--escribir"]), /--max necesita un valor/);
  for (const malo of ["0", "501", "diez", "1.5", "-3", "1e1"]) assert.throws(() => leerArgumentosPreparar([...base, "--max", malo]), /--max debe ser un entero 1-500/, malo);
  assert.throws(() => leerArgumentosPreparar([...base, "--imagenes", "web"]), /--imagenes debe ser/);
  assert.throws(() => leerArgumentosPreparar([...base, "--suite-id", "con espacio"]), /--suite-id inválido/);
  assert.throws(() => leerArgumentosPreparar([...base, "--cohete", "1"]), /opción desconocida/);
  assert.equal(leerArgumentosPreparar([...base, "--max", "12", "--semilla", "abc", "--escribir", "--permiso-proveedor"]).semilla, "abc");
});

caso("rutas privadas: fotos o salida dentro del repo, o fotos que contiene el repo, se rechazan sin leer nada", () => {
  const { deps, eventos } = entorno({ "a.jpg": png(10, 10) });
  assert.throws(() => prepararConteoManual(["--fotos", resolve(REPO, "datos"), "--salida", SALIDA], deps), /--fotos debe quedar fuera/);
  assert.throws(() => prepararConteoManual(["--fotos", FOTOS, "--salida", resolve(REPO, "eval/conteo")], deps), /--salida debe quedar fuera/);
  assert.throws(() => prepararConteoManual(["--fotos", resolve("C:/"), "--salida", SALIDA], deps), /no puede contener el repositorio/);
  assert.deepEqual(eventos, []);
});

// --- Imágenes ----------------------------------------------------------------------------------

caso("formato y tamaño salen de la cabecera: png, jpeg y los tres webp", () => {
  assert.equal(mimeDe(png(1, 1)), "image/png");
  assert.equal(mimeDe(jpeg(1, 1)), "image/jpeg");
  assert.equal(mimeDe(webpVp8x(1, 1)), "image/webp");
  assert.equal(mimeDe(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(dimensionesImagen(png(1200, 800)), { ancho: 1200, alto: 800 });
  assert.deepEqual(dimensionesImagen(jpeg(640, 960)), { ancho: 640, alto: 960 });
  assert.deepEqual(dimensionesImagen(webpVp8x(3000, 2000)), { ancho: 3000, alto: 2000 });
  assert.deepEqual(dimensionesImagen(webpVp8l(500, 700)), { ancho: 500, alto: 700 });
  assert.deepEqual(dimensionesImagen(webpVp8(333, 444)), { ancho: 333, alto: 444 });
  assert.equal(dimensionesImagen(png(0, 0)), null);
  assert.equal(dimensionesImagen(new Uint8Array([0xff, 0xd8, 0xff])), null, "un jpeg truncado no se interpreta");
  assert.deepEqual([orientacionDe({ ancho: 800, alto: 600 }), orientacionDe({ ancho: 600, alto: 800 }), orientacionDe({ ancho: 700, alto: 690 }), orientacionDe({ ancho: null, alto: null })], ["horizontal", "vertical", "cuadrada", "desconocida"]);
});

caso("inventario: sha256 de los bytes, descarta duplicados exactos, ignora lo que no es imagen y no se fía de la extensión", () => {
  const original = png(100, 100, 5);
  const archivos: Record<string, Uint8Array> = {
    "a/uno.png": original,
    "b/copia-del-uno.jpg": original,
    "b/dos.jpg": jpeg(100, 200),
    "notas.txt": new Uint8Array([1]),
    "falsa.jpg": new Uint8Array([9, 9, 9, 9]),
  };
  const resultado = inventariarFotos([...Object.keys(archivos), "fantasma.png"], (archivo) => archivos[archivo] ?? null);
  assert.deepEqual(resultado.candidatas.map((c) => c.archivo), ["a/uno.png", "b/dos.jpg"], "de los duplicados se queda la de menor ruta");
  assert.equal(resultado.candidatas[0]!.sha256, createHash("sha256").update(original).digest("hex"));
  assert.deepEqual(resultado.candidatas.map((c) => c.carpeta), ["a", "b"]);
  assert.deepEqual(resultado.excluidas.map((e) => [e.archivo, e.motivo]).sort(), [["b/copia-del-uno.jpg", "duplicado_exacto"], ["falsa.jpg", "formato_no_admitido"], ["fantasma.png", "ilegible"]]);
  assert.equal(resultado.ignorados, 1);
});

// --- Selección ---------------------------------------------------------------------------------

caso("selección: reproducible por semilla, independiente del orden de entrada y distinta con otra semilla", () => {
  const todas = Array.from({ length: 80 }, (_, n) => foto(n, { ancho: n % 2 ? 600 : 800, alto: n % 2 ? 800 : 600, bytes: 500 + n * 37 }));
  const a = seleccionarFotos(todas, 30, "s1").elegidas.map((f) => f.sha256);
  assert.equal(a.length, 30);
  assert.equal(new Set(a).size, 30);
  assert.deepEqual(seleccionarFotos([...todas].reverse(), 30, "s1").elegidas.map((f) => f.sha256), a);
  assert.notDeepEqual(seleccionarFotos(todas, 30, "s2").elegidas.map((f) => f.sha256), a);
  const todasElegidas = seleccionarFotos(todas.slice(0, 7), 30, "s1").elegidas;
  assert.equal(todasElegidas.length, 7, "con menos fotos que --max se usan todas");
  assert.notDeepEqual(todasElegidas.map((f) => f.archivo), todas.slice(0, 7).map((f) => f.archivo), "el orden mostrado no sigue el nombre del archivo");
});

caso("selección: con varias carpetas reparte entre ellas; una carpeta enorme no tapa a las pequeñas", () => {
  const grande = Array.from({ length: 60 }, (_, n) => foto(n, { carpeta: "arco", archivo: `arco/${n}.jpg` }));
  const medio = Array.from({ length: 5 }, (_, n) => foto(100 + n, { carpeta: "bouquet", archivo: `bouquet/${n}.jpg` }));
  const chico = Array.from({ length: 3 }, (_, n) => foto(200 + n, { carpeta: "figura", archivo: `figura/${n}.jpg` }));
  const seleccion = seleccionarFotos([...grande, ...medio, ...chico], 12, "s1");
  assert.equal(seleccion.criterio, "carpeta+orientacion+tamano");
  const porCarpeta = (carpeta: string) => seleccion.elegidas.filter((f) => f.carpeta === carpeta).length;
  assert.equal(porCarpeta("figura"), 3, "la carpeta chica entra completa");
  assert.ok(porCarpeta("bouquet") >= 4 && porCarpeta("arco") >= 4, `arco ${porCarpeta("arco")}, bouquet ${porCarpeta("bouquet")}`);
  assert.equal(seleccion.elegidas.length, 12);
});

caso("selección: sin carpetas estratifica por orientación y tamaño de archivo", () => {
  const horizontales = Array.from({ length: 30 }, (_, n) => foto(n, { ancho: 900, alto: 600, bytes: 10_000 + n * 1000 }));
  const verticales = Array.from({ length: 30 }, (_, n) => foto(100 + n, { ancho: 600, alto: 900, bytes: 10_000 + n * 1000 }));
  const seleccion = seleccionarFotos([...horizontales, ...verticales], 12, "s1");
  assert.equal(seleccion.criterio, "orientacion+tamano");
  const h = seleccion.elegidas.filter((f) => orientacionDe(f) === "horizontal").length;
  assert.ok(h >= 5 && h <= 7, `horizontales ${h} de 12`);
  const tercio = (f: FotoCandidata) => f.bytes < 10_000 + 20 * 1000 ? (f.bytes < 10_000 + 10 * 1000 ? 0 : 1) : 2;
  for (const t of [0, 1, 2]) assert.ok(seleccion.elegidas.some((f) => tercio(f) === t), `falta el tercil de tamaño ${t}`);
  assert.equal(Object.values(seleccion.estratos).reduce((suma, n) => suma + n, 0), 12);
});

// --- Archivos de salida ------------------------------------------------------------------------

const fotosSinteticas: Record<string, Uint8Array> = Object.fromEntries(
  Array.from({ length: 6 }, (_, n) => [`lote/foto, ${n} "x".png`, png(300 + n, 200 + 2 * n, n * 10)]),
);

caso("vista previa por defecto: informa y no escribe nada", () => {
  const { deps, escritos, eventos } = entorno(fotosSinteticas);
  const resultado = prepararConteoManual([...base, "--max", "4"], deps);
  assert.equal(resultado.modo, "preview");
  assert.equal(resultado.elegidas.length, 4);
  assert.equal(escritos.size, 0);
  assert.ok(eventos.some((e) => /vista previa: agrega --escribir/.test(e)));
  assert.ok(eventos.some((e) => /SIN permiso de proveedor externo/.test(e)));
});

caso("--escribir: suite válida, plantilla que leerVerdadConteo rechaza, índice y página; el CSV completo sí pasa", () => {
  const { deps, escritos } = entorno(fotosSinteticas);
  const resultado = prepararConteoManual([...base, "--max", "5", "--escribir"], deps);
  assert.equal(resultado.modo, "escritura");
  assert.deepEqual([...escritos.keys()].sort(), Object.values(ARCHIVOS_SALIDA).map(salidaDe).sort());

  const suite = SuiteSchema.parse(JSON.parse(escritos.get(salidaDe("suite.json"))!));
  assert.equal(suite.items.length, 5);
  assert.deepEqual(suite.items.map((i) => i.image_sha256), resultado.elegidas.map((f) => f.sha256));
  assert.ok(suite.items.every((i) => !i.ruta_privada.includes("\\") && !/^[A-Za-z]:|^\//.test(i.ruta_privada)), "ruta relativa a --fotos");
  assert.ok(suite.items.every((i) => i.evaluacion_con_proveedor_externo === false && i.envio_proveedores_ia_permitido === false), "sin --permiso-proveedor no se supone permiso");

  const plantilla = escritos.get(salidaDe("verdad.csv"))!;
  assert.equal(plantilla.split("\n")[0], "sha256,globos,exacto,familia");
  assert.equal(plantilla.trim().split("\n").length, 6);
  assert.throws(() => leerVerdadConteo(plantilla), /línea 2: globos debe ser un entero/);

  const indice = escritos.get(salidaDe("indice.csv"))!;
  assert.equal(indice.split("\n")[0], "sha256,archivo");
  assert.ok(indice.includes('"lote/foto, 0 ""x"".png"') || indice.includes('"lote/foto, 1 ""x"".png"'), "el nombre con coma y comillas va entre comillas CSV");

  // El CSV que descargaría la página: completo, y lo lee el evaluador.
  const completo = ["sha256,globos,exacto,familia", ...resultado.elegidas.map((f, i) => `${f.sha256},${i * 7},${i % 2 ? "si" : "no"},${i === 2 ? "arco" : ""}`)].join("\n") + "\n";
  const verdad = leerVerdadConteo(completo);
  assert.equal(verdad.size, 5);
  assert.equal(verdad.get(resultado.elegidas[2]!.sha256)?.familia, "arco");
  assert.equal(verdad.get(resultado.elegidas[1]!.sha256)?.exacto, true);
});

caso("--permiso-proveedor lo declara una persona y llega a la suite", () => {
  const { deps, escritos } = entorno(fotosSinteticas);
  prepararConteoManual([...base, "--max", "3", "--escribir", "--permiso-proveedor"], deps);
  const suite = SuiteSchema.parse(JSON.parse(escritos.get(salidaDe("suite.json"))!));
  assert.ok(suite.items.every((i) => i.evaluacion_con_proveedor_externo && i.envio_proveedores_ia_permitido));
});

caso("no pisa trabajo humano: con archivos existentes exige --sobrescribir, y la misma semilla repite lo elegido", () => {
  const { deps, escritos } = entorno(fotosSinteticas);
  prepararConteoManual([...base, "--max", "4", "--semilla", "x", "--escribir"], deps);
  const antes = escritos.get(salidaDe("suite.json"))!;
  escritos.set(salidaDe("verdad.csv"), "trabajo de una persona");
  assert.throws(() => prepararConteoManual([...base, "--max", "4", "--semilla", "x", "--escribir"], deps), /ya existen .*verdad\.csv.*trabajo humano/);
  assert.equal(escritos.get(salidaDe("verdad.csv")), "trabajo de una persona");
  prepararConteoManual([...base, "--max", "4", "--semilla", "x", "--escribir", "--sobrescribir"], deps);
  assert.equal(escritos.get(salidaDe("suite.json")), antes, "misma carpeta y semilla, misma suite");
  assert.notEqual(escritos.get(salidaDe("verdad.csv")), "trabajo de una persona");
});

caso("imágenes: incrusta por debajo del umbral, enlaza por file:// por encima y obedece --imagenes", () => {
  const { deps, escritos } = entorno(fotosSinteticas);
  const datos = (nombre: string) => JSON.parse(/<script type="application\/json" id="datos">([\s\S]*?)<\/script>/.exec(escritos.get(salidaDe(nombre))!)![1]!) as { fotos: Array<{ sha256: string; src: string }> };
  assert.equal(prepararConteoManual([...base, "--max", "3", "--escribir"], deps).imagenes, "incrustar");
  assert.ok(datos("contar.html").fotos.every((f) => f.src.startsWith("data:image/png;base64,")));
  assert.ok(!escritos.get(salidaDe("contar.html"))!.includes("lote/"), "incrustada, la página no lleva ningún nombre de archivo");
  const enlazado = prepararConteoManual([...base, "--max", "3", "--escribir", "--sobrescribir", "--imagenes", "enlazar"], deps);
  assert.equal(enlazado.imagenes, "enlazar");
  const html = escritos.get(salidaDe("contar.html"))!;
  assert.ok(datos("contar.html").fotos.every((f) => f.src.startsWith(pathToFileURL(FOTOS).href)), "enlace file:// a la carpeta de fotos");
  assert.ok(!html.includes("data:image"));
  // Por encima del umbral, auto enlaza.
  const pesadas = entorno({ "grande.png": png(10, 10, UMBRAL_INCRUSTAR_BYTES + 1) });
  assert.equal(prepararConteoManual([...base, "--escribir"], pesadas.deps).imagenes, "enlazar");
});

caso("plantilla, índice y clave: formas exactas", () => {
  const dos = [foto(1), foto(2, { archivo: "a b.jpg" })];
  assert.equal(verdadPlantillaCsv(dos), `sha256,globos,exacto,familia\n${dos[0]!.sha256},,,\n${dos[1]!.sha256},,,\n`);
  assert.equal(indiceCsv(dos), `sha256,archivo\n${dos[0]!.sha256},f1.jpg\n${dos[1]!.sha256},a b.jpg\n`);
  assert.equal(claveDeSuite(dos), claveDeSuite(dos));
  assert.notEqual(claveDeSuite(dos), claveDeSuite([dos[0]!]));
  assert.equal(claveDeSuite(dos).length, 16);
});

// --- contar.html ---------------------------------------------------------------------------------

type Logica = {
  CABECERA: string;
  vacia: () => Record<string, string>;
  normalizar: (entrada: unknown) => { globos: string; exacto: string; familia: string; nota: string };
  faltantes: (fila: Record<string, string>) => string[];
  esCompleta: (fila: Record<string, string>) => boolean;
  resumen: (filas: Array<Record<string, string>>) => { completas: number; pendientes: number[] };
  construirCsv: (filas: Array<Record<string, string>>) => { csv: string; completas: number; incompletas: number };
  csvNotas: (filas: Array<Record<string, string>>) => string;
  nombreArchivo: (base: string, contador: string) => string;
};

/** Lo que sale del contexto aislado trae otros prototipos: se compara por su forma JSON. */
const plano = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

/** La lógica que lleva la página, cargada aislada: sin DOM, sin red. */
function cargarLogica(): Logica {
  const contexto = vm.createContext({});
  vm.runInContext(`${LOGICA_PAGINA}; this.crearLogica = crearLogica;`, contexto);
  return (contexto as { crearLogica: (familias: readonly string[]) => Logica }).crearLogica(FAMILIAS_V2);
}

caso("la página valida igual que leerVerdadConteo (globos solo dígitos, exacto sí/no)", () => {
  const logica = cargarLogica();
  const sha = hash(7);
  const globosProbados = ["0", "6", "15", "16", "1200", "007", " 12 ", "", "  ", "1e1", "0x10", "+5", "5.0", "-1", "abc", "12 3", "1,5", "1234567"];
  for (const globos of globosProbados) {
    for (const exacto of ["si", "no", "", "quizas"]) {
      for (const familia of ["", "arco", "nose"]) {
        let evaluadorAcepta = true;
        try { leerVerdadConteo(`${sha},${globos},${exacto},${familia === "nose" ? "" : familia}`); } catch { evaluadorAcepta = false; }
        const fila = { sha256: sha, globos, exacto, familia };
        // Un entero de más de 6 dígitos lo admite el evaluador y no la página (más estricta a propósito): nadie cuenta un millón de globos.
        assert.equal(logica.esCompleta(fila), evaluadorAcepta && globos.trim().length <= 6, JSON.stringify(fila));
      }
    }
  }
});

caso("la descarga: solo filas completas, en orden, formato exacto y legible por leerVerdadConteo", () => {
  const logica = cargarLogica();
  const filas = [
    { sha256: hash(1), globos: " 12 ", exacto: "si", familia: "arco" },
    { sha256: hash(2), globos: "", exacto: "", familia: "" },
    { sha256: hash(3), globos: "007", exacto: "no", familia: "nose" },
    { sha256: hash(4), globos: "5", exacto: "", familia: "bouquet" },
    { sha256: hash(5), globos: "0", exacto: "no", familia: "" },
  ];
  const resultado = logica.construirCsv(filas);
  assert.deepEqual([resultado.completas, resultado.incompletas], [3, 2]);
  assert.equal(resultado.csv, `sha256,globos,exacto,familia\n${hash(1)},12,si,arco\n${hash(3)},7,no,\n${hash(5)},0,no,\n`);
  const verdad = leerVerdadConteo(resultado.csv);
  assert.deepEqual([...verdad.keys()], [hash(1), hash(3), hash(5)]);
  assert.deepEqual([verdad.get(hash(3))!.globos, verdad.get(hash(3))!.familia, verdad.get(hash(5))!.globos], [7, null, 0]);
  assert.deepEqual(plano(logica.resumen(filas)), { completas: 3, pendientes: [2, 4] });
  // Ninguna completa: el CSV no trae filas y la página no descarga.
  assert.equal(logica.construirCsv([filas[1]!]).completas, 0);
  assert.equal(logica.CABECERA, "sha256,globos,exacto,familia");
});

caso("la página no confía en el almacenamiento del navegador y nombra los archivos por contador", () => {
  const logica = cargarLogica();
  assert.deepEqual(plano(logica.normalizar(null)), { globos: "", exacto: "", familia: "", nota: "" });
  assert.deepEqual(plano(logica.normalizar({ globos: 5, exacto: "talvez", familia: "cohete", nota: 42 })), { globos: "5", exacto: "", familia: "", nota: "42" });
  assert.equal(logica.normalizar({ familia: "nose" }).familia, "nose");
  assert.equal(logica.nombreArchivo("verdad", ""), "verdad.csv");
  assert.equal(logica.nombreArchivo("verdad", "Ana Pérez/../x"), "verdad-AnaPrezx.csv");
  assert.equal(logica.csvNotas([{ sha256: hash(1), globos: "1", exacto: "si", familia: "", nota: 'dice "hola", y\nsigue ' }, { sha256: hash(2), globos: "", exacto: "", familia: "", nota: "  " }]), `sha256,nota\n${hash(1)},"dice ""hola"", y\nsigue"\n`);
});

caso("contar.html: autocontenida (sin red), sin nombres de archivo, JSON a salvo y script que compila", () => {
  const html = construirPagina({ suiteId: "conteo-manual-v1", clave: "abc", fotos: [{ sha256: hash(1), src: "data:image/png;base64,AAAA" }, { sha256: hash(2), src: "</script><b>x" }] });
  assert.ok(html.startsWith("<!doctype html>") && html.includes('<html lang="es">'));
  assert.ok(!/https?:\/\//.test(html), "sin direcciones de red");
  assert.ok(!/<link\b|<script[^>]*\ssrc=|@import|fetch\(|XMLHttpRequest/.test(html), "sin recursos externos ni peticiones");
  assert.equal(html.split("</script>").length - 1, 3, "una etiqueta de cierre por script: la del dato se escapó");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  const datos = JSON.parse(scripts[0]!) as { familias: string[]; fotos: Array<{ src: string }> };
  assert.deepEqual(datos.familias, [...FAMILIAS_V2]);
  assert.equal(datos.fotos[1]!.src, "</script><b>x");
  assert.doesNotThrow(() => new vm.Script(`${scripts[1]!}\n${scripts[2]!}`), "los scripts de la página compilan");
  for (const requisito of ['for="globos"', 'for="familia"', 'for="nota"', "<legend>", 'aria-live="polite"', ":focus-visible", "prefers-color-scheme", 'name="viewport"', 'type="radio" name="exacto"', "localStorage", "Descargar verdad.csv"]) {
    assert.ok(html.includes(requisito), `falta ${requisito}`);
  }
  assert.equal(jsonParaHtml({ a: "<!-- \u2028" }), '{"a":"\\u003c!-- \\u2028"}');
});

console.log(`[PASS] ${casos} casos de la preparación del conteo manual`);
