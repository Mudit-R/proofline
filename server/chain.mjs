import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import { ethers } from 'ethers';
export function compile() {
  const sources = Object.fromEntries(
    ['artifacts/Groth16Verifier.sol', 'contracts/Proofline.sol'].map((p) => [
      p,
      { content: fs.readFileSync(p, 'utf8') },
    ]),
  );
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'shanghai',
          outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
      }),
    ),
  );
  const errors = out.errors?.filter((e) => e.severity === 'error');
  if (errors?.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  return {
    verifier: out.contracts['artifacts/Groth16Verifier.sol'].Groth16Verifier,
    consumer: out.contracts['contracts/Proofline.sol'].Proofline,
  };
}
export async function connectChain({ ephemeral = false } = {}) {
  const demo = process.env.MODE !== 'external';
  let local;
  if (demo) {
    fs.mkdirSync('.local', { recursive: true });
    local = ganache.provider({
      chain: { chainId: 31337 },
      wallet: {
        mnemonic: 'test test test test test test test test test test test junk',
        totalAccounts: 3,
      },
      database: ephemeral ? {} : { dbPath: '.local/chain' },
      logging: { quiet: true },
    });
  }
  const provider = demo
    ? new ethers.BrowserProvider(local)
    : new ethers.JsonRpcProvider(process.env.RPC_URL);
  const requester = demo
    ? await provider.getSigner(0)
    : new ethers.Wallet(process.env.REQUESTER_KEY, provider);
  const worker = demo
    ? await provider.getSigner(1)
    : new ethers.Wallet(process.env.WORKER_KEY, provider);
  const thief = demo ? await provider.getSigner(2) : null;
  const contracts = compile();
  const model = JSON.parse(fs.readFileSync('models/sentinel.json'));
  const deploymentPath = '.local/deployment.json';
  let address = process.env.CONTRACT_ADDRESS;
  if (demo && !ephemeral && fs.existsSync(deploymentPath)) {
    const saved = JSON.parse(fs.readFileSync(deploymentPath));
    const manifest = fs.readFileSync('artifacts/manifest.json', 'utf8');
    if (saved.manifest !== manifest)
      throw new Error(
        'Proof setup changed. Use a new DATA_DIR / fresh .local deployment; never mix verifier keys.',
      );
    address = saved.address;
  }
  if (!address) {
    const verifier = await new ethers.ContractFactory(
      contracts.verifier.abi,
      contracts.verifier.evm.bytecode.object,
      requester,
    ).deploy();
    await verifier.waitForDeployment();
    const consumer = await new ethers.ContractFactory(
      contracts.consumer.abi,
      contracts.consumer.evm.bytecode.object,
      requester,
    ).deploy(await verifier.getAddress(), model.id);
    await consumer.waitForDeployment();
    address = await consumer.getAddress();
    if (!ephemeral)
      fs.writeFileSync(
        deploymentPath,
        JSON.stringify({ address, manifest: fs.readFileSync('artifacts/manifest.json', 'utf8') }),
      );
  }
  const contract = new ethers.Contract(address, contracts.consumer.abi, requester);
  if ((await contract.modelId()).toString() !== model.id)
    throw new Error('Deployed model does not match local model.');
  return {
    demo,
    provider,
    requester,
    worker,
    thief,
    contract,
    local,
    chainId: (await provider.getNetwork()).chainId.toString(),
    address,
    close: async () => {
      if (local) await local.disconnect();
      else provider.destroy();
    },
  };
}
