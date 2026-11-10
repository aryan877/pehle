/**
 * "Sun 16 Nov, 7:00 pm", or "Today, 7:00 pm" / "Tomorrow, 7:00 pm" when close. Pass `inline` when
 * it follows other words ("Starts tomorrow, 7:00 pm").
 */
export function dropTime(iso: string, inline = false): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(date, today)) return `${inline ? "today" : "Today"}, ${time}`;
  if (sameDay(date, tomorrow)) return `${inline ? "tomorrow" : "Tomorrow"}, ${time}`;
  const day = date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${day.replace(",", "")}, ${time}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2 d 4 h", "3 h 12 min", "8 min 05 s". */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

/** Seconds as a short duration: "0.07 s", "42 s", "3 min 10 s", "1 h 4 min". */
export function shortDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "Not yet";
  if (seconds < 10) return `${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) {
    const s = Math.round(seconds % 60);
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** ISO timestamp to the value a `datetime-local` input expects, in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value back to ISO, or null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A sensible default start: the next round hour at least an hour from now. */
export function suggestedStart(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return toLocalInput(date.toISOString());
}
