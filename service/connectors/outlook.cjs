const fs = require('node:fs');
const path = require('node:path');
const { runProcess } = require('../providers/process.cjs');
const { id } = require('../core/contracts.cjs');
async function outlookRequest(request, root, helper, signal) {
  if (process.platform !== 'win32')
    throw new Error(
      'Live ingestion requires Windows with classic Outlook. Demo mode works on this computer.',
    );
  const directory = path.join(root, 'jobs', id());
  fs.mkdirSync(directory, { recursive: true });
  const requestPath = path.join(directory, 'outlook-request.json');
  const responsePath = path.join(directory, 'outlook-response.json');
  fs.writeFileSync(requestPath, JSON.stringify(request));
  try {
    await runProcess(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-File',
        helper,
        '-RequestPath',
        requestPath,
        '-ResponsePath',
        responsePath,
      ],
      { cwd: directory, signal, timeout: 120000, limit: 200000 },
    );
    if (!fs.existsSync(responsePath) || fs.statSync(responsePath).size > 100 * 1024 * 1024)
      throw new Error('Outlook returned no valid response');
    const result = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
    if (!result.ok) throw new Error(result.error || 'Outlook request failed');
    return result;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
module.exports = { outlookRequest };
