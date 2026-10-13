// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MedSecure - patient-controlled health record registry
/// @notice Stores only pointers (IPFS CIDs), integrity hashes and wrapped keys.
///         No medical data and no usable encryption key ever touches the chain:
///         files live encrypted on IPFS, and every AES key stored here is
///         wrapped with the recipient's public key, so only that recipient
///         can unwrap it. That is why the read functions below are open.
contract MedSecure {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Role {
        None,
        Patient,
        Doctor,
        HospitalAdmin
    }

    struct User {
        Role role;
        bool verified; // patients: true at signup. doctors: true once their hospital admin verifies them
        bool emergencyDoctor; // may use break-glass emergency access
        uint256 hospitalId; // 0 for patients
        bytes publicKey; // used off-chain to wrap AES keys for this user
    }

    struct Hospital {
        string name;
        address admin;
    }

    struct Record {
        string cid; // IPFS content identifier of the encrypted file
        bytes32 fileHash; // SHA-256 of the original (unencrypted) file
        string recordType; // e.g. "Lab report", "Prescription"
        bytes wrappedKey; // AES key wrapped with the patient's public key
        address uploader;
        uint256 timestamp;
    }

    struct Grant {
        uint256 expiry; // unix time after which the grant is dead
        uint32 viewsLeft; // how many more times the record may be opened
        bytes wrappedKey; // AES key wrapped with the provider's public key
    }

    struct EmergencyProfile {
        bool isSet;
        uint256 recordId; // which record is the critical summary
        bytes wrappedKey; // AES key wrapped with the network emergency public key
    }

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 public constant EMERGENCY_WINDOW = 1 hours;
    /// @notice The longest a patient can share a record for in one go.
    uint256 public constant MAX_GRANT_DURATION = 30 days;
    /// @notice Passed as maxViews to mean "no limit on the number of opens".
    uint32 public constant UNLIMITED_VIEWS = type(uint32).max;

    address public immutable owner; // network operator: registers hospitals
    uint256 public hospitalCount;

    mapping(address => User) private _users;
    mapping(uint256 => Hospital) private _hospitals; // ids start at 1
    mapping(address => Record[]) private _records; // patient => records
    // patient => recordId => provider => grant
    mapping(address => mapping(uint256 => mapping(address => Grant))) private _grants;
    mapping(address => EmergencyProfile) private _emergency; // patient => profile
    // patient => doctor => expiry of the break-glass window
    mapping(address => mapping(address => uint256)) private _emergencyExpiry;

    // ---------------------------------------------------------------------
    // Events (these are the audit trail)
    // ---------------------------------------------------------------------

    event HospitalRegistered(uint256 indexed hospitalId, address indexed admin, string name);
    event UserRegistered(address indexed user, Role role, uint256 hospitalId);
    event DoctorVerified(address indexed doctor, address indexed admin);
    event EmergencyDoctorSet(address indexed doctor, bool enabled);
    event RecordAdded(address indexed patient, uint256 indexed recordId, address indexed uploader, string cid);
    event AccessGranted(
        address indexed patient,
        address indexed provider,
        uint256 indexed recordId,
        uint256 expiry,
        uint32 maxViews
    );
    event AccessRevoked(address indexed patient, address indexed provider, uint256 indexed recordId);
    event RecordAccessed(address indexed patient, address indexed accessor, uint256 indexed recordId, uint256 timestamp);
    event EmergencyRecordSet(address indexed patient, uint256 recordId);
    event EmergencyAccessUsed(address indexed patient, address indexed doctor, string reason, uint256 expiry);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "Only network owner");
        _;
    }

    modifier onlyPatient() {
        require(_users[msg.sender].role == Role.Patient, "Only a patient");
        _;
    }

    modifier onlyVerifiedDoctor() {
        require(isVerifiedDoctor(msg.sender), "Only a verified doctor");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Identity
    // ---------------------------------------------------------------------

    /// @notice Network owner registers a hospital and its admin account.
    function registerHospital(address admin, string calldata name) external onlyOwner returns (uint256 hospitalId) {
        require(admin != address(0), "Invalid admin");
        require(bytes(name).length > 0, "Name required");
        require(_users[admin].role == Role.None, "Admin already registered");

        hospitalId = ++hospitalCount;
        _hospitals[hospitalId] = Hospital({name: name, admin: admin});
        _users[admin].role = Role.HospitalAdmin;
        _users[admin].verified = true;
        _users[admin].hospitalId = hospitalId;

        emit HospitalRegistered(hospitalId, admin, name);
        emit UserRegistered(admin, Role.HospitalAdmin, hospitalId);
    }

    /// @notice A patient registers themselves with their public encryption key.
    function registerPatient(bytes calldata publicKey) external {
        require(_users[msg.sender].role == Role.None, "Already registered");
        require(publicKey.length > 0, "Public key required");

        User storage u = _users[msg.sender];
        u.role = Role.Patient;
        u.verified = true;
        u.publicKey = publicKey;

        emit UserRegistered(msg.sender, Role.Patient, 0);
    }

    /// @notice A doctor registers under a hospital. Stays unverified until
    ///         that hospital's admin calls verifyDoctor.
    function registerDoctor(bytes calldata publicKey, uint256 hospitalId) external {
        require(_users[msg.sender].role == Role.None, "Already registered");
        require(publicKey.length > 0, "Public key required");
        require(hospitalId != 0 && hospitalId <= hospitalCount, "Unknown hospital");

        User storage u = _users[msg.sender];
        u.role = Role.Doctor;
        u.hospitalId = hospitalId;
        u.publicKey = publicKey;

        emit UserRegistered(msg.sender, Role.Doctor, hospitalId);
    }

    /// @notice A hospital admin verifies a doctor of their own hospital.
    function verifyDoctor(address doctor) external {
        _requireAdminOf(doctor);
        _users[doctor].verified = true;
        emit DoctorVerified(doctor, msg.sender);
    }

    /// @notice A hospital admin marks one of their verified doctors as an
    ///         emergency doctor (or removes the flag).
    function setEmergencyDoctor(address doctor, bool enabled) external {
        _requireAdminOf(doctor);
        require(_users[doctor].verified, "Doctor not verified");
        _users[doctor].emergencyDoctor = enabled;
        emit EmergencyDoctorSet(doctor, enabled);
    }

    // ---------------------------------------------------------------------
    // Records
    // ---------------------------------------------------------------------

    /// @notice Add a record for a patient. Callable by a verified doctor, or
    ///         by the patient for their own records.
    /// @param wrappedKey the record's AES key wrapped with the PATIENT's public key
    function addRecord(
        address patient,
        string calldata cid,
        bytes32 fileHash,
        string calldata recordType,
        bytes calldata wrappedKey
    ) external returns (uint256 recordId) {
        require(_users[patient].role == Role.Patient, "Unknown patient");
        require(msg.sender == patient || isVerifiedDoctor(msg.sender), "Not allowed to upload");
        require(bytes(cid).length > 0, "CID required");
        require(wrappedKey.length > 0, "Wrapped key required");

        recordId = _records[patient].length;
        _records[patient].push(
            Record({
                cid: cid,
                fileHash: fileHash,
                recordType: recordType,
                wrappedKey: wrappedKey,
                uploader: msg.sender,
                timestamp: block.timestamp
            })
        );

        emit RecordAdded(patient, recordId, msg.sender, cid);
    }

    // ---------------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------------

    /// @notice Patient grants a verified doctor access to one record, limited
    ///         both in time and in the number of times it can be opened.
    /// @param duration seconds from now until the grant expires (max 30 days)
    /// @param maxViews how many times the doctor may open the record, or
    ///        UNLIMITED_VIEWS for no limit
    /// @param wrappedKey the record's AES key wrapped with the DOCTOR's public key
    function grantAccess(
        address provider,
        uint256 recordId,
        uint256 duration,
        uint32 maxViews,
        bytes calldata wrappedKey
    ) external onlyPatient {
        require(recordId < _records[msg.sender].length, "Unknown record");
        require(isVerifiedDoctor(provider), "Provider is not a verified doctor");
        require(duration > 0, "Duration must be positive");
        require(duration <= MAX_GRANT_DURATION, "Duration is longer than 30 days");
        require(maxViews > 0, "Views must be positive");
        require(wrappedKey.length > 0, "Wrapped key required");

        uint256 expiry = block.timestamp + duration;
        _grants[msg.sender][recordId][provider] = Grant({expiry: expiry, viewsLeft: maxViews, wrappedKey: wrappedKey});

        emit AccessGranted(msg.sender, provider, recordId, expiry, maxViews);
    }

    /// @notice Patient revokes a grant immediately.
    function revokeAccess(address provider, uint256 recordId) external onlyPatient {
        require(_grants[msg.sender][recordId][provider].expiry != 0, "No such grant");
        delete _grants[msg.sender][recordId][provider];
        emit AccessRevoked(msg.sender, provider, recordId);
    }

    /// @notice Write an entry to the audit trail when a record is opened.
    ///         Reads do not create transactions on their own, so the backend
    ///         calls this (signed as the reader) every time it serves a file.
    ///         It also counts the open against the grant's view limit, and
    ///         wipes the grant (and its wrapped key) once the limit is used up.
    function logAccess(address patient, uint256 recordId) external {
        require(hasAccess(patient, recordId, msg.sender), "No access");

        Grant storage grant = _grants[patient][recordId][msg.sender];
        if (grant.expiry > block.timestamp && grant.viewsLeft > 0 && grant.viewsLeft != UNLIMITED_VIEWS) {
            grant.viewsLeft -= 1;
            if (grant.viewsLeft == 0) {
                delete _grants[patient][recordId][msg.sender];
            }
        }

        emit RecordAccessed(patient, msg.sender, recordId, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Emergency (break-glass) access
    // ---------------------------------------------------------------------

    /// @notice Patient nominates one record as their critical summary.
    /// @param wrappedKey that record's AES key wrapped with the network
    ///        emergency public key (held by the backend)
    function setEmergencyRecord(uint256 recordId, bytes calldata wrappedKey) external onlyPatient {
        require(recordId < _records[msg.sender].length, "Unknown record");
        require(wrappedKey.length > 0, "Wrapped key required");
        _emergency[msg.sender] = EmergencyProfile({isSet: true, recordId: recordId, wrappedKey: wrappedKey});
        emit EmergencyRecordSet(msg.sender, recordId);
    }

    /// @notice An emergency doctor opens a short window on a patient's
    ///         critical summary. Always logged, with a mandatory reason.
    function emergencyAccess(address patient, string calldata reason) external onlyVerifiedDoctor {
        require(_users[msg.sender].emergencyDoctor, "Not an emergency doctor");
        require(_emergency[patient].isSet, "Patient has no emergency record");
        require(bytes(reason).length > 0, "Reason required");

        uint256 expiry = block.timestamp + EMERGENCY_WINDOW;
        _emergencyExpiry[patient][msg.sender] = expiry;

        emit EmergencyAccessUsed(patient, msg.sender, reason, expiry);
    }

    // ---------------------------------------------------------------------
    // Read functions
    // ---------------------------------------------------------------------

    /// @notice True if `user` may open this record right now.
    function hasAccess(address patient, uint256 recordId, address user) public view returns (bool) {
        if (recordId >= _records[patient].length) return false;
        if (user == patient) return true;
        Grant storage grant = _grants[patient][recordId][user];
        if (grant.expiry > block.timestamp && grant.viewsLeft > 0) return true;

        EmergencyProfile storage e = _emergency[patient];
        return e.isSet && e.recordId == recordId && _emergencyExpiry[patient][user] > block.timestamp;
    }

    function isVerifiedDoctor(address account) public view returns (bool) {
        User storage u = _users[account];
        return u.role == Role.Doctor && u.verified;
    }

    function getUser(address account) external view returns (User memory) {
        return _users[account];
    }

    function getHospital(uint256 hospitalId) external view returns (Hospital memory) {
        return _hospitals[hospitalId];
    }

    function getRecordCount(address patient) external view returns (uint256) {
        return _records[patient].length;
    }

    function getRecord(address patient, uint256 recordId) external view returns (Record memory) {
        require(recordId < _records[patient].length, "Unknown record");
        return _records[patient][recordId];
    }

    function getRecords(address patient) external view returns (Record[] memory) {
        return _records[patient];
    }

    function getGrant(address patient, uint256 recordId, address provider) external view returns (Grant memory) {
        return _grants[patient][recordId][provider];
    }

    function getEmergencyProfile(address patient) external view returns (EmergencyProfile memory) {
        return _emergency[patient];
    }

    function getEmergencyExpiry(address patient, address doctor) external view returns (uint256) {
        return _emergencyExpiry[patient][doctor];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _requireAdminOf(address doctor) private view {
        User storage admin = _users[msg.sender];
        User storage d = _users[doctor];
        require(admin.role == Role.HospitalAdmin, "Only a hospital admin");
        require(d.role == Role.Doctor, "Not a doctor");
        require(d.hospitalId == admin.hospitalId, "Doctor belongs to another hospital");
    }
}
