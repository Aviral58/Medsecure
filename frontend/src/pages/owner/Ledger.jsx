import { useCallback, useEffect, useMemo, useState } from "react";
import { Chips, CopyValue, Empty, PageHead, Skeleton, Tag } from "../../components/Bits.jsx";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { count, formatDateTime } from "../../lib/format.js";

const PAGE = 40;

export default function OwnerLedger() {
  const toast = useToast();
  const [ledger, setLedger] = useState(null); // { transactions, total }
  const [limit, setLimit] = useState(PAGE);
  const [action, setAction] = useState("all");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (size) => {
      setLoading(true);
      return api(`/admin/ledger?limit=${size}`)
        .then(setLedger)
        .catch(toast.error)
        .finally(() => setLoading(false));
    },
    [toast],
  );

  useEffect(() => {
    load(limit);
  }, [load, limit]);

  const actions = useMemo(() => {
    const counts = new Map();
    for (const tx of ledger?.transactions || []) counts.set(tx.action, (counts.get(tx.action) || 0) + 1);
    return [{ id: "all", label: "All", count: ledger?.transactions.length || 0 }, ...[...counts].sort((a, b) => b[1] - a[1]).map(([name, number]) => ({ id: name, label: name, count: number }))];
  }, [ledger]);

  const shown = (ledger?.transactions || []).filter((tx) => action === "all" || tx.action === action);

  return (
    <>
      <PageHead
        title="Blockchain ledger"
        actions={
          <button type="button" className="button" onClick={() => load(limit)} disabled={loading}>
            <Icon name="refresh" size={18} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        }
      >
        Every change to the network is a transaction on the chain, signed by the account that made it. This is what a node operator can see: the kind of
        action, the address and the time. Names, emails and the records themselves are not on the chain.
      </PageHead>

      {ledger === null && <Skeleton rows={6} />}
      {ledger?.transactions.length === 0 && (
        <Empty icon="chain" title="No transactions yet">
          The first one appears when the smart contract is deployed.
        </Empty>
      )}

      {ledger?.transactions.length > 0 && (
        <>
          {actions.length > 2 && <Chips options={actions} value={action} onChange={setAction} label="Kind of transaction" />}
          <div className="table-wrap">
            <table className="table table-ledger">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>What happened</th>
                  <th>Signed by</th>
                  <th>Block</th>
                  <th>Gas used</th>
                  <th>Time</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tx) => (
                  <tr key={tx.hash}>
                    <td className="numeric">{tx.number}</td>
                    <td>
                      <strong>{tx.action}</strong>
                      {tx.contractCall && (
                        <>
                          <br />
                          <span className="mono muted">{tx.contractCall}()</span>
                        </>
                      )}
                      {tx.succeeded === false && <Tag tone="alert">Rejected by the contract</Tag>}
                    </td>
                    <td>
                      <CopyValue value={tx.from} label="address" head={8} tail={4} />
                    </td>
                    <td className="numeric">{tx.block ?? ""}</td>
                    <td className="numeric">{tx.gasUsed?.toLocaleString() ?? ""}</td>
                    <td>{formatDateTime(tx.time)}</td>
                    <td>
                      <CopyValue value={tx.hash} label="transaction hash" head={8} tail={4} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="list-foot">
            Showing the newest {ledger.transactions.length} of {count(ledger.total, "transaction")}.{" "}
            {ledger.transactions.length < ledger.total && limit < 200 && (
              <button type="button" className="link-button" onClick={() => setLimit(Math.min(200, limit + 80))}>
                Show more
              </button>
            )}
          </p>
        </>
      )}
    </>
  );
}
