/**
 * Wiring test for the installed bundle: exercises `apply(ctx)` through a
 * minimal fake Cordis context (only `on`, `get`, and the callable logger) and
 * the real configuration file, without booting the Harness host.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '/home/trh/Packages/opencode_plugins/dsh-approval/index.js'
import { canonicalPath } from '/home/trh/Packages/opencode_plugins/dsh-approval/logic.js'

const WORKSPACES = '/home/trh/Packages/opencode_plugins'
const SESSION = { id: 'session-test' }
const AGENT = { session: SESSION }

/** Build a fake context recording listeners and warnings. */
function fakeContext(cwd) {
  const listeners = new Map()
  const warnings = []
  const infos = []
  const ctx = {
    on(event, listener) {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {}
    },
    get(service) {
      return service === 'workingDirectory' ? { get: () => cwd } : undefined
    },
    logger: () => ({
      info: (...args) => infos.push(args.join(' ')),
      warn: (...args) => warnings.push(args.join(' ')),
      debug: () => {},
    }),
  }
  return { ctx, listeners, warnings, infos }
}

/** Dispatch one waterfall listener chain in registration order. */
function dispatch(listeners, event, args, fallback) {
  const chain = listeners.get(event) ?? []
  const run = (index, payload) => index === chain.length
    ? fallback(payload)
    : chain[index](payload, () => run(index + 1, payload))
  return run(0, args)
}

/** One escalating write call targeting `filePath`. */
function writeCall(callId, filePath, justification = 'outside the workspace') {
  return {
    agent: AGENT,
    callId,
    name: 'write',
    arguments: { file_path: filePath, content: 'x', sandbox_permissions: 'danger-full-access', justification },
  }
}

test('claims an escalation only for a configured workspace target', async () => {
  const { ctx, listeners, warnings } = fakeContext('/home/trh/Packages/deepseek-harness')
  apply(ctx)
  assert.equal(warnings.length, 0)

  const inside = writeCall('call-inside', `${WORKSPACES}/dsh-approval/probe.txt`)
  await dispatch(listeners, 'tools/pre-execute', inside, async () => ({ kind: 'allow' }))
  const insideOutcome = await dispatch(listeners, 'approval/request', {
    agent: AGENT,
    toolName: 'write',
    callId: 'call-inside',
    reason: 'escalate sandbox to danger-full-access: outside the workspace',
  }, async () => 'unavailable')
  assert.equal(insideOutcome, 'allowed-once')

  const outside = writeCall('call-outside', '/home/trh/Packages/egmpdbc-probe/report.dbc')
  await dispatch(listeners, 'tools/pre-execute', outside, async () => ({ kind: 'allow' }))
  const outsideOutcome = await dispatch(listeners, 'approval/request', {
    agent: AGENT,
    toolName: 'write',
    callId: 'call-outside',
    reason: 'escalate sandbox to danger-full-access: outside the workspace',
  }, async () => 'unavailable')
  assert.equal(outsideOutcome, 'unavailable')
})

test('never claims bash, run_code, or a mismatched reason', async () => {
  const { ctx, listeners } = fakeContext('/home/trh/Packages/deepseek-harness')
  apply(ctx)

  const bash = {
    agent: AGENT,
    callId: 'call-bash',
    name: 'bash',
    arguments: { command: 'chmod +x x', sandbox_permissions: 'danger-full-access', justification: 'chmod' },
  }
  await dispatch(listeners, 'tools/pre-execute', bash, async () => ({ kind: 'allow' }))
  assert.equal(await dispatch(listeners, 'approval/request', {
    agent: AGENT,
    toolName: 'bash',
    callId: 'call-bash',
    reason: 'escalate sandbox to danger-full-access: chmod',
  }, async () => 'unavailable'), 'unavailable')

  const write = writeCall('call-write', `${WORKSPACES}/dsh-approval/probe.txt`)
  await dispatch(listeners, 'tools/pre-execute', write, async () => ({ kind: 'allow' }))
  assert.equal(await dispatch(listeners, 'approval/request', {
    agent: AGENT,
    toolName: 'write',
    callId: 'call-write',
    reason: 'Auto review denied tool "write"',
  }, async () => 'unavailable'), 'unavailable')

  assert.deepEqual(canonicalPath(`${WORKSPACES}/dsh-approval`), `${WORKSPACES}/dsh-approval`)
})
