"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DEFAULT_STAGE_MODE, STAGE_MODE_KEY, parseStageMode } from "@/lib/stage-mode";
import type { StageMode } from "@/lib/stage-mode";

interface ModeContextValue {
  mode: StageMode;
  setMode: (next: StageMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

function readMode(): StageMode {
  try {
    return parseStageMode(window.localStorage.getItem(STAGE_MODE_KEY));
  } catch {
    return DEFAULT_STAGE_MODE;
  }
}

export function ModeProvider({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement {
  const [mode, setModeState] = useState<StageMode>(DEFAULT_STAGE_MODE);

  useEffect(() => {
    setModeState(readMode());
  }, []);

  const setMode = useCallback((next: StageMode) => {
    try {
      window.localStorage.setItem(STAGE_MODE_KEY, next);
    } catch {
      // A blocked store must not break the viewport switch.
    }
    setModeState(next);
  }, []);

  const value = useMemo<ModeContextValue>(() => ({ mode, setMode }), [mode, setMode]);

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const value = useContext(ModeContext);
  if (value === null) {
    throw new Error("useMode must be used inside <ModeProvider>");
  }
  return value;
}
