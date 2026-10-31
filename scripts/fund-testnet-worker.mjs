import { Wallet, JsonRpcProvider, parseEther, formatEther } from 'ethers';
const provider = new JsonRpcProvider(process.env.RPC_URL);
if ((await provider.getNetwork()).chainId !== 11155111n) throw new Error('Sepolia only');
const sender = new Wallet(process.env.REQUESTER_KEY, provider),
  worker = new Wallet(process.env.WORKER_KEY).address;
if ((await provider.getBalance(worker)) < parseEther('0.01')) {
  const receipt = await (
    await sender.sendTransaction({ to: worker, value: parseEther('0.015') })
  ).wait();
  console.log(JSON.stringify({ worker, transaction: receipt.hash }));
} else console.log('Worker already funded');
provider.destroy();
