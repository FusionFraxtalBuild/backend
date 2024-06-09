const { Noir } = require("@noir-lang/noir_js");
const { BarretenbergBackend } = require("@noir-lang/backend_barretenberg");
const burnProve = require("../../lib/circuits/burn_prove.json");
require("dotenv").config();
const ethers = require("ethers");

const burn_prove = async (domain, serverHash, chainId, txHash, amount) => {
  const burnBackend = new BarretenbergBackend(burnProve);
  const burnNoir = new Noir(burnProve, burnBackend);

  const burnInputs = {
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

  const burnProof = ethers.utils.hexlify(
    (await burnNoir.generateFinalProof(burnInputs)).proof
  );

  return burnProof;
};

module.exports = {
  burn_prove,
};
