export const meta = {
  name: 'stage3-typed-edges',
  description: 'Per-file auditors with a JSON-schema output contract plus a deterministic validator',
  phases: [{ title: 'Audit' }, { title: 'Validate' }],
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

const PROMPT = (f) =>
  `Audit ONE source file for RESILIENCE defects only. Category must be one of: ${CATEGORIES.join(', ')}. ` +
  `If a suspected issue fits none of them, leave it out.\n` +
  `File: ${f.path} (read it with the Read tool). Do not read other files. Do not modify anything.\n` +
  `Set "file" to exactly "${f.path}". "line" is the 1-based line of the defective code. ` +
  `"evidence" must quote that line verbatim. Only report what you can cite.`

// edge contract #2: semantic validation the JSON schema cannot express
function validate(finding, f) {
  const errs = []
  if (finding.file !== f.path) errs.push(`file mismatch: "${finding.file}"`)
  if (!(finding.line >= 1 && finding.line <= f.lines)) errs.push(`line ${finding.line} outside 1..${f.lines}`)
  if (!finding.evidence || finding.evidence.trim().length < 15) errs.push('evidence too short')
  if (!finding.proposedTest || finding.proposedTest.trim().length < 15) errs.push('proposedTest too short')
  return errs
}

const perFile = await pipeline(
  args.files,
  (f) => agent(PROMPT(f), { label: `audit:${f.path.split('/').pop()}`, phase: 'Audit', model: 'haiku', schema: FINDINGS }),
  (out, f) => {
    if (out === null) return { valid: [], invalid: [{ source: f.path, reason: 'node returned null' }] }
    const valid = [], invalid = []
    for (const x of out.findings) {
      const errs = validate(x, f)
      if (errs.length) invalid.push({ source: f.path, finding: x, reason: errs.join('; ') })
      else valid.push(x)
    }
    return { valid, invalid }
  },
)

// DEMO ONLY: inject 2 synthetic malformed messages, as if a rogue or hallucinating node produced them
const quarantine = perFile.filter(Boolean).flatMap(r => r.invalid)
if (args.injectMalformed) {
  const fake = [
    { file: 'app/payments/PaymentClient.scala', line: 999, category: 'missing-timeout', severity: 'high',
      evidence: 'ws.url(...).post(...) with no timeout at all here', proposedTest: 'stub PSP to hang, expect failure within 5s' },
    { file: 'app/payments/PaymentClient.Scala', line: 17, category: 'missing-timeout', severity: 'high',
      evidence: 'n/a', proposedTest: '' },
  ]
  const target = args.files[0]
  for (const x of fake) quarantine.push({ source: 'INJECTED', finding: x, reason: validate(x, target).join('; ') })
}
const findings = perFile.filter(Boolean).flatMap(r => r.valid)
const byCategory = {}
for (const x of findings) byCategory[x.category] = (byCategory[x.category] || 0) + 1
log(`${findings.length} valid findings, ${quarantine.length} quarantined`)
return { findings, quarantine, byCategory }