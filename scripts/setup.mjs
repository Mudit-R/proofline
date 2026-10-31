import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as snarkjs from 'snarkjs';
fs.mkdirSync('artifacts', { recursive: true });
fs.mkdirSync('contracts', { recursive: true });
const run = (script, args) =>
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit', timeout: 600000 });
const compileArgs = ['circuits/inference.circom', '--r1cs', '--wasm', '--sym', '-o', 'artifacts'];
if (process.platform === 'win32')
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      process.cwd() + ':/app',
      '-w',
      '/app',
      'node:24-slim',
      'node',
      'node_modules/circom2/cli.js',
      ...compileArgs,
    ],
    { stdio: 'inherit', timeout: 600000 },
  );
else run('node_modules/circom2/cli.js', compileArgs);
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if (
  fs.existsSync('artifacts/manifest.json') &&
  JSON.parse(fs.readFileSync('artifacts/manifest.json')).circuit ===
    hash('circuits/inference.circom')
) {
  console.log('Reusing existing development proving setup.');
  process.exit(0);
}
const cli = 'node_modules/snarkjs/cli.js';
run(cli, ['powersoftau', 'new', 'bn128', '11', 'artifacts/pot0.ptau']);
run(cli, [
  'powersoftau',
  'contribute',
  'artifacts/pot0.ptau',
  'artifacts/pot1.ptau',
  '--name=proofline-local-development',
  '-e=' + crypto.randomBytes(64).toString('hex'),
]);
run(cli, ['powersoftau', 'prepare', 'phase2', 'artifacts/pot1.ptau', 'artifacts/pot_final.ptau']);
run(cli, [
  'groth16',
  'setup',
  'artifacts/inference.r1cs',
  'artifacts/pot_final.ptau',
  'artifacts/initial.zkey',
]);
run(cli, [
  'zkey',
  'contribute',
  'artifacts/initial.zkey',
  'artifacts/inference.zkey',
  '--name=proofline-development-phase2',
  '-e=' + crypto.randomBytes(64).toString('hex'),
]);
run(cli, [
  'zkey',
  'verify',
  'artifacts/inference.r1cs',
  'artifacts/pot_final.ptau',
  'artifacts/inference.zkey',
]);
run(cli, [
  'zkey',
  'export',
  'verificationkey',
  'artifacts/inference.zkey',
  'artifacts/verification_key.json',
]);
run(cli, [
  'zkey',
  'export',
  'solidityverifier',
  'artifacts/inference.zkey',
  'artifacts/Groth16Verifier.sol',
]);
const paths = ['inference.r1cs', 'inference.zkey', 'verification_key.json', 'Groth16Verifier.sol'];
fs.writeFileSync(
  'artifacts/manifest.json',
  JSON.stringify(
    {
      setup:
        'single-machine development ceremony; requires independent ceremony for production trust',
      circuit: hash('circuits/inference.circom'),
      files: Object.fromEntries(paths.map((p) => [p, hash('artifacts/' + p)])),
    },
    null,
    2,
  ),
);
console.log('Real Groth16 setup ready. Development trust assumptions documented in manifest.');
process.exit(0);
