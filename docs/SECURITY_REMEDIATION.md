# RARE Security Remediation — the leaked credential blob

## The incident

`.rare/state/persistent-documents.json` — the file-backed store holding every
user account and password hash — was committed to this **public** repository. It
was untracked in a previous pass, but untracking does not undo the leak: the
blob is still present in git history and remains downloadable by anyone who
clones the repository.

Verified in this pass:

```
$ git rev-list --objects --all | grep -c persistent-documents
6
$ git rev-list --objects --all | grep persistent-documents | head -3
583105f61040d2d2f38a4f349c0bd412f8a7aedf .rare/state/persistent-documents.json
4e9d768552bdce30c8ad68f732de6000241d0658 .rare/state/persistent-documents.json
37f27a9853d6c724b37faa9a61aba47f6513a1a0 .rare/state/persistent-documents.json
```

The blob is 685,357 bytes and contains 18 accounts (17 with a `passwordHash`)
plus 32 sessions.

## What was done in this pass (no history rewrite)

`scripts/rotate_leaked_credentials.mjs` was run for real. It:

1. **Invalidated every stored password hash** — set to `NULL` — so a leaked hash
   can never authenticate. This was done in both stores:
   - the file store: 17 hashes cleared, 32 sessions cleared;
   - Postgres (`rare_users` / `rare_sessions`): **339 hashes cleared, 454
     sessions deleted**.
2. **Deleted every session row**, so any session token derived from the leaked
   state is dead.
3. **Wrote a machine-readable report** to
   `documents/rare-complete/credential-rotation-report.json`.

The guard test `tests/test_repo_hygiene.ts` fails the moment the blob or any
checkpoint is tracked again, so the exposure cannot silently return.

## What was NOT done, and why

**The blob was not purged from git history.** Purging requires rewriting every
commit that touched the file and then **force-pushing** to a public repository.
The task explicitly forbids force-pushing, and a history rewrite on a public
repo is a destructive, owner-controlled action: it invalidates every clone and
fork, and it cannot be undone. It is therefore left as an explicit, documented
step for the owner.

### The exact command, when the owner decides to run it

```bash
# 1. Install git-filter-repo (https://github.com/newren/git-filter-repo)
pip install git-filter-repo

# 2. Work on a fresh clone, never the only copy
git clone https://github.com/Rare-Erudite/COMPLETED.git rare-purge
cd rare-purge

# 3. Remove the blob from every commit
git filter-repo --path .rare/state/persistent-documents.json --invert-paths

# 4. Force-push every branch and tag
git push --force --all
git push --force --tags
```

After the force-push, every collaborator must re-clone. GitHub's cached views of
the old commits may persist for a while; the owner can ask GitHub Support to
garbage-collect them.

## Residual risk

Even after the hashes are cleared, the **email addresses and account names** in
the blob remain in history. They are personal data. The purge above removes them
too; until it is run, they remain public. This is stated plainly rather than
glossed over.
