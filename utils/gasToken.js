const ethers = require("ethers");
const IndexerProxyFactoryABI = require("../lib/abi/IndexerProxyFactory.json");
const IndexerABI = require("../lib/abi/Indexer.json");
const FusionProxyFactoryABI = require("../lib/abi/FusionProxyFactory.json");
const GasTokenABI = require("../lib/abi/GasToken.json");
const gasToken = require("../lib/GasToken.json");
const AddressManager = require("../lib/AddressManager.json");

const { buy_prove } = require("./circuits/buy_prove");
const { burn_prove } = require("./circuits/burn_prove");

const getDomainBalance = async (domain) => {
  const baseChain = AddressManager.find((chain) => chain.isBase);

  const provider = new ethers.providers.JsonRpcProvider(baseChain.rpcUrl);

  const gasTokenContract = new ethers.Contract(
    gasToken.TokenAddress,
    GasTokenABI,
    provider
  );

  const factory = new ethers.Contract(
    baseChain.addresses.FusionProxyFactory,
    FusionProxyFactoryABI,
    provider
  );

  const fusionAddress = await factory.getFusionProxy(domain);

  if (fusionAddress === ethers.constants.AddressZero) {
    throw new Error("Domain not found");
  }

  const balance = await gasTokenContract.balanceOf(fusionAddress);

  return Number(balance);
};

const depositAndIndex = async (domain, chainId, txHash, amount) => {
  const baseChain = AddressManager.find((chain) => chain.isBase);

  const provider = new ethers.providers.JsonRpcProvider(baseChain.rpcUrl);

  const keypair = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const factory = new ethers.Contract(
    baseChain.addresses.FusionProxyFactory,
    FusionProxyFactoryABI,
    keypair
  );

  const fusionAddress = await factory.getFusionProxy(domain);

  if (fusionAddress === ethers.constants.AddressZero) {
    throw new Error("Domain not found");
  }

  const indexerProxyFactory = new ethers.Contract(
    gasToken.addresses.IndexerProxyFactory,
    IndexerProxyFactoryABI,
    provider
  );

  const indexer = await indexerProxyFactory.getIndexerProxy(
    chainId,
    keypair.address
  );

  if (indexer === ethers.constants.AddressZero) {
    throw new Error("Indexer not found");
  }

  const indexerContract = new ethers.Contract(indexer, IndexerABI, provider);

  const serverHash = await indexerContract.getServerHash();

  const proof = await buy_prove(domain, serverHash, chainId, txHash, amount);

  const gasTokenContract = new ethers.Contract(
    gasToken.TokenAddress,
    GasTokenABI,
    keypair
  );

  const gasPrice = Number(await provider.getGasPrice());

  const data = gasTokenContract.interface.encodeFunctionData("BuyAndIndex", [
    proof,
    domain,
    chainId,
    txHash,
    Number(amount * 10 ** 18).toFixed(0),
  ]);

  const unSignedTx = {
    to: gasTokenContract.address,
    data,
    value: 0,
    gasLimit: 2000000,
    gasPrice,
  };

  const signedTx = await keypair.sendTransaction(unSignedTx);

  const receipt = await signedTx.wait();

  return receipt;
};

const checkValidTx = async (txHash, chainId) => {
  const baseChain = AddressManager.find((chain) => chain.isBase);

  const provider = new ethers.providers.JsonRpcProvider(baseChain.rpcUrl);

  const indexerProxyFactory = new ethers.Contract(
    gasToken.addresses.IndexerProxyFactory,
    IndexerProxyFactoryABI,
    provider
  );

  const keypair = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const indexer = await indexerProxyFactory.getIndexerProxy(
    chainId,
    keypair.address
  );

  if (indexer === ethers.constants.AddressZero) {
    throw new Error("Indexer not found");
  }

  const indexerContract = new ethers.Contract(indexer, IndexerABI, provider);

  const isValid = await indexerContract.isTxDuplicate(txHash);

  if (isValid) {
    throw new Error("Transaction is already indexed");
  }

  return isValid;
};

const withdrawFees = async (domain, chainId, txHash, estimatedGas) => {
  const baseChain = AddressManager.find((chain) => chain.isBase);

  const provider = new ethers.providers.JsonRpcProvider(baseChain.rpcUrl);

  const keypair = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const factory = new ethers.Contract(
    baseChain.addresses.FusionProxyFactory,
    FusionProxyFactoryABI,
    keypair
  );

  const fusionAddress = await factory.getFusionProxy(domain);

  if (fusionAddress === ethers.constants.AddressZero) {
    throw new Error("Domain not found");
  }

  const indexerProxyFactory = new ethers.Contract(
    gasToken.addresses.IndexerProxyFactory,
    IndexerProxyFactoryABI,
    provider
  );

  const indexer = await indexerProxyFactory.getIndexerProxy(
    chainId,
    keypair.address
  );

  if (indexer === ethers.constants.AddressZero) {
    throw new Error("Indexer not found");
  }

  const serverHash = await indexer.getServerHash();

  const proof = await burn_prove(
    domain,
    serverHash,
    chainId,
    txHash,
    estimatedGas
  );

  const gasTokenContract = new ethers.Contract(
    gasToken.TokenAddress,
    GasTokenABI,
    keypair
  );

  const data = gasTokenContract.interface.encodeFunctionData("withdrawFees", [
    proof,
    domain,
    chainId,
    txHash,
    estimatedGas,
  ]);

  const unSignedTx = {
    to: gasTokenContract.address,
    data,
    value: 0,
    gasLimit: 2000000,
  };

  const signedTx = await keypair.sendTransaction(unSignedTx);

  const receipt = await signedTx.wait();

  return receipt;
};

const estimateWithdrawFees = async (domain, chainId, txHash, estimatedGas) => {
  const baseChain = AddressManager.find((chain) => chain.isBase);

  const provider = new ethers.providers.JsonRpcProvider(baseChain.rpcUrl);

  const keypair = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const factory = new ethers.Contract(
    baseChain.addresses.FusionProxyFactory,
    FusionProxyFactoryABI,
    keypair
  );

  const fusionAddress = await factory.getFusionProxy(domain);

  if (fusionAddress === ethers.constants.AddressZero) {
    throw new Error("Domain not found");
  }

  const indexerProxyFactory = new ethers.Contract(
    gasToken.addresses.IndexerProxyFactory,
    IndexerProxyFactoryABI,
    provider
  );

  const indexer = await indexerProxyFactory.getIndexerProxy(
    chainId,
    keypair.address
  );

  if (indexer === ethers.constants.AddressZero) {
    throw new Error("Indexer not found");
  }

  const serverHash = await indexer.getServerHash();

  const proof = await burn_prove(
    domain,
    serverHash,
    chainId,
    txHash,
    estimatedGas
  );

  const gasTokenContract = new ethers.Contract(
    gasToken.TokenAddress,
    GasTokenABI,
    keypair
  );

  const gasEstimate = Number(
    await gasTokenContract.estimateGas.withdrawFees(
      proof,
      domain,
      chainId,
      txHash,
      estimatedGas
    )
  );

  const ethGas = Number(await provider.getGasPrice());
  const gasPrice = Number(
    await ethToErc20(
      {
        id: baseChain.id,
        convert_id: baseChain.convert_id,
      },
      ethGas
    )
  );

  const estimateFees = (
    (gasEstimate + baseChain.baseGas + baseChain.cautionGas) *
    gasPrice
  ).toFixed(0);

  return estimateFees;
};

module.exports = {
  getDomainBalance,
  depositAndIndex,
  checkValidTx,
  withdrawFees,
  estimateWithdrawFees,
};
