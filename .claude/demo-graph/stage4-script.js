export const meta = {
  name: 'stage4-verification-gate',
  description: 'Typed per-file audit, then independent adversarial verifiers gate each finding',
  phases: [{ title: 'Audit' }, { title: 'Select' }, { title: 'Verify', model: 'opus' }, { title: 'Gate' }],
}
const CATEGORIES = ['missing-timeout', 'unbounded-retry', 'naive-retry', 'blocking-in-async',
  'swallowed-exception', 'missing-idempotency', 'unbounded-queue', 'unbounded-pool']
const FINDINGS = {
  type: 'object',
  properties: {
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
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['supported', 'refuted', 'unverified'] },
    quotedCode: { type: 'string', description: 'The exact code you inspected, quoted verbatim from the file' },
    reasoning: { type: 'string', description: 'Why the code does or does not exhibit the defect; name any mitigation you found' },
  },
  required: ['status', 'quotedCode', 'reasoning'],
}
const AUDIT_PROMPT = (f) =>
  `Audit ONE source file for RESILIENCE defects only. Category must be one of: ${CATEGORIES.join(', ')}. ` +
  `If a suspected issue fits none of them, leave it out.\n` +
  `File: ${f.path} (read it with the Read tool). Do not read other files. Do not modify anything.\n` +
  `Set "file" to exactly "${f.path}". "line" is the 1-based line of the defective code. ` +
  `"evidence" must quote that line verbatim. Only report what you can cite.`
function validate(finding, f) {
  const errs = []
  if (finding.file !== f.path) errs.push(`file mismatch: "${finding.file}"`)
  if (!(finding.line >= 1 && finding.line <= f.lines)) errs.push(`line ${finding.line} outside 1..${f.lines}`)
  if (!finding.evidence || finding.evidence.trim().length < 15) errs.push('evidence too short')
  if (!finding.proposedTest || finding.proposedTest.trim().length < 15) errs.push('proposedTest too short')
  return errs
}
const VERIFY_PROMPT = (c) =>
  `You are a skeptical reviewer. Someone claims there is a resilience defect of type "${c.category}" ` +
  `at ${c.file}:${c.line}. Your job is to try to FALSIFY this claim against the actual code.\n` +
  `Read ${c.file} with the Read tool. You may read other files in the repo for context. Do not modify anything.\n` +
  `Look for mitigations: timeouts configured elsewhere, bounded wrappers, dedicated executors, rethrows, ` +
  `idempotency keys, library defaults that make the claim false.\n` +
  `Return "refuted" if the code at or around that line does not have this defect. Return "supported" only if ` +
  `you confirmed it in the code yourself. Return "unverified" if you cannot decide from the code available ` +
  `(e.g. the behaviour depends on code or config not in the repo). Quote the code you inspected.`
const SEV = { high: 0, medium: 1, low: 2 }

phase('Audit')
const perFile = await pipeline(args.files,
  (f) => agent(AUDIT_PROMPT(f), { label: `audit:${f.path.split('/').pop()}`, phase: 'Audit', model: 'haiku', schema: FINDINGS }),
  (out, f) => {
    if (out === null) return { valid: [], invalid: [{ source: f.path, reason: 'node returned null' }] }
    const valid = [], invalid = []
    for (const x of out.findings) {
      const errs = validate(x, f)
      if (errs.length) invalid.push({ source: f.path, finding: x, reason: errs.join('; ') })
      else valid.push(x)
    }
    return { valid, invalid }
  })
const quarantine = perFile.filter(Boolean).flatMap(r => r.invalid)
const all = perFile.filter(Boolean).flatMap(r => r.valid)

phase('Select')
const ranked = [...all].sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
const toVerify = ranked.slice(0, args.budget - 1).map(x => ({ ...x, origin: 'auditor' }))
const overBudget = ranked.slice(args.budget - 1).map(x => ({ ...x, status: 'unverified', reason: 'not checked: verifier budget' }))
toVerify.push({ ...args.canary, origin: 'CANARY' })
log(`${all.length} findings: verifying ${toVerify.length} (incl. 1 canary), ${overBudget.length} held as unverified (budget)`)

phase('Verify')
const verdicts = await pipeline(toVerify,
  (c) => agent(VERIFY_PROMPT(c), { label: `verify:${c.file.split('/').pop()}:${c.line}`, phase: 'Verify', model: 'opus', schema: VERDICT }),
  (v, c) => ({ ...c, verdict: v ?? { status: 'unverified', quotedCode: '', reasoning: 'verifier node returned null' } }))

phase('Gate')
const passed = verdicts.filter(x => x.verdict.status === 'supported')
const rejected = verdicts.filter(x => x.verdict.status === 'refuted')
const held = [...verdicts.filter(x => x.verdict.status === 'unverified'), ...overBudget]
log(`gate: ${passed.length} passed, ${rejected.length} refuted, ${held.length} held`)
return { passed, rejected, held, quarantine, counts: { audited: all.length, verified: verdicts.length } }