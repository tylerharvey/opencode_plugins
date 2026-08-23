export const deepseekPeak = async (_ctx) => {
    const now = () => new Date()
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const MINUTES_PER_WEEK = 7 * 24 * 60
    const utcHour = (): number => now().getUTCHours()
    const utcDay = (): number => now().getUTCDay() // 0 = Sunday, 6 = Saturday
    const isWeekend = (day: number): boolean => day === 0 || day === 6
    const minutesUntil = (targetDay: number, targetHour: number): number => {
      const nowMins = utcDay() * 1440 + utcHour() * 60
      const targetMins = targetDay * 1440 + targetHour * 60
      return (((targetMins - nowMins) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
    }
    const isOnPeak = (day: number, hour: number): boolean => {
      if (isWeekend(day)) return false
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
      const d = utcDay()
      if (isWeekend(d)) {
        // Weekends are off-peak around the clock; next peak is Monday 01:00 UTC
        const mins = minutesUntil(1, 1)
        return { onPeak: false, status: "off-peak", nextTransition: "start", minutesUntil: mins, currentHour: h }
      }
      if (isOnPeak(d, h)) {
        const endHour = h >= 1 && h < 4 ? 4 : 11
        const mins = minutesUntil(d, endHour)
        return { onPeak: true, status: "on-peak", nextTransition: "end", minutesUntil: mins, currentHour: h }
      }
      let mins: number
      if (h < 1) { mins = minutesUntil(d, 1) }
      else if (h < 6) { mins = minutesUntil(d, 6) }
      else {
        let nextDay = (d + 1) % 7
        if (isWeekend(nextDay)) nextDay = 1
        mins = minutesUntil(nextDay, 1)
      }
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
      lines.push(`Current UTC: ${DAY_NAMES[now().getUTCDay()]} ${currentHour}:00`)
      lines.push(`Status: ${status} (${status === "on-peak" ? "expensive" : "cheaper"})`)
      lines.push(`Next transition: ${nextTransition} of on-peak period in ${duration}`)
      if (isWeekend(now().getUTCDay())) {
        lines.push("Weekend: all hours are off-peak.")
      }
      if (onPeak) {
        lines.push("On-peak pricing active. DeepSeek costs more during 1-4 UTC and 6-10 UTC.")
        if (nextTransition === "end") {
          lines.push(`Off-peak begins in ${duration}. Consider deferring non-urgent work.`)
        }
      } else {
        lines.push("Off-peak pricing active. DeepSeek is cheaper now.")
        if (nextTransition === "start") {
          lines.push(`On-peak resumes in ${duration}. Save heavy work for off-peak if possible.`)
        }
      }
      lines.push("===========================")
      return lines.join("\n")
    }
    return {
        "experimental.chat.system.transform": async (input, output) => {
          const status = peakStatus()
          ;(output.system ??= []).push(systemBlock(status))
        },
    }
}
