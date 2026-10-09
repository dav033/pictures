import assert from "node:assert/strict";
import test from "node:test";
import { DIAS_RETENCION, aplicarRetencion } from "./retencion";
import { almacenFalso, baseFalsa } from "./pruebas-comunes";

const AHORA = new Date("2026-10-31T12:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);
const CLAVE = (turno: string, momento = "antes") => `feedback/taller/${turno}/${momento}.jpg`;

/** Postgres de mentira con filas vencidas (sin valorar) y claves referenciadas; anota los borrados. */
function baseDeRetencion(vencidas: { id: string; imagen_antes: string | null; imagen_despues: string | null }[], referenciadas: string[] = []) {
  const borrados: number[][] = [];
  const db = baseFalsa(({ sql, valores }) => {
    if (sql.includes("calificacion IS NULL AND deshecho = FALSE AND comentario IS NULL")) return vencidas.filter((fila) => Number(fila.id) > (valores[1] as number));
    if (sql.startsWith("DELETE FROM ai_feedback")) {
      borrados.push(valores[0] as number[]);
      return [];
    }
    if (sql.includes("imagen_antes = ANY")) return referenciadas.filter((clave) => (valores[0] as string[]).includes(clave)).map((clave) => ({ imagen_antes: clave, imagen_despues: null }));
    return [];
  });
  return { db, borrados };
}

test("borra las filas sin valorar de más de 30 días junto con sus imágenes, y solo esas (el filtro vive en la consulta)", async () => {
  const almacen = almacenFalso();
  await almacen.poner(CLAVE("t1"), new Uint8Array([1]), "image/jpeg");
  await almacen.poner(CLAVE("t1", "despues"), new Uint8Array([1]), "image/jpeg");
  const { db, borrados } = baseDeRetencion([{ id: "1", imagen_antes: CLAVE("t1"), imagen_despues: CLAVE("t1", "despues") }, { id: "2", imagen_antes: null, imagen_despues: null }]);
  const resultado = await aplicarRetencion({ db, almacen, ahora: () => AHORA });
  assert.deepEqual(borrados, [[1, 2]]);
  assert.equal(almacen.objetos.size, 0);
  assert.deepEqual(resultado, { filasBorradas: 2, imagenesBorradas: 2, huerfanasBorradas: 0, filasPendientes: 0 });
  const consulta = db.consultas.find((c) => c.sql.includes("deshecho = FALSE"))!;
  assert.equal((consulta.valores[0] as Date).toISOString(), hace(DIAS_RETENCION).toISOString());
  assert.match(consulta.sql, /calificacion IS NULL AND deshecho = FALSE AND comentario IS NULL AND actualizado_en < \$1/);
});

test("sin almacén configurado no borra filas que tienen imágenes (las dejaría huérfanas) pero sí las demás", async () => {
  const { db, borrados } = baseDeRetencion([{ id: "1", imagen_antes: CLAVE("t1"), imagen_despues: null }, { id: "2", imagen_antes: null, imagen_despues: null }]);
  const resultado = await aplicarRetencion({ db, almacen: null, ahora: () => AHORA });
  assert.deepEqual(borrados, [[2]]);
  assert.equal(resultado.filasPendientes, 1);
});

test("si una imagen no se puede borrar la fila se conserva para la próxima corrida", async () => {
  const almacen = { ...almacenFalso(), borrar: async () => { throw new Error("caído"); } };
  const { db, borrados } = baseDeRetencion([{ id: "1", imagen_antes: CLAVE("t1"), imagen_despues: null }]);
  const resultado = await aplicarRetencion({ db, almacen, ahora: () => AHORA });
  assert.deepEqual(borrados, []);
  assert.equal(resultado.filasPendientes, 1);
  assert.equal(resultado.filasBorradas, 0);
});

test("borra las imágenes huérfanas viejas: no las referenciadas ni las recientes", async () => {
  const almacen = almacenFalso();
  for (const [clave, edad] of [[CLAVE("viva"), 60], [CLAVE("huerfana"), 45], [CLAVE("reciente"), 2]] as const) {
    almacen.objetos.set(clave, { cuerpo: new Uint8Array([1]), tipo: "image/jpeg", modificado: hace(edad) });
  }
  const { db } = baseDeRetencion([], [CLAVE("viva")]);
  const resultado = await aplicarRetencion({ db, almacen, ahora: () => AHORA });
  assert.deepEqual([...almacen.objetos.keys()].sort(), [CLAVE("reciente"), CLAVE("viva")].sort());
  assert.equal(resultado.huerfanasBorradas, 1);
});
