# Threat model

## Guarantee and trust

The intended guarantee is correct execution of the frozen tree for an input opening the registered commitment, bound to the chain, contract, request, requester, worker, and model. It relies on Groth16 soundness, BN254 assumptions, Poseidon, the implementation and verification-key provenance, and the trusted setup. No independent audit has been performed.

The local setup creates fresh random phase-one and phase-two contributions and verifies the zkey transcript. They come from one machine. A malicious or compromised setup operator can undermine soundness. Independently audited setup contributions and provenance are required before treating proof acceptance as production trust.

The proving operator sees private inputs and salts. They are persisted in a local SQLite database to permit crash recovery. This is privacy from chain observers, not end-to-end confidentiality from the worker. Downloaded bundles and public API job records omit features and salt. A bundle intentionally discloses the risk class and all public signals.

## Attacker model

A worker may return a fabricated prediction, use the wrong model, change input context, copy another proof, or replay a settled proof. Requesters can choose any bounded input and may report false telemetry. The circuit enforces integer ranges and the model computation; it cannot authenticate external sensors.

The consumer rejects mismatched context before proof verification, verifies curve/pairing statements through the generated verifier, rejects duplicate or late settlement, and binds worker identity to prevent stolen payouts. Expired refunds and pull withdrawals are explicit state transitions. Tests exercise the actual generated verifier.

The risk label is an output, not a lending, medical, employment, or financial decision. Synthetic training accuracy does not establish validity on real workloads.

## Operator and application limits

- The coordinator is a trusted, centralized operator for availability, scheduling, input handling, and signing. This project is not a decentralized consensus network.
- Demo accounts use a published development mnemonic and disposable local funds. They must never receive assets on a real chain.
- External mode requires separate configured requester/worker keys and an operator token. All HTTP mutations use those operator accounts; this release is not a noncustodial browser-wallet dApp.
- The public demo API has submission/queue limits; externally accessible operator instances require TLS, authentication, request body limits and upstream abuse controls. A shared bearer token provides operator access, not per-user tenancy.
- A single API process owns one SQLite database and one EVM database. Multiple replicas against the same files are unsupported.
- A shutdown between mining a request and persisting its private input can leave an orphan request. Inspect on-chain events and refund it after expiry; there is no claim of exactly-once API delivery.
- Replay protection concerns application context and one-use jobs. The protocol does not authenticate human ownership of input data or model-training provenance.
- Gas and proof measurements are from the included small circuit and local chain; they are not an SLA.

## Reporting

Use a private GitHub security advisory for sensitive reports. Include the commit, setup/key digest, input and public signals, reproduction steps, and observed/expected state. Do not publish private keys or sensitive telemetry.
