import { get } from "svelte/store";
import { currentLang } from "./i18n";

// A friend as returned by GET /friends. activity/version/server are only set while online.
export type Friend = {
  uuid?: string;
  name: string;
  online: boolean;
  activity?: "launcher" | "game" | "";
  version?: string | null;
  server?: string | null;
  lastSeen?: number | null;
};

/** Status line under a friend's name: where they are, or when they were last seen. */
export function presenceText(f: Friend, tr: (key: string) => string): string {
  if (f.online) {
    if (f.server) return `${tr("friends.playing")} ${f.server}`;
    if (f.activity === "game") return `${tr("friends.inGame")} ${f.version ?? ""}`.trim();
    if (f.activity === "launcher") return tr("friends.inLauncher");
    return tr("friends.online");
  }
  if (!f.lastSeen) return tr("friends.offline");
  const rtf = new Intl.RelativeTimeFormat(get(currentLang), { numeric: "auto" });
  const minutes = Math.round((f.lastSeen - Date.now()) / 60_000);
  const ago =
    minutes > -60 ? rtf.format(minutes, "minute")
    : minutes > -1440 ? rtf.format(Math.round(minutes / 60), "hour")
    : rtf.format(Math.round(minutes / 1440), "day");
  return `${tr("friends.offline")} · ${ago}`;
}

/** Minecraft head (with hat layer) for a player name. */
export const headUrl = (name: string, size = 32) =>
  `https://minotar.net/helm/${encodeURIComponent(name || "Steve")}/${size}`;
