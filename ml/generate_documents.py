"""Generate synthetic medical documents for the record-type classifier.

Real patient documents cannot be used to train a student project, so this
script writes realistic but entirely made-up documents of six kinds:

    Lab report, Prescription, Scan or imaging, Discharge summary,
    Vaccination record, Other

Every kind has several different layouts ("templates"). One layout per kind
is kept out of training completely and used only for testing, which shows how
the classifier copes with a hospital whose paperwork it has never seen.

Run:  python generate_documents.py        -> data/documents.jsonl
"""

import json
import random
from pathlib import Path

RNG = random.Random(42)

HOSPITALS = ["City Hospital", "Lakeside Hospital", "Regency Healthcare", "Apollo Clinic", "Sunrise Nursing Home",
             "Government District Hospital", "Sanjeevani Medical Centre", "Metro Heart Institute", "Care & Cure Clinic",
             "St. Mary's Hospital", "Ganga Multispeciality Hospital", "Lifeline Diagnostics", "Shri Ram Hospital"]
CITIES = ["Kanpur", "Lucknow", "Jhansi", "Agra", "Varanasi", "Prayagraj", "Delhi", "Pune", "Jaipur", "Bhopal", "Patna"]
FIRST = ["Meera", "Rahul", "Anita", "Suresh", "Priya", "Arjun", "Kavita", "Imran", "Neha", "Vikram", "Farah", "Rohan",
         "Sunita", "Deepak", "Pooja", "Aman", "Lakshmi", "Joseph", "Harpreet", "Nisha"]
LAST = ["Nair", "Sharma", "Verma", "Khan", "Singh", "Gupta", "Mishra", "Yadav", "Joshi", "Das", "Reddy", "Thomas",
        "Kaur", "Tiwari", "Chauhan", "Ansari", "Patel", "Iyer"]
DOCTORS = ["Dr. Asha Verma", "Dr. Bilal Khan", "Dr. R. K. Gupta", "Dr. Sneha Iyer", "Dr. Manoj Tiwari",
           "Dr. Farida Ansari", "Dr. P. Srinivasan", "Dr. Anjali Mehta", "Dr. Thomas George"]
QUALS = ["MBBS, MD (Medicine)", "MBBS, MS (Ortho)", "MBBS, DNB", "MD (Pathology)", "MBBS, DMRD", "MD (Radiodiagnosis)",
         "MBBS, MD (Paediatrics)"]

LAB_TESTS = [("Haemoglobin", "g/dL", 9.0, 17.0, "13.0 - 17.0"), ("Total WBC count", "cells/cumm", 3500, 13000, "4000 - 11000"),
             ("Platelet count", "lakh/cumm", 1.1, 4.8, "1.5 - 4.5"), ("Fasting blood sugar", "mg/dL", 70, 190, "70 - 100"),
             ("HbA1c", "%", 4.8, 9.5, "4.0 - 5.6"), ("Serum creatinine", "mg/dL", 0.5, 2.1, "0.6 - 1.2"),
             ("Blood urea", "mg/dL", 12, 60, "15 - 40"), ("Total cholesterol", "mg/dL", 130, 290, "< 200"),
             ("Triglycerides", "mg/dL", 80, 320, "< 150"), ("HDL cholesterol", "mg/dL", 28, 70, "> 40"),
             ("SGPT (ALT)", "U/L", 12, 110, "7 - 56"), ("SGOT (AST)", "U/L", 10, 95, "5 - 40"),
             ("TSH", "uIU/mL", 0.2, 9.0, "0.4 - 4.0"), ("Vitamin D (25-OH)", "ng/mL", 8, 60, "30 - 100"),
             ("Vitamin B12", "pg/mL", 120, 900, "200 - 900"), ("Serum sodium", "mmol/L", 128, 148, "135 - 145"),
             ("Serum potassium", "mmol/L", 3.0, 5.6, "3.5 - 5.1"), ("ESR", "mm/hr", 2, 60, "0 - 20"),
             ("Uric acid", "mg/dL", 2.5, 9.0, "3.5 - 7.2"), ("C-reactive protein", "mg/L", 0.5, 40, "< 5")]
PANELS = ["Complete Blood Count", "Lipid Profile", "Liver Function Test", "Kidney Function Test", "Thyroid Profile",
          "Blood Sugar Profile", "Vitamin Panel", "Serum Electrolytes"]
