/** A banner refusal can affect both signup forms. One success cannot hide
 * another form's failed or still-pending withdrawal. */
export function createWithdrawalBatch() {
  let pending = 0;
  let failed = false;
  return {
    begin() {
      if (pending === 0) failed = false;
      pending += 1;
    },
    settle(recorded: boolean) {
      pending = Math.max(0, pending - 1);
      failed ||= !recorded;
      return pending === 0 && !failed;
    },
  };
}
