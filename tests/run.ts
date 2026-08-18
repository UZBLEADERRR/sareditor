import { Runner } from './helpers';
import { runAgentTests } from './agent.test';
import { runAnalysisTests } from './analysis.test';
import { runRenderTests } from './render.test';
import { runPreviewTests, runUnitTests } from './units.test';

async function main(): Promise<void> {
  const runner = new Runner();

  runUnitTests(runner);
  await runAgentTests(runner);
  runPreviewTests(runner);
  runAnalysisTests(runner);
  runRenderTests(runner);

  process.exit(runner.report() ? 1 : 0);
}

void main();