SAMPLES = ["Whole blood (EDTA)", "Serum", "Plasma (fluoride)", "Urine"]

DRUGS = ["Paracetamol 500 mg", "Amoxicillin 500 mg", "Azithromycin 500 mg", "Metformin 500 mg", "Amlodipine 5 mg",
         "Atorvastatin 10 mg", "Pantoprazole 40 mg", "Cetirizine 10 mg", "Telmisartan 40 mg", "Levothyroxine 50 mcg",
         "Ibuprofen 400 mg", "Montelukast 10 mg", "Glimepiride 1 mg", "Vitamin D3 60000 IU", "Calcium carbonate 500 mg",
         "Ondansetron 4 mg", "Cefixime 200 mg", "Losartan 50 mg", "Salbutamol inhaler", "ORS sachet"]
FORMS = ["Tab.", "Cap.", "Syp.", "Inj."]
FREQ = ["1-0-1", "1-1-1", "0-0-1", "1-0-0", "twice daily", "once daily at night", "thrice daily after food", "SOS",
        "once a week", "BD", "TDS", "OD", "HS"]
DURATION = ["3 days", "5 days", "7 days", "10 days", "2 weeks", "1 month", "3 months", "to continue"]
COMPLAINTS = ["fever and body ache for 3 days", "cough with expectoration", "burning micturition", "chest discomfort",
              "pain in the right knee", "headache and giddiness", "loose stools since yesterday", "breathlessness on exertion",
              "upper abdominal pain", "itching and skin rash", "sore throat", "low back pain"]
ADVICE = ["Plenty of oral fluids", "Avoid oily and spicy food", "Steam inhalation twice daily", "Review after 5 days",
          "Monitor blood pressure at home", "Low salt diet", "Regular walking for 30 minutes", "Follow up with reports"]

SCANS = [("X-RAY CHEST PA VIEW", ["Both lung fields are clear.", "Cardiac size is within normal limits.",
                                  "Costophrenic angles are clear.", "Bony thorax appears normal.",
                                  "No focal consolidation or pleural effusion seen."]),
         ("ULTRASOUND WHOLE ABDOMEN", ["Liver is normal in size and echotexture.", "Gall bladder is well distended, no calculi seen.",
                                       "Both kidneys are normal in size, shape and position.", "Spleen is normal in size.",
                                       "No free fluid in the peritoneal cavity.", "Urinary bladder is well distended with normal wall thickness."]),
         ("MRI BRAIN PLAIN", ["No evidence of acute infarct on diffusion weighted images.", "Ventricular system is normal in size.",
                              "No midline shift or mass effect.", "Grey white matter differentiation is maintained.",
                              "Posterior fossa structures are unremarkable."]),
         ("CT SCAN ABDOMEN AND PELVIS (CONTRAST)", ["Liver shows homogeneous enhancement.", "No focal hepatic lesion.",
                                                    "Pancreas is normal in size and attenuation.", "No significant lymphadenopathy.",
                                                    "Appendix is visualised and appears normal."]),
         ("X-RAY RIGHT KNEE AP AND LATERAL", ["Joint space is mildly reduced in the medial compartment.", "Marginal osteophytes are seen.",
                                              "No fracture or dislocation.", "Soft tissues appear normal."]),
         ("2D ECHOCARDIOGRAPHY", ["Left ventricular ejection fraction is 60%.", "No regional wall motion abnormality.",
                                  "All cardiac valves are structurally normal.", "No pericardial effusion.",
                                  "Normal chamber dimensions."]),
         ("MAMMOGRAPHY BILATERAL", ["Both breasts show scattered fibroglandular densities.", "No suspicious mass or microcalcification.",
                                    "No architectural distortion.", "BI-RADS category 1."]),
         ("USG OBSTETRIC (ANOMALY SCAN)", ["Single live intrauterine fetus.", "Fetal cardiac activity is present.",
                                           "Placenta is fundal and posterior.", "Liquor is adequate.",
                                           "No gross congenital anomaly detected."])]
IMPRESSIONS = ["Normal study.", "No significant abnormality detected.", "Findings suggestive of early degenerative changes.",
               "Mild hepatomegaly with grade I fatty change.", "Suggest clinical correlation.", "Essentially normal scan."]

