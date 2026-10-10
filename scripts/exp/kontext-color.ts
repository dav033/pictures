/**
 * Experimento PAGADO «color fiel» (2026-10-09): «Ver cómo quedaría» de la guiada cambia colores con FLUX.1 Kontext max (dorado
 * cromado → plata, lila pastel → gris). La imagen base es la captura de la vista de reserva del servidor (proyección SVG de la armada, sin
 * navegador). Las variantes del texto y las escenas están en `kontext-variantes.ts`; el gasto y su tope, en `kontext-gasto.ts`.
 *
 * Modos (FAL_KEY viene de --env-file; nunca se imprime; con `NODE_OPTIONS=--use-system-ca` por el proxy de la red). `[escena]` es `07`
 * (por defecto) o `10`:
 *   npx tsx --env-file=<.env.local> --conditions=react-server scripts/exp/kontext-color.ts offline [escena]
 *   npx tsx --env-file=<.env.local> --conditions=react-server scripts/exp/kontext-color.ts seco <variante> [escena]
 *   npx tsx --env-file=<.env.local> --conditions=react-server scripts/exp/kontext-color.ts pagar <variante> <semilla> [escena]
 *   npx tsx --env-file=<.env.local> --conditions=react-server scripts/exp/kontext-color.ts recuperar <variante> <semilla> [request_id]
 *   npx tsx --conditions=react-server scripts/exp/kontext-color.ts puntuar        (solo la escena 07)
 *   npx tsx --conditions=react-server scripts/exp/kontext-color.ts hoja [escena]
 * La llamada de pago es la de producción (`generarConFluxKontext`, auditada) con espera de hasta 5 min; el `request_id` se guarda en
 * `gasto.json` apenas fal acepta la solicitud, y si el plazo se agota `recuperar` trae la imagen por ese id sin enviar otra.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { armarDesdeEspec, descripcionImagenDeEspec, svgDeArmada, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";
import { capturaDesdeSvg, type CapturaPreparada } from "../../src/lib/guiada-motor/captura-imagen";
import { generarConFluxKontext, KontextEnCursoError } from "../../src/lib/ia/kagutsuchi/kontext";
import { especDeIdea, paletaDe } from "../lib/paleta-guiada";
import { CARPETA, COSTO_IMAGEN, guardarGasto, leerGasto, cabeOtraLlamada, reservar, TOPE_IMAGENES, type Llamada } from "./kontext-gasto";
import { crearHoja } from "./kontext-hoja";
import { imagenDeMascara, puntuarImagen, type Puntuacion } from "./kontext-puntuacion";
import { ESCENAS, esEscena, esVariante, prefijoDe, variantesDe, variantesDelPrompt, VARIANTES, type Escena, type Variante } from "./kontext-variantes";

/** El plazo de espera de cada toma: 5 minutos, más que cualquier toma vista (la peor tardó 113 s de inferencia). */
const PLAZO_TOMA_MS = 300_000;

const escenaDe = (arg: string | undefined): Escena => {
  if (arg === undefined) return "07";
  if (!esEscena(arg)) throw new Error(`Escena desconocida: ${arg} (${Object.keys(ESCENAS).join(" | ")})`);
  return arg;
};

function varianteDe(arg: string | undefined, escena: Escena): Variante {
  if (!esVariante(arg)) throw new Error(`Variante desconocida: ${arg}`);
  if (!variantesDe(escena).includes(arg)) throw new Error(`La variante ${arg} no se arma para la escena ${escena} (solo ${variantesDe(escena).join(", ")}).`);
  return arg;
}

const archivoDe = (escena: Escena, variante: Variante, semilla: number) => `${prefijoDe(escena)}${variante}-s${semilla}.png`;

async function capturaDeLaIdea(espec: EspecClienteV1): Promise<CapturaPreparada> {
  return capturaDesdeSvg(svgDeArmada(armarDesdeEspec(espec).armada, { vista: "tres-cuartos", lado: 1024, titulo: "Plan 3D" }));
}

