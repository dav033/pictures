"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2, Wand2 } from "lucide-react";
import type { TipoModulo } from "@/lib/globos3d/modulos";

/**
 * «un dúo de reflex rojo con azul mate»: la persona lo escribe y el estudio lo arma (`/api/modulos-interpretar`). Lo que
 * el catálogo no tiene se dice tal cual (no se inventa un color parecido) y la configuración que había no se toca.
 */
export type PedidoResuelto = { tipo: TipoModulo; formatoId: string; colores: string[] };

type Respuesta = { ok?: boolean; error?: string; errores?: string[]; avisos?: string[]; tipo?: TipoModulo; formatoId?: string; colores?: string[] };

export function PedidoEnTexto({ onResuelto }: { onResuelto: (pedido: PedidoResuelto) => void }) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensajes, setMensajes] = useState<{ tipo: "error" | "aviso"; texto: string }[]>([]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim() || ocupado) return;
    setOcupado(true);
    setMensajes([]);
    try {
      const respuesta = await fetch("/api/modulos-interpretar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texto: texto.trim() }) });
      const datos = (await respuesta.json().catch(() => ({}))) as Respuesta;
      if (datos.ok && datos.tipo && datos.formatoId && datos.colores) {
        onResuelto({ tipo: datos.tipo, formatoId: datos.formatoId, colores: datos.colores });
        setMensajes((datos.avisos ?? []).map((a) => ({ tipo: "aviso", texto: a })));
      } else {
        setMensajes([...(datos.errores ?? (datos.error ? [datos.error] : ["No pude interpretar el pedido."])).map((t) => ({ tipo: "error" as const, texto: t })), ...(datos.avisos ?? []).map((t) => ({ tipo: "aviso" as const, texto: t }))]);
      }
    } catch {
      setMensajes([{ tipo: "error", texto: "No hubo conexión con el servidor. Elige el módulo y los colores a mano." }]);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-texto-suave">Descríbelo con palabras</label>
      <div className="flex gap-2">
        <input
          id={id}
          value={texto}
          maxLength={300}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="un dúo de reflex rojo con azul mate"
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-fondo px-3 text-sm text-texto ring-1 ring-borde placeholder:text-texto-tenue"
        />
        <button type="submit" disabled={ocupado || !texto.trim()} aria-label="Armar el módulo del pedido" className="grid size-11 shrink-0 place-items-center rounded-xl bg-acento text-sobre-acento hover:bg-acento-hover disabled:opacity-50">
          {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}
        </button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-1">
        {mensajes.map((m) => <p key={m.texto} role={m.tipo === "error" ? "alert" : undefined} className={`text-xs ${m.tipo === "error" ? "text-error" : "text-aviso"}`}>{m.texto}</p>)}
      </div>
    </form>
  );
}
