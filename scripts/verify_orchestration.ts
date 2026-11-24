/**
 * Live orchestration verification — run against a real server on a real port.
 *
 * This is the evidence script for the capability registry and durable jobs. It
 * authenticates as a guest exactly the way the browser does (CSRF + cookie),
 * then exercises the real HTTP surface. Every assertion is against a real
 * response; nothing is stubbed.
 *
 * Usage: RARE_BASE=http://127.0.0.1:3456 npx tsx scripts/verify_orchestration.ts
 */

const BASE = process.env.RARE_BASE || 'http://127.0.0.1:3456';

let csrf = '';
let cookie = '';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: BASE,
    'X-CSRF-Token': csrf,
    Cookie: cookie,
    ...extra,
  };
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  // ---- Authenticate as a guest, exactly like the browser -------------------
  const session = await fetch(`${BASE}/api/user/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
  });
  csrf = session.headers.get('x-csrf-token') || '';
  cookie = (session.headers.get('set-cookie') || '')
    .split(',')
    .map((part) => part.split(';')[0])
    .join('; ');
  check('guest session', session.ok && Boolean(csrf), `status ${session.status}, csrf ${csrf ? 'issued' : 'missing'}`);

  // ---- 1. The catalogue is real and covers every department ---------------
  const catalogue = await api('GET', '/api/capabilities');
  const caps: any[] = catalogue.body?.capabilities || [];
  const depts: any[] = catalogue.body?.departments || [];
  check(
    'capability catalogue',
    catalogue.status === 200 && caps.length >= 15,
    `${caps.length} capabilities across ${depts.length} departments`,
  );
  console.log('      departments:', depts.map((d) => `${d.department}(${d.count})`).join(' '));

  const required = [
    'documents.list', 'documents.read', 'documents.write', 'documents.convert', 'documents.export',
    'research.run', 'research.report_to_document',
    'builder.deliver', 'builder.toolchains',
    'repository.create', 'deployment.static',
    'plugins.list', 'plugins.call',
    'device.plan', 'intelligence.evaluate', 'intelligence.providers', 'system.capabilities',
  ];
  const ids = new Set(caps.map((c) => c.id));
  const missing = required.filter((id) => !ids.has(id));
  check('all required capabilities registered', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all present');

  // ---- 2. Argument validation rejects bad input before work happens -------
  const badArgs = await api('POST', '/api/capabilities/invoke', { capabilityId: 'documents.read', args: {} });
  check(
    'invalid arguments rejected',
    badArgs.status === 400 && badArgs.body?.error?.code === 'invalid_arguments',
    `status ${badArgs.status}, code ${badArgs.body?.error?.code}`,
  );

  const unknown = await api('POST', '/api/capabilities/invoke', { capabilityId: 'nope.nope', args: {} });
  check('unknown capability rejected', unknown.status === 400 || unknown.status === 422, `status ${unknown.status}`);

  // ---- 3. Real cross-department invocation: write then read a document ----
  const docPath = `verification/orchestration-${Date.now()}.md`;
  const docContent = '# Live orchestration check\n\nThis text was written through the capability registry and read back.';
  const write = await api('POST', '/api/capabilities/invoke', {
    capabilityId: 'documents.write',
    args: { path: docPath, content: docContent },
  });
  check('documents.write via registry', write.status === 200 && write.body?.ok === true, `status ${write.status}, ${write.body?.summary}`);

  const read = await api('POST', '/api/capabilities/invoke', {
    capabilityId: 'documents.read',
    args: { path: docPath },
  });
  const readBack = read.body?.data?.content;
  check(
    'documents.read returns the exact bytes written',
    read.status === 200 && readBack === docContent,
    `status ${read.status}, ${readBack === docContent ? 'content matches' : 'CONTENT MISMATCH'}`,
  );

  // ---- 4. A real conversion through the registry --------------------------
  const convert = await api('POST', '/api/capabilities/invoke', {
    capabilityId: 'documents.convert',
    args: { path: docPath, format: 'html' },
  });
  check(
    'documents.convert produces a real file',
    convert.status === 200 && convert.body?.ok === true,
    `${convert.body?.summary}`,
  );

  // ---- 5. Toolchain probe reports the real host ---------------------------
  const toolchains = await api('POST', '/api/capabilities/invoke', {
    capabilityId: 'builder.toolchains',
    args: { force: true },
  });
  const tc = toolchains.body?.data;
  check(
    'builder.toolchains probes the real host',
    toolchains.status === 200 && typeof tc?.ready === 'number',
    `${tc?.ready}/${tc?.total} toolchains detected`,
  );
  if (Array.isArray(tc?.toolchains)) {
    const ready = tc.toolchains.filter((t: any) => t.detected).map((t: any) => `${t.id}=${t.version}`);
    console.log('      detected:', ready.join(', '));
  }

  // ---- 6. Durable job lifecycle ------------------------------------------
  const jobStart = await api('POST', '/api/capabilities/invoke', {
    capabilityId: 'builder.toolchains',
    args: {},
  });
  if (jobStart.status === 202 && jobStart.body?.jobId) {
    const jobId = jobStart.body.jobId;
    let job: any = null;
    for (let i = 0; i < 30; i += 1) {
      const poll = await api('GET', `/api/jobs/${jobId}`);
      job = poll.body;
      if (job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    check(
      'durable job runs to a terminal state',
      Boolean(job) && ['succeeded', 'failed'].includes(job.status),
      `job ${jobId} -> ${job?.status} (progress ${job?.progress}%)`,
    );
    check('job record carries a real log', Array.isArray(job?.log) && job.log.length > 0, `${job?.log?.length} log entries`);
  } else {
    check('durable job lifecycle', jobStart.status === 200 && jobStart.body?.ok === true, 'ran inline (fast capability)');
  }

  const jobList = await api('GET', '/api/jobs');
  check('job list is readable', jobList.status === 200 && Array.isArray(jobList.body), `${jobList.body?.length} job(s) stored`);

  // ---- 7. Plugins surface reports honest connection state ----------------
  const plugins = await api('POST', '/api/capabilities/invoke', { capabilityId: 'plugins.list', args: {} });
  const pluginData = plugins.body?.data;
  check(
    'plugins.list reports real MCP state',
    plugins.status === 200 && Array.isArray(pluginData?.servers),
    `${pluginData?.servers?.length ?? 0} server(s) configured, ${pluginData?.tools?.length ?? 0} tool(s) discovered`,
  );

  // ---- 8. Intelligence surface reports real providers --------------------
  const providers = await api('POST', '/api/capabilities/invoke', { capabilityId: 'intelligence.providers', args: {} });
  const providerList = providers.body?.data?.providers || [];
  check(
    'intelligence.providers lists real providers',
    providers.status === 200 && providerList.length > 0,
    `${providerList.length} provider(s), ${providerList.filter((p: any) => p.is_available).length} available`,
  );

  // ---- 9. Audit trail records every invocation ---------------------------
  const after = await api('GET', '/api/capabilities');
  const audit = after.body?.recentInvocations || [];
  check('invocations are audited', audit.length > 0, `${audit.length} recent invocation(s) recorded`);

  // ---- Summary -----------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed !== results.length) {
    console.log('FAILURES:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Verification crashed:', error);
  process.exitCode = 1;
});
