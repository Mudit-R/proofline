import fs from 'node:fs';
import * as snarkjs from 'snarkjs';
const bundle = JSON.parse(fs.readFileSync(process.argv[2] || 'docs/evidence/sample-proof.json'));
const proof = bundle.proof || bundle.job.proof,
  signals = bundle.publicSignals || bundle.job.publicSignals;
const valid = await snarkjs.groth16.verify(bundle.verificationKey, signals, proof);
console.log(
  valid
    ? 'Cryptographic verification passed. Check the model/key provenance separately.'
    : 'INVALID PROOF',
);
process.exit(valid ? 0 : 1);
