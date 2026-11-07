import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/** The subset of the injected Phantom/Solflare/Backpack provider we rely on. */
interface InjectedProvider {
  publicKey: PublicKey | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  on?(event: "accountChanged" | "disconnect", handler: (pk?: PublicKey | null) => void): void;
  off?(event: "accountChanged" | "disconnect", handler: (pk?: PublicKey | null) => void): void;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

/** Matches the Wallet interface Anchor's provider expects. */
export interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

function injected(): InjectedProvider | null {
  const w = window as unknown as {
    phantom?: { solana?: InjectedProvider };
    solana?: InjectedProvider;
  };
  return w.phantom?.solana ?? w.solana ?? null;
}

export const hasWallet = (): boolean => injected() !== null;

const toWallet = (p: InjectedProvider, publicKey: PublicKey): AnchorWallet => ({
  publicKey,
  signTransaction: (tx) => p.signTransaction(tx),
  signAllTransactions: (txs) => p.signAllTransactions(txs),
});

export async function connectWallet(opts?: { silent?: boolean }): Promise<AnchorWallet | null> {
  const p = injected();
  if (!p) return null;
  const res = await p.connect(opts?.silent ? { onlyIfTrusted: true } : undefined);
  return toWallet(p, res.publicKey);
}

/**
 * Follow the wallet when the user switches accounts in the extension, so the
 * app never keeps signing as the previous account. Returns an unsubscribe fn.
 */
export function subscribeWallet(onChange: (w: AnchorWallet | null) => void): () => void {
  const p = injected();
  if (!p?.on) return () => undefined;
  const changed = (pk?: PublicKey | null) => {
    if (pk) return onChange(toWallet(p, pk));
    // The new account has not approved this site yet: ask, quietly failing if declined.
    p.connect().then((r) => onChange(toWallet(p, r.publicKey))).catch(() => onChange(null));
  };
  const gone = () => onChange(null);
  p.on("accountChanged", changed);
  p.on("disconnect", gone);
  return () => {
    p.off?.("accountChanged", changed);
    p.off?.("disconnect", gone);
  };
}

export async function disconnectWallet(): Promise<void> {
  await injected()?.disconnect();
}
