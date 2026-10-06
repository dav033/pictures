/** Dibujo esquematico de las piezas sin motor (centro de mesa, aro, techo, pared) para los planes trazados (FUERA del repo). */
import { DATOS } from "../../rutas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const REPO = process.cwd();
const T = `${DATOS}/linea-base/trazado`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);
async function main() {
  delete process.env.DATABASE_URL; delete process.env.CATALOG_DATABASE_URL;
  (globalThis as { __ragPool?: unknown }).__ragPool = { query: async () => ({ rows: [], rowCount: 0 }), on: () => undefined, end: async () => undefined };
  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const { vistaPreviaDibujoEstructuraPython } = await imp("src/lib/plan/edicion-python.ts");
  for (let c = 1; c <= 8; c += 1) for (let k = 1; k <= 3; k += 1) {
    const f = `${T}/caso-${c}/corrida-${k}/plan-resuelto.json`;
    if (!existsSync(f)) continue;
    const p = JSON.parse(readFileSync(f, "utf8"));
    for (const e of p.plan.estructuras) {
      if (!["centro_mesa", "aro_circular", "techo_globos", "pared_densa", "pared_no_densa", "pared_organica"].includes(e.estructura_oficial)) continue;
      const res = p.estructuras.find((x: { estructura_id: string }) => x.estructura_id === e.estructura_id);
      try {
        const r = await vistaPreviaDibujoEstructuraPython({ plan: p.plan, estructuraId: e.estructura_id, mezclaReal: res?.mezcla_real, correlationId: crypto.randomUUID() });
        const g0 = r.grafica as { ancho: number; alto: number; svg: string }; const g = { ancho: g0.ancho, alto: g0.alto, interior: g0.svg };
        const dir = `${T}/caso-${c}/corrida-${k}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/dibujo-${e.estructura_oficial}-${e.estructura_id}.svg`, g.interior.trim().startsWith("<svg") ? g.interior : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.ancho} ${g.alto}" width="${g.ancho}" height="${g.alto}">${g.interior}</svg>`);
        const circulos = (g.interior.match(/<circle/g) ?? []).length;
        console.log(`caso ${c} #${k} ${e.estructura_oficial} ${e.estructura_id}: ${g.ancho}x${g.alto} circulos=${circulos} total_plan=${res?.total_unidades}`);
      } catch (err) { console.log(`caso ${c} #${k} ${e.estructura_id}: ERROR ${(err as Error).message.slice(0, 160)}`); }
    }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
