# Validation — 2026-11-01

## Executed

- Generated a real BN254 Groth16 proving/verification setup using snarkjs and verified the zkey transcript. The circuit compiled to 787 non-linear and 1,155 linear constraints, with three public outputs and six public inputs.
- Ran the protocol and authenticated API suite on Node 24 / Windows: **37 passed, 1 PostgreSQL integration test skipped** because `TEST_DATABASE_URL` was not configured. The suite creates real proofs, compiles and deploys the generated Solidity verifier, performs actual local EVM settlement, and covers account signup/login/logout, account-to-account history isolation, and PostgreSQL signer handoff. Invalid EVM checks require a `CALL_EXCEPTION`; unrelated network failures are not treated as successful attack rejection.
- Verified healthy and elevated-risk witnesses. Out-of-range inputs and incorrect model identity fail witness constraint checking.
- Verified the exported sample proof independently through `scripts/verify-bundle.mjs`. Its verification key is included for reproduction, not offered as a trusted production key.
- Built the production React bundle with Vite.
- Built the Docker image on Linux, let it perform first-start circuit/setup/deployment, submitted a request through its API, and observed settlement with a real proof. One container run measured 425 ms for proof generation plus local verification and 312,982 gas for the full settlement transaction. These are individual observations on the small fixture, not a repeated performance benchmark or network SLA.
- The current account UI was production-built with Vite. A browser interaction pass was unavailable in this session because Codex Work settings report local browser use is disabled; prior app interactions remain documented below as historical validation.
- Deployed account support to the live Render service. Verified the homepage and bundled sign-in/create-account UI return HTTP 200, `/healthz` reports `signerReady: true`, and `/api/auth/me` reports authentication enabled with guest mode available. Render logs confirm the new process acquired the PostgreSQL signer lock after the old process stopped.
- Restarted the native API and observed that completed requests and chain credit persisted.
- Restarted the packaged Docker instance and observed the same contract address, settled job, and worker credit afterward.
- Deployed the pinned verifier and escrow consumer to Ethereum Sepolia. The deployment metadata is recorded in `deployments/sepolia.json`; startup checks the configured verifier's deployed bytecode and model ID against the repository artifacts.
- Added API integration coverage for signed guest-session isolation, public-mode sponsored limits, operator-only telemetry and foreign-origin rejection.
- Submitted and settled one real sponsored healthy request on Sepolia. Independently fetched both receipts from the public RPC: request status `1` with 6 confirmations; settlement status `1` with 4 confirmations and `402,578` gas. Public hashes are recorded in `deployments/sepolia.json`.
- Ran the PostgreSQL store integration test against a disposable PostgreSQL 17 container. Verified single-signer advisory locking, atomic quota rollback, seven-day retention pruning and preservation of in-flight submissions.

The on-screen attack report uses EVM static calls for invalid submissions. A static-call rejection is not a mined transaction. Successful requests and settlements have local-chain transaction hashes and receipts.

## Scope

This validates the supplied model/circuit, the deployed Sepolia bytecode identity, PostgreSQL persistence and one real Sepolia request/settlement. Account flows were exercised against the local API; the live HTTP smoke check verified the deployed UI bundle and authentication endpoints, but a click-through browser test was unavailable because Codex Work settings disable local browser use. It does not establish multi-party setup security, a smart-contract audit, real-value safety, realistic anomaly-detection accuracy, distributed consensus, or Ritual integration. The model's held-out score is from a deterministic synthetic dataset.

The development ceremony and local chain are deliberately reproducible tooling paths; development account keys must not be used on public networks. No hosted proving service or mock proof is substituted when proving fails.
