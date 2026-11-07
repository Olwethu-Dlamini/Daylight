import { useEffect, useState } from "react";
import { explainError } from "./client.ts";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Run an async read whenever deps change; keeps the previous data while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState((s) => ({ ...s, error: explainError(e), loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
