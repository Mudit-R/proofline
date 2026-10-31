# Threat model

## Guarantee and trust

The intended guarantee is correct execution of the frozen tree for an input opening the registered commitment, bound to the chain, contract, request, requester, worker, and model. It relies on Groth16 soundness, BN254 assumptions, Poseidon, the implementation and verification-key provenance, and the trusted setup. No independent audit has been performed.

The local setup creates fresh random phase-one and phase-two contributions and verifies the zkey transcript. They come from one machine. A malicious or compromised setup operator can undermine soundness. Independently audited setup contributions and provenance are required before treating proof acceptance as production trust.

The proving operator sees private inputs and salts. They are persisted in SQLite locally or in Proofline's separate hosted PostgreSQL database to permit crash recovery. Completed hosted history and old quota records are removed after seven days; signed requests that have not yet been registered remain until reconciled. This is privacy from chain observers, not end-to-end confidentiality from the worker. Downloaded bundles and public API job records omit features and salt. A bundle intentionally discloses the risk class and all public signals. Public transactions and commitments cannot be deleted from Sepolia.

## Attacker model

A worker may return a fabricated prediction, use the wrong model, change input context, copy another proof, or replay a settled proof. Requesters can choose any bounded input and may report false telemetry. The circuit enforces integer ranges and the model computation; it cannot authenticate external sensors.

The consumer rejects mismatched context before proof verification, verifies curve/pairing statements through the generated verifier, rejects duplicate or late settlement, and binds worker identity to prevent stolen payouts. Expired refunds and pull withdrawals are explicit state transitions. Tests exercise the actual generated verifier.

The risk label is an output, not a lending, medical, employment, or financial decision. Synthetic training accuracy does not establish validity on real workloads.

## Operator and application limits

- The coordinator is a trusted, centralized operator for availability, scheduling, input handling, and signing. This project is not a decentralized consensus network.
- Demo accounts use a published development mnemonic and disposable local funds. They must never receive assets on a real chain.
- External mode requires separate configured requester/worker keys and an operator token. The hosted public pilot sponsors submissions with those operator accounts; it is not a noncustodial browser-wallet dApp.
- Public Sepolia mode uses signed browser-session ownership, IP/network and global daily quotas, a small fixed test reward, queue and request-rate limits, and pauses when either test wallet falls below its reserve. Telemetry and withdrawals remain operator-only. These controls limit abuse but are not a substitute for an audited anti-abuse system.
- One API process owns each SQLite or PostgreSQL store and its EVM signing accounts. PostgreSQL advisory locking refuses a second signer process. Horizontal replicas are unsupported.
- Signed request and settlement transactions are persisted before broadcast and reconciled on restart. A pending signed request can remain unresolved if the upstream RPC permanently loses it; inspect the public receipt and session state before manual recovery.
- Replay protection concerns application context and one-use jobs. The protocol does not authenticate human ownership of input data or model-training provenance.
- Gas and proof measurements are from the included small circuit and local chain; they are not an SLA.

## Reporting

Use a private GitHub security advisory for sensitive reports. Include the commit, setup/key digest, input and public signals, reproduction steps, and observed/expected state. Do not publish private keys or sensitive telemetry.
