import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

const IdSchema = z.string().uuid();
const Directorio = join(tmpdir(), "demo-decoracion-guiada");

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const validado = IdSchema.safeParse(id);
  if (!validado.success) return new Response("No encontrada.", { status: 404 });
  for (const [extension, mime] of [["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"]] as const) {
    try {
      const image = await readFile(join(Directorio, `${validado.data}.${extension}`));
      return new Response(image, { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
    } catch { /* Sigue con la siguiente extensión. */ }
  }
  return new Response("No encontrada.", { status: 404 });
}
