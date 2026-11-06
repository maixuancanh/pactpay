export function accountPermissionChange(
  selected: string,
  accounts: { address: string }[],
) {
  const removed =
    !!selected && !accounts.some((account) => account.address === selected);
  return { selected: removed ? "" : selected, removed };
}
export function assertReviewAuthority(
  preparedEpoch: number,
  currentEpoch: number,
  preparedAccount: string,
  currentAccount: string,
) {
  if (
    preparedEpoch !== currentEpoch ||
    !preparedAccount ||
    preparedAccount !== currentAccount
  )
    throw Error(
      "Wallet authority changed while preparing this action. Review it again.",
    );
}
export function selectedAuthorityChanged(selected:string, previous:{address:string;source:string}[],next:{address:string;source:string}[]){
  if(!selected)return false;
  const before=previous.find(a=>a.address===selected),after=next.find(a=>a.address===selected);
  return !before||!after||before.source!==after.source;
}