DIAGNOSES = ["Acute gastroenteritis", "Community acquired pneumonia", "Type 2 diabetes mellitus with hyperglycaemia",
             "Dengue fever with thrombocytopenia", "Acute appendicitis", "Unstable angina", "Fracture neck of femur (right)",
             "Urinary tract infection", "Acute exacerbation of bronchial asthma", "Cholelithiasis", "Typhoid fever"]
PROCEDURES = ["Laparoscopic appendicectomy", "Laparoscopic cholecystectomy", "Coronary angiography", "Hemiarthroplasty",
              "Conservative management", "Intravenous antibiotics", "Nebulisation and oxygen support"]
CONDITION = ["stable", "afebrile and haemodynamically stable", "improved", "satisfactory", "ambulant and tolerating oral diet"]

VACCINES = ["BCG", "Hepatitis B", "OPV", "Pentavalent", "Rotavirus", "PCV", "IPV", "Measles Rubella (MR)", "DPT booster",
            "Typhoid conjugate vaccine", "Td (tetanus and diphtheria)", "Covishield", "Covaxin", "Influenza", "HPV",
            "Hepatitis A", "Varicella", "Japanese Encephalitis", "Rabies (ARV)"]
DOSES = ["Dose 1", "Dose 2", "Dose 3", "Booster", "Birth dose", "Precaution dose", "Single dose"]
SITES = ["left deltoid", "right deltoid", "left anterolateral thigh", "oral"]


def name():
    return f"{RNG.choice(FIRST)} {RNG.choice(LAST)}"


def date():
    return f"{RNG.randint(1, 28):02d}/{RNG.randint(1, 12):02d}/{RNG.randint(2019, 2026)}"


def age_sex():
    return f"{RNG.randint(1, 85)} yrs / {RNG.choice(['M', 'F', 'Male', 'Female'])}"


def header(extra=""):
    h = RNG.choice(HOSPITALS)
    lines = [h.upper() if RNG.random() < 0.5 else h, f"{RNG.randint(1, 240)} {RNG.choice(['Mall Road', 'Civil Lines', 'Station Road', 'Gandhi Nagar', 'MG Road'])}, {RNG.choice(CITIES)}",
             f"Phone: 0{RNG.randint(100, 999)}-{RNG.randint(2000000, 2999999)}"]
    if extra:
        lines.append(extra)
    return lines


def patient_block():
    style = RNG.randint(0, 2)
    if style == 0:
        return [f"Patient Name: {name()}    Age/Sex: {age_sex()}", f"UHID: {RNG.randint(100000, 999999)}    Date: {date()}"]
    if style == 1:
        return [f"Name : {name()}", f"Age : {age_sex()}", f"Reg. No. : {RNG.randint(1000, 99999)}", f"Dated : {date()}"]
    return [f"Mr./Ms. {name()}, {age_sex()}", f"ID {RNG.randint(100000, 999999)} | {date()}"]


TRUTH = []  # what the current document really contains, for testing the summariser


def value(test):
    _, unit, low, high, ref = test
    v = RNG.uniform(low, high)
    text = f"{v:.1f}" if high < 100 else f"{v:.0f}"
    TRUTH.append({"kind": "lab", "name": test[0], "value": float(text), "unit": unit, "reference": ref})
    return text, unit, ref


# --------------------------------------------------------------------------- Lab report
def lab_0():
    tests = RNG.sample(LAB_TESTS, RNG.randint(4, 9))
    lines = header("NABL accredited laboratory") + patient_block()
    lines += [f"Referred by: {RNG.choice(DOCTORS)}", f"Sample: {RNG.choice(SAMPLES)}  Collected: {date()}", RNG.choice(PANELS).upper(),
              "Test Name            Result      Unit        Biological Reference Interval"]
    for t in tests:
        v, unit, ref = value(t)
        lines.append(f"{t[0]:<22}{v:<10}{unit:<12}{ref}")
    lines += ["*** End of report ***", f"{RNG.choice(DOCTORS)}, {RNG.choice(QUALS)}  Consultant Pathologist"]
    return lines


