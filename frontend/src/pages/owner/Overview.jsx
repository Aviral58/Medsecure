import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CopyValue, PageHead, Section, Skeleton } from "../../components/Bits.jsx";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { count } from "../../lib/format.js";

export default function OwnerOverview() {
  const toast = useToast();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api("/admin/status").then(setStatus).catch(toast.error);
  }, [toast]);

  if (!status) {
    return (
      <>
        <PageHead title="Hospital network" />
        <Skeleton rows={4} />
      </>
    );
  }

  const { chain, activity } = status;
  const running = Boolean(status.ipfs);
  return (
    <>
      <PageHead
        title={
          status.hospitals === 0
            ? "The network is running. No hospital has joined yet."
            : `The network has ${count(status.hospitals, "hospital")}, ${count(status.doctors, "doctor")} and ${count(status.patients, "patient")}.`
        }
        actions={
          <Link className="button button-primary" to="/hospitals" state={{ add: true }}>
            <Icon name="plus" size={18} />
            Add a hospital
          </Link>
        }
      >
        You decide which hospitals join. Each hospital gets an admin, who verifies that hospital's doctors. You cannot read any patient record: this page
        shows counts only.
      </PageHead>

      <div className="split">
        <Section title="What the blockchain has recorded" note="Counted from the smart contract's events.">
          <dl className="ledger-counts">
            <div>
              <dt>
                <Icon name="records" /> Records stored
              </dt>
              <dd>{activity.records}</dd>
            </div>
            <div>
              <dt>
                <Icon name="share" /> Times a patient shared a record
              </dt>
              <dd>{activity.shares}</dd>
            </div>
            <div>
              <dt>
                <Icon name="eye" /> Times a doctor opened a record
              </dt>
              <dd>{activity.opens}</dd>
            </div>
            <div>
              <dt>
                <Icon name="emergency" /> Uses of emergency access
              </dt>
              <dd>{activity.emergencyUses}</dd>
            </div>
          </dl>
          <p className="more-link">
            <Link to="/ledger">See the transactions</Link>
          </p>
        </Section>

        <Section title="The system">
          <ul className="system">
            <li className="system-ok">
              <Icon name="chain" />
              <div>
                <strong>Blockchain</strong>
                <span>
                  At block {chain.blockNumber}. {count(chain.transactions, "transaction")} kept in the journal, so the chain is rebuilt after a restart.
                </span>
              </div>
            </li>
            <li className={running ? "system-ok" : "system-down"}>
              <Icon name="records" />
              <div>
                <strong>IPFS file store</strong>
                <span>{running ? `Kubo ${status.ipfs} is running on this computer. It holds only encrypted files.` : "Not reachable. Records cannot be added or opened until it is running."}</span>
              </div>
            </li>
            <li className="system-ok">
              <Icon name="shield" />
              <div>
                <strong>Smart contract</strong>
                <span>Holds the access rules. Its address:</span>
                <CopyValue value={chain.contractAddress} label="contract address" full />
              </div>
            </li>
            <li className="system-ok">
              <Icon name="spark" />
              <div>
                <strong>AI models</strong>
                <span>
                  All five run on this computer. <Link to="/models">How each was built and tested</Link>
                </span>
              </div>
            </li>
          </ul>
        </Section>
      </div>
    </>
  );
}
