import fs from 'node:fs/promises';
import path from 'node:path';
import { reverseSql, REVERSE_VERSION } from './reverse.js';
import { workspaceStorage } from './workspace.js';

const { assertSafePath, snapshot, validRelative, sha, identity, isHash, fail, diagnostic } = workspaceStorage;
const MANIFEST = '.migration-php-manifest.json';
const FILE_LIMIT = 32 * 1024 * 1024;
const BATCH_LIMIT = 128 * 1024 * 1024;
const phpName = sourceName => sourceName.replace(/\.sql$/i, '.php');

async function checkSourceSizes(sourceFiles) {
  let total = 0;
  for (const sourcePath of sourceFiles) {
    await assertSafePath(sourcePath);
    let stat;
    try { stat = await fs.lstat(sourcePath); } catch (error) {
      if (error.code === 'ENOENT') fail('SOURCE_DELETED', '选中的 SQL 文件不存在或已被删除。', sourcePath);
      throw error;
    }
    if (!stat.isFile()) fail('INVALID_SOURCE', '请选择普通 SQL 文件。', sourcePath);
    if (stat.size > FILE_LIMIT) fail('SOURCE_TOO_LARGE', '单份 SQL 文件不得超过 32 MiB。', sourcePath);
    total += stat.size;
    if (total > BATCH_LIMIT) fail('BATCH_TOO_LARGE', '选中的 SQL 文件总大小不得超过 128 MiB。');
  }
}

async function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sourceFiles) || raw.sourceFiles.length === 0) fail('EMPTY_INPUT', '请至少选择一份 SQL 文件；不会覆盖现有基线。');
  if (typeof raw.outputDir !== 'string' || !path.isAbsolute(raw.outputDir)) fail('INVALID_PATH', '输出目录必须为绝对路径。');
  if (![16, 18].includes(raw.targetVersion)) fail('INVALID_VERSION', '必须明确选择 PostgreSQL 16 或 18。');
  if (raw.guard !== undefined && typeof raw.guard !== 'boolean') fail('INVALID_GUARD', 'guard 必须为布尔值。');
  const sourceFiles = [];
  const identities = new Set();
  const names = new Set();
  for (const supplied of raw.sourceFiles) {
    if (typeof supplied !== 'string' || !path.isAbsolute(supplied) || !/\.sql$/i.test(supplied)) fail('INVALID_SOURCE', '每个输入都必须为绝对路径的 .sql 文件。');
    const sourcePath = path.resolve(supplied);
    const outputName = phpName(path.basename(sourcePath));
    if (!validRelative(path.basename(sourcePath)) || !validRelative(outputName)) fail('INVALID_SOURCE_NAME', '文件名无法安全映射为 Windows PHP 文件。', sourcePath);
    if (identities.has(identity(sourcePath)) || names.has(outputName.toLowerCase())) fail('OUTPUT_COLLISION', '选中的 SQL 文件具有重复名称或 Windows 大小写冲突。', sourcePath);
    identities.add(identity(sourcePath));
    names.add(outputName.toLowerCase());
    sourceFiles.push(sourcePath);
  }
  sourceFiles.sort();
  const outputDir = path.resolve(raw.outputDir);
  await assertSafePath(outputDir);
  try {
    if (!(await fs.stat(outputDir)).isDirectory()) fail('INVALID_PATH', '输出路径必须为目录。', outputDir);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { sourceFiles, outputDir, targetVersion: raw.targetVersion, guard: raw.guard ?? true };
}

