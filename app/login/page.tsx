"use client";
import { useState } from "react";
import { browserDb } from "@/lib/supabase";
import { ArrowRight,Layers3,Mail,ShieldCheck } from "lucide-react";
export default function LoginPage(){
 const [email,setEmail]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try {
   const db=browserDb();
   const {error}=await db.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+"/auth/callback"}});
   if(error)throw error;
   setMessage("Controlla la tua email: ti abbiamo inviato il link per accedere.");
  }catch(err){setMessage(err instanceof Error?err.message:"Accesso non disponibile: controlla la configurazione Supabase.");}
  finally{setBusy(false);}
 }
 return <main className="login-page">
  <section className="login-copy">
   <div className="login-wordmark"><span className="logo-icon">f.</span><strong>forgecy</strong></div>
   <span className="eyebrow">Creative operating system</span>
   <h1>Il tuo team creativo.<br/><em>Un unico spazio.</em></h1>
   <p>Conosci ogni cliente, costruisci la strategia e crea contenuti Instagram e LinkedIn con il supporto di agenti AI coordinati.</p>
   <div className="login-features"><span><Layers3 size={17}/> Un profilo per ogni cliente</span><span><ShieldCheck size={17}/> Informazioni e approvazioni verificabili</span></div>
  </section>
  <section className="login-panel">
   <div className="login-form card">
    <div className="avatar-square"><Mail size={24}/></div>
    <h2>Accedi a Forgecy</h2>
    <p>Riceverai un link di accesso alla tua casella email. Nessuna password da ricordare.</p>
    <form onSubmit={submit}>
     <label htmlFor="email">Indirizzo email</label>
     <input id="email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="nome@agenzia.it" autoComplete="email"/>
     <button className="button primary full" disabled={busy}>{busy?"Invio in corso…":"Invia link di accesso"} <ArrowRight size={16}/></button>
    </form>
    {message&&<div className="form-message" role="status">{message}</div>}
    <small>La sessione è protetta da Supabase Auth. I dati di ogni cliente sono isolati.</small>
   </div>
  </section>
 </main>;
}
