// Explicit operator action only. Never invoked during normal server startup.
if (!process.argv.includes('--testnet'))
  throw new Error('Pass --testnet to acknowledge this sends deployment transactions.');
for (const key of ['RPC_URL', 'REQUESTER_KEY', 'WORKER_KEY', 'OPERATOR_TOKEN'])
  if (!process.env[key]) throw new Error('Missing ' + key);
process.env.MODE = 'external';
const { JsonRpcProvider } = await import('ethers');
const check = new JsonRpcProvider(process.env.RPC_URL);
const network = await check.getNetwork();
check.destroy();
if (![11155111n, 31337n].includes(network.chainId))
  throw new Error(
    'This helper supports Ethereum Sepolia or a local chain only. Mainnet deployment is disabled.',
  );
const { connectChain } = await import('../server/chain.mjs');
const chain = await connectChain({ deploy: true });
console.log(
  JSON.stringify({
    chainId: chain.chainId,
    contract: chain.address,
    verifier: await chain.contract.verifier(),
  }),
);
await chain.close();
