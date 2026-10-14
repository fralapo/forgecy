"use client";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Search, Settings2 } from "lucide-react";
import { requestJson } from "./types";
import type { OpenRouterImageModel, OpenRouterModel } from "@/lib/ai-model-settings";
import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "@/lib/ai-model-defaults";
import DriveSettings from "./drive-settings";

type Preferences = { textModel: string; imageModel: string | null };
type KeyStatus = { configured: boolean; source: "app" | "environment" | null };
type ModelResponse = {
  textModels: OpenRouterModel[];
  imageModels: OpenRouterImageModel[];
  preferences: Preferences;
};

type SelectableModel = OpenRouterModel | OpenRouterImageModel;

const PROVIDER_NAMES: Record<string, string> = {
  "amazon": "Amazon", "anthropic": "Anthropic", "black-forest-labs": "Black Forest Labs",
  "bytedance": "ByteDance", "bytedance-seed": "ByteDance Seed", "deepseek": "DeepSeek", "google": "Google",
  "meta-llama": "Meta", "microsoft": "Microsoft", "mistralai": "Mistral AI",
  "moonshotai": "Moonshot AI", "openai": "OpenAI", "qwen": "Qwen", "x-ai": "xAI",
  "z-ai": "Z.ai"
};

function providerFor(modelId: string) {
  const slug = modelId.replace(/^~/, "").split("/")[0]?.toLowerCase() || "other";
  return PROVIDER_NAMES[slug] || slug.split(/[-_]/).map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join(" ");
}

function ModelSelector({
  kind, label, selectedId, models, unavailable, recommendedId, disabled, onChange
}: {
  kind: "text" | "image";
  label: string;
  selectedId: string;
  models: SelectableModel[];
  unavailable: boolean;
  recommendedId: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState(() => selectedId ? providerFor(selectedId) : "");
  const providers = [...new Set(models.map(model => providerFor(model.id)))].sort((a, b) => a.localeCompare(b, "it"));
  const normalizedQuery = query.trim().toLocaleLowerCase("it");
  const filtered = models.filter(model => {
    const matchesProvider = !provider || providerFor(model.id) === provider;
    const matchesQuery = !normalizedQuery || `${model.name} ${model.id} ${providerFor(model.id)} ${model.description}`
      .toLocaleLowerCase("it").includes(normalizedQuery);
    return matchesProvider && matchesQuery;
  });
  const groups = new Map<string, SelectableModel[]>();
  for (const model of filtered) {
    const name = providerFor(model.id);
    groups.set(name, [...(groups.get(name) || []), model]);
  }
  const selected = models.find(model => model.id === selectedId);
  const selectedProvider = selected ? providerFor(selected.id) : "";
  const selectedOutsideFilters = Boolean(selectedId && !filtered.some(model => model.id === selectedId));

  return <div className="model-picker stack">
    <div className="model-picker-tools">
      <div>
        <label className="model-search-label" htmlFor={`forgecy-${kind}-model-search`}><Search size={14}/> Cerca tra {models.length} modelli</label>
        <input id={`forgecy-${kind}-model-search`} type="search" value={query}
          onChange={event => setQuery(event.target.value)} placeholder="Nome, produttore o ID…" />
      </div>
      <div>
        <label className="model-provider-label" htmlFor={`forgecy-${kind}-provider`}>Produttore</label>
        <select id={`forgecy-${kind}-provider`} value={provider} onChange={event => setProvider(event.target.value)}>
          <option value="">Tutti i produttori ({models.length})</option>
          {providers.map(name => <option key={name} value={name}>{name} ({models.filter(model => providerFor(model.id) === name).length})</option>)}
        </select>
      </div>
    </div>
    <label htmlFor={`forgecy-${kind}-model`}>{label}</label>
    <select id={`forgecy-${kind}-model`} value={selectedId} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {(unavailable || selectedOutsideFilters) && <option value={selectedId}>
        {selected?.name || selectedId} · {unavailable ? "non più disponibile" : "selezionato, fuori dai filtri"}
      </option>}
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "it")).map(([name, rows]) =>
        <optgroup key={name} label={`${name} · ${rows.length}`}>
          {rows.sort((a, b) => a.name.localeCompare(b.name, "it")).map(model => <option key={model.id} value={model.id}>
            {model.name} — {model.id}{"structuredOutputs" in model ? model.structuredOutputs ? " · JSON strutturato" : " · JSON non indicato" : ""}
          </option>)}
        </optgroup>
      )}
    </select>
    <div className="model-selection-summary">
      <div className="flex between center gap8 wrap">
        <span className="pill muted">{selectedProvider || "Modello selezionato"}</span>
        {selectedId === recommendedId && <span className="pill">Predefinito consigliato</span>}
        <span className="caption">{filtered.length} risultati</span>
      </div>
      <strong>{selected?.name || selectedId}</strong>
      <code>{selectedId}</code>
      {selected?.description && <p className="caption model-description">{selected.description}</p>}
    </div>
  </div>;
}

