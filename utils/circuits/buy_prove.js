const { Noir } = require("@noir-lang/noir_js");
const { BarretenbergBackend } = require("@noir-lang/backend_barretenberg");
const buyProve = require("../../lib/circuits/buy_prove.json");
require("dotenv").config();
const ethers = require("ethers");

const buy_prove = async (domain, serverHash, chainId, txHash, amount) => {
  const buyBackend = new BarretenbergBackend(buyProve);
  const buyNoir = new Noir(buyProve, buyBackend);

  const buyInputs = {
    reqDomain: ethers.utils.hexZeroPad(
      ethers.utils
        .arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(domain)))
        .slice(0, 4),
      32
    ),
    passcode: ethers.utils.hexlify(
      ethers.utils.toUtf8Bytes(process.env.PASSCODE)
    ),
    serverHash,
    domain: ethers.utils.hexZeroPad(
      ethers.utils
        .arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(domain)))
        .slice(0, 4),
      32
    ),
    chainId: ethers.utils.hexZeroPad(chainId, 32),
    txHash: txHash,
    amount: ethers.utils.hexZeroPad(amount, 32),
  };

  const buyProof = ethers.utils.hexlify(
    (await buyNoir.generateFinalProof(buyInputs)).proof
  );

  return buyProof;
};

module.exports = {
  buy_prove,
};