def lab_1():
    tests = RNG.sample(LAB_TESTS, RNG.randint(3, 7))
    lines = ["LABORATORY INVESTIGATION REPORT"] + patient_block() + [f"Specimen received on {date()}, reported on {date()}"]
    for t in tests:
        v, unit, ref = value(t)
        flag = RNG.choice(["", "", " (H)", " (L)"])
        lines.append(f"{t[0]}: {v} {unit}{flag}   [Normal range {ref}]")
    lines += ["Method: automated analyser. Results relate only to the sample tested.", "Checked by lab technician. Verified by pathologist."]
    return lines


def lab_2():
    tests = RNG.sample(LAB_TESTS, RNG.randint(5, 10))
    lines = header() + [f"Department of {RNG.choice(['Biochemistry', 'Haematology', 'Clinical Pathology', 'Microbiology'])}"] + patient_block()
    lines += ["INVESTIGATION | OBSERVED VALUE | UNITS | REFERENCE RANGE"]
    for t in tests:
        v, unit, ref = value(t)
        lines.append(f"{t[0]} | {v} | {unit} | {ref}")
    lines += ["Interpretation: values outside the reference range are marked. Kindly correlate clinically.", "Sample type: " + RNG.choice(SAMPLES)]
    return lines


def lab_3():
    tests = RNG.sample(LAB_TESTS, RNG.randint(2, 5))
    lines = [f"Pathology report for {name()} ({age_sex()})", f"Lab no. {RNG.randint(10000, 99999)}  Report date {date()}"]
    for t in tests:
        v, unit, ref = value(t)
        lines.append(f"{t[0]} - result {v} {unit}, reference {ref}")
    lines += ["Remarks: fasting sample. Repeat test advised if clinically indicated.", "This is a computer generated laboratory report."]
    return lines


def lab_test():  # held-out layout
    tests = RNG.sample(LAB_TESTS, RNG.randint(4, 8))
    lines = [RNG.choice(HOSPITALS) + " - Diagnostic Services", f"Barcode {RNG.randint(10**7, 10**8)}", f"Client: {name()}, {age_sex()}",
             f"Blood drawn {date()} 07:{RNG.randint(10, 59)} hrs at home collection"]
    for t in tests:
        v, unit, ref = value(t)
        lines.append(f"> {t[0]} measured {v} {unit}; expected {ref}")
    lines += ["Analyte values are assayed on calibrated equipment with internal quality control.", "Signed electronically by the reporting biochemist."]
    return lines


# --------------------------------------------------------------------------- Prescription
def rx_lines(n):
    out = []
    for i, drug in enumerate(RNG.sample(DRUGS, n), 1):
        TRUTH.append({"kind": "medicine", "name": drug})
        out.append(f"{i}. {RNG.choice(FORMS)} {drug}   {RNG.choice(FREQ)}   x {RNG.choice(DURATION)}")
    return out


def rx_0():
    lines = header() + [f"{RNG.choice(DOCTORS)}  {RNG.choice(QUALS)}", f"Regd. No. {RNG.randint(10000, 99999)}"] + patient_block()
    lines += [f"C/o: {RNG.choice(COMPLAINTS)}", f"BP: {RNG.randint(100, 160)}/{RNG.randint(60, 100)} mmHg  Pulse: {RNG.randint(60, 110)}/min  Temp: {RNG.uniform(97, 103):.1f} F", "Rx"]
    lines += rx_lines(RNG.randint(2, 5)) + ["Advice: " + RNG.choice(ADVICE), f"Next visit: {date()}", "Signature"]
    return lines


def rx_1():
    lines = ["PRESCRIPTION", f"{RNG.choice(DOCTORS)}, {RNG.choice(QUALS)}"] + patient_block()
    lines += ["Diagnosis: " + RNG.choice(DIAGNOSES), "Medicines:"] + rx_lines(RNG.randint(1, 4))
    lines += [RNG.choice(ADVICE) + ".", "Not valid for medico-legal purposes. Substitution of medicines is not allowed."]
    return lines


def rx_2():
    lines = [f"OPD slip - {RNG.choice(HOSPITALS)}", f"Consultant: {RNG.choice(DOCTORS)}"] + patient_block()
    lines += [f"Chief complaint: {RNG.choice(COMPLAINTS)}", "Treatment advised:"]
    for drug in RNG.sample(DRUGS, RNG.randint(2, 4)):
        TRUTH.append({"kind": "medicine", "name": drug})
        lines.append(f"- {drug}, take {RNG.choice(FREQ)} for {RNG.choice(DURATION)} {RNG.choice(['after food', 'before food', 'at bedtime'])}")
    lines += ["Review with reports. " + RNG.choice(ADVICE) + ".", "Dispense as written."]
    return lines