/** La escena lista para una toma: su texto, su paleta y su captura. */
async function escenaLista(escena: Escena) {
  const espec = especDeIdea(ESCENAS[escena]);
  const descripcion = descripcionImagenDeEspec(espec).descripcion;
  const paleta = paletaDe(espec);
  return { espec, descripcion, paleta, prompts: variantesDelPrompt(descripcion, paleta, escena), captura: await capturaDeLaIdea(espec) };
}

async function modoOffline(escena: Escena): Promise<void> {
  mkdirSync(CARPETA, { recursive: true });
  const { descripcion, paleta, prompts, captura } = await escenaLista(escena);
  writeFileSync(join(CARPETA, `captura-idea${escena}.jpg`), Buffer.from(captura.base64, "base64"));
  writeFileSync(join(CARPETA, `descripcion-idea${escena}.txt`), descripcion);
  writeFileSync(join(CARPETA, `paleta-idea${escena}.json`), JSON.stringify(paleta, null, 2));
  for (const v of variantesDe(escena)) writeFileSync(join(CARPETA, `prompt-${prefijoDe(escena)}${v}.txt`), `${prompts[v]!.length} caracteres\n${prompts[v]}\n`);
  console.log(JSON.stringify({ captura: `${captura.ancho}x${captura.alto} ${captura.bytes} bytes`, paleta }, null, 2));
  for (const v of variantesDe(escena)) console.log(`\n=== ${v} (${prompts[v]!.length} car.)\n${prompts[v]}`);
}

/** Modo seco: arma lo que iría en la llamada y lo valida sin tocar la red. Nunca imprime la clave. */
async function modoSeco(variante: Variante, escena: Escena): Promise<void> {
  const { paleta, prompts, captura } = await escenaLista(escena);
  const prompt = prompts[variante]!;
  const url = `data:${captura.mime};base64,${captura.base64}`;
  const meta = await sharp(Buffer.from(captura.base64, "base64")).metadata();
  const bytes = Buffer.byteLength(captura.base64, "base64");
  const gasto = leerGasto();
  console.log(JSON.stringify({
    escena, variante,
    image_url_prefijo: url.slice(0, 30),
    image_url_largo: url.length,
    imagen_bytes: bytes,
    imagen_formato_real: meta.format,
    imagen_ancho_alto: `${meta.width}x${meta.height}`,
    prompt_largo: prompt.length,
    clave_en_entorno: Boolean(process.env.FAL_KEY),
    gastado_usd: gasto.total,
    cabe_otra_llamada: cabeOtraLlamada(gasto),
  }, null, 2));
  if (meta.format !== "jpeg" || bytes <= 10_000) throw new Error(`La imagen base debe ser JPEG real de más de 10 KB (es ${meta.format}, ${bytes} bytes).`);
  // El globo transparente («clear») no lleva hex en el texto: solo se pide que se vea a través.
  const sinHex = paleta.filter((c) => c.acabado !== "translucent" && !prompt.includes(c.hex));
  if (sinHex.length) throw new Error(`El prompt no trae los hex de ${sinHex.map((c) => c.hex).join(", ")}.`);
  if (!process.env.FAL_KEY) throw new Error("Falta FAL_KEY (--env-file).");
  reservar(gasto);
  console.log("SECO OK");
}

const guardarImagen = async (imagen: { base64: string }, archivo: string) => {
  const bytes = Buffer.from(imagen.base64, "base64");
  await sharp(bytes).png().toFile(join(CARPETA, archivo));
  const meta = await sharp(bytes).metadata();
  return `${meta.width}x${meta.height} ${meta.format}`;
};

