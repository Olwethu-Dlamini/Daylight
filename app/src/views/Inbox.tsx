import { useApp } from "../app-context.ts";
import { getCampaign, getOrg, listPayoutsTo, respondReceipt, type DisbursementView } from "../lib/client.ts";
import { useLoad } from "../lib/useLoad.ts";
import { lamportsToSol } from "../lib/scorecard.ts";
import { addressUrl, short } from "../lib/explorer.ts";

export function Inbox() {
  const { program, me, version, run } = useApp();
  const { data, error, loading } = useLoad(async () => {
    if (!me) return [];
    const payouts = await listPayoutsTo(program, me);
    return Promise.all(
      payouts.map(async (d) => {
        const camp = await getCampaign(program, d.campaign);
        const org = camp ? await getOrg(program, camp.org) : null;
        return { d, camp, org };
      }),
    );
  }, [me?.toBase58(), version]);

  if (!me) return <p className="card">Connect the wallet that received a payout.</p>;
  if (error && !data) return <p className="card warn">{error}</p>;
  if (loading && !data) return <p className="muted">Reading the chain…</p>;

  const answer = (d: DisbursementView, orgKey: NonNullable<typeof data>[number]["org"], accepted: boolean) => {
    if (!orgKey) return;
    return run(accepted ? "Confirming receipt" : "Disputing payout", () =>
      respondReceipt(program, me, d, orgKey.address, accepted),
    );
  };

  return (
    <>
      <h1>Payouts to you</h1>
      <p className="lede">
        Confirm only if the money or goods really reached you. Your answer is public, permanent, and
        counts toward the organisation's score. They cannot answer for you.
      </p>
      {data?.length === 0 && <p className="card">No payouts have been sent to this wallet.</p>}
      {data?.map(({ d, camp, org }) => (
        <div className="card" key={d.address.toBase58()}>
          <div className="row">
            <div>
              <b>{lamportsToSol(d.amount)} SOL</b> from <b>{org?.name ?? "unknown org"}</b>
              <div className="muted">
                {camp?.title} · {new Date(d.sentAt * 1000).toLocaleDateString()} ·{" "}
                <a href={addressUrl(d.address)} target="_blank" rel="noreferrer" className="mono">{short(d.address)}</a>
              </div>
            </div>
            <span className={`pill ${d.status}`}>{d.status === "sent" ? "awaiting your reply" : d.status}</span>
          </div>
          {d.status === "sent" && (
            <div className="row" style={{ justifyContent: "flex-start", marginTop: 12 }}>
              <button className="btn" onClick={() => answer(d, org, true)}>Yes, I received this</button>
              <button className="btn danger" onClick={() => answer(d, org, false)}>No, dispute it</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
