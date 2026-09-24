import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, '.test-output', 'ide-lsp', new Date().toISOString().replaceAll(':', '-'));
const workspace = path.join(runDir, 'project');
let serverPath = process.argv[2];
if (!serverPath) {
  for (const editor of ['.vscode', '.cursor']) {
    const directory = path.join(os.homedir(), editor, 'extensions');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const matches = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('bmewburn.vscode-intelephense-client-')).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const entry of matches) {
      const candidate = path.join(directory, entry.name, 'node_modules', 'intelephense', 'lib', 'intelephense.js');
      if (await fs.stat(candidate).then((stat) => stat.isFile()).catch(() => false)) { serverPath = candidate; break; }
    }
    if (serverPath) break;
  }
}
if (!serverPath) throw new Error('未找到本机已安装的 Intelephense 语言服务；本验证不会安装插件或下载依赖。');
const serverPackage = JSON.parse(await fs.readFile(path.resolve(serverPath, '../../package.json'), 'utf8'));
await fs.mkdir(workspace, { recursive: true });
await fs.cp(path.join(root, 'php-sdk'), path.join(workspace, 'sql-studio-sdk'), { recursive: true, errorOnExist: true, force: false });
const template = await fs.readFile(path.join(root, 'templates', 'generic.php'), 'utf8');
const chain = "            $table->foreignId('owner_id')->nullable()->constrained('owners')->cascadeOnDelete();";
const source = template.replace('            $table->timestamps();', `            $table->timestamps();\n${chain}`);
if (source === template) throw new Error('通用模板未包含预期插入位置。');
const documentPath = path.join(workspace, 'generic.php');
await fs.writeFile(documentPath, source, 'utf8');
const uri = pathToFileURL(documentPath).href;
const report = { ok: false, server: { name: serverPackage.name, version: serverPackage.version, path: serverPath }, workspace, checks: [], notifications: [], guiVerified: false };
const settings = { intelephense: { environment: { phpVersion: '8.2.0' }, files: { associations: ['*.php'], exclude: [] }, stubs: ['Core', 'standard', 'SPL'], telemetry: { enabled: false } } };
const processHandle = spawn(process.execPath, [serverPath, '--stdio'], { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = Buffer.alloc(0);
let sequence = 0;
let stderr = '';
const pending = new Map();
function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  processHandle.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  processHandle.stdin.write(body);
}
function request(method, params, timeout = 20000) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`LSP 请求超时：${method}`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
function notify(method, params) { send({ method, params }); }
processHandle.stderr.on('data', (data) => { stderr += data.toString(); });
processHandle.stdout.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  while (true) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) break;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
    if (!Number.isInteger(length) || buffer.length < end + 4 + length) break;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (message.method && message.id !== undefined) {
      const result = message.method === 'workspace/configuration'
        ? message.params.items.map(({ section }) => section?.split('.').reduce((value, key) => value?.[key], settings) ?? null)
        : message.method === 'workspace/workspaceFolders' ? [{ uri: pathToFileURL(workspace).href, name: 'SqlStudio LSP acceptance' }] : null;
      send({ id: message.id, result });
    } else if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer); pending.delete(message.id);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result);
      }
    } else if (['window/logMessage', 'window/showMessage', '$/progress'].includes(message.method)) report.notifications.push({ method: message.method, params: message.params });
  }
});
processHandle.on('error', (error) => {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
});
function position(fragment, inside = 0) {
  const index = source.indexOf(fragment);
  if (index < 0) throw new Error(`未找到源码片段：${fragment}`);
  const lines = source.slice(0, index + inside).split('\n');
  return { line: lines.length - 1, character: lines.at(-1).length };
}
function parameters(positionValue) { return { textDocument: { uri }, position: positionValue }; }
function check(name, passed, evidence) {
  report.checks.push({ name, passed, evidence });
  if (!passed) throw new Error(`LSP 验收失败：${name}`);
}
function definitionUris(result) { return (Array.isArray(result) ? result : result ? [result] : []).map((item) => item.uri ?? item.targetUri); }
function hoverText(result) {
  const contents = result?.contents;
  return (Array.isArray(contents) ? contents : [contents]).map((part) => typeof part === 'string' ? part : part?.value ?? '').join('\n');
}
try {
  const initialized = await request('initialize', {
    processId: process.pid, rootUri: pathToFileURL(workspace).href,
    workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: 'SqlStudio LSP acceptance' }],
    initializationOptions: { storagePath: path.join(runDir, 'storage'), globalStoragePath: path.join(runDir, 'global-storage'), clearCache: true },
    capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] }, completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } } } },
  });
  report.serverCapabilities = initialized.capabilities;
  notify('initialized', {});
  notify('workspace/didChangeConfiguration', { settings });
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'php', version: 1, text: source } });
  let schemaDefinition;
  const deadline = Date.now() + 30000;
  do {
    schemaDefinition = await request('textDocument/definition', parameters(position("Schema::create('demo_item'", 2)));
    if (definitionUris(schemaDefinition).some((item) => item?.endsWith('/Schema/Schema.php'))) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  } while (Date.now() < deadline);
  check('Schema class definition resolves to own SDK', definitionUris(schemaDefinition).some((item) => item?.endsWith('/Schema/Schema.php')), schemaDefinition);
  const blueprintDefinition = await request('textDocument/definition', parameters(position('Blueprint $table', 2)));
  check('Blueprint class definition resolves to own SDK', definitionUris(blueprintDefinition).some((item) => item?.endsWith('/Schema/Blueprint.php')), blueprintDefinition);
  const schemaHover = await request('textDocument/hover', parameters(position("Schema::create('demo_item'", 'Schema::cr'.length)));
  check('Schema::create hover includes Chinese method description', hoverText(schemaHover).includes('创建表'), schemaHover);
  const nullableHover = await request('textDocument/hover', parameters(position("foreignId('owner_id')->nullable()", "foreignId('owner_id')->nu".length)));
  check('Inherited nullable hover includes Chinese description', hoverText(nullableHover).includes('允许/禁止 NULL'), nullableHover);
  for (const [name, fragment, offset, expected] of [
    ['foreignId return offers nullable', "foreignId('owner_id')->nullable()", "foreignId('owner_id')->".length, 'nullable'],
    ['nullable retains foreignId constrained completion', "nullable()->constrained('owners')", 'nullable()->'.length, 'constrained'],
    ['constrained returns foreign action completion', "constrained('owners')->cascadeOnDelete()", "constrained('owners')->".length, 'cascadeOnDelete'],
  ]) {
    const result = await request('textDocument/completion', { ...parameters(position(fragment, offset)), context: { triggerKind: 1 } });
    const items = Array.isArray(result) ? result : result?.items ?? [];
    const labels = items.map((item) => item.label);
    check(name, labels.includes(expected), { expected, labels, selected: items.find((item) => item.label === expected) });
  }
  report.ok = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  try { await request('shutdown', null, 3000); notify('exit'); } catch { processHandle.kill(); }
  processHandle.stdin.end();
  const shutdownTimer = setTimeout(() => processHandle.kill(), 3000);
  shutdownTimer.unref();
  report.stderr = stderr;
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: report.ok, version: report.server.version, checks: report.checks.length, report: path.join(runDir, 'report.json'), error: report.error }));
}
