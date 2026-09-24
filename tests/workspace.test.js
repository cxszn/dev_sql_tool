import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { previewDirectory, convertDirectory } from '../src/core/workspace.js';

const manifestName = '.migration-sql-manifest.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const php = (name = 'demo') => `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Blueprint;
use Hyperf\\Database\\Schema\\Schema;
class CreateDemo extends Migration {
    public function up(): void {
        Schema::create('${name}', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('title')->nullable();
        });
    }
    public function down(): void {}
}`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-workspace-'));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  await fs.mkdir(inputDir);
  t.after(async () => {
    // Only remove the exact temporary workspace created by this test.
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'migration-workspace-')));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(inputDir, '001.php'), php());
  return { root, inputDir, outputDir, targetVersion: 16, guard: true, config: {} };
}

test('preview has no writes, convert preserves unchanged file mtime and appends new files', async t => {
  const options = await fixture(t);
  const preview = await previewDirectory(options);
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  assert.equal(preview.files[0].outputName, '001.sql');
  assert.equal(preview.written, 0);
  await assert.rejects(fs.stat(options.outputDir), { code: 'ENOENT' });
  assert.equal((await convertDirectory(options)).written, 1);
  const output = path.join(options.outputDir, '001.sql');
  const before = (await fs.stat(output)).mtimeMs;
  await fs.mkdir(path.join(options.inputDir, 'nested'));
  await fs.writeFile(path.join(options.inputDir, 'nested', 'migrations.002.php'), php('extra'));
  const added = await convertDirectory(options);
  assert.equal(added.ok, true, JSON.stringify(added.diagnostics));
  assert.equal(added.written, 1);
  assert.equal(added.skipped, 1);
  assert.equal((await fs.stat(output)).mtimeMs, before);
  assert.match(await fs.readFile(path.join(options.outputDir, 'nested', '002.sql'), 'utf8'), /extra/);
});

for (const change of ['source', 'output', 'source-delete', 'output-delete', 'version', 'config']) {
  test(`guard blocks entire batch after ${change}`, async t => {
    const options = await fixture(t);
    assert.equal((await convertDirectory(options)).ok, true);
    const oldManifest = await fs.readFile(path.join(options.outputDir, manifestName), 'utf8');
    if (change === 'source') await fs.appendFile(path.join(options.inputDir, '001.php'), '\n// modified');
    if (change === 'output') await fs.appendFile(path.join(options.outputDir, '001.sql'), '\n-- modified');
    if (change === 'source-delete') await fs.unlink(path.join(options.inputDir, '001.php'));
    if (change === 'output-delete') await fs.unlink(path.join(options.outputDir, '001.sql'));
    if (change === 'version') options.targetVersion = 18;
    if (change === 'config') options.config = { table: 'new' };
    await fs.writeFile(path.join(options.inputDir, '002.php'), php('extra'));
    const result = await convertDirectory(options);
    assert.equal(result.ok, false);
    assert.equal(result.written, 0);
    await assert.rejects(fs.stat(path.join(options.outputDir, '002.sql')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(options.outputDir, manifestName), 'utf8'), oldManifest);
  });
}

test('any parsing error leaves all SQL and manifest unwritten', async t => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.inputDir, '002.php'), '<?php this is not PHP');
  const result = await convertDirectory(options);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.file === '002.php'));
  await assert.rejects(fs.stat(path.join(options.outputDir, '001.sql')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(options.outputDir, manifestName)), { code: 'ENOENT' });
});

test('unregistered output is accepted only if byte-identical', async t => {
  const options = await fixture(t);
  const preview = await previewDirectory(options);
  await fs.mkdir(options.outputDir);
  const target = path.join(options.outputDir, '001.sql');
  await fs.writeFile(target, 'manual content');
  assert.equal((await convertDirectory(options)).ok, false);
  assert.equal(await fs.readFile(target, 'utf8'), 'manual content');
  await fs.writeFile(target, preview.files[0].sql);
  const before = (await fs.stat(target)).mtimeMs;
  const result = await convertDirectory(options);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.written, 0);
  assert.equal((await fs.stat(target)).mtimeMs, before);
});

test('guard false preserves replaced output and manifest in a unique backup', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const target = path.join(options.outputDir, '001.sql');
  await fs.writeFile(target, 'manual content');
  const manifest = await fs.readFile(path.join(options.outputDir, manifestName), 'utf8');
  await fs.writeFile(path.join(options.outputDir, 'orphan.sql'), 'keep me');
  const result = await convertDirectory({ ...options, guard: false });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.backupDir);
  assert.equal(await fs.readFile(path.join(result.backupDir, '001.sql'), 'utf8'), 'manual content');
  assert.equal(await fs.readFile(path.join(result.backupDir, manifestName), 'utf8'), manifest);
  assert.equal(await fs.readFile(path.join(options.outputDir, 'orphan.sql'), 'utf8'), 'keep me');
});

test('empty source cannot erase an old baseline even with guard disabled', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const manifest = await fs.readFile(path.join(options.outputDir, manifestName), 'utf8');
  await fs.unlink(path.join(options.inputDir, '001.php'));
  assert.equal((await convertDirectory({ ...options, guard: false })).ok, false);
  assert.equal(await fs.readFile(path.join(options.outputDir, manifestName), 'utf8'), manifest);
});

test('rejects output collisions and overlapping or relative directories', async t => {
  const options = await fixture(t);
  for (const outputDir of [options.inputDir, path.join(options.inputDir, 'out'), options.root, 'relative']) {
    const result = await previewDirectory({ ...options, outputDir });
    assert.equal(result.ok, false, outputDir);
  }
  await fs.writeFile(path.join(options.inputDir, 'migrations.001.php'), php('other'));
  assert.equal((await convertDirectory(options)).ok, false);
});

test('manifest paths cannot escape the selected roots', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const file = path.join(options.outputDir, manifestName);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.entries[0].outputName = '../outside.sql';
  await fs.writeFile(file, JSON.stringify(manifest));
  const result = await convertDirectory({ ...options, guard: false });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'INVALID_MANIFEST'));
});

test('active writer lock is never stolen', async t => {
  const options = await fixture(t);
  await fs.mkdir(options.outputDir);
  const lockFile = path.join(options.outputDir, '.migration-sql.lock');
  const content = JSON.stringify({ pid: process.pid, token: 'other-writer' });
  await fs.writeFile(lockFile, content);
  const result = await convertDirectory(options);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'WORKSPACE_LOCKED'));
  assert.equal(await fs.readFile(lockFile, 'utf8'), content);
});

test('configuration key order does not invalidate a baseline', async t => {
  const options = await fixture(t);
  options.config = { z: 2, a: { y: true, x: 'value' } };
  assert.equal((await convertDirectory(options)).ok, true);
  const result = await convertDirectory({ ...options, config: { a: { x: 'value', y: true }, z: 2 } });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.written, 0);
});

test('write failure rolls back prior SQL and leaves previous manifest intact', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const sql = await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8');
  const manifest = await fs.readFile(path.join(options.outputDir, manifestName), 'utf8');
  await fs.writeFile(path.join(options.inputDir, '001.php'), php('changed'));
  await fs.writeFile(path.join(options.inputDir, '002.php'), php('second'));
  const link = fs.link;
  let injected = false;
  t.mock.method(fs, 'link', async (from, to) => {
    if (!injected && to === path.join(options.outputDir, '002.sql')) {
      injected = true;
      throw Object.assign(new Error('simulated disk write failure'), { code: 'EIO' });
    }
    return link(from, to);
  });
  const failed = await convertDirectory({ ...options, guard: false });
  assert.equal(injected, true);
  assert.equal(failed.ok, false);
  assert.equal(failed.written, 0);
  assert.equal(await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8'), sql);
  assert.equal(await fs.readFile(path.join(options.outputDir, manifestName), 'utf8'), manifest);
  await assert.rejects(fs.stat(path.join(options.outputDir, '002.sql')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(options.outputDir, '.migration-sql-transaction.json')), { code: 'ENOENT' });
});

test('concurrent source change during writes aborts and rolls back', async t => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.inputDir, '002.php'), php('second'));
  const link = fs.link;
  let injected = false;
  t.mock.method(fs, 'link', async (from, to) => {
    await link(from, to);
    if (!injected && to === path.join(options.outputDir, '001.sql')) {
      injected = true;
      await fs.appendFile(path.join(options.inputDir, '002.php'), '\n// concurrently edited');
    }
  });
  const failed = await convertDirectory(options);
  assert.equal(failed.ok, false);
  assert.ok(failed.diagnostics.some(item => item.code === 'CONCURRENT_CHANGE'));
  await assert.rejects(fs.stat(path.join(options.outputDir, '001.sql')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(options.outputDir, manifestName)), { code: 'ENOENT' });
  assert.match(await fs.readFile(path.join(options.inputDir, '002.php'), 'utf8'), /concurrently edited/);
});

async function interruptedTransaction(options, beforeSql, afterSql, afterManifest = 'uncommitted manifest') {
  const id = randomUUID();
  const folder = path.join(options.outputDir, '.migration-sql-transactions', id);
  await fs.mkdir(folder, { recursive: true });
  const manifest = await fs.readFile(path.join(options.outputDir, manifestName)).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (beforeSql !== null) await fs.writeFile(path.join(folder, 'before-0'), beforeSql);
  if (manifest !== null) await fs.writeFile(path.join(folder, 'before-1'), manifest);
  await fs.writeFile(path.join(folder, 'after-1'), afterManifest);
  const journal = {
    schemaVersion: 1,
    id,
    entries: [
      { name: '001.sql', beforeHash: beforeSql === null ? null : hash(beforeSql), afterHash: hash(afterSql) },
      { name: manifestName, beforeHash: manifest === null ? null : hash(manifest), afterHash: hash(afterManifest) },
    ],
  };
  await fs.writeFile(path.join(options.outputDir, '.migration-sql-transaction.json'), JSON.stringify(journal));
  await fs.writeFile(path.join(options.outputDir, '001.sql'), afterSql);
  return { folder, journal };
}

test('next conversion recovers an interrupted transaction before checking guard', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const oldSql = await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8');
  await interruptedTransaction(options, oldSql, '-- partial transaction SQL');
  const preview = await previewDirectory(options);
  assert.equal(preview.ok, false);
  assert.ok(preview.diagnostics.some(item => item.code === 'RECOVERY_REQUIRED'));
  const recovered = await convertDirectory(options);
  assert.equal(recovered.ok, true, JSON.stringify(recovered.diagnostics));
  assert.equal(recovered.written, 0);
  assert.equal(await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8'), oldSql);
  await assert.rejects(fs.stat(path.join(options.outputDir, '.migration-sql-transaction.json')), { code: 'ENOENT' });
});

test('recovery refuses to overwrite a manual edit made after interruption', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const oldSql = await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8');
  const { folder } = await interruptedTransaction(options, oldSql, '-- partial transaction SQL');
  await fs.writeFile(path.join(options.outputDir, '001.sql'), 'manual rescue');
  const result = await convertDirectory({ ...options, guard: false });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'RECOVERY_CONFLICT'));
  assert.equal(await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8'), 'manual rescue');
  assert.equal(await fs.readFile(path.join(folder, 'before-0'), 'utf8'), oldSql);
  assert.ok(await fs.stat(path.join(options.outputDir, '.migration-sql-transaction.json')));
});

test('interrupted cleanup after manifest commit does not require already removed backups', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const sql = await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8');
  const manifest = await fs.readFile(path.join(options.outputDir, manifestName), 'utf8');
  const { folder } = await interruptedTransaction(options, 'old content', sql, manifest);
  await fs.unlink(path.join(folder, 'before-0'));
  await fs.unlink(path.join(folder, 'before-1'));
  const recovered = await convertDirectory(options);
  assert.equal(recovered.ok, true, JSON.stringify(recovered.diagnostics));
  assert.equal(await fs.readFile(path.join(options.outputDir, '001.sql'), 'utf8'), sql);
});

test('dead-process lock can be reclaimed without losing a pending transaction', async t => {
  const options = await fixture(t);
  await fs.mkdir(options.outputDir);
  await fs.writeFile(path.join(options.outputDir, '.migration-sql.lock'), JSON.stringify({ pid: 2147483647, token: 'dead-writer' }));
  const result = await convertDirectory(options);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('directory links and redirected output parents are rejected', async t => {
  const options = await fixture(t);
  const external = path.join(options.root, 'external');
  await fs.mkdir(external);
  const linked = path.join(options.inputDir, 'linked');
  try { await fs.symlink(external, linked, 'junction'); } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('test account cannot create directory links');
    throw error;
  }
  assert.equal((await previewDirectory(options)).ok, false);
  await fs.unlink(linked);
  const redirect = path.join(options.root, 'redirect');
  await fs.symlink(external, redirect, 'junction');
  const result = await convertDirectory({ ...options, outputDir: path.join(redirect, 'nested') });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === 'UNSAFE_PATH'));
  await assert.rejects(fs.stat(path.join(external, 'nested')), { code: 'ENOENT' });
});

test('requires explicit supported version and plain JSON config', async t => {
  const options = await fixture(t);
  for (const targetVersion of [undefined, 17, '16']) assert.equal((await previewDirectory({ ...options, targetVersion })).ok, false);
  for (const config of [null, [], new Date(), { unsafe: undefined }]) assert.equal((await previewDirectory({ ...options, config })).ok, false);
});

test('lock sync failure removes only the lock created by the failed attempt', async t => {
  const options = await fixture(t);
  const open = fs.open;
  let injected = false;
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await open(name, ...args);
    if (!injected && name === path.join(options.outputDir, '.migration-sql.lock')) {
      injected = true;
      handle.sync = async () => { throw Object.assign(new Error('simulated sync failure'), { code: 'EIO' }); };
    }
    return handle;
  });
  const failure = await convertDirectory(options);
  assert.equal(failure.ok, false);
  await assert.rejects(fs.stat(path.join(options.outputDir, '.migration-sql.lock')), { code: 'ENOENT' });
  assert.equal((await convertDirectory(options)).ok, true);
});

test('journal publication failure cannot expose a partial active journal or SQL', async t => {
  const options = await fixture(t);
  const link = fs.link;
  let injected = false;
  t.mock.method(fs, 'link', async (from, to) => {
    if (!injected && to === path.join(options.outputDir, '.migration-sql-transaction.json')) {
      injected = true;
      const staged = JSON.parse(await fs.readFile(from, 'utf8'));
      assert.equal(staged.schemaVersion, 1);
      assert.equal(staged.entries.at(-1).name, manifestName);
      throw Object.assign(new Error('simulated publication failure'), { code: 'EIO' });
    }
    return link(from, to);
  });
  assert.equal((await convertDirectory(options)).ok, false);
  await assert.rejects(fs.stat(path.join(options.outputDir, '.migration-sql-transaction.json')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(options.outputDir, '001.sql')), { code: 'ENOENT' });
  assert.equal((await convertDirectory(options)).ok, true);
});

test('SQL edited at the exact replacement boundary is preserved and reported', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  await fs.writeFile(path.join(options.inputDir, '001.php'), php('changed'));
  const target = path.join(options.outputDir, '001.sql');
  const rename = fs.rename;
  let injected = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (!injected && from === target && path.basename(to) === 'captured-0') {
      injected = true;
      await fs.writeFile(target, '-- editor save at replacement boundary');
    }
    return rename(from, to);
  });
  const failed = await convertDirectory({ ...options, guard: false });
  assert.equal(failed.ok, false);
  assert.ok(failed.diagnostics.some(item => item.code === 'CONCURRENT_CHANGE'));
  assert.equal(await fs.readFile(target, 'utf8'), '-- editor save at replacement boundary');
  assert.ok(await fs.stat(path.join(options.outputDir, '.migration-sql-transaction.json')));
});

test('new SQL created at the publication boundary is not overwritten', async t => {
  const options = await fixture(t);
  const target = path.join(options.outputDir, '001.sql');
  const link = fs.link;
  let injected = false;
  t.mock.method(fs, 'link', async (from, to) => {
    if (!injected && to === target) {
      injected = true;
      await fs.writeFile(target, '-- manually created during conversion');
    }
    return link(from, to);
  });
  const failed = await convertDirectory(options);
  assert.equal(failed.ok, false);
  assert.equal(await fs.readFile(target, 'utf8'), '-- manually created during conversion');
});

test('interruption after holding old SQL and before publishing new SQL is recovered', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const target = path.join(options.outputDir, '001.sql');
  const sql = await fs.readFile(target, 'utf8');
  const { folder } = await interruptedTransaction(options, sql, '-- pending generated SQL');
  await fs.writeFile(path.join(folder, 'captured-0'), sql);
  await fs.unlink(target);
  const recovered = await convertDirectory(options);
  assert.equal(recovered.ok, true, JSON.stringify(recovered.diagnostics));
  assert.equal(await fs.readFile(target, 'utf8'), sql);
});

test('interrupted cleanup after rollback tolerates missing no-longer-needed backups', async t => {
  const options = await fixture(t);
  await convertDirectory(options);
  const target = path.join(options.outputDir, '001.sql');
  const sql = await fs.readFile(target, 'utf8');
  const { folder } = await interruptedTransaction(options, sql, '-- pending generated SQL');
  await fs.writeFile(target, sql);
  await fs.unlink(path.join(folder, 'before-0'));
  await fs.unlink(path.join(folder, 'before-1'));
  const recovered = await convertDirectory(options);
  assert.equal(recovered.ok, true, JSON.stringify(recovered.diagnostics));
});

test('two simultaneous conversions serialize through exclusive workspace lock', async t => {
  const options = await fixture(t);
  const reports = await Promise.all([convertDirectory(options), convertDirectory(options)]);
  assert.equal(reports.filter(report => report.ok).length, 1);
  assert.equal(reports.filter(report => report.diagnostics.some(item => item.code === 'WORKSPACE_LOCKED')).length, 1);
  assert.ok(await fs.stat(path.join(options.outputDir, '001.sql')));
});

test('forward input ignores tool-owned PHP backup and transaction copies', async t => {
  const options = await fixture(t);
  for (const folder of ['.migration-sql-backups', '.migration-sql-transactions']) {
    const target = path.join(options.inputDir, folder, 'old-batch');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, '001.php'), '<?php intentionally not a migration');
  }
  const preview = await previewDirectory(options);
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  assert.equal(preview.files.length, 1);
  assert.equal(preview.files[0].sourceName, '001.php');
});

test('forward input waits for an unfinished reverse publication to be resolved', async t => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.inputDir, '.migration-sql-transaction.json'), '{}');
  const preview = await previewDirectory(options);
  assert.equal(preview.ok, false);
  assert.ok(preview.diagnostics.some(item => item.code === 'RECOVERY_REQUIRED'));
  await assert.rejects(fs.stat(options.outputDir), { code: 'ENOENT' });
});
