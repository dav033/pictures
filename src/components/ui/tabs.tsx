"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

function Tabs(props: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex gap-1 overflow-x-auto rounded-lg border border-borde bg-superficie p-1 text-sm",
        className,
      )}
      {...props}
    />
  );
}

/** El pill activo es un `motion.div` con `layoutId` compartido, montado solo
 * dentro del trigger activo — al cambiar `activo`, Motion anima su posición
 * anterior hacia la nueva en vez de que el fondo salte de golpe. */
function TabsTrigger({
  className,
  children,
  value,
  activo,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & { activo: boolean }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "relative shrink-0 rounded-md px-3 py-1.5 text-texto-suave outline-none transition-colors",
        activo && "text-white",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    >
      {activo && (
        <motion.span
          layoutId="admin-tab-pill"
          className="absolute inset-0 rounded-md bg-acento"
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export { Tabs, TabsList, TabsTrigger };
