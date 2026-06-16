import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface PanelContextValue {
  panelState: Record<string, unknown>;
  setPanelState: (s: Record<string, unknown>) => void;
}

const PanelContext = createContext<PanelContextValue>({
  panelState: {},
  setPanelState: () => {},
});

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panelState, setPanelState] = useState<Record<string, unknown>>({});
  return (
    <PanelContext.Provider value={{ panelState, setPanelState }}>
      {children}
    </PanelContext.Provider>
  );
}

export function usePanelState(state: Record<string, unknown>) {
  const { setPanelState } = useContext(PanelContext);
  useEffect(() => {
    setPanelState(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(state)]);
}

export function usePanelContext() {
  return useContext(PanelContext);
}
