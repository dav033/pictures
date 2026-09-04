import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isAuthenticatedRequest } from "@/lib/auth/request";

/**
 * Vuelca la selecciÃ³n humana de la galerÃ­a a `data/staging/lora-v007/aprobadas.json`.
 *
 * Hasta acÃ¡ la revisiÃ³n humana vivÃ­a SOLO en el `localStorage` del navegador que la hizo:
 * no se podÃ­a empaquetar el dataset desde otra mÃ¡quina, otro perfil o un script, y un
 * `localStorage` limpiado se llevaba el trabajo de curadurÃ­a sin dejar rastro. El formato
 * de salida es el que `scripts/empaquetar-dataset-v007.ts --seleccion` ya acepta
 * (`{ seleccion: [...] }`), asÃ­ que no hace falta convertir nada en el medio.
 */

const SALIDA = path.join(process.cwd(), "data", "staging", "lora-v007", "aprobadas.json");

function idsValidos(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  if (valor.some((id) => typeof id !== "string" || id.length === 0 || id.length > 200)) return null;
  return [...new Set(valor as string[])];
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "SesiÃ³n requerida." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud invÃ¡lida." }, { status: 400 });
  }

  const cuerpo = (body ?? {}) as { datasetId?: unknown; seleccion?: unknown; componentesRemovidos?: unknown };
  const seleccion = idsValidos(cuerpo.seleccion);
  if (!seleccion) return Response.json({ error: "`seleccion` debe ser un array de image_id." }, { status: 400 });

  // Una selecciÃ³n vacÃ­a se rechaza a propÃ³sito: un clic accidental con cero imÃ¡genes marcadas
  // sobrescribirÃ­a una curadurÃ­a buena con una lista vacÃ­a, y el empaquetador la aceptarÃ­a sin
  // chistar (dejarÃ­a el dataset en cero imÃ¡genes). Para no exportar nada, no se aprieta el botÃ³n.
  if (seleccion.length === 0) {
    return Response.json({ error: "No hay imÃ¡genes seleccionadas: no se sobrescribe la selecciÃ³n guardada." }, { status: 400 });
  }

  const datasetId = typeof cuerpo.datasetId === "string" && cuerpo.datasetId.length <= 200 ? cuerpo.datasetId : null;

  // Los componentes que el humano quitÃ³ de una imagen son parte de la misma decisiÃ³n de
  // curadurÃ­a, asÃ­ que viajan en el mismo archivo. Hoy el empaquetador no los consume; se
  // guardan para no perderlos cuando se limpie el navegador.
  const componentesRemovidos: Record<string, string[]> = {};
  if (cuerpo.componentesRemovidos && typeof cuerpo.componentesRemovidos === "object" && !Array.isArray(cuerpo.componentesRemovidos)) {
    for (const [imageId, claves] of Object.entries(cuerpo.componentesRemovidos as Record<string, unknown>)) {
      const validas = idsValidos(claves);
      if (validas && validas.length > 0) componentesRemovidos[imageId] = validas;
    }
  }

  try {
    await mkdir(path.dirname(SALIDA), { recursive: true });
    await writeFile(
      SALIDA,
      `${JSON.stringify({
        _generado_por: "POST /api/lora/dataset/exportar-seleccion (botÃ³n Â«Exportar selecciÃ³nÂ» de la galerÃ­a)",
        generado_en: new Date().toISOString(),
        dataset_id: datasetId,
        total: seleccion.length,
        seleccion,
        componentes_removidos: componentesRemovidos,
      }, null, 2)}\n`,
      "utf8",
    );
    return Response.json({
      ok: true,
      archivo: path.relative(process.cwd(), SALIDA),
      total: seleccion.length,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}


