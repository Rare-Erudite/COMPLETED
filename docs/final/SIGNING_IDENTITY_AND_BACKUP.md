# Signing Identity — Production Configuration and Backup Plan

**Status:** Identity B approved by the owner as the production signing identity.
**Date:** 2026-11-27
**No key was generated, replaced or published in this phase.**

---

## 1. The two identities

| | Identity A | Identity B |
|---|---|---|
| Certificate SHA-256 | `C550FD6549D7BBDF2201F9578EFB143128F925CF7F8830DDFFD349F4995BC57B` | `37be10e9…badee1df` |
| Role | Original release identity | **Approved production identity** |
| Status | Preserved, untouched | In use |

Identity A's material is left exactly as it was. Nothing in this phase reads,
moves, re-encrypts or deletes it.

## 2. What enforces Identity B

The release workflow (`.github/workflows/release-apk.yml`) does not merely
*use* Identity B — it **refuses to publish anything else**. After signing, the
workflow verifies the APK's certificate fingerprint against the expected value
and fails the job on a mismatch. A build signed with Identity A, or with a
newly generated key, cannot reach a release.

That guard is the reason this phase could confirm the identity without touching
any secret: the last release candidate was built, and `apksigner verify`
reported `37be10e9…badee1df`.

## 3. Where the material lives

| Item | Location | Notes |
|---|---|---|
| Keystore | GitHub Actions secret `ANDROID_KEYSTORE_BASE64` | Never in the repo |
| Store password | GitHub Actions secret `ANDROID_KEYSTORE_PASSWORD` | |
| Key password | GitHub Actions secret `ANDROID_KEY_PASSWORD` | |
| Alias | `rarekey` | PKCS12, RSA 4096, SHA384withRSA |
| Validity | to 2054-03-18 | |

The keystore is **not** in source control and must never be committed. The
`.gitignore` covers `*.jks`, `*.keystore` and `*.p12`.

## 4. Backup plan for Identity B

The keystore is the one artefact that cannot be regenerated: lose it and no
future build can update the installed app — every user would have to uninstall
and reinstall, losing their data.

**Three copies, two media, one off-site:**

1. **Primary** — the GitHub Actions secret (already in place).
2. **Encrypted archive, offline** — export the keystore, encrypt with
   `age` or `gpg` using a passphrase held only by the owner, store on an
   encrypted USB drive kept offline.
3. **Encrypted archive, second location** — a second encrypted copy in a
   different physical place (a safe, or a password manager's file storage).

**The passphrase must not be stored with any copy.** If the passphrase and the
archive travel together, the encryption protects nothing.

### Restoration verification (do this once, now, not when you need it)

A backup that has never been restored is a hope, not a backup.

```bash
# 1. Decrypt the archive to a scratch directory
age -d -o /tmp/restore.jks backup.jks.age

# 2. Confirm the certificate fingerprint matches Identity B
keytool -list -v -keystore /tmp/restore.jks -alias rarekey \
  | grep 'SHA256:'

# 3. Confirm the key can actually sign
keytool -certreq -keystore /tmp/restore.jks -alias rarekey \
  -file /tmp/probe.csr

# 4. Shred the scratch copy
shred -u /tmp/restore.jks /tmp/probe.csr
```

Step 2 must print `37:BE:10:E9:…:BA:DE:E1:DF`. If it prints anything else, the
archive is not Identity B and the backup is wrong.

## 5. What this phase did NOT do

- Did not generate a new key.
- Did not replace any GitHub secret.
- Did not change the signing configuration.
- Did not publish a production release.
- Did not build an APK.

The consolidated release candidate is built only after the owner approves it
separately.

## 6. Owner actions

| # | Action | Why |
|---|---|---|
| 1 | Create the two encrypted offline copies | The secret alone is a single point of failure |
| 2 | Run the restoration check above once | Proves the backup works before it is needed |
| 3 | Keep the passphrase separate from the archives | Otherwise the encryption is decorative |
| 4 | Approve the release build when ready | No APK is published without it |
