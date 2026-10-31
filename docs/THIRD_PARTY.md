# Third-party notices

Proofline's application source is GPL-3.0. The escrow consumer contract is additionally offered under the MIT SPDX license stated in that file.

Core dependencies include snarkjs (GPL-3.0), circom2 (compiler packaging; consult its distributed license), circomlib and circomlibjs (consult their distributed licenses), ethers (MIT), Solidity compiler (GPL-3.0), Ganache (MIT), Express (MIT), React (MIT), Lucide (ISC), and Vite (MIT). Full dependency versions and transitive dependencies are pinned in `package-lock.json`. Upstream license files remain in the installed distributions. Generated verifier code retains its upstream license header.

snarkjs and circomlib supply cryptographic primitives and proof-system implementation; Proofline contributes the bounded model circuit, domain checks, settlement lifecycle, orchestration, validation and UI. It does not claim invention of Groth16 or Poseidon.
