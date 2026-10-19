import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decoracionesSempertex } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { armarEscena, type Escena } from "../../src/lib/globos3d/escena";
import { armarDesdeEspec, escenaDeEspec, especDesdeIdeaGuardada, sumarLineas } from "../../src/lib/globos3d/motor/v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";

/**
 * Regenera `src/lib/globos3d/ideas-asistente/escenas.json`: la escena de cada idea del carrusel de la vista guiada que el motor 3D
 * arma, con la misma geometría que arma para el cliente, para que el Taller 3D la ofrezca en «Añadir → Ideas → Ideas del asistente»
 * (D-038, D-039). Solo entran las ideas con plan guardado que el motor arma COMPLETAS y cuya escena, vista con las reglas del Taller,
 * lleva exactamente la lista de materiales del motor (si no, el «Precio en la tienda» del Taller no sería el de la tarjeta).
 *
 *   npx tsx --conditions=react-server scripts/biblioteca/precomputar-escenas-ideas-asistente.ts           # escribe el archivo (sin red, sin coste)
 *   npx tsx --conditions=react-server scripts/biblioteca/precomputar-escenas-ideas-asistente.ts --check   # solo compara; sale con 1 si está desfasado
 *
 * Córrelo cuando cambie el motor (y suba `VERSION_MOTOR`), `planes-ideas.json` o `decoraciones.json`.
 */
export const RUTA_ESCENAS_IDEAS_ASISTENTE = path.resolve(__dirname, "..", "..", "src", "lib", "globos3d", "ideas-asistente", "escenas.json");

export type EscenasDeIdeas = {
  version: 1;
  motor: string;
  ideas: Record<string, { titulo: string; tematica: string; eventos: string[]; escena: Escena }>;
};
export type IdeaFueraDelTaller = { ideaId: string; razon: string };

const clave = (linea: { formatoId: string; codigo: string }): string => `${linea.formatoId}|${linea.codigo}`;

/** Lo que cada globo pide la escena del Taller, contra lo que cuenta el motor: las diferencias, vacío si son la misma lista. */
function diferenciasDeMateriales(escena: Escena, bom: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }>): string[] {
  const delTaller = new Map(armarEscena(escena).materiales.map((material) => [clave(material), material.cantidad]));
  const delMotor = new Map(sumarLineas(bom).map((linea) => [clave(linea), linea.cantidad]));
  return [...new Set([...delTaller.keys(), ...delMotor.keys()])].sort().filter((k) => delTaller.get(k) !== delMotor.get(k)).map((k) => `${k}: motor ${delMotor.get(k) ?? 0}, Taller ${delTaller.get(k) ?? 0}`);
}

export function construirEscenasDeIdeas(): { archivo: EscenasDeIdeas; fuera: IdeaFueraDelTaller[] } {
  const ideas: EscenasDeIdeas["ideas"] = {};
  const fuera: IdeaFueraDelTaller[] = [];
  let motor = "";
  for (const idea of [...decoracionesSempertex].sort((a, b) => a.id.localeCompare(b.id))) {
    const guardado = planGuardadoDeIdea(idea.id);
    if (!guardado) {
      const esFigura = idea.piezas.some((pieza) => pieza.estructura === "figura");
      fuera.push({ ideaId: idea.id, razon: esFigura
        ? "sin plan guardado: es una figura de globos y el motor no tiene constructor de figuras (su lista curada da cantidades por color, no geometría)"
        : "sin plan guardado: su lista curada son cantidades de ejemplo por color, sin las medidas ni el orden de los colores con que armar sus estructuras" });
      continue;
    }
    try {
      const espec = especDesdeIdeaGuardada(guardado.plan, idea.id).espec;
      const armado = armarDesdeEspec(espec);
      motor = armado.motor.version;
      if (armado.noRepresentable.length) { fuera.push({ ideaId: idea.id, razon: `el motor no la arma: ${armado.noRepresentable.map((n) => n.motivo).join("; ")}` }); continue; }
      const { escena } = escenaDeEspec(espec);
      const diferencias = diferenciasDeMateriales(escena, armado.bom.total);
      if (diferencias.length) { fuera.push({ ideaId: idea.id, razon: `la escena del Taller no lleva la lista del motor (${diferencias.join("; ")})` }); continue; }
      ideas[idea.id] = { titulo: idea.titulo, tematica: idea.tematica, eventos: idea.eventos, escena: JSON.parse(JSON.stringify(escena)) as Escena };
    } catch (error) {
      fuera.push({ ideaId: idea.id, razon: `el motor no la arma: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { archivo: { version: 1, motor, ideas }, fuera };
}

export const textoDelArchivo = (archivo: EscenasDeIdeas): string => `${JSON.stringify(archivo)}\n`;

if (require.main === module) {
  const { archivo, fuera } = construirEscenasDeIdeas();
  const texto = textoDelArchivo(archivo);
  for (const idea of fuera) console.log(`fuera del Taller: ${idea.ideaId} — ${idea.razon}`);
  if (process.argv.includes("--check")) {
    const actual = readFileSync(RUTA_ESCENAS_IDEAS_ASISTENTE, "utf8").replace(/\r\n/g, "\n");
    if (actual !== texto) { console.error("escenas.json está desfasado: regénéralo sin --check"); process.exit(1); }
    console.log(`escenas.json al día (${Object.keys(archivo.ideas).length} ideas)`);
  } else {
    writeFileSync(RUTA_ESCENAS_IDEAS_ASISTENTE, texto, "utf8");
    console.log(`escrito ${RUTA_ESCENAS_IDEAS_ASISTENTE} (${Object.keys(archivo.ideas).length} ideas, ${(texto.length / 1024).toFixed(0)} KB)`);
  }
}
