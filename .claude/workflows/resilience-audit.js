export const meta = {
  name: 'resilience-audit',
  description: 'Per-file resilience audit → fair-budget adversarial verification gate → grounded synthesis',
  whenToUse: 'Audit a handful of files for missing timeouts, naive retries, blocking-in-async, swallowed exceptions, missing idempotency, unbounded queues/pools',
  phases: [
    { title: 'Audit', model: 'haiku' },
    { title: 'Select' },
    { title: 'Verify', model: 'opus' },
    { title: 'Gate' },
    { title: 'Synthesize', model: 'opus' },
  ],
}
// args: { files: [{path, lines}], verifierBudget?: number (default 6), canary?: {file, line, category} }

const CATEGORIES = ['missing-timeout', 'unbounded-retry', 'naive-retry', 'blocking-in-async',
  'swallowed-exception', 'missing-idempotency', 'unbounded-queue', 'unbounded-pool']
const SEV = { high: 0, medium: 1, low: 2 }
const BUDGET = args.verifierBudget ?? 6

const FINDINGS = {
  type: 'object',
  properties: {
    fileStatus: { type: 'string', enum: ['read', 'unreadable'], description: '"unreadable" if the file does not exist or could not be read' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          category: { type: 'string', enum: CATEGORIES },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string', description: 'Exact code quoted from the cited line plus one sentence on why it is a defect' },
          proposedTest: { type: 'string', description: 'A concrete test that would fail today and pass after the fix' },
        },
        required: ['file', 'line', 'category', 'severity', 'evidence', 'proposedTest'],
      },
    },
  },
  required: ['fileStatus', 'findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['supported', 'refuted', 'unverified'] },
    quotedCode: { type: 'string', description: 'The exact code you inspected, quoted verbatim from the file' },
    defect: { type: 'string', description: 'ONE sentence: the defect at the claimed location only, or why it is absent' },
    reasoning: { type: 'string', description: 'Full reasoning, for humans; not forwarded downstream' },
    sideObservations: { type: 'array', items: { type: 'string' }, description: 'Other possible defects you noticed that are NOT the claim under review' },
  },
  required: ['status', 'quotedCode', 'defect', 'reasoning', 'sideObservations'],
}

const SYNTH = {
  type: 'object',
  properties: {
    rootCauses: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' },
      findingIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      blastRadius: { type: 'string', enum: ['system', 'service', 'request'] },
      rank: { type: 'integer', minimum: 1 },
      rationale: { type: 'string', description: 'Must only restate facts present in the cited findings' },
    }, required: ['title', 'findingIds', 'blastRadius', 'rank', 'rationale'] } },
    notInEvidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['rootCauses', 'notInEvidence'],
}

const AUDIT_PROMPT = (f) =>
  `Audit ONE source file for RESILIENCE defects only. Category must be one of: ${CATEGORIES.join(', ')}. ` +
  `If a suspected issue fits none of them, leave it out.\n` +
  `File: ${f.path} (read it with the Read tool). Do not read other files. Do not modify anything.\n` +
  `If the file cannot be read, set fileStatus to "unreadable" and return no findings.\n` +
  `Set "file" to exactly "${f.path}". "line" is the 1-based line of the defective code. ` +
  `"evidence" must quote that line verbatim. Only report what you can cite.`

const VERIFY_PROMPT = (c) =>
  `You are a skeptical reviewer. Someone claims there is a resilience defect of type "${c.category}" ` +
  `at ${c.file}:${c.line}. Your job is to try to FALSIFY this claim against the actual code.\n` +
  `Read ${c.file} with the Read tool. You may read other files in the repo for context. Do not modify anything.\n` +
  `Look for mitigations: timeouts configured elsewhere, bounded wrappers, dedicated executors, rethrows, ` +
  `idempotency keys, library defaults that make the claim false.\n` +
  `Return "refuted" if the code at or around that line does not have this defect. Return "supported" only if ` +
  `you confirmed it in the code yourself. Return "unverified" if you cannot decide from the code available.\n` +
  `"defect" must describe ONLY the claimed defect. Put anything else you noticed in sideObservations.`

function validate(x, f) {
  const errs = []
  if (x.file !== f.path) errs.push(`file mismatch: "${x.file}"`)
  if (!(x.line >= 1 && x.line <= f.lines)) errs.push(`line ${x.line} outside 1..${f.lines}`)
  if (!x.evidence || x.evidence.trim().length < 15) errs.push('evidence too short')
  if (!x.proposedTest || x.proposedTest.trim().length < 15) errs.push('proposedTest too short')
  return errs
}

// fair selection: severity-first within each file, then round-robin across files (no path-order starvation)
function fairSelect(items, n) {
  const byFile = new Map()
  for (const x of items) {
    if (!byFile.has(x.file)) byFile.set(x.file, [])
    byFile.get(x.file).push(x)
  }
  const queues = [...byFile.keys()].sort().map(k =>
    byFile.get(k).sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.line - b.line))
  const picked = []
  while (picked.length < n && queues.some(q => q.length)) {
    const heads = queues.filter(q => q.length).map(q => q[0])
    heads.sort((a, b) => SEV[a.severity] - SEV[b.severity])   // within a round, highest severity first
    for (const h of heads) {
      if (picked.length >= n) break
      picked.push(h)
      queues.find(q => q[0] === h).shift()
    }
  }
  return picked
}

