import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

const server = spawn(npm, ['run', 'dev', '--workspace', 'server'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});
const client = spawn(npm, ['run', 'dev', '--workspace', 'client'], {
  stdio: 'inherit',
});

function shutdown() {
  server.kill();
  client.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => {
  client.kill();
  process.exit(code ?? 0);
});

