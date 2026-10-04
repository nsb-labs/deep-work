import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;
let worker: UtilityProcess | null = null;
let workspace = '';
let sequence = 0;
let ready: Promise<void>;
const pending = new Map<
  number,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const devUrl = process.env.VITE_DEV_SERVER_URL;

function rejectPending(message: string) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
  pending.clear();
}
function startWorker(root: string): Promise<void> {
  workspace = root;
  const helper = app.isPackaged
    ? path.join(process.resourcesPath, 'outlook.ps1')
    : path.join(app.getAppPath(), 'service/connectors/outlook.ps1');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Workspace service startup timed out')), 30000);
    worker = utilityProcess.fork(
      path.join(app.getAppPath(), 'service/worker.cjs'),
      [root, helper],
      { serviceName: 'DeepWork workspace' },
    );
    worker.on('message', (message) => {
      if (message.chatEvent) {
        mainWindow?.webContents.send('work:chatEvent', message.chatEvent);
        return;
      }
      if (message.ready) {
        clearTimeout(timer);
        resolve();
        return;
      }
      if (message.fatal) {
        clearTimeout(timer);
        reject(new Error(message.fatal));
        rejectPending(message.fatal);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
    });
    worker.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('Workspace service stopped'));
      rejectPending('Workspace service stopped. Restart DeepWork.');
      worker = null;
    });
    // Avoid echoing provider output or private data to logs.
    worker.stdout?.on('data', () => {});
    worker.stderr?.on('data', () => {});
  });
}
async function request(operation: string, value?: unknown) {
  await ready;
  if (!worker) throw new Error('Workspace service unavailable');
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Workspace request timed out'));
    }, 150000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, operation, value });
  });
}
function validateSender(event: Electron.IpcMainInvokeEvent) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  )
    throw new Error('Unauthorized IPC sender');
}
const operations = new Set([
  'snapshot',
  'settings',
  'theme',
  'addTask',
  'editTask',
  'status',
  'readTask',
  'readMessage',
  'sync',
  'processPending',
  'summarize',
  'draft',
  'chat',
  'cancel',
  'retry',
  'permission',
  'dismissAttention',
  'suggestion',
  'fact',
  'openSource',
  'probe',
  'discoverCli',
  'folders',
  'export',
]);
ipcMain.handle('work:request', (event, operation: string, value?: unknown) => {
  validateSender(event);
  if (!operations.has(operation) || Buffer.byteLength(JSON.stringify(value ?? null)) > 100000)
    throw new Error('Invalid workspace operation');
  return request(operation, value);
});
ipcMain.handle('work:openWorkspace', async (event) => {
  validateSender(event);
  await ready;
  if (process.env.DEEPWORK_WORKSPACE)
    throw new Error(
      'DEEPWORK_WORKSPACE selects this development workspace. Remove that environment variable before choosing a different folder.',
    );
  const active = (await request('snapshot')) as { jobs: { status: string }[] };
  if (active.jobs.some((j) => ['running', 'queued', 'awaiting_approval'].includes(j.status)))
    throw new Error('Wait for jobs to finish or cancel them before switching workspaces.');
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose a DeepWork workspace',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return null;
  // Restart instead of racing requests against a different workspace process.
  fs.writeFileSync(
    path.join(app.getPath('userData'), 'workspace.json'),
    JSON.stringify({ path: result.filePaths[0] }),
  );
  app.relaunch();
  app.quit();
  return result.filePaths[0];
});
ipcMain.handle('work:workspacePath', (event) => {
  validateSender(event);
  return workspace;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 950,
    minWidth: 960,
    minHeight: 650,
    title: 'DeepWork',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#101827',
    show: false,
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const policy = devUrl
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data:; object-src 'none'; base-uri 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'";
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    });
  });
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    let selected = '';
    try {
      selected = JSON.parse(
        fs.readFileSync(path.join(app.getPath('userData'), 'workspace.json'), 'utf8'),
      ).path;
    } catch {}
    const root = path.resolve(
      process.env.DEEPWORK_WORKSPACE || selected || path.join(app.getPath('userData'), 'workspace'),
    );
    ready = startWorker(root);
    ready.catch(() => {});
    createWindow();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'File', submenu: [{ role: 'quit' }] },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'toggleDevTools' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
          ],
        },
      ]),
    );
  });
}
app.on('window-all-closed', () => app.quit());
let shuttingDown = false;
app.on('before-quit', (event) => {
  if (shuttingDown || !worker) return;
  event.preventDefault();
  shuttingDown = true;
  const timer = setTimeout(() => {
    worker?.kill();
    app.quit();
  }, 25000);
  request('shutdown')
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      rejectPending('Application closing');
      app.quit();
    });
});
