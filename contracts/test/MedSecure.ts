import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

// Dummy values: on-chain these are opaque bytes, so any non-empty value works.
const PUBKEY = "0x04aabbcc";
const WRAPPED_FOR_PATIENT = "0x1111";
const WRAPPED_FOR_DOCTOR = "0x2222";
const WRAPPED_FOR_EMERGENCY = "0x3333";
const CID = "bafybeigdyrzt5examplecidexamplecidexamplecid";
const FILE_HASH = ethers.sha256(ethers.toUtf8Bytes("original report contents"));

const DAY = 24 * 60 * 60;
const UNLIMITED = 2 ** 32 - 1; // UNLIMITED_VIEWS in the contract
const HOUR = 60 * 60;

// Deploys a fresh contract with two hospitals, one verified doctor in each,
// and one registered patient.
async function setup() {
  const [owner, admin1, admin2, doctorA, doctorB, patient, stranger] = await ethers.getSigners();
  const med = await ethers.deployContract("MedSecure");

  await med.registerHospital(admin1.address, "City Hospital");
  await med.registerHospital(admin2.address, "Lakeside Hospital");

  await med.connect(patient).registerPatient(PUBKEY);
  await med.connect(doctorA).registerDoctor(PUBKEY, 1);
  await med.connect(doctorB).registerDoctor(PUBKEY, 2);
  await med.connect(admin1).verifyDoctor(doctorA.address);
  await med.connect(admin2).verifyDoctor(doctorB.address);

  return { med, owner, admin1, admin2, doctorA, doctorB, patient, stranger };
}

// Same as setup(), plus one record uploaded by doctorA (record id 0).
async function setupWithRecord() {
  const ctx = await setup();
  await ctx.med
    .connect(ctx.doctorA)
    .addRecord(ctx.patient.address, CID, FILE_HASH, "Lab report", WRAPPED_FOR_PATIENT);
  return ctx;
}

