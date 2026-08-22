export const deepseekPeak = async (_ctx) => {
    const now = () => new Date()
    const utcHour = (): number => now().getUTCHours()
    const minutesUntil = (targetHour: number): number => {
      const nowH = utcHour()
      const diff = (targetHour - nowH + 24) % 24
      return diff * 60
    }
    const isOnPeak = (hour: number): boolean => {
      return (hour >= 1 && hour < 4) || (hour >= 6 && hour <= 10)
    }
    const peakStatus = (): {
      onPeak: boolean
      status: "on-peak" | "off-peak"
      nextTransition: "start" | "end"
      minutesUntil: number
      currentHour: number
    } => {
      const h = utcHour()
      const on = isOnPeak(h)
      if (on) {
        let endHour: number
        let label: "start" | "end"
        if (h >= 1 && h < 4) {
          endHour = 4; label = "end"
        } else {
          endHour = 10; label = "end"
        }
        const mins = minutesUntil(endHour)
        return { onPeak: true, status: "on-peak", nextTransition: label, minutesUntil: mins, currentHour: h }
      }
      let mins: number
      if (h < 1) { mins = minutesUntil(1) }
      else if (h < 4) { mins = minutesUntil(4) }
      else if (h < 6) { mins = minutesUntil(6) }
      else if (h <= 10) { mins = minutesUntil(1 + 24) }
      else { mins = minutesUntil(1 + 24) }
      return { onPeak: false, status: "off-peak", nextTransition: "start", minutesUntil: mins, currentHour: h }
    }
    const formatDuration = (mins: number): string => {
      if (mins < 0) return "0m"
      const h = Math.floor(mins / 60)
      const m = mins % 60
      if (h > 0 && m > 0) return `${h}h ${m}m`
      if (h > 0) return `${h}h`
      return `${m}m`
    }
    const systemBlock = (ctx: ReturnType<typeof peakStatus>): string => {
      const { onPeak, status, nextTransition, minutesUntil, currentHour } = ctx
      const duration = formatDuration(minutesUntil)
      const lines: string[] = []
      lines.push("=== DeepSeek Peak Hours ===")
      lines.push(`Current UTC hour: ${currentHour}:00`)
      lines.push(`Status: ${status} (${status === "on-peak" ? "expensive" : "cheaper"})`)
      lines.push(`Next transition: ${nextTransition} of on-peak period in ${duration}`)
      if (onPeak) {
        lines.push("⚠️  On-peak pricing active. DeepSeek costs more during 1-4 UTC and 6-10 UTC.")
        if (nextTransition === "end") {
          lines.push(`💡 Off-peak begins in ${duration}. Consider deferring non-urgent work.`)
        }
      } else {
        lines.push("💰 Off-peak pricing active. DeepSeek is cheaper now.")
        if (nextTransition === "start") {
          lines.push(`⏰ On-peak resumes in ${duration}. Save heavy work for off-peak if possible.`)
        }
      }
      lines.push("===========================")
      return lines.join("\n")
    }
    return {
        "experimental.chat.system.transform": async (input, output) => {
          const status = peakStatus()
          output.system = [...(output.system || []), systemBlock(status)]
        },
    }
}
