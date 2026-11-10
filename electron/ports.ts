// The local ports Readr's helpers listen on. Each run takes free ones, so two copies of Readr, or another
// program that happens to use a port, never get in each other's way. READR_SIDECAR_PORT and READR_TTS_PORT
// pin them instead (tests, and development against servers started by hand).

import net from "node:net";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export interface HelperPorts {
  sidecar: number;
  tts: number;
  /** The speech runner the voice server starts. */
  runner: number;
  /** Chosen by the environment: a helper already answering there may be used as it is. */
  pinned: boolean;
}

/** The ports named by the environment, known before anything is started. Not pinned: nothing to talk to yet
 * (port 0 refuses at once), so nothing is ever sent to whatever program happens to hold a well-known port. */
export function pinnedPorts(env: Record<string, string | undefined>): HelperPorts {
  const pinned = Boolean(env.READR_SIDECAR_PORT || env.READR_TTS_PORT);
  if (!pinned) return { sidecar: 0, tts: 0, runner: 0, pinned };
  const sidecar = Number(env.READR_SIDECAR_PORT) || 8765;
  const tts = Number(env.READR_TTS_PORT) || 8766;
  return { sidecar, tts, runner: tts + 1, pinned };
}

/** The ports for this run: the pinned ones, or three free ones. */
export async function helperPorts(env: Record<string, string | undefined>): Promise<HelperPorts> {
  const pinned = pinnedPorts(env);
  if (pinned.pinned) return pinned;
  // Held open together, so the three are different.
  const servers = await Promise.all([0, 1, 2].map(() => listenAnywhere()));
  const [sidecar, tts, runner] = servers.map((s) => (s.address() as net.AddressInfo).port);
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  return { sidecar, tts, runner, pinned: false };
}

function listenAnywhere(): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

export type Answer = "ours" | "stranger" | "nobody";

/** Who answers at `base`: one of Readr's helpers (its /health says so), another program, or nobody. */
export async function whoAnswers(base: string): Promise<Answer> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(800) });
    const body = (await res.json().catch(() => null)) as { app?: unknown } | null;
    return body?.app === "readr" ? "ours" : "stranger";
  } catch (err) {
    // Refused or timed out: nobody. Anything that answered at all, even with nonsense, is a stranger.
    return err instanceof TypeError || (err as Error)?.name === "TimeoutError" ? "nobody" : "stranger";
  }
}
