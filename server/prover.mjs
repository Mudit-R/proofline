// A separate process keeps expensive witness/proof work off the HTTP event loop.
import { prove } from './crypto.mjs';
process.on('message', async (input) => {
  try {
    const result = await prove(input);
    process.send({ ok: true, result }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: error.message }, () => process.exit(1));
  }
});
