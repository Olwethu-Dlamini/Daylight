import { createContext, useContext } from "react";
import type { Idl, Program } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";

export interface AppCtx {
  /** Connected wallet's key, or null. */
  me: PublicKey | null;
  /** Program handle; signs with the wallet when one is connected. */
  program: Program<Idl>;
  /** Run a transaction with progress and result shown in the toast. */
  run: (label: string, send: () => Promise<string>) => Promise<boolean>;
  /** Bumped after every successful transaction so views reload. */
  version: number;
  go: (hash: string) => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
