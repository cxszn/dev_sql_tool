const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const renderer = path.join(root, 'src/renderer/index.html');
const apiReady = import(pathToFileURL(path.join(root, 'src/api.js')).href);

async function startDesktop() {
  await app.whenReady();
  const api = await apiReady;
  let win;
  let busy = false;
  const allowedOutput = new Set();
  const preferencePath = path.join(app.getPath('userData'), 'preferences.json');
  let preferences = {};
  try { preferences = JSON.parse(await fs.readFile(preferencePath, 'utf8')); } catch { /* 首次启动使用空目录。 */ }

  function handle(channel, callback) {
    ipcMain.handle(`studio:${channel}`, async (event, ...args) => {
      const sourceUrl = new URL(event.senderFrame?.url ?? 'about:blank');
      sourceUrl.hash = '';
      if (sourceUrl.href !== pathToFileURL(renderer).href) throw new Error('拒绝未知页面的调用。');
      return callback(...args);
    });
  }
  handle('info', () => ({ ...api.getInfo({ executable: process.execPath, packaged: true }), defaults: {
    ...api.getInfo().defaults,
    inputDir: typeof preferences.inputDir === 'string' ? preferences.inputDir : '',
    outputDir: typeof preferences.outputDir === 'string' ? preferences.outputDir : '',
    targetVersion: [16, 18].includes(preferences.targetVersion) ? preferences.targetVersion : 16,
  } }));
  handle('choose', async (kind) => {
    const result = await dialog.showOpenDialog(win, {
      title: kind === 'input' ? '选择 migrations 文件夹' : kind === 'reverse-output' ? '选择 PHP migration 输出文件夹' : kind === 'ide-sdk' ? '选择项目目录，导出 IDE 提示包' : '选择 SQL 输出文件夹',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (result.canceled) return null;
    if (['output', 'reverse-output'].includes(kind)) allowedOutput.add(path.resolve(result.filePaths[0]));
    return result.filePaths[0];
  });
  handle('choose-sql', async () => {
    const result = await dialog.showOpenDialog(win, { title: '选择 PostgreSQL SQL 文件', filters: [{ name: 'PostgreSQL SQL', extensions: ['sql'] }], properties: ['openFile', 'multiSelections', 'dontAddToRecent'] });
    return result.canceled ? null : result.filePaths;
  });
  for (const action of ['preview', 'convert', 'previewReverse', 'convertReverse']) {
    handle(action, async (options) => {
      if (busy) return { ok: false, files: [], diagnostics: [{ code: 'BUSY', message: '一个批次正在运行，请稍候。' }] };
      busy = true;
      try {
        const method = { preview: 'previewDirectory', convert: 'convertDirectory', previewReverse: 'previewReverse', convertReverse: 'convertReverse' }[action];
        const result = await api[method](options);
        if (result.ok) {
          allowedOutput.add(path.resolve(options.outputDir));
          if (action === 'preview' || action === 'convert') {
            preferences = { inputDir: options.inputDir, outputDir: options.outputDir, targetVersion: options.targetVersion };
            await fs.mkdir(path.dirname(preferencePath), { recursive: true });
            // 配置值只用于当前会话，不写到用户设置。
            await fs.writeFile(preferencePath, JSON.stringify(preferences), 'utf8').catch(() => {});
          }
        }
        return result;
      } finally { busy = false; }
    });
  }
  handle('template', (id) => api.getTemplate(id));
  handle('export-ide-sdk', async (options) => {
    if (busy) throw new Error('一个操作正在运行，请稍候。');
    busy = true;
    try {
      const result = await api.exportIdeSdk({ outputDir: options?.outputDir, inputDir: options?.inputDir || preferences.inputDir || undefined });
      if (result.ok) allowedOutput.add(path.resolve(result.path));
      return result;
    } finally { busy = false; }
  });
  handle('copy-text', (text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('复制内容必须为不超过 32 MiB 的文本。');
    clipboard.writeText(text);
  });
  handle('save-template', async ({ id, tableName }) => {
    const result = await dialog.showSaveDialog(win, {
      title: '另存为新的 PHP 迁移', defaultPath: `${new Date().toISOString().slice(0, 10).replaceAll('-', '_')}_000001_create_${tableName ?? 'demo'}_table.php`,
      filters: [{ name: 'PHP migration', extensions: ['php'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation', 'dontAddToRecent'],
    });
    if (result.canceled) return null;
    return api.writeTemplate({ id, outputPath: result.filePath, tableName });
  });
  handle('open-output', async (directory) => {
    if (typeof directory !== 'string' || !allowedOutput.has(path.resolve(directory))) throw new Error('请先选择或转换此输出目录。');
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new Error('输出路径不是目录。');
    const error = await shell.openPath(path.resolve(directory));
    if (error) throw new Error(error);
  });

  function createWindow() {
    win = new BrowserWindow({
      width: 1380, height: 920, minWidth: 1060, minHeight: 720,
      title: 'Migration SQL Studio', backgroundColor: '#f5f7fa', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== pathToFileURL(renderer).href) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    win.loadFile(renderer);
  }
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('window-all-closed', () => app.quit());
}

if (process.argv.includes('--mcp')) {
  import(pathToFileURL(path.join(root, 'src/mcp.js')).href).then(({ startMcp }) => startMcp()).catch((error) => {
    process.stderr.write(error.message + '\n'); app.exit(1);
  });
} else {
  startDesktop().catch((error) => { dialog.showErrorBox('启动失败', error.message); app.exit(1); });
}
