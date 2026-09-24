import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { convertPhp, COMPILER_VERSION } from './converter.js';

const MANIFEST = '.migration-sql-manifest.json';
const LOCK = '.migration-sql.lock';
const RECLAIM_LOCK = '.migration-sql-reclaim.lock';
const JOURNAL = '.migration-sql-transaction.json';
const TRANSACTIONS = '.migration-sql-transactions';
const BACKUPS = '.migration-sql-backups';
const PROFILES = {
  forward: { manifest: MANIFEST, extension: /\.sql$/i, content: 'sql' },
  reverse: { manifest: '.migration-php-manifest.json', extension: /\.php$/i, content: 'php' },
};
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = value => path.resolve(value).toLowerCase();
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const result = () => ({ ok: false, files: [], diagnostics: [], written: 0, skipped: 0 });

function fail(code, message, file) {
  const error = new Error(message);
  Object.assign(error, { code, file });
  throw error;
}

function diagnostic(error) {
  return {
    code: error.code || 'WORKSPACE_ERROR',
    message: error.message || String(error),
    ...(error.file ? { file: error.file } : {}),
    ...(Number.isInteger(error.line) ? { line: error.line } : {}),
  };
}

function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || ancestors.has(value)) fail('INVALID_CONFIG', '配置必须为普通 JSON 对象，不能包含循环引用或非 JSON 值。');
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, next)).join(',')}]`;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_CONFIG', '配置必须为普通 JSON 对象。');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], next)}`).join(',')}}`;
}

function overlaps(first, second) {
  const relative = path.relative(identity(first), identity(second));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// 检查每级父目录，拒绝链接、junction 及 realpath 重定向，避免写出选定目录。
async function assertSafePath(target) {
  const full = path.resolve(target);
  const root = path.parse(full).root;
  let current = root;
  const components = full.slice(root.length).split(path.sep).filter(Boolean);
  for (const part of [null, ...components]) {
    if (part !== null) current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH', '路径包含符号链接或 junction，请选择实际目录。', current);
    if (identity(await fs.realpath(current)) !== identity(current)) fail('UNSAFE_PATH', '路径被重定向到其他位置。', current);
    if (current !== full && !stat.isDirectory()) fail('INVALID_PATH', '父路径不是目录。', current);
  }
}

async function snapshot(target, maxBytes = Infinity) {
  await assertSafePath(target);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile()) fail('INVALID_FILE', '预期为普通文件，实际为目录或其他类型。', target);
    if (stat.size > maxBytes) fail('SOURCE_TOO_LARGE', '单份 SQL 文件不得超过 32 MiB。', target);
    let bytes;
    if (Number.isFinite(maxBytes)) {
      const handle = await fs.open(target, 'r');
      const chunks = [];
      let size = 0;
      try {
        while (size <= maxBytes) {
          const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - size));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
          if (!bytesRead) break;
          chunks.push(chunk.subarray(0, bytesRead));
          size += bytesRead;
        }
      } finally { await handle.close(); }
      if (size > maxBytes) fail('SOURCE_TOO_LARGE', '读取期间 SQL 文件超过 32 MiB 限制。', target);
      bytes = Buffer.concat(chunks, size);
    } else bytes = await fs.readFile(target);
    return { bytes, hash: sha(bytes) };
  } catch (error) {
    if (error.code === 'ENOENT') return { bytes: null, hash: null };
    throw error;
  }
}

function validRelative(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !path.isAbsolute(name)
    && name.split('/').every(part => part !== '' && part !== '.' && part !== '..'
      && !/[\x00-\x1f<>:"|?*]/.test(part) && !/[ .]$/.test(part)
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      && !part.toLowerCase().startsWith('.migration-sql'));
}

function outputName(sourceName) {
  const pieces = sourceName.split('/');
  pieces[pieces.length - 1] = pieces.at(-1).replace(/^migrations\./i, '').replace(/\.php$/i, '.sql');
  return pieces.join('/');
}

async function scan(inputDir, folder = '') {
  await assertSafePath(path.join(inputDir, folder));
  const names = [];
  for (const entry of (await fs.readdir(path.join(inputDir, folder), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = folder ? `${folder}/${entry.name}` : entry.name;
    const absolute = path.join(inputDir, ...name.split('/'));
    if (entry.isSymbolicLink()) fail('UNSAFE_PATH', '迁移目录包含符号链接或 junction。', name);
    if (entry.isDirectory() && ['.migration-sql-backups', '.migration-sql-transactions'].includes(entry.name.toLowerCase())) continue;
    if (entry.isDirectory()) names.push(...await scan(inputDir, name));
    else if (/\.php$/i.test(entry.name)) {
      if (!entry.isFile() || !validRelative(name)) fail('INVALID_SOURCE_NAME', '迁移文件路径无法安全映射为 Windows SQL 文件。', name);
      await assertSafePath(absolute);
      names.push(name);
    }
  }
  return names.sort();
}

async function normalize(options) {
  if (!options || typeof options !== 'object') fail('INVALID_OPTIONS', '请选择迁移目录和输出目录。');
  const { inputDir, outputDir, targetVersion } = options;
  for (const [key, value] of Object.entries({ inputDir, outputDir })) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) fail('INVALID_PATH', `${key} 必须为绝对路径。`);
  }
  if (![16, 18].includes(targetVersion)) fail('INVALID_VERSION', '必须明确选择 PostgreSQL 16 或 18。');
  if (options.guard !== undefined && typeof options.guard !== 'boolean') fail('INVALID_GUARD', 'guard 必须为布尔值。');
  const config = options.config === undefined ? {} : options.config;
  if (!config || Array.isArray(config) || typeof config !== 'object') fail('INVALID_CONFIG', '配置必须为普通 JSON 对象。');
  const configJson = canonicalJson(config);
  const input = path.resolve(inputDir);
  const output = path.resolve(outputDir);
  if (overlaps(input, output) || overlaps(output, input)) fail('OVERLAPPING_DIRECTORIES', '迁移目录与输出目录必须相互独立，不能相同或互为父子目录。');
  await assertSafePath(input);
  await assertSafePath(output);
  if (!(await fs.stat(input)).isDirectory()) fail('INVALID_PATH', '迁移路径不是目录。', input);
  try {
    if (!(await fs.stat(output)).isDirectory()) fail('INVALID_PATH', '输出路径不是目录。', output);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { inputDir: input, outputDir: output, targetVersion, guard: options.guard ?? true, config: JSON.parse(configJson), configJson };
}

function parseManifest(bytes) {
  if (!bytes) return null;
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_MANIFEST', '基线清单无法解析，已停止以保护现有输出。'); }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)
    || ![16, 18].includes(manifest.targetVersion) || typeof manifest.compilerVersion !== 'string'
    || typeof manifest.inputRoot !== 'string' || !path.isAbsolute(manifest.inputRoot)
    || !manifest.config || Array.isArray(manifest.config) || typeof manifest.config !== 'object') fail('INVALID_MANIFEST', '基线清单格式不正确。');
  const sources = new Set();
  const outputs = new Set();
  for (const entry of manifest.entries) {
    if (!entry || !validRelative(entry.sourceName) || !/\.php$/i.test(entry.sourceName)
      || !validRelative(entry.outputName) || entry.outputName !== outputName(entry.sourceName)
      || !isHash(entry.sourceHash) || !isHash(entry.outputHash)
      || sources.has(entry.sourceName.toLowerCase()) || outputs.has(entry.outputName.toLowerCase())) fail('INVALID_MANIFEST', '基线清单包含无效、重复或越界的文件映射。');
    sources.add(entry.sourceName.toLowerCase());
    outputs.add(entry.outputName.toLowerCase());
  }
  return manifest;
}

async function prepare(options, report) {
  try { await checkIdle(options.inputDir); }
  catch (error) {
    if (['RECOVERY_REQUIRED', 'WORKSPACE_LOCKED'].includes(error.code)) {
      error.message = 'PHP 输入目录正在生成或存在未完成事务，请先在对应转换入口结束或恢复任务，再读取迁移文件。';
      error.file = options.inputDir;
    }
    throw error;
  }
  const sourceNames = await scan(options.inputDir);
  if (!sourceNames.length) fail('EMPTY_INPUT', '迁移目录中没有 PHP 文件；不会覆盖现有基线。');
  const snapshots = new Map();
  const track = async target => {
    if (!snapshots.has(target)) snapshots.set(target, await snapshot(target));
    return snapshots.get(target);
  };
  const manifestPath = path.join(options.outputDir, MANIFEST);
  const previous = await track(manifestPath);
  const manifest = parseManifest(previous.bytes);
  const outputs = new Set();
  const names = new Set();
  const entries = [];
  for (const sourceName of sourceNames) {
    const name = outputName(sourceName);
    if (!validRelative(name) || outputs.has(name.toLowerCase()) || names.has(sourceName.toLowerCase())) fail('OUTPUT_COLLISION', '文件名映射产生 Windows 大小写冲突或无效输出路径。', sourceName);
    outputs.add(name.toLowerCase());
    names.add(sourceName.toLowerCase());
    const source = await track(path.join(options.inputDir, ...sourceName.split('/')));
    if (!source.bytes) fail('SOURCE_CHANGED', '扫描期间迁移文件被删除，请重新运行。', sourceName);
    try {
      const converted = convertPhp(source.bytes.toString('utf8'), { targetVersion: options.targetVersion, config: options.config, sourceName });
      const output = await track(path.join(options.outputDir, ...name.split('/')));
      const outputHash = sha(converted.sql);
      const file = { sourceName, outputName: name, sql: converted.sql, status: output.hash === outputHash ? 'unchanged' : output.hash ? 'replace' : 'new', warnings: converted.warnings || [], summary: converted.summary };
      report.files.push(file);
      entries.push({ sourceName, outputName: name, sourceHash: source.hash, outputHash });
    } catch (error) {
      report.diagnostics.push(diagnostic(Object.assign(error, { file: sourceName })));
    }
  }
  if (manifest && options.guard) {
    if (identity(manifest.inputRoot) !== identity(options.inputDir)) report.diagnostics.push({ code: 'BASELINE_INPUT_CHANGED', message: '输入目录与已记录基线不同；关闭预检测可备份后重新生成。' });
    if (manifest.targetVersion !== options.targetVersion || manifest.compilerVersion !== COMPILER_VERSION || canonicalJson(manifest.config) !== options.configJson) report.diagnostics.push({ code: 'BASELINE_OPTIONS_CHANGED', message: 'PostgreSQL 版本、配置或转换器版本已改变；关闭预检测可备份后重新生成。' });
    for (const entry of manifest.entries) {
      const source = await track(path.join(options.inputDir, ...entry.sourceName.split('/')));
      const output = await track(path.join(options.outputDir, ...entry.outputName.split('/')));
      if (source.hash !== entry.sourceHash) report.diagnostics.push({ code: source.hash ? 'SOURCE_CHANGED' : 'SOURCE_DELETED', message: source.hash ? '已转换的 PHP 文件被修改，整批中断。' : '已转换的 PHP 文件被删除，整批中断。', file: entry.sourceName });
      if (output.hash !== entry.outputHash) report.diagnostics.push({ code: output.hash ? 'OUTPUT_CHANGED' : 'OUTPUT_DELETED', message: output.hash ? '已生成的 SQL 文件被修改，整批中断。' : '已生成的 SQL 文件被删除，整批中断。', file: entry.outputName });
    }
  }
  if (options.guard) {
    const registered = new Set(manifest?.entries.map(entry => entry.outputName) || []);
    for (const entry of entries) {
      const output = snapshots.get(path.join(options.outputDir, ...entry.outputName.split('/')));
      if (!registered.has(entry.outputName) && output.hash && output.hash !== entry.outputHash) report.diagnostics.push({ code: 'UNREGISTERED_OUTPUT', message: '发现未登记且内容不同的 SQL 文件，整批中断。', file: entry.outputName });
      if (registered.has(entry.outputName) && output.hash === manifest.entries.find(item => item.outputName === entry.outputName).outputHash && output.hash !== entry.outputHash) report.diagnostics.push({ code: 'COMPILER_OUTPUT_CHANGED', message: '相同基线生成了不同内容，请关闭预检测以备份后重新生成。', file: entry.outputName });
    }
  }
  return { options, sourceNames, snapshots, entries, manifestBytes: Buffer.from(`${JSON.stringify({ schemaVersion: 1, compilerVersion: COMPILER_VERSION, inputRoot: options.inputDir, targetVersion: options.targetVersion, config: options.config, entries }, null, 2)}\n`) };
}

async function verifyPlan(plan, changed = new Map()) {
  if (plan.verify) await plan.verify();
  else {
    await assertSafePath(plan.options.inputDir);
    if (JSON.stringify(await scan(plan.options.inputDir)) !== JSON.stringify(plan.sourceNames)) fail('CONCURRENT_CHANGE', '转换期间迁移文件列表变化，请重新运行。');
  }
  await assertSafePath(plan.options.outputDir);
  for (const [target, before] of plan.snapshots) {
    const expected = changed.has(target) ? changed.get(target) : before.hash;
    if ((await snapshot(target, plan.snapshotLimits?.get(target))).hash !== expected) fail('CONCURRENT_CHANGE', '转换期间文件发生变化，已停止提交。', target);
  }
}

async function durableWrite(target, bytes) {
  await assertSafePath(target);
  const handle = await fs.open(target, 'wx');
  let owned;
  let writeError;
  try { owned = await handle.stat(); await handle.writeFile(bytes); await handle.sync(); } catch (error) { writeError = error; }
  finally { await handle.close(); }
  if (writeError) {
    // 写入失败时清理本次排他创建的半文件，避免当前进程被自己的残留锁阻塞。
    await assertSafePath(target);
    const current = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (owned && current && current.ino === owned.ino && current.dev === owned.dev) await fs.unlink(target);
    throw writeError;
  }
}

async function acquireLock(outputDir) {
  const target = path.join(outputDir, LOCK);
  const token = randomUUID();
  const bytes = JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() });
  const reclaimPath = path.join(outputDir, RECLAIM_LOCK);
  if ((await snapshot(reclaimPath)).hash) fail('WORKSPACE_LOCKED', '正在回收异常退出的任务锁；若持续出现，请人工检查 .migration-sql-reclaim.lock。');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await durableWrite(target, bytes);
      return async () => {
        if ((await snapshot(target)).bytes?.toString('utf8') === bytes) await fs.unlink(target);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await snapshot(target);
      let owner;
      try { owner = JSON.parse(existing.bytes.toString('utf8')); } catch { fail('WORKSPACE_LOCKED', '输出目录存在无法辨认的锁文件，请检查是否有其他实例正在转换。'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') fail('WORKSPACE_LOCKED', '输出目录锁文件无效，请人工核实。');
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
      if (alive || attempt) fail('WORKSPACE_LOCKED', '输出目录正在被其他转换任务使用，请稍后重试。');
      // 独立排他锁序列化死进程锁的回收，防止两个新进程误删彼此的新锁。
      try { await durableWrite(reclaimPath, bytes); } catch (reclaimError) {
        if (reclaimError.code === 'EEXIST') fail('WORKSPACE_LOCKED', '其他实例正在恢复异常退出的任务，请稍后重试。');
        throw reclaimError;
      }
      try {
        if ((await snapshot(target)).hash !== existing.hash) fail('WORKSPACE_LOCKED', '锁文件状态发生变化，请稍后重试。');
        try { process.kill(owner.pid, 0); fail('WORKSPACE_LOCKED', '原任务进程仍存在，未回收任务锁。'); } catch (probe) {
          if (probe.code !== 'ESRCH') throw probe;
        }
        await fs.unlink(target);
        await durableWrite(target, bytes);
        return async () => {
          if ((await snapshot(target)).bytes?.toString('utf8') === bytes) await fs.unlink(target);
        };
      } finally {
        if ((await snapshot(reclaimPath)).bytes?.toString('utf8') === bytes) await fs.unlink(reclaimPath);
      }
    }
  }
}

function parseJournal(bytes) {
  let journal;
  try { journal = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_JOURNAL', '事务日志损坏，需人工检查后再转换。'); }
  if (!journal || journal.schemaVersion !== 1 || typeof journal.id !== 'string'
    || !/^[a-f0-9-]{36}$/.test(journal.id) || !Array.isArray(journal.entries) || !journal.entries.length) fail('INVALID_JOURNAL', '事务日志格式无效。');
  if (journal.direction !== undefined && !Object.hasOwn(PROFILES, journal.direction)) fail('INVALID_JOURNAL', '事务日志转换方向无效。');
  const profile = PROFILES[journal.direction ?? 'forward'];
  const names = new Set();
  for (const entry of journal.entries) {
    if (!entry || (entry.name !== profile.manifest && (!validRelative(entry.name) || !profile.extension.test(entry.name)))
      || names.has(entry.name.toLowerCase()) || !(entry.beforeHash === null || isHash(entry.beforeHash)) || !isHash(entry.afterHash)) fail('INVALID_JOURNAL', '事务日志含越界路径或无效哈希。');
    names.add(entry.name.toLowerCase());
  }
  if (journal.entries.at(-1).name !== profile.manifest) fail('INVALID_JOURNAL', '事务日志缺少最后提交的清单。');
  return journal;
}

async function cleanupJournal(outputDir, journal) {
  const folder = path.join(outputDir, TRANSACTIONS, journal.id);
  // 只清理本事务明确拥有的文件，保留任何意外出现的人工文件。
  for (let index = 0; index < journal.entries.length; index++) {
    for (const prefix of ['before', 'after', 'restore', 'captured', 'rollback']) {
      const target = path.join(folder, `${prefix}-${index}`);
      const current = await snapshot(target);
      const expected = ['after', 'rollback'].includes(prefix) ? journal.entries[index].afterHash : journal.entries[index].beforeHash;
      if (current.hash && current.hash !== expected) fail('RECOVERY_CONFLICT', '事务临时文件被修改，已保留，需人工核对。', target);
      if (current.hash) await fs.unlink(target);
    }
  }
  const stagedJournal = path.join(folder, 'journal');
  const staged = await snapshot(stagedJournal);
  if (staged.bytes) {
    if (JSON.stringify(parseJournal(staged.bytes)) !== JSON.stringify(journal)) fail('RECOVERY_CONFLICT', '事务日志副本被修改，已保留。');
    await fs.unlink(stagedJournal);
  }
  await fs.rmdir(folder).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
  const journalPath = path.join(outputDir, JOURNAL);
  const currentJournal = await snapshot(journalPath);
  if (!currentJournal.bytes || JSON.stringify(parseJournal(currentJournal.bytes)) !== JSON.stringify(journal)) fail('RECOVERY_CONFLICT', '事务日志在清理期间被修改，已停止。');
  await fs.unlink(journalPath);
}

async function recover(outputDir, forceRollback = false, expectedDirection) {
  const saved = await snapshot(path.join(outputDir, JOURNAL));
  if (!saved.bytes) return false;
  const journal = parseJournal(saved.bytes);
  if (expectedDirection && (journal.direction ?? 'forward') !== expectedDirection) fail('RECOVERY_DIRECTION_MISMATCH', '此目录存在另一转换方向的未完成事务，请从原转换入口恢复后再继续。');
  const folder = path.join(outputDir, TRANSACTIONS, journal.id);
  await assertSafePath(folder);
  const states = [];
  for (let index = 0; index < journal.entries.length; index++) {
    const entry = journal.entries[index];
    const target = path.join(outputDir, ...entry.name.split('/'));
    const current = await snapshot(target);
    const captured = await snapshot(path.join(folder, `captured-${index}`));
    const rollback = await snapshot(path.join(folder, `rollback-${index}`));
    if (captured.hash && captured.hash !== entry.beforeHash) fail('RECOVERY_CONFLICT', '提交瞬间发现外部编辑，实际文件已保存在事务目录，请人工核对。', path.join(folder, `captured-${index}`));
    if (rollback.hash && rollback.hash !== entry.afterHash) fail('RECOVERY_CONFLICT', '恢复瞬间发现外部编辑，实际文件已保存在事务目录，请人工核对。', path.join(folder, `rollback-${index}`));
    const held = current.hash === null && (captured.hash === entry.beforeHash && captured.hash !== null || rollback.hash === entry.afterHash);
    if (current.hash !== entry.beforeHash && current.hash !== entry.afterHash && !held) fail('RECOVERY_CONFLICT', '未完成事务涉及的文件又被人工修改，已保留全部数据；请人工核对事务日志。', entry.name);
    states.push({ entry, target, current });
  }
  const committed = !forceRollback && states.every(state => state.current.hash === state.entry.afterHash);
  if (!committed) {
    for (let index = 0; index < states.length; index++) {
      const state = states[index];
      state.before = await snapshot(path.join(folder, `before-${index}`));
      if (state.current.hash !== state.entry.beforeHash && state.entry.beforeHash !== null && state.before.hash !== state.entry.beforeHash) fail('RECOVERY_CONFLICT', '事务原始备份缺失或被修改，无法安全恢复。', state.entry.name);
    }
    for (let index = states.length - 1; index >= 0; index--) {
      const { entry, target, current } = states[index];
      if (current.hash === entry.beforeHash) continue;
      if ((await snapshot(target)).hash !== current.hash) fail('RECOVERY_CONFLICT', '恢复期间文件再次变化，已停止。', entry.name);
      if (current.hash !== null) {
        const heldPath = path.join(folder, `rollback-${index}`);
        if ((await snapshot(heldPath)).hash) fail('RECOVERY_CONFLICT', '恢复隔离文件已存在，请人工核对。', heldPath);
        await fs.rename(target, heldPath);
        if ((await snapshot(heldPath)).hash !== entry.afterHash) {
          await fs.link(heldPath, target).catch(() => {});
          fail('RECOVERY_CONFLICT', '恢复瞬间出现人工编辑，已保留实际文件。', heldPath);
        }
      }
      if (entry.beforeHash !== null) await fs.link(path.join(folder, `before-${index}`), target);
      else if ((await snapshot(target)).hash) fail('RECOVERY_CONFLICT', '恢复期间有新文件写入，已保留。', entry.name);
    }
  }
  await cleanupJournal(outputDir, journal);
  return true;
}

async function commit(plan, report) {
  await verifyPlan(plan);
  const direction = plan.direction ?? 'forward';
  if (!Object.hasOwn(PROFILES, direction)) fail('INVALID_DIRECTION', '转换方向无效。');
  const profile = PROFILES[direction];
  const { outputDir, guard } = plan.options;
  const pending = report.files.filter(file => file.status !== 'unchanged').map(file => ({ name: file.outputName, bytes: Buffer.from(file[profile.content]) }));
  if (pending.some(item => !validRelative(item.name) || !profile.extension.test(item.name))) fail('INVALID_OUTPUT', '输出路径与转换方向不符。');
  const previousManifest = plan.snapshots.get(path.join(outputDir, profile.manifest));
  if (!pending.length && previousManifest.hash === sha(plan.manifestBytes)) return;
  pending.push({ name: profile.manifest, bytes: plan.manifestBytes });
  const id = randomUUID();
  const folder = path.join(outputDir, TRANSACTIONS, id);
  await assertSafePath(folder);
  await fs.mkdir(folder, { recursive: true });
  const journal = { schemaVersion: 1, direction, id, entries: [] };
  const originals = [];
  for (let index = 0; index < pending.length; index++) {
    const item = pending[index];
    const target = path.join(outputDir, ...item.name.split('/'));
    const previous = plan.snapshots.get(target);
    journal.entries.push({ name: item.name, beforeHash: previous.hash, afterHash: sha(item.bytes) });
    if (previous.bytes) {
      await durableWrite(path.join(folder, `before-${index}`), previous.bytes);
      originals.push({ name: item.name, bytes: previous.bytes });
    }
    await durableWrite(path.join(folder, `after-${index}`), item.bytes);
  }
  if (!guard && originals.length) {
    const backupDir = path.join(outputDir, BACKUPS, id);
    for (const item of originals) {
      const destination = path.join(backupDir, ...item.name.split('/'));
      await assertSafePath(destination);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await durableWrite(destination, item.bytes);
    }
    report.backupDir = backupDir;
  }
  await verifyPlan(plan);
  const stagedJournal = path.join(folder, 'journal');
  await durableWrite(stagedJournal, `${JSON.stringify(journal, null, 2)}\n`);
  // 完整日志先落盘，再排他发布，崩溃不会留下半截的活动日志。
  await fs.link(stagedJournal, path.join(outputDir, JOURNAL));
  const changed = new Map();
  let committed = false;
  try {
    for (let index = 0; index < pending.length; index++) {
      const entry = journal.entries[index];
      const target = path.join(outputDir, ...entry.name.split('/'));
      // 清单最后提交；先保留实际旧文件，再排他发布，覆盖瞬间的人工修改也有副本。
      await verifyPlan(plan, changed);
      await assertSafePath(target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (entry.beforeHash !== null) {
        const captured = path.join(folder, `captured-${index}`);
        await fs.rename(target, captured);
        if ((await snapshot(captured)).hash !== entry.beforeHash) {
          await fs.link(captured, target).catch(() => {});
          fail('CONCURRENT_CHANGE', '提交瞬间发现文件改变，已保留实际文件及事务日志。', captured);
        }
      }
      await fs.link(path.join(folder, `after-${index}`), target);
      changed.set(target, entry.afterHash);
    }
    await verifyPlan(plan, changed);
    committed = true;
    await cleanupJournal(outputDir, journal);
  } catch (error) {
    try {
      await recover(outputDir, !committed, direction);
      if (committed) return;
    } catch (recoveryError) {
      report.diagnostics.push(diagnostic(recoveryError));
      for (const entry of journal.entries.filter(item => item.name !== profile.manifest)) {
        if ((await snapshot(path.join(outputDir, ...entry.name.split('/')))).hash === entry.afterHash) report.written++;
      }
    }
    throw error;
  }
}

async function checkIdle(outputDir) {
  if ((await snapshot(path.join(outputDir, JOURNAL))).hash) fail('RECOVERY_REQUIRED', '检测到未完成事务；点击转换以安全恢复后重新预检。');
  if ((await snapshot(path.join(outputDir, LOCK))).hash) fail('WORKSPACE_LOCKED', '输出目录存在转换锁，请等待当前任务结束；异常退出后可点击转换恢复。');
}

// 两个转换方向共用同一发布与恢复实现，调用者仅提供自己的输入校验及文件内容。
export const workspaceStorage = Object.freeze({ assertSafePath, snapshot, validRelative, sha, identity, isHash, fail, diagnostic, result, acquireLock, recover, commit, checkIdle });

export async function previewDirectory(rawOptions) {
  const report = result();
  try {
    const options = await normalize(rawOptions);
    await checkIdle(options.outputDir);
    await prepare(options, report);
    report.ok = report.diagnostics.length === 0;
    report.skipped = report.files.filter(file => file.status === 'unchanged').length;
  } catch (error) { report.diagnostics.push(diagnostic(error)); }
  return report;
}

export async function convertDirectory(rawOptions) {
  const report = result();
  let release;
  try {
    const options = await normalize(rawOptions);
    await fs.mkdir(options.outputDir, { recursive: true });
    await assertSafePath(options.outputDir);
    release = await acquireLock(options.outputDir);
    await recover(options.outputDir, false, 'forward');
    const plan = await prepare(options, report);
    if (report.diagnostics.length) return report;
    await commit(plan, report);
    report.ok = true;
    report.written = report.files.filter(file => file.status !== 'unchanged').length;
    report.skipped = report.files.length - report.written;
  } catch (error) { report.diagnostics.push(diagnostic(error)); }
  finally {
    if (release) {
      try { await release(); } catch (error) { report.ok = false; report.diagnostics.push(diagnostic(error)); }
    }
  }
  return report;
}
