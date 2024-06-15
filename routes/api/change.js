const express = require("express");
const router = express.Router();
require("dotenv").config();
const ethers = require("ethers");
const addressManager = require("../../lib/AddressManager.json");
const FusionForwarderABI = require("../../lib/abi/FusionForwarder.json");
const FusionABI = require("../../lib/abi/Fusion.json");
const FusionProxyFactoryABI = require("../../lib/abi/FusionProxyFactory.json");
const { verify_password } = require("../../utils/circuits/password_prove");
const { verify_signature } = require("../../utils/circuits/signature_prove");
const {
  verifyChangeRecoveryPayload,
  getGasEstimatesErc20,
  getGasEstimates,
  getGaslessEstimates,
} = require("../../utils/contracts/change");

const {
  getDomainBalance,
  withdrawFees,
  estimateWithdrawFees,
} = require("../../utils/gasToken");

router.post("/native/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId) {
      return res.json({ success: false, error: "chainId is required" });
    }

    const mode = req.body.mode;

    if (!mode) {
      return res.json({ success: false, error: "mode is required" });
    }

    const currentChain = addressManager.find(
      (chain) => chain.chainId === Number(chainId)
    );

    if (!currentChain) {
      return res.json({ success: false, error: "Chain not found" });
    }

    const forwardRequest = req.body.forwardRequest;

    if (!forwardRequest) {
      return res.json({
        success: false,
        error: "forwardRequest is required",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(currentChain.rpcUrl);

    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const forwarder = new ethers.Contract(
      currentChain.addresses.FusionForwarder,
      FusionForwarderABI,
      signer
    );

    const {
      gasEstimate,
      gasPrice,
      baseGas,
      estimateFees,
    } = await getGasEstimates(
      provider,
      forwarder,
      forwardRequest,
      currentChain
    );

    const balance = Number(await provider.getBalance(forwardRequest.recipient));

    if (balance < Number(estimateFees)) {
      return res.json({
        success: false,
        error: "Insufficient balance for transaction",
      });
    }

    const Fusion = new ethers.Contract(
      forwardRequest.recipient,
      FusionABI,
      signer
    );

    const gasTank = await Fusion.GasTank();

    if (gasTank !== currentChain.addresses.FusionGasTank) {
      return res.json({
        success: false,
        error: "GasTank address is invalid",
      });
    }

    const nonce = await Fusion.getNonce();
    const messageHash = ethers.utils.hashMessage(nonce.toString());

    const hash = await Fusion.RecoveryHash();

    if (hash === forwardRequest.newRecoveryHash) {
      return res.json({
        success: false,
        error: "RecoveryHash should not be the same as newRecoveryHash",
      });
    }

    if (mode === "password") {
      const isVerified = await verify_password(
        messageHash,
        hash,
        forwardRequest.proof,
        forwardRequest.from
      );
      if (!isVerified) {
        return res.json({ success: false, error: "Proof is invalid" });
      }
    }

    if (mode === "signature") {
      const isVerified = await verify_signature(
        messageHash,
        hash,
        forwardRequest.proof,
        forwardRequest.from
      );
      if (!isVerified) {
        return res.json({ success: false, error: "Proof is invalid" });
      }
    }

    const data = forwarder.interface.encodeFunctionData("changeRecovery", [
      forwardRequest,
      "0x0000000000000000000000000000000000000000",
      gasPrice.toString(),
      (Number(gasEstimate) + Number(baseGas)).toString(),
      estimateFees,
    ]);

    const isSignatureValid = await verifyChangeRecoveryPayload(
      forwardRequest,
      forwarder,
      currentChain
    );

    if (!isSignatureValid) {
      return res.json({ success: false, error: "Signature is invalid" });
    }

    const unSignedTx = {
      to: forwarder.address,
      data,
      value: 0,
      gasLimit: 2000000,
      gasPrice: gasPrice,
    };

    const signedTx = await signer.sendTransaction(unSignedTx);

    const receipt = await signedTx.wait();

    res.json({ success: true, receipt });
  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

router.get("/estimate/native/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId) {
      return res.json({ success: false, error: "chainId is required" });
    }

    const currentChain = addressManager.find(
      (chain) => chain.chainId === Number(chainId)
    );

    if (!currentChain) {
      return res.json({ success: false, error: "Chain not found" });
    }

    const forwardRequest = JSON.parse(req.query.forwardRequest);

    if (!forwardRequest) {
      return res.json({
        success: false,
        error: "forwardRequest is required",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(currentChain.rpcUrl);

    const forwarder = new ethers.Contract(
      currentChain.addresses.FusionForwarder,
      FusionForwarderABI,
      provider
    );

    const {
      gasEstimate,
      gasPrice,
      baseGas,
      estimateFees,
    } = await getGasEstimates(
      provider,
      forwarder,
      forwardRequest,
      currentChain
    );

    res.json({
      success: true,
      estimates: {
        gasEstimate,
        gasPrice,
        baseGas,
        estimateFees: Number(estimateFees),
      },
    });
  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

router.post("/erc20/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId) {
      return res.json({ success: false, error: "chainId is required" });
    }

    const mode = req.body.mode;

    if (!mode) {
      return res.json({ success: false, error: "mode is required" });
    }

    const erc20address = req.query.address;

    if (!erc20address) {
      return res.json({ success: false, error: "erc20address is required" });
    }

    const currentChain = addressManager.find(
      (chain) => chain.chainId === Number(chainId)
    );

    if (!currentChain) {
      return res.json({ success: false, error: "Chain not found" });
    }

    const currentToken = currentChain.tokens.find(
      (token) => token.address === erc20address
    );

    if (!currentToken) {
      return res.json({ success: false, error: "Token not found" });
    }

    const forwardRequest = req.body.forwardRequest;

    if (!forwardRequest) {
      return res.json({
        success: false,
        error: "forwardRequest is required",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(currentChain.rpcUrl);

    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const forwarder = new ethers.Contract(
      currentChain.addresses.FusionForwarder,
      FusionForwarderABI,
      signer
    );

    const {
      gasEstimate,
      gasPrice,
      ethGas,
      baseGas,
      estimateFees,
    } = await getGasEstimatesErc20(
      provider,
      forwarder,
      forwardRequest,
      currentChain,
      currentToken
    );

    const erc20Contract = new ethers.Contract(
      currentToken.address,
      ["function balanceOf(address owner) view returns (uint256)"],
      signer
    );

    const balanceOfRecipient = Number(
      await erc20Contract.balanceOf(forwardRequest.recipient)
    );

    if (
      balanceOfRecipient <
      estimateFees / 10 ** (18 - currentToken.decimals)
    ) {
      return res.json({
        success: false,
        error: "Insufficient token balance for transaction",
      });
    }

    const Fusion = new ethers.Contract(
      forwardRequest.recipient,
      FusionABI,
      signer
    );

    const gasTank = await Fusion.GasTank();

    if (gasTank !== currentChain.addresses.FusionGasTank) {
      return res.json({
        success: false,
        error: "GasTank address is invalid",
      });
    }

    const nonce = await Fusion.getNonce();
    const messageHash = ethers.utils.hashMessage(nonce.toString());

    const hash = await Fusion.RecoveryHash();

    if (hash === forwardRequest.newRecoveryHash) {
      return res.json({
        success: false,
        error: "RecoveryHash should not be the same as newRecoveryHash",
      });
    }

    if (mode === "password") {
      const isVerified = await verify_password(
        messageHash,
        hash,
        forwardRequest.proof,
        forwardRequest.from
      );
      if (!isVerified) {
        return res.json({ success: false, error: "Proof is invalid" });
      }
    }

    if (mode === "signature") {
      const isVerified = await verify_signature(
        messageHash,
        hash,
        forwardRequest.proof,
        forwardRequest.from
      );
      if (!isVerified) {
        return res.json({ success: false, error: "Proof is invalid" });
      }
    }

    const data = forwarder.interface.encodeFunctionData("changeRecovery", [
      forwardRequest,
      currentToken.address,
      gasPrice.toString(),
      (Number(gasEstimate) + Number(baseGas)).toString(),
      estimateFees,
    ]);

    const isSignatureValid = await verifyChangeRecoveryPayload(
      forwardRequest,
      forwarder,
      currentChain
    );

    if (!isSignatureValid) {
      return res.json({ success: false, error: "Signature is invalid" });
    }

    const unSignedTx = {
      to: forwarder.address,
      data,
      value: 0,
      gasLimit: 2000000,
      gasPrice: ethGas,
    };

    const signedTx = await signer.sendTransaction(unSignedTx);

    const receipt = await signedTx.wait();

    res.json({ success: true, receipt });
  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

router.get("/estimate/erc20/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId) {
      return res.json({ success: false, error: "chainId is required" });
    }

    const erc20address = req.query.address;

    if (!erc20address) {
      return res.json({ success: false, error: "erc20address is required" });
    }

    const currentChain = addressManager.find(
      (chain) => chain.chainId === Number(chainId)
    );

    if (!currentChain) {
      return res.json({ success: false, error: "Chain not found" });
    }

    const currentToken = currentChain.tokens.find(
      (token) => token.address === erc20address
    );

    if (!currentToken) {
      return res.json({ success: false, error: "Token not found" });
    }

    const forwardRequest = JSON.parse(req.query.forwardRequest);

    if (!forwardRequest) {
      return res.json({
        success: false,
        error: "forwardRequest is required",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(currentChain.rpcUrl);

    const forwarder = new ethers.Contract(
      currentChain.addresses.FusionForwarder,
      FusionForwarderABI,
      provider
    );

    const {
      gasEstimate,
      gasPrice,
      baseGas,
      estimateFees,
    } = await getGasEstimatesErc20(
      provider,
      forwarder,
      forwardRequest,
      currentChain,
      currentToken
    );

    res.json({
      success: true,
      estimates: {
        gasEstimate,
        gasPrice,
        baseGas,
        estimateFees: Number(estimateFees),
      },
    });
  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

router.post("/gasless/:domain/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId) {
      return res.json({ success: false, error: "chainId is required" });
    }

    const domain = req.params.domain;

    if (!domain) {
      return res.json({ success: false, error: "domain is required" });
    }

    const mode = req.body.mode;

    if (!mode) {
      return res.json({ success: false, error: "mode is required" });
    }

    const currentChain = addressManager.find(
      (chain) => chain.chainId === Number(chainId)
    );

    if (!currentChain) {
      return res.json({ success: false, error: "Chain not found" });
    }

    const forwardRequest = req.body.forwardRequest;

    if (!forwardRequest) {
      return res.json({
        success: false,
        error: "forwardRequest is required",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(currentChain.rpcUrl);

    let factory = new ethers.Contract(
      currentChain.addresses.FusionProxyFactory,
      FusionProxyFactoryABI,
      provider
    );

    const FusionAddress = await factory.getFusionProxy(domain);

    if (FusionAddress !== forwardRequest.recipient) {
      return res.json({
        success: false,
        error: "Recipient address does not match the domain",
      });
    }

    const domainBalance = await getDomainBalance(domain);

    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const forwarder = new ethers.Contract(
      currentChain.addresses.FusionForwarder,
      FusionForwarderABI,
      signer
    );

    const {
      gasEstimate,
      gasPrice,
      ethGas,
      baseGas,
      estimateFees,
    } = await getGaslessEstimates(
      provider,
      forwarder,
      forwardRequest,
      currentChain
    );

    const withdrawEstimatedFees = await estimateWithdrawFees(
      domain,
      chainId,
      "0x0c5803837d232b5758443e370d4add9a7fb71311e47026f284a5d81bcea7ee84",
      Number(estimateFees)
    );

    if (
      domainBalance === 0 ||
      domainBalance < Number(estimateFees) + Number(withdrawEstimatedFees)
    ) {
      return res.json({
        success: false,
        error: "Insufficient balance for transaction",
      });
    }

    const Fusion = new ethers.Contract(
      forwardRequest.recipient,
      FusionABI,
      signer
    );

    const gasTank = await Fusion.GasTank();

    if (gasTank !== currentChain.addresses.FusionGasTank) {
      return res.json({
        success: false,
        error: "GasTank address is invalid",
      });
    }

    const nonce = await Fusion.getNonce();
    const messageHash = ethers.utils.hashMessage(nonce.toString());

    const hash = await Fusion.RecoveryHash();

    if (hash === forwardRequest.newRecoveryHash) {
      return res.json({
        success: false,
        error: "RecoveryHash should not be the same as newRecoveryHash",
      });
    }

    if (mode === "password") {
      const isVerified = await verify_password(
        messageHash,
        hash,
        forwardRequest.proof,
        forwardRequest.from
      );
      if (!isVerified) {
        return res.json({ success: false, error: "Proof is invalid" });
      }
    }

    if (mode === "signature") {
      const isVerified = await verify_signature(
        messageHash,
        hash,
        forwardRequest.proof,
        forwardRequest.from
      );
      if (!isVerified) {
        return res.json({ success: false, error: "Proof is invalid" });
      }
    }

    const data = forwarder.interface.encodeFunctionData("changeRecovery", [
      forwardRequest,
      "0x0000000000000000000000000000000000000000",
      "0",
      "0",
      "0",
    ]);

    const isSignatureValid = await verifyChangeRecoveryPayload(
      forwardRequest,
      forwarder,
      currentChain
    );

    if (!isSignatureValid) {
      return res.json({ success: false, error: "Signature is invalid" });
    }

    const unSignedTx = {
      to: forwarder.address,
      data,
      value: 0,
      gasLimit: 2000000,
      gasPrice: ethGas,
    };

    const signedTx = await signer.sendTransaction(unSignedTx);

    const receipt = await signedTx.wait();

    await withdrawFees(
      domain,
      chainId,
      receipt.transactionHash,
      Number(estimateFees) + Number(withdrawEstimatedFees)
    );

    res.json({ success: true, receipt });
  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

router.get("/estimate/gasless/:chainId", async (req, res) => {
  try {
    const { chainId } = req.params;

    if (!chainId) {
      return res.json({ success: false, error: "chainId is required" });
    }

    const currentChain = addressManager.find(
      (chain) => chain.chainId === Number(chainId)
    );

    if (!currentChain) {
      return res.json({ success: false, error: "Chain not found" });
    }

    const forwardRequest = JSON.parse(req.query.forwardRequest);

    if (!forwardRequest) {
      return res.json({
        success: false,
        error: "forwardRequest is required",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(currentChain.rpcUrl);

    const forwarder = new ethers.Contract(
      currentChain.addresses.FusionForwarder,
      FusionForwarderABI,
      provider
    );

    const {
      gasEstimate,
      gasPrice,
      ethGas,
      baseGas,
      estimateFees,
    } = await getGaslessEstimates(
      provider,
      forwarder,
      forwardRequest,
      currentChain
    );

    const withdrawEstimatedFees = await estimateWithdrawFees(
      "anoy.fusion.id",
      chainId,
      "0x0c5803837d232b5758443e370d4add9a7fb71311e47026f284a5d81bcea7ee84",
      Number(estimateFees)
    );

    res.json({
      success: true,
      estimates: {
        gasEstimate,
        gasPrice,
        ethGas,
        baseGas,
        estimateFees: Number(estimateFees) + Number(withdrawEstimatedFees),
      },
    });
  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