def rx_3():
    lines = [f"Dr's clinic, {RNG.choice(CITIES)}", f"Timings 10 am - 2 pm, 6 pm - 9 pm", f"Pt: {name()}  {age_sex()}  Wt: {RNG.randint(8, 95)} kg  {date()}", "Rx"]
    lines += rx_lines(RNG.randint(2, 6)) + [f"Adv: {RNG.choice(ADVICE)}", f"Refill x {RNG.randint(0, 3)}"]
    return lines


def rx_test():  # held-out layout
    lines = [f"e-Prescription generated on {date()}", f"Prescriber {RNG.choice(DOCTORS)} ({RNG.choice(QUALS)}), teleconsultation",
             f"For {name()}, {age_sex()}", f"Presenting problem: {RNG.choice(COMPLAINTS)}"]
    for drug in RNG.sample(DRUGS, RNG.randint(2, 5)):
        TRUTH.append({"kind": "medicine", "name": drug})
        lines.append(f"* {drug} -- dosage {RNG.choice(FREQ)} -- course of {RNG.choice(DURATION)}")
    lines += ["Pharmacist: please dispense the above. Patient counselled on dosage.", RNG.choice(ADVICE) + "."]
    return lines


# --------------------------------------------------------------------------- Scan or imaging
def scan_0():
    title, findings = RNG.choice(SCANS)
    lines = header("Department of Radiology and Imaging") + patient_block() + [f"Ref. by: {RNG.choice(DOCTORS)}", title, "FINDINGS:"]
    lines += RNG.sample(findings, min(len(findings), RNG.randint(3, 5))) + ["IMPRESSION: " + RNG.choice(IMPRESSIONS),
                                                                             f"{RNG.choice(DOCTORS)}, {RNG.choice(['MD (Radiodiagnosis)', 'DMRD', 'DNB Radiology'])}  Consultant Radiologist"]
    return lines


def scan_1():
    title, findings = RNG.choice(SCANS)
    lines = ["RADIOLOGY REPORT", f"Study: {title}", f"Clinical history: {RNG.choice(COMPLAINTS)}"] + patient_block()
    lines += ["Technique: standard protocol was followed.", "Observations:"] + [f"- {f}" for f in RNG.sample(findings, min(len(findings), 4))]
    lines += ["Conclusion: " + RNG.choice(IMPRESSIONS), "Films and CD enclosed."]
    return lines


def scan_2():
    title, findings = RNG.choice(SCANS)
    lines = [f"{RNG.choice(HOSPITALS)} Imaging Centre", f"{title} - REPORT"] + patient_block()
    lines += [" ".join(RNG.sample(findings, min(len(findings), 4))), "Impression - " + RNG.choice(IMPRESSIONS),
              "Please correlate clinically. This report is not valid for medico-legal purposes.", "Reported by radiologist on " + date()]
    return lines


def scan_3():
    title, findings = RNG.choice(SCANS)
    lines = [f"Sonography / X-ray / CT report", f"Examination performed: {title} on {date()}", f"Patient {name()} {age_sex()}"]
    lines += RNG.sample(findings, min(len(findings), 3)) + ["IMP: " + RNG.choice(IMPRESSIONS), "Radiologist signature"]
    return lines


def scan_test():  # held-out layout
    title, findings = RNG.choice(SCANS)
    lines = [f"Teleradiology service - accession {RNG.randint(10**6, 10**7)}", f"Modality and region: {title}", f"Subject: {name()}, {age_sex()}, scanned {date()}",
             "Comparison: no prior imaging available.", "The reading radiologist notes the following:"]
    lines += [f"({i}) {f}" for i, f in enumerate(RNG.sample(findings, min(len(findings), 4)), 1)]
    lines += ["Overall opinion: " + RNG.choice(IMPRESSIONS), "Images archived on PACS."]
    return lines


