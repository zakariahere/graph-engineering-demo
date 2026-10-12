export const meta = {
  name: 'stage2-scatter-gather',
  description: 'One isolated auditor per file, results joined at a barrier',
  phases: [{ title: 'Audit' }],
}
const PROMPT = (file) =>
  `You are auditing ONE source file for RESILIENCE defects only: missing timeouts, unbounded or naive retries, ` +
  `blocking calls inside Future/async code, swallowed exceptions, missing idempotency, unbounded queues/pools.\n` +
  `File: ${file} (read it with the Read tool). Do not read other files. Do not modify anything.\n` +
  `For every finding output one line: <file>:<line> | <category> | <severity high/med/low> | <one-sentence evidence>. ` +
  `Only report what you can cite. End with a line "TOTAL: <n>".`

const results = await pipeline(
  args,
  (file) => agent(PROMPT(file), { label: `audit:${file.split('/').pop()}`, phase: 'Audit', model: 'haiku' }),
)
const joined = results.map((r, i) => `### ${args[i]}\n${r ?? 'NODE FAILED (null)'}`).join('\n\n')
log(`gathered ${results.filter(Boolean).length}/${args.length} auditor reports`)
return { joined }