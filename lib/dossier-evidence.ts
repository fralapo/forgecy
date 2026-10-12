/** Deterministic evidence contract. A model must not confer "verified" status by itself. */
export type DossierFinding = {
  topic: string;
  claim: string;
  source_ids: string[];
  certainty: "verified"|"inferred"|"unknown";
  evidence_quote: string;
};
export type EvidenceItem = { id: string; body: string; status?: string; kind?: string };
export type EvidenceReport = {
  verified: number;
  inferred: number;
  unknown: number;
  downgraded: number;
  invalid_source_references: number;
  unsupported_quotes: number;
  total: number;
  checked_at: string;
};

function normalized(text:string) {
  return text.normalize("NFKC").replace(/\s+/g," ").trim().toLocaleLowerCase("it");
}

/** Exact normalized text excerpts guard against invented quotes; source meaning still needs human review. */
export function reconcileDossierEvidence(
  findings: DossierFinding[], sources: EvidenceItem[], now = new Date().toISOString()
): {findings:DossierFinding[]; report:EvidenceReport} {
  const available = new Map(
    sources.filter(s=>s.id && s.body.trim() && (!s.status || s.status==="ready"))
      .map(s=>[s.id,normalized(s.body)])
  );
  const report:EvidenceReport = {
    verified:0,inferred:0,unknown:0,downgraded:0,
    invalid_source_references:0,unsupported_quotes:0,total:findings.length,checked_at:now
  };
  const checked = findings.map(item=>{
    const originalIds=[...new Set(item.source_ids)];
    const sourceIds=originalIds.filter(id=>available.has(id));
    report.invalid_source_references+=originalIds.length-sourceIds.length;
    const quote=item.evidence_quote.trim();
    const supported=quote.length>=12 && sourceIds.some(id=>
      available.get(id)!.includes(normalized(quote))
    );
    if(quote && !supported) report.unsupported_quotes++;
    const certainty=item.certainty==="verified"&&!supported?"inferred":item.certainty;
    if(item.certainty==="verified" && certainty!=="verified")report.downgraded++;
    report[certainty]++;
    return {...item,source_ids:sourceIds,certainty,evidence_quote:supported?quote:""};
  });
  return {findings:checked,report};
}