# --------------------------------------------------------------------------- Discharge summary
def dis_0():
    lines = header() + ["DISCHARGE SUMMARY"] + patient_block()
    lines += [f"Date of admission: {date()}   Date of discharge: {date()}", f"Consultant: {RNG.choice(DOCTORS)}", f"IP No.: {RNG.randint(1000, 99999)}  Ward: {RNG.choice(['General', 'Private', 'ICU', 'Semi-private'])}",
              "Final diagnosis: " + RNG.choice(DIAGNOSES), f"Presenting complaints: {RNG.choice(COMPLAINTS)}",
              f"Course in hospital: Patient was admitted and managed with {RNG.choice(PROCEDURES).lower()}. Hospital stay was uneventful.",
              f"Condition at discharge: {RNG.choice(CONDITION)}", "Medication on discharge:"] + rx_lines(RNG.randint(2, 4))
    lines += [f"Follow up in OPD after {RNG.choice(['1 week', '10 days', '2 weeks'])}.", "In case of emergency contact casualty."]
    return lines


def dis_1():
    lines = ["DISCHARGE CARD", f"{RNG.choice(HOSPITALS)}"] + patient_block()
    lines += [f"Admitted on {date()} and discharged on {date()} under {RNG.choice(DOCTORS)}.", "Diagnosis at discharge: " + RNG.choice(DIAGNOSES),
              "Procedure done: " + RNG.choice(PROCEDURES), "Investigations during stay: Hb, TLC, RFT, LFT, ECG, chest X-ray - reports attached.",
              f"Patient is being discharged in {RNG.choice(CONDITION)} condition.", "Advice on discharge: " + RNG.choice(ADVICE) + ". Review in OPD."]
    return lines


def dis_2():
    lines = [f"Summary of inpatient treatment", f"Name {name()}  {age_sex()}  Bed {RNG.randint(1, 60)}", f"DOA {date()}  DOD {date()}  Length of stay {RNG.randint(1, 14)} days",
             f"History: patient presented with {RNG.choice(COMPLAINTS)}.", "On examination: conscious, oriented, vitals stable.",
             f"Treatment given: {RNG.choice(PROCEDURES)}, IV fluids, analgesics and supportive care.", "Discharge diagnosis - " + RNG.choice(DIAGNOSES),
             "Discharge medication and follow up instructions explained to attendant.", f"Treating doctor {RNG.choice(DOCTORS)}"]
    return lines


def dis_3():
    lines = header() + [f"Discharge summary of {name()} ({age_sex()})", f"Admission {date()} - Discharge {date()}", "Provisional diagnosis: " + RNG.choice(DIAGNOSES),
                        "Final diagnosis: " + RNG.choice(DIAGNOSES), f"Operative notes: {RNG.choice(PROCEDURES)} performed under {RNG.choice(['spinal', 'general', 'local'])} anaesthesia.",
                        f"Post-operative period uneventful. Discharged {RNG.choice(CONDITION)}.", "Sutures to be removed after 10 days. Wound care advised."]
    return lines


def dis_test():  # held-out layout
    lines = [f"Hospitalisation record closed {date()}", f"Inpatient {name()}, {age_sex()}, stayed {RNG.randint(2, 12)} nights in {RNG.choice(HOSPITALS)}",
             f"Reason for admission was {RNG.choice(COMPLAINTS)}; the working diagnosis became {RNG.choice(DIAGNOSES).lower()}.",
             f"During the stay the team carried out {RNG.choice(PROCEDURES).lower()}.", f"On leaving the ward the patient was {RNG.choice(CONDITION)}.",
             "Take-home medicines:"] + rx_lines(RNG.randint(1, 3)) + ["Return to the outpatient department for review; come to emergency if symptoms worsen."]
    return lines


# --------------------------------------------------------------------------- Vaccination record
def vac_rows(n):
    return [f"{v:<30}{RNG.choice(DOSES):<16}{date():<14}Batch {RNG.choice('ABCDEFGH')}{RNG.randint(1000, 9999)}" for v in RNG.sample(VACCINES, n)]


def vac_0():
    lines = header() + ["IMMUNISATION RECORD", f"Child's name: {name()}   Date of birth: {date()}", f"Mother's name: {name()}", "Vaccine                       Dose            Date given    Batch no."]
    lines += vac_rows(RNG.randint(3, 8)) + [f"Next vaccine due: {RNG.choice(VACCINES)} on {date()}", "Keep this card safe and bring it at every visit."]
    return lines


