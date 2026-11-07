import { useCallback, useEffect, useMemo, useState } from "react";
import { Ctx, type AppCtx } from "./app-context.ts";
import { IDL, RPC_URL, explainError, getProgram } from "./lib/client.ts";
import { connectWallet, disconnectWallet, hasWallet, subscribeWallet, type AnchorWallet } from "./lib/wallet.ts";
import { txUrl, short } from "./lib/explorer.ts";
import { Explore } from "./views/Explore.tsx";
import { OrgPage } from "./views/OrgPage.tsx";
import { Dashboard } from "./views/Dashboard.tsx";
import { Inbox } from "./views/Inbox.tsx";
import { About } from "./views/About.tsx";

type Toast = { text: string; sig?: string } | null;

const TABS: { hash: string; label: string }[] = [
  { hash: "#/", label: "Explore" },
  { hash: "#/org", label: "Org" },
  { hash: "#/inbox", label: "My payouts" },
  { hash: "#/about", label: "How it works" },
];

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  const [wallet, setWallet] = useState<AnchorWallet | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  // Reconnect silently if the wallet already trusts this site.
  useEffect(() => {
    connectWallet({ silent: true }).then(setWallet).catch(() => undefined);
  }, []);

  useEffect(() => subscribeWallet(setWallet), []);

  const go = useCallback((h: string) => {
    window.location.hash = h;
  }, []);

  const program = useMemo(() => (IDL ? getProgram(wallet) : null), [wallet]);

  const run = useCallback<AppCtx["run"]>(async (label, send) => {
    setToast({ text: `${label}: approve in your wallet…` });
    try {
      const sig = await send();
      setToast({ text: `${label}: done`, sig });
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setToast({ text: `${label} failed: ${explainError(e)}` });
      return false;
    }
  }, []);

  useEffect(() => {
    if (!toast || toast.text.includes("approve in your wallet")) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!IDL || !program) {
    return (
      <div className="wrap">
        <h1>Daylight needs its program IDL</h1>
        <p className="card">
          Build the program in Solana Playground, export the IDL, and save it as{" "}
          <span className="mono">app/src/idl/daylight.json</span>. See docs/PLAYGROUND.md.
        </p>
      </div>
    );
  }

  const ctx: AppCtx = { me: wallet?.publicKey ?? null, program, run, version, go };
  const orgMatch = /^#\/org\/(\w+)/.exec(hash);
  const tab = hash.startsWith("#/org") ? "#/org" : hash.startsWith("#/inbox") ? "#/inbox" : hash.startsWith("#/about") ? "#/about" : "#/";

  let view;
  if (orgMatch) view = <OrgPage key={orgMatch[1]} address={orgMatch[1]} />;
  else if (tab === "#/org") view = <Dashboard />;
  else if (tab === "#/inbox") view = <Inbox />;
  else if (tab === "#/about") view = <About />;
  else view = <Explore />;

  return (
    <Ctx.Provider value={ctx}>
      <div className="wrap">
        <header className="top">
          <span className="brand" onClick={() => go("#/")}>Day<span>light</span></span>
          <nav>
            {TABS.map((t) => (
              <button key={t.hash} className={tab === t.hash ? "on" : ""} onClick={() => go(t.hash)}>{t.label}</button>
            ))}
          </nav>
          {wallet ? (
            <button className="btn ghost" onClick={() => { disconnectWallet(); setWallet(null); }}>
              {short(wallet.publicKey)} · disconnect
            </button>
          ) : (
            <button
              className="btn"
              onClick={async () => {
                if (!hasWallet()) return setToast({ text: "No Solana wallet found. Install Phantom and switch it to devnet." });
                try { setWallet(await connectWallet()); } catch (e) { setToast({ text: explainError(e) }); }
              }}
            >
              Connect wallet
            </button>
          )}
        </header>
        {view}
        <p className="muted" style={{ marginTop: 40 }}>Devnet prototype · RPC {new URL(RPC_URL).host}</p>
        {toast && (
          <div className="toast" role="status">
            {toast.text}{" "}
            {toast.sig && <a href={txUrl(toast.sig)} target="_blank" rel="noreferrer">view transaction</a>}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
