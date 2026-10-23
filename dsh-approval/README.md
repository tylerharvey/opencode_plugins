# dsh-approval-workspaces

A local DeepSeek Harness plugin that answers **sandbox escalation prompts** for configured workspaces instead of asking the user.

DSH confines a session to its workspace (`workspace-write`). When a tool must touch a path outside it, the model retries once with `sandbox_permissions` plus a justification, and DSH asks the user through the approval seam. The built-in **Auto Authorization Review** replaces that human decision with a per-call LLM review. This plugin replaces it, for one narrow class of calls, with a deterministic path check against a configuration file:

> Approve a `write`/`edit` sandbox escalation only when the call's `file_path`, with symlinks resolved, lies inside a listed workspace.

Everything else still prompts. `bash`, `pwsh`, and whole PTC `run_code` programs are never auto-approved: their effects cannot be verified from their arguments.

## Configuration file

Default path: `$DSH_HOME/auto-approve-workspaces.json` (on a stock install, `~/.dsh/auto-approve-workspaces.json`). Override it with the plugin row's `workspacesFile` option.

```json
{
  "workspaces": [
    "/home/trh/Packages/opencode_instructions",
    "/home/trh/Packages/opencode_artifacts",
    "/home/trh/Packages/opencode_plugins"
  ]
}
```

A bare array (`["/abs/path", ...]`) is also accepted. Entries must be absolute paths; relative entries, non-strings, invalid JSON, or a missing `workspaces` array make the plugin **fail closed** (it logs a warning and keeps prompting) rather than silently approving. The file is re-read when its size or mtime changes, so edits take effect without restarting DSH.

## Plugin options

The bundle row ships without `config`; these are the optional overrides. A matching patch override replaces the complete config.

```yaml
- id: approval-workspaces
  name: dsh-approval-workspaces
  config:
    workspacesFile: /dsh-home/auto-approve-workspaces.json  # absolute path
    tools: [write, edit]                                     # default
    modes: [danger-full-access]                              # default
```

- `tools` — mutation tools eligible for approval. Each must carry the target path in a required `file_path` string argument. Do not add `bash`, `pwsh`, or `run_code`: their arguments do not identify the paths they will touch.
- `modes` — requested escalation modes eligible for approval. `workspace-write` is not in the default because it grants only the session workspace root, so it cannot widen access to a different configured workspace; add it only when the session workspace itself is a listed workspace.

A plugin row with an unknown option, a relative `workspacesFile`, or an empty/non-string `tools`/`modes` entry fails at activation with the reason.

## How a request is matched

A sandbox escalation's approval request carries only `toolName`, `callId`, and the reason `escalate sandbox to <mode>: <justification>` (`approveEscalation` in `@deepseek-ai/dsh-sandbox`). The target path is not in the request, so the plugin:

1. records every `tools/pre-execute` call whose arguments contain string `sandbox_permissions` and `justification` (bounded to 512 pending calls, dropped on `tools/result`);
2. on `approval/request` (prepended, so it runs before the interactive answerer), pairs the request with that call by session id + `callId`;
3. reconstructs `escalate sandbox to <mode>: <justification>` and requires an exact match — any other asker (Auto review denials, hook asks, a changed DSH wording) falls through unchanged;
4. resolves `file_path` against the session working directory, canonicalizes the deepest existing ancestor with `realpathSync.native` (so a symlinked ancestor cannot smuggle the target out), and requires containment on a path-component boundary in a configured workspace;
5. returns `allowed-once`. The approval audit pair (`approval/asked` + `approval/decided`) is written by the approval service as usual.

A relative `file_path` is resolved against `ctx.workingDirectory`; without that service the plugin declines a relative target rather than guess.

## Safety limits

- This is a prompt reducer, not a security boundary. An approved escalation grants `danger-full-access` for that **one call**; for a `write`/`edit` call the only effect is the path-verified mutation.
- A symlink swapped between this check and the filesystem write races the check (the `danger-full-access` fence does not re-canonicalize). DSH's own sandbox accepts the same TOCTOU class for `workspace-write`.
- `write` content and `edit` replacements are not inspected; a listed workspace must be one whose files you are willing to let an agent rewrite.
- The session approval policy `never` rejects every ask before any answerer runs; this plugin cannot override it.
- Tools other than the configured `write`/`edit` (including `bash` chmod/symlink work) still prompt.

## Install and remove

From this checkout, the bundle is a linked local package. Install it into a profile with the plugin manager (`install_bundle`, target = this directory) or the CLI:

```sh
dsh plugin --profile web add /home/trh/Packages/opencode_plugins/dsh-approval
dsh plugin --profile web remove dsh-approval-workspaces
```

If pnpm refuses with `ERR_PNPM_UNEXPECTED_STORE`, the profile's `node_modules` records a store from another environment (for example the host's `~/.local/share/pnpm/store` while a container resolves `$DSH_HOME/.pnpm-store`). Fix the store on the machine that owns it, or pin a store directory both environments can reach. A local bundle can also be linked by hand: add `"dsh-approval-workspaces": "link:/home/trh/Packages/opencode_plugins/dsh-approval"` to the profile's `dependencies`, symlink it into the profile's `node_modules`, and select it with the Plugin Manager (`set_bundle`), which composes it live on an HMR profile.

## Verification

`node --test test/logic.test.mjs test/wiring.test.mjs` covers option validation, config parsing, canonicalization, containment (including symlink escape and path-component boundaries), the exact reason-pairing rule, and the installed `apply()` wiring against the real configuration file.

Live check: use a session in `workspace-write` mode, ensure a directory is listed in `auto-approve-workspaces.json`, then make a `write` call with `sandbox_permissions: "danger-full-access"` and a justification whose `file_path` is inside that directory. It should execute with no approval prompt; the same call targeting an unlisted directory should still prompt. (A session already in `danger-full-access` never asks, so it cannot exercise this plugin.)