function parseManifest(bytes) {
  if (!bytes) return null;
  let saved;
  try { saved = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_MANIFEST', '逆向转换基线无法解析，已停止以保护现有文件。'); }
  if (!saved || saved.schemaVersion !== 1 || saved.direction !== 'reverse' || typeof saved.compilerVersion !== 'string'
    || ![16, 18].includes(saved.targetVersion) || !Array.isArray(saved.entries) || !saved.entries.length) fail('INVALID_MANIFEST', '逆向转换基线版本、方向或格式不正确。');
  const sources = new Set();
  const outputs = new Set();
  for (const entry of saved.entries) {
    if (!entry || typeof entry.sourcePath !== 'string' || !path.isAbsolute(entry.sourcePath)
      || path.resolve(entry.sourcePath) !== entry.sourcePath || !/\.sql$/i.test(entry.sourcePath)
      || entry.sourceName !== path.basename(entry.sourcePath) || !validRelative(entry.sourceName)
      || !validRelative(entry.outputName) || entry.outputName !== phpName(entry.sourceName)
      || !isHash(entry.sourceHash) || !isHash(entry.outputHash)
      || sources.has(identity(entry.sourcePath)) || outputs.has(entry.outputName.toLowerCase())) fail('INVALID_MANIFEST', '逆向转换基线包含无效、重复或越界的路径映射。');
    sources.add(identity(entry.sourcePath));
    outputs.add(entry.outputName.toLowerCase());
  }
  return saved;
}

async function prepare(options, report) {
  await checkSourceSizes(options.sourceFiles);
  const snapshots = new Map();
  const snapshotLimits = new Map(options.sourceFiles.map(source => [source, FILE_LIMIT]));
  let sourceBytes = 0;
  const track = async target => {
    if (!snapshots.has(target)) {
      const isSource = snapshotLimits.has(target);
      const limit = isSource ? Math.min(FILE_LIMIT, BATCH_LIMIT - sourceBytes) : undefined;
      let saved;
      try { saved = await snapshot(target, limit); } catch (error) {
        if (isSource && limit < FILE_LIMIT && error.code === 'SOURCE_TOO_LARGE') fail('BATCH_TOO_LARGE', '读取期间 SQL 总大小超过 128 MiB，整批中断。');
        throw error;
      }
      if (isSource) sourceBytes += saved.bytes?.length || 0;
      snapshots.set(target, saved);
    }
    return snapshots.get(target);
  };
  const previous = await track(path.join(options.outputDir, MANIFEST));
  const manifest = parseManifest(previous.bytes);
  const selected = new Map(options.sourceFiles.map(source => [identity(source), source]));
  const previousEntries = new Map(manifest?.entries.map(entry => [entry.outputName.toLowerCase(), entry]) || []);
  if (manifest && options.guard) {
    if (manifest.targetVersion !== options.targetVersion || manifest.compilerVersion !== REVERSE_VERSION) report.diagnostics.push({ code: 'BASELINE_OPTIONS_CHANGED', message: '目标版本或逆向转换器版本已改变；请选择新输出目录，或关闭预检测以备份后重新生成。' });
    for (const entry of manifest.entries) {
      const selectedPath = selected.get(identity(entry.sourcePath));
      // 清单只能检查本次明确选中的源文件，不能通过被篡改的绝对路径扩大读取范围。
      if (!selectedPath) report.diagnostics.push({ code: 'SOURCE_NOT_SELECTED', message: '已登记的 SQL 未包含在当前选择中；保持预检测时须继续选择全部已登记文件。', file: entry.sourceName });
      else {
        const source = await track(selectedPath);
        if (source.hash !== entry.sourceHash) report.diagnostics.push({ code: source.hash ? 'SOURCE_CHANGED' : 'SOURCE_DELETED', message: source.hash ? '已转换的 SQL 文件被修改，整批中断。' : '已转换的 SQL 文件被删除，整批中断。', file: entry.sourceName });
      }
      const output = await track(path.join(options.outputDir, entry.outputName));
      if (output.hash !== entry.outputHash) report.diagnostics.push({ code: output.hash ? 'OUTPUT_CHANGED' : 'OUTPUT_DELETED', message: output.hash ? '已生成的 PHP 文件被修改，整批中断。' : '已生成的 PHP 文件被删除，整批中断。', file: entry.outputName });
    }
  }
  const entries = [];
  for (const sourcePath of options.sourceFiles) {
    const sourceName = path.basename(sourcePath);
    const outputName = phpName(sourceName);
    const source = await track(sourcePath);
    if (!source.bytes) fail('SOURCE_DELETED', '读取期间 SQL 文件被删除，整批中断。', sourceName);
    try {
      let sourceText;
      try { sourceText = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes); } catch { fail('UNSUPPORTED_ENCODING', 'SQL 文件必须为有效 UTF-8；请明确转换编码后再试。', sourceName); }
      const converted = await reverseSql(sourceText, { targetVersion: options.targetVersion, sourceName });
      if (typeof converted.php !== 'string' || !converted.php || converted.verification?.semanticEqual !== true) fail('ROUNDTRIP_FAILED', 'SQL→PHP→SQL 往返语义验证未通过，禁止输出。', sourceName);
      const output = await track(path.join(options.outputDir, outputName));
      const outputHash = sha(converted.php);
      report.files.push({ sourceName, sourcePath, outputName, php: converted.php, status: output.hash === outputHash ? 'unchanged' : output.hash ? 'replace' : 'new', warnings: converted.warnings || [], summary: converted.summary, verification: converted.verification });
      entries.push({ sourcePath, sourceName, outputName, sourceHash: source.hash, outputHash });
      if (options.guard && output.hash && output.hash !== outputHash) {
        const recorded = previousEntries.get(outputName.toLowerCase());
        if (!recorded) report.diagnostics.push({ code: 'UNREGISTERED_OUTPUT', message: '未登记的 PHP 内容与生成结果不同，整批中断。', file: outputName });
        else if (recorded.outputHash === output.hash) report.diagnostics.push({ code: 'COMPILER_OUTPUT_CHANGED', message: '已有基线生成了不同 PHP 内容；请选择新目录，或关闭预检测以备份后重新生成。', file: outputName });
      }
    } catch (error) {
      report.diagnostics.push({ ...diagnostic(error), file: sourceName });
    }
  }
  return {
    direction: 'reverse', options, snapshots, snapshotLimits,
    verify: () => checkSourceSizes(options.sourceFiles),
    manifestBytes: Buffer.from(`${JSON.stringify({ schemaVersion: 1, direction: 'reverse', compilerVersion: REVERSE_VERSION, targetVersion: options.targetVersion, entries }, null, 2)}\n`),
  };
}

export async function previewReverse(rawOptions) {
  const report = workspaceStorage.result();
  try {
    const options = await normalize(rawOptions);
    await workspaceStorage.checkIdle(options.outputDir);
    await prepare(options, report);
    report.ok = report.diagnostics.length === 0;
    report.skipped = report.files.filter(file => file.status === 'unchanged').length;
  } catch (error) { report.diagnostics.push(diagnostic(error)); }
  return report;
}

export async function convertReverse(rawOptions) {
  const report = workspaceStorage.result();
  let release;
  try {
    const options = await normalize(rawOptions);
    await fs.mkdir(options.outputDir, { recursive: true });
    await assertSafePath(options.outputDir);
    release = await workspaceStorage.acquireLock(options.outputDir);
    await workspaceStorage.recover(options.outputDir, false, 'reverse');
    const plan = await prepare(options, report);
    if (report.diagnostics.length) return report;
    await workspaceStorage.commit(plan, report);
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
