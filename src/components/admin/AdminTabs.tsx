"use client";

import Link from "next/link";
import { useState } from "react";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LoraDatasetGalleryData } from "@/lib/lora/dataset-v005-view";
import type { Decoracion, Producto } from "@/lib/types";
import { ArquitecturaTab } from "./ArquitecturaTab";
import { CatalogoShopifyTab } from "./CatalogoShopifyTab";
import { DecoracionesTab } from "./DecoracionesTab";
import { MotorIATab } from "./MotorIATab";
import { OrdenesTab } from "./OrdenesTab";
import { ProductosTab } from "./ProductosTab";
import LoraDatasetGallery from "../lora/LoraDatasetGallery";

type Tab = "arquitectura" | "productos" | "decoraciones" | "motor-ia" | "catalogo-shopify" | "ordenes" | "lora-dataset";

export function AdminTabs({
  productosIniciales,
  decoracionesIniciales,
  datasetLoraInicial,
}: {
  productosIniciales: Producto[];
  decoracionesIniciales: Decoracion[];
  datasetLoraInicial: LoraDatasetGalleryData | null;
}) {
  const [tab, setTab] = useState<Tab>("arquitectura");
  const [productos, setProductos] = useState<Producto[]>(productosIniciales);
  const [decoraciones, setDecoraciones] = useState<Decoracion[]>(decoracionesIniciales);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 sm:px-5">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-texto">Panel de administración</h1>
          <p className="text-xs text-texto-suave">
            Sube referencias reales y arma decoraciones a partir del catálogo
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/" className="ui-button-ghost rounded-lg px-2 py-1.5">
            ← Volver al chat
          </Link>
          <InterruptorTema />
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-5">
        <TabsList>
          <TabsTrigger value="arquitectura" activo={tab === "arquitectura"}>
            Biblioteca IA
          </TabsTrigger>
          <TabsTrigger value="productos" activo={tab === "productos"}>
            Productos
          </TabsTrigger>
          <TabsTrigger value="decoraciones" activo={tab === "decoraciones"}>
            Decoraciones
          </TabsTrigger>
          <TabsTrigger value="motor-ia" activo={tab === "motor-ia"}>
            Motor IA
          </TabsTrigger>
          <TabsTrigger value="catalogo-shopify" activo={tab === "catalogo-shopify"}>
            Catálogo Shopify
          </TabsTrigger>
          <TabsTrigger value="ordenes" activo={tab === "ordenes"}>
            Órdenes (dataset)
          </TabsTrigger>
          <TabsTrigger value="lora-dataset" activo={tab === "lora-dataset"}>
            Dataset LoRA
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "arquitectura" && <ArquitecturaTab />}
      {tab === "productos" && <ProductosTab productos={productos} onCambio={setProductos} />}
      {tab === "decoraciones" && (
        <DecoracionesTab
          decoraciones={decoraciones}
          productos={productos}
          onCambio={setDecoraciones}
        />
      )}
      {tab === "motor-ia" && <MotorIATab />}
      {tab === "catalogo-shopify" && <CatalogoShopifyTab />}
      {tab === "ordenes" && <OrdenesTab />}
      {tab === "lora-dataset" && <LoraDatasetGallery data={datasetLoraInicial} />}
    </div>
  );
}
