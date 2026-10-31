import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
if (!fs.existsSync('artifacts/manifest.json')) {
  execFileSync(process.execPath, ['scripts/train.mjs'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/setup.mjs'], { stdio: 'inherit' });
}
const server = spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 1));
