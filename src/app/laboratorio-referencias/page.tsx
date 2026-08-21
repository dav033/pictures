"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Imagen, PeticionImagen, ProveedorId } from "@/lib/ia/tipos";

type Prueba = {
  id: number;
  instruccion: string;
  json: string;
  imagen?: string;
  error?: string;
  pendiente?: boolean;
};

async function prepararImagen(file: File): Promise<Imagen> {
  if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" no es una imagen.`);
  if (file.size > 20 * 1024 * 1024) throw new Error(`"${file.name}" supera 20 MB.`);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const escala = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Canvas no disponible.");
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen."))), "image/jpeg", 0.9),
    );
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(blob);
    });
    return { base64, mime: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}

function idsDelJson(texto: string): string[] {
  const json = JSON.parse(texto) as { referencias?: Array<{ id?: unknown }> };
  if (!Array.isArray(json.referencias)) return [];
  return json.referencias.map((r) => r.id).filter((id): id is string => typeof id === "string");
}

export default function LaboratorioReferenciasPage() {
  const [json, setJson] = useState("");
  const [instruccion, setInstruccion] = useState("Recrea fielmente esta decoración.");
  const [imagenes, setImagenes] = useState<Imagen[]>([]);
  const [nombres, setNombres] = useState<string[]>([]);
  const [proveedor, setProveedor] = useState<ProveedorId>("gemini");
  const [disponibles, setDisponibles] = useState<ProveedorId[]>(["gemini"]);
  const [aspecto, setAspecto] = useState<PeticionImagen["aspecto"]>("3:2");
  const [pruebas, setPruebas] = useState<Prueba[]>([]);
  const [errorEntrada, setErrorEntrada] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const siguienteId = useRef(1);

  useEffect(() => {
    fetch("/api/ia/salud")
      .then((r) => r.json())
      .then((data) => {
        const ids = (data.proveedores ?? [])
          .filter((p: { disponible: boolean }) => p.disponible)
          .map((p: { id: ProveedorId }) => p.id);
        if (ids.length) {
          setDisponibles(ids);
          setProveedor(data.predeterminado ?? ids[0]);
        }
      })
      .catch(() => {});
  }, []);

  async function cargar(files: FileList) {
    setErrorEntrada(null);
    try {
      const lista = Array.from(files).slice(0, 6);
      const preparadas = await Promise.all(lista.map(prepararImagen));
      setImagenes(preparadas);
      setNombres(lista.map((f) => f.name));
    } catch (error) {
      setErrorEntrada(error instanceof Error ? error.message : "No se pudieron procesar las imágenes.");
    }
  }

  function formatearJson() {
    try {
      setJson(JSON.stringify(JSON.parse(json), null, 2));
      setErrorEntrada(null);
    } catch {
      setErrorEntrada("JSON inválido. Revisa comas, llaves y comillas.");
    }
  }

  async function enviar() {
    if (procesando) return;
    setErrorEntrada(null);
    let ids: string[];
    try {
      ids = idsDelJson(json);
      if (!json.trim()) throw new Error("Pega primero el JSON devuelto por el chat.");
      if (imagenes.length && imagenes.length !== ids.length) {
        throw new Error(`JSON tiene ${ids.length} referencias y adjuntaste ${imagenes.length} imágenes.`);
      }
    } catch (error) {
      setErrorEntrada(error instanceof Error ? error.message : "JSON inválido.");
      return;
    }

    const id = siguienteId.current++;
    const prueba: Prueba = { id, instruccion, json, pendiente: true };
    setPruebas((previas) => [...previas, prueba]);
    setProcesando(true);
    try {
      const respuesta = await fetch("/api/laboratorio-referencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json, instruccion, imagenes, proveedor, aspecto }),
      });
      const data = await respuesta.json();
      setPruebas((previas) =>
        previas.map((p) =>
          p.id === id
            ? { ...p, pendiente: false, imagen: respuesta.ok ? data.imagen : undefined, error: respuesta.ok ? undefined : data.error }
            : p,
        ),
      );
    } catch {
      setPruebas((previas) =>
        previas.map((p) => (p.id === id ? { ...p, pendiente: false, error: "No se pudo contactar al servidor." } : p)),
      );
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="min-h-dvh bg-fondo text-texto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borde bg-superficie px-5 py-3">
        <div>
          <h1 className="text-base font-semibold">Laboratorio de referencias JSON</h1>
          <p className="text-xs text-texto-suave">Prueba aislada: JSON + imágenes, sin catálogo ni conversación principal.</p>
        </div>
        <Link href="/" className="text-sm text-acento underline underline-offset-2">Volver al chat</Link>
      </header>

      <main className="grid min-h-[calc(100dvh-65px)] lg:grid-cols-[1fr_29rem]">
        <section className="space-y-5 p-5 lg:overflow-y-auto">
          {pruebas.length === 0 && (
            <div className="rounded-2xl border border-dashed border-borde bg-superficie p-6 text-sm text-texto-suave">
              Pega un Reference Blueprint v2. Puedes adjuntar imágenes originales en el mismo orden de <code>source_images</code>. Fixtures v1 siguen disponibles solo como adaptador de laboratorio.
            </div>
          )}
          {pruebas.map((prueba) => (
            <article key={prueba.id} className="space-y-3">
              <div className="ml-auto max-w-3xl rounded-2xl bg-acento px-4 py-3 text-sm text-white">
                <p>{prueba.instruccion}</p>
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer">Ver JSON enviado</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 font-mono">{prueba.json}</pre>
                </details>
              </div>
              <div className="max-w-3xl rounded-2xl border border-borde bg-superficie p-4">
                <AnimatePresence mode="wait">
                  {prueba.pendiente && (
                    <motion.p
                      key="pendiente"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 text-sm text-texto-suave"
                    >
                      <Loader2 className="size-4 animate-spin" />
                      Analizando mapa y generando… puede tardar hasta 2 min.
                    </motion.p>
                  )}
                  {prueba.error && (
                    <motion.p key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-red-700">
                      {prueba.error}
                    </motion.p>
                  )}
                  {prueba.imagen && (
                    <motion.img
                      key="imagen"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      src={prueba.imagen}
                      alt={`Resultado de prueba ${prueba.id}`}
                      className="w-full rounded-xl"
                    />
                  )}
                </AnimatePresence>
              </div>
            </article>
          ))}
        </section>

        <aside className="space-y-4 border-t border-borde bg-superficie-2 p-5 lg:border-l lg:border-t-0">
          <label className="block text-xs font-semibold uppercase tracking-wide text-texto-suave">
            JSON descriptivo
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder={'Pega { "schema_version": "2.0", "source_images": [], "elements": [] }'}
              className="mt-2 h-72 w-full resize-y rounded-xl border border-borde bg-superficie p-3 font-mono text-xs font-normal normal-case tracking-normal outline-none focus:border-acento"
            />
          </label>
          <button type="button" onClick={formatearJson} className="text-xs text-acento underline underline-offset-2">
            Validar y formatear JSON
          </button>

          <label className="block text-xs font-semibold uppercase tracking-wide text-texto-suave">
            Instrucción de prueba
            <textarea value={instruccion} onChange={(e) => setInstruccion(e.target.value)} className="mt-2 h-20 w-full rounded-xl border border-borde bg-superficie p-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-acento" />
          </label>

          <label className="block rounded-xl border border-dashed border-borde bg-superficie p-3 text-sm">
            Imágenes originales, mismo orden del JSON
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => e.target.files && cargar(e.target.files)} className="mt-2 block w-full text-xs" />
          </label>
          {nombres.length > 0 && <p className="text-xs text-texto-suave">{nombres.join(" · ")}</p>}

          <div className="grid grid-cols-2 gap-2">
            <Select value={proveedor} onValueChange={(v) => setProveedor(v as ProveedorId)}>
              <SelectTrigger className="w-full max-w-none border border-borde bg-superficie text-xs text-texto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["gemini"] as ProveedorId[]).map((id) => (
                  <SelectItem key={id} value={id} disabled={!disponibles.includes(id)}>
                    {id}
                    {!disponibles.includes(id) ? " (sin llave)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={aspecto} onValueChange={(v) => setAspecto(v as PeticionImagen["aspecto"])}>
              <SelectTrigger className="w-full max-w-none border border-borde bg-superficie text-xs text-texto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["3:2", "1:1", "2:3", "16:9"] as const).map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {errorEntrada && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-700">{errorEntrada}</p>}
          <button type="button" onClick={enviar} disabled={procesando || !json.trim()} className="w-full rounded-xl bg-acento px-4 py-3 text-sm font-medium text-white disabled:opacity-40">
            {procesando ? "Generando prueba…" : "Enviar al generador"}
          </button>
        </aside>
      </main>
    </div>
  );
}
