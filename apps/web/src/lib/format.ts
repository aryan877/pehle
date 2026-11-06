/** ₹4,500 / ₹1,23,456.78 with Indian digit grouping. */
export function rupees(paise: number): string {
  const value = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

/** "9:05" style remaining time; "0:00" once passed. */
export function clock(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function timeAgo(iso: string | number): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function timeOfDay(iso: string | number): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** "https://youtube.com/live/abc" or "youtu.be/abc" -> embeddable URL, or null for other hosts. */
export function youtubeEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com") {
      if (u.pathname.startsWith("/watch")) id = u.searchParams.get("v");
      else if (/^\/(live|shorts|embed)\//.test(u.pathname)) id = u.pathname.split("/")[2] ?? null;
    }
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0` : null;
  } catch {
    return null;
  }
}

export function streamHost(url: string | null | undefined): "youtube" | "instagram" | "facebook" | "other" | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (/youtu\.?be/.test(host)) return "youtube";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("facebook") || host.includes("fb.")) return "facebook";
    return "other";
  } catch {
    return null;
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : `/${path.replace(/^\//, "")}`;
}

/** "Meera Sarees" -> "Meera Sarees'", "Asha" -> "Asha's". */
export function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}
