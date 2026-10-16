import { runModelProviderTests } from './test_model_providers.js';
import { runToolTests } from './test_tools.js';
import { runMemoryTests } from './test_memory.js';
import { runDevelopmentTests } from './test_development.js';
import { runEvaluationTests } from './test_evaluation.js';
import { runApiConfigurationTests } from './test_api_configuration.js';
import { runRareIntelligenceBridgeTests } from './test_rare_intelligence_bridge.js';
import { runStandaloneBrainTests } from './test_standalone_brain.js';
import { runAuthenticationSecurityTests } from './test_authentication_security.js';
import { runPersistentWorkflowTests } from './test_persistent_workflows.js';

async function main() {
  console.log('=====================================================');
  console.log('  RARE CORE INTELLIGENCE — AUTOMATED VERIFICATION SUITE');
  console.log('=====================================================\n');

  try {
    await runApiConfigurationTests();
    console.log();
    await runAuthenticationSecurityTests();
    console.log();
    await runPersistentWorkflowTests();
    console.log();
    await runModelProviderTests();
    console.log();
    await runRareIntelligenceBridgeTests();
    console.log();
    await runStandaloneBrainTests();
    console.log();
    await runToolTests();
    console.log();
    await runMemoryTests();
    console.log();
    await runDevelopmentTests();
    console.log();
    await runEvaluationTests();
    console.log();
    console.log('=====================================================');
    console.log('  ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY');
    console.log('=====================================================');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Test suite failed with error:', err);
    process.exit(1);
  }
}

main();