export default function ModelSettings() {
  const [catalog, setCatalog] = useState<ModelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<"text" | "image" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

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
    let active = true;
    void (async () => {
      try {
        const result = await requestJson<{ key: KeyStatus }>("/api/workspace/settings/openrouter-key");
        if (!active) return;
        setKeyStatus(result.key);
        if (result.key.configured) await loadCatalog();
        else setLoading(false);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Impossibile controllare la configurazione OpenRouter");
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadCatalog]);

  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingKey || !apiKey.trim()) return;
    setSavingKey(true); setError(""); setSaved("");
    try {
      const result = await requestJson<{ key: KeyStatus; message: string }>("/api/workspace/settings/openrouter-key", {
        method: "PATCH", body: JSON.stringify({ apiKey: apiKey.trim() })
      });
      setKeyStatus(result.key); setApiKey(""); setSaved(result.message);
      await loadCatalog(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile salvare la chiave OpenRouter");
    } finally { setSavingKey(false); }
  }

  async function removeKey() {
    if (savingKey) return;
    setSavingKey(true); setError(""); setSaved("");
    try {
      const result = await requestJson<{ key: KeyStatus; message: string }>("/api/workspace/settings/openrouter-key", { method: "DELETE" });
      setKeyStatus(result.key); setSaved(result.message);
      if (result.key.configured) await loadCatalog(true);
      else { setCatalog(null); setLoading(false); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile rimuovere la chiave OpenRouter");
    } finally { setSavingKey(false); }
  }

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
  const imageUnavailable = Boolean(catalog &&
    !catalog.imageModels.some(model => model.id === (catalog.preferences.imageModel || DEFAULT_IMAGE_MODEL)));

  return <section className="stack-lg" style={{ maxWidth: 900 }}>
    <div className="page-head">
      <div>
        <div className="eyebrow">FORGECY / WORKSPACE LOCALE</div>
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

    <article className="card stack">
      <h2>Chiave API OpenRouter</h2>
      <p className="caption">Inserisci qui la tua chiave personale. Forgecy la verifica e la conserva sul computer nel portachiavi di sistema; se non disponibile, usa un file accessibile solo al tuo utente. La chiave non viene mostrata di nuovo né sincronizzata su Drive.</p>
      {keyStatus?.configured && <p className="caption" role="status">Chiave configurata{keyStatus.source === "environment" ? " nel file .env.local" : " nell'app"}.</p>}
      <form className="stack" onSubmit={event => void saveKey(event)}>
        <label htmlFor="forgecy-openrouter-key">{keyStatus?.configured ? "Sostituisci chiave" : "La tua chiave OpenRouter"}</label>
        <input id="forgecy-openrouter-key" type="password" autoComplete="new-password" value={apiKey}
          onChange={event => setApiKey(event.target.value)} placeholder="Incolla la tua chiave personale" minLength={20} maxLength={512} required />
        <div className="flex gap8 wrap">
          <button className="button primary" type="submit" disabled={savingKey || apiKey.trim().length < 20}>
            {savingKey ? <LoaderCircle className="spin" size={15}/> : <Settings2 size={15}/>} Verifica e salva chiave
          </button>
          {keyStatus?.source === "app" && <button className="button" type="button" onClick={() => void removeKey()} disabled={savingKey}>Rimuovi chiave salvata</button>}
        </div>
      </form>
    </article>

    {loading && <div className="empty"><LoaderCircle className="spin" size={18}/> Caricamento dei cataloghi OpenRouter…</div>}
    {!loading && !keyStatus?.configured && <div className="notice warn">Inserisci e verifica una chiave OpenRouter per caricare i modelli testo e immagini. Puoi farlo anche prima di creare un cliente.</div>}
    {!loading && catalog && <div className="grid2">
      <article className="card stack">
        <div className="flex center gap8"><Settings2 size={18}/><h2>Modello testo</h2></div>
        <p className="caption">Usato dal Leader, dagli agenti, dai dossier e dalle strategie. I modelli senza output strutturato restano selezionabili, ma dossier e campagne potrebbero non funzionare.</p>
        <ModelSelector kind="text" label="Modello OpenRouter per il testo" selectedId={catalog.preferences.textModel}
          models={catalog.textModels} unavailable={textUnavailable} recommendedId={DEFAULT_TEXT_MODEL}
          disabled={Boolean(saving)} onChange={id => void selectModel("text", id)} />
        <p className="caption">{catalog.textModels.length} modelli testo dal catalogo OpenRouter. I gruppi seguono il produttore e la ricerca filtra nome, ID e descrizione. La compatibilità JSON è indicata dal catalogo e può variare per provider.</p>
      </article>

      <article className="card stack">
        <div className="flex center gap8"><Settings2 size={18}/><h2>Modello immagini</h2></div>
        <p className="caption">Usato per creare immagini statiche dei contenuti. La chiave OpenRouter è configurata solo sul server; i modelli sono addebitati dal tuo account OpenRouter.</p>
        <ModelSelector kind="image" label="Modello OpenRouter per le immagini" selectedId={catalog.preferences.imageModel || DEFAULT_IMAGE_MODEL}
          models={catalog.imageModels} unavailable={imageUnavailable} recommendedId={DEFAULT_IMAGE_MODEL}
          disabled={Boolean(saving)} onChange={id => void selectModel("image", id)} />
        <p className="caption">{catalog.imageModels.length} modelli di generazione immagini disponibili. Se un modello non supporta il rapporto del contenuto, OpenRouter userà il proprio formato predefinito.</p>
      </article>
    </div>}
    {saving && <p className="caption" role="status"><LoaderCircle className="spin" size={14}/> Salvataggio preferenza…</p>}
    <div className="notice warn">Le preferenze dei modelli e la chiave API restano su questo computer. Per usare Forgecy su un altro PC, configura lì la tua chiave personale.</div>
    <DriveSettings />
  </section>;
}
