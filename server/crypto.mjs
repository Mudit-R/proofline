import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
export const model = JSON.parse(fs.readFileSync('models/sentinel.json'));
const poseidon = await buildPoseidon();
export const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export function commitment(features, salt) {
  return poseidon.F.toString(poseidon([...features, BigInt(salt)]));
}
export const salt = () => BigInt('0x' + randomBytes(31).toString('hex')).toString();
export function predict(features, node = model.tree) {
  return (
    node.value ??
    predict(features, features[node.feature] < node.threshold ? node.left : node.right)
  );
}
export function validateFeatures(features) {
  if (
    !Array.isArray(features) ||
    features.length !== 4 ||
    features.some((n) => !Number.isInteger(n) || n < 0 || n > 100)
  )
    throw new Error('Provide four integer feature values from 0 to 100.');
  return features;
}
export async function prove(input) {
  const start = performance.now();
  const result = await snarkjs.groth16.fullProve(
    input,
    'artifacts/inference_js/inference.wasm',
    'artifacts/inference.zkey',
  );
  const vkey = JSON.parse(fs.readFileSync('artifacts/verification_key.json'));
  if (!(await snarkjs.groth16.verify(vkey, result.publicSignals, result.proof)))
    throw new Error('Local cryptographic verification failed');
  const args = JSON.parse(
    '[' + (await snarkjs.groth16.exportSolidityCallData(result.proof, result.publicSignals)) + ']',
  );
  return { ...result, args, proveMs: Math.round(performance.now() - start) };
}
