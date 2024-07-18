import {
  Bool,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  Provable,
  PublicKey,
  Reducer,
  SmartContract,
  State,
  Struct,
  method,
  state,
} from 'o1js';

const MAX_ACTIONS = 10;

let emptyMerkleMapRoot = new MerkleMap().getRoot();

class ActionReduceElement extends Struct({
  id: Field,
  active: Bool,
  balanceABefore: Field,
  balanceAWitness: MerkleMapWitness,
  balanceBBefore: Field,
  balanceBWitness: MerkleMapWitness,
}) {}

class ActionReduceElements extends Struct({
  element: Provable.Array(ActionReduceElement, MAX_ACTIONS),
}) {
  findElement(id: Field): ActionReduceElement {
    let res = this.element[0];
    let found = Bool(false);

    for (let i = 0; i < MAX_ACTIONS; i++) {
      let match = this.element[i].id.equals(id);
      res = Provable.if(match, ActionReduceElement, this.element[i], res);
      found = found.or(match);
    }

    found.assertTrue();

    return res;
  }
}

export class TransferAction extends Struct({
  from: PublicKey,
  to: PublicKey,
  amount: Field,
}) {}

export class ReduceState extends Struct({
  id: Field,
  newRoot: Field,
}) {}

export class AToken extends SmartContract {
  @state(Field) totalSupply = State<Field>();
  @state(Field) balances = State<Field>();

  reducer = Reducer({ actionType: TransferAction });

  init() {
    super.init();
    this.totalSupply.set(Field(0));
    this.balances.set(emptyMerkleMapRoot);
  }

  @method async mint(address: PublicKey, amount: Field) {
    this.reducer.dispatch(
      new TransferAction({
        from: PublicKey.empty(),
        to: address,
        amount,
      })
    );
  }

  @method async transferTo(to: PublicKey, amount: Field) {
    // Here we skips all checks that were on transferTo of Token contract.
    // We just add another request for transfer. It do not change balances now, however it will change it later, when we will call reduce
    this.reducer.dispatch(
      new TransferAction({
        from: this.sender.getAndRequireSignature(),
        to,
        amount,
      })
    );
  }

  @method async reduce(elements: ActionReduceElements) {
    let pendingActions = this.reducer.getActions();
    let balances = this.balances.getAndRequireEquals();

    this.reducer.reduce(
      pendingActions,
      ReduceState,
      (state: ReduceState, action: TransferAction) => {
        let element = elements.findElement(state.id);
        let newRoot = this.updateBalanceTree(state.newRoot, action, element);

        return new ReduceState({
          id: state.id,
          newRoot,
        });
      },
      new ReduceState({ id: Field(0), newRoot: balances }),
      { maxUpdatesWithActions: 10 }
    );
  }

  // Here lies code, that was in transferTo in Token contract.
  updateBalanceTree(
    curState: Field,
    action: TransferAction,
    actionElement: ActionReduceElement
  ): Field {
    let sender = action.from;
    const [prevRoot, senderHash] =
      actionElement.balanceAWitness.computeRootAndKeyV2(
        actionElement.balanceABefore
      );
    curState.assertEquals(prevRoot, 'Wrong witness for balances A');
    action.amount.assertLessThanOrEqual(
      actionElement.balanceABefore,
      "Can't transfer more then you have"
    );
    const newValueA = actionElement.balanceABefore.sub(action.amount);
    const [newRootA] =
      actionElement.balanceAWitness.computeRootAndKeyV2(newValueA);
    const [prevRootB] = actionElement.balanceBWitness.computeRootAndKeyV2(
      actionElement.balanceBBefore
    );
    prevRootB.assertEquals(newRootA, 'Wrong witness for balanceB');
    const newValueB = actionElement.balanceBBefore.add(action.amount);
    const [newRoot] = actionElement.balanceBWitness.computeRootAndKeyV2(
      actionElement.balanceBBefore.add(newValueB)
    );
    return newRoot;
  }
}
