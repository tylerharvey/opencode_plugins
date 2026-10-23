/**
 * Decision helpers for the workspace auto-approval plugin.
 *
 * A sandbox escalation names no target path: `approveEscalation` sends the
 * approval seam only `toolName`, `callId`, and a reason of the form
 * `escalate sandbox to <mode>: <justification>`. The plugin therefore pairs
 * each request with the pending call recorded at `tools/pre-execute`,
 * reconstructs that reason from the call's `sandbox_permissions` and
 * `justification` arguments, and only then checks the call's `file_path`
 * against the configured workspaces. Anything that does not match exactly
 * stays with the next answerer (the user prompt).
 *
 * Node builtins only: the bundle is linked into a profile and carries no
 * build step or install of its own.
 *
 * @module dsh-approval-workspaces/logic
 */

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

/** Tools the plugin may approve when not configured otherwise. */
export const DEFAULT_TOOLS = Object.freeze(['write', 'edit'])

/**
 * Escalation modes the plugin may approve when not configured otherwise.
 * `workspace-write` is excluded: it grants only the session workspace root,
 * so it cannot widen access to a different configured workspace.
 */
export const DEFAULT_MODES = Object.freeze(['danger-full-access'])

/** Exact prefix `approveEscalation` puts in front of the requested mode. */
export const SANDBOX_REASON_PREFIX = 'escalate sandbox to '

/** Largest number of pending calls retained for request pairing. */
export const MAX_PENDING = 512

/**
 * The config file path used when the plugin row sets none.
 * @param {NodeJS.ProcessEnv} [env] - environment to read (defaults to `process.env`).
 * @param {string} [home] - home directory fallback (defaults to `os.homedir()`).
 * @returns {string} absolute path of `auto-approve-workspaces.json` under `$DSH_HOME`.
 */
export function defaultWorkspacesFile(env = process.env, home = homedir()) {
  const dshHome = typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0
    ? env.DSH_HOME
    : join(home, '.dsh')
  return join(dshHome, 'auto-approve-workspaces.json')
}

/** Return one error's message without trusting the thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Report one malformed value with its config key. */
function invalid(key, detail) {
  return new Error(`dsh-approval-workspaces: config.${key} ${detail}`)
}

/** Read a non-empty string array option, or its default. */
function stringList(value, fallback, key) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid(key, 'must be a non-empty array of strings')
  }
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw invalid(key, 'must contain only non-empty strings')
    }
    seen.add(entry)
  }
  return [...seen]
}

/**
 * Validate the plugin row's `config` and fill its defaults.
 * @param {unknown} config - raw plugin configuration from the Loader entry.
 * @returns {{ workspacesFile: string, tools: Set<string>, modes: Set<string> }} normalized options.
 * @throws when a field is missing, mistyped, or unknown.
 */
export function parseOptions(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('dsh-approval-workspaces: config must be an object')
  }
  const record = /** @type {Record<string, unknown>} */ (config)
  const known = new Set(['workspacesFile', 'tools', 'modes'])
  for (const key of Object.keys(record)) {
    if (!known.has(key)) throw invalid(key, 'is not a recognized option')
  }
  const workspacesFile = record.workspacesFile ?? defaultWorkspacesFile()
  if (typeof workspacesFile !== 'string' || !isAbsolute(workspacesFile)) {
    throw invalid('workspacesFile', 'must be an absolute path')
  }
  return {
    workspacesFile,
    tools: new Set(stringList(record.tools, DEFAULT_TOOLS, 'tools')),
    modes: new Set(stringList(record.modes, DEFAULT_MODES, 'modes')),
  }
}

/**
 * Resolve one path to the spelling the enforcing layers compare: the deepest
 * existing ancestor is canonicalized (native realpath), and any missing
 * suffix is appended to it. Mirrors the filesystem sandbox's containment
 * identity so a symlinked ancestor cannot smuggle a target out of a root.
 * @param {string} path - absolute path to canonicalize.
 * @returns {string} a canonical absolute path (the resolved input on failure).
 */
export function canonicalPath(path) {
  const absolute = resolve(path)
  const tail = []
  let current = absolute
  for (;;) {
    try {
      const real = realpathSync.native(current)
      return tail.length === 0 ? real : join(real, ...tail)
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return absolute
      const parent = dirname(current)
      if (parent === current) return absolute
      tail.unshift(basename(current))
      current = parent
    }
  }
}

/**
 * Whether a canonical target is a root or lies beneath it, on a path
 * component boundary.
 * @param {string} target - canonical target path.
 * @param {string} root - canonical root path.
 * @param {boolean} [caseSensitive] - comparison case; defaults to the host convention.
 * @returns {boolean} whether the target is contained by the root.
 */
