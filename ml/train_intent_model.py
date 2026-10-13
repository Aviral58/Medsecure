"""Train the question-intent classifier used by "Ask about this report".

When someone types a question about an open record, the backend first has to
work out WHAT KIND of question it is, so it knows where in the document to
look. This script trains that step.

    question -> TF-IDF features -> logistic regression -> one of 14 intents

Two kinds of feature are joined together:

    words and word pairs      "normal range", "how do"
    pieces of words (2-4 letters, inside each word)

The second kind is what copes with spelling mistakes and word endings: "prescribd"
shares most of its pieces with "prescribed", though it is a different word.

Names of tests and medicines are replaced by the placeholders "testname" and
"medname" before classification (the backend does the same), so the model
learns the shape of a question, not a list of test names.

How it is tested
----------------
The questions are written by hand as phrasings. Two measurements are made:

  1. Grouped 5-fold cross-validation over all training phrasings: each
     phrasing is held out once and predicted by a model that never saw it.
  2. A fixed set of phrasings that is never trained on, kept from the first
     version of this script so that versions can be compared.

Both are optimistic about real users, because one person wrote every phrasing.

Run:  python train_intent_model.py
"""

import json
import random
import re
from datetime import date
from pathlib import Path

import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold

HERE = Path(__file__).parent
MODEL_OUT = HERE.parent / "backend" / "src" / "ml" / "models" / "question-intent.json"
PARITY_OUT = HERE.parent / "backend" / "test" / "fixtures" / "question-intent-parity.json"
REPORT_OUT = HERE / "reports" / "question_intent.json"
RNG = random.Random(5)

