// Solana Playground test file. Paste into tests/ in Playground and press Test.
// Globals provided by Playground: pg, web3, BN, assert, describe, it.
// Every run uses fresh keypairs, so it can be re-run on devnet without clashes.

const enc = (s: string) => Buffer.from(s);
const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const SOL = web3.LAMPORTS_PER_SOL;
const lam = (sol: number) => Math.round(sol * SOL);
const hash32 = (fill: number) => Array(32).fill(fill);

const program = pg.program;
const pid = program.programId;

const pda = (seeds: Buffer[]) => web3.PublicKey.findProgramAddressSync(seeds, pid)[0];
const orgPda = (authority: web3.PublicKey) => pda([enc("org"), authority.toBuffer()]);
const campaignPda = (org: web3.PublicKey, id: number) =>
  pda([enc("campaign"), org.toBuffer(), u32le(id)]);
const vaultPda = (campaign: web3.PublicKey) => pda([enc("vault"), campaign.toBuffer()]);
const donationPda = (campaign: web3.PublicKey, i: number) =>
  pda([enc("donation"), campaign.toBuffer(), u32le(i)]);
const disbPda = (campaign: web3.PublicKey, i: number) =>
  pda([enc("disb"), campaign.toBuffer(), u32le(i)]);

async function fund(to: web3.PublicKey, sol: number) {
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: pg.wallet.publicKey,
      toPubkey: to,
      lamports: lam(sol),
    }),
  );
  await web3.sendAndConfirmTransaction(pg.connection, tx, [pg.wallet.keypair]);
}

// Run a promise that must be rejected; fail the test if it succeeds.
async function expectFail(p: Promise<unknown>, needles: string | string[]) {
  const list = Array.isArray(needles) ? needles : [needles];
  try {
    await p;
  } catch (e: any) {
    const text = `${e?.error?.errorCode?.code ?? ""} ${e?.message ?? ""} ${(e?.logs ?? []).join(" ")}`;
    assert.isTrue(
      list.some((n) => text.includes(n)),
      `expected failure containing one of ${list.join(" | ")} but got: ${text}`,
    );
    return;
  }
  assert.fail(`expected failure containing one of ${list.join(" | ")} but the call succeeded`);
}

