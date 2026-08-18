import { Runner } from './helpers';
import { runAnalysisTests } from './analysis.test';
import { runRenderTests } from './render.test';
import { runPreviewTests, runUnitTests } from './units.test';

const runner = new Runner();

runUnitTests(runner);
runPreviewTests(runner);
runAnalysisTests(runner);
runRenderTests(runner);

process.exit(runner.report() ? 1 : 0);
