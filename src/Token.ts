import {
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  SmartContract,
  State,
  method,
  state,
} from 'o1js';

let emptyMerkleMapRoot = new MerkleMap().getRoot();

export class Token extends SmartContract {
  @state(Field) totalSupply = State<Field>();
  @state(Field) balances = State<Field>();

  init() {
    super.init();
    this.totalSupply.set(Field(0));
    this.balances.set(emptyMerkleMapRoot);
  }

  @method async mint(
    balanceBefore: Field,
    balanceWitness: MerkleMapWitness,
    mintAmount: Field
  ) {
    const [prevRoot] = balanceWitness.computeRootAndKeyV2(balanceBefore);
    this.balances
      .getAndRequireEquals()
      .assertEquals(prevRoot, 'Wrong witness for balances');

    const newValue = balanceBefore.add(mintAmount);
    const [newRoot] = balanceWitness.computeRootAndKeyV2(newValue);

    this.balances.set(newRoot);
    this.totalSupply.set(
      this.totalSupply.getAndRequireEquals().add(mintAmount)
    );
  }

  /*
    Here we have to update two leaf of Merkle Map - balance for A and balance for B
    For this to work balanceAWitness - will be simple witness of current merkle map
    But balanceBWitness will be witness for merkle map, that have modified value for balance A (i.e balancA - transferAmount)
  */
  @method async transferTo(
    transferAmount: Field,
    balanceABefore: Field,
    balanceAWitness: MerkleMapWitness,
    balanceBBefore: Field,
    balanceBWitness: MerkleMapWitness
  ) {
    let sender = this.sender.getAndRequireSignature();
    const [prevRoot, senderHash] =
      balanceAWitness.computeRootAndKeyV2(balanceABefore);
    this.balances
      .getAndRequireEquals()
      .assertEquals(prevRoot, 'Wrong witness for balances A');
    Poseidon.hash(sender.toFields()).assertEquals(
      senderHash,
      'Only owner can transfer'
    );

    transferAmount.assertLessThanOrEqual(
      balanceABefore,
      "Can't transfer more then you have"
    );
    const newValueA = balanceABefore.sub(transferAmount);
    const [newRootA] = balanceAWitness.computeRootAndKeyV2(newValueA);

    const [prevRootB] = balanceBWitness.computeRootAndKeyV2(balanceBBefore);
    prevRootB.assertEquals(newRootA, 'Wrong witness for balanceB');

    const newValueB = balanceBBefore.add(transferAmount);
    const [newRoot] = balanceBWitness.computeRootAndKeyV2(
      balanceBBefore.add(newValueB)
    );

    this.balances.set(newRoot);
  }
}
