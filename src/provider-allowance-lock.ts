import { randomUUID } from "node:crypto";
import { link, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

type Owner = { version: 1; pid: number; host: string; nonce: string };
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

async function readOwner(path: string): Promise<Owner | undefined> {
  try {
    const owner = JSON.parse(await readFile(path, "utf8")) as Owner;
    if (owner.version === 1 && Number.isInteger(owner.pid) && owner.pid > 0
      && typeof owner.host === "string" && /^[0-9a-f-]{36}$/u.test(owner.nonce)) return owner;
  } catch (error) {
    if (!["ENOENT", "EISDIR"].includes(code(error) ?? "") && !(error instanceof SyntaxError)) throw error;
  }
  return undefined;
}

function provenDead(owner: Owner): boolean {
  if (owner.host !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return code(error) === "ESRCH"; }
}

/** A prepared owner inode is published atomically, so SIGTERM cannot leave an ownerless lock. */
export async function withProviderAllowanceLock<T>(target: string, action: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
  const lock = `${target}.lock`;
  const owner: Owner = { version: 1, pid: process.pid, host: hostname(), nonce: randomUUID() };
  const prepared = `${lock}.owner-${owner.nonce}`;
  await writeFile(prepared, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  try {
    while (!acquired) {
      try { await link(prepared, lock); acquired = true; }
      catch (error) {
        if (code(error) !== "EEXIST") throw error;
        const previous = await readOwner(lock);
        if (previous && provenDead(previous)) {
          // One reaper per dead nonce. Without this claim, two readers of a dead
          // owner could unlink a new live owner's lock between check and unlink.
          // Retain the tiny claim as evidence; if its reaper also dies, fail closed.
          const claim = `${lock}.reap-${previous.nonce}`;
          try {
            await link(prepared, claim);
            if ((await readOwner(lock))?.nonce === previous.nonce) await unlink(lock);
          } catch (recoveryError) {
            if (!["EEXIST", "ENOENT"].includes(code(recoveryError) ?? "")) throw recoveryError;
          }
        }
        if (Date.now() >= deadline) throw new Error("Development allowance lock unavailable; provider HTTP refused (owner live, unknown, or recovery interrupted)");
        await delay(20);
      }
    }
    return await action();
  } finally {
    if (acquired && (await readOwner(lock))?.nonce === owner.nonce) await unlink(lock);
    await rm(prepared, { force: true });
  }
}
