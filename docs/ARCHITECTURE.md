# Architecture

The API owns a serialized worker queue and two signing accounts. Requests store private inputs in SQLite after the request transaction is mined. Witness/proof generation runs in a child process with a three-minute deadline so CPU work does not block HTTP. The parent locally verifies and simulates attacks before submitting the successful settlement. The successful transaction receipt and measured gas are persisted with public proof data.

The Circom source is generated from a frozen trained tree. Every numeric input has bit/range constraints; constants and model identity are fixed by the circuit and verifying key. Context fields enter a Poseidon hash output so they are constrained in the statement. The circuit has three outputs and six public inputs, in the exact order documented in the README and Solidity consumer. Keep this order stable or version the deployment.

The EVM adapter compiles the generated Groth16 verifier and the consumer with solc, targeting Shanghai for the bundled chain. Consumer state transitions are None → Pending → Settled or Refunded. Worker credits are separate from job rewards and withdrawn through effects-before-interactions transfers.

The UI polls the same-origin API, presents actual persisted states and uses the production Vite build. Authentication is optional only in demo mode; external mode requires a configured operator token. This is a single-operator reference architecture, not a multi-tenant cloud service or permissionless marketplace.
