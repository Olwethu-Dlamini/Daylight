export function About() {
  return (
    <>
      <h1>How Daylight works</h1>
      <p className="lede">
        Every aid system has the same weak point: the payer is the only author of the story. The org
        says "we delivered", and nobody else gets a signature. Daylight adds the other signature.
      </p>

      <h2>Three people, three signatures</h2>
      <div className="card">
        <ol>
          <li><b>Donors</b> send SOL into a campaign's vault. The program holds it; the org cannot touch it except to pay out.</li>
          <li><b>The organisation</b> pays a guardian, school or vendor from the vault, attaching the hash of its receipt.</li>
          <li><b>The recipient</b> confirms or disputes that payout. Only their wallet can. This is the only way the org's score changes.</li>
        </ol>
      </div>

      <h2>Verify it yourself</h2>
      <div className="card">
        <p>
          This page is a convenience, not the source of truth. From the repo, run{" "}
          <span className="mono">npm run verify -- &lt;rpc-url&gt; &lt;org-wallet&gt;</span> to recompute any
          organisation's score straight from the raw on-chain accounts, with no help from this website,
          and cross-check it against the counters the org account claims.
        </p>
      </div>

      <h2>Privacy</h2>
      <div className="card">
        <p>
          No child's name, photo or age is ever on-chain. Recipients are guardian, school or vendor
          wallets. Descriptions and proof files stay with the organisation; only their sha256 hashes
          are stored, so they can be proven later without being published.
        </p>
      </div>

      <h2>What this does not do</h2>
      <div className="card">
        <ul>
          <li><b>It cannot tell a real recipient from the org's own second wallet.</b> A dishonest org can pay a wallet it controls and confirm from it. Daylight makes every payout permanent and attributable, so a fake recipient is a public claim someone can challenge. It does not prove identity.</li>
          <li><b>It cannot verify the work.</b> A blockchain does not watch the meal being served. Recipients vouch; the chain keeps their word.</li>
          <li><b>Payout comes first, confirmation after.</b> The org can pay a colluding wallet immediately; the score exposes that over time but does not prevent it.</li>
          <li><b>Reputation can be abandoned.</b> A new org wallet starts clean. Treat a score as strongest when the organisation has a track record.</li>
          <li><b>Devnet only.</b> This is a prototype running on a test network, and the website itself is a hosted frontend. That is why the verify script exists.</li>
          <li><b>Leftovers after a partial payout</b> are refunded pro-rata to donors once the campaign ends or is closed.</li>
        </ul>
      </div>
    </>
  );
}
