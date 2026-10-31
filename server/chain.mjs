import fs from 'node:fs';
import path from 'node:path';
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
          outputSelection: {
            '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
          },
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
export async function connectChain({ ephemeral = false, deploy = false } = {}) {
  const dataDir = process.env.DATA_DIR || '.local';
  fs.mkdirSync(dataDir, { recursive: true });
  const demo = process.env.MODE !== 'external';
  let local;
  if (demo) {
    fs.mkdirSync(dataDir, { recursive: true });
    local = ganache.provider({
      chain: { chainId: 31337 },
      wallet: {
        mnemonic: 'test test test test test test test test test test test junk',
        totalAccounts: 3,
      },
      database: ephemeral ? {} : { dbPath: path.join(dataDir, 'chain') },
      logging: { quiet: true },
    });
  }
  const provider = demo
    ? new ethers.BrowserProvider(local, undefined, { cacheTimeout: -1 })
    : new ethers.JsonRpcProvider(
        Object.assign(new ethers.FetchRequest(process.env.RPC_URL), { timeout: 15000 }),
        undefined,
        { cacheTimeout: -1, batchMaxCount: 1 },
      );
  provider.pollingInterval = 1000;
  const accounts = demo ? Object.values(local.getInitialAccounts()) : null;
  const requester = demo
    ? new ethers.Wallet(accounts[0].secretKey, provider)
    : new ethers.Wallet(process.env.REQUESTER_KEY, provider);
  const worker = demo
    ? new ethers.Wallet(accounts[1].secretKey, provider)
    : new ethers.Wallet(process.env.WORKER_KEY, provider);
  const thief = demo ? new ethers.Wallet(accounts[2].secretKey, provider) : null;
  const contracts = compile();
  const model = JSON.parse(fs.readFileSync('models/sentinel.json'));
  const deploymentPath = path.join(dataDir, demo ? 'deployment.json' : 'external-deployment.json');
  let address = process.env.CONTRACT_ADDRESS;
  if (!demo && !address && !deploy)
    throw new Error(
      'External mode requires CONTRACT_ADDRESS. Deploy explicitly using scripts/deploy.mjs.',
    );
  if (demo && !ephemeral && fs.existsSync(deploymentPath)) {
    const saved = JSON.parse(fs.readFileSync(deploymentPath));
    const manifest = fs.readFileSync('artifacts/manifest.json', 'utf8');
    if (saved.manifest !== manifest)
      throw new Error(
        'Proof setup changed. Use a new DATA_DIR / fresh .local deployment; never mix verifier keys.',
      );
    address = saved.address;
  }
  let deployment;
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
    deployment = {
      chainId: (await provider.getNetwork()).chainId.toString(),
      address,
      verifier: await verifier.getAddress(),
      verifierTx: verifier.deploymentTransaction().hash,
      consumerTx: consumer.deploymentTransaction().hash,
      modelId: model.id,
      manifest: fs.readFileSync('artifacts/manifest.json', 'utf8'),
    };
    if (!ephemeral) fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  }
  const contract = new ethers.Contract(address, contracts.consumer.abi, requester);
  if ((await contract.modelId()).toString() !== model.id)
    throw new Error('Deployed model does not match local model.');
  const verifierAddress = await contract.verifier();
  if (
    (await provider.getCode(verifierAddress)).toLowerCase() !==
    ('0x' + contracts.verifier.evm.deployedBytecode.object).toLowerCase()
  )
    throw new Error('Deployed verifier bytecode does not match pinned proving artifacts');
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
