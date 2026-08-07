"use client";

import { createContext, useContext, type ReactNode } from "react";

const SurfaceContext = createContext<number>(1);

/** Returns the current Fluid surface level. */
export function useSurface(): number {
  return useContext(SurfaceContext);
}

/** Provides a Fluid surface level to nested elevated content. */
export function SurfaceProvider({ value, children }: { value: number; children: ReactNode }) {
  return (
    <SurfaceContext.Provider value={Math.max(1, Math.min(8, value))}>
      {children}
    </SurfaceContext.Provider>
  );
}
