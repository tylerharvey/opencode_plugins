import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_MODES,
  DEFAULT_TOOLS,
  canonicalPath,
  configSignature,
  defaultWorkspacesFile,
  hasEscalationArgs,
  isUnder,
  matchWorkspace,
  parseOptions,
  parseWorkspaceConfig,
  verifyEscalation,
} from '../logic.js'

/** Run one test inside a fresh temporary directory. */
function withTemp(run) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-approval-'))
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const options = { tools: new Set(DEFAULT_TOOLS), modes: new Set(DEFAULT_MODES) }

/** One valid `write` escalation approval request. */
function writeEscalation(overrides = {}) {
  const call = {
    name: 'write',
    arguments: {
      file_path: '/home/trh/Packages/example/report.txt',
      content: 'x',
      sandbox_permissions: 'danger-full-access',
      justification: 'The deliverable lives outside the session workspace.',
    },
    ...overrides.call,
  }
  const request = {
    toolName: 'write',
    callId: 'call-1',
    reason: `escalate sandbox to danger-full-access: ${call.arguments.justification}`,
    ...overrides.request,
  }
  return { call, request }
}

test('parseOptions fills defaults and validates each option', () => {
  const parsed = parseOptions()
  assert.deepEqual([...parsed.tools], [...DEFAULT_TOOLS])
  assert.deepEqual([...parsed.modes], [...DEFAULT_MODES])
  assert.equal(parsed.workspacesFile, defaultWorkspacesFile())
  assert.throws(() => parseOptions(null), /config must be an object/)
  assert.throws(() => parseOptions({ workspacesFile: 'relative.json' }), /absolute path/)
  assert.throws(() => parseOptions({ tools: [] }), /non-empty array/)
  assert.throws(() => parseOptions({ modes: ['ok', 3] }), /non-empty strings/)
  assert.throws(() => parseOptions({ typo: true }), /not a recognized option/)
  assert.deepEqual([...parseOptions({ tools: ['write'] }).tools], ['write'])
})

test('defaultWorkspacesFile prefers DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(
    defaultWorkspacesFile({ DSH_HOME: '/dsh-home' }, '/home/trh'),
    '/dsh-home/auto-approve-workspaces.json',
  )
  assert.equal(
    defaultWorkspacesFile({}, '/home/trh'),
    '/home/trh/.dsh/auto-approve-workspaces.json',
  )
})

test('parseWorkspaceConfig accepts an object or a bare array and dedupes canonical roots', () => {
  withTemp(dir => {
    const workspace = join(dir, 'workspace')
    mkdirSync(workspace)
    const objectForm = parseWorkspaceConfig(JSON.stringify({ workspaces: [workspace, workspace] }), 'file')
    assert.equal(objectForm.length, 1)
    assert.equal(objectForm[0].path, workspace)
    assert.equal(objectForm[0].canonical, canonicalPath(workspace))
    assert.equal(parseWorkspaceConfig(JSON.stringify([workspace]), 'file').length, 1)
  })
})

test('parseWorkspaceConfig rejects malformed files and relative workspaces', () => {
  assert.throws(() => parseWorkspaceConfig('not json', 'file'), /not valid JSON/)
  assert.throws(() => parseWorkspaceConfig('{}', 'file'), /must be an array or an object/)
  assert.throws(() => parseWorkspaceConfig('{"workspaces":["../rel"]}', 'file'), /must be an absolute path/)
  assert.throws(() => parseWorkspaceConfig('{"workspaces":[3]}', 'file'), /non-empty strings/)
})

test('canonicalPath resolves an existing prefix and keeps a missing suffix', () => {
  withTemp(dir => {
    mkdirSync(join(dir, 'existing'))
    assert.equal(canonicalPath(join(dir, 'existing', 'new', 'file.txt')), join(dir, 'existing', 'new', 'file.txt'))
  })
})

test('isUnder honors component boundaries', () => {
  assert.equal(isUnder('/a/b', '/a/b'), true)
  assert.equal(isUnder('/a/b/c', '/a/b'), true)
  assert.equal(isUnder('/a/bc', '/a/b'), false)
  assert.equal(isUnder('/a/b', '/a/bc'), false)
  assert.equal(isUnder('/a/b', '/'), true)
})

test('hasEscalationArgs requires both string fields', () => {
  assert.equal(hasEscalationArgs({ sandbox_permissions: 'workspace-write', justification: 'x' }), true)
  assert.equal(hasEscalationArgs({ sandbox_permissions: 'workspace-write' }), false)
  assert.equal(hasEscalationArgs({ justification: 'x' }), false)
  assert.equal(hasEscalationArgs(null), false)
  assert.equal(hasEscalationArgs([]), false)
})

test('verifyEscalation proves the exact sandbox reason before claiming a request', () => {
  const exact = writeEscalation()
  assert.deepEqual(verifyEscalation({ ...exact, options }), {
    mode: 'danger-full-access',
    justification: exact.call.arguments.justification,
    filePath: '/home/trh/Packages/example/report.txt',
  })
  const otherReason = writeEscalation({ request: { reason: 'Auto review denied tool "write"' } })
  assert.equal(verifyEscalation({ ...otherReason, options }), undefined)
  const otherTool = writeEscalation({ request: { toolName: 'bash' } })
  assert.equal(verifyEscalation({ ...otherTool, options }), undefined)
  const unconfiguredTool = writeEscalation()
  assert.equal(verifyEscalation({ ...unconfiguredTool, options: { tools: new Set(['edit']), modes: options.modes } }), undefined)
  const unconfiguredMode = writeEscalation()
  assert.equal(verifyEscalation({ ...unconfiguredMode, options: { tools: options.tools, modes: new Set(['workspace-write']) } }), undefined)
  assert.equal(verifyEscalation({ call: undefined, request: exact.request, options }), undefined)
  const noPath = writeEscalation({ call: { name: 'write', arguments: { sandbox_permissions: 'danger-full-access', justification: 'x' } } })
  noPath.request.reason = 'escalate sandbox to danger-full-access: x'
  assert.equal(verifyEscalation({ ...noPath, options }), undefined)
})

test('matchWorkspace contains absolute and relative paths and refuses symlink escapes', () => {
  withTemp(dir => {
    const workspace = join(dir, 'workspace')
    const outside = join(dir, 'outside')
    mkdirSync(workspace)
    mkdirSync(outside)
    symlinkSync(outside, join(workspace, 'escape'))
    const workspaces = parseWorkspaceConfig(JSON.stringify([workspace]), 'file')

    assert.deepEqual(matchWorkspace(join(workspace, 'file.txt'), dir, workspaces), {
      target: join(workspace, 'file.txt'),
      workspace,
    })
    assert.deepEqual(matchWorkspace('file.txt', workspace, workspaces), {
      target: join(workspace, 'file.txt'),
      workspace,
    })
    assert.equal(matchWorkspace(join(outside, 'file.txt'), dir, workspaces), undefined)
    assert.equal(matchWorkspace(join(workspace, 'escape', 'file.txt'), dir, workspaces), undefined)
    assert.equal(matchWorkspace('../outside/file.txt', workspace, workspaces), undefined)
  })
})

test('configSignature changes with the file and is undefined when missing', () => {
  withTemp(dir => {
    const file = join(dir, 'config.json')
    assert.equal(configSignature(file), undefined)
    writeFileSync(file, '{"workspaces":[]}')
    const first = configSignature(file)
    assert.notEqual(first, undefined)
    writeFileSync(file, '{"workspaces":["/tmp"]}')
    assert.notEqual(configSignature(file), first)
  })
})
