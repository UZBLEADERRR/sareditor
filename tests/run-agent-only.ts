import { Runner } from './helpers';
import { runAgentTests } from './agent.test';

async function main(): Promise<void> {
  const runner = new Runner();
  await runAgentTests(runner);
  process.exit(runner.report() ? 1 : 0);
}

void main();