def vac_1():
    v = RNG.choice(["Covishield", "Covaxin", "Influenza", "Typhoid conjugate vaccine", "Hepatitis B"])
    lines = ["CERTIFICATE OF VACCINATION", f"Beneficiary name: {name()}", f"Age: {RNG.randint(12, 80)}   Gender: {RNG.choice(['Male', 'Female'])}", f"Beneficiary reference ID: {RNG.randint(10**10, 10**11)}",
             f"Vaccine name: {v}", f"Dose number: {RNG.randint(1, 3)}", f"Date of dose: {date()}", f"Batch number: {RNG.randint(10**6, 10**7)}",
             f"Vaccinated by: {name()} (ANM)", f"Vaccination at: {RNG.choice(HOSPITALS)}, {RNG.choice(CITIES)}"]
    return lines


def vac_2():
    lines = [f"Vaccination card - {RNG.choice(HOSPITALS)}", f"Name {name()}  DOB {date()}  Sex {RNG.choice(['M', 'F'])}"]
    for v in RNG.sample(VACCINES, RNG.randint(3, 7)):
        lines.append(f"{v} - {RNG.choice(DOSES)} given on {date()} at {RNG.choice(SITES)}, lot {RNG.randint(1000, 99999)}")
    lines += ["Adverse event following immunisation: none reported.", "Schedule as per national immunisation programme."]
    return lines


def vac_3():
    lines = [f"Immunisation history for {name()}", "Universal Immunisation Programme"] + vac_rows(RNG.randint(2, 6))
    lines += [f"Administered by staff nurse. Vaccinator sign.", f"Due date for booster: {date()}"]
    return lines


def vac_test():  # held-out layout
    lines = [f"Record of injections given for disease prevention", f"Recipient {name()}, born {date()}", f"Health centre: {RNG.choice(HOSPITALS)}"]
    for v in RNG.sample(VACCINES, RNG.randint(3, 6)):
        lines.append(f"On {date()} received {v} ({RNG.choice(DOSES).lower()}), vial lot {RNG.randint(1000, 99999)}, site {RNG.choice(SITES)}")
    lines += ["No reaction observed during the 30 minute waiting period.", "Bring this booklet for the next scheduled immunisation."]
    return lines


# --------------------------------------------------------------------------- Other
def oth_0():
    items = RNG.sample(["Room charges", "Consultation fee", "Pharmacy", "Laboratory charges", "OT charges", "Nursing charges", "Consumables", "Registration fee"], RNG.randint(3, 6))
    lines = header("GSTIN 09ABCDE1234F1Z5") + ["FINAL BILL / INVOICE", f"Bill No. {RNG.randint(1000, 99999)}  Date {date()}"] + patient_block()
    lines += [f"{i:<28}Rs. {RNG.randint(200, 45000)}.00" for i in items] + [f"Total amount: Rs. {RNG.randint(2000, 180000)}.00", f"Paid by {RNG.choice(['cash', 'UPI', 'card', 'insurance'])}. Balance: Nil", "Thank you. Get well soon."]
    return lines


def oth_1():
    lines = ["APPOINTMENT CONFIRMATION", f"Dear {name()},", f"Your appointment with {RNG.choice(DOCTORS)} is confirmed for {date()} at {RNG.randint(9, 19)}:{RNG.choice(['00', '15', '30', '45'])}.",
             f"Token number {RNG.randint(1, 80)}. Please arrive 15 minutes early with previous records.", f"Venue: {RNG.choice(HOSPITALS)}, {RNG.choice(CITIES)}. To reschedule call the front desk."]
    return lines


def oth_2():
    lines = ["INSURANCE CLAIM FORM - PART A", f"Policy number: {RNG.randint(10**9, 10**10)}", f"Name of insured: {name()}", f"TPA: {RNG.choice(['MediAssist', 'Paramount', 'Health India', 'Vidal'])}",
             f"Claim amount: Rs. {RNG.randint(5000, 300000)}", "Cashless authorisation request. Declaration by the insured: I hereby declare that the information furnished is true.",
             "Enclosures: bills, receipts, identity proof."]
    return lines


