import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const url = "http://127.0.0.1:1430";
const serverLogs = [];

const server = spawn(
  process.execPath,
  ["./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1430", "--strictPort"],
  {
    cwd: root,
    env: { ...process.env, VITE_E2E: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverLogs.push(chunk);
    while (serverLogs.length > 20) serverLogs.shift();
  });
}

try {
  await waitForServer(url, 60_000);
  const code = await runPlaywright();
  await stopServer();
  process.exit(code);
} catch (error) {
  await stopServer();
  console.error(error instanceof Error ? error.message : String(error));
  if (serverLogs.length > 0) {
    console.error(serverLogs.join("").trim());
  }
  process.exit(1);
}

async function waitForServer(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite server exited early with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${targetUrl}`);
}

function runPlaywright() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["./node_modules/@playwright/test/cli.js", "test", "--workers=4"],
      {
        cwd: root,
        env: { ...process.env, PLAYWRIGHT_MANAGED_SERVER: "1" },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill();
  const deadline = Date.now() + 5_000;
  while (server.exitCode === null && Date.now() < deadline) {
    await delay(100);
  }
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}