async function modoPagar(variante: Variante, semilla: number, escena: Escena): Promise<void> {
  const gasto = leerGasto();
  reservar(gasto);
  const { prompts, captura } = await escenaLista(escena);
  const prompt = prompts[variante]!;
  const imagen = { base64: captura.base64, mime: captura.mime, ancho: captura.ancho, alto: captura.alto };
  const archivo = archivoDe(escena, variante, semilla);
  // Se reserva antes de llamar: si la llamada falla, el gasto ya cuenta (conservador).
  const llamada: Llamada = { variante, semilla, archivo, escena, costo: COSTO_IMAGEN, resultado: "fallo", cuando: new Date().toISOString() };
  gasto.total = Number((gasto.total + COSTO_IMAGEN).toFixed(4));
  gasto.llamadas.push(llamada);
  guardarGasto(gasto);
  const inicio = Date.now();
  try {
    const hecha = await generarConFluxKontext(prompt, {
      imagen, variante: "max", seed: semilla, plazoMs: PLAZO_TOMA_MS, telemetria: { superficie: "exp-kontext-color" },
      alEnviar: (requestId) => { llamada.requestId = requestId; llamada.resultado = "pendiente"; guardarGasto(gasto); },
    });
    const forma = await guardarImagen(hecha, archivo);
    writeFileSync(join(CARPETA, `prompt-${prefijoDe(escena)}${variante}.txt`), prompt);
    Object.assign(llamada, { resultado: "ok", ms: Date.now() - inicio });
    guardarGasto(gasto);
    console.log(`OK ${archivo} (${forma}) en ${Math.round((Date.now() - inicio) / 1000)} s; gastado US$${gasto.total.toFixed(2)} (${gasto.llamadas.length}/${TOPE_IMAGENES} imágenes)`);
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    Object.assign(llamada, { resultado: causa instanceof KontextEnCursoError ? "pendiente" : "fallo", motivo: motivo.slice(0, 200), ms: Date.now() - inicio });
    guardarGasto(gasto);
    console.log(`${llamada.resultado.toUpperCase()} ${archivo}: ${motivo.slice(0, 200)} gastado US$${gasto.total.toFixed(2)}${llamada.requestId ? ` (request_id ${llamada.requestId}; se recupera con «recuperar»)` : ""}`);
    process.exitCode = 1;
  }
}

/** Trae la imagen de una solicitud ya enviada (sin enviar otra ni sumar gasto). Con `request_id` lo asigna a la última llamada de esa variante y semilla. */
async function modoRecuperar(variante: Variante, semilla: number, requestId?: string): Promise<void> {
  const gasto = leerGasto();
  const llamada = [...gasto.llamadas].reverse().find((l) => l.variante === variante && l.semilla === semilla && l.resultado !== "ok" && (requestId || l.requestId));
  if (!llamada) throw new Error(`No hay una llamada pendiente de ${variante} con semilla ${semilla} en gasto.json.`);
  if (requestId) llamada.requestId = requestId;
  if (!llamada.requestId) throw new Error("La llamada no tiene request_id; pásalo como tercer argumento.");
  const escena = escenaDe(llamada.escena);
  const { prompts, captura } = await escenaLista(escena);
  const prompt = prompts[variante]!;
  try {
    const hecha = await generarConFluxKontext(prompt, {
      imagen: { base64: captura.base64, mime: captura.mime, ancho: captura.ancho, alto: captura.alto },
      variante: "max", seed: semilla, plazoMs: 60_000, solicitudPrevia: llamada.requestId, telemetria: { superficie: "exp-kontext-color" },
    });
    const forma = await guardarImagen(hecha, llamada.archivo);
    writeFileSync(join(CARPETA, `prompt-${prefijoDe(escena)}${variante}.txt`), prompt);
    Object.assign(llamada, { resultado: "ok", motivo: `recuperada por request_id tras: ${llamada.motivo ?? "corte"}` });
    guardarGasto(gasto);
    console.log(`RECUPERADA ${llamada.archivo} (${forma}); gasto sin cambio US$${gasto.total.toFixed(2)}`);
  } catch (causa) {
    if (!(causa instanceof KontextEnCursoError)) throw causa;
    guardarGasto(gasto);
    console.log("Sin imagen todavía: la solicitud sigue en curso. Vuelve a recuperar más tarde.");
  }
}