# intent -> (phrasings used for training, phrasings held out for testing)
QUESTIONS = {
    "test_value": (
        ["what is my testname", "what is the testname", "testname level", "how much is my testname", "tell me my testname",
         "is my testname normal", "is testname high", "is testname low", "is the testname ok", "what was the testname result",
         "testname value", "show testname", "what does the report say about testname", "my testname reading", "is testname fine",
         "testname result please", "what is the patient's testname", "check testname"],
        ["whats the testname count", "how is my testname", "is testname within range", "give me the testname number", "testname okay or not",
         "did testname come back normal"],
    ),
    "abnormal": (
        ["which results are abnormal", "what is abnormal", "is anything wrong", "which values are high", "which values are low",
         "are all results normal", "anything outside the normal range", "what is out of range", "is everything normal",
         "list the abnormal values", "what needs attention", "any abnormal findings", "which tests are not normal", "is anything high or low",
         "are there any problems in this report", "what are the flagged values"],
        ["what is off in my report", "anything to worry about in the results", "which readings are outside limits", "is the report all clear",
         "show me the bad values", "any red flags"],
    ),
    "test_meaning": (
        ["what does testname mean", "what is testname", "what is testname test", "why is testname tested", "explain testname",
         "what does testname measure", "meaning of testname", "what is testname used for", "tell me about testname",
         "what does a high testname mean", "what does low testname mean", "why does testname matter", "testname means what"],
        ["what is testname in simple words", "what does testname show", "help me understand testname", "what is the purpose of the testname test",
         "what does it mean if testname is high"],
    ),
    "normal_range": (
        ["what is the normal range for testname", "normal testname", "what should testname be", "reference range of testname",
         "what is a normal testname level", "normal value of testname", "what is the reference range", "testname normal range",
         "what are the normal limits for testname", "ideal testname level", "how much testname is normal"],
        ["what is the healthy range of testname", "expected value for testname", "what range is testname supposed to be in", "normal limits of testname"],
    ),
    "medicines": (
        ["what medicines are prescribed", "list the medicines", "which medicines do i have to take", "what was prescribed", "what tablets are these",
         "what are the medications", "show the medicines", "how many medicines", "what drugs are on this prescription", "which medicines are written",
         "what medicine did the doctor give", "medicines list", "what is the discharge medication", "what am i supposed to take"],
        ["name the drugs prescribed", "what all tablets do i need", "which pills were given", "tell me the medication in this prescription",
         "what did the doctor prescribe"],
    ),
    "how_to_take": (
        ["how do i take medname", "when should i take medname", "how many times a day medname", "how long do i take medname",
         "should i take medname after food", "medname before or after food", "how often medname", "what is the dose of medname",
         "for how many days medname", "when to take the medicines", "how to take these medicines", "medname timing", "medname dosage",
         "how many days should i continue medname", "at what time do i take medname", "how is medname to be taken"],
        ["what is the schedule for medname", "medname how many tablets daily", "till when should i take medname", "do i take medname in the morning or night",
         "what are the instructions for medname"],
    ),
    "medicine_purpose": (
        ["what is medname for", "why was medname prescribed", "what does medname do", "what is medname used for", "why do i need medname",
         "what is the use of medname", "medname is for what", "what does medname treat", "purpose of medname", "why am i taking medname",
         "what are these medicines for", "what is each medicine for"],
        ["what is medname meant to do", "what condition is medname for", "why did the doctor give medname", "what does medname help with"],
    ),
    "diagnosis": (
        ["what is the diagnosis", "what was the diagnosis", "what was wrong with me", "what was the patient admitted for", "what is the final diagnosis",
         "why was i admitted", "what disease is mentioned", "what condition was diagnosed", "what is the complaint", "what was the problem",
         "reason for admission", "what illness did i have", "what did they find was wrong", "what is the patient suffering from"],
        ["what was i diagnosed with", "what is the patient's condition called", "which illness is written here", "what was the cause of admission"],
    ),
    "treatment": (
        ["what treatment was given", "what procedure was done", "was any surgery done", "what operation was performed", "how was it treated",
         "what was done in hospital", "what was the course in hospital", "which procedure was carried out", "what did they do during the stay",
         "what treatment did i receive", "was an operation done", "how was the patient managed"],
        ["what surgery did i have", "what did the doctors do for me", "which operation is mentioned", "what was the management"],
    ),
    "dates_followup": (
        ["when was i admitted", "when was i discharged", "what is the date of admission", "when is the follow up", "when should i come back",
         "when is my next visit", "what is the discharge date", "how long was the hospital stay", "when is the next appointment",
         "when do i need to review", "what is the follow up advice", "when was this report made", "when is the next vaccine due",
         "when was the vaccine given", "what is the date of the report", "when should i see the doctor again"],
        ["how many days was i in hospital", "on which date did i go home", "when is the next dose due", "when to return for review",
         "what date was the sample collected"],
    ),
    "conclusion": (
        ["what is the impression", "what is the conclusion", "what did the scan show", "is the scan normal", "what is the result of the scan",
         "what does the x-ray show", "what are the findings", "what did the radiologist conclude", "is the ultrasound normal",
         "what is the final impression", "did the scan find anything", "what does the mri say", "what is the opinion of the radiologist",
         "is there any abnormality in the scan"],
        ["what was seen on the scan", "what is the radiologist's verdict", "anything found on the x-ray", "what is the outcome of the imaging"],
    ),
    "overview": (
        ["summarise this report", "explain this report", "what is this document", "what does this report say", "give me a summary",
         "explain in simple words", "what is this about", "can you explain this to me", "tell me what this report means", "summary please",
         "what kind of report is this", "give me the key points", "what are the main points", "what vaccines were given", "which vaccines are recorded"],
        ["break this report down for me", "what is the gist of this", "short summary of the document", "walk me through this report",
         "what is written in this report"],
    ),
    "advice": (
        ["what should i do", "is it serious", "is this dangerous", "should i be worried", "will i be ok", "do i need treatment",
         "can i stop taking medname", "should i take more medname", "what should i eat", "how can i increase my testname",
         "how do i lower my testname", "do i have cancer", "do i have diabetes", "what is the cure", "which medicine should i take for this",
         "is it safe to exercise", "do i need surgery", "what treatment do you recommend", "can i skip a dose", "should i see a specialist",
         "how to reduce testname naturally", "am i going to die", "what diet should i follow", "is my condition bad"],
        ["how worried should i be", "what do you advise", "what can i do to fix my testname", "can i double the dose of medname",
         "is this life threatening", "do you think i need an operation", "what food helps raise testname"],
    ),
    "other": (
        ["who is the doctor", "what is the hospital name", "what is the patient name", "which lab did this", "what is the phone number",
         "who signed this report", "what is the sample type", "what is the patient's age", "where was this done", "what is the bill amount",
         "who referred the patient", "what is the registration number", "which ward", "what is the batch number", "who is the consultant",
         "what is the address"],
        ["which doctor wrote this", "name of the laboratory", "how old is the patient", "what is the uhid", "who was the radiologist"],
    ),
}


