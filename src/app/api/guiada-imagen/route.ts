import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const Directorio = join(tmpdir(), "demo-decoracion-guiada");
const ImagenSchema = z.object({ imagen: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(24_000_000) }).strict();

export async function POST(request: Request) {
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "La imagen no tiene formato válido." }, { status: 400 }); }
  const validado = ImagenSchema.safeParse(cuerpo);
  if (!validado.success) return Response.json({ error: "La imagen no cumple el formato permitido." }, { status: 400 });
  const contenido = validado.data.imagen.match(/^data:image\/(png|jpeg|webp);base64,([\s\S]*)$/);
  if (!contenido) return Response.json({ error: "La imagen no cumple el formato permitido." }, { status: 400 });
  const buffer = Buffer.from(contenido[2]!, "base64");
  if (!buffer.length || buffer.length > 16_000_000) return Response.json({ error: "La imagen supera el tamaño permitido." }, { status: 413 });
  await mkdir(Directorio, { recursive: true });
  const anteriores = await readdir(Directorio);
  const ahora = Date.now();
  for (const nombre of anteriores) {
    if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(nombre)) continue;
    const ruta = join(Directorio, nombre);
    const datos = await stat(ruta).catch(() => null);
    if (datos && ahora - datos.mtimeMs > 24 * 60 * 60 * 1000) await unlink(ruta).catch(() => undefined);
  }
  const id = randomUUID();
  const extension = contenido[1] === "jpeg" ? "jpg" : contenido[1]!;
  await writeFile(join(Directorio, `${id}.${extension}`), buffer, { flag: "wx" });
  return Response.json({ url: `/api/guiada-imagen/${id}` });
}
