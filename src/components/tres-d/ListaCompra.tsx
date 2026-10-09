"use client";

import { useState, type ReactNode } from "react";
import { ClipboardCopy } from "lucide-react";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import type { MaterialDecoracion } from "@/lib/globos3d/figuras";
import { corazonesSinCobertura } from "@/lib/globos3d/formatos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { ProductosFiesta } from "./UtileriaFiesta";
import { BTN } from "./ui-taller";

const m = (cm: number) => (cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** La lista de globos: cantidad × formato, nombre del color y código (de más a menos). */
function ListaMateriales({ materiales }: { materiales: ReadonlyArray<MaterialDecoracion> }) {
  return (
    <ul className={`text-sm ${materiales.length > 8 ? "gap-x-6 sm:columns-2" : ""}`}>
      {[...materiales].sort((a, b) => b.cantidad - a.cantidad).map((x) => (
        <li key={`${x.formatoId}|${x.codigo}`} className="flex break-inside-avoid items-center gap-2 py-0.5">
          <span className="size-3.5 shrink-0 rounded-full ring-1 ring-taller-borde" style={{ background: referenciaPorCodigo(x.codigo)?.hexGlobo ?? "#ccc" }} aria-hidden />
          <span className="w-10 shrink-0 text-right font-mono">{x.cantidad}</span>
          <span className="min-w-0">× {x.formatoId} {referenciaPorCodigo(x.codigo)?.nombreCompleto ?? x.codigo} <span className="font-mono text-taller-suave">{x.codigo}</span></span>
        </li>
      ))}
    </ul>
  );
}

function enTexto(nombre: string, escena: Escena, armada: EscenaArmada): string {
  const lineas = [`${nombre} — lista de compra`, `${escena.nodos.length} piezas · ${armada.globos.length} globos`, "", "GLOBOS"];
  for (const x of [...armada.materiales].sort((a, b) => b.cantidad - a.cantidad)) lineas.push(`${x.cantidad} × ${x.formatoId} ${referenciaPorCodigo(x.codigo)?.nombreCompleto ?? x.codigo} ${x.codigo}`);
  for (const x of corazonesSinCobertura(armada.materiales)) lineas.push(`SIN COBERTURA: la tienda no vende el Corazón 12 en ${referenciaPorCodigo(x.codigo)?.nombreCompleto ?? x.codigo} ${x.codigo} (${x.cantidad}).`);
  lineas.push("", "POR PIEZA");
  for (const n of armada.porNodo) lineas.push(`${n.nombre}: ${n.globos.length} globos${n.copias > 1 ? ` en ${n.copias} copias` : ""}`);
  return lineas.join("\n");
}

/**
 * La lista de compra de la escena (lo que antes era «Materiales y detalle»): globos por formato y color, cuántos lleva
 * cada pieza, productos de fiesta, avisos y, del motor de la biblioteca, los productos exactos de la tienda.
 */
export function ListaCompra({ nombre, escena, armada, productosExactos }: { nombre: string; escena: Escena; armada: EscenaArmada; productosExactos: ReactNode }) {
  const [copiada, setCopiada] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(enTexto(nombre, escena, armada)); setCopiada(true); setTimeout(() => setCopiada(false), 2500); } catch { setCopiada(false); }
  };
  const tubitos = armada.materiales.some((x) => x.formatoId.startsWith("T-"));
  return (
    <div className="flex flex-col gap-5 p-4">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">Escena · <span className="font-mono">{escena.nodos.length}</span> {escena.nodos.length === 1 ? "pieza" : "piezas"} · <span className="font-mono">{armada.globos.length}</span> globos{armada.flores.length ? ` · ${armada.flores.length} flores` : ""}</p>
          <p className="font-mono text-xs text-taller-suave">Sala {m(escena.sala.anchoCm)} × {m(escena.sala.fondoCm)} × {m(escena.sala.altoCm)} m</p>
        </div>
        <button type="button" onClick={() => void copiar()} className={BTN}><ClipboardCopy className="size-4" aria-hidden />{copiada ? "Lista copiada" : "Copiar la lista"}</button>
      </section>
      <section aria-label="Globos">
        <h3 className="taller-rotulo mb-2">Globos</h3>
        {armada.materiales.length ? <ListaMateriales materiales={armada.materiales} /> : <p className="text-sm text-taller-suave">La escena no lleva globos todavía.</p>}
        {tubitos && <p className="mt-1 text-xs text-taller-suave">Tubitos contados por largo (~137 cm útiles cada uno).</p>}
        {armada.materiales.some((x) => x.formatoId === "C-6") && <p className="text-xs text-taller-suave">Corazón 6: color de Celebra ed. 27 (no está en la tabla oficial).</p>}
        {corazonesSinCobertura(armada.materiales).map((x) => <p key={x.codigo} className="text-xs text-red-600" role="note">Sin cobertura: la tienda no vende el Corazón 12 en {referenciaPorCodigo(x.codigo)?.nombreCompleto ?? x.codigo} ({x.codigo}); {x.cantidad} {x.cantidad === 1 ? "corazón no se puede comprar" : "corazones no se pueden comprar"} en ese color.</p>)}
        {armada.flores.length > 0 && <p className="mt-1 text-xs text-taller-suave">Las flores artificiales son follaje: no cuentan como globos.</p>}
      </section>
      <section aria-label="Por pieza">
        <h3 className="taller-rotulo mb-2">Por pieza</h3>
        <ul className="text-sm">
          {armada.porNodo.map((n) => <li key={n.id} className="flex justify-between gap-3 border-b border-taller-linea py-1"><span className="min-w-0 truncate">{n.nombre}</span><span className="shrink-0 font-mono text-taller-suave">{n.globos.length} globos{n.copias > 1 ? ` · ${n.copias} copias` : ""}</span></li>)}
        </ul>
      </section>
      <section aria-label="Productos de fiesta" className="[&_.detalle-ficha]:mt-0"><ProductosFiesta escena={escena} armada={armada} /></section>
      {armada.avisos.length > 0 && <section aria-label="Avisos"><h3 className="taller-rotulo mb-2">Avisos</h3><p className="text-sm">{armada.avisos.join(" ")}</p></section>}
      <section aria-label="Productos exactos de la tienda" className="flex flex-col gap-2">
        <h3 className="taller-rotulo">Productos exactos de la tienda</h3>
        {productosExactos}
      </section>
    </div>
  );
}
