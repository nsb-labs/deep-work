const { spawn } = require('node:child_process');
// Never build a shell command from mail, user text, executable paths, or WSL args.
function runProcess(
  command,
  args,
  {
    cwd,
    input = '',
    signal,
    timeout = 180000,
    limit = 8 * 1024 * 1024,
    env = process.env,
    onStop,
    stdoutEncoding = 'utf8',
    onStdout,
    onStart,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [],
      stderr = [];
    let bytes = 0,
      settled = false,
      stopping = '',
      killTimer,
      cleanupFailed = false,
      stopPromise;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(result);
    };
    const stop = (reason) => {
      if (stopping || settled) return;
      stopping = reason;
      killTimer = setTimeout(() => {
        const error = new Error(
          `${reason}. Could not confirm process termination; restart DeepWork before another job.`,
        );
        error.terminationUnconfirmed = true;
        finish(error);
      }, 20000);
      stopPromise = (async () => {
        try {
          await onStop?.();
        } catch {
          cleanupFailed = true;
        }
        if (settled) return;
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('error', () => child.kill());
        } else {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill();
          } catch {
            child.kill();
          }
        }
      })();
    };
    const cancel = () => {
      void stop('Cancelled');
    };
    let remaining = timeout,
      started = Date.now(),
      paused = false,
      timer;
    const arm = () => {
      started = Date.now();
      timer = setTimeout(
        () => {
          void stop(`Process timed out after ${timeout / 1000}s`);
        },
        Math.max(1, remaining),
      );
    };
    const setPaused = (value) => {
      if (settled || stopping || value === paused) return;
      paused = value;
      if (value) {
        remaining -= Date.now() - started;
        clearTimeout(timer);
      } else arm();
    };
    arm();
    signal?.addEventListener('abort', cancel, { once: true });
    child.on('error', (e) => finish(new Error(`Cannot launch ${command}: ${e.message}`)));
    child.stdin.on('error', () => {});
    const collect = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > limit) void stop('Process output exceeded limit');
      else target.push(chunk);
    };
    child.stdout.on('data', (chunk) => {
      collect(stdout, chunk);
      if (!stopping && !settled && onStdout) {
        try {
          onStdout(chunk);
        } catch (error) {
          void stop(
            error instanceof SyntaxError
              ? 'Malformed CLI streaming response'
              : error.message || 'Invalid provider stream',
          );
        }
      }
    });
    child.stderr.on('data', (chunk) => collect(stderr, chunk));
    child.on('close', async (code) => {
      if (stopPromise) await stopPromise;
      if (stopping) {
        const error = new Error(
          cleanupFailed
            ? `${stopping}. WSL cleanup could not be confirmed; restart DeepWork.`
            : stopping,
        );
        error.terminationUnconfirmed = cleanupFailed;
        return finish(error);
      }
      code === 0
        ? finish(null, {
            stdout: Buffer.concat(stdout).toString(stdoutEncoding),
            stderr: Buffer.concat(stderr).toString('utf8'),
          })
        : finish(
            new Error(
              `Process exited with code ${code ?? 'unknown'}. Check CLI authentication, configuration, or Outlook policy. Raw process logs are not saved.`,
            ),
          );
    });
    try {
      if (onStart)
        onStart(
          (data) => child.stdin.write(data),
          () => child.stdin.end(),
          setPaused,
        );
      else child.stdin.end(input);
    } catch (error) {
      void stop(error.message || 'Provider initialization failed');
    }
  });
}
module.exports = { runProcess };
