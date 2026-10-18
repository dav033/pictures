import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { dimensionesExportacionPng } from "../../src/components/tres-d/exportar-escena-png";
import { serializarEscenaGlb } from "../../src/components/tres-d/exportar-escena-glb";
import { nombreArchivoEscena } from "../../src/components/tres-d/archivo-escena";

class FileReaderLocal {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((resultado) => {
      this.result = resultado;
      this.onloadend?.();
    });
  }
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function extraerJSONGlb(datos: ArrayBuffer): Record<string, unknown> {
  const vista = new DataView(datos);
  assert.equal(vista.getUint32(0, true), 0x46546c67, "GLB usa el magic glTF");
  assert.equal(vista.getUint32(4, true), 2, "GLB usa la versión 2");
  assert.equal(vista.getUint32(8, true), datos.byteLength, "longitud declarada coincide con el archivo");
  const largoJSON = vista.getUint32(12, true);
  assert.equal(vista.getUint32(16, true), 0x4e4f534a, "el primer chunk contiene JSON");
  const texto = new TextDecoder().decode(new Uint8Array(datos, 20, largoJSON)).trim();
  const json: unknown = JSON.parse(texto);
  assert.ok(esRegistro(json), "el chunk JSON es un objeto glTF");
  return json;
}

async function principal(): Promise<void> {
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: FileReaderLocal });

  const dimensiones = dimensionesExportacionPng(1440, 900);
  assert.deepEqual(dimensiones, { ancho: 3000, alto: 1875 });
  assert.deepEqual(dimensionesExportacionPng(600, 600), { ancho: 3000, alto: 3000 });
  assert.throws(() => dimensionesExportacionPng(0, 900), /tamaño para exportar/);
  assert.equal(nombreArchivoEscena("Cumpleaños Ana/Arco: dorado", "png"), "Cumpleaños-Ana-Arco-dorado-3000px.png");
  assert.equal(nombreArchivoEscena("CON", "glb"), "escena-3d.glb", "evita nombres reservados de Windows");

  const contenido = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xff0044 });
  const instancias = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), material, 3);
  for (let indice = 0; indice < instancias.count; indice++) {
    instancias.setMatrixAt(indice, new THREE.Matrix4().makeTranslation(indice, 0, 0));
  }
  instancias.instanceMatrix.needsUpdate = true;
  contenido.add(instancias);
  const sala = new THREE.Group();
  sala.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: 0xeeeeee })));

  const originalFetch = globalThis.fetch;
  let llamadasRed = 0;
  globalThis.fetch = async () => {
    llamadasRed++;
    throw new Error("La exportación no debe usar la red.");
  };
  let archivo: Blob;
  try {
    archivo = await serializarEscenaGlb(contenido, sala, { nombre: "Escena de prueba", globos: 3, piezas: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(llamadasRed, 0, "la creación del GLB no llama al servidor");
  assert.equal(archivo.type, "model/gltf-binary");
  const gltf = extraerJSONGlb(await archivo.arrayBuffer());
  const nodos = gltf["nodes"];
  const accesores = gltf["accessors"];
  assert.ok(Array.isArray(nodos) && Array.isArray(accesores));
  const nodoInstanciado = nodos.find((nodo) => esRegistro(nodo) && esRegistro(nodo["extensions"]) && esRegistro(nodo["extensions"]["EXT_mesh_gpu_instancing"]));
  assert.ok(esRegistro(nodoInstanciado));
  const extensiones = nodoInstanciado["extensions"];
  assert.ok(esRegistro(extensiones));
  const extension = extensiones["EXT_mesh_gpu_instancing"];
  assert.ok(esRegistro(extension));
  const atributos = extension["attributes"];
  assert.ok(esRegistro(atributos));
  const accessorId = atributos["TRANSLATION"];
  assert.ok(typeof accessorId === "number" && Number.isSafeInteger(accessorId));
  const accessor = accesores[accessorId];
  assert.ok(esRegistro(accessor));
  assert.equal(accessor["count"], 3, "GLB conserva las tres instancias geométricas");
  const raiz = nodos.find((nodo) => esRegistro(nodo) && nodo["name"] === "Escena de prueba");
  assert.ok(esRegistro(raiz) && esRegistro(raiz["extras"]));
  assert.deepEqual(raiz["extras"], { nombreEscena: "Escena de prueba", cantidadGlobos: 3, cantidadPiezas: 2 });

  for (const archivoFuente of [
    "src/components/tres-d/exportar-escena-png.ts",
    "src/components/tres-d/exportar-escena-glb.ts",
    "src/components/tres-d/archivo-escena.ts",
    "src/components/tres-d/ExportarEscenaTaller.tsx",
  ]) {
    const fuente = readFileSync(archivoFuente, "utf8");
    assert.doesNotMatch(fuente, /\bfetch\s*\(|\bXMLHttpRequest\b|\/api\//, `${archivoFuente} exporta localmente`);
  }

  material.dispose();
  instancias.geometry.dispose();
  const mallaSala = sala.children[0];
  if (mallaSala instanceof THREE.Mesh) {
    mallaSala.geometry.dispose();
    for (const materialSala of Array.isArray(mallaSala.material) ? mallaSala.material : [mallaSala.material]) materialSala.dispose();
  }
  process.stdout.write("[PASS] PNG llega a 3000 px; el GLB conserva instancias/conteos, toma nombre de escena y no usa red.\n");
}

void principal().catch((causa: unknown) => {
  process.stderr.write(`${causa instanceof Error ? causa.stack ?? causa.message : String(causa)}\n`);
  process.exitCode = 1;
});
