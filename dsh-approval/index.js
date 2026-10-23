/**
 * Workspace auto-approval for sandbox escalation requests.
 *
 * DSH asks the user before a `sandbox_permissions` retry runs (see
 * `approveEscalation` in `@deepseek-ai/dsh-sandbox`). This plugin claims that
 * request — resolving it as `allowed-once` without a prompt — only when all of
 * the following are proven:
 *
 * 1. the request pairs with a pending call recorded at `tools/pre-execute`;
 * 2. the call carries `sandbox_permissions` + `justification`, the requested
 *    mode is configured, and the request reason is exactly
 *    `escalate sandbox to <mode>: <justification>`;
 * 3. the tool is a configured mutation tool (`write` and `edit` by default);
 * 4. the call's `file_path`, canonicalized (symlinks resolved), lies inside a
 *    workspace listed in the JSON configuration file.
 *
 * Everything else delegates to the next answerer (the user prompt). The plugin
 * is a prompt reducer, not a security boundary: it widens one path-verified
 * filesystem mutation call, and `bash`/`pwsh`/`run_code` escalations — whose
 * effects cannot be verified from arguments — always keep prompting.
 *
 * @module dsh-approval-workspaces
 */

import { isAbsolute } from 'node:path'
import {
  MAX_PENDING,
  configSignature,
  hasEscalationArgs,
  matchWorkspace,
  parseOptions,
  readWorkspaceConfig,
  verifyEscalation,
} from './logic.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'approval-workspaces'

/** Key one pending call by its session and call id. */
function keyOf(agent, callId) {
  return `${String(agent.session.id)}\u0000${String(callId)}`
}

/**
 * Install the approval answerer and its pending-call index.
 * @param {import('@cordisjs/core').Context} ctx - hosting plugin context.
 * @param {object} [config] - plugin row configuration (`workspacesFile`, `tools`, `modes`).
 */
export function apply(ctx, config = {}) {
  const options = parseOptions(config ?? {})
  const log = ctx.logger('approval-workspaces')
  const pending = new Map()
  const state = { signature: undefined, workspaces: [], error: undefined }

  /** Reload the workspace file when its signature changed; fail closed on error. */
  function refresh() {
    const signature = configSignature(options.workspacesFile)
    if (signature === undefined) {
      state.workspaces = []
      const message = `cannot read ${options.workspacesFile}`
      if (state.error !== message) {
        state.error = message
        log.warn(`${message}; sandbox escalations will keep prompting`)
      }
      state.signature = undefined
      return state
    }
    if (signature === state.signature) return state
    state.signature = signature
    try {
      const workspaces = readWorkspaceConfig(options.workspacesFile)
      state.workspaces = workspaces
      state.error = undefined
      log.info(`loaded ${workspaces.length} workspace(s) from ${options.workspacesFile}`)
    } catch (error) {
      state.workspaces = []
      state.error = error instanceof Error ? error.message : String(error)
      log.warn(`${state.error}; sandbox escalations will keep prompting`)
    }
    return state
  }

  /** Retain one escalating call for the approval request that follows. */
  function remember(exec) {
    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next().value
      if (oldest !== undefined) pending.delete(oldest)
    }
    pending.set(keyOf(exec.agent, exec.callId), { name: exec.name, arguments: exec.arguments })
  }

  /** Drop one call's retained arguments once its outcome is known. */
  function forget(exec) {
    if (exec.agent !== undefined) pending.delete(keyOf(exec.agent, exec.callId))
  }

  refresh()

  // Record before any downstream decision can ask for approval: the registry
  // dispatches `tools/pre-execute` and only then resolves an `ask` through the
  // approval seam. Calls without escalation arguments are not retained.
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.agent !== undefined && hasEscalationArgs(exec.arguments)) remember(exec)
    return next()
  })

  ctx.on('tools/result', (exec) => {
    forget(exec)
  })

  // Prepend so a verified escalation is claimed before the interactive
  // answerer sees it. Every unverified request delegates unchanged.
  ctx.on('approval/request', (request, next) => {
    if (request.callId === undefined || request.agent === undefined) return next()
    const call = pending.get(keyOf(request.agent, request.callId))
    const escalation = verifyEscalation({ call, request, options })
    if (escalation === undefined) return next()
    // An absolute target needs no session directory; a relative one is resolved
    // exactly as the filesystem tools resolve it, or the call stays unclaimed.
    const absolute = isAbsolute(escalation.filePath)
    const workingDirectory = absolute ? undefined : ctx.get('workingDirectory')
    if (!absolute && workingDirectory === undefined) {
      log.warn('no workingDirectory service; declining to auto-approve a relative path')
      return next()
    }
    const current = refresh()
    if (current.error !== undefined) return next()
    const containment = matchWorkspace(
      escalation.filePath,
      workingDirectory === undefined ? '' : workingDirectory.get(request.agent.session),
      current.workspaces,
    )
    if (containment === undefined) {
      log.info(
        `not auto-approved: ${escalation.filePath} is outside the configured workspaces `
        + `(${escalation.mode}, tool "${request.toolName}")`,
      )
      return next()
    }
    log.info(
      `auto-approved ${request.toolName} -> ${containment.target} `
      + `in ${containment.workspace} (${escalation.mode})`,
    )
    return Promise.resolve('allowed-once')
  }, { prepend: true })
}
