#!/bin/bash
#
# RARE — Android signing identity B: generate / load / verify / back up
#
# Why this exists
# ---------------
# Android refuses to install an update signed by a different key than the
# installed app. The signing identity is therefore a long-lived secret that
# must be created once, stored safely, and reused for every release. This
# script makes that explicit and repeatable:
#
#   ./scripts/signing_identity_b.sh generate   # create identity B (once)
#   ./scripts/signing_identity_b.sh verify     # print the certificate fingerprint
#   ./scripts/signing_identity_b.sh export     # write a base64 blob for CI secrets
#   ./scripts/signing_identity_b.sh backup     # write an encrypted backup bundle
#
# Identity B is a *replacement* identity: it is distinct from the earlier RARE
# release key, so an install signed by the old key cannot update in place. The
# release notes must say so (they do — see release-apk.yml).
#
# Storage
# -------
#   keystore:  .rare/android/rare-release-b.keystore   (gitignored)
#   alias:     rare-identity-b
#   passwords: RARE_ANDROID_STORE_PASS / RARE_ANDROID_KEY_PASS (env only)
#
# The keystore and its passwords are NEVER committed. CI reads them from
# GitHub Actions secrets (ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD,
# ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD).
#
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYSTORE="${RARE_ANDROID_KEYSTORE:-$PROJECT_ROOT/.rare/android/rare-release-b.keystore}"
ALIAS="${RARE_ANDROID_KEY_ALIAS:-rare-identity-b}"
STORE_PASS="${RARE_ANDROID_STORE_PASS:-}"
KEY_PASS="${RARE_ANDROID_KEY_PASS:-$STORE_PASS}"
VALIDITY_DAYS="${RARE_KEY_VALIDITY_DAYS:-10000}"   # ~27 years
KEY_SIZE="${RARE_KEY_SIZE:-4096}"
DNAME="${RARE_KEY_DNAME:-CN=RARE Release Identity B, OU=Android, O=RARE, L=Lagos, ST=Lagos, C=NG}"

require_pass() {
  if [ -z "$STORE_PASS" ]; then
    echo "ERROR: RARE_ANDROID_STORE_PASS is not set." >&2
    echo "       Export it (and optionally RARE_ANDROID_KEY_PASS) before running." >&2
    exit 1
  fi
}

cmd_generate() {
  require_pass
  if [ -f "$KEYSTORE" ]; then
    echo "Keystore already exists at $KEYSTORE — refusing to overwrite an identity." >&2
    echo "Use 'verify' to inspect it, or move it aside deliberately to create a new one." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$KEYSTORE")"
  chmod 700 "$(dirname "$KEYSTORE")"
  echo "Generating RSA-$KEY_SIZE signing identity B (alias: $ALIAS)…"
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -alias "$ALIAS" \
    -keyalg RSA \
    -keysize "$KEY_SIZE" \
    -validity "$VALIDITY_DAYS" \
    -dname "$DNAME" \
    -storepass:env RARE_ANDROID_STORE_PASS \
    -keypass:env RARE_ANDROID_KEY_PASS
  chmod 600 "$KEYSTORE"
  echo "Created $KEYSTORE"
  cmd_verify
}

cmd_verify() {
  require_pass
  if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: no keystore at $KEYSTORE" >&2
    exit 1
  fi
  echo "Keystore: $KEYSTORE"
  echo "Alias:    $ALIAS"
  # SHA-256 fingerprint, the value CI pins.
  keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" \
    -storepass:env RARE_ANDROID_STORE_PASS 2>/dev/null \
    | grep -E "SHA256:|Valid from:|Owner:|Alias name:" || true
}

cmd_export() {
  require_pass
  if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: no keystore at $KEYSTORE" >&2
    exit 1
  fi
  echo "Base64 keystore (paste into the ANDROID_KEYSTORE_BASE64 secret):"
  echo "-----------------------------------------------------------------"
  base64 -w0 "$KEYSTORE"
  echo
  echo "-----------------------------------------------------------------"
  echo "Also set:"
  echo "  ANDROID_KEYSTORE_PASSWORD = \$RARE_ANDROID_STORE_PASS"
  echo "  ANDROID_KEY_ALIAS         = $ALIAS"
  echo "  ANDROID_KEY_PASSWORD      = \$RARE_ANDROID_KEY_PASS"
}

cmd_backup() {
  require_pass
  if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: no keystore at $KEYSTORE" >&2
    exit 1
  fi
  local out="${1:-$PROJECT_ROOT/.rare/android/rare-identity-b-backup-$(date -u +%Y%m%d).tar.gz.enc}"
  mkdir -p "$(dirname "$out")"
  # Encrypt the bundle with the store password so the backup is useless without
  # it. The password itself must be stored separately (a password manager).
  tar -czf - -C "$(dirname "$KEYSTORE")" "$(basename "$KEYSTORE")" \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -pass:env RARE_ANDROID_STORE_PASS -out "$out"
  chmod 600 "$out"
  echo "Encrypted backup written to: $out"
  echo "Restore with:"
  echo "  openssl enc -d -aes-256-cbc -pbkdf2 -pass:env RARE_ANDROID_STORE_PASS -in '$out' | tar -xzf - -C .rare/android/"
  echo
  echo "BACKUP PROCEDURE (do all of these):"
  echo "  1. Store this encrypted file in at least two offline locations."
  echo "  2. Store RARE_ANDROID_STORE_PASS in a password manager, separately."
  echo "  3. Keep the GitHub Actions secrets as the CI copy."
  echo "  4. Record the SHA-256 fingerprint from 'verify' in the release notes."
}

case "${1:-}" in
  generate) cmd_generate ;;
  verify)   cmd_verify ;;
  export)   cmd_export ;;
  backup)   shift; cmd_backup "${1:-}" ;;
  *)
    echo "Usage: $0 {generate|verify|export|backup [outfile]}" >&2
    exit 2
    ;;
esac
