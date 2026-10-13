# AI and ML in MedSecure

Five AI features are built in: a report summary, questions and answers about a report, reading photos and scans (OCR), a record-type suggestion, and unusual-access detection. A sixth screen, health trends, reuses what the summariser extracts. All of them run inside the backend, on the hospital's own machine. No record and no log entry is sent to any outside service, and none of them can change the blockchain.

| Feature | What it does | Kind of AI | Works from | Sees medical content? | Where its output lives |
|---|---|---|---|---|---|
| Report summary | Writes a short summary of a report: one for doctors, one in plain language for patients | NLP pipeline: classification, information extraction, TextRank sentence ranking, optional local language model | The document's text, in memory, at upload | Yes, inside the process that is about to encrypt it | Inside the encrypted record, under the record's own key |
| Ask about this report | Answers typed questions about the open record, and declines medical advice | Spelling correction, intent classifier (TF-IDF + logistic regression) with rules, BM25 search | The open record's text and summary, in memory | Yes, only while the record is open | Nowhere: forgotten when the record is closed |
| Reading photos and scans | Reads the text in a picture of a document | OCR: Tesseract 5 LSTM network, then geometric row rebuilding and number checks | The picture, in memory | Yes, same as the summary | The text is kept inside the encrypted record |
| Record type suggestion | Suggests the type of a file that is about to be added | Supervised text classification: TF-IDF + logistic regression | The document's text, in memory | Yes, same | Nowhere: only the type the uploader picks is kept |
| Unusual access detection | Flags hours in which a doctor's use of the system does not look like normal work | Unsupervised anomaly detection: Isolation Forest, 150 trees | Counts and times from blockchain audit events | No | Nowhere: recomputed from the chain each time |

## How the pieces fit

```
ml/generate_documents.py   ->  ml/data/documents.jsonl, extraction.jsonl   synthetic documents
ml/train_classifier.py     ->  backend/src/ml/models/record-type.json
ml/train_access_model.py   ->  backend/src/ml/models/access-anomaly.json
ml/train_intent_model.py   ->  backend/src/ml/models/question-intent.json
ml/make_ocr_images.py      ->  pictures of the synthetic documents, to test OCR

backend/src/ml/summarize.js       the report summariser
backend/src/ml/llm.js             optional local language model, with safety checks
backend/src/ml/ask.js             questions and answers about an open record
backend/src/ml/textModel.js       generic TF-IDF + logistic regression, in JavaScript
backend/src/ml/recordType.js      the classifier, in JavaScript
backend/src/ml/accessAnomaly.js   the Isolation Forest, in JavaScript
backend/src/ml/extractText.js     text from PDF and text files, and from pictures through OCR
backend/src/ml/ocr.js             reads the text in a photo or scan (Tesseract, on this computer)

backend/test/ml-parity.mjs        proves the JavaScript models match scikit-learn
backend/test/summary-eval.mjs     measures the summariser's extraction accuracy
backend/test/llm.test.mjs         tests the language-model path and its safety checks
backend/test/ask-eval.mjs         measures question answering, spelling correction and follow-ups
backend/test/ocr-eval.mjs         measures reading pictures of documents
```

Training is done in Python with scikit-learn. Each trained model is exported as plain JSON and the backend repeats the same arithmetic in JavaScript, so **Python is needed only to retrain a model, not to run MedSecure.** `npm run test:ml` runs all five test files above.

## 1. Report summary

### Pipeline

1. **Classify.** The record-type classifier (section 2) decides what kind of document it is. The type the uploader chose is tried first.
2. **Extract.** A type-specific extractor pulls out the facts:
   - *Lab report:* each test, its value, unit and reference range, and whether it is high, low or normal. The range printed on the report is used; a table of typical adult ranges is the fallback for 22 common tests.
   - *Prescription:* each medicine, strength, how often, how long, and with or without food. Codes such as `1-0-1`, `BD` and `SOS` are turned into words.
   - *Discharge summary:* diagnosis, treatment, admission and discharge dates, condition at discharge, medicines to take home, follow-up.
   - *Scan:* the study, the radiologist's impression, and findings that are not normal. Sentences such as "no fracture" are recognised as normal.
   - *Vaccination record:* vaccines given, dates, and the next one due.
3. **Rank.** If no extractor fits, TextRank (a graph algorithm over sentence similarity) picks the three most central sentences.
4. **Write twice.** The same facts are written in clinical wording for doctors and in plain language for patients, with a short explanation of what each abnormal test measures.

