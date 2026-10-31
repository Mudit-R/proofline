# Deployment

## Render Blueprint

The checked-in [`render.yaml`](../render.yaml) provisions one free Docker web service and a dedicated free PostgreSQL database in Oregon. It does not use the NextChapter or CelerLite database. To apply it from Render, connect `Mudit-R/proofline` as a Blueprint and review both resources before creation. Required wallet keys are marked `sync: false` and must be added as Render secrets; they are never committed. The generated session secret and operator token stay in the service environment.

The service runs one instance. PostgreSQL holds visitor-scoped jobs, signed submissions and daily quotas. A database advisory lock prevents a second service process from using the same signer. Do not scale the API horizontally or copy signer keys into another instance.

**Free-tier limits matter:** Render's free web service sleeps after 15 minutes without traffic, loses its local filesystem on restart, and has 512 MB RAM. Its free PostgreSQL database expires 30 days after creation (with a 14-day upgrade grace period). Export the database before expiration or the pilot's history will be lost. Render describes free instances as appropriate for testing and hobby projects, not production workloads. See [Render's free plan limits](https://render.com/docs/free) and [compute plans](https://render.com/docs/compute-plans). This deployment is therefore a public testnet pilot, not a production availability promise.

## Public Sepolia pilot

The repository pins a release's proving artifacts in `proof-assets/`; startup validates their checksums instead of performing a new trusted setup. The Sepolia consumer and verifier addresses and deployment transactions are recorded in [`deployments/sepolia.json`](../deployments/sepolia.json). `server/chain.mjs` checks the configured contract's model ID and verifier bytecode before accepting traffic. `scripts/deploy.mjs --testnet` only deploys to Sepolia; ordinary external-mode startup never auto-deploys.

Set `MODE=external`, `RPC_URL`, `REQUESTER_KEY`, `WORKER_KEY`, `CONTRACT_ADDRESS`, and `OPERATOR_TOKEN`. Public sponsored mode additionally requires `PUBLIC_TRY=true` and a persistent `SESSION_SECRET`. It is Sepolia-only, pins the reward to `0.000001` test ETH, limits each browser to 3 requests/day, each network to 10/day, and the full service to 20/day, and pauses submissions when either signer falls below a `0.002` ETH reserve. It exposes only the visitor's own requests and disables operator telemetry and withdrawals. Completed history and old quota records are pruned after seven days; unresolved signed transactions remain for recovery. Testnet transactions and public commitments are visible on-chain; inputs and salts are sent to the proving operator and stored in the database while a job is processed.

After deploy, verify `/healthz`, open the dashboard, submit a healthy preset and confirm that the request and settlement both appear on Sepolia Etherscan. Then download the proof bundle and verify it independently:

```sh
node scripts/verify-bundle.mjs downloaded-bundle.json
```

The bundle's key must be independently matched to the pinned release; a valid proof under an untrusted key does not authenticate a model. Any transaction reward and all gas are paid in faucet test ETH, not real value.

## Local development mode

Use `docker compose up --build -d`. The local demonstration starts a private Ganache chain, local SQLite store and real Groth16 worker. The compose file binds to loopback and limits the container to 2 GB RAM and two CPUs. Keep both Docker volumes (`proofline-state`, `proofline-artifacts`) together. Never expose the local RPC publicly or reuse its development mnemonic on any public network.

For a native local API, `DATA_DIR` selects an isolated SQLite directory. The API integration tests use their own temporary directory. Use a new data directory and new contract deployment for a new model or proof setup; never replace the verifier key under existing requests.

## Failure recovery

Signed request transactions and signed settlements are persisted before broadcast. Startup checks transaction receipts, waits for the configured confirmation count, and rebroadcasts the same signed transaction after interruptions. Jobs are reconciled with on-chain state before retrying proof work. This is designed for one service process and does not replace independent monitoring, backups or a production incident plan.
