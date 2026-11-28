# Android Signing Identity B

RARE's Android release is signed with **signing identity B**, a replacement
identity distinct from the earlier RARE release key. This document records how
it is created, used, verified and backed up, so the identity is never lost.

## Why a replacement identity

Android refuses to install an update signed by a different key than the
installed app. The signing key is therefore a long-lived secret. Identity B was
introduced deliberately as a clean, documented identity; an install signed by
the *old* key cannot update in place and must be uninstalled first (the release
notes say so).

## Identity facts

| Field | Value |
|---|---|
| Alias | `rare-identity-b` |
| Key algorithm | RSA 4096 |
| Certificate validity | 10,000 days (to 2054-04-15) |
| Distinguished name | `CN=RARE Release Identity B, OU=Android, O=RARE, L=Lagos, ST=Lagos, C=NG` |
| SHA-256 fingerprint | `9A:0A:C0:ED:15:D6:21:0B:2D:91:55:3B:85:C7:C4:08:86:92:5C:CB:4E:44:78:22:7B:B7:1B:22:CC:E4:88:3D` |
| Keystore (local) | `.rare/android/rare-release-b.keystore` (gitignored) |

The fingerprint is pinned in `.github/workflows/release-apk.yml`: the release
build fails if the configured key does not match it, so a wrong or rotated key
can never silently ship.

## Creating the identity (once)

```bash
export RARE_ANDROID_STORE_PASS="$(openssl rand -base64 24)"
export RARE_ANDROID_KEY_PASS="$RARE_ANDROID_STORE_PASS"
./scripts/signing_identity_b.sh generate
```

`generate` refuses to overwrite an existing keystore — an identity is created
once and reused forever.

## Verifying

```bash
export RARE_ANDROID_STORE_PASS="…"
./scripts/signing_identity_b.sh verify
```

Prints the alias, owner, validity and SHA-256 fingerprint. The fingerprint must
equal the value pinned in the release workflow.

## CI secrets

The release workflow reads four GitHub Actions secrets. Set them from the
identity with:

```bash
./scripts/signing_identity_b.sh export
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | `$RARE_ANDROID_STORE_PASS` |
| `ANDROID_KEY_ALIAS` | `rare-identity-b` |
| `ANDROID_KEY_PASSWORD` | `$RARE_ANDROID_KEY_PASS` |

## Backup procedure (do all of these)

The identity is unrecoverable if the keystore and its password are both lost.
To prevent that:

1. **Encrypted backup bundle.** Run
   ```bash
   ./scripts/signing_identity_b.sh backup
   ```
   This writes an AES-256 encrypted `.tar.gz.enc` of the keystore, encrypted
   with the store password. Store it in **at least two offline locations**
   (e.g. an encrypted USB drive and a password-manager attachment).
2. **Password separately.** Store `RARE_ANDROID_STORE_PASS` in a password
   manager, in a different place from the backup bundle. The bundle is useless
   without it, and the password is useless without the bundle — keeping them
   apart is the point.
3. **CI copy.** The four GitHub Actions secrets are the CI copy. They are
   encrypted at rest by GitHub and never printed in logs.
4. **Record the fingerprint.** The SHA-256 fingerprint above is in this file and
   in the release notes, so a restored key can be checked against it.

### Restoring from a backup

```bash
export RARE_ANDROID_STORE_PASS="…"
openssl enc -d -aes-256-cbc -pbkdf2 -pass:env RARE_ANDROID_STORE_PASS \
  -in rare-identity-b-backup-YYYYMMDD.tar.gz.enc | tar -xzf - -C .rare/android/
./scripts/signing_identity_b.sh verify   # fingerprint must match
```

## What the build does

`scripts/build_apk.sh` reads the keystore from `RARE_ANDROID_KEYSTORE` (default
`.rare/android/rare-release.keystore`) and the passwords from
`RARE_ANDROID_STORE_PASS` / `RARE_ANDROID_KEY_PASS`. It **fails** rather than
silently generating a new identity when the keystore is missing. The release
workflow restores the keystore from the base64 secret into a temp path, verifies
the fingerprint, signs, and then verifies the produced APK's certificate again.
