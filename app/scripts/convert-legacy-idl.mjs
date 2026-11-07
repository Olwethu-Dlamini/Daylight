// Convert an Anchor <=0.29 IDL (what an older Solana Playground exports) into
// the 0.30+ format the app's client needs. Usage:
//   node scripts/convert-legacy-idl.mjs <legacy-idl.json> <program-id> [out.json]
// The on-chain program is unchanged: discriminators are sha256 of
// "global:<snake_name>", "account:<Name>" and "event:<Name>" in both formats.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const snake = (s) => s.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();
const disc = (preimage) => Array.from(createHash("sha256").update(preimage).digest().subarray(0, 8));

function convertType(t) {
  if (t === "publicKey") return "pubkey";
  if (typeof t === "string") return t;
  if ("defined" in t) return { defined: { name: typeof t.defined === "string" ? t.defined : t.defined.name } };
  if ("vec" in t) return { vec: convertType(t.vec) };
  if ("option" in t) return { option: convertType(t.option) };
  if ("coption" in t) return { coption: convertType(t.coption) };
  if ("array" in t) return { array: [convertType(t.array[0]), t.array[1]] };
  throw new Error(`unsupported IDL type: ${JSON.stringify(t)}`);
}

const convertField = (f) => ({ name: snake(f.name), type: convertType(f.type) });

function convertTypeDef(def) {
  const t = def.type;
  if (t.kind === "struct") {
    return { name: def.name, type: { kind: "struct", fields: t.fields.map(convertField) } };
  }
  if (t.kind === "enum") {
    return {
      name: def.name,
      type: {
        kind: "enum",
        variants: t.variants.map((v) => (v.fields ? { name: v.name, fields: v.fields.map((f) => (f.name ? convertField(f) : convertType(f))) } : { name: v.name })),
      },
    };
  }
  throw new Error(`unsupported type kind: ${t.kind}`);
}

function convertAccounts(list) {
  return list.map((a) => {
    if (a.accounts) throw new Error("nested account groups are not supported");
    const out = { name: snake(a.name) };
    if (a.isMut) out.writable = true;
    if (a.isSigner) out.signer = true;
    if (a.isOptional) out.optional = true;
    return out;
  });
}

export function convertLegacyIdl(legacy, address) {
  if (legacy.address) throw new Error("this IDL already has an address: it is not a legacy IDL");
  const types = [...(legacy.accounts ?? []).map(convertTypeDef), ...(legacy.types ?? []).map(convertTypeDef)];
  for (const e of legacy.events ?? []) {
    types.push({ name: e.name, type: { kind: "struct", fields: e.fields.map(convertField) } });
  }
  return {
    address,
    metadata: { name: legacy.name, version: legacy.version, spec: "0.1.0" },
    instructions: legacy.instructions.map((ix) => ({
      name: snake(ix.name),
      discriminator: disc(`global:${snake(ix.name)}`),
      accounts: convertAccounts(ix.accounts),
      args: ix.args.map(convertField),
    })),
    accounts: (legacy.accounts ?? []).map((a) => ({ name: a.name, discriminator: disc(`account:${a.name}`) })),
    events: (legacy.events ?? []).map((e) => ({ name: e.name, discriminator: disc(`event:${e.name}`) })),
    errors: legacy.errors ?? [],
    types,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, address, out] = process.argv.slice(2);
  if (!input || !address) {
    console.error("usage: node scripts/convert-legacy-idl.mjs <legacy-idl.json> <program-id> [out.json]");
    process.exit(2);
  }
  const dest = out ?? fileURLToPath(new URL("../src/idl/daylight.json", import.meta.url));
  const converted = convertLegacyIdl(JSON.parse(readFileSync(input, "utf8")), address);
  writeFileSync(dest, JSON.stringify(converted, null, 2) + "\n");
  console.log(`wrote ${dest}: ${converted.instructions.length} instructions, ${converted.accounts.length} accounts, ${converted.events.length} events, ${converted.errors.length} errors`);
}
