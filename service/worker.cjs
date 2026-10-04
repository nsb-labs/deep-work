const { WorkEngine } = require('./core/engine.cjs');
// Electron utilityProcess uses parentPort; Node fork is available for smoke tests.
const send = (message) =>
  process.parentPort ? process.parentPort.postMessage(message) : process.send?.(message);
let engine;
(async () => {
  engine = await WorkEngine.open(process.argv[2], {
    outlookHelper: process.argv[3],
    onChatEvent: (event) => send({ chatEvent: event }),
  });
  const handle = async (request) => {
    try {
      if (!request || typeof request.id !== 'number' || typeof request.operation !== 'string')
        throw new Error('Invalid request');
      if (request.operation === 'shutdown') {
        engine.close();
        while (engine.busy || engine.syncBusy)
          await new Promise((resolve) => setTimeout(resolve, 50));
        engine.store.close();
        send({ id: request.id, result: { closed: true } });
        setImmediate(() => process.exit(0));
        return;
      }
      const result = await engine.dispatch(request.operation, request.value);
      send({ id: request.id, result });
    } catch (error) {
      send({ id: request?.id, error: String(error.message || error) });
    }
  };
  if (process.parentPort) process.parentPort.on('message', (event) => handle(event.data));
  else process.on('message', handle);
  send({ ready: true });
})().catch(() => {
  send({
    fatal: 'Workspace service could not start. Check database integrity and folder permissions.',
  });
  process.exitCode = 1;
});
process.on('SIGTERM', () => {
  engine?.close();
  process.exit(0);
});
