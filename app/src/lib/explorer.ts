import { PublicKey } from "@solana/web3.js";

const cluster = "?cluster=devnet";
export const addressUrl = (a: PublicKey | string) =>
  `https://explorer.solana.com/address/${a.toString()}${cluster}`;
export const txUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}${cluster}`;
export const short = (a: PublicKey | string) => {
  const s = a.toString();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
