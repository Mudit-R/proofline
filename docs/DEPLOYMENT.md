# Deployment

## Local / hosted demonstration

Use `docker compose up --build -d`. The container bootstraps its circuit and local EVM, then serves the built frontend and API. The first startup can take several minutes; `/healthz` reports readiness after initialization. The compose file limits the container to 2 GB RAM and two CPUs and binds its port to loopback.

To host the demonstration, place the container behind a TLS reverse proxy on a VM with durable storage. Preserve both the state and artifact volumes. Set `OPERATOR_TOKEN` to a high-entropy secret if the instance should be operator-only. Set it using your host's secret manager, not a committed `.env`. Browser users enter it through Operator access; the browser keeps it in session storage. A public demo must remain in demo mode with disposable funds and requires upstream request limits.

Never expose a local EVM RPC publicly: the bundled chain has no public listener. Start only one API/chain owner per data directory. Back up state and artifacts together. Deploy a new model/setup as a separate release and deployment rather than replacing a verifier under existing jobs.

## External EVM mode

External mode uses the same real verifier and settlement flow against a separately provisioned EVM RPC. Set `MODE=external`, `RPC_URL`, `REQUESTER_KEY`, `WORKER_KEY`, `CONTRACT_ADDRESS`, and `OPERATOR_TOKEN`. Provide an address deployed with this build's generated verifier and matching model ID. These keys are operator-managed; do not reuse the demo mnemonic. The API should run behind TLS and authentication.

The initial implementation is validated on the bundled Ganache chain. Public-testnet deployment, RPC failure recovery, user wallets, real-value custody and Ritual's native execution interface have not been validated. Do not claim those integrations from a successful local demo. A public testnet rollout requires network selection, test funds, key provisioning, deployment receipts and additional integration tests.

## Independent proof verification

Download a bundle from a settled request. With dependencies installed:

```sh
node scripts/verify-bundle.mjs downloaded-bundle.json
```

This verifies the proof against the supplied key. Independently compare the key/setup and model identity against the deployment you trust, and check the job/chain/consumer context. Merely verifying a proof under a key supplied by its sender is insufficient to authenticate a model.

## Failure recovery

The queue is durable in SQLite; the chain is durable in its own volume. On startup, interrupted proving/verifying records are reconciled with chain state. Pending work can be proved again because only an unexpired pending job can settle. Failed jobs can be refunded after expiry. If a settlement was mined before a process interruption, reconciliation preserves its settled status rather than paying again. Download bundles before retiring a development instance.
