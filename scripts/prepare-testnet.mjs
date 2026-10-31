import fs from 'node:fs';
import crypto from 'node:crypto';
import { Wallet } from 'ethers';
const directory = '.local/testnet';
fs.mkdirSync(directory, { recursive: true });
const secrets = directory + '/sepolia.env',
  addresses = directory + '/addresses.json';
if (!fs.existsSync(secrets)) {
  const requester = Wallet.createRandom(),
    worker = Wallet.createRandom();
  fs.writeFileSync(
    secrets,
    [
      `MODE=external`,
      `RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`,
      `REQUESTER_KEY=${requester.privateKey}`,
      `WORKER_KEY=${worker.privateKey}`,
      `OPERATOR_TOKEN=${crypto.randomBytes(32).toString('hex')}`,
      `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
      `DATA_DIR=.local/sepolia`,
      `PUBLIC_TRY=true`,
      `REWARD_ETH=0.000001`,
      `CONFIRMATIONS=2`,
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  fs.writeFileSync(
    addresses,
    JSON.stringify(
      { chainId: 11155111, requester: requester.address, worker: worker.address },
      null,
      2,
    ),
  );
}
console.log(fs.readFileSync(addresses, 'utf8'));
