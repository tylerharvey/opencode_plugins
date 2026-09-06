import { jsx, jsxs } from "@opentui/solid/jsx-runtime";
import type { TuiPluginModule } from "@opencode-ai/plugin/tui";

const TICK_KEY = "deepseek_peak:tick";

const MINUTES_PER_WEEK = 7 * 24 * 60;

const isWeekend = (day: number): boolean => day === 0 || day === 6;

const isOnPeak = (day: number, hour: number): boolean => {
  if (isWeekend(day)) return false;
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour <= 10);
};

const peakStatus = () => {
  const now = new Date();
  const d = now.getUTCDay();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const onPeak = isOnPeak(d, h);
  const nowMins = d * 1440 + h * 60 + m;

  const minutesUntil = (targetDay: number, targetHour: number): number => {
    const targetMins = targetDay * 1440 + targetHour * 60;
    return (((targetMins - nowMins) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  };

  let nextDay: number;
  let nextHour: number;
  let label: "start" | "end";

  if (isWeekend(d)) {
    // Weekends are off-peak around the clock; next peak is Monday 01:00 UTC.
    nextDay = 1; // Monday 01:00 UTC
    nextHour = 1;
    label = "start";
  } else if (onPeak) {
    // On-peak window ends at the top of the hour following the last peak hour.
    nextDay = d;
    nextHour = h >= 1 && h < 4 ? 4 : 11;
    label = "end";
  } else if (h < 1) {
    nextDay = d;
    nextHour = 1;
    label = "start";
  } else if (h < 6) {
    nextDay = d;
    nextHour = 6;
    label = "start";
  } else {
    nextDay = (d + 1) % 7;
    nextHour = 1;
    if (isWeekend(nextDay)) nextDay = 1;
    label = "start";
  }

  const diffMins = minutesUntil(nextDay, nextHour);

  return { onPeak, h, m, label, diffMins };
};

const pad = (n: number): string => String(n).padStart(2, "0");

const formatDuration = (mins: number): string => {
  if (mins < 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

const plugin: TuiPluginModule = {
  id: "deepseek-peak-tui",
  tui: async (api) => {
    // Idle tick: bump a reactive kv key so the slot re-renders even when
    // the app is otherwise idle (mirrors the internal "Context" widget's
    // reactivity, which the host drives through api.state reads).
    const timer = setInterval(() => {
      api.kv.set(TICK_KEY, Date.now());
    }, 60_000);
    api.lifecycle.onDispose(() => clearInterval(timer));

    api.slots.register({
      order: 90,
      slots: {
        sidebar_content: (_ctx, props) => {
          const sessionID = props.session_id;

          // Reactive subscriptions: the host's Slot memo tracks these reads
          // and re-runs this renderer on (a) the kv tick above and (b) any
          // session message/part activity, so the badge stays live.
          api.kv.get(TICK_KEY);
          const messages = api.state.session.messages(sessionID);
          const last = messages[messages.length - 1];
          if (last) api.state.part(last.id);

          const data = peakStatus();
          return jsxs("box", {
            style: { border: false, padding: { left: 1, right: 1, top: 0, bottom: 0 }, gap: 1 },
            children: [
              jsx("text", {
                style: {
                  fg: data.onPeak ? "rgb(255,180,0)" : "rgb(0,200,100)",
                  bold: true,
                },
                children: `${data.onPeak ? "[!] ON-PEAK" : "[$] OFF-PEAK"} ${pad(data.h)}:${pad(data.m)} UTC`,
              }),
              jsx("text", {
                style: { fg: "rgb(150,150,150)" },
                children: `  ${data.onPeak ? "Expensive" : "Cheaper"} | peak ${data.label}s in ${formatDuration(data.diffMins)}`,
              }),
            ],
          });
        },
      },
    });
  },
};

export default plugin;
