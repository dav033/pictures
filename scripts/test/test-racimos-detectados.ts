/**
 * Las cajas de la detección que encierran un racimo entero no se miden como globos gigantes: en la foto del aro «Isabella»
 * el detector encerró cada racimo en una caja (0,21 del alto) y la medición los tomó por R-36 de 86 cm. Se eligen las cajas
 * que se salen del tamaño de las demás (sin modelo) y la IA, con los recortes, dice cuáles son varios globos. Sin red: la IA
 * es un cliente falso.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-racimos-detectados.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { cajasSospechosas, MAXIMO_SOSPECHOSAS, recorteDeCaja } from "@/lib/globos3d/racimos-detectados";
import { descartarRacimos } from "@/lib/globos3d/detectar-globos-ia";
import type { GloboDetectado } from "@/lib/globos3d/medir-con-detecciones";

let fallos = 0;
async function prueba(nombre: string, f: () => void | Promise<void>) {
  try { await f(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.log(`  FALLA ${nombre}\n${e instanceof Error ? e.stack : String(e)}`); }
}

const caja = (y: number, x: number, lado: number, color = "rosa"): GloboDetectado => ({ box_2d: [y, x, y + lado, x + lado], color });
// La foto 05: muchos globos de 60–100 milésimas y cinco cajas de racimo de 150–213.
const foto05: GloboDetectado[] = [
  ...Array.from({ length: 30 }, (_, i) => caja(100 + (i % 6) * 120, 100 + Math.floor(i / 6) * 150, 60 + (i % 5) * 10)),
  caja(105, 600, 213, "dorado"), caja(270, 560, 199, "blanco"), caja(510, 130, 173, "blanco"), caja(500, 560, 166), caja(310, 260, 154),
];

const pixeles = async () => {
  const { data, info } = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#f0c0d0" } }).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as 3 };
};
type Cliente = Parameters<typeof descartarRacimos>[0];
const clienteQueResponde = (respuesta: unknown, pedidos: unknown[] = []): Cliente => ({
  models: { generateContent: async (p: unknown) => { pedidos.push(p); return { candidates: [{ content: { parts: [{ text: JSON.stringify(respuesta) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 } }; } },
}) as unknown as Cliente;

async function main() {
  await prueba("las cajas de racimo (mucho más grandes que la mediana) son las sospechosas, de la más grande a la más chica", () => {
    const s = cajasSospechosas(foto05);
    assert.deepEqual(s, [30, 31, 32, 33, 34]);
  });

  await prueba("sin cajas fuera de tamaño (o con muy pocas cajas) no hay nada que revisar", () => {
    assert.deepEqual(cajasSospechosas(foto05.slice(0, 30)), []);
    assert.deepEqual(cajasSospechosas([caja(0, 0, 300), caja(0, 400, 50)]), []);
  });

  await prueba("nunca se revisan más de las que caben en una llamada", () => {
    const muchas = [...foto05, ...Array.from({ length: 12 }, (_, i) => caja(50 * i, 800, 180))];
    assert.equal(cajasSospechosas(muchas).length, MAXIMO_SOSPECHOSAS);
  });

  await prueba("el recorte lleva margen y no se sale de la foto", () => {
    const r = recorteDeCaja(caja(950, 950, 50));
    assert.ok(r.x0 < 0.95 && r.y0 < 0.95 && r.x1 === 1 && r.y1 === 1, JSON.stringify(r));
  });

  await prueba("los recortes que la IA ve como varios globos se quitan antes de medir; los que son un globo se quedan", async () => {
    const pedidos: unknown[] = [];
    const r = await descartarRacimos(clienteQueResponde([{ recorte: 1, globos: 6, mayor: 40 }, { recorte: 2, globos: 1, mayor: 95 }, { recorte: 3, globos: 6, mayor: 40 }, { recorte: 4, globos: 6, mayor: 40 }, { recorte: 5, globos: 6, mayor: 40 }], pedidos), await pixeles(), foto05, { superficie: "prueba" });
    assert.equal(pedidos.length, 1, "una sola llamada");
    assert.equal(r.globos.length, 31);
    assert.ok(r.globos.includes(foto05[31]!), "el globo blanco grande de verdad se queda");
    assert.ok(!r.globos.includes(foto05[30]!), "el racimo dorado se va");
    assert.ok(r.uso.entrada > 0);
  });

  await prueba("un gigante con globos chicos pegados delante (varios globos, pero uno llena la caja) no se quita", async () => {
    const r = await descartarRacimos(clienteQueResponde([{ recorte: 1, globos: 4, mayor: 92 }, { recorte: 2, globos: 5, mayor: 45 }]), await pixeles(), foto05, { superficie: "prueba" });
    assert.ok(r.globos.includes(foto05[30]!), "el gigante con chicos pegados se queda");
    assert.ok(!r.globos.includes(foto05[31]!), "el racimo se va");
    assert.deepEqual(r.revision, { revisadas: 5, quitadas: 1 });
  });

  await prueba("si la IA falla o no hay sospechosas, se mide todo como estaba (sin llamar de más)", async () => {
    const roto = { models: { generateContent: async () => { throw new Error("caído"); } } } as unknown as Cliente;
    assert.equal((await descartarRacimos(roto, await pixeles(), foto05, { superficie: "prueba" })).globos.length, foto05.length);
    const pedidos: unknown[] = [];
    assert.equal((await descartarRacimos(clienteQueResponde([], pedidos), await pixeles(), foto05.slice(0, 30), { superficie: "prueba" })).globos.length, 30);
    assert.equal(pedidos.length, 0);
  });

  await prueba("una respuesta sin lista se mide todo y dice por qué; una cancelación del usuario se cancela", async () => {
    const r = await descartarRacimos(clienteQueResponde({ nada: true }), await pixeles(), foto05, { superficie: "prueba" });
    assert.equal(r.globos.length, foto05.length);
    assert.match(r.revision.fallo ?? "", /no trae la lista/);
    const corte = new AbortController();
    const cancelado = { models: { generateContent: async () => { corte.abort(); throw new Error("abortado"); } } } as unknown as Cliente;
    await assert.rejects(descartarRacimos(cancelado, await pixeles(), foto05, { superficie: "prueba", signal: corte.signal }), /abortado/);
  });

  await prueba("una respuesta con números de recorte que no existen no quita nada", async () => {
    const r = await descartarRacimos(clienteQueResponde([{ recorte: 9, globos: 6, mayor: 40 }, { recorte: 0, globos: 6, mayor: 40 }]), await pixeles(), foto05, { superficie: "prueba" });
    assert.equal(r.globos.length, foto05.length);
  });

  if (fallos) { console.log(`\n${fallos} prueba(s) con fallas.`); process.exit(1); }
  console.log("\nTodas las pruebas pasaron.");
}

void main();
