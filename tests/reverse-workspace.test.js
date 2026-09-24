import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { previewReverse, convertReverse } from '../src/core/reverse-workspace.js';
import { previewDirectory, convertDirectory } from '../src/core/workspace.js';

const MANIFEST = '.migration-php-manifest.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const sql = name => `CREATE TABLE public.${name} (id int8 NOT NULL, title varchar(255), PRIMARY KEY (id));\n`;

async function fixture(t, names = ['示例.sql']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reverse-workspace-'));
  const sourceDir = path.join(root, 'postgresql');
  const outputDir = path.join(sourceDir, 'migration');
  await fs.mkdir(sourceDir);
  const sourceFiles = names.map(name => path.join(sourceDir, name));
  for (let index = 0; index < names.length; index++) await fs.writeFile(sourceFiles[index], sql(`demo_${index}`));
  t.after(async () => {
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'reverse-workspace-')));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, sourceDir, sourceFiles, outputDir, targetVersion: 16, guard: true };
}

test('seven selected SQL files produce seven same-named PHP files in source subdirectory', async t => {
  const options = await fixture(t, ['mall-中文.sql', 'go-view.sql', 'im.sql', 'member.sql', 'pay.sql', 'quartz.sql', 'ruoyi-vue-pro.sql']);
  await fs.writeFile(path.join(options.sourceDir, 'not-selected.sql'), 'this SQL is invalid');
  const preview = await previewReverse(options);
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  assert.equal(preview.files.length, 7);
  assert.equal(preview.written, 0);
  assert.deepEqual(preview.files.map(file => file.outputName).sort(), options.sourceFiles.map(file => path.basename(file).replace(/\.sql$/, '.php')).sort());
  await assert.rejects(fs.stat(options.outputDir), { code: 'ENOENT' });
  const converted = await convertReverse(options);
  assert.equal(converted.ok, true, JSON.stringify(converted.diagnostics));
  assert.equal(converted.written, 7);
  assert.equal((await fs.readdir(options.outputDir)).filter(name => name.endsWith('.php')).length, 7);
  assert.ok(converted.files.every(file => file.php.includes('<?php') && file.sourcePath && file.verification?.semanticEqual === true));
  const forward = await previewDirectory({ inputDir: options.outputDir, outputDir: path.join(options.root, 'roundtrip'), targetVersion: 16 });
  assert.equal(forward.ok, true, JSON.stringify(forward.diagnostics));
});

for (const change of ['source', 'output', 'source-delete', 'output-delete', 'version', 'compiler', 'selection']) {
  test(`reverse guard blocks complete batch after ${change}`, async t => {
    const options = await fixture(t);
    assert.equal((await convertReverse(options)).ok, true);
    const output = path.join(options.outputDir, '示例.php');
    const manifestFile = path.join(options.outputDir, MANIFEST);
    if (change === 'source') await fs.appendFile(options.sourceFiles[0], '\n-- changed');
    if (change === 'output') await fs.appendFile(output, '\n// changed');
    if (change === 'source-delete') await fs.unlink(options.sourceFiles[0]);
    if (change === 'output-delete') await fs.unlink(output);
    if (change === 'version') options.targetVersion = 18;
    if (change === 'compiler') {
      const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      manifest.compilerVersion = 'old-version';
      await fs.writeFile(manifestFile, JSON.stringify(manifest));
    }
    if (change === 'selection') options.sourceFiles = [];
    const newSource = path.join(options.sourceDir, 'new.sql');
    await fs.writeFile(newSource, sql('new_table'));
    options.sourceFiles.push(newSource);
    const baseline = await fs.readFile(manifestFile, 'utf8');
    const blocked = await convertReverse(options);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.written, 0);
    assert.equal(await fs.readFile(manifestFile, 'utf8'), baseline);
    await assert.rejects(fs.stat(path.join(options.outputDir, 'new.php')), { code: 'ENOENT' });
  });
}

test('reverse permits additions and preserves unchanged mtime', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const output = path.join(options.outputDir, '示例.php');
  const mtime = (await fs.stat(output)).mtimeMs;
  const additional = path.join(options.sourceDir, 'migrations.新增.sql');
  await fs.writeFile(additional, sql('another'));
  options.sourceFiles.push(additional);
  const result = await convertReverse(options);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.written, 1);
  assert.equal(result.skipped, 1);
  assert.equal((await fs.stat(output)).mtimeMs, mtime);
  assert.ok(await fs.stat(path.join(options.outputDir, 'migrations.新增.php')));
});

