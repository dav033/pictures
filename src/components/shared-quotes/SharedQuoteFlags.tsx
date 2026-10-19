"use client";

import { createContext, useContext, type ReactNode } from "react";

type SharedQuoteFlags = { readerEnabled: boolean; writerEnabled: boolean };
const SharedQuoteFlagsContext = createContext<SharedQuoteFlags>({ readerEnabled: false, writerEnabled: false });

export function SharedQuoteFlagsProvider({
  readerEnabled,
  writerEnabled,
  children,
}: SharedQuoteFlags & { children: ReactNode }) {
  return (
    <SharedQuoteFlagsContext.Provider value={{ readerEnabled, writerEnabled: readerEnabled && writerEnabled }}>
      {children}
    </SharedQuoteFlagsContext.Provider>
  );
}

export function useSharedQuoteFlags(): SharedQuoteFlags {
  return useContext(SharedQuoteFlagsContext);
}