The summary only restates what is in the document. It never adds a diagnosis or advice of its own. A photo or scan is read with OCR first (section 3); a picture with no readable text, such as an X-ray film, gets no summary at all.

### Where the summary is kept

It is made once, at upload, from the same plain bytes that are about to be encrypted, and is stored **inside the encrypted record on IPFS**, under the record's own AES key. So exactly the people who can open a record can read its summary. It is not in MongoDB and not on the blockchain. When a record is opened, the file and its summary count as one access: one permission check, one audit entry, one "open" used.

### Results

900 synthetic documents whose true contents are known (`ml/data/extraction.jsonl`). Numbers from `ml/reports/summary_extraction.json`.

| Test set | Lab values found (recall / precision) | High, low or normal correct | Medicines found (recall / precision) |
|---|---|---|---|
| Clean documents (450) | 100% / 100% | 100% | 100% / 100% |
| Noisy documents, with scan-style character errors (450) | 91.6% / 92.0% | 100% | 92.5% / 92.9% |
| Layouts it was not written against (180, half noisy) | 94.1% / 94.1% | 100% | 96.7% / 97.0% |

### Optional: a local language model

The built-in summariser works on its own. If you want more natural wording, a language model running on the same computer can rephrase the summary:

1. Install Ollama from <https://ollama.com/download>.
2. In a terminal run `ollama pull llama3.2` (about 2 GB; a small model that fits in 8 GB of RAM).
3. Copy `backend/.env.example` to `backend/.env` and set `AI_SUMMARY_MODEL=llama3.2`.
4. Restart `npm start`. Uploads now take longer, because the model writes the summary on your CPU.

The model is only asked to reword facts the extractor already found, and its answer is discarded unless it is valid JSON in the expected shape **and every number in it appears in the document**. A model that invents a value or a dose therefore cannot get its text shown; the built-in summary is used instead. `backend/test/llm.test.mjs` proves these checks with a stand-in for the model. This path has not been tested with a real model, because one could not be downloaded in the environment where the project was built.

## 2. Ask about this report

When a record is open, the doctor or patient can type a question about it. The answer is built only from that record.

### How an answer is produced

1. **Correct the spelling of names.** People misspell medical words. A word that is one or two letters away from a test or medicine on this record ("haemoglobn", "creatinin", "paracetmol") is read as that name, and the answer says so: *Read "haemoglobn" as "haemoglobin"*. Ordinary English words are never changed, the first letter must match, and if two names are equally close nothing is changed.
2. **Find what the question is about.** Tests and medicines of this record that the question mentions are picked out, including everyday words: "sugar" is matched to fasting blood sugar, "thyroid" to TSH, "kidney" to creatinine.
3. **Carry the subject over from the last question.** "Is it normal?" or "what about TSH?" after a question about haemoglobin is understood from what was asked before. Only the subject is carried over: a follow-up that asks for advice ("should I worry about it?") is still declined.
4. **Decide the kind of question (its intent).** There are 14 kinds, such as "value of a test", "which results are abnormal", "how to take a medicine", "diagnosis", "follow-up date", and "asks for medical advice". A few high-confidence keyword rules are tried first; everything else goes to a trained classifier (`train_intent_model.py`). Its features are TF-IDF of words and word pairs, plus TF-IDF of 2 to 4 letter pieces of each word, which is what lets it recognise a misspelt or unfamiliar form of a word. Test and medicine names are replaced by placeholders first, so the classifier learns the shape of a question rather than a list of names.
5. **Answer from the extracted facts.** The same facts the summariser found are used, worded for the reader: clinical for a doctor, plain for a patient.
6. **Otherwise search the document.** A BM25 search finds the lines closest to the question and quotes them.
7. **Otherwise say so.** If nothing in the document fits, the answer is "I could not find that in this document."

Every answer lists the lines of the document it rests on, and suggests two or three questions that follow on from it.

### What it will not do

- **No medical advice.** Questions such as "should I be worried?", "can I stop this medicine?" or "what should I eat?" are declined. The reply states what the document says and points to the doctor.
- **No invented results.** Asked about a test that is not on the report, it says the report has no such result.
- **Nothing outside the record.** A question unrelated to the document gets no answer.

### Privacy

Opening a record starts a "reading session": the record's text is held in the backend's memory so questions can be answered without decrypting it again. Asking questions is therefore part of the same access that opened the record. No new permission is needed and none is bypassed. The text is never stored. It is dropped when the viewer is closed, after 10 minutes without a question, or after 30 minutes at most, and a session can only be used by the person who opened the record.

