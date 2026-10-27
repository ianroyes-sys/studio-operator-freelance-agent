// Studio vet: the gate between "a proposal exists" and "the agent may bid unattended".
//
// Ian, 2026-10-26: bid automatically, and have a second loop actually do the won work with next to
// no human oversight, so only bid on work that loop can finish alone. The studio-bid loop (Opus)
// reads each fresh draft and records a vet; this module is the deterministic half of that judgment.
// A vet only allows an unattended bid when the work is one of the delivery classes the
// studio-deliver loop can build, verify and hand over through Freelancer messages by itself.
// Native app builds are deliberately not here: Ian hand-builds those (signing, App Store review,
// multi-day client back-and-forth), so they get `ping_ian`, never an automatic bid.

export const AUTONOMOUS_CLASSES = Object.freeze({
  'static-site': 'Landing page or small static website, delivered as source + zip (no client hosting/accounts)',
  'web-component': 'React/Next.js/TypeScript component or small self-contained feature, delivered as source with a demo',
  script: 'Python/Node/Apps Script/VBA/regex/SQL with a specified input and output, delivered with a sample run',
  data: 'CSV/Excel/JSON cleanup, formulas, transformations or reports on files the client sends',
  writing: 'Copy, product descriptions, articles, documentation, READMEs, email sequences (no academic, no fake reviews)',
  'browser-extension': 'Small Chrome extension, delivered as an unpacked source folder + zip',
});
export const VERDICTS = Object.freeze(['bid', 'skip', 'ping_ian']);
export const VET_RULES = Object.freeze({ minAutonomy: 8, maxHours: 16, maxDeliveryDays: 7, maxBidUsd: 750, freshHours: 6 });

const str = (v, max, name) => { if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid vet ${name}`); return v.trim(); };
const list = (v, max, name) => { if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 300)) throw new Error(`Invalid vet ${name}`); return v.map(x => x.trim()); };

// Validates the loop's vet and, for a `bid` verdict, every rule an unattended bid must satisfy.
// Throws on anything malformed, so a sloppy vet can never become a bid.
export function validateVet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vet must be a JSON object');
  if (!VERDICTS.includes(value.verdict)) throw new Error(`Vet verdict must be one of: ${VERDICTS.join(', ')}`);
  const vet = {
    verdict: value.verdict,
    deliveryClass: str(value.deliveryClass ?? 'other', 40, 'deliveryClass'),
    autonomy: Number(value.autonomy),
    reasons: str(value.reasons, 1200, 'reasons'),
    acceptanceCriteria: list(value.acceptanceCriteria ?? [], 12, 'acceptanceCriteria'),
    inputsNeededFromClient: list(value.inputsNeededFromClient ?? [], 4, 'inputsNeededFromClient'),
    humanOnly: list(value.humanOnly ?? [], 6, 'humanOnly'),
    estimatedHours: Number(value.estimatedHours ?? 0),
    deliveryDays: Number(value.deliveryDays ?? 0),
    bidUsd: value.bidUsd == null ? null : Number(value.bidUsd),
    coverLetter: str(value.coverLetter ?? '', 1500, 'coverLetter'),
  };
  if (!Number.isInteger(vet.autonomy) || vet.autonomy < 0 || vet.autonomy > 10) throw new Error('Vet autonomy must be an integer 0–10');
  if (!vet.reasons) throw new Error('Vet needs reasons');
  if (vet.verdict !== 'bid') return vet;
  const r = VET_RULES;
  if (!AUTONOMOUS_CLASSES[vet.deliveryClass]) throw new Error(`A bid needs an autonomous delivery class (${Object.keys(AUTONOMOUS_CLASSES).join(', ')})`);
  if (vet.autonomy < r.minAutonomy) throw new Error(`A bid needs autonomy ≥ ${r.minAutonomy}`);
  if (vet.humanOnly.length) throw new Error('A bid cannot need anything only Ian can do');
  if (vet.acceptanceCriteria.length < 2) throw new Error('A bid needs at least 2 testable acceptance criteria');
  if (!(vet.estimatedHours > 0 && vet.estimatedHours <= r.maxHours)) throw new Error(`A bid needs estimatedHours in (0, ${r.maxHours}]`);
  if (!Number.isInteger(vet.deliveryDays) || vet.deliveryDays < 1 || vet.deliveryDays > r.maxDeliveryDays) throw new Error(`A bid needs deliveryDays 1–${r.maxDeliveryDays}`);
  if (!Number.isFinite(vet.bidUsd) || vet.bidUsd < 40 || vet.bidUsd > r.maxBidUsd) throw new Error(`A bid needs bidUsd between $40 and $${r.maxBidUsd}`);
  if (vet.coverLetter.length < 100) throw new Error('A bid needs a cover letter of at least 100 characters');
  if (/\b(telegram|whatsapp|skype|discord|gmail\.com|@[a-z0-9-]+\.[a-z]{2,}|\+?\d[\d\s().-]{8,}\d)\b/i.test(vet.coverLetter)) throw new Error('Cover letter shares off-platform contact details');
  return vet;
}

// A recorded vet that still authorizes an unattended bid right now.
export function vetAllowsBid(vet, now = Date.now()) {
  if (!vet || vet.verdict !== 'bid' || !vet.vettedAt) return false;
  if ((now - Date.parse(vet.vettedAt)) / 3600000 > VET_RULES.freshHours) return false;
  try { validateVet(vet); return true; } catch { return false; }
}

// A won lead the delivery loop owns: vetted as autonomous work at bid time (freshness no longer matters).
export function vetIsAutonomous(vet) {
  if (!vet || vet.verdict !== 'bid') return false;
  try { validateVet(vet); return true; } catch { return false; }
}
