"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Producto } from "@/lib/types";

const CLAVE = "demo_seleccion_v1";

type EstadoSeleccion = {
  ids: string[];
  conocidos: Record<string, Producto>;
};

type ContextoSeleccion = {
  ids: string[];
  productos: Producto[];
  estaSeleccionado: (id: string) => boolean;
  alternar: (producto: Producto) => void;
  quitar: (id: string) => void;
  agregarVarios: (productos: Producto[]) => void;
  /**
   * Sustituye toda la selección en un solo update (ej. al aplicar una
   * cotización editada en el chat) — a diferencia de `limpiar()` seguido de
   * `agregarVarios()`, no pasa por un render intermedio con la selección
   * vacía.
   */
  reemplazarTodo: (productos: Producto[]) => void;
  registrarConocidos: (productos: Producto[]) => void;
  limpiar: () => void;
};

const Contexto = createContext<ContextoSeleccion | null>(null);

/**
 * Selección compartida entre el chat y /catalogo, persistida en
 * sessionStorage: es lo que permite que un cliente elija piezas en el
 * explorador, vuelva al chat y las encuentre ahí listas para generar
 * (§4.5 del plan — sin esto, /catalogo es una isla).
 */
export function SeleccionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSeleccion>({ ids: [], conocidos: {} });
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    // sessionStorage no existe en el render de servidor: hidratar el estado
    // solo puede pasar aquí, después del montaje en el cliente. El render
    // extra que esto dispara es el costo esperado de leer un storage externo.
    try {
      const guardado = sessionStorage.getItem(CLAVE);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (guardado) setEstado(JSON.parse(guardado));
    } catch {
      // sessionStorage no disponible (ej. modo privado estricto) — se sigue sin persistencia.
    }
    setCargado(true);
  }, []);

  useEffect(() => {
    if (!cargado) return;
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch {
      // idem
    }
  }, [estado, cargado]);

  const registrarConocidos = useCallback((productos: Producto[]) => {
    if (productos.length === 0) return;
    setEstado((previo) => {
      const conocidos = { ...previo.conocidos };
      for (const p of productos) conocidos[p.id] = p;
      return { ...previo, conocidos };
    });
  }, []);

  const alternar = useCallback((producto: Producto) => {
    setEstado((previo) => {
      const conocidos = { ...previo.conocidos, [producto.id]: producto };
      const ids = previo.ids.includes(producto.id)
        ? previo.ids.filter((id) => id !== producto.id)
        : [...previo.ids, producto.id];
      return { ids, conocidos };
    });
  }, []);

  const quitar = useCallback((id: string) => {
    setEstado((previo) => ({ ...previo, ids: previo.ids.filter((x) => x !== id) }));
  }, []);

  const agregarVarios = useCallback((productos: Producto[]) => {
    if (productos.length === 0) return;
    setEstado((previo) => {
      const conocidos = { ...previo.conocidos };
      const ids = [...previo.ids];
      for (const p of productos) {
        conocidos[p.id] = p;
        if (!ids.includes(p.id)) ids.push(p.id);
      }
      return { ids, conocidos };
    });
  }, []);

  const reemplazarTodo = useCallback((productos: Producto[]) => {
    setEstado((previo) => {
      const conocidos = { ...previo.conocidos };
      for (const p of productos) conocidos[p.id] = p;
      return { ids: productos.map((p) => p.id), conocidos };
    });
  }, []);

  const limpiar = useCallback(() => {
    setEstado({ ids: [], conocidos: {} });
  }, []);

  const productos = estado.ids
    .map((id) => estado.conocidos[id])
    .filter((p): p is Producto => Boolean(p));

  const valor: ContextoSeleccion = {
    ids: estado.ids,
    productos,
    estaSeleccionado: (id) => estado.ids.includes(id),
    alternar,
    quitar,
    agregarVarios,
    reemplazarTodo,
    registrarConocidos,
    limpiar,
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSeleccion(): ContextoSeleccion {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSeleccion debe usarse dentro de <SeleccionProvider>.");
  return ctx;
}
