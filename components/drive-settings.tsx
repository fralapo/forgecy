"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Cloud, Download, LoaderCircle, RefreshCw, Upload, Unplug } from "lucide-react";
import { requestJson } from "./types";

type Status = { configured: boolean; connected: boolean; folderId: string | null; lastSyncedAt: string | null; hasPreviousSync: boolean };
type Branch = { id: string; name: string; hash: string; parentHash: string };
type SyncResult = { status: string; message: string; branches?: Branch[] };

export default function DriveSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try { setStatus(await requestJson<Status>("/api/sync/google")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile leggere lo stato Drive"); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void loadStatus(); }); }, [loadStatus]);

  async function connect() {
    const popup = window.open("about:blank", "forgecy-google-drive", "popup,width=620,height=760");
    setBusy("Collegamento Google Drive…"); setError(""); setMessage("");
    try {
      const flow = await requestJson<{ flowId: string; authorizationUrl: string }>("/api/sync/google/connect", { method: "POST" });
      if (popup) popup.location.href = flow.authorizationUrl;
      else window.location.href = flow.authorizationUrl;
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const result = await requestJson<{ status: string; message?: string }>(`/api/sync/google/flows/${flow.flowId}`);
        if (result.status === "connected") { popup?.close(); setMessage("Google Drive collegato."); await loadStatus(); return; }
        if (result.status === "error" || result.status === "expired") throw new Error(result.message || "Collegamento scaduto o annullato");
      }
      throw new Error("Collegamento scaduto. Riprova.");
    } catch (cause) { popup?.close(); setError(cause instanceof Error ? cause.message : "Collegamento non riuscito"); }
    finally { setBusy(""); }
  }

  async function synchronize() {
    setBusy("Sincronizzazione…"); setError(""); setMessage(""); setBranches([]);
    try {
      const result = await requestJson<SyncResult>("/api/sync/google/sync", { method: "POST" });
      setMessage(result.message);
      setBranches(result.branches || []);
      await loadStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sincronizzazione non riuscita"); }
    finally { setBusy(""); }
  }

  async function resolve(choice: "local" | "remote", remoteFileId?: string) {
    const prompt = choice === "remote"
      ? "Aprire questa copia di Drive? La versione locale corrente verrà conservata come archivio di conflitto."
      : "Salvare la copia locale come nuovo ramo su Drive? Le altre copie resteranno disponibili.";
    if (!window.confirm(prompt)) return;
    setBusy("Risoluzione conflitto…"); setError("");
    try {
      const result = await requestJson<SyncResult>("/api/sync/google/resolve", { method: "POST", body: JSON.stringify({ choice, ...(remoteFileId ? { remoteFileId } : {}) }) });
      setMessage(result.message); setBranches([]); await loadStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Risoluzione non riuscita"); }
    finally { setBusy(""); }
  }

  async function disconnect() {
    if (!window.confirm("Scollegare Google Drive da questo computer? Gli snapshot già salvati su Drive restano disponibili.")) return;
    setBusy("Disconnessione…"); setError("");
    try { await requestJson("/api/sync/google/disconnect", { method: "POST" }); setMessage("Google Drive scollegato da questo computer."); setBranches([]); await loadStatus(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Disconnessione non riuscita"); }
    finally { setBusy(""); }
  }

  async function importArchive(file?: File) {
    if (!file) return;
    if (!window.confirm("Importare questo workspace? Forgecy convalida prima l'archivio e conserva una copia locale del workspace attuale.")) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setBusy("Convalida e importazione…"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/sync/import", { method: "POST", headers: { "Content-Type": "application/zip" }, body: file, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Importazione non riuscita");
      setMessage(result.message); setBranches([]);
      // Reload the page to release any UI state tied to the previous workspace.
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Importazione non riuscita"); }
    finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }

  return <article className="card stack">
    <div className="flex center gap8"><Cloud size={18}/><h2>Workspace e Google Drive</h2></div>
    <p className="caption">I dati di lavoro restano sul computer. Drive conserva snapshot versionati; Forgecy non apre né sincronizza il database SQLite mentre è in uso.</p>
    {status && <div className="caption" role="status">{status.connected ? "Drive collegato su questo computer" : "Drive non collegato"}{status.lastSyncedAt ? ` · ultima sincronizzazione ${new Date(status.lastSyncedAt).toLocaleString("it-IT")}` : ""}</div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {!status?.configured && <div className="notice warn">Per collegare Drive, crea un OAuth Client ID di tipo applicazione desktop nella Google Cloud Console, abilita Google Drive API e aggiungi <code>GOOGLE_DRIVE_CLIENT_ID</code> al file <code>.env.local</code>. I passaggi sono nella <a href="https://github.com/fralapo/forgecy/blob/main/docs/LOCAL_SETUP.md" target="_blank" rel="noreferrer">guida di configurazione</a>.</div>}
    <div className="flex gap8" style={{ flexWrap: "wrap" }}>
      {!status?.connected
        ? <button className="button primary" onClick={() => void connect()} disabled={Boolean(busy) || !status?.configured}><Cloud size={15}/> Collega Google Drive</button>
        : <>
          <button className="button primary" onClick={() => void synchronize()} disabled={Boolean(busy)}><RefreshCw size={15}/> Sincronizza adesso</button>
          <button className="button" onClick={() => void disconnect()} disabled={Boolean(busy)}><Unplug size={15}/> Scollega</button>
        </>}
      <a className="button" href="/api/sync/export"><Download size={15}/> Esporta archivio</a>
      <button className="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}><Upload size={15}/> Importa archivio</button>
      <input ref={fileInput} type="file" accept=".zip,.forgecy.zip,application/zip" hidden onChange={event => void importArchive(event.target.files?.[0])}/>
    </div>
    {busy && <p className="caption" role="status"><LoaderCircle className="spin" size={14}/> {busy}</p>}
    {branches.length > 0 && <div className="stack">
      <div className="notice warn">Forgecy ha rilevato modifiche indipendenti. Scegli quale ramo aprire oppure salva il locale come ramo separato. Le altre copie restano su Drive.</div>
      {branches.map(branch => <div key={branch.id} className="flex center gap8" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className="caption"><strong>{branch.name}</strong><br/>Hash <code>{branch.hash.slice(0, 12)}</code></span>
        <button className="button small" onClick={() => void resolve("remote", branch.id)} disabled={Boolean(busy)}><Check size={14}/> Apri questa copia</button>
      </div>)}
      <button className="button" onClick={() => void resolve("local")} disabled={Boolean(busy)}>Conserva il locale come ramo separato</button>
    </div>}
    <p className="caption">La sincronizzazione è manuale. Usa un solo computer alla volta e sincronizza prima di passare a un altro; se due copie divergono, Forgecy conserva i rami e ti chiede come risolverli.</p>
  </article>;
}