describe("MedSecure", function () {
  describe("Identity", function () {
    it("makes the deployer the network owner", async function () {
      const { med, owner } = await setup();
      expect(await med.owner()).to.equal(owner.address);
    });

    it("only lets the owner register hospitals", async function () {
      const { med, stranger } = await setup();
      await expect(med.connect(stranger).registerHospital(stranger.address, "Fake")).to.be.revertedWith(
        "Only network owner",
      );
      expect(await med.hospitalCount()).to.equal(2n);
    });

    it("registers a patient as verified, with their public key", async function () {
      const { med, patient } = await setup();
      const user = await med.getUser(patient.address);
      expect(user.role).to.equal(1n); // Role.Patient
      expect(user.verified).to.equal(true);
      expect(user.publicKey).to.equal(PUBKEY);
    });

    it("rejects a second registration from the same account", async function () {
      const { med, patient } = await setup();
      await expect(med.connect(patient).registerPatient(PUBKEY)).to.be.revertedWith("Already registered");
      await expect(med.connect(patient).registerDoctor(PUBKEY, 1)).to.be.revertedWith("Already registered");
    });

    it("keeps a new doctor unverified until their own hospital admin verifies them", async function () {
      const { med, admin1, admin2, stranger } = await setup();
      await med.connect(stranger).registerDoctor(PUBKEY, 1);
      expect(await med.isVerifiedDoctor(stranger.address)).to.equal(false);

      await expect(med.connect(admin2).verifyDoctor(stranger.address)).to.be.revertedWith(
        "Doctor belongs to another hospital",
      );

      await expect(med.connect(admin1).verifyDoctor(stranger.address))
        .to.emit(med, "DoctorVerified")
        .withArgs(stranger.address, admin1.address);
      expect(await med.isVerifiedDoctor(stranger.address)).to.equal(true);
    });

    it("rejects a doctor registering under a hospital that does not exist", async function () {
      const { med, stranger } = await setup();
      await expect(med.connect(stranger).registerDoctor(PUBKEY, 99)).to.be.revertedWith("Unknown hospital");
    });
  });

  describe("Records", function () {
    it("lets a verified doctor add a record and stores it correctly", async function () {
      const { med, doctorA, patient } = await setup();

      await expect(med.connect(doctorA).addRecord(patient.address, CID, FILE_HASH, "Lab report", WRAPPED_FOR_PATIENT))
        .to.emit(med, "RecordAdded")
        .withArgs(patient.address, 0n, doctorA.address, CID);

      expect(await med.getRecordCount(patient.address)).to.equal(1n);
      const record = await med.getRecord(patient.address, 0);
      expect(record.cid).to.equal(CID);
      expect(record.fileHash).to.equal(FILE_HASH);
      expect(record.recordType).to.equal("Lab report");
      expect(record.wrappedKey).to.equal(WRAPPED_FOR_PATIENT);
      expect(record.uploader).to.equal(doctorA.address);
    });

    it("lets a patient add their own record", async function () {
      const { med, patient } = await setup();
      await med.connect(patient).addRecord(patient.address, CID, FILE_HASH, "Old prescription", WRAPPED_FOR_PATIENT);
      expect(await med.getRecordCount(patient.address)).to.equal(1n);
    });

    it("blocks unverified doctors and strangers from uploading", async function () {
      const { med, patient, stranger } = await setup();
      await expect(
        med.connect(stranger).addRecord(patient.address, CID, FILE_HASH, "Lab report", WRAPPED_FOR_PATIENT),
      ).to.be.revertedWith("Not allowed to upload");

      await med.connect(stranger).registerDoctor(PUBKEY, 1); // registered but not verified
      await expect(
        med.connect(stranger).addRecord(patient.address, CID, FILE_HASH, "Lab report", WRAPPED_FOR_PATIENT),
      ).to.be.revertedWith("Not allowed to upload");
    });

    it("rejects a record for an account that is not a patient", async function () {
      const { med, doctorA, stranger } = await setup();
      await expect(
        med.connect(doctorA).addRecord(stranger.address, CID, FILE_HASH, "Lab report", WRAPPED_FOR_PATIENT),
      ).to.be.revertedWith("Unknown patient");
    });
  });

  describe("Access control", function () {
    it("gives the patient access to their own record, and nobody else by default", async function () {
      const { med, patient, doctorA, doctorB } = await setupWithRecord();
      expect(await med.hasAccess(patient.address, 0, patient.address)).to.equal(true);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(false);
      // Uploading a record does not give the uploader standing access to it.
      expect(await med.hasAccess(patient.address, 0, doctorA.address)).to.equal(false);
    });

    it("lets the patient grant a doctor at another hospital time-bound access", async function () {
      const { med, patient, doctorB } = await setupWithRecord();

      await expect(med.connect(patient).grantAccess(doctorB.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR)).to.emit(
        med,
        "AccessGranted",
      );

      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(true);
      const grant = await med.getGrant(patient.address, 0, doctorB.address);
      expect(grant.wrappedKey).to.equal(WRAPPED_FOR_DOCTOR);
    });

    it("expires the grant automatically when its time is up", async function () {
      const { med, patient, doctorB } = await setupWithRecord();
      await med.connect(patient).grantAccess(doctorB.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR);

      await networkHelpers.time.increase(DAY - HOUR);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(true);

      await networkHelpers.time.increase(2 * HOUR);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(false);
      await expect(med.connect(doctorB).logAccess(patient.address, 0)).to.be.revertedWith("No access");
    });

    it("lets the patient revoke before expiry, wiping the wrapped key", async function () {
      const { med, patient, doctorB } = await setupWithRecord();
      await med.connect(patient).grantAccess(doctorB.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR);

      await expect(med.connect(patient).revokeAccess(doctorB.address, 0))
        .to.emit(med, "AccessRevoked")
        .withArgs(patient.address, doctorB.address, 0n);

      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(false);
      const grant = await med.getGrant(patient.address, 0, doctorB.address);
      expect(grant.expiry).to.equal(0n);
      expect(grant.wrappedKey).to.equal("0x");
    });

    it("only lets the patient grant, and only to a verified doctor", async function () {
      const { med, patient, doctorA, doctorB, stranger } = await setupWithRecord();

      await expect(med.connect(doctorA).grantAccess(doctorB.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR)).to.be.revertedWith(
        "Only a patient",
      );
      await expect(med.connect(patient).grantAccess(stranger.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR)).to.be.revertedWith(
        "Provider is not a verified doctor",
      );
      await expect(med.connect(patient).grantAccess(doctorB.address, 5, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR)).to.be.revertedWith(
        "Unknown record",
      );
    });

    it("refuses a grant longer than 30 days", async function () {
      const { med, patient, doctorB } = await setupWithRecord();
      await expect(
        med.connect(patient).grantAccess(doctorB.address, 0, 31 * DAY, UNLIMITED, WRAPPED_FOR_DOCTOR),
      ).to.be.revertedWith("Duration is longer than 30 days");
      await med.connect(patient).grantAccess(doctorB.address, 0, 30 * DAY, UNLIMITED, WRAPPED_FOR_DOCTOR);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(true);
    });

    it("enforces the view limit and wipes the grant when it is used up", async function () {
      const { med, patient, doctorB } = await setupWithRecord();
      await med.connect(patient).grantAccess(doctorB.address, 0, DAY, 2, WRAPPED_FOR_DOCTOR);

      await med.connect(doctorB).logAccess(patient.address, 0);
      expect((await med.getGrant(patient.address, 0, doctorB.address)).viewsLeft).to.equal(1n);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(true);

      await med.connect(doctorB).logAccess(patient.address, 0);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(false);
      const grant = await med.getGrant(patient.address, 0, doctorB.address);
      expect(grant.expiry).to.equal(0n);
      expect(grant.wrappedKey).to.equal("0x");

      await expect(med.connect(doctorB).logAccess(patient.address, 0)).to.be.revertedWith("No access");
    });

    it("does not count opens against an unlimited grant", async function () {
      const { med, patient, doctorB } = await setupWithRecord();
      await med.connect(patient).grantAccess(doctorB.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR);
      await med.connect(doctorB).logAccess(patient.address, 0);
      await med.connect(doctorB).logAccess(patient.address, 0);
      expect((await med.getGrant(patient.address, 0, doctorB.address)).viewsLeft).to.equal(BigInt(UNLIMITED));
    });

    it("writes an audit entry when an authorised doctor opens a record", async function () {
      const { med, patient, doctorA, doctorB } = await setupWithRecord();
      await med.connect(patient).grantAccess(doctorB.address, 0, DAY, UNLIMITED, WRAPPED_FOR_DOCTOR);

      await expect(med.connect(doctorB).logAccess(patient.address, 0)).to.emit(med, "RecordAccessed");
      await expect(med.connect(doctorA).logAccess(patient.address, 0)).to.be.revertedWith("No access");
    });
  });

  describe("Emergency access", function () {
    // Record 0 = ordinary lab report, record 1 = critical summary.
    async function setupEmergency() {
      const ctx = await setupWithRecord();
      await ctx.med
        .connect(ctx.patient)
        .addRecord(ctx.patient.address, CID, FILE_HASH, "Critical summary", WRAPPED_FOR_PATIENT);
      await ctx.med.connect(ctx.patient).setEmergencyRecord(1, WRAPPED_FOR_EMERGENCY);
      await ctx.med.connect(ctx.admin2).setEmergencyDoctor(ctx.doctorB.address, true);
      return ctx;
    }

    it("refuses doctors who do not hold the emergency role", async function () {
      const { med, patient, doctorA } = await setupEmergency();
      await expect(med.connect(doctorA).emergencyAccess(patient.address, "Unconscious on arrival")).to.be.revertedWith(
        "Not an emergency doctor",
      );
    });

    it("requires a reason, and a patient who has set an emergency record", async function () {
      const { med, patient, doctorB, stranger } = await setupEmergency();
      await expect(med.connect(doctorB).emergencyAccess(patient.address, "")).to.be.revertedWith("Reason required");

      await med.connect(stranger).registerPatient(PUBKEY);
      await expect(med.connect(doctorB).emergencyAccess(stranger.address, "Road accident")).to.be.revertedWith(
        "Patient has no emergency record",
      );
    });

    it("opens only the critical summary, logs it, and closes after the window", async function () {
      const { med, patient, doctorB } = await setupEmergency();

      await expect(med.connect(doctorB).emergencyAccess(patient.address, "Unconscious on arrival")).to.emit(
        med,
        "EmergencyAccessUsed",
      );

      expect(await med.hasAccess(patient.address, 1, doctorB.address)).to.equal(true);
      expect(await med.hasAccess(patient.address, 0, doctorB.address)).to.equal(false);

      const profile = await med.getEmergencyProfile(patient.address);
      expect(profile.recordId).to.equal(1n);
      expect(profile.wrappedKey).to.equal(WRAPPED_FOR_EMERGENCY);

      await networkHelpers.time.increase(HOUR + 1);
      expect(await med.hasAccess(patient.address, 1, doctorB.address)).to.equal(false);
    });

    it("only lets a hospital admin set the emergency role for their own doctors", async function () {
      const { med, admin1, doctorB, stranger } = await setupEmergency();
      await expect(med.connect(admin1).setEmergencyDoctor(doctorB.address, true)).to.be.revertedWith(
        "Doctor belongs to another hospital",
      );
      await expect(med.connect(stranger).setEmergencyDoctor(doctorB.address, true)).to.be.revertedWith(
        "Only a hospital admin",
      );
    });
  });
});
