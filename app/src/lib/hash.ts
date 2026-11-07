/** sha256 of text or a file, computed in the browser. The input never leaves the device. */
export async function sha256Bytes(data: ArrayBuffer | string): Promise<number[]> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest));
}

export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes as ArrayLike<number> & Iterable<number>, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export const ZERO_HASH: number[] = new Array(32).fill(0);
