/**
 * Lo que las rutas del 3D comparten cuando el corte está puesto (P-049, `corte-motor3d.ts`): sacar el `plan_hash` de la petición
 * para etiquetar la auditoría sin bajar el cuerpo, y registrar un rechazo por conversación y plan.
 * - las capturas reales pesan 1-3 MB: el hash se lee igual, porque va en las primeras líneas del cuerpo;
 * - el tope vale con o sin `Content-Length` (un cuerpo en trozos no lo trae): nunca se lee más que la cabeza;
 * - la petición original sigue leíble después (se lee una copia);
 * - la auditoría deduplica por conversación + plan, no solo por plan.
 *
 * Run: npx tsx scripts/test/test-corte-motor3d.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearAuditoriaDeCortes, etiquetaDelCorte, planHashDeLaPeticion } from "../../src/lib/guiada-motor/corte-motor3d";

const HASH = "ab".repeat(32);
const OTRO_HASH = "cd".repeat(32);
const cuerpoCon = (hash: string, relleno: number) => JSON.stringify({ approval_token: "token", plan_hash: hash, motor: { id: "globos3d", version: "v1" }, captura: "x".repeat(relleno) });
const pedir = (cuerpo: BodyInit | null, cabeceras: Record<string, string> = {}) => new Request("https://app.test/api/guiada/motor/imagen", { method: "POST", headers: { "content-type": "application/json", ...cabeceras }, body: cuerpo, ...(typeof cuerpo === "object" && cuerpo !== null ? { duplex: "half" } : {}) } as RequestInit);

test("un cuerpo de más de 1,5 MB (una captura real) da su plan_hash, con y sin Content-Length", async () => {
  const cuerpo = cuerpoCon(HASH, 1_600_000);
  assert.ok(cuerpo.length > 1_500_000);
  assert.equal(await planHashDeLaPeticion(pedir(cuerpo)), HASH);
  assert.equal(await planHashDeLaPeticion(pedir(cuerpo, { "content-length": String(cuerpo.length) })), HASH, "la cabecera no decide si se mira");
  assert.equal(await planHashDeLaPeticion(pedir(cuerpo, { "content-length": "9999999999" })), HASH, "ni una cabecera enorme: no se confía en ella para saltarse la etiqueta");
});

test("la petición original no cambia: tras etiquetarla se puede leer entera", async () => {
  const cuerpo = cuerpoCon(HASH, 1_600_000);
  const peticion = pedir(cuerpo);
  assert.equal(await planHashDeLaPeticion(peticion), HASH);
  assert.equal(await peticion.text(), cuerpo);
});

test("un cuerpo sin plan_hash legible, vacío, roto o con un hash que no es un hash no da etiqueta", async () => {
  assert.equal(await planHashDeLaPeticion(pedir(null)), undefined);
  assert.equal(await planHashDeLaPeticion(pedir("")), undefined);
  assert.equal(await planHashDeLaPeticion(pedir("{no es json")), undefined);
  assert.equal(await planHashDeLaPeticion(pedir(JSON.stringify({ approval_token: "t", plan_hash: "abc" }))), undefined);
  assert.equal(await planHashDeLaPeticion(pedir(JSON.stringify({ plan_hash: 7 }))), undefined);
  assert.equal(await planHashDeLaPeticion(pedir(JSON.stringify({ relleno: "x".repeat(10_000), plan_hash: HASH }))), undefined, "pasado el tope de la cabeza ya no se busca");
});

test("un cuerpo en trozos sin Content-Length no se baja entero: se lee la cabeza y se corta", async () => {
  const codificar = new TextEncoder();
  const totalBytes = 16 * 1024 * 1024;
  let enviados = 0;
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(control) {
      if (enviados === 0) {
        const cabeza = codificar.encode(`{"approval_token":"t","plan_hash":"${HASH}","captura":"`);
        control.enqueue(cabeza);
        enviados += cabeza.length;
      } else if (enviados >= totalBytes) {
        control.close();
      } else {
        control.enqueue(new Uint8Array(1024).fill(120));
        enviados += 1024;
      }
    },
  });
  assert.equal(await planHashDeLaPeticion(pedir(cuerpo as unknown as BodyInit)), HASH);
  assert.ok(enviados < 128 * 1024, `se pidieron ${enviados} bytes de 16 MB: tope roto`);
});

test("la etiqueta lleva la conversación de la cabecera x-conversacion-id (acotada) y el hash", async () => {
  const etiqueta = await etiquetaDelCorte(pedir(cuerpoCon(HASH, 10), { "x-conversacion-id": "guiada-abc" }));
  assert.deepEqual(etiqueta, { planHash: HASH, conversacion: "guiada-abc" });
  assert.deepEqual(await etiquetaDelCorte(pedir(cuerpoCon(HASH, 10))), { planHash: HASH, conversacion: undefined });
  assert.equal((await etiquetaDelCorte(pedir("{}", { "x-conversacion-id": "c".repeat(300) }))).conversacion?.length, 64);
});

test("la auditoría registra una vez por conversación y plan: el mismo plan en otra conversación se registra aparte", () => {
  const auditoria = crearAuditoriaDeCortes();
  assert.equal(auditoria.primeraVez({ planHash: HASH, conversacion: "uno" }), true);
  assert.equal(auditoria.primeraVez({ planHash: HASH, conversacion: "uno" }), false, "las miniaturas del mismo plan");
  assert.equal(auditoria.primeraVez({ planHash: HASH, conversacion: "dos" }), true, "otra conversación con el mismo plan");
  assert.equal(auditoria.primeraVez({ planHash: OTRO_HASH, conversacion: "uno" }), true, "otro plan de la misma conversación");
  assert.equal(auditoria.primeraVez({ planHash: undefined, conversacion: "uno" }), true);
  assert.equal(auditoria.primeraVez({ planHash: undefined, conversacion: "uno" }), false);
  assert.equal(auditoria.primeraVez({ planHash: HASH, conversacion: undefined }), true, "sin conversación también es una clave");
});

test("la auditoría tiene tope: al pasarlo se vacía y vuelve a registrar", () => {
  const auditoria = crearAuditoriaDeCortes();
  for (let i = 0; i < 200; i += 1) assert.equal(auditoria.primeraVez({ planHash: undefined, conversacion: `c${i}` }), true);
  assert.equal(auditoria.primeraVez({ planHash: undefined, conversacion: "c199" }), false, "dentro del tope sigue recordando");
  assert.equal(auditoria.primeraVez({ planHash: undefined, conversacion: "c200" }), true, "al pasar el tope se vacía");
  assert.equal(auditoria.primeraVez({ planHash: undefined, conversacion: "c0" }), true, "y lo de antes ya no se recuerda");
});
