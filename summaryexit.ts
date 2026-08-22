import type { Plugin } from "@opencode-ai/plugin"

/**
 * Session-ender plugin that powers the `/summaryexit` command.
 *
 * The `/summaryexit` command itself is defined in
 * `~/.config/opencode/command/summaryexit.md`. This plugin makes it work:
 *
 *   1. `command.execute.before` injects the current session name + session ID
 *      into the command prompt, so the model can put them in the summary file.
 *   2. `event` detects when the summary prompt has been answered via the
 *      `command.executed` event (fires right after the command's prompt
 *      finishes) or the `session.idle` event, then triggers exit.
 *
 * Exit strategy (in order):
 *   a. Publish a raw `tui.command.execute` event for `app.exit` (the TUI's
 *      registered exit command, slash `/exit`). `client.tui.executeCommand()`
 *      cannot be used because the server only forwards a fixed alias set.
 *   b. Fall back to hard-exiting the process after a short delay, in case the
 *      TUI event was dropped (it is filtered by the TUI's current workspace).
 */
export const SummaryExit: Plugin = async ({ client }) => {
  // Sessions for which /summaryexit has run and exit is still pending.
  const pendingExit = new Set<string>()
  const exiting = new Set<string>()

  const log = (message: string, extra?: Record<string, unknown>) => {
    try {
      void client.app.log({ body: { service: "summaryexit", level: "info", message, extra } })
    } catch {
      // logging is best-effort
    }
  }

  const triggerExit = async (sessionID: string) => {
    if (exiting.has(sessionID)) return
    exiting.add(sessionID)
    log("summary prompt answered; triggering exit", { sessionID })

    // Graceful path: ask the TUI to run its exit command.
    for (const command of ["app.exit", "exit", "quit"]) {
      try {
        await client.tui.publish({
          body: { type: "tui.command.execute", properties: { command } },
        })
        break
      } catch {
        // try the next command name
      }
    }

    // Guaranteed fallback: if the graceful path was dropped (TUI workspace
    // filter) or the process did not exit, terminate it. The summary file has
    // already been written by the model, and SQLite WAL is crash-safe.
    setTimeout(() => {
      try {
        const proc = (globalThis as unknown as { process?: { exit(code?: number): void } }).process
        proc?.exit?.(0)
      } catch {
        // nothing else to fall back to
      }
    }, 2000)
  }

  return {
    "command.execute.before": async (input, output) => {
      if (input.command !== "summaryexit") return

      let title: string | undefined
      try {
        const { data } = await client.session.get({ path: { id: input.sessionID } })
        title = data?.title
      } catch {
        title = undefined
      }

      const meta =
        "\n\nSession metadata:\n" +
        `- Session name: ${title ?? input.sessionID}\n` +
        `- Session ID: ${input.sessionID}\n`

      const textPart = output.parts.find((p) => p.type === "text") as
        | { type: "text"; text: string }
        | undefined
      if (textPart) {
        textPart.text += meta
      } else {
        const subtask = output.parts.find((p) => p.type === "subtask") as
          | { type: "subtask"; prompt: string }
          | undefined
        if (subtask) subtask.prompt += meta
      }

      pendingExit.add(input.sessionID)
      log("summaryexit started", { sessionID: input.sessionID })
    },

    event: async ({ event }) => {
      // `command.executed` fires right after the /summaryexit prompt completes;
      // `session.idle` is a backup in case that event is missed.
      const sessionID =
        event.type === "command.executed" && event.properties.name === "summaryexit"
          ? event.properties.sessionID
          : event.type === "session.idle"
            ? event.properties.sessionID
            : undefined
      if (sessionID && pendingExit.has(sessionID)) {
        pendingExit.delete(sessionID)
        await triggerExit(sessionID)
      }
    },
  }
}