test('reverse accepts identical untracked PHP and rejects mismatching untracked PHP', async t => {
  const options = await fixture(t);
  const preview = await previewReverse(options);
  await fs.mkdir(options.outputDir);
  const target = path.join(options.outputDir, '示例.php');
  await fs.writeFile(target, '<?php // manual');
  assert.equal((await convertReverse(options)).ok, false);
  assert.equal(await fs.readFile(target, 'utf8'), '<?php // manual');
  await fs.writeFile(target, preview.files[0].php);
  const converted = await convertReverse(options);
  assert.equal(converted.ok, true, JSON.stringify(converted.diagnostics));
  assert.equal(converted.written, 0);
});

test('reverse guard false backs up PHP and old manifest without removing unrelated files', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const manifest = await fs.readFile(path.join(options.outputDir, MANIFEST), 'utf8');
  await fs.writeFile(path.join(options.outputDir, '示例.php'), '<?php // manual');
  await fs.writeFile(path.join(options.outputDir, 'orphan.php'), '<?php // keep');
  const report = await convertReverse({ ...options, guard: false });
  assert.equal(report.ok, true, JSON.stringify(report.diagnostics));
  assert.equal(await fs.readFile(path.join(report.backupDir, '示例.php'), 'utf8'), '<?php // manual');
  assert.equal(await fs.readFile(path.join(report.backupDir, MANIFEST), 'utf8'), manifest);
  assert.equal(await fs.readFile(path.join(options.outputDir, 'orphan.php'), 'utf8'), '<?php // keep');
});

test('reverse rejects invalid batch member before writing any PHP', async t => {
  const options = await fixture(t, ['valid.sql', 'invalid.sql']);
  await fs.writeFile(options.sourceFiles[1], 'CREATE TABLE broken (');
  const report = await convertReverse(options);
  assert.equal(report.ok, false);
  assert.equal(report.written, 0);
  await assert.rejects(fs.stat(path.join(options.outputDir, 'valid.php')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(options.outputDir, MANIFEST)), { code: 'ENOENT' });
});

test('reverse rejects empty selection, duplicate names, relative paths and wrong extension', async t => {
  const options = await fixture(t);
  assert.equal((await previewReverse({ ...options, sourceFiles: [] })).ok, false);
  assert.equal((await previewReverse({ ...options, sourceFiles: ['relative.sql'] })).ok, false);
  assert.equal((await previewReverse({ ...options, outputDir: 'relative' })).ok, false);
  assert.equal((await previewReverse({ ...options, sourceFiles: [options.sourceFiles[0], options.sourceFiles[0]] })).ok, false);
  const other = path.join(options.root, 'other');
  await fs.mkdir(other);
  const duplicate = path.join(other, '示例.SQL');
  await fs.writeFile(duplicate, sql('other'));
  assert.equal((await previewReverse({ ...options, sourceFiles: [...options.sourceFiles, duplicate] })).ok, false);
  assert.equal((await previewReverse({ ...options, outputDir: options.sourceFiles[0] })).ok, false);
});

test('reverse manifest cannot redirect output beyond selected directory', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const target = path.join(options.outputDir, MANIFEST);
  const manifest = JSON.parse(await fs.readFile(target, 'utf8'));
  manifest.entries[0].outputName = '../outside.php';
  await fs.writeFile(target, JSON.stringify(manifest));
  const invalid = await convertReverse({ ...options, guard: false });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.diagnostics.some(item => item.code === 'INVALID_MANIFEST'));
});

test('reverse manifest cannot authorize reading an unselected SQL file', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const external = path.join(options.root, 'external.sql');
  await fs.writeFile(external, sql('external'));
  const manifestPath = path.join(options.outputDir, MANIFEST);
  const saved = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  Object.assign(saved.entries[0], { sourcePath: external, sourceName: 'external.sql', outputName: 'external.php' });
  await fs.writeFile(manifestPath, JSON.stringify(saved));
  const open = fs.open;
  let externalReads = 0;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (file === external) externalReads++;
    return open(file, ...args);
  });
  const report = await previewReverse(options);
  assert.equal(report.ok, false);
  assert.equal(externalReads, 0);
  assert.ok(report.diagnostics.some(item => item.code === 'SOURCE_NOT_SELECTED'));
});

test('reverse manifest direction cannot be silently adopted even with guard disabled', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const manifestPath = path.join(options.outputDir, MANIFEST);
  const saved = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  saved.direction = 'forward';
  await fs.writeFile(manifestPath, JSON.stringify(saved));
  const report = await convertReverse({ ...options, guard: false });
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'INVALID_MANIFEST'));
});

test('reverse PostgreSQL 18 output passes its matching semantic roundtrip', async t => {
  const options = await fixture(t);
  const report = await convertReverse({ ...options, targetVersion: 18 });
  assert.equal(report.ok, true, JSON.stringify(report.diagnostics));
  assert.equal(report.files[0].verification.semanticEqual, true);
  assert.equal(report.files[0].verification.targetVersion, 18);
  assert.equal(JSON.parse(await fs.readFile(path.join(options.outputDir, MANIFEST), 'utf8')).targetVersion, 18);
});

