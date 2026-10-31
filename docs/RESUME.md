# Resume entry

Use only after checking that these capabilities still match the current release. The measurements are local development results; no user adoption or public-chain deployment is claimed.

**Proofline — Verifiable AI Inference & On-chain Settlement**  
Circom, Groth16, Solidity, Node.js, React, SQLite, Docker

- Built an inference-to-settlement protocol with real BN254 Groth16 proofs over a trained integer decision tree; bound input commitments and model identity to chain, contract, job, requester and worker context.
- Implemented Solidity escrow, proof verification, expiry refunds and worker withdrawals; tested output tampering, model substitution, replay, front-running and duplicate settlement against an actual local EVM.
- Delivered a persistent proving API and React dashboard with downloadable proof bundles and inspectable transaction receipts; validated the protocol and HTTP workflows with 29 tests and a reproducible Docker deployment.

The strongest interview walkthrough is the public-signal statement, why context must be constrained, how worker binding prevents copied-proof payouts, and what the development trusted setup and synthetic training data do not guarantee. The next independently verifiable milestone is a public-testnet deployment receipt; do not add that claim before it exists.
