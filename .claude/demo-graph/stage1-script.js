export const meta = {
  name: 'stage1-linear-baseline',
  description: 'Single agent audits all chosen files for resilience defects',
  phases: [{ title: 'Audit' }],
}
const FILES = args
phase('Audit')
const report = await agent(
  `You are auditing source files for RESILIENCE defects only: missing timeouts, unbounded or naive retries, ` +
  `blocking calls inside Future/async code, swallowed exceptions, missing idempotency, unbounded queues/pools.\n` +
  `Files (read each with the Read tool, paths relative to the working directory):\n${FILES.map(f => '- ' + f).join('\n')}\n` +
  `Do not modify any file. For every finding output one line: ` +
  `<file>:<line> | <category> | <severity high/med/low> | <one-sentence evidence>. ` +
  `Only report what you can cite. End with a line "TOTAL: <n>".`,
  { label: 'audit:all', phase: 'Audit', model: 'haiku' })
return { report }