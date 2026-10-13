import { useEffect, useState } from "react";
import { PageHead, Skeleton } from "../../components/Bits.jsx";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";

const ICONS = {
  "Report summary": "spark",
  "Ask about this report": "send",
  "Reading photos and scans (OCR)": "camera",
  "Record type suggestion": "records",
  "Unusual access detection": "alert",
};

const USED_FOR = {
  "Report summary": "Writes the summary shown beside every opened record, in clinical wording for doctors and plain language for patients.",
  "Ask about this report": "Answers questions about the record that is open, from that record only, and declines requests for medical advice.",
  "Reading photos and scans (OCR)": "Reads the text in a photo or scan of a report, so pictures get a summary and answers too.",
  "Record type suggestion": "Suggests what kind of record a file is when it is added.",
  "Unusual access detection": "Looks through the access log on the blockchain for hours that do not look like normal work.",
};

const percent = (fraction) => `${(fraction * 100).toFixed(1)}%`;

/** The headline numbers of a model, from its own test report: [what was measured, result]. */
function measured(model) {
  const m = model.metrics || {};
  if (m.labValueRecall !== undefined) {
    return [
      ["Lab values found, clean documents", `${m.labValueRecall}%`],
      ["Lab values found, noisy documents", `${m.labValueRecallNoisy}%`],
      ["Medicines found, clean documents", `${m.medicineRecall}%`],
    ];
  }
  if (m.intentAccuracy !== undefined) {
    return [
      ["Kind of question understood, unseen wordings", `${m.intentAccuracy}%`],
      ["The trained model alone, unseen wordings", percent(m.accuracyUnseenPhrasings)],
      ["Requests for medical advice declined", `${m.adviceCaught}%`],
      ["Ordinary questions wrongly declined", `${m.wronglyRefused}%`],
      ...(m.typosCorrected !== undefined ? [["Misspelt test and medicine names corrected", `${m.typosCorrected}%`]] : []),
    ];
  }
  if (m.photoLabValues !== undefined) {
    return [
      ["Lab values read exactly, clean scans", `${m.scanLabValues}%`],
      ["Lab values read exactly, phone photos", `${m.photoLabValues}%`],
      ["Photo values given a wrong High or Low label", `${m.photoWrongLabel}%`],
      ["The same, with the decimal-point checks switched off", `${m.photoWrongLabelUnchecked}%`],
      ["Medicines found, phone photos", `${m.photoMedicines}%`],
    ];
  }
  if (m.accuracyUnseenLayouts !== undefined) {
    return [["Right type, on document layouts it never saw", percent(m.accuracyUnseenLayouts)]];
  }
  if (m.detectionRate !== undefined) {
    return [
      ["Misuse hours detected", percent(m.detectionRate)],
      ["Normal hours flagged by mistake", `${(m.falseAlarmRate * 100).toFixed(2)}%`],
    ];
  }
  return [];
}

export default function OwnerModels() {
  const toast = useToast();
  const [models, setModels] = useState(null);

  useEffect(() => {
    api("/ai/models")
      .then((data) => setModels(data.models))
      .catch(toast.error);
  }, [toast]);

  return (
    <>
      <PageHead title="AI models">
        Five models work inside MedSecure. All of them run on this computer: no record and no log entry is sent to any outside service, and none of them can
        change the blockchain or open a record by itself.
      </PageHead>

      {models === null && <Skeleton rows={4} />}
      <ul className="models">
        {(models || []).map((model) => (
          <li key={model.name} className="model">
            <span className="row-icon">
              <Icon name={ICONS[model.name] || "spark"} />
            </span>
            <div className="model-text">
              <h2>{model.name}</h2>
              <p>{USED_FOR[model.name]}</p>
              <dl className="model-facts">
                <div>
                  <dt>How it works</dt>
                  <dd>
                    {model.method}
                    {model.languageModel ? `. Wording by the local language model ${model.languageModel}.` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Test data</dt>
                  <dd>{model.data}</dd>
                </div>
              </dl>
            </div>
            <table className="model-results">
              <caption>Measured</caption>
              <tbody>
                {measured(model).map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </li>
        ))}
      </ul>
      {models && (
        <p className="ai-footnote">
          <Icon name="info" size={16} />
          Every number here comes from invented test documents and simulated logs, because the project has no real patient data. Real hospital documents are
          messier, so expect lower figures in practice. The test scripts and full reports are in the project's ml folder.
        </p>
      )}
    </>
  );
}
