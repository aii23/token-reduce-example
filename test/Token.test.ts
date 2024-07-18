import {
  AccountUpdate,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
} from 'o1js';

import { Token } from '../src/Token';

/*
 * This file specifies how to test the `Add` example smart contract. It is safe to delete this file and replace
 * with your own tests.
 *
 * See https://docs.minaprotocol.com/zkapps for more info.
 */

let proofsEnabled = false;

describe('Add', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    senderKey: PrivateKey,
    alice: Mina.TestPublicKey,
    bob: Mina.TestPublicKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: Token;

  beforeAll(async () => {
    if (proofsEnabled) await Token.compile();
  });

  beforeEach(async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    [deployerAccount, senderAccount, alice, bob] = Local.testAccounts;
    deployerKey = deployerAccount.key;
    senderKey = senderAccount.key;

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new Token(zkAppAddress);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkApp.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('Simple transfer', async () => {
    await localDeploy();

    let balances = new MerkleMap();
    let aliceHash = Poseidon.hash(alice.toFields());
    let bobHash = Poseidon.hash(bob.toFields());

    const mintAmount = Field(1000);
    const transferAmount = Field(100);

    // Mint tokens for Alice
    let aliceBalance = balances.get(aliceHash);
    let aliceWitness = balances.getWitness(aliceHash);
    balances.set(aliceHash, mintAmount);

    const tx1 = await Mina.transaction(alice, async () => {
      zkApp.mint(aliceBalance, aliceWitness, mintAmount);
    });

    await tx1.prove();
    await tx1.sign([alice.key]).send();

    expect(zkApp.balances.get()).toEqual(balances.getRoot());

    // Transfer token from Alice to Bob
    let balanceABefore = balances.get(aliceHash);
    let balanceAWitness = balances.getWitness(aliceHash);
    balances.set(aliceHash, balanceABefore.sub(transferAmount));
    let balanceBBefore = balances.get(bobHash);
    let balanceBWitness = balances.getWitness(bobHash);
    balances.set(bobHash, transferAmount);

    const tx2 = await Mina.transaction(alice, async () => {
      zkApp.transferTo(
        transferAmount,
        balanceABefore,
        balanceAWitness,
        balanceBBefore,
        balanceBWitness
      );
    });

    await tx2.prove();
    await tx2.sign([alice.key]).send();

    // Check balances

    expect(balances.get(aliceHash)).toEqual(mintAmount.sub(transferAmount));
    expect(balances.get(bobHash)).toEqual(transferAmount);
    expect(zkApp.balances.get()).toEqual(balances.getRoot());
  });
});
