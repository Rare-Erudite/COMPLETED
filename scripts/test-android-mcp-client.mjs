import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const OWNER = process.env.OWNER;
const transport = new StdioClientTransport({
  command: 'node',
  args: ['scripts/android-mcp-server.mjs'],
  env: {
    ...process.env,
    RARE_ANDROID_MCP_OWNER: OWNER,
    RARE_ANDROID_MCP_TOKEN: process.env.RARE_TOKEN || '',
    RARE_API_BASE: 'http://localhost:5099',
    RARE_ANDROID_MCP_TIMEOUT_MS: '25000',
  },
});
const client = new Client({ name: 'rare-test-client', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
console.log('HANDSHAKE: connected');

const tools = await client.listTools();
console.log(`TOOLS: ${tools.tools.length} discovered`);
for (const t of tools.tools) console.log(`  - ${t.name}`);

console.log('\n--- call android_device_status ---');
let r = await client.callTool({ name: 'android_device_status', arguments: {} });
console.log('isError:', r.isError === true);
console.log(r.content[0].text.slice(0, 300));

console.log('\n--- call android_notifications (device online) ---');
r = await client.callTool({ name: 'android_notifications', arguments: { limit: 10 } });
console.log('isError:', r.isError === true);
console.log(r.content[0].text.slice(0, 500));

console.log('\n--- call android_tap_text (real device action) ---');
r = await client.callTool({ name: 'android_tap_text', arguments: { text: 'Send' } });
console.log('isError:', r.isError === true);
console.log(r.content[0].text.slice(0, 300));

console.log('\n--- invalid args rejected ---');
r = await client.callTool({ name: 'android_tap_text', arguments: {} });
console.log('isError:', r.isError === true, '|', r.content[0].text.slice(0, 120));

console.log('\n--- unknown tool rejected ---');
r = await client.callTool({ name: 'android_nope', arguments: {} });
console.log('isError:', r.isError === true, '|', r.content[0].text.slice(0, 100));

await client.close();
