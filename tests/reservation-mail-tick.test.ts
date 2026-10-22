// The tick lock must be released when the shell exits. These tests use a
// stand-in node and a temporary home. They do not install launchd or send mail.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const TICK = new URL("../scripts/reservation-mail-tick.sh", import.meta.url);

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "reservation-tick-"));
  const bin = join(home, "bin");
  const root = join(home, "root");
  const privateHome = join(home, "private");
  const log = join(home, "node.log");
  await mkdir(bin);
  await mkdir(root);
  await writeFile(
    join(bin, "node"),
    "#!/bin/sh\necho ran >> \"$NODE_LOG\"\nexit \"${NODE_EXIT:-0}\"\n",
  );
  await chmod(join(bin, "node"), 0o755);
  await writeFile(join(home, "mail.env"), "\n");
  return { home, bin, root, privateHome, log };
}

function runTick(
  paths: { bin: string; root: string; privateHome: string; log: string; home: string },
  nodeExit = "0",
) {
  return spawnSync("/bin/sh", [fileURLToPath(TICK)], {
    env: {
      PATH: `${paths.bin}:/usr/bin:/bin`,
      HOME: paths.home,
      NODE_LOG: paths.log,
      NODE_EXIT: nodeExit,
      WATCHDIVE_RESERVATION_MAIL_ROOT: paths.root,
      WATCHDIVE_RESERVATION_MAIL_HOME: paths.privateHome,
      WATCHDIVE_RESERVATION_MAIL_ENV: join(paths.home, "mail.env"),
    },
    encoding: "utf8",
  });
}

test("a finished tick removes the lock", async () => {
  const paths = await fixture();
  const result = runTick(paths);
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(paths.log, "utf8"), /ran/);
  await assert.rejects(stat(join(paths.privateHome, "tick.lock")));
  await rm(paths.home, { recursive: true, force: true });
});

test("a failing node still removes the lock", async () => {
  const paths = await fixture();
  const result = runTick(paths, "1");
  assert.equal(result.status, 1);
  await assert.rejects(stat(join(paths.privateHome, "tick.lock")));
  await rm(paths.home, { recursive: true, force: true });
});

test("a dead pid is reclaimed and a live pid is left alone", async () => {
  const paths = await fixture();
  const sleeper = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
  const pid = sleeper.pid;
  assert.ok(pid);
  sleeper.kill("SIGKILL");
  await new Promise<void>((resolve) => sleeper.once("exit", () => resolve()));
  const lock = join(paths.privateHome, "tick.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "pid"), `${pid}\n`);
  const reclaimed = runTick(paths);
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  assert.match(await readFile(paths.log, "utf8"), /ran/);
  await assert.rejects(stat(lock));

  const live = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
  assert.ok(live.pid);
  await mkdir(lock);
  await writeFile(join(lock, "pid"), `${live.pid}\n`);
  const held = runTick(paths);
  assert.equal(held.status, 0);
  assert.match(held.stdout, /lock held; nothing sent/);
  const log = await readFile(paths.log, "utf8");
  assert.equal(log.trim(), "ran");
  await stat(lock);
  live.kill("SIGKILL");
  await new Promise<void>((resolve) => live.once("exit", () => resolve()));
  await rm(paths.home, { recursive: true, force: true });
});
