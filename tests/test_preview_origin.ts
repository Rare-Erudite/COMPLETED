/**
 * Regression test for the preview-origin allowlist.
 *
 * The defect: every Vercel preview deployment got a fresh hostname that was not
 * in RARE_ALLOWED_ORIGINS, so the API rejected it with
 * "This origin is not allowed." — the preview deployed but could not create a
 * guest session, so it was unusable.
 *
 * These assertions pin the boundary in BOTH directions: this project's own
 * preview hostnames must be admitted, and every other project/team/host must
 * still be refused. A test that only proved the first half would let a
 * wildcard regression through.
 */
import assert from 'node:assert';

const PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/rareproject(?:-git-[a-z0-9][a-z0-9-]*)?(?:-[a-z0-9]+)?-mypremierai-2827\.vercel\.app$/;

function isPreviewDeploymentOrigin(origin: string, vercelEnv: string | undefined): boolean {
  if (vercelEnv !== 'preview') return false;
  return PREVIEW_ORIGIN_PATTERN.test(origin);
}

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${(e as Error).message}`);
  }
}

console.log('Preview origin allowlist');

// --- must be admitted on a preview deployment -------------------------------
const admitted = [
  'https://rareproject-17li6nh93-mypremierai-2827.vercel.app',
  'https://rareproject-gopceimd4-mypremierai-2827.vercel.app',
  'https://rareproject-git-stage2-infra-evidence-mypremierai-2827.vercel.app',
  'https://rareproject-git-new-fixes-by-erudite-mypremierai-2827.vercel.app',
  'https://rareproject-mypremierai-2827.vercel.app',
];
for (const o of admitted) {
  check(`admits ${o.replace('https://', '')}`, () => {
    assert.equal(isPreviewDeploymentOrigin(o, 'preview'), true);
  });
}

// --- must be refused --------------------------------------------------------
const refused = [
  // a different project on the same team
  'https://otherproject-abc123-mypremierai-2827.vercel.app',
  // the same project name on a different team
  'https://rareproject-abc123-someoneelse-9999.vercel.app',
  // a lookalike that merely starts with the project name
  'https://rareproject-evil.attacker.com',
  // a lookalike that merely ends with the team scope
  'https://evil-mypremierai-2827.vercel.app',
  // plain http
  'http://rareproject-17li6nh93-mypremierai-2827.vercel.app',
  // a path appended to an otherwise valid origin
  'https://rareproject-17li6nh93-mypremierai-2827.vercel.app/evil',
  // a subdomain trick
  'https://rareproject-17li6nh93-mypremierai-2827.vercel.app.evil.com',
  // an unrelated site
  'https://example.com',
];
for (const o of refused) {
  check(`refuses ${o.replace('https://', '').replace('http://', '')}`, () => {
    assert.equal(isPreviewDeploymentOrigin(o, 'preview'), false);
  });
}

// --- production must not gain preview origins -------------------------------
check('refuses preview hostname when VERCEL_ENV=production', () => {
  assert.equal(
    isPreviewDeploymentOrigin('https://rareproject-17li6nh93-mypremierai-2827.vercel.app', 'production'),
    false,
  );
});
check('refuses preview hostname when VERCEL_ENV is unset', () => {
  assert.equal(
    isPreviewDeploymentOrigin('https://rareproject-17li6nh93-mypremierai-2827.vercel.app', undefined),
    false,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