### Results

| Measure | Value |
|---|---|
| Intent, trained classifier alone, on 828 questions worded in ways it never saw | 75.6% (the first version, with word features only and 220 training wordings: 62.3%) |
| The same classifier, 5-fold cross-validation with whole wordings held out | 79.8% |
| Intent, full resolver (rules + classifier), same 828 questions | 88.5% |
| Requests for medical advice that are caught and declined | 98.8% |
| Ordinary questions wrongly declined as advice | 3.4% |
| Misspelt test and medicine names corrected (369 misspellings) | 97.6%, none corrected to a wrong name |
| Ordinary words wrongly "corrected" (65 words) | 0 |
| Follow-up turns in scripted conversations answered as expected | 17 of 17 |
| Worked examples answered as expected (4 document types, both audiences) | 24 of 24 |

How the classifier was improved, and how the figure is kept fair:

- More training wordings (475 instead of 220) and the word-piece features raised the held-out accuracy from 62.3% to 75.6%.
- The 828 test questions come from a fixed set of wordings that is never used for training. Cross-validation is "grouped": all variations of one wording are in the same fold, so the model is never tested on a rewording of something it trained on.

Read these with care. The rules still do most of the work (they decide 82.1% of the test questions) and were written by the same person who wrote the test questions, so 88.5% is optimistic. 75.6% is the unbiased figure for the trained model. The spelling and conversation tests are small and hand-made: they show the mechanism works, not how often real users will be understood.

## 3. Reading photos and scans (OCR)

Many patients only have a paper report, or a photo of one. A picture has no text in it, so the other features could not use it. OCR (optical character recognition) reads the text out of the picture first; after that the picture is classified, summarised and asked about like any other record.

### How it works

1. **Recognise.** Tesseract 5, an open-source OCR engine with an LSTM neural network, runs inside the backend as WebAssembly (`tesseract.js`). Its English language data is an npm package on disk. Nothing is downloaded when it runs and no image leaves the computer.
2. **Rebuild the rows.** In a table the engine often reads each column as a separate block, which tears "Haemoglobin 9.8 g/dL 12 - 15" into four pieces. `ocr.js` therefore places every word by its own position: it measures the page's tilt, removes it, joins words at the same height into one row, and treats a wide gap as a column break.
3. **Read twice.** The engine reads the page a second time in a different layout mode. Where the two readings have the same digits but one kept the decimal point ("2.5" against "25"), the reading with the decimal point is used.
4. **Check the numbers.** OCR reads words well but can drop a decimal point, which could turn a normal result into a "high" one. So for a picture the summariser cross-checks each lab value against the usual range of that test:
   - a printed range that does not fit the test is repaired if putting the decimal point back makes it fit ("15 - 45" for platelets in lakh becomes "1.5 - 4.5"), and the summary says the decimal point was restored;
   - a value that cannot be right ("08", or a haemoglobin of 121), or a whole number judged against a range written with decimals, is not labelled high or low. It is shown as **Unclear**, with what the picture seemed to say, and the reader is told to check the original.
5. **Say so.** Every summary made from a picture is marked as read from a picture, with the engine's confidence, and the text that was read is kept inside the encrypted record so questions can be answered later without reading the picture again.

### Results

`make_ocr_images.py` draws 90 of the synthetic documents twice: as a clean scan, and as a phone photo (tilted, slightly out of focus, unevenly lit, saved as a compressed JPEG). 178 lab values and 130 medicines are in each set. Numbers from `ml/reports/ocr_extraction.json`.

| Measure | Clean scans | Phone photos |
|---|---|---|
| Pictures in which text was read | 100% | 100% |
| Record type recognised | 94.4% | 94.4% |
| Lab values read with exactly the right number | 98.9% | 94.9% |
| Lab values labelled correctly (high, low or normal) | 97.8% | 93.8% |
| Lab values marked Unclear instead of being labelled | 1.1% | 4.5% |
| Lab values given a **wrong** label | 0% | 0% |
| The same, with the number checks switched off | 2.2% | 3.9% |
| Medicines found | 99.2% | 94.6% |
| Time per picture (two readings) | about 1.5 s | about 1.5 s |

The row that matters is "wrong label". Without the checks about 1 value in 30 would be shown with a wrong High, Low or Normal; with them, those values are shown as Unclear instead.