test('reverse file size cap is checked before parsing', async t => {
  const options = await fixture(t);
  const handle = await fs.open(options.sourceFiles[0], 'r+');
  await handle.truncate(32 * 1024 * 1024 + 1);
  await handle.close();
  const result = await previewReverse(options);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'SOURCE_TOO_LARGE'));
  await assert.rejects(fs.stat(options.outputDir), { code: 'ENOENT' });
});

test('reverse batch size cap is checked before any SQL parsing', async t => {
  const options = await fixture(t, ['a.sql', 'b.sql', 'c.sql', 'd.sql', 'e.sql']);
  for (const source of options.sourceFiles) {
    const handle = await fs.open(source, 'r+');
    await handle.truncate(26 * 1024 * 1024);
    await handle.close();
  }
  const result = await previewReverse(options);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'BATCH_TOO_LARGE'));
});

test('reverse rejects invalid UTF-8 instead of silently changing string data', async t => {
  const options = await fixture(t);
  await fs.writeFile(options.sourceFiles[0], Buffer.from([0x43, 0x52, 0x45, 0xff]));
  const result = await convertReverse(options);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'UNSUPPORTED_ENCODING'));
  await assert.rejects(fs.stat(path.join(options.outputDir, '示例.php')), { code: 'ENOENT' });
});

test('reverse rejects a selected junction parent or a redirected output parent', async t => {
  const options = await fixture(t);
  const redirect = path.join(options.root, 'redirect');
  try { await fs.symlink(options.sourceDir, redirect, 'junction'); } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('directory links unavailable');
    throw error;
  }
  assert.equal((await previewReverse({ ...options, sourceFiles: [path.join(redirect, '示例.sql')] })).ok, false);
  assert.equal((await convertReverse({ ...options, outputDir: path.join(redirect, 'migration') })).ok, false);
  await assert.rejects(fs.stat(options.outputDir), { code: 'ENOENT' });
});

test('reverse writer uses same lock as forward writer', async t => {
  const options = await fixture(t);
  await fs.mkdir(options.outputDir);
  const lock = JSON.stringify({ pid: process.pid, token: 'forward-writer' });
  const lockPath = path.join(options.outputDir, '.migration-sql.lock');
  await fs.writeFile(lockPath, lock);
  const report = await convertReverse(options);
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'WORKSPACE_LOCKED'));
  assert.equal(await fs.readFile(lockPath, 'utf8'), lock);
});

test('reverse write failure rolls back the whole PHP batch', async t => {
  const options = await fixture(t, ['first.sql', 'second.sql']);
  assert.equal((await convertReverse(options)).ok, true);
  const first = path.join(options.outputDir, 'first.php');
  const beforePhp = await fs.readFile(first, 'utf8');
  const beforeManifest = await fs.readFile(path.join(options.outputDir, MANIFEST), 'utf8');
  await fs.writeFile(options.sourceFiles[0], sql('changed_first'));
  await fs.writeFile(options.sourceFiles[1], sql('changed_second'));
  const link = fs.link;
  let injected = false;
  t.mock.method(fs, 'link', async (from, to) => {
    if (!injected && to === path.join(options.outputDir, 'second.php')) {
      injected = true;
      throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
    }
    return link(from, to);
  });
  const report = await convertReverse({ ...options, guard: false });
  assert.equal(report.ok, false);
  assert.equal(report.written, 0);
  assert.equal(await fs.readFile(first, 'utf8'), beforePhp);
  assert.equal(await fs.readFile(path.join(options.outputDir, MANIFEST), 'utf8'), beforeManifest);
  await assert.rejects(fs.stat(path.join(options.outputDir, '.migration-sql-transaction.json')), { code: 'ENOENT' });
});

test('reverse concurrent SQL change between writes aborts without committed PHP', async t => {
  const options = await fixture(t, ['first.sql', 'second.sql']);
  const link = fs.link;
  let injected = false;
  t.mock.method(fs, 'link', async (from, to) => {
    await link(from, to);
    if (!injected && to === path.join(options.outputDir, 'first.php')) {
      injected = true;
      await fs.appendFile(options.sourceFiles[1], '\n-- external edit');
    }
  });
  const report = await convertReverse(options);
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'CONCURRENT_CHANGE'));
  await assert.rejects(fs.stat(path.join(options.outputDir, 'first.php')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(options.outputDir, MANIFEST)), { code: 'ENOENT' });
});

