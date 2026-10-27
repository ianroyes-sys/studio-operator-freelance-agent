"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import s from "./Studio.module.css";
import l from "./Leads.module.css";

type Proposal={worthBidding:boolean;fit:string;fitReason:string;coverLetter:string;deliveryDays:number;approach:string[];clarifyingQuestions:string[];risks:string[];bidUsd:number|null;draftedAt:string};
type Lead={id:string;title:string;url:string;status:string;score:number;tier:string;usdMin:number|null;usdMax:number|null;hourly:boolean;bidCount:number|null;ageHours:number|null;publishedAt:string|null;currency:string;budgetMin:number|null;budgetMax:number|null;reasons:string[];flags:string[];suggestedBidUsd:number|null;proposal?:Proposal;draftError?:string;finalPriceUsd?:number;jobId?:string;sentAt?:string};
type Funnel={hot:number;ready:number;sent:number;won:number;lost:number;sentThisWeek:number;wonThisWeek:number;wonValueUsd:number;winRate:number|null;draftsToday:number;lastReceipt:{at:string;outcome:string}|null};
type Packet={updatedAt:string|null;funnel:Funnel;leads:Lead[]};
const filters=[["drafted","Ready to send"],["new","Other matches"],["sent","Sent"],["won","Won"]] as const;
const usd=(n:number|null|undefined)=>n==null?"—":`$${Math.round(n).toLocaleString()}`;
const ago=(at:string|null|undefined)=>{if(!at)return"";const m=Math.max(0,Math.round((Date.now()-Date.parse(at))/60000));return m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`;};

export default function Leads({openJob}:{openJob:(id:string)=>void}){
 const [data,setData]=useState<Packet|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState<string|null>(null);
 const [filter,setFilter]=useState<typeof filters[number][0]>("drafted");const [copied,setCopied]=useState<string|null>(null);const [price,setPrice]=useState<Record<string,string>>({});
 const sequence=useRef(0);
 const load=useCallback(async()=>{const n=++sequence.current;try{const r=await fetch("/api/studio/leads",{cache:"no-store"});const d=await r.json();if(n!==sequence.current)return;if(!r.ok)throw new Error(d.error||"Leads could not load");setData(d);setError("");}catch(e){if(n===sequence.current)setError(e instanceof Error?e.message:"Leads could not load");}},[]);
 useEffect(()=>{void load();const t=window.setInterval(()=>{if(!document.hidden)void load();},10000);return()=>window.clearInterval(t);},[load]);
 const act=async(id:string,body:Record<string,unknown>)=>{setBusy(id);setError("");try{const r=await fetch("/api/studio/leads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,...body})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Action failed");await load();if(d.jobId)openJob(d.jobId);}catch(e){setError(e instanceof Error?e.message:"Action failed");}finally{setBusy(null);}};
 const copy=async(lead:Lead,open=false)=>{if(!lead.proposal)return;try{await navigator.clipboard.writeText(lead.proposal.coverLetter);setCopied(lead.id);window.setTimeout(()=>setCopied(c=>c===lead.id?null:c),2500);}catch{setError("Clipboard blocked. Select the proposal text and copy it manually.");}if(open)window.open(lead.url,"_blank","noopener,noreferrer");};
 const f=data?.funnel;const leads=(data?.leads||[]).filter(x=>x.status===filter);
 const counts:Record<string,number>={drafted:f?.ready||0,new:(data?.leads||[]).filter(x=>x.status==="new").length,sent:f?.sent||0,won:f?.won||0};
 return <>
  <section className={s.metrics} aria-label="Lead funnel">
   <div className={s.metric}><span>Ready to send</span><strong>{f?.ready??"—"}</strong><small>{f?`${f.draftsToday} drafted today`:"Loading"}</small></div>
   <div className={s.metric}><span>Sent this week</span><strong>{f?.sentThisWeek??"—"}</strong><small>{f?`${f.sent} awaiting reply`:""}</small></div>
   <div className={s.metric}><span>Won</span><strong>{f?usd(f.wonValueUsd):"—"}</strong><small>{f?`${f.won} job${f.won===1?"":"s"} · ${f.wonThisWeek} this week`:""}</small></div>
   <div className={s.metric}><span>Win rate</span><strong>{f?.winRate==null?"—":`${f.winRate}%`}</strong><small>{f&&f.won+f.lost?`${f.won} won / ${f.lost} lost`:"Mark outcomes to learn"}</small></div>
  </section>
  <div className={s.notice}><span>Every 5 minutes Studio Operator ranks new listings by budget, competition, freshness and fit, then drafts a proposal for the best ones. <b>You send it</b>: copy, open the listing, paste. In ping mode nothing bids or messages for you. Mark a lead Won and it becomes a Studio job: analyzed, and if the scope is clean, approved and produced automatically. Delivery stays with you.</span><button className={s.secondary} disabled={busy==="draft"} onClick={async()=>{setBusy("draft");try{const r=await fetch("/api/studio/leads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"draft_now"})});if(!r.ok)throw new Error((await r.json()).error||"Drafting failed");await load();}catch(e){setError(e instanceof Error?e.message:"Drafting failed");}finally{setBusy(null);}}}>{busy==="draft"?"Drafting…":"Draft now"}</button></div>
  {error&&<div className={s.error} role="alert">{error}</div>}
  <div className={s.tabs} role="tablist">{filters.map(([id,label])=><button key={id} role="tab" className={s.tab} aria-selected={filter===id} onClick={()=>setFilter(id)}>{label} <span className={l.count}>{counts[id]}</span></button>)}</div>
  {!data&&!error&&<div className={s.loading}>Reading ranked leads…</div>}
  {data&&leads.length===0&&<div className={s.empty}><strong>{filter==="drafted"?"No proposals waiting":filter==="sent"?"Nothing sent yet":filter==="won"?"No wins recorded yet":"No other matches right now"}</strong>{filter==="drafted"?"New drafts appear here as fresh listings come in. Use Draft now to run a pass immediately.":filter==="sent"?"Mark a proposal Sent after you submit it so replies and win rate are tracked.":filter==="won"?"Mark a sent lead Won with the agreed price. It becomes a Studio job.":"Ranked matches that were not drafted automatically show here. Press Draft on any of them. Automatic drafting is capped at 30 per day."}</div>}
  <div className={l.list}>{leads.map(lead=><article key={lead.id} className={l.card} data-tier={lead.tier}>
   <header className={l.head}>
    <div className={l.score} aria-label={`Score ${lead.score} of 100`}><strong>{lead.score}</strong><span>{lead.tier}</span></div>
    <div className={l.titleBlock}><a href={lead.url} target="_blank" rel="noreferrer" className={l.title}>{lead.title} ↗</a>
     <p className={l.meta}><span>{lead.hourly?`${usd(lead.usdMin)}–${usd(lead.usdMax)}/h`:`${usd(lead.usdMin)}–${usd(lead.usdMax)}`}{lead.currency!=="USD"&&<em> ({lead.currency} {lead.budgetMin}–{lead.budgetMax})</em>}</span><span>{lead.bidCount==null?"bids unknown":`${lead.bidCount} bids`}</span><span>posted {ago(lead.publishedAt)}</span>{lead.status==="sent"&&<span>sent {ago(lead.sentAt)}</span>}</p></div>
    <div className={l.bid}><span>{lead.status==="won"?"Agreed":"Bid"}</span><strong>{usd(lead.status==="won"?lead.finalPriceUsd:lead.proposal?.bidUsd??lead.suggestedBidUsd)}{lead.hourly&&lead.status!=="won"?"/h":""}</strong>{lead.proposal&&<small>{lead.proposal.deliveryDays}d delivery</small>}</div>
   </header>
   {(lead.reasons.length>0||lead.flags.length>0)&&<ul className={l.chips}>{lead.reasons.map(r=><li key={r}>{r}</li>)}{lead.flags.map(r=><li key={r} className={l.flag}>{r}</li>)}</ul>}
   {lead.proposal?<>
    <div className={l.letter}><p className={s.prose}>{lead.proposal.coverLetter}</p></div>
    <details className={l.more}><summary>Plan, questions & risks · {lead.proposal.fit} fit</summary><p className={s.caption}>{lead.proposal.fitReason}</p>
     {lead.proposal.approach.length>0&&<><h4>Approach</h4><ol>{lead.proposal.approach.map(a=><li key={a}>{a}</li>)}</ol></>}
     {lead.proposal.clarifyingQuestions.length>0&&<><h4>Ask the client</h4><ul>{lead.proposal.clarifyingQuestions.map(a=><li key={a}>{a}</li>)}</ul></>}
     {lead.proposal.risks.length>0&&<><h4>Risks</h4><ul>{lead.proposal.risks.map(a=><li key={a}>{a}</li>)}</ul></>}
    </details></>:lead.draftError?<p className={s.error}>Draft failed: {lead.draftError}</p>:<p className={s.caption}>No proposal drafted yet.</p>}
   <div className={s.actions}>
    {lead.proposal&&["drafted","new"].includes(lead.status)&&<button className={s.button} onClick={()=>void copy(lead,true)}>{copied===lead.id?"Copied ✓ — paste it":"Copy proposal & open listing"}</button>}
    {lead.proposal&&lead.status==="sent"&&<button className={s.secondary} onClick={()=>void copy(lead)}>{copied===lead.id?"Copied ✓":"Copy proposal"}</button>}
    {["drafted","new"].includes(lead.status)&&<button className={s.secondary} disabled={busy===lead.id} onClick={()=>void act(lead.id,{action:"sent"})}>Mark sent</button>}
    {["sent","drafted"].includes(lead.status)&&<span className={l.won}><input className={s.input} inputMode="decimal" aria-label="Agreed USD price" placeholder={String(lead.proposal?.bidUsd??lead.suggestedBidUsd??"")} value={price[lead.id]??""} onChange={e=>setPrice(p=>({...p,[lead.id]:e.target.value}))}/><button className={s.secondary} disabled={busy===lead.id} onClick={()=>void act(lead.id,{action:"won",...(price[lead.id]?{priceUsd:Number(price[lead.id])}:{})})}>Won</button></span>}
    {lead.status==="sent"&&<button className={s.secondary} disabled={busy===lead.id} onClick={()=>void act(lead.id,{action:"lost"})}>Lost</button>}
    {["drafted","new"].includes(lead.status)&&<button className={s.secondary} disabled={busy===lead.id} onClick={()=>void act(lead.id,{action:"redraft"})}>{busy===lead.id?"Working…":lead.proposal?"Redraft":"Draft"}</button>}
    {["drafted","new","sent"].includes(lead.status)&&<button className={s.danger} disabled={busy===lead.id} onClick={()=>void act(lead.id,{action:"dismissed"})}>Dismiss</button>}
    {lead.status==="won"&&lead.jobId&&<button className={s.button} onClick={()=>openJob(lead.jobId!)}>Open Studio job</button>}
   </div>
  </article>)}</div>
  {f?.lastReceipt&&<p className={s.caption}>Last pipeline event {ago(f.lastReceipt.at)}: {f.lastReceipt.outcome.replaceAll("_"," ")}.</p>}
 </>;
}
