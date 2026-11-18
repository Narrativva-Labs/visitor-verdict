// Opt-in test benchmark only. Never loaded by the production detector.
import {load} from '/vendor/botd.js';
export async function benchmarkBotD() {
  try {
    const agent = await load({monitoring: false});
    const result = agent.detect();
    return {status: 'OK', bot: result.bot, botKind: result.botKind || null};
  } catch (error) { return {status: 'ERROR', error: String(error)}; }
}
