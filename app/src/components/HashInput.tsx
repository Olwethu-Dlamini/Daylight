import { useState } from "react";
import { sha256Bytes, toHex } from "../lib/hash.ts";

/**
 * Text or file in, sha256 out. Only the hash goes on-chain; the content stays
 * with the org (no child data on-chain, ever).
 */
export function HashInput({
  label,
  hint,
  onHash,
}: {
  label: string;
  hint: string;
  onHash: (hash: number[] | null) => void;
}) {
  const [hex, setHex] = useState("");

  const set = (bytes: number[] | null) => {
    setHex(bytes ? toHex(bytes) : "");
    onHash(bytes);
  };

  return (
    <label>
      {label}
      <textarea
        rows={2}
        placeholder={hint}
        onChange={async (e) => set(e.target.value ? await sha256Bytes(e.target.value) : null)}
      />
      <input
        type="file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) set(await sha256Bytes(await f.arrayBuffer()));
        }}
      />
      <span className="muted mono">{hex ? `sha256 ${hex.slice(0, 24)}…` : "nothing hashed yet"}</span>
    </label>
  );
}