describe("daylight", () => {
  const orgKp = web3.Keypair.generate();
  const donor = web3.Keypair.generate();
  const bene = [web3.Keypair.generate(), web3.Keypair.generate(), web3.Keypair.generate()];
  const org = orgPda(orgKp.publicKey);
  const campaign0 = campaignPda(org, 0);
  const vault0 = vaultPda(campaign0);

  const deadline = () => new BN(Math.floor(Date.now() / 1000) + 3600);
  const TEN_MILLI = new BN(lam(0.01));

  const sysProg = web3.SystemProgram.programId;

  it("funds the test wallets", async () => {
    await fund(orgKp.publicKey, 0.1);
    await fund(donor.publicKey, 0.2);
    for (const b of bene) await fund(b.publicKey, 0.001); // fee money only
  });

  it("init_org", async () => {
    await program.methods
      .initOrg("Test Children Fund")
      .accounts({ authority: orgKp.publicKey, org, systemProgram: sysProg })
      .signers([orgKp])
      .rpc();
    const o = await program.account.orgProfile.fetch(org);
    assert.equal(o.name, "Test Children Fund");
    assert.equal(o.disbursedCount, 0);
    assert.equal(o.confirmedCount, 0);
  });

  it("init_org rejects an empty name", async () => {
    const other = web3.Keypair.generate();
    await fund(other.publicKey, 0.01);
    await expectFail(
      program.methods
        .initOrg("")
        .accounts({ authority: other.publicKey, org: orgPda(other.publicKey), systemProgram: sysProg })
        .signers([other])
        .rpc(),
      "NameLength",
    );
  });

  it("create_campaign pre-funds the vault with the rent-exempt minimum", async () => {
    await program.methods
      .createCampaign("Term 2 school fees", { education: {} }, hash32(7), new BN(lam(0.1)), deadline())
      .accounts({
        authority: orgKp.publicKey,
        org,
        campaign: campaign0,
        vault: vault0,
        systemProgram: sysProg,
      })
      .signers([orgKp])
      .rpc();
    const c = await program.account.campaign.fetch(campaign0);
    assert.equal(c.id, 0);
    assert.equal(c.raised.toNumber(), 0);
    assert.isDefined(c.status.open);
    const rentMin = await pg.connection.getMinimumBalanceForRentExemption(0);
    assert.equal(await pg.connection.getBalance(vault0), rentMin);
  });

  it("donate moves SOL into the vault and writes a receipt", async () => {
    const before = await pg.connection.getBalance(vault0);
    await program.methods
      .donate(new BN(lam(0.05)))
      .accounts({
        donor: donor.publicKey,
        campaign: campaign0,
        vault: vault0,
        donation: donationPda(campaign0, 0),
        systemProgram: sysProg,
      })
      .signers([donor])
      .rpc();
    assert.equal((await pg.connection.getBalance(vault0)) - before, lam(0.05));
    const c = await program.account.campaign.fetch(campaign0);
    assert.equal(c.raised.toNumber(), lam(0.05));
    const d = await program.account.donation.fetch(donationPda(campaign0, 0));
    assert.equal(d.donor.toBase58(), donor.publicKey.toBase58());
    assert.equal(d.amount.toNumber(), lam(0.05));
    assert.isFalse(d.refunded);
  });

  it("donate rejects zero", async () => {
    await expectFail(
      program.methods
        .donate(new BN(0))
        .accounts({
          donor: donor.publicKey,
          campaign: campaign0,
          vault: vault0,
          donation: donationPda(campaign0, 1),
          systemProgram: sysProg,
        })
        .signers([donor])
        .rpc(),
      "ZeroAmount",
    );
  });

  const disburseTo = (i: number, amount: BN, signer = orgKp, benef = bene[i].publicKey) =>
    program.methods
      .disburse(amount, hash32(i + 1))
      .accounts({
        authority: signer.publicKey,
        org,
        campaign: campaign0,
        vault: vault0,
        beneficiary: benef,
        disbursement: disbPda(campaign0, i),
        systemProgram: sysProg,
      })
      .signers([signer])
      .rpc();

  it("disburse pays three beneficiaries and updates the org's counters", async () => {
    for (let i = 0; i < 3; i++) await disburseTo(i, TEN_MILLI);

    for (let i = 0; i < 3; i++) {
      assert.isAtLeast(await pg.connection.getBalance(bene[i].publicKey), lam(0.01));
      const d = await program.account.disbursement.fetch(disbPda(campaign0, i));
      assert.equal(d.beneficiary.toBase58(), bene[i].publicKey.toBase58());
      assert.isDefined(d.status.sent);
    }
    const o = await program.account.orgProfile.fetch(org);
    assert.equal(o.disbursedCount, 3);
    assert.equal(o.disbursedTotal.toNumber(), lam(0.03));
    assert.equal(o.confirmedCount, 0);
    const c = await program.account.campaign.fetch(campaign0);
    assert.equal(c.disbursed.toNumber(), lam(0.03));
    assert.equal(c.disbursementCount, 3);
  });

  it("disburse cannot overspend the unspent balance", async () => {
    await expectFail(disburseTo(3, new BN(lam(0.03)), orgKp, web3.Keypair.generate().publicKey), "InsufficientFunds");
  });

  it("disburse cannot pay the org authority itself", async () => {
    await expectFail(disburseTo(3, TEN_MILLI, orgKp, orgKp.publicKey), "BeneficiaryIsAuthority");
  });

  it("only the org's authority can disburse", async () => {
    await expectFail(disburseTo(3, TEN_MILLI, donor, bene[0].publicKey), ["ConstraintHasOne", "ConstraintSeeds"]);
  });

  const respond = (i: number, signer: web3.Keypair, accepted: boolean) =>
    program.methods
      .respondReceipt(accepted)
      .accounts({
        beneficiary: signer.publicKey,
        org,
        campaign: campaign0,
        disbursement: disbPda(campaign0, i),
      })
      .signers([signer])
      .rpc();

  it("the org cannot answer for a beneficiary", async () => {
    await expectFail(respond(0, orgKp, true), "ConstraintHasOne");
  });

  it("a different beneficiary cannot answer for someone else's payout", async () => {
    await expectFail(respond(0, bene[1], true), "ConstraintHasOne");
  });

  it("two confirm and one disputes: the score is 2 of 3 with 1 disputed", async () => {
    await respond(0, bene[0], true);
    await respond(1, bene[1], true);
    await respond(2, bene[2], false);

    const o = await program.account.orgProfile.fetch(org);
    assert.equal(o.confirmedCount, 2);
    assert.equal(o.disputedCount, 1);
    assert.equal(o.confirmedTotal.toNumber(), lam(0.02));
    assert.equal(o.disbursedCount, 3);

    assert.isDefined((await program.account.disbursement.fetch(disbPda(campaign0, 0))).status.confirmed);
    assert.isDefined((await program.account.disbursement.fetch(disbPda(campaign0, 2))).status.disputed);
  });

  it("a payout can only be answered once", async () => {
    await expectFail(respond(0, bene[0], false), "AlreadyResponded");
    const o = await program.account.orgProfile.fetch(org);
    assert.equal(o.confirmedCount, 2);
    assert.equal(o.disputedCount, 1);
  });

  it("refund is refused once money has left the campaign", async () => {
    await program.methods
      .closeCampaign()
      .accounts({ authority: orgKp.publicKey, org, campaign: campaign0 })
      .signers([orgKp])
      .rpc();
    await expectFail(
      program.methods
        .refund()
        .accounts({
          donor: donor.publicKey,
          campaign: campaign0,
          vault: vault0,
          donation: donationPda(campaign0, 0),
          systemProgram: sysProg,
        })
        .signers([donor])
        .rpc(),
      "RefundNotAvailable",
    );
  });

  it("donate and disburse are refused on a closed campaign", async () => {
    await expectFail(
      program.methods
        .donate(new BN(lam(0.01)))
        .accounts({
          donor: donor.publicKey,
          campaign: campaign0,
          vault: vault0,
          donation: donationPda(campaign0, 1),
          systemProgram: sysProg,
        })
        .signers([donor])
        .rpc(),
      "CampaignClosed",
    );
    await expectFail(disburseTo(3, TEN_MILLI, orgKp, web3.Keypair.generate().publicKey), "CampaignClosed");
  });

  describe("refund on an untouched campaign", () => {
    const campaign1 = campaignPda(org, 1);
    const vault1 = vaultPda(campaign1);
    const refund = () =>
      program.methods
        .refund()
        .accounts({
          donor: donor.publicKey,
          campaign: campaign1,
          vault: vault1,
          donation: donationPda(campaign1, 0),
          systemProgram: sysProg,
        })
        .signers([donor])
        .rpc();

    it("is refused while the campaign is open and unexpired", async () => {
      await program.methods
        .createCampaign("Weekly meals", { food: {} }, hash32(9), new BN(lam(0.1)), deadline())
        .accounts({ authority: orgKp.publicKey, org, campaign: campaign1, vault: vault1, systemProgram: sysProg })
        .signers([orgKp])
        .rpc();
      await program.methods
        .donate(new BN(lam(0.02)))
        .accounts({
          donor: donor.publicKey,
          campaign: campaign1,
          vault: vault1,
          donation: donationPda(campaign1, 0),
          systemProgram: sysProg,
        })
        .signers([donor])
        .rpc();
      await expectFail(refund(), "RefundNotAvailable");
    });

    it("returns the full donation once the org closes the campaign, and only once", async () => {
      await program.methods
        .closeCampaign()
        .accounts({ authority: orgKp.publicKey, org, campaign: campaign1 })
        .signers([orgKp])
        .rpc();
      const before = await pg.connection.getBalance(donor.publicKey);
      await refund();
      const after = await pg.connection.getBalance(donor.publicKey);
      // the donor paid a tx fee, so allow a small margin below the full amount
      assert.isAtLeast(after - before, lam(0.02) - 20_000);
      const c = await program.account.campaign.fetch(campaign1);
      assert.equal(c.refunded.toNumber(), lam(0.02));
      await expectFail(refund(), "AlreadyRefunded");
    });
  });
});
