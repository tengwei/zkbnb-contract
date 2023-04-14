import chai, { expect } from 'chai';
import hardhat, { ethers } from 'hardhat';
import { smock } from '@defi-wonderland/smock';
import assert from 'assert';
import { BigNumber } from 'ethers';

import exitAssetData from './performDesertAsset5.json';
import exitNftData from './performDesertNft3.json';

chai.use(smock.matchers);

describe('Desert Mode', function () {
  let owner, acc1;
  let zkBNB;

  this.beforeEach(async function () {
    [owner, acc1] = await ethers.getSigners();
    this.mockDesertVerifier = await smock.fake('DesertVerifier');

    const Governance = await ethers.getContractFactory('Governance');
    const governance = await Governance.deploy();
    await governance.deployed();

    const MockZkBNBVerifier = await smock.mock('ZkBNBVerifier');
    const mockZkBNBVerifier = await MockZkBNBVerifier.deploy();
    await mockZkBNBVerifier.deployed();

    const Utils = await ethers.getContractFactory('Utils');
    const utils = await Utils.deploy();
    await utils.deployed();

    const AdditionalZkBNB = await ethers.getContractFactory('AdditionalZkBNB');
    const additionalZkBNB = await AdditionalZkBNB.deploy();
    await additionalZkBNB.deployed();

    const ZkBNBTest = await ethers.getContractFactory('ZkBNBTest', {
      libraries: {
        Utils: utils.address,
      },
    });
    zkBNB = await ZkBNBTest.deploy();
    await zkBNB.deployed();

    const initParams = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'address', 'bytes32'],
      [
        governance.address,
        mockZkBNBVerifier.address,
        additionalZkBNB.address,
        mockZkBNBVerifier.address,
        ethers.utils.formatBytes32String('genesisStateRoot'),
      ],
    );
    await zkBNB.initialize(initParams);
  });

  it('shoud revert if perform desert is not executed in desert mode', async () => {
    const blockInfo = exitAssetData.StoredBlockInfo;
    const assetData = exitAssetData.AssetExitData;
    const accountData = exitAssetData.AccountExitData;

    const tx = zkBNB.performDesert(
      [
        blockInfo.BlockSize,
        blockInfo.BlockNumber,
        blockInfo.PriorityOperations,
        ethers.utils.arrayify('0x' + blockInfo.PendingOnchainOperationsHash),
        blockInfo.Timestamp,
        ethers.utils.arrayify('0x' + blockInfo.StateRoot),
        ethers.utils.arrayify('0x' + blockInfo.Commitment),
      ],
      '0x' + exitAssetData.NftRoot,
      [assetData.AssetId, BigNumber.from(assetData.Amount.toString()), assetData.OfferCanceledOrFinalized],
      [
        accountData.AccountId,
        accountData.L1Address,
        ethers.utils.hexZeroPad(BigNumber.from(accountData.PubKeyX).toHexString(), 32),
        ethers.utils.hexZeroPad(BigNumber.from(accountData.PubKeyY).toHexString(), 32),
        accountData.Nonce,
        accountData.CollectionNonce,
      ],
      exitAssetData.AssetMerkleProof.map((el: string) => BigNumber.from('0x' + el)),
      exitAssetData.AccountMerkleProof.map((el: string) => BigNumber.from('0x' + el)),
    );

    await expect(tx).to.revertedWith('s');
  });

  it('should revert if perform desert NFT is not executed in desert mode', async () => {
    const blockInfo = exitNftData.StoredBlockInfo;
    const accountData = exitNftData.AccountExitData;
    const nftData = exitNftData.ExitNfts[0];

    const nftProof = new Array<BigNumber>(40).fill(BigNumber.from(0));
    const nftProofs = [nftProof];

    for (const [i, proof] of exitNftData.NftMerkleProofs.entries()) {
      nftProofs[i] = proof.map((el: string) => BigNumber.from('0x' + el));
    }

    const tx = zkBNB.performDesertNft(
      [
        blockInfo.BlockSize,
        blockInfo.BlockNumber,
        blockInfo.PriorityOperations,
        ethers.utils.arrayify('0x' + blockInfo.PendingOnchainOperationsHash),
        blockInfo.Timestamp,
        ethers.utils.arrayify('0x' + blockInfo.StateRoot),
        ethers.utils.arrayify('0x' + blockInfo.Commitment),
      ],

      '0x' + exitNftData.AssetRoot,
      [
        accountData.AccountId,
        accountData.L1Address,
        ethers.utils.arrayify('0x' + accountData.PubKeyX),
        ethers.utils.arrayify('0x' + accountData.PubKeyY),
        accountData.Nonce,
        accountData.CollectionNonce,
      ],
      [
        [
          nftData.NftIndex,
          nftData.OwnerAccountIndex,
          nftData.CreatorAccountIndex,
          nftData.CreatorTreasuryRate,
          nftData.CollectionId,
          ethers.utils.arrayify('0x' + nftData.NftContentHash1),
          ethers.utils.arrayify('0x' + nftData.NftContentHash2),
          nftData.NftContentType,
        ],
      ],
      exitNftData.AccountMerkleProof.map((el: string) => BigNumber.from('0x' + el)),
      nftProofs,
    );

    await expect(tx).to.revertedWith('s');
  });

  it('should be abole to activate desert mode', async () => {
    await expect(await zkBNB.depositBNB(acc1.address, { value: 1000 })).to.emit(zkBNB, 'Deposit');

    // cannot activate desert mode before expired
    await expect(await zkBNB.activateDesertMode()).to.not.to.emit(zkBNB, 'DesertMode');

    await hardhat.network.provider.send('hardhat_mine', ['0x1000000']);
    // able to activate desert mode once expired
    await expect(await zkBNB.activateDesertMode()).to.emit(zkBNB, 'DesertMode');
    assert.equal(await zkBNB.desertMode(), true);
  });

  it('should be able to cancel outstanding deposits', async () => {
    const depositTx = await zkBNB.depositBNB(acc1.address, { value: ethers.utils.parseEther('0.001') });
    const receipt = await depositTx.wait();
    const prEvent = receipt.events.find((ev) => {
      return ev.event === 'NewPriorityRequest';
    });
    const pubdata = prEvent.args[3];

    // activate desert mode first
    await hardhat.network.provider.send('hardhat_mine', ['0x1000000']);
    await expect(await zkBNB.activateDesertMode()).to.emit(zkBNB, 'DesertMode');
    assert.equal(await zkBNB.totalOpenPriorityRequests(), 1);

    // cancel outstanding deposit
    await zkBNB.cancelOutstandingDepositsForDesertMode(5, [pubdata]);
    assert.equal(await zkBNB.totalOpenPriorityRequests(), 0);
  });

  // it.skip('should be able to cancel outstanding NFT deposits', async () => { });

  it('should be able to withdraw pending balance', async () => {
    await zkBNB.depositBNB(owner.address, { value: ethers.utils.parseEther('2000') });

    const token = ethers.constants.AddressZero;
    const amount = 55_000_000_000;
    const assetId = 0;

    await zkBNB.testIncreasePendingBalance(assetId, owner.address, amount);

    const balance = await zkBNB.getPendingBalance(owner.address, token);
    assert.equal(balance, amount);

    // const before = await ethers.provider.getBalance(owner.address);
    await expect(await zkBNB.withdrawPendingBalance(owner.address, token, amount))
      .to.emit(zkBNB, 'Withdrawal')
      .withArgs(assetId, amount);
    // const after = await ethers.provider.getBalance(owner.address);

    // console.log(before, after);
  });
});