# More training phrasings, added in the second version of this script.
# None of them is in the held-out lists above.
MORE_TRAINING = {
    "test_value": ["testname?", "testname ok?", "my testname", "what's my testname level", "how high is my testname", "is my testname too high",
                   "is my testname too low", "testname good or bad", "tell me the testname reading", "what number is testname",
                   "what did testname come to", "testname status", "is testname alright", "how much testname do i have", "testname report value",
                   "can you check my testname", "what about testname", "and testname", "testname result"],
    "abnormal": ["what is not normal", "which results are out of the normal range", "are any values abnormal", "is something abnormal",
                 "show abnormal results", "what looks wrong in this report", "which ones are high", "which ones are low", "anything high",
                 "anything low", "do i have any abnormal result", "are my results fine", "are my reports normal", "is my report okay",
                 "what should i look at in this report", "which test results are bad", "any issue in the report", "what is outside range",
                 "tell me what is wrong", "is all ok"],
    "test_meaning": ["what is meant by testname", "testname meaning", "define testname", "what is testname and why is it important",
                     "what does testname indicate", "what does testname tell", "explain what testname is", "what kind of test is testname",
                     "what is the testname test for", "can you explain testname to me", "i dont know what testname is", "what is the role of testname",
                     "what does high testname indicate", "what does low testname indicate", "why is my testname high", "why is my testname low"],
    "normal_range": ["what is normal for testname", "testname reference range", "what is the range for testname", "what should my testname be",
                     "what is a good testname level", "what is the upper limit of testname", "what is the lower limit of testname",
                     "what is the cut off for testname", "testname should be how much", "how much should testname be", "normal testname value",
                     "range of testname", "what is the standard range for testname", "what are normal values in this report"],
    "medicines": ["which medicines", "what are the medicines", "medicines?", "list all medicines", "what medicine is given",
                  "which tablets are prescribed", "what are the tablets in this", "how many tablets are prescribed", "show me my medicines",
                  "what is on the prescription", "what medication am i on", "what has been prescribed to me", "what are the drugs",
                  "give me the list of medicines", "what all is prescribed", "which medicine is written here", "any medicines in this report"],
    "how_to_take": ["how to take medname", "medname how many times", "how many medname per day", "medname dose", "when do i take medname",
                    "how many days medname", "medname for how long", "is medname before food", "is medname after food", "do i take medname with food",
                    "how should medname be taken", "what time should i take medname", "how many times should i take medname",
                    "how long should i take medname", "medname once or twice a day", "is medname daily", "duration of medname",
                    "how do i use medname", "how to take my medicines", "when should i take my tablets"],
    "medicine_purpose": ["what is medname", "why medname", "medname is used for what", "what is the purpose of medname", "why is medname given",
                         "what does medname cure", "what is medname prescribed for", "medname for what", "what is this medname tablet for",
                         "why have i been given medname", "what is the function of medname", "what will medname do", "what are these tablets for",
                         "why these medicines", "what is the reason for medname"],
    "diagnosis": ["diagnosis?", "what is the diagnosis here", "what do i have", "what is my diagnosis", "what was found", "what is the disease",
                  "what is my condition", "which disease do i have according to this", "what did the doctor diagnose",
                  "what was the patient treated for", "why was the patient hospitalised", "what was the reason for the hospital stay",
                  "what is the provisional diagnosis", "what problem did i have", "what were the complaints", "what were my symptoms",
                  "what is written as diagnosis"],
    "treatment": ["what was the treatment", "treatment given", "what procedure was performed", "which surgery was done", "was i operated",
                  "did i have an operation", "what was done to me", "how did they treat it", "what kind of surgery", "what did the hospital do",
                  "what happened during the hospital stay", "what care was given", "what was the procedure", "which procedure did i undergo",
                  "what was the patient given in hospital"],
    "dates_followup": ["when is the review", "follow up date", "when do i go back", "when is my next checkup", "date of admission",
                       "date of discharge", "when did i get admitted", "when did i leave the hospital", "how long did i stay",
                       "when was the test done", "when was this prescribed", "what day was the sample taken", "when is the booster due",
                       "when is the next vaccination", "which date is this report from", "when was this scan done", "how many days of stay",
                       "when should i visit again", "when was the report issued"],
    "conclusion": ["impression?", "what is the result", "what does the scan say", "scan result", "what did the ultrasound show",
                   "what did the x-ray find", "is the x-ray normal", "is the mri normal", "is my ct scan normal", "what is the report conclusion",
                   "what is the final opinion", "what did the radiologist say", "any findings in the scan", "does the scan show any problem",
                   "what are the scan findings", "is anything seen in the ultrasound"],
    "overview": ["summary", "summarise", "summarize this", "explain", "explain this", "tell me about this report", "what is this report",
                 "what does it say", "give a short summary", "explain this document to me", "can you summarise this for me",
                 "i dont understand this report", "what is in this report", "describe this report", "key points please",
                 "what is the report about", "explain the report in easy language", "tell me the important things", "overview of this report",
                 "which vaccines have i had", "what vaccinations are listed"],
    "advice": ["what to do now", "what next", "is this bad", "is this normal for my age", "how serious is this", "is this a problem",
               "should i worry", "should i see a doctor", "should i go to hospital", "do i need medicine", "do i need to change my diet",
               "what should i avoid eating", "what exercise should i do", "how can i improve my testname", "how to bring testname down",
               "how to raise my testname", "how can i cure this", "can this be cured", "is it curable", "will it get better",
               "how long will i live", "can i stop medname", "can i take medname with alcohol", "should i increase medname",
               "is medname safe for me", "can i take two medname", "what are the side effects of medname", "which doctor should i consult",
               "do i need more tests", "what is the best treatment", "is surgery needed", "suggest a medicine", "what home remedy can i use",
               "am i healthy", "am i sick", "is my health ok"],
    "other": ["who is my doctor", "doctor name", "hospital name", "which hospital is this from", "where is the lab", "lab address",
              "contact number of the hospital", "what is my patient id", "what is my age in the report", "who collected the sample",
              "what is the report number", "what is the bill number", "who prepared this report", "what is the ward number", "which bed",
              "what is the lot number", "name of the pathologist", "who is the referring doctor", "what is written at the top"],
}