Read these with care too. **The checks were written while looking at these same 180 pictures**, so 0% is the best case, not a promise. The pictures are computer-drawn pages in six fonts, not real photographs. Real photos with shadows, folds, stamps or handwriting will be read worse, and the checks only know the usual ranges of 22 common tests. This is why every OCR summary tells the reader to compare the numbers with the picture.

`npm run test:ml` runs the same measurement on 8 pictures kept in `backend/test/fixtures/ocr`. To repeat the full run: `python ml/make_ocr_images.py pictures 15`, then `node backend/test/ocr-eval.mjs pictures --report`.

## 4. Health trends

Not a new model: a new use of the summariser. For the patient only, the backend opens each of their records with their own key, in memory, collects the lab values the summariser found, and groups them by test (the 22 known tests are matched under one name, so "Hb" and "Haemoglobin" are the same line). The page draws each test across reports against its normal range.

- The date is the one printed on the report when the summariser finds it, otherwise the date the record was added.
- Values marked Unclear by the OCR checks are left out.
- Two results with the same date and value are treated as the same report uploaded twice.
- Nothing is stored, and no doctor can ask for a patient's trends: a doctor sees only the single records shared with them.

## 5. Record type suggestion

Six classes: Lab report, Prescription, Scan or imaging, Discharge summary, Vaccination record, Other. 2,200 training documents.

| Test set | Documents | Accuracy | Macro F1 |
|---|---|---|---|
| Layouts the model saw in training | 550 | 100% | 1.00 |
| Layouts it never saw (one new layout per class) | 900 | 89.2% | 0.88 |

The app only suggests a type when the model is at least 60% sure. On the unseen layouts it makes a suggestion for 70% of documents and is right 95.1% of those times.

Other classifiers on the unseen layouts, same features: multinomial naive Bayes 96.1%, linear SVM 91.1%, logistic regression 89.2%. Logistic regression is used because its probabilities suit the "only suggest when sure" rule; naive Bayes is a reasonable alternative to discuss.

`backend/test/ml-parity.mjs` checks 80 documents and 80 questions against scikit-learn's own answers: all labels match and confidences agree to 5 decimal places.

## 6. Unusual access detection

Each doctor's activity is cut into one-hour windows, described by six numbers: opens, different patients, emergency uses, night-time or not, most opens within 5 minutes, and opens per patient. The forest is trained on 20,000 simulated normal windows.

| Measure | Value |
|---|---|
| ROC-AUC (10,000 normal vs 1,500 misuse windows) | 0.9997 |
| False alarms | 0.46% of normal hours |
| Misuse hours detected | 98.9% |

Detected by kind of misuse: bulk browsing 100%, rapid burst 100%, night-time browsing 100%, one patient opened again and again 100%, repeated emergency access 94.3%.

Every flag comes with reasons in plain words, built by comparing the window with what 99% of normal hours look like.

## Limits

- **Everything is trained and tested on made-up data.** Real patient documents and real hospital logs cannot be used in a student project. The results show the methods work on these documents and simulations, not how they would perform in a real hospital.
- **The extractors are rules written for common report formats.** A lab report laid out very differently, or handwritten, will be read less well. The 91.6% on noisy documents is the more realistic figure.
- **The summary is not medical advice.** The plain-language notes say what a test measures and what a high or low value is commonly linked with, never what it means for this patient. Every summary says so and points to the original.
- **OCR is English, printed text only.** Handwriting, Hindi and other scripts are not read. A scanned PDF (pictures of pages inside a PDF) is not read either: its pages have to be added as pictures. The OCR figures come from computer-drawn pictures, and its number checks were tuned on them.
- **Health trends are only as good as the extraction.** A test the extractor misses is missing from the chart, and two labs' ranges for the same test may differ; the chart shows the range of the newest report.
- **The classifier's 100% is not meaningful on its own.** It only shows the model memorised layouts it trained on. 89.2% on unseen layouts is the honest number.
- **The access detector flags patterns, not intent,** and it was tested on five kinds of misuse chosen by hand.
- **Question answering covers what the extractors cover.** It answers well about lab values, medicines, diagnosis, treatment, dates and a scan's impression. For anything else it can only quote the closest lines of the document, and unusual wordings are sometimes misread.
- **The language-model option is untested with a real model,** and it is used for summaries only, not for answering questions.

## Retraining

```
cd ml
pip install -r requirements.txt
python generate_documents.py
python train_classifier.py
python train_access_model.py
python train_intent_model.py
cd ..
npm run test:ml
```

The scripts overwrite the model files in `backend/src/ml/models/`. Restart the backend to load them. The smart contract and saved data are not affected.
