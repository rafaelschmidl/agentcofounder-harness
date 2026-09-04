import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { withProviderAllowanceLock } from "../src/provider-allowance-lock.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function fixture(run: (target: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "allowance-owner-"));
  try { await run(join(dir, "ledger.json")); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

function child(target: string, code: string) {
  return spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, target], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

it("recovers a killed owner with concurrent contenders without losing ledger increments", async () => {
  await fixture(async (target) => {
    const original = { unknown_request: { status: "unknown", cost_total: 0.393216 }, count: 0 };
    await writeFile(target, JSON.stringify(original));
    const holder = child(target, `import {withProviderAllowanceLock} from './src/provider-allowance-lock.ts';
      await withProviderAllowanceLock(process.argv[1], async()=>{setInterval(()=>{},1000);process.stdout.write('owned');await new Promise(()=>{});});`);
    try {
      await once(holder.stdout!, "data");
      // Seeing a published lock always means its complete owner is already readable.
      const owner = JSON.parse(await readFile(`${target}.lock`, "utf8"));
      expect(owner).toMatchObject({ pid: holder.pid, host: hostname(), version: 1 });
      expect(owner.nonce).toMatch(/^[0-9a-f-]{36}$/u);
      const exit = once(holder, "close"); expect(holder.kill("SIGKILL")).toBe(true); expect(await exit).toEqual([null, "SIGKILL"]);
      const contenders = Array.from({ length: 5 }, () => child(target, `
        import {withProviderAllowanceLock} from './src/provider-allowance-lock.ts';
        import {readFile,writeFile} from 'node:fs/promises';
        await withProviderAllowanceLock(process.argv[1],async()=>{
          const v=JSON.parse(await readFile(process.argv[1],'utf8'));
          await new Promise(r=>setTimeout(r,35));v.count++;await writeFile(process.argv[1],JSON.stringify(v));
        });`));
      expect(await Promise.all(contenders.map(async (p) => (await once(p, "close"))[0]))).toEqual([0, 0, 0, 0, 0]);
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ ...original, count: 5 });
      await expect(readFile(`${target}.lock`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(`${target}.lock.reap-${owner.nonce}`, "utf8"))).toMatchObject({ version: 1, host: hostname() });
    } finally { holder.kill("SIGKILL"); }
  });
});

it("never steals a live, foreign, malformed, legacy, or unprovable-owner lock", async () => {
  for (const kind of ["live", "foreign", "malformed", "legacy", "permission"] as const) {
    await fixture(async (target) => {
      const owner = { version: 1, pid: process.pid, host: kind === "foreign" ? "another-host" : hostname(), nonce: randomUUID() };
      const contents = kind === "malformed" ? "{broken" : JSON.stringify(owner);
      if (kind === "legacy") await mkdir(`${target}.lock`);
      else await writeFile(`${target}.lock`, contents);
      const action = vi.fn(async () => undefined);
      const kill = kind === "permission" ? vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("no permission"), { code: "EPERM" }); }) : undefined;
      try {
        await expect(withProviderAllowanceLock(target, action, 50)).rejects.toThrow("lock unavailable");
        expect(action).not.toHaveBeenCalled();
        if (kind !== "legacy") expect(await readFile(`${target}.lock`, "utf8")).toBe(contents);
      } finally { kill?.mockRestore(); }
    });
  }
});

it("retains an interrupted recovery claim and fails closed without changing the ledger", async () => {
  await fixture(async (target) => {
    const owner = { version: 1, pid: process.pid, host: hostname(), nonce: randomUUID() };
    await writeFile(`${target}.lock`, JSON.stringify(owner));
    await writeFile(`${target}.lock.reap-${owner.nonce}`, "retained earlier recovery claim");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
    const action = vi.fn(async () => undefined);
    try {
      await expect(withProviderAllowanceLock(target, action, 50)).rejects.toThrow("recovery interrupted");
      expect(action).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(`${target}.lock`, "utf8"))).toEqual(owner);
    } finally { kill.mockRestore(); }
  });
});