PREFIX = ["", "", "", "please tell me ", "can you tell me ", "i want to know ", "hi, ", "could you say ", "quick question, ", "sir ", "doctor, "]
SUFFIX = ["", "", "?", "?", " please", " in this report", " here", " for this patient", " as per the report", "??"]


def vary(question):
    text = RNG.choice(PREFIX) + question + RNG.choice(SUFFIX)
    if RNG.random() < 0.15:  # a typo
        i = RNG.randrange(len(text))
        text = text[:i] + text[i + 1:]
    if RNG.random() < 0.1:
        text = text.upper()
    return text


def clean(text):
    """Same as the backend: lower-case and drop non-ASCII characters."""
    return re.sub(r"[^\x00-\x7f]", " ", text.lower())


def make_vectorizers():
    words = TfidfVectorizer(preprocessor=clean, token_pattern=r"\b[a-z][a-z]+\b", ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    pieces = TfidfVectorizer(preprocessor=clean, analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True, min_df=2)
    return words, pieces


def fit(questions, intents):
    words, pieces = make_vectorizers()
    x = hstack([words.fit_transform(questions), pieces.fit_transform(questions)]).tocsr()
    model = LogisticRegression(C=10.0, max_iter=4000)
    model.fit(x, intents)
    return words, pieces, model


def features(words, pieces, questions):
    return hstack([words.transform(questions), pieces.transform(questions)]).tocsr()


def main():
    # Every training phrasing, with a group number so that all the varied
    # copies of one phrasing stay together when the data is split.
    train, groups, test = [], [], []
    group = 0
    for intent, (seen, unseen) in QUESTIONS.items():
        for question in seen + MORE_TRAINING[intent]:
            train += [(vary(question), intent) for _ in range(12)]
            groups += [group] * 12
            group += 1
        for question in unseen:
            test += [(vary(question), intent) for _ in range(12)]
    questions = np.array([q for q, _ in train])
    intents = np.array([i for _, i in train])
    groups = np.array(groups)

    # 1. Grouped cross-validation: predict each phrasing with a model that never saw it.
    predicted_cv = np.empty(len(train), dtype=object)
    for fit_rows, held_rows in GroupKFold(n_splits=5).split(questions, intents, groups):
        words, pieces, model = fit(questions[fit_rows], intents[fit_rows])
        predicted_cv[held_rows] = model.predict(features(words, pieces, questions[held_rows]))
    cv_accuracy = accuracy_score(intents, predicted_cv)
    cv_f1 = f1_score(intents, predicted_cv, average="macro")

    # 2. The final model, trained on every training phrasing, tested on the fixed held-out set.
    words, pieces, model = fit(questions, intents)
    classes = list(model.classes_)
    proba = model.predict_proba(features(words, pieces, [q for q, _ in test]))
    predicted = [classes[i] for i in proba.argmax(axis=1)]
    truth = [i for _, i in test]
    advice_caught = sum(1 for t, p in zip(truth, predicted) if t == "advice" and p == "advice") / truth.count("advice")

    # The first version of this model (words only, the first set of phrasings), for comparison.
    first_train = [(vary(q), intent) for intent, (seen, _) in QUESTIONS.items() for q in seen for _ in range(12)]
    first_words = TfidfVectorizer(preprocessor=clean, token_pattern=r"\b[a-z][a-z]+\b", ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    first_model = LogisticRegression(C=8.0, max_iter=3000).fit(first_words.fit_transform([q for q, _ in first_train]), [i for _, i in first_train])
    first_accuracy = accuracy_score(truth, first_model.predict(first_words.transform([q for q, _ in test])))

    report = {
        "model": "TF-IDF of words, word pairs and 2-4 letter word pieces + multinomial logistic regression, 14 intents",
        "trained_on": str(date.today()),
        "training_phrasings": int(group),
        "training_questions": len(train),
        "features": {"words_and_pairs": len(words.vocabulary_), "word_pieces": len(pieces.vocabulary_)},
        "data": "Hand-written question phrasings with automatic variations. No real patient questions.",
        "grouped_cross_validation": {"folds": 5, "accuracy": round(float(cv_accuracy), 4), "macro_f1": round(float(cv_f1), 4)},
        "fixed_held_out_phrasings": {
            "questions": len(test),
            "accuracy": round(accuracy_score(truth, predicted), 4),
            "macro_f1": round(f1_score(truth, predicted, average="macro"), 4),
            "first_version_accuracy": round(float(first_accuracy), 4),
            "advice_questions_caught_by_model_alone": round(advice_caught, 4),
            "per_intent": {k: {m: round(v, 4) for m, v in d.items()} for k, d in classification_report(truth, predicted, output_dict=True, zero_division=0).items() if k in classes},
            "confusion_matrix": {"labels": classes, "rows": confusion_matrix(truth, predicted, labels=classes).tolist()},
        },
    }
    t = report["fixed_held_out_phrasings"]
    print(f"training: {group} phrasings, {len(train)} questions, {len(words.vocabulary_)} word features, {len(pieces.vocabulary_)} word-piece features")
    print(f"grouped 5-fold cross-validation: accuracy={cv_accuracy:.3f}  macro-F1={cv_f1:.3f}")
    print(f"fixed held-out phrasings: n={t['questions']}  accuracy={t['accuracy']:.3f}  macro-F1={t['macro_f1']:.3f}  (first version: {first_accuracy:.3f})  advice caught by the model alone: {advice_caught:.1%}")

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump({
        "name": "question-intent",
        "description": report["model"],
        "trainedOn": report["trained_on"],
        "classes": classes,
        # Two feature blocks, joined side by side. The coefficients cover the words first, then the pieces.
        "features": [
            {"analyzer": "word", "ngramRange": [1, 2], "vocabulary": {t_: int(i) for t_, i in words.vocabulary_.items()}, "idf": [round(float(v), 5) for v in words.idf_]},
            {"analyzer": "char_wb", "ngramRange": [2, 4], "vocabulary": {t_: int(i) for t_, i in pieces.vocabulary_.items()}, "idf": [round(float(v), 5) for v in pieces.idf_]},
        ],
        "coef": [[round(float(v), 5) for v in row] for row in model.coef_],
        "intercept": [round(float(v), 5) for v in model.intercept_],
        # Ordinary words seen in questions. The backend never "corrects" these into a test or medicine name.
        "knownWords": sorted({w for q in questions for w in re.findall(r"[a-z]{3,}", clean(q)) if w not in ("testname", "medname")}),
        "metrics": {"accuracyUnseenPhrasings": t["accuracy"], "macroF1": t["macro_f1"], "crossValidatedAccuracy": round(float(cv_accuracy), 4)},
    }, open(MODEL_OUT, "w"), separators=(",", ":"))

    # The held-out questions, so the backend's own test can measure the full
    # question resolver (rules + this model) on them.
    json.dump([{"text": q, "intent": i} for q, i in test], open(PARITY_OUT.with_name("question-intent-test.json"), "w"))

    sample = test[:: max(1, len(test) // 80)][:80]
    p = model.predict_proba(features(words, pieces, [q for q, _ in sample]))
    json.dump([{"text": q, "label": classes[int(row.argmax())], "probability": round(float(row.max()), 5)} for (q, _), row in zip(sample, p)],
              open(PARITY_OUT, "w"))
    REPORT_OUT.parent.mkdir(exist_ok=True)
    json.dump(report, open(REPORT_OUT, "w"), indent=2)
    print(f"model -> {MODEL_OUT.relative_to(HERE.parent)} ({MODEL_OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
