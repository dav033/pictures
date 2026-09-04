import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Prepara el conjunto de 300 fotos para el siguiente entrenamiento.
 *
 * Conserva las 154 fotos ya recaptionadas de v004 y suma 146 fotos únicas
 * del conjunto aprobado de 200 imágenes. Las nuevas quedan con su caption
 * histórico en `original/` como referencia y esperan recaptionado en `nuevo/`.
 * No sube nada a fal.ai.
 *
 * Ejecutar una sola vez: si la carpeta de salida existe, el script se detiene
 * para no sobrescribir trabajo previo.
 */

const ROOT = process.cwd();
const ACTUAL = path.join(ROOT, "data/staging/recaption-v004");
const APROBADO = path.join(ROOT, "data/staging/sempertex-full-v001");
const MANIFIESTO_APROBADO = path.join(ROOT, "data/processed/sempertex-full-v001.json");
const SALIDA = path.join(ROOT, "data/staging/recaption-v005");
const TOTAL = 300;
const NUEVAS = 146;

type RegistroAprobado = {
  id: string;
  role: string;
  theme: string;
  image: string;
  caption: string;
};

function esImagen(nombre: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(nombre);
}

function base(nombre: string): string {
  return nombre.replace(/\.[^.]+$/, "");
}

function listarImagenes(directorio: string): string[] {
  return fs.readdirSync(directorio).filter(esImagen).sort();
}

function copiar(origen: string, destino: string): void {
  fs.copyFileSync(origen, destino);
}

function hashArchivo(archivo: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(archivo)).digest("hex");
}

function seleccionarExtras(registros: RegistroAprobado[]): RegistroAprobado[] {
  const escenas = registros.filter((registro) => registro.role !== "product");
  const productosPorTema = new Map<string, RegistroAprobado[]>();
  for (const registro of registros.filter((item) => item.role === "product")) {
    const grupo = productosPorTema.get(registro.theme) ?? [];
    grupo.push(registro);
    productosPorTema.set(registro.theme, grupo);
  }

  const temas = [...productosPorTema.keys()].sort();
  const productos: RegistroAprobado[] = [];
  for (let indice = 0; productos.length < NUEVAS - escenas.length; indice += 1) {
    let agrego = false;
    for (const tema of temas) {
      const candidato = productosPorTema.get(tema)?.[indice];
      if (candidato && productos.length < NUEVAS - escenas.length) {
        productos.push(candidato);
        agrego = true;
      }
    }
    if (!agrego) break;
  }

  const seleccion = [...escenas, ...productos];
  if (escenas.length !== 120 || seleccion.length !== NUEVAS) {
    throw new Error(`Selección inesperada: ${escenas.length} escenas, ${productos.length} productos.`);
  }
  return seleccion;
}

function main(): void {
  if (fs.existsSync(SALIDA)) {
    throw new Error(`Ya existe ${SALIDA}. Borrado manual requerido antes de recrear el conjunto.`);
  }
  if (!fs.existsSync(path.join(ACTUAL, "original")) || !fs.existsSync(path.join(ACTUAL, "nuevo"))) {
    throw new Error(`Falta el dataset recaptionado en ${ACTUAL}.`);
  }
  if (!fs.existsSync(APROBADO) || !fs.existsSync(MANIFIESTO_APROBADO)) {
    throw new Error(`Falta el conjunto aprobado en ${APROBADO}.`);
  }

  const imagenesActuales = listarImagenes(path.join(ACTUAL, "original"));
  if (imagenesActuales.length !== 154) throw new Error(`Dataset actual inesperado: ${imagenesActuales.length} imágenes.`);
  const registros = JSON.parse(fs.readFileSync(MANIFIESTO_APROBADO, "utf8")) as { records: RegistroAprobado[] };
  if (registros.records.length !== 200) throw new Error(`Manifiesto aprobado inesperado: ${registros.records.length} registros.`);
  const extras = seleccionarExtras(registros.records);

  fs.mkdirSync(path.join(SALIDA, "original"), { recursive: true });
  fs.mkdirSync(path.join(SALIDA, "nuevo"), { recursive: true });

  const entradas: Array<Record<string, unknown>> = [];
  const hashes = new Set<string>();

  for (const imagen of imagenesActuales) {
    const nombre = base(imagen);
    const imagenOrigen = path.join(ACTUAL, "original", imagen);
    const captionOriginal = path.join(ACTUAL, "original", `${nombre}.txt`);
    const captionNuevo = path.join(ACTUAL, "nuevo", `${nombre}.txt`);
    if (!fs.existsSync(captionNuevo)) throw new Error(`Falta caption recaptionado para ${imagen}.`);
    copiar(imagenOrigen, path.join(SALIDA, "original", imagen));
    if (fs.existsSync(captionOriginal)) copiar(captionOriginal, path.join(SALIDA, "original", `${nombre}.txt`));
    copiar(captionNuevo, path.join(SALIDA, "nuevo", `${nombre}.txt`));
    const hash = hashArchivo(imagenOrigen);
    if (hashes.has(hash)) throw new Error(`Imagen duplicada: ${imagen}`);
    hashes.add(hash);
    entradas.push({ nombre, origen: "recaption-v004", captionListo: true, sha256: hash });
  }

  for (const registro of extras) {
    const imagenOrigen = path.join(ROOT, registro.image);
    const captionOrigen = path.join(ROOT, registro.caption);
    const nombre = path.basename(registro.image, path.extname(registro.image));
    if (!fs.existsSync(imagenOrigen) || !fs.existsSync(captionOrigen)) {
      throw new Error(`Falta imagen o caption aprobado para ${registro.id}.`);
    }
    const destinoImagen = path.join(SALIDA, "original", `${nombre}${path.extname(registro.image)}`);
    copiar(imagenOrigen, destinoImagen);
    copiar(captionOrigen, path.join(SALIDA, "original", `${nombre}.txt`));
    const hash = hashArchivo(imagenOrigen);
    if (hashes.has(hash)) throw new Error(`Imagen duplicada: ${registro.id}`);
    hashes.add(hash);
    entradas.push({
      nombre,
      origen: registro.image,
      id: registro.id,
      role: registro.role,
      theme: registro.theme,
      captionListo: false,
      sha256: hash,
    });
  }

  if (entradas.length !== TOTAL || hashes.size !== TOTAL) {
    throw new Error(`Salida inválida: ${entradas.length} entradas, ${hashes.size} imágenes únicas.`);
  }

  const roles = Object.fromEntries(
    entradas.reduce((conteo, entrada) => {
      const rol = String(entrada.role ?? "recaption-v004");
      conteo.set(rol, (conteo.get(rol) ?? 0) + 1);
      return conteo;
    }, new Map<string, number>()),
  );
  fs.writeFileSync(
    path.join(SALIDA, "seleccion-300.json"),
    JSON.stringify(
      {
        version: 1,
        total: TOTAL,
        captionListos: 154,
        captionsPendientes: NUEVAS,
        fuentes: ["data/staging/recaption-v004", "data/staging/sempertex-full-v001"],
        estrategia: "154 recaptionadas actuales + 120 escenas aprobadas + 26 productos distribuidos por tema",
        roles,
        entradas,
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify({ salida: path.relative(ROOT, SALIDA), total: TOTAL, captionListos: 154, captionsPendientes: NUEVAS, roles }, null, 2));
}

main();
