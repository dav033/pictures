"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Faceta } from "@/lib/shopify/consultas";

type Props = {
  categorias: Faceta[];
  colores: Faceta[];
  formas: Faceta[];
  ocasiones: Faceta[];
};

function listaDe(valor: string | null): string[] {
  return valor ? valor.split(",").filter(Boolean) : [];
}

function SeccionFaceta({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(true);
  return (
    <fieldset>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-texto-suave"
      >
        <legend>{titulo}</legend>
        <motion.span animate={{ rotate: abierta ? 0 : -90 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {abierta && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </fieldset>
  );
}

export function Facetas({ categorias, colores, formas, ocasiones }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [texto, setTexto] = useState(searchParams.get("q") ?? "");

  const categoriasActivas = listaDe(searchParams.get("categoria"));
  const coloresActivos = listaDe(searchParams.get("color"));
  const formasActivas = listaDe(searchParams.get("forma"));
  const ocasionesActivas = listaDe(searchParams.get("ocasion"));
  const soloDisponibles = searchParams.get("disponible") !== "0";

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === null || valor === "") params.delete(clave);
      else params.set(clave, valor);
    }
    params.delete("pagina");
    router.push(`/catalogo?${params.toString()}`);
  }

  function alternarEnLista(clave: string, activos: string[], valor: string) {
    const nuevos = activos.includes(valor) ? activos.filter((v) => v !== valor) : [...activos, valor];
    actualizar({ [clave]: nuevos.join(",") || null });
  }

  useEffect(() => {
    const actual = searchParams.get("q") ?? "";
    if (texto === actual) return;
    const id = setTimeout(() => actualizar({ q: texto || null }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="space-y-5">
      <div>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar en el catálogo…"
          className="w-full rounded-xl border border-borde bg-superficie px-3 py-2 text-sm text-texto outline-none placeholder:text-texto-suave focus:border-acento"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-texto">
        <Checkbox
          checked={soloDisponibles}
          onCheckedChange={(checked) => actualizar({ disponible: checked ? null : "0" })}
        />
        Solo disponibles
      </label>

      {categorias.length > 0 && (
        <SeccionFaceta titulo="Tipo">
          <div className="flex flex-col gap-1.5">
            {categorias.map((f) => (
              <label key={f.valor} className="flex items-center gap-2 text-sm text-texto">
                <Checkbox
                  checked={categoriasActivas.includes(f.valor)}
                  onCheckedChange={() => alternarEnLista("categoria", categoriasActivas, f.valor)}
                />
                <span className="flex-1">{f.etiqueta}</span>
                <span className="text-xs text-texto-suave">{f.total}</span>
              </label>
            ))}
          </div>
        </SeccionFaceta>
      )}

      {ocasiones.length > 0 && (
        <SeccionFaceta titulo="Ocasión">
          <div className="flex flex-col gap-1.5">
            {ocasiones.map((f) => (
              <label key={f.valor} className="flex items-center gap-2 text-sm text-texto">
                <Checkbox
                  checked={ocasionesActivas.includes(f.valor)}
                  onCheckedChange={() => alternarEnLista("ocasion", ocasionesActivas, f.valor)}
                />
                <span className="flex-1">{f.etiqueta}</span>
                <span className="text-xs text-texto-suave">{f.total}</span>
              </label>
            ))}
          </div>
        </SeccionFaceta>
      )}

      {formas.length > 0 && (
        <SeccionFaceta titulo="Forma">
          <div className="flex flex-col gap-1.5">
            {formas.map((f) => (
              <label key={f.valor} className="flex items-center gap-2 text-sm text-texto">
                <Checkbox
                  checked={formasActivas.includes(f.valor)}
                  onCheckedChange={() => alternarEnLista("forma", formasActivas, f.valor)}
                />
                <span className="flex-1">{f.etiqueta}</span>
                <span className="text-xs text-texto-suave">{f.total}</span>
              </label>
            ))}
          </div>
        </SeccionFaceta>
      )}

      {colores.length > 0 && (
        <SeccionFaceta titulo="Color">
          <div className="flex flex-wrap gap-1.5">
            {colores.map((f) => (
              <button
                key={f.valor}
                type="button"
                onClick={() => alternarEnLista("color", coloresActivos, f.valor)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  coloresActivos.includes(f.valor)
                    ? "border-acento bg-acento-suave text-acento"
                    : "border-borde bg-superficie text-texto-suave hover:border-acento/50"
                }`}
              >
                {f.etiqueta} · {f.total}
              </button>
            ))}
          </div>
        </SeccionFaceta>
      )}
    </div>
  );
}
