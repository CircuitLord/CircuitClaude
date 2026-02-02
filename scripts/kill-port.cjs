const { execSync } = require("child_process");

const port = process.argv[2];
if (!port) process.exit(0);

try {
  const output = execSync("netstat -ano", { encoding: "utf8" });
  const pids = new Set();

  for (const line of output.split("\n")) {
    if (line.includes(`:${port}`) && line.includes("LISTENING")) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && pid !== "0") pids.add(pid);
    }
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      console.log(`Killed process ${pid} on port ${port}`);
    } catch {}
  }
} catch {}
