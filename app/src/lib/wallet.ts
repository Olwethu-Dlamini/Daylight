import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/** The subset of the injected Phantom/Solflare/Backpack provider we rely on. */
interface InjectedProvider {
  publicKey: PublicKey | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
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

export async function connectWallet(opts?: { silent?: boolean }): Promise<AnchorWallet | null> {
  const p = injected();
  if (!p) return null;
  const res = await p.connect(opts?.silent ? { onlyIfTrusted: true } : undefined);
  return {
    publicKey: res.publicKey,
    signTransaction: (tx) => p.signTransaction(tx),
    signAllTransactions: (txs) => p.signAllTransactions(txs),
  };
}

export async function disconnectWallet(): Promise<void> {
  await injected()?.disconnect();
}
