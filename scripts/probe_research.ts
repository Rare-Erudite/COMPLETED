import { DeepResearchEngine } from '../src/server/services/DeepResearchEngine.js';
(async () => {
  const engine = new DeepResearchEngine();
  const report = await engine.research({
    question: 'What is the attention mechanism in transformer neural networks?',
    depth: 'standard',
    maxSources: 6,
  }, (p) => console.log('  [stage]', p.stage, '-', p.detail.slice(0, 90)));
  console.log('\n=== STATS ===', JSON.stringify(report.stats));
  console.log('providers:', report.providersUsed.join(', '));
  console.log('providerErrors:', report.providerErrors);
  console.log('sources:', report.sources.length, '| claims:', report.claims.length, '| corroborated:', report.claims.filter(c=>c.corroborated).length);
  console.log('unreadable:', report.unreadable.length);
  console.log('\n=== REPORT (first 1800 chars) ===\n' + report.report.slice(0, 1800));
})();