async function modoPuntuar(): Promise<void> {
  const paleta = paletaDe(especDeIdea(ESCENAS["07"]));
  const captura = join(CARPETA, "captura-idea07.jpg");
  const salidas = (existsSync(CARPETA) ? readdirSync(CARPETA) : []).filter((f) => /^(base|a|b|c|d)-s\d+\.png$/.test(f));
  const resultados: Record<string, Puntuacion> = {};
  mkdirSync(join(CARPETA, "mascaras"), { recursive: true });
  for (const f of salidas) {
    resultados[f] = await puntuarImagen(join(CARPETA, f), captura, paleta);
    await imagenDeMascara(join(CARPETA, f), captura, join(CARPETA, "mascaras", f));
  }
  resultados["captura-referencia"] = await puntuarImagen(captura, captura, paleta);
  await imagenDeMascara(captura, captura, join(CARPETA, "mascaras", "captura-referencia.png"));
  writeFileSync(join(CARPETA, "puntuacion.json"), JSON.stringify(resultados, null, 2));
  for (const [clave, p] of Object.entries(resultados)) console.log(`${clave}: media ΔE ${p.media} | ${p.porColor.map((c) => `${c.color} ${c.dE}`).join(" | ")} | grupos ${p.centros.map((c) => `${c.hex} ${Math.round(c.parte * 100)}%`).join(" ")}`);
}

/**
 * La hoja comparativa de una escena: la captura de partida y cada toma, con las notas a ojo de `notas-visuales.json` y, en la escena 07, el
 * ΔE de `puntuacion.json` (corre antes `puntuar`).
 */
async function modoHoja(escena: Escena): Promise<void> {
  const rutaPuntuacion = join(CARPETA, "puntuacion.json");
  const puntuacion = escena === "07" && existsSync(rutaPuntuacion) ? (JSON.parse(readFileSync(rutaPuntuacion, "utf8")) as Record<string, Puntuacion>) : {};
  if (escena === "07" && !Object.keys(puntuacion).length) throw new Error("Falta puntuacion.json: corre `puntuar` primero.");
  const rutaNotas = join(CARPETA, "notas-visuales.json");
  const notas = existsSync(rutaNotas) ? (JSON.parse(readFileSync(rutaNotas, "utf8")) as Record<string, string[]>) : {};
  const lineasDe = (clave: string) => {
    const p = puntuacion[clave];
    return [...(p ? [`ΔE medio ${p.media}`, ...p.porColor.map((c) => `${c.color}: ΔE ${c.dE}`)] : []), ...(notas[clave] ?? [])];
  };
  const tomas = leerGasto().llamadas
    .filter((l) => l.resultado === "ok" && (l.escena ?? "07") === escena)
    .sort((x, y) => VARIANTES.indexOf(x.variante as Variante) - VARIANTES.indexOf(y.variante as Variante) || x.semilla - y.semilla);
  const paneles = [
    { archivo: join(CARPETA, `captura-idea${escena}.jpg`), titulo: "Captura de partida", lineas: lineasDe(escena === "07" ? "captura-referencia" : `captura-idea${escena}`) },
    ...tomas.map((l) => ({
      archivo: join(CARPETA, l.archivo),
      titulo: `${l.variante === "base" ? "base (producción anterior)" : `variante ${l.variante}`} · semilla ${l.semilla}`,
      lineas: lineasDe(l.archivo),
    })),
  ];
  const salida = join(CARPETA, escena === "07" ? "hoja-comparativa.png" : `hoja-comparativa-idea${escena}.png`);
  const paleta = paletaDe(especDeIdea(ESCENAS[escena])).map((c) => ({ nombre: c.nombre, hex: c.hex }));
  console.log(`Hoja con ${await crearHoja(paneles, paleta, salida)} paneles: ${salida}`);
}

async function principal(): Promise<void> {
  const [modo, arg1, arg2, arg3] = process.argv.slice(2);
  if (modo === "offline") await modoOffline(escenaDe(arg1));
  else if (modo === "seco") { const escena = escenaDe(arg2); await modoSeco(varianteDe(arg1, escena), escena); }
  else if (modo === "pagar") { const escena = escenaDe(arg3); await modoPagar(varianteDe(arg1, escena), Number(arg2), escena); }
  else if (modo === "recuperar") await modoRecuperar(varianteDe(arg1, "07"), Number(arg2), arg3);
  else if (modo === "puntuar") await modoPuntuar();
  else if (modo === "hoja") await modoHoja(escenaDe(arg1));
  else throw new Error("Uso: offline [escena] | seco <variante> [escena] | pagar <variante> <semilla> [escena] | recuperar <variante> <semilla> [request_id] | puntuar | hoja [escena]");
}

principal().catch((causa: unknown) => {
  console.error(causa instanceof Error ? causa.message : String(causa));
  process.exitCode = 1;
});
