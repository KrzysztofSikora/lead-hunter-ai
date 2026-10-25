import { MockAgent, setGlobalDispatcher } from 'undici';
import { afterAll } from 'vitest';

// Every outbound request in a test must be mocked; an unmocked one fails (test-plan, isolation).
const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);

afterAll(async () => {
  await agent.close();
});
