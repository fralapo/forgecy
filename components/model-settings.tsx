"use client";
import { useCallback, useEffect, useState } from "react";
import { Cpu, Download, HardDrive, LoaderCircle, RefreshCw, Search, Settings2 } from "lucide-react";
import { requestJson } from "./types";
import type { OpenRouterImageModel, OpenRouterModel } from "@/lib/ai-model-settings";
import { DEFAULT_IMAGE_MODEL, DEFAULT_OCR_MODEL, DEFAULT_TEXT_MODEL } from "@/lib/ai-model-defaults";
import DriveSettings from "./drive-settings";

type Preferences = { textModel: string; imageModel: string | null; ocrModel: string };
type KeyStatus = { configured: boolean; source: "app" | "environment" | null };
type ModelResponse = {
  textModels: OpenRouterModel[];
  visionModels: OpenRouterModel[];
  imageModels: OpenRouterImageModel[];
  preferences: Preferences;
};
type KnowledgeSettings={enabled:boolean;modelId:string;total:number;indexed:number;runtime:{state:string;model:string}};
type OcrSettings={preferences:{provider:"auto"|"openrouter"|"local";autoUpdate:boolean};hardware:{platform:string;architecture:string;memoryGb:number;freeMemoryGb:number;cores:number;diskFreeGb:number|null;uvPath:string|null;supported:boolean;installReady:boolean;recommendation:"local"|"api";reasons:string[]};installedVersion:string|null;latestVersion:string|null;updateAvailable:boolean;operation:{id:string;status:"installing"|"ready"|"failed";stage:string;version:string;error?:string}|null};

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
  kind: "text" | "image" | "vision";
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
  const [saving, setSaving] = useState<"text" | "image" | "ocr" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [knowledge,setKnowledge]=useState<KnowledgeSettings|null>(null);
  const [savingKnowledge,setSavingKnowledge]=useState(false);
  const [indexingKnowledge,setIndexingKnowledge]=useState(false);
  const [ocrSettings,setOcrSettings]=useState<OcrSettings|null>(null);
  const [ocrBusy,setOcrBusy]=useState(false);

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

  useEffect(()=>{
    let active=true;
    void requestJson<KnowledgeSettings>("/api/workspace/settings/knowledge")
      .then(value=>{if(active)setKnowledge(value);})
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Impossibile leggere la ricerca nella conoscenza");});
    return ()=>{active=false;};
  },[]);

  const loadOcrSettings=useCallback(async()=>{
    try{setOcrSettings(await requestJson<OcrSettings>("/api/workspace/settings/ocr"));}
    catch(cause){setError(cause instanceof Error?cause.message:"Impossibile controllare il parser OCR locale");}
  },[]);
  useEffect(()=>{
    const initial=window.setTimeout(()=>void loadOcrSettings(),0);
    const timer=window.setInterval(()=>void loadOcrSettings(),15_000);
    return()=>{window.clearTimeout(initial);window.clearInterval(timer);};
  },[loadOcrSettings]);

  async function saveOcrPreference(patch:{provider?:OcrSettings["preferences"]["provider"];autoUpdate?:boolean}){
    if(!ocrSettings||ocrBusy)return;
    const previous=ocrSettings;
    setOcrSettings({...previous,preferences:{...previous.preferences,...patch}});setOcrBusy(true);setError("");setSaved("");
    try{
      const result=await requestJson<{preferences:OcrSettings["preferences"]}>("/api/workspace/settings/ocr",{method:"PATCH",body:JSON.stringify(patch)});
      setOcrSettings(current=>current?{...current,preferences:result.preferences}:current);
      setSaved("Preferenze OCR salvate");
    }catch(cause){setOcrSettings(previous);setError(cause instanceof Error?cause.message:"Impossibile salvare le preferenze OCR");}
    finally{setOcrBusy(false);}
  }

  async function startOcrAction(action:"install"|"update"|"check"){
    if(ocrBusy)return;
    setOcrBusy(true);setError("");setSaved("");
    try{
      const result=await requestJson<Partial<OcrSettings>&{operation?:OcrSettings["operation"];message?:string}>("/api/workspace/settings/ocr",{method:"POST",body:JSON.stringify({action})});
      if(result.operation)setOcrSettings(current=>current?{...current,operation:result.operation!,updateAvailable:current.updateAvailable}:current);
      if(result.message)setSaved(result.message);
      else if(action==="check")setSaved("Controllo versione completato");
      await loadOcrSettings();
    }catch(cause){setError(cause instanceof Error?cause.message:"Operazione sul parser locale non riuscita");}
    finally{setOcrBusy(false);}
  }

  async function toggleSemantic(enabled:boolean){
    if(!knowledge||savingKnowledge)return;
    const previous=knowledge.enabled;
    setKnowledge({...knowledge,enabled});setSavingKnowledge(true);setError("");setSaved("");
    try{
      const savedPreference=await requestJson<{enabled:boolean}>("/api/workspace/settings/knowledge",{
        method:"PATCH",body:JSON.stringify({enabled})
      });
      setKnowledge(current=>current?{...current,enabled:savedPreference.enabled}:current);
      setSaved(enabled?"Ricerca semantica locale attivata":"Ricerca semantica locale disattivata");
    }catch(cause){
      setKnowledge(current=>current?{...current,enabled:previous}:current);
      setError(cause instanceof Error?cause.message:"Impossibile salvare la modalità di ricerca");
    }finally{setSavingKnowledge(false);}
  }

  async function indexKnowledge(){
    if(!knowledge?.enabled||indexingKnowledge)return;
    setIndexingKnowledge(true);setError("");setSaved("");
    try{
      let state=knowledge;
      for(let attempt=0;attempt<2000;attempt++){
        const result=await requestJson<KnowledgeSettings&{complete:boolean}>("/api/workspace/settings/knowledge",{
          method:"POST",body:JSON.stringify({batchSize:24})
        });
        state={enabled:state.enabled,modelId:result.modelId,total:result.total,indexed:result.indexed,runtime:result.runtime};
        setKnowledge(state);
        if(result.complete){setSaved("Indice semantico locale aggiornato");return;}
      }
      throw new Error("Indicizzazione sospesa per il limite di sicurezza. Premi di nuovo per continuare.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Indicizzazione locale non riuscita");}
    finally{setIndexingKnowledge(false);}
  }

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

  async function selectModel(kind: "text" | "image" | "ocr", modelId: string) {
    if (!catalog || saving || !modelId) return;
    const previous = catalog.preferences;
    const optimistic = kind === "text"
      ? { ...previous, textModel: modelId }
      : kind === "image" ? { ...previous, imageModel: modelId } : { ...previous, ocrModel: modelId };
    setCatalog({ ...catalog, preferences: optimistic });
    setSaving(kind);
    setError("");
    setSaved("");
    try {
      const result = await requestJson<{ preferences: Preferences }>("/api/workspace/settings/models", {
        method: "PATCH", body: JSON.stringify({ kind, modelId })
      });
      setCatalog(current => current ? { ...current, preferences: result.preferences } : current);
      setSaved(kind === "text" ? "Modello testo salvato" : kind === "image" ? "Modello immagini salvato" : "Modello OCR salvato");
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
        <p className="tagline" style={{ marginTop: 7 }}>Configura i modelli AI e scegli come leggere localmente i documenti.</p>
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
    <article className="card stack">
      <div className="flex center gap8"><Settings2 size={18}/><h2>OCR e lettura dei documenti</h2></div>
      <p className="caption">Forgecy estrae prima il testo nativo dei PDF in locale. Per scansioni e immagini puoi usare PaddleOCR-VL sul computer, OpenRouter via API oppure lasciare decidere in base all’hardware. Il parser locale non invia il documento a un servizio OCR. L’eventuale estrazione AI dei campi prodotto da un catalogo resta una fase separata e può inviare a OpenRouter il testo e le immagini estratti.</p>
      <label htmlFor="forgecy-ocr-provider">Motore OCR</label>
      <select id="forgecy-ocr-provider" value={ocrSettings?.preferences.provider||"auto"} disabled={!ocrSettings||ocrBusy} onChange={event=>void saveOcrPreference({provider:event.target.value as OcrSettings["preferences"]["provider"]})}>
        <option value="auto">Automatico · raccomandazione hardware</option><option value="local">Solo parser locale · non inviare via API</option><option value="openrouter">OpenRouter · usa la mia chiave API</option>
      </select>
      {ocrSettings&&<div className="notice"><Cpu size={15}/> {ocrSettings.hardware.platform} {ocrSettings.hardware.architecture} · {ocrSettings.hardware.memoryGb} GB RAM · {ocrSettings.hardware.cores} core · {ocrSettings.hardware.diskFreeGb===null?"spazio disco non rilevato":`${ocrSettings.hardware.diskFreeGb} GB liberi`}<br/>
        In modalità automatica: <strong>{ocrSettings.installedVersion&&ocrSettings.hardware.recommendation==="local"?"parser locale":"OpenRouter"}</strong> · compatibilità hardware: <strong>{ocrSettings.hardware.recommendation==="local"?"locale consigliato":"API consigliata"}</strong>{ocrSettings.hardware.uvPath?" · uv disponibile":" · uv non rilevato"}{ocrSettings.hardware.reasons.map(reason=><span key={reason}><br/>{reason}</span>)}
      </div>}
      {ocrSettings&&<div className="notice" role="status"><HardDrive size={15}/> PaddleOCR-VL {ocrSettings.installedVersion?`· installato ${ocrSettings.installedVersion}`:"· non installato"}{ocrSettings.latestVersion?` · versione stabile attuale ${ocrSettings.latestVersion}`:" · versione online non verificata"}{ocrSettings.updateAvailable?" · aggiornamento disponibile":""}{ocrSettings.operation&&<><br/>{ocrSettings.operation.stage}{ocrSettings.operation.status==="failed"&&ocrSettings.operation.error?` — ${ocrSettings.operation.error}`:""}</>}</div>}
      <label className="flex center gap8" style={{fontWeight:650}}><input type="checkbox" checked={ocrSettings?.preferences.autoUpdate??true} disabled={!ocrSettings||ocrBusy} onChange={event=>void saveOcrPreference({autoUpdate:event.target.checked})} style={{width:18,height:18}}/> Controlla e installa automaticamente le nuove versioni stabili</label>
      <div className="flex gap8 wrap">
        {!ocrSettings?.installedVersion&&<button className="button primary" onClick={()=>void startOcrAction("install")} disabled={!ocrSettings?.hardware.installReady||ocrBusy||ocrSettings.operation?.status==="installing"}><Download size={15}/> Installa parser locale</button>}
        {ocrSettings?.updateAvailable&&<button className="button primary" onClick={()=>void startOcrAction("update")} disabled={ocrBusy||ocrSettings.operation?.status==="installing"}><Download size={15}/> Aggiorna ora</button>}
        <button className="button" onClick={()=>void startOcrAction("check")} disabled={ocrBusy}><RefreshCw size={15}/> Controlla versione</button>
      </div>
      {ocrSettings?.operation?.status==="installing"&&<p className="caption" role="status"><LoaderCircle className="spin" size={14}/> Preparazione ambiente isolato e verifica del motore. Il primo avvio scarica il runtime e i modelli necessari.</p>}
      {catalog&&<><ModelSelector kind="vision" label="Modello OpenRouter per OCR API e documenti" selectedId={catalog.preferences.ocrModel||DEFAULT_OCR_MODEL}
          models={catalog.visionModels} unavailable={!catalog.visionModels.some(model=>model.id===(catalog.preferences.ocrModel||DEFAULT_OCR_MODEL))}
          recommendedId={DEFAULT_OCR_MODEL} disabled={Boolean(saving)} onChange={id=>void selectModel("ocr",id)} />
        <p className="caption">{catalog.visionModels.length} modelli visivi OpenRouter disponibili. Per i PDF scannerizzati il parser Mistral costa circa 0,002 $ per pagina, oltre ai token del modello. Ogni PDF è limitato a 40 pagine. L’API invia documenti e immagini a provider esterni.</p></>}
    </article>
    <article className="card stack">
      <div className="flex center gap8"><Cpu size={18}/><h2>Ricerca nella memoria dei clienti</h2></div>
      <p className="caption">La ricerca testuale SQLite resta sempre attiva. Puoi affiancarle la ricerca semantica locale per trovare anche concetti espressi con parole diverse. Il modello gira sul computer: il testo dei documenti non viene inviato a un servizio di embedding.</p>
      <label className="flex center gap8" style={{fontWeight:650}}>
        <input type="checkbox" checked={Boolean(knowledge?.enabled)} disabled={!knowledge||savingKnowledge||indexingKnowledge}
          onChange={event=>void toggleSemantic(event.target.checked)} style={{width:18,height:18}}/>
        Attiva ricerca semantica locale
      </label>
      <div className="notice" role="status"><HardDrive size={15}/> Modello multilingue quantizzato · {knowledge?.modelId||"caricamento…"} · download iniziale circa 130 MB da Hugging Face</div>
      {knowledge&&<div className="caption">Passaggi indicizzati: {knowledge.indexed.toLocaleString("it-IT")} su {knowledge.total.toLocaleString("it-IT")} · runtime {knowledge.runtime.state==="ready"?"pronto":knowledge.runtime.state==="loading"?"in caricamento":"non ancora caricato"}</div>}
      <div className="flex center gap8 wrap">
        <button className="button" onClick={()=>void indexKnowledge()} disabled={!knowledge?.enabled||indexingKnowledge||!knowledge.total}>
          {indexingKnowledge?<LoaderCircle className="spin" size={15}/>:<Download size={15}/>} {indexingKnowledge?"Indicizzazione…":"Genera o aggiorna indice locale"}
        </button>
        {indexingKnowledge&&knowledge&&<span className="caption">{knowledge.indexed.toLocaleString("it-IT")} / {knowledge.total.toLocaleString("it-IT")} passaggi</span>}
      </div>
      {!knowledge?.enabled&&<p className="caption">Facoltativa e disattivata all’inizio. Attivandola, Forgecy scarica il modello e crea gli embeddings sul computer. Le risposte AI continuano a inviare al modello OpenRouter solo il contesto selezionato per la richiesta.</p>}
    </article>
    {saving && <p className="caption" role="status"><LoaderCircle className="spin" size={14}/> Salvataggio preferenza…</p>}
    <div className="notice warn">Le preferenze dei modelli e la chiave API restano su questo computer. Per usare Forgecy su un altro PC, configura lì la tua chiave personale.</div>
    <DriveSettings />
  </section>;
}