async function interruptedReverse(options, beforePhp, afterPhp) {
  const id = randomUUID();
  const folder = path.join(options.outputDir, '.migration-sql-transactions', id);
  await fs.mkdir(folder, { recursive: true });
  const oldManifest = await fs.readFile(path.join(options.outputDir, MANIFEST));
  await fs.writeFile(path.join(folder, 'before-0'), beforePhp);
  await fs.writeFile(path.join(folder, 'before-1'), oldManifest);
  const journal = {
    schemaVersion: 1, direction: 'reverse', id,
    entries: [
      { name: '示例.php', beforeHash: sha(beforePhp), afterHash: sha(afterPhp) },
      { name: MANIFEST, beforeHash: sha(oldManifest), afterHash: sha('uncommitted manifest') },
    ],
  };
  await fs.writeFile(path.join(options.outputDir, '.migration-sql-transaction.json'), JSON.stringify(journal));
  await fs.writeFile(path.join(options.outputDir, '示例.php'), afterPhp);
  return folder;
}

test('reverse journal restores PHP before normal baseline validation', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const target = path.join(options.outputDir, '示例.php');
  const before = await fs.readFile(target, 'utf8');
  await interruptedReverse(options, before, '<?php // incomplete transaction');
  assert.equal((await previewReverse(options)).ok, false);
  const report = await convertReverse(options);
  assert.equal(report.ok, true, JSON.stringify(report.diagnostics));
  assert.equal(report.written, 0);
  assert.equal(await fs.readFile(target, 'utf8'), before);
});

test('reverse recovery preserves manual PHP changes made after interruption', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const target = path.join(options.outputDir, '示例.php');
  const before = await fs.readFile(target, 'utf8');
  const folder = await interruptedReverse(options, before, '<?php // incomplete transaction');
  await fs.writeFile(target, '<?php // manually rescued');
  const report = await convertReverse(options);
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'RECOVERY_CONFLICT'));
  assert.equal(await fs.readFile(target, 'utf8'), '<?php // manually rescued');
  assert.equal(await fs.readFile(path.join(folder, 'before-0'), 'utf8'), before);
});

test('reverse empty selection cannot erase an existing baseline with guard false', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const target = path.join(options.outputDir, MANIFEST);
  const before = await fs.readFile(target, 'utf8');
  assert.equal((await convertReverse({ ...options, sourceFiles: [], guard: false })).ok, false);
  assert.equal(await fs.readFile(target, 'utf8'), before);
});

test('reverse refuses to recover a forward journal that can alter its SQL sources', async t => {
  const options = await fixture(t);
  options.outputDir = options.sourceDir;
  const original = await fs.readFile(options.sourceFiles[0], 'utf8');
  const journal = {
    schemaVersion: 1, direction: 'forward', id: randomUUID(),
    entries: [
      { name: '示例.sql', beforeHash: sha('-- former SQL'), afterHash: sha(original) },
      { name: '.migration-sql-manifest.json', beforeHash: null, afterHash: sha('{}') },
    ],
  };
  const journalPath = path.join(options.outputDir, '.migration-sql-transaction.json');
  await fs.writeFile(journalPath, JSON.stringify(journal));
  const report = await convertReverse(options);
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'RECOVERY_DIRECTION_MISMATCH'));
  assert.equal(await fs.readFile(options.sourceFiles[0], 'utf8'), original);
  assert.deepEqual(JSON.parse(await fs.readFile(journalPath, 'utf8')), journal);
});

test('forward refuses to recover a reverse journal in its output directory', async t => {
  const options = await fixture(t);
  await convertReverse(options);
  const target = path.join(options.outputDir, '示例.php');
  const original = await fs.readFile(target, 'utf8');
  await interruptedReverse(options, original, '<?php // unfinished reverse');
  const inputDir = path.join(options.root, 'forward-input');
  await fs.mkdir(inputDir);
  await fs.writeFile(path.join(inputDir, 'one.php'), original);
  const report = await convertDirectory({ inputDir, outputDir: options.outputDir, targetVersion: 16 });
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'RECOVERY_DIRECTION_MISMATCH'));
  assert.equal(await fs.readFile(target, 'utf8'), '<?php // unfinished reverse');
});

test('reverse guard enforces aggregate read budget when source sizes grow after stat', async t => {
  const options = await fixture(t, ['a.sql', 'b.sql', 'c.sql', 'd.sql', 'e.sql']);
  assert.equal((await convertReverse(options)).ok, true);
  const selected = new Set(options.sourceFiles);
  const open = fs.open;
  let bytesReadTotal = 0;
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await open(name, ...args);
    if (selected.has(name) && args[0] === 'r') {
      let position = 0;
      handle.read = async buffer => {
        const bytesRead = Math.min(buffer.length, 32 * 1024 * 1024 - position);
        buffer.fill(0, 0, bytesRead);
        position += bytesRead;
        bytesReadTotal += bytesRead;
        return { buffer, bytesRead };
      };
    }
    return handle;
  });
  const report = await previewReverse(options);
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.some(item => item.code === 'BATCH_TOO_LARGE'));
  assert.ok(bytesReadTotal <= 128 * 1024 * 1024 + 1);
  assert.equal(report.files.length, 0);
});
