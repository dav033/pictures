/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS bootstrap runs before Next.js. */
const path = require("node:path");
const { spawn } = require("node:child_process");

const nextBin = path.join(__dirname, "..", "node_modules", "next", "dist", "bin", "next");
const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
const nodeOptions = [existingNodeOptions, "--use-system-ca"].filter(Boolean).join(" ");

const child = spawn(process.execPath, ["--use-system-ca", nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
