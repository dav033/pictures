/**
 * Vuelve a clasificar, sin llamadas de pago, la capacidad que falta en cada foto de una corrida guardada (`lib-capacidad.ts`), y la compara
 * con lo que marcó el arnés al correr. La evidencia sale de la que el arnés guardó con la escena (`evidencia` de `images (N).json`); en las
 * corridas que no la traen se reconstruye igual que en la pasada: la lectura cruda (auditoría) se mide con la detección (caché) y se compila
 * (`medirConDetecciones` y `compilarLectura`, el camino de `modelarDesdeFoto`), y los errores de las herramientas salen de la auditoría. Esa
 * reconstrucción es exacta con el código con que corrió la pasada; con otro, la lectura se mide y compila con el de ahora.
 *
 *   npx tsx --conditions=react-server scripts/entrenamiento/reclasificar-corrida.ts <carpeta-de-la-corrida> [--json] [--evidencia <archivo>]
 *
 * `--evidencia` escribe la evidencia de cada foto (lo que `clasificarCapacidad` recibe) para armar los casos de prueba.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compilarLectura } from "@/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "@/lib/globos3d/lectura-foto";
import { medirConDetecciones } from "@/lib/globos3d/medir-con-detecciones";
import { deteccionAnotada, erroresDeHerramientas, eventosDeConversacion, idConversacionDePasada, lecturaCrudaDeAuditoria } from "./lib-auditoria";
import type { DeteccionGuardada } from "./lib-cache-deteccion";
import { claseDominanteDeCapacidad, clasificarCapacidad, CLASES_CAPACIDAD, hayCapacidadFaltante, pasadasPorClase, sumarConteos, type ConteoCapacidad, type EvidenciaCapacidad } from "./lib-capacidad";
import { evidenciaDePasada } from "./lib-evidencia";
import { elegirDeteccion, rescorearTodas } from "./lib-rescorear";
import { directorioDeCorridas } from "./lib-rutas";

type Guardado = { registro: { foto: string; fallos: string[] }; escena: Parameters<typeof evidenciaDePasada>[0]["escena"] | null; evidencia?: EvidenciaCapacidad };
type Fila = { foto: string; marcadaAntes: boolean; conteo: ConteoCapacidad; evidencia: EvidenciaCapacidad };

function reconstruirEvidencia(raiz: string, corrida: string, foto: string, escena: NonNullable<Guardado["escena"]>, cache: readonly DeteccionGuardada[]): EvidenciaCapacidad {
  const { eventos } = eventosDeConversacion(path.join(raiz, "registro"), idConversacionDePasada(corrida, foto));
  if (!eventos.length) throw new Error(`Sin auditoría para ${foto}`);
  const anotada = deteccionAnotada(eventos);
  if (!anotada) throw new Error(`La auditoría de ${foto} no anota su detección`);
  const deteccion = elegirDeteccion(cache, foto, anotada);
  const medida = medirConDetecciones(LecturaFotoSchema.parse(lecturaCrudaDeAuditoria(eventos)), deteccion.globos, deteccion.fondos);
  return evidenciaDePasada({ piezas: medida.lectura.piezas, escena, omitidas: compilarLectura(medida.lectura).omitidas, erroresHerramientas: erroresDeHerramientas(eventos) });
}

function reclasificar(raiz: string, corrida: string, archivo: string, cache: readonly DeteccionGuardada[]): Fila {
  const guardado = JSON.parse(readFileSync(path.join(raiz, corrida, archivo), "utf8")) as Guardado;
  const foto = guardado.registro.foto;
  if (!guardado.escena) throw new Error(`${foto} no guardó su escena final`);
  const evidencia = guardado.evidencia ?? reconstruirEvidencia(raiz, corrida, foto, guardado.escena, cache);
  return { foto, marcadaAntes: guardado.registro.fallos.includes("capacidad_faltante"), conteo: clasificarCapacidad(evidencia), evidencia };
}

/** Un JSON legible con cada lista de una foto en su línea, para que el archivo de pruebas se pueda revisar y comparar. */
function evidenciaEnJson(corrida: string, filas: readonly Fila[]): string {
  const lista = (valor: unknown) => JSON.stringify(valor);
  const fotos = filas.map(({ foto, marcadaAntes, evidencia: e }) => [
    `    ${lista(foto.replace(/\.jpg$/, ""))}: {`,
    `      "marcadaAntes": ${lista(marcadaAntes)},`,
    `      "piezasLeidas": ${lista(e.piezasLeidas)},`,
    `      "nodosFinales": ${lista(e.nodosFinales)},`,
    `      "omitidas": ${lista(e.omitidas)},`,
    `      "erroresHerramientas": ${lista(e.erroresHerramientas)}`,
    "    }",
  ].join("\n"));
  return ["{", `  "fuente": ${lista(corrida)},`, '  "fotos": {', fotos.join(",\n"), "  }", "}", ""].join("\n");
}

function main(): void {
  const carpeta = process.argv[2];
  if (!carpeta) throw new Error("Falta la carpeta de la corrida (nombre dentro de las corridas o ruta).");
  const raiz = directorioDeCorridas();
  const corrida = path.basename(carpeta);
  const archivos = readdirSync(path.join(raiz, corrida)).filter((f) => /^images \(\d+\)\.json$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  const dirCache = path.join(raiz, "cache-deteccion");
  const cache = readdirSync(dirCache).map((f) => JSON.parse(readFileSync(path.join(dirCache, f), "utf8")) as DeteccionGuardada);
  const { filas, errores } = rescorearTodas(archivos, (archivo) => reclasificar(raiz, corrida, archivo, cache));
  for (const e of errores) console.error(`${e.archivo}: ${e.error}`);
  const indiceEvidencia = process.argv.indexOf("--evidencia");
  if (indiceEvidencia >= 0) {
    const destino = process.argv[indiceEvidencia + 1];
    if (!destino) throw new Error("--evidencia necesita la ruta del archivo.");
    writeFileSync(destino, evidenciaEnJson(corrida, filas));
  }
  if (process.argv.includes("--json")) { console.log(JSON.stringify(filas.map((f) => ({ foto: f.foto, marcadaAntes: f.marcadaAntes, conteo: f.conteo })), null, 1)); return; }
  for (const f of filas) console.log(`${f.foto.replace(".jpg", "")} | antes ${f.marcadaAntes ? "capacidad_faltante" : "-"} | ahora ${hayCapacidadFaltante(f.conteo) ? "capacidad_faltante" : "-"} | dominante ${claseDominanteDeCapacidad([f.conteo]) ?? "-"} | ${JSON.stringify(f.conteo)}`);
  const conteos = filas.map((f) => f.conteo);
  const fotos = pasadasPorClase(conteos), veces = sumarConteos(conteos);
  console.log(`\n${corrida}: ${filas.length} fotos; capacidad_faltante antes ${filas.filter((f) => f.marcadaAntes).length}, ahora ${conteos.filter(hayCapacidadFaltante).length}`);
  console.log("clase | fotos | veces");
  for (const clase of CLASES_CAPACIDAD) console.log(`${clase} | ${fotos[clase] ?? 0} | ${veces[clase] ?? 0}`);
  const dominantes = new Map<string, number>();
  for (const c of conteos) { const d = claseDominanteDeCapacidad([c]); if (d) dominantes.set(d, (dominantes.get(d) ?? 0) + 1); }
  console.log(`dominante por foto: ${[...dominantes.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ")}`);
  if (errores.length) process.exitCode = 1;
}

main();