// ── Audit: scatter, one isolated auditor per file; validate per item (no barrier)
phase('Audit')
const perFile = await pipeline(args.files,
  (f) => agent(AUDIT_PROMPT(f), { label: `audit:${f.path.split('/').pop()}`, phase: 'Audit', model: 'haiku', schema: FINDINGS }),
  (out, f) => {
    if (out === null) return { valid: [], invalid: [{ source: f.path, reason: 'auditor node returned null (infra failure)' }] }
    if (out.fileStatus === 'unreadable') return { valid: [], invalid: [{ source: f.path, reason: 'auditor could not read file: coverage gap, NOT clean' }] }
    const valid = [], invalid = []
    for (const x of out.findings) {
      const errs = validate(x, f)
      if (errs.length) invalid.push({ source: f.path, finding: x, reason: errs.join('; ') })
      else valid.push(x)
    }
    return { valid, invalid }
  })
const quarantine = perFile.map((r, i) => r ?? { valid: [], invalid: [{ source: args.files[i].path, reason: 'validation stage failed' }] })
  .flatMap(r => r.invalid)
const all = perFile.filter(Boolean).flatMap(r => r.valid)

// ── Select: barrier justified (global budget needs the whole set)
phase('Select')
const slots = args.canary ? BUDGET - 1 : BUDGET
const chosen = fairSelect(all, slots)
const toVerify = chosen.map(x => ({ ...x, origin: 'auditor' }))
const overBudget = all.filter(x => !chosen.includes(x)).map(x => ({ ...x, origin: 'auditor', status: 'unverified', reason: 'not checked: verifier budget' }))
if (args.canary) toVerify.push({ ...args.canary, origin: 'CANARY' })
log(`${all.length} findings, ${quarantine.length} quarantined; verifying ${toVerify.length}, ${overBudget.length} held (budget)`)

// ── Verify: fresh context, claim only (no auditor evidence); null → unverified, never refuted
phase('Verify')
const raw = await pipeline(toVerify,
  (c) => agent(VERIFY_PROMPT(c), { label: `verify:${c.file.split('/').pop()}:${c.line}`, phase: 'Verify', model: 'opus', schema: VERDICT }))
const verdicts = raw.map((v, i) => ({ ...toVerify[i],
  verdict: v ?? { status: 'unverified', quotedCode: '', defect: '', reasoning: 'verifier node failed (null): infrastructure, not evidence', sideObservations: [] } }))

// ── Gate: message filter + router
phase('Gate')
const passed = verdicts.filter(x => x.verdict.status === 'supported' && x.origin === 'auditor')
const rejected = verdicts.filter(x => x.verdict.status === 'refuted')
const held = [...verdicts.filter(x => x.verdict.status === 'unverified'), ...overBudget]
const leads = verdicts.flatMap(x => x.verdict.sideObservations.map(s => ({ from: `${x.file}:${x.line}`, observation: s, status: 'unverified' })))
const canaryOk = args.canary ? rejected.some(x => x.origin === 'CANARY') : null
if (args.canary && !canaryOk) log('WARNING: canary was NOT refuted, gate may be compromised')
log(`gate: ${passed.length} passed, ${rejected.length} refuted, ${held.length} held, ${leads.length} side leads`)

// ── Synthesize: structured fields only (claim check), deterministic grounding check after
phase('Synthesize')
const ids = passed.map((x, i) => ({ id: `F${i + 1}`, file: x.file, line: x.line, category: x.category,
  verifiedCode: x.verdict.quotedCode, defect: x.verdict.defect }))
let synth = null
if (ids.length) {
  synth = await agent(
    `You are synthesizing VERIFIED resilience findings. Input (JSON):\n${JSON.stringify(ids, null, 1)}\n` +
    `1) Group findings that share a root cause (each finding in exactly one group).\n` +
    `2) Rank groups by blast radius: "system" = can take down the process or shared pools for all requests, ` +
    `"service" = degrades one integration or causes data/money errors, "request" = affects one request.\n` +
    `3) Every sentence in a rationale must be backed by the cited findings' verifiedCode/defect. ` +
    `Do NOT read code, do NOT add defects. Put suspicions that are not established in notInEvidence.`,
    { label: 'synthesize', phase: 'Synthesize', model: 'opus', schema: SYNTH })
}
const known = new Set(ids.map(x => x.id)), seen = new Map(), problems = []
for (const rc of synth?.rootCauses ?? []) for (const id of rc.findingIds) {
  if (!known.has(id)) problems.push(`"${rc.title}" cites unknown ${id}`)
  seen.set(id, (seen.get(id) || 0) + 1)
}
for (const id of known) if ((seen.get(id) || 0) !== 1) problems.push(`${id} covered ${seen.get(id) || 0}x`)
if (ids.length && !synth) problems.push('synthesis node returned null')

return {
  report: synth, findings: ids, problems,
  rejected: rejected.map(x => ({ claim: `${x.file}:${x.line} ${x.category}`, origin: x.origin, why: x.verdict.defect })),
  held: held.map(x => ({ claim: `${x.file}:${x.line} ${x.category}`, why: x.reason ?? x.verdict.reasoning })),
  leads, quarantine, canaryOk,
  counts: { audited: all.length, verified: verdicts.length, passed: passed.length, rejected: rejected.length, held: held.length },
}
