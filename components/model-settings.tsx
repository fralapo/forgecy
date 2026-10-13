"use client";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { requestJson } from "./types";
import type { OpenRouterImageModel, OpenRouterModel } from "@/lib/ai-model-settings";

type Preferences = { textModel: string; imageModel: string | null };
type ModelResponse = {
  textModels: OpenRouterModel[];
  imageModels: OpenRouterImageModel[];
  preferences: Preferences;
};

export default function ModelSettings() {
  const [catalog, setCatalog] = useState<ModelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<"text" | "image" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const loadCatalog = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const next = await requestJson<ModelResponse>("/api/workspace/settings/models");
      setCatalog(next);
      setRefreshedAt(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalogo OpenRouter non disponibile");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void loadCatalog(); });
  }, [loadCatalog]);

  async function selectModel(kind: "text" | "image", modelId: string) {
    if (!catalog || saving || !modelId) return;
    const previous = catalog.preferences;
    const optimistic = kind === "text"
      ? { ...previous, textModel: modelId }
      : { ...previous, imageModel: modelId };
    setCatalog({ ...catalog, preferences: optimistic });
    setSaving(kind);
    setError("");
    setSaved("");
    try {
      const result = await requestJson<{ preferences: Preferences }>("/api/workspace/settings/models", {
        method: "PATCH", body: JSON.stringify({ kind, modelId })
      });
      setCatalog(current => current ? { ...current, preferences: result.preferences } : current);
      setSaved(kind === "text" ? "Modello testo salvato" : "Modello immagini salvato");
    } catch (cause) {
      setCatalog(current => current ? { ...current, preferences: previous } : current);
      setError(cause instanceof Error ? cause.message : "Impossibile salvare il modello selezionato");
    } finally { setSaving(null); }
  }

  const textUnavailable = Boolean(catalog?.preferences.textModel &&
    !catalog.textModels.some(model => model.id === catalog.preferences.textModel));
  const imageUnavailable = Boolean(catalog?.preferences.imageModel &&
    !catalog.imageModels.some(model => model.id === catalog.preferences.imageModel));

  return <section className="stack-lg" style={{ maxWidth: 900 }}>
    <div className="page-head">
      <div>
        <div className="eyebrow">FORGECY / ACCOUNT</div>
        <h1 style={{ marginTop: 7 }}>Impostazioni</h1>
        <p className="tagline" style={{ marginTop: 7 }}>Scegli i modelli OpenRouter per il testo e per la generazione delle immagini.</p>
      </div>
      <button className="button" onClick={() => void loadCatalog(true)} disabled={loading || refreshing || Boolean(saving)}>
        {refreshing ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} Aggiorna modelli
      </button>
    </div>

    {error && <div className="notice error" role="alert" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span>{error}</span><button className="button small" onClick={() => void loadCatalog(true)} disabled={refreshing}>Riprova</button>
    </div>}
    {saved && <div className="notice" role="status">{saved}</div>}
    {refreshedAt && <p className="caption">Cataloghi caricati da OpenRouter alle {refreshedAt}. Premi “Aggiorna modelli” per controllare di nuovo.</p>}

    {loading && <div className="empty"><LoaderCircle className="spin" size={18}/> Caricamento dei cataloghi OpenRouter…</div>}
    {!loading && catalog && <div className="grid2">
      <article className="card stack">
        <div className="flex center gap8"><Settings2 size={18}/><h2>Modello testo</h2></div>
        <p className="caption">Usato dal Leader, dagli agenti, dai dossier e dalle strategie. I modelli senza output strutturato restano selezionabili, ma dossier e campagne potrebbero non funzionare.</p>
        <label htmlFor="forgecy-text-model">Modello OpenRouter per il testo</label>
        <select id="forgecy-text-model" value={catalog.preferences.textModel}
          disabled={Boolean(saving)} onChange={event => void selectModel("text", event.target.value)}>
          {textUnavailable && <option value={catalog.preferences.textModel}>
            {catalog.preferences.textModel} · non più disponibile
          </option>}
          {catalog.textModels.map(model => <option key={model.id} value={model.id}>
            {model.name} — {model.id}{model.structuredOutputs ? " · schema strutturato" : " · schema non indicato"}
          </option>)}
        </select>
        <p className="caption">{catalog.textModels.length} modelli testo disponibili. La compatibilità JSON è indicata dal catalogo OpenRouter e può variare per provider.</p>
      </article>

      <article className="card stack">
        <div className="flex center gap8"><Settings2 size={18}/><h2>Modello immagini</h2></div>
        <p className="caption">Usato per creare immagini statiche dei contenuti. La chiave OpenRouter è configurata solo sul server; i modelli sono addebitati dal tuo account OpenRouter.</p>
        <label htmlFor="forgecy-image-model">Modello OpenRouter per le immagini</label>
        <select id="forgecy-image-model" value={catalog.preferences.imageModel || ""}
          disabled={Boolean(saving)} onChange={event => void selectModel("image", event.target.value)}>
          <option value="" disabled>Seleziona un modello immagini</option>
          {imageUnavailable && catalog.preferences.imageModel && <option value={catalog.preferences.imageModel}>
            {catalog.preferences.imageModel} · non più disponibile
          </option>}
          {catalog.imageModels.map(model => <option key={model.id} value={model.id}>{model.name} — {model.id}</option>)}
        </select>
        <p className="caption">{catalog.imageModels.length} modelli di generazione immagini disponibili. Se un modello non supporta il rapporto del contenuto, OpenRouter userà il proprio formato predefinito.</p>
      </article>
    </div>}
    {saving && <p className="caption" role="status"><LoaderCircle className="spin" size={14}/> Salvataggio preferenza…</p>}
    <div className="notice warn">La scelta si sincronizza con il tuo account Supabase sugli altri dispositivi. Ogni installazione Forgecy deve configurare una propria chiave server-only <code>OPENROUTER_API_KEY</code>.</div>
  </section>;
}
