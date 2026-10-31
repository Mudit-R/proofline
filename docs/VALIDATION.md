# Validation — 2026-11-01

## Executed

- Generated a real BN254 Groth16 proving/verification setup using snarkjs and verified the zkey transcript. The circuit compiled to 787 non-linear and 1,155 linear constraints, with three public outputs and six public inputs.
- Ran the protocol and authenticated API integration suite: **29 tests passed** on Node 24 / Windows. The suite creates real proofs, compiles and deploys the generated Solidity verifier, and performs actual local EVM settlement. Invalid EVM checks require a `CALL_EXCEPTION`; unrelated network failures are not treated as successful attack rejection.
- Verified healthy and elevated-risk witnesses. Out-of-range inputs and incorrect model identity fail witness constraint checking.
- Verified the exported sample proof independently through `scripts/verify-bundle.mjs`. Its verification key is included for reproduction, not offered as a trusted production key.
- Built the production React bundle with Vite.
- Built the Docker image on Linux, let it perform first-start circuit/setup/deployment, submitted a request through its API, and observed settlement with a real proof. One container run measured 425 ms for proof generation plus local verification and 312,982 gas for the full settlement transaction. These are individual observations on the small fixture, not a repeated performance benchmark or network SLA.
- Exercised the browser request form, healthy preset, live telemetry sampling, request detail view and attack lab. A browser-created healthy request and a sampled host request progressed through the actual worker flow. Checked both the desktop layout and the browser's narrow layout (actual inner width 520 CSS pixels); no smaller-device claim is made.
- Restarted the native API and observed that completed requests and chain credit persisted.
- Restarted the packaged Docker instance and observed the same contract address, settled job, and worker credit afterward.

The on-screen attack report uses EVM static calls for invalid submissions. A static-call rejection is not a mined transaction. Successful requests and settlements have local-chain transaction hashes and receipts.

## Scope

This validates the supplied model/circuit and local EVM implementation. It does not establish multi-party setup security, a smart-contract audit, actual financial safety, realistic anomaly-detection accuracy, distributed consensus, public-testnet deployment, or Ritual integration. The model's held-out score is from a deterministic synthetic dataset.

The development ceremony and local chain are deliberately reproducible tooling paths; development account keys must not be used on public networks. No hosted proving service or mock proof is substituted when proving fails.
