"use client";

import type { StudioCatalogModel } from "@/lib/studio";
import s from "./Studio.module.css";

export default function StartHere({ catalog, demo, onNew, onDemo, onConnections }: {
  catalog: StudioCatalogModel[]; demo: boolean; onNew: () => void;
  onDemo: () => void; onConnections: () => void;
}) {
  const available = catalog.filter(model => model.available).map(model => model.id);
  return <section className={s.startHere} aria-label="Studio Operator getting started">
    <div className={s.startHeading}>
      <div><p className={s.eyebrow}>YOUR AGENCY CONTROL ROOM</p><h2>From a client brief to a checked handoff.</h2>
        <p className={s.subtext}>The video’s operator workflow, adapted to local text and source-code work. No Higgsfield or new paid tools.</p></div>
      <span className={s.status}>{demo ? "Isolated demo" : "Live workspace"}</span>
    </div>
    <ol className={s.operatorFlow}>
      {[
        ["Capture", "Keep the original brief, price, deadline and references."],
        ["Analyze", "Extract requirements and resolve missing inputs."],
        ["Approve", "Review the model route, scope and cost limits."],
        ["Produce", "Generate versioned files under the approved plan."],
        ["Check", "Inspect QA findings, run needed tests and revise."],
        ["Deliver", "Approve the package and record the actual handoff."],
      ].map(([title, detail], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><p>{detail}</p></li>)}
    </ol>
    <div className={s.actions}>
      <button className={s.button} onClick={onNew}>Add a client brief</button>
      {!demo && <button className={s.secondary} onClick={onDemo}>Explore demo jobs</button>}
      <button className={s.secondary} onClick={onConnections}>Check accounts & payouts →</button>
    </div>
    <p className={s.caption} style={{marginTop:16}}>Available models: {available.length ? available.join(", ") : "None confirmed — check Model router"}. Source-file production does not execute code, browse client sites or deploy apps. Model QA is advisory; delivery and marketplace payments remain separate steps.</p>
  </section>;
}
