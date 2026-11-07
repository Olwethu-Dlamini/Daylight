import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLegacyIdl } from "./convert-legacy-idl.mjs";

const legacy = {
  version: "0.1.0",
  name: "demo",
  instructions: [
    {
      name: "initialize",
      accounts: [
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "campaignCount", type: "u32" }, { name: "hash", type: { array: ["u8", 32] } }],
    },
  ],
  accounts: [
    {
      name: "Thing",
      type: { kind: "struct", fields: [{ name: "owner", type: "publicKey" }, { name: "sentAt", type: "i64" }, { name: "kind", type: { defined: "Kind" } }] },
    },
  ],
  types: [{ name: "Kind", type: { kind: "enum", variants: [{ name: "Sent" }, { name: "Confirmed" }] } }],
  events: [{ name: "Done", fields: [{ name: "thing", type: "publicKey", index: false }] }],
  errors: [{ code: 6000, name: "Oops", msg: "oops" }],
};

test("converts to the 0.30+ shape with snake_case names and an address", () => {
  const out = convertLegacyIdl(legacy, "11111111111111111111111111111111");
  assert.equal(out.address, "11111111111111111111111111111111");
  assert.equal(out.metadata.spec, "0.1.0");
  const ix = out.instructions[0];
  assert.deepEqual(ix.accounts, [{ name: "authority", writable: true, signer: true }, { name: "system_program" }]);
  assert.deepEqual(ix.args[0], { name: "campaign_count", type: "u32" });
  const thing = out.types.find((t) => t.name === "Thing");
  assert.deepEqual(thing.type.fields, [
    { name: "owner", type: "pubkey" },
    { name: "sent_at", type: "i64" },
    { name: "kind", type: { defined: { name: "Kind" } } },
  ]);
  assert.ok(out.types.find((t) => t.name === "Done"), "event struct is emitted as a type");
  assert.deepEqual(out.errors, legacy.errors);
});

test("instruction discriminator is sha256('global:initialize')[..8], the well-known Anchor value", () => {
  const out = convertLegacyIdl(legacy, "11111111111111111111111111111111");
  assert.deepEqual(out.instructions[0].discriminator, [175, 175, 109, 31, 13, 152, 155, 237]);
  assert.equal(out.accounts[0].discriminator.length, 8);
});

test("an IDL that already has an address is rejected, not silently re-converted", () => {
  assert.throws(() => convertLegacyIdl({ ...legacy, address: "x" }, "y"), /already has an address/);
});
