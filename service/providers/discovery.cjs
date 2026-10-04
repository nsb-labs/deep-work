// Discovery is independent of inference: it never supplies email or changes saved preferences.
const fs = require('node:fs');
const path = require('node:path');
const { runProcess } = require('./process.cjs');
const PROVIDERS = { codex: 'codex', kiro: 'kiro-cli' };
const WSL_DISCOVERY = `for name in codex kiro-cli; do
  executable=$(command -v "$name" 2>/dev/null || true)
  if [ ! -f "$executable" ]; then
    executable=""
    for directory in "$HOME/.local/bin" "$HOME/.cargo/bin" "$HOME/bin"; do
      if [ -f "$directory/$name" ] && [ -x "$directory/$name" ]; then executable="$directory/$name"; break; fi
    done
  fi
  case "$executable" in /*) printf '%s\\t%s\\n' "$name" "$executable" ;; esac
done`;
function nativeCandidates({ platform, env, isFile, readdir }) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const home = windows ? env.USERPROFILE : env.HOME;
  const dirs = (env.PATH || env.Path || '')
    .split(windows ? ';' : ':')
    .map((d) => d.replace(/^"|"$/g, ''))
    .filter((d) => paths.isAbsolute(d));
  if (home)
    dirs.push(
      paths.join(home, '.local', 'bin'),
      paths.join(home, '.cargo', 'bin'),
      paths.join(home, 'bin'),
    );
  if (windows && env.APPDATA) dirs.push(paths.join(env.APPDATA, 'npm'));
  const results = [];
  const add = (provider, executable) => {
    if (
      isFile(executable) &&
      !results.some((r) => r.executable.toLowerCase() === executable.toLowerCase())
    )
      results.push({ provider, executable, execution: 'native', wslDistribution: '' });
  };
  for (const dir of [...new Set(dirs)].slice(0, 128)) {
    for (const [provider, name] of Object.entries(PROVIDERS))
      add(provider, paths.join(dir, name + (windows ? '.exe' : '')));
    if (!windows) continue;
    // npm exposes a .cmd launcher. Locate the native binary in both npm package layouts.
    const scopes = [
      paths.join(dir, 'node_modules', '@openai'),
      paths.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai'),
    ];
    for (const scope of scopes) {
      for (const pkg of [
        'codex',
        ...readdir(scope).filter((name) => /^codex-win32-(x64|arm64)$/.test(name)),
      ]) {
        for (const target of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']) {
          const vendor = paths.join(scope, pkg, 'vendor', target);
          add('codex', paths.join(vendor, 'codex', 'codex.exe'));
          add('codex', paths.join(vendor, 'bin', 'codex.exe'));
        }
      }
    }
  }
  return results.slice(0, 16);
}
async function discoverCli(options = {}) {
  const platform = options.platform || process.platform;
  const run = options.run || runProcess;
  const diagnostics = [];
  const isFile =
    options.isFile ||
    ((file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    });
  const readdir =
    options.readdir ||
    ((dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    });
  const candidates = nativeCandidates({
    platform,
    env: options.env || process.env,
    isFile,
    readdir,
  });
  if (platform === 'win32') {
    try {
      const { stdout } = await run('wsl.exe', ['--list', '--quiet'], {
        timeout: 5000,
        limit: 100000,
        stdoutEncoding: 'utf16le',
      });
      // wsl.exe can emit UTF-16LE decoded by the process runner as UTF-8.
      const distributions = [
        ...new Set(
          stdout
            .replace(/\0/g, '')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      if (distributions.length > 8)
        diagnostics.push(
          'Only the first 8 WSL distributions were scanned. Others can be configured manually.',
        );
      await Promise.all(
        distributions.slice(0, 8).map(async (distribution) => {
          try {
            const result = await run(
              'wsl.exe',
              ['--distribution', distribution, '--exec', '/bin/sh', '-lc', WSL_DISCOVERY],
              { timeout: 5000, limit: 100000 },
            );
            for (const line of result.stdout.split(/\r?\n/)) {
              const [name, executable] = line.split('\t');
              const provider = Object.keys(PROVIDERS).find((key) => PROVIDERS[key] === name);
              if (
                provider &&
                executable?.startsWith('/') &&
                !/[\r\n\0]/.test(executable) &&
                candidates.length < 32 &&
                !candidates.some(
                  (c) =>
                    c.execution === 'wsl' &&
                    c.wslDistribution === distribution &&
                    c.executable === executable,
                )
              )
                candidates.push({
                  provider,
                  executable,
                  execution: 'wsl',
                  wslDistribution: distribution,
                });
            }
          } catch {
            diagnostics.push(
              `Could not scan WSL distribution: ${distribution}. Configure it manually or retry.`,
            );
          }
        }),
      );
    } catch {
      diagnostics.push('WSL is unavailable or did not respond. Native discovery still completed.');
    }
  }
  const installations = [];
  // Keep subprocess count bounded even when several installations are present.
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(
      candidates.slice(i, i + 4).map(async (candidate) => {
        try {
          const command = candidate.execution === 'wsl' ? 'wsl.exe' : candidate.executable;
          const args =
            candidate.execution === 'wsl'
              ? [
                  '--distribution',
                  candidate.wslDistribution,
                  '--exec',
                  candidate.executable,
                  '--version',
                ]
              : ['--version'];
          const result = await run(command, args, { timeout: 5000, limit: 100000 });
          const version = (result.stdout.trim() || result.stderr?.trim() || '').slice(0, 500);
          if (!version) throw new Error('No version');
          installations.push({ ...candidate, version });
        } catch {
          diagnostics.push(`Found ${candidate.executable}, but its version check failed.`);
        }
      }),
    );
  }
  installations.sort((a, b) =>
    `${a.provider}:${a.execution}:${a.wslDistribution}:${a.executable}`.localeCompare(
      `${b.provider}:${b.execution}:${b.wslDistribution}:${b.executable}`,
    ),
  );
  return {
    installations,
    diagnostics,
    note: 'Detection checks executable versions only. Select a CLI, confirm organization approval, then save settings.',
  };
}
module.exports = { discoverCli, nativeCandidates };
