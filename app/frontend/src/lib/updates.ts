// In-app updates: ask the release manifest for a newer version, offer it as
// a toast, download with progress, then the installer takes over and the app
// relaunches. Quiet when offline, when the manifest is missing, or in the
// browser preview (no Wails runtime).
import { toast } from "sonner";
import { AppVersion, CheckForUpdate, InstallUpdate } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";

const RECHECK_MS = 6 * 60 * 60 * 1000;
const FOCUS_MS = 60 * 60 * 1000;

let offered: string | null = null;
let installing = false;
let lastCheck = 0;
let scheduled = false;

function hasRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).go?.main?.App?.CheckForUpdate) && Boolean((window as any).runtime);
}

/** The running build's version, or "dev" outside the desktop shell. */
export async function appVersion(): Promise<string> {
  try {
    return (await AppVersion()) || "dev";
  } catch {
    return "dev";
  }
}

/** Check once. `manual` reports "up to date" too; automatic checks stay silent unless there is news. */
export async function offerUpdate(manual: boolean): Promise<void> {
  if (installing || !hasRuntime()) {
    if (manual && !hasRuntime()) toast.info("Updates are checked in the installed app.");
    return;
  }
  lastCheck = Date.now();
  let available: Awaited<ReturnType<typeof CheckForUpdate>> | null = null;
  try {
    available = await CheckForUpdate();
  } catch (e: any) {
    if (manual) toast.error("Couldn't check for updates", { description: friendly(e) });
    return;
  }
  if (!available) {
    if (manual) toast.success(`AD Query ${await appVersion()} is up to date`);
    return;
  }
  if (!manual && offered === available.version) return;
  offered = available.version;
  const { version, current, notes, url, signature } = available;
  // A fixed id means a manual check re-surfaces the same toast instead of stacking another.
  toast(`Version ${version} is available`, {
    id: "update-available",
    description: `${summarize(notes) || "The update installs in the background and restarts the app."} You have ${current}.`,
    duration: Infinity,
    action: { label: "Install and restart", onClick: () => void install(url, signature) },
  });
}

async function install(url: string, signature: string): Promise<void> {
  if (installing) return;
  installing = true;
  const id = toast.loading("Downloading the update");
  const stop = EventsOn("update:progress", (p: { received: number; total: number }) => {
    const detail = p.total > 0 ? `${mb(p.received)} of ${mb(p.total)}` : mb(p.received);
    toast.loading(`Downloading the update: ${detail}`, { id });
  });
  try {
    await InstallUpdate(url, signature);
    toast.loading("Restarting into the new version", { id });
  } catch (e: any) {
    installing = false;
    toast.error("The update could not be installed", { id, description: friendly(e), duration: Infinity });
  } finally {
    stop();
  }
}

/** Launch check, periodic re-checks, and a check when the window comes back after a while. */
export function scheduleUpdateChecks(): void {
  if (scheduled || !hasRuntime()) return;
  scheduled = true;
  window.setTimeout(() => void offerUpdate(false), 4_000);
  window.setInterval(() => void offerUpdate(false), RECHECK_MS);
  window.addEventListener("focus", () => {
    if (Date.now() - lastCheck > FOCUS_MS) void offerUpdate(false);
  });
}

function summarize(text: string): string {
  const line = (text || "")
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0 && !raw.startsWith("#"))
    .map((raw) => raw.replace(/^[*\-]\s+/, "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/`/g, ""))
    .find((raw) => raw.length > 0);
  if (!line) return "";
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}...` : line;
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function friendly(e: any): string {
  return String(e?.message ?? e ?? "").replace(/^Error:\s*/, "");
}
