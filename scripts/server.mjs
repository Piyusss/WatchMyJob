// Runs the Go backend in server/ for the root npm scripts, the same way on
// Windows, macOS and Linux:
//
//   node scripts/server.mjs dev     build and start the backend (loads server/.env first)
//   node scripts/server.mjs test    run the tests (the database ones need Docker running)
//   node scripts/server.mjs build   build server/bin/server
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const SERVER_DIR = fileURLToPath(new URL("../server/", import.meta.url));
const BINARY = path.join("bin", process.platform === "win32" ? "server.exe" : "server");

const command = process.argv[2];
if (!["dev", "test", "build"].includes(command)) {
  console.error("Usage: node scripts/server.mjs <dev|test|build>");
  process.exit(1);
}

// Without Go the commands below would fail with a far less obvious error.
if (spawnSync("go", ["version"], { stdio: "ignore" }).error) {
  console.error("Go isn't installed, or isn't on PATH: see https://go.dev/dl/");
  process.exit(1);
}

function go(...args) {
  const result = spawnSync("go", args, { cwd: SERVER_DIR, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === "test") {
  go("test", "./...");
  process.exit(0);
}

go("build", "-o", BINARY, ".");
if (command === "build") process.exit(0);

// The backend reads its settings from environment variables; for local
// development they live in server/.env. Variables already set in the shell
// win. Tests never read the file: they run against their own database.
const envFile = path.join(SERVER_DIR, ".env");
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, "utf8")))) {
    if (!(key in process.env)) process.env[key] = value;
  }
}
// Always the same binary (not `go run`, which builds a new one each time),
// so Windows' firewall asks about it only once.
const result = spawnSync(path.join(SERVER_DIR, BINARY), { cwd: SERVER_DIR, stdio: "inherit" });
process.exit(result.status ?? 1);
