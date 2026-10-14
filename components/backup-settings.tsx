"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FolderSync, LoaderCircle, Upload } from "lucide-react";
import { requestJson } from "./types";

type BackupSettings = { directory: string; intervalHours: number; retention: number };
type LocalBackup = { id: string; createdAt: string; size: number; hashPrefix: string };

export default function BackupSettings() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [draft, setDraft] = useState<BackupSettings | null>(null);
  const [backups, setBackups] = useState<LocalBackup[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [config, backupList] = await Promise.all([
        requestJson<{ settings: BackupSettings }>("/api/sync/backups/settings"),
        requestJson<{ backups: LocalBackup[] }>("/api/sync/backups"),
      ]);
      setSettings(config.settings);
      setDraft(config.settings);
      setBackups(backupList.backups);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile leggere le impostazioni di backup"); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  async function saveSettings() {
    if (!draft) return;
    setBusy("Verifica cartella…"); setError(""); setMessage("");
    try {
      const result = await requestJson<{ settings: BackupSettings }>("/api/sync/backups/settings", { method: "POST", body: JSON.stringify(draft) });
      setSettings(result.settings); setDraft(result.settings);
      await loadBackups();
      setMessage("Impostazioni salvate. I prossimi backup resteranno sul computer che esegue Forgecy.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile salvare le impostazioni"); }
    finally { setBusy(""); }
  }

  const loadBackups = async () => {
    try { setBackups((await requestJson<{ backups: LocalBackup[] }>("/api/sync/backups")).backups); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile leggere i backup"); }
  };

  async function createBackup() {
    setBusy("Creazione backup…"); setError(""); setMessage("");
    try {
      await requestJson<{ backup: LocalBackup }>("/api/sync/backups", { method: "POST" });
      await loadBackups(); setMessage("Backup creato nella cartella locale privata di Forgecy.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Creazione backup non riuscita"); }
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
      setMessage(result.message);
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Importazione non riuscita"); }
    finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }

  const dirty = Boolean(settings && draft && (settings.directory !== draft.directory || settings.intervalHours !== draft.intervalHours || settings.retention !== draft.retention));

  return <article className="card stack">
    <div className="flex center gap8"><FolderSync size={18}/><h2>Backup e trasferimento</h2></div>
    <p className="caption">Forgecy salva copie complete e verificabili nella cartella locale privata dell’app su questo computer. Per trasferirle su un altro dispositivo o su Google Drive, scarica o esporta un archivio e copialo manualmente.</p>
    <section className="stack" aria-labelledby="automatic-backups-title">
      <h3 id="automatic-backups-title">Backup automatici</h3>
      {draft && <>
        <p className="caption">Destinazione: cartella dati locale e privata di Forgecy su questo computer. Google Drive non viene contattato né sincronizzato automaticamente.</p>
        <div className="flex gap8" style={{ flexWrap: "wrap" }}>
          <label className="stack">Crea una copia ogni
            <select value={draft.intervalHours} onChange={event => setDraft({ ...draft, intervalHours: Number(event.target.value) })}>
              <option value={4}>4 ore</option><option value={8}>8 ore</option><option value={12}>12 ore</option><option value={24}>Ogni giorno</option><option value={72}>Ogni 3 giorni</option><option value={168}>Ogni settimana</option>
            </select>
          </label>
          <label className="stack">Conserva le ultime
            <select value={draft.retention} onChange={event => setDraft({ ...draft, retention: Number(event.target.value) })}>
              <option value={3}>3 copie</option><option value={7}>7 copie</option><option value={14}>14 copie</option><option value={30}>30 copie</option>
            </select>
          </label>
        </div>
        <div className="flex gap8" style={{ flexWrap: "wrap" }}>
          <button className="button primary" onClick={() => void saveSettings()} disabled={Boolean(busy) || !dirty}>Salva frequenza</button>
          <button className="button" onClick={() => void createBackup()} disabled={Boolean(busy)}>Crea backup ora</button>
        </div>
      </>}
      {backups.length ? <ul className="stack" style={{ paddingLeft: 20, margin: 0 }}>
        {backups.map(backup => <li key={backup.id} className="caption">{new Date(backup.createdAt).toLocaleString("it-IT")} · {(backup.size / 1024 / 1024).toFixed(1)} MB · <a href={`/api/sync/backups/${encodeURIComponent(backup.id)}`}>Scarica</a></li>)}
      </ul> : <p className="caption">Il primo backup verrà creato all’avvio di Forgecy.</p>}
      <p className="caption">I backup contengono database e documenti dei clienti. Le copie automatiche restano sul computer: per una copia su Google Drive, scarica il file e trasferiscilo manualmente.</p>
    </section>
    <section className="stack" aria-labelledby="workspace-transfer-title">
      <h3 id="workspace-transfer-title">Trasferisci il workspace</h3>
      <p className="caption">Esporta un archivio, trasferisci il file all’altro computer con il metodo che preferisci e importalo in Forgecy.</p>
      <div className="flex gap8" style={{ flexWrap: "wrap" }}>
        <a className="button" href="/api/sync/export"><Download size={15}/> Esporta archivio</a>
        <button className="button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}><Upload size={15}/> Importa archivio</button>
        <input ref={fileInput} type="file" accept=".zip,.forgecy.zip,application/zip" hidden onChange={event => void importArchive(event.target.files?.[0])}/>
      </div>
    </section>
    {error && <div className="notice error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {busy && <p className="caption" role="status"><LoaderCircle className="spin" size={14}/> {busy}</p>}
  </article>;
}
