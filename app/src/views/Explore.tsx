import { useApp } from "../app-context.ts";
import { listOrgs } from "../lib/client.ts";
import { useLoad } from "../lib/useLoad.ts";
import { percent } from "../lib/scorecard.ts";
import { short } from "../lib/explorer.ts";

export function Explore() {
  const { program, version, go } = useApp();
  const { data, error, loading } = useLoad(() => listOrgs(program), [version]);

  return (
    <>
      <h1>Every donation, in plain sight.</h1>
      <p className="lede">
        Charities here are graded by the people they pay, not by themselves. A payout only counts
        as delivered when the recipient confirms it on-chain.
      </p>
      {error && <p className="card warn">{error}</p>}
      {loading && !data && <p className="muted">Reading the chain…</p>}
      {data && data.length === 0 && <p className="card">No organisations yet. Create the first one from the Org tab.</p>}
      <div className="grid">
        {data?.map((o) => {
          const c = o.counters;
          const rate = c.disbursedCount === 0 ? null : c.confirmedCount / c.disbursedCount;
          return (
            <div key={o.address.toBase58()} className="card" style={{ cursor: "pointer" }} onClick={() => go(`#/org/${o.address.toBase58()}`)}>
              <b>{o.name}</b>
              <div className="score">
                <span className="big">{percent(rate)}</span>
                <span className="muted">confirmed</span>
              </div>
              <span className="muted">
                {c.confirmedCount} confirmed · {c.disputedCount} disputed · {c.disbursedCount} paid out
                <br />
                <span className="mono">{short(o.authority)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