export function isUnder(target, root, caseSensitive = process.platform !== 'win32') {
  const comparableTarget = caseSensitive ? target : target.toLowerCase()
  const comparableRoot = caseSensitive ? root : root.toLowerCase()
  if (comparableTarget === comparableRoot) return true
  const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep
  return comparableTarget.startsWith(prefix)
}

/**
 * Parse the workspace list file. Accepts either
 * `{ "workspaces": ["/abs/path", ...] }` or a bare `["/abs/path", ...]`.
 * @param {string} text - file contents.
 * @param {string} source - path used in diagnostics.
 * @returns {Array<{ path: string, canonical: string }>} canonical workspace entries.
 * @throws when the JSON or an entry is invalid.
 */
export function parseWorkspaceConfig(text, source) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`dsh-approval-workspaces: ${source} is not valid JSON: ${messageOf(error)}`)
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.workspaces)
      ? parsed.workspaces
      : undefined
  if (entries === undefined) {
    throw new Error(`dsh-approval-workspaces: ${source} must be an array or an object with a "workspaces" array`)
  }
  const workspaces = []
  const seen = new Set()
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`dsh-approval-workspaces: ${source} "workspaces" must contain only non-empty strings`)
    }
    if (!isAbsolute(entry)) {
      throw new Error(`dsh-approval-workspaces: ${source} workspace ${JSON.stringify(entry)} must be an absolute path`)
    }
    const canonical = canonicalPath(entry)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    workspaces.push({ path: entry, canonical })
  }
  return workspaces
}

/**
 * Whether one call carries the escalation argument pair the plugin inspects.
 * @param {unknown} args - parsed tool arguments.
 * @returns {boolean} true when both escalation fields are strings.
 */
export function hasEscalationArgs(args) {
  return args !== null
    && typeof args === 'object'
    && !Array.isArray(args)
    && typeof (/** @type {Record<string, unknown>} */ (args).sandbox_permissions) === 'string'
    && typeof (/** @type {Record<string, unknown>} */ (args).justification) === 'string'
}

/**
 * Prove that one approval request is the sandbox escalation of one recorded
 * call. Returns undefined for every other request (other askers, other tools,
 * a mismatched reason), so the plugin only ever claims escalations it can see
 * the arguments of.
 * @param {object} input - matching inputs.
 * @param {{ name: string, arguments: unknown } | undefined} input.call - pending call recorded at pre-execute.
 * @param {{ toolName: string, callId?: string, reason?: string }} input.request - approval request.
 * @param {{ tools: Set<string>, modes: Set<string> }} input.options - normalized plugin options.
 * @returns {{ mode: string, justification: string, filePath: string } | undefined} verified escalation, else undefined.
 */
export function verifyEscalation({ call, request, options }) {
  if (call === undefined || request.callId === undefined || request.reason === undefined) return undefined
  if (request.toolName !== call.name || !options.tools.has(call.name)) return undefined
  if (!hasEscalationArgs(call.arguments)) return undefined
  const args = /** @type {Record<string, string>} */ (call.arguments)
  const mode = args.sandbox_permissions
  const justification = args.justification
  if (!options.modes.has(mode)) return undefined
  if (request.reason !== `${SANDBOX_REASON_PREFIX}${mode}: ${justification}`) return undefined
  const filePath = args.file_path
  if (typeof filePath !== 'string' || filePath.length === 0) return undefined
  return { mode, justification, filePath }
}

/**
 * Resolve one escalation target and find the configured workspace containing it.
 * @param {string} filePath - the call's `file_path` argument.
 * @param {string} cwd - session working directory for relative paths.
 * @param {Array<{ path: string, canonical: string }>} workspaces - canonical workspace entries.
 * @returns {{ target: string, workspace: string } | undefined} containment result, else undefined.
 */
export function matchWorkspace(filePath, cwd, workspaces) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
  const target = canonicalPath(absolute)
  for (const workspace of workspaces) {
    if (isUnder(target, workspace.canonical)) {
      return { target, workspace: workspace.path }
    }
  }
  return undefined
}

/**
 * Read and parse the workspace list file.
 * @param {string} file - absolute config path.
 * @returns {Array<{ path: string, canonical: string }>} canonical workspace entries.
 * @throws when the file cannot be read or parsed.
 */
export function readWorkspaceConfig(file) {
  return parseWorkspaceConfig(readFileSync(file, 'utf8'), file)
}

/**
 * Cheap change signature for the config file; undefined when it is missing.
 * @param {string} file - absolute config path.
 * @returns {string | undefined} a signature that changes when the file changes.
 */
export function configSignature(file) {
  try {
    const info = statSync(file)
    return `${info.mtimeMs}:${info.size}`
  } catch {
    return undefined
  }
}
