import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionConfig } from "motion/react";
import { SeleccionProvider } from "@/lib/estado/seleccion";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Asistente de decoración | Demo",
  description:
    "Chatbot que recomienda decoración de tu catálogo y genera una visualización del evento.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col font-sans">
        {/* "user": Motion respeta prefers-reduced-motion del sistema operativo,
            igual que ya hace el CSS puro en globals.css. */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <SeleccionProvider>{children}</SeleccionProvider>
          </TooltipProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