def oth_3():
    lines = ["CONSENT FORM", f"I, {name()}, aged {RNG.randint(18, 80)}, hereby give my consent for the proposed procedure.",
             "The nature, risks and alternatives have been explained to me in a language I understand.", "I have had the opportunity to ask questions.",
             f"Signature of patient / guardian          Witness          Date {date()}"]
    return lines


def oth_4():
    lines = ["MEDICAL FITNESS CERTIFICATE", f"This is to certify that {name()}, {age_sex()}, has been examined by me on {date()}",
             "and is found to be physically and mentally fit to resume duties / join the course.", f"{RNG.choice(DOCTORS)}, {RNG.choice(QUALS)}", "Seal and signature"]
    return lines


def oth_test():  # held-out layout
    lines = [f"Receipt of payment #{RNG.randint(10**5, 10**6)}", f"Received with thanks from {name()} a sum of Rs. {RNG.randint(300, 9000)} towards {RNG.choice(['advance deposit', 'ambulance service', 'canteen coupons', 'parking'])}.",
             f"Counter {RNG.randint(1, 6)}, cashier on duty. {date()}", "This receipt must be produced for any refund. Goods once sold will not be taken back."]
    return lines


TEMPLATES = {
    "Lab report": ([lab_0, lab_1, lab_2, lab_3], lab_test),
    "Prescription": ([rx_0, rx_1, rx_2, rx_3], rx_test),
    "Scan or imaging": ([scan_0, scan_1, scan_2, scan_3], scan_test),
    "Discharge summary": ([dis_0, dis_1, dis_2, dis_3], dis_test),
    "Vaccination record": ([vac_0, vac_1, vac_2, vac_3], vac_test),
    "Other": ([oth_0, oth_1, oth_2, oth_3, oth_4], oth_test),
}


def add_noise(lines):
    """Make documents messier, the way real scans and exports are."""
    lines = list(lines)
    if RNG.random() < 0.35 and len(lines) > 4:  # heading or letterhead missing
        del lines[RNG.randrange(0, 3)]
    if RNG.random() < 0.3:
        lines.insert(RNG.randrange(len(lines) + 1), RNG.choice(["Page 1 of 1", "Printed on " + date(), "Confidential", "www.example-hospital.in", "Timings: 24 hours"]))
    text = "\n".join(lines)
    if RNG.random() < 0.5:  # OCR-style character errors
        chars = list(text)
        for _ in range(int(len(chars) * RNG.uniform(0.005, 0.03))):
            i = RNG.randrange(len(chars))
            if chars[i].isalpha():
                chars[i] = RNG.choice(["", chars[i] * 2, RNG.choice("abcdefghijklmnopqrstuvwxyz")])
        text = "".join(chars)
    if RNG.random() < 0.2:
        text = text.upper() if RNG.random() < 0.5 else text.lower()
    return text


def main(per_template=110, per_test_template=150):
    out = Path(__file__).parent / "data"
    out.mkdir(exist_ok=True)
    rows = []
    for label, (train_templates, test_template) in TEMPLATES.items():
        for template in train_templates:
            for _ in range(per_template):
                rows.append({"label": label, "layout": template.__name__, "split": "seen", "text": add_noise(template())})
        for _ in range(per_test_template):
            rows.append({"label": label, "layout": test_template.__name__, "split": "unseen-layout", "text": add_noise(test_template())})
    RNG.shuffle(rows)
    with open(out / "documents.jsonl", "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} documents to {out / 'documents.jsonl'}")

    # A second, smaller set with the true contents attached, used to measure
    # how well the summariser pulls lab values and medicines out of a document.
    # Half are clean, half have the same scan-style noise as above.
    extraction = []
    for label in ["Lab report", "Prescription", "Discharge summary"]:
        train_templates, test_template = TEMPLATES[label]
        for template in train_templates + [test_template]:
            for i in range(60):
                TRUTH.clear()
                lines = template()
                truth = list(TRUTH)
                noisy = i % 2 == 1
                extraction.append({"label": label, "layout": template.__name__, "noisy": noisy,
                                   "text": add_noise(lines) if noisy else "\n".join(lines), "truth": truth})
    with open(out / "extraction.jsonl", "w", encoding="utf-8") as f:
        for row in extraction:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"wrote {len(extraction)} documents with known contents to {out / 'extraction.jsonl'}")


if __name__ == "__main__":
    main()
