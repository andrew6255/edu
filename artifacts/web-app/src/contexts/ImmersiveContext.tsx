import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type ImmersiveContextValue = {
  /** True while a view has asked for the app chrome (top HUD, bottom nav) to be hidden. */
  immersive: boolean;
  setImmersive: (on: boolean) => void;
};

const ImmersiveContext = createContext<ImmersiveContextValue>({
  immersive: false,
  setImmersive: () => {},
});

export function ImmersiveProvider({ children }: { children: ReactNode }) {
  const [immersive, setImmersive] = useState(false);
  const value = useMemo(() => ({ immersive, setImmersive }), [immersive]);
  return <ImmersiveContext.Provider value={value}>{children}</ImmersiveContext.Provider>;
}

export function useImmersive(): ImmersiveContextValue {
  return useContext(ImmersiveContext);
}

/**
 * Requests immersive mode for as long as `active` is true, and always releases it
 * on unmount — otherwise navigating away mid-question would leave the student with
 * no navigation bar and no way back.
 */
export function useImmersiveMode(active: boolean): void {
  const { setImmersive } = useImmersive();
  const release = useCallback(() => setImmersive(false), [setImmersive]);

  useEffect(() => {
    setImmersive(active);
  }, [active, setImmersive]);

  useEffect(() => release, [release]);
}
