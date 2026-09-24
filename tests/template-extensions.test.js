import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTemplate, capabilities, VERSION } from '../src/api.js';
import { previewDirectory, convertDirectory } from '../src/core/workspace.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = (rows = "[['id'=>1,'name'=>'permission']]") => `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Schema;
class CreateDemo extends Migration {
    public bool $exists_drop = true;
    public function up() { Schema::create('permission', function ($table) { $table->id(); $table->string('name'); }); }
    public function data() { return ${rows}; }
}`;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-extensions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputDir = path.join(root, 'input');
  await fs.mkdir(inputDir);
  await fs.writeFile(path.join(inputDir, 'demo.php'), source());
  return { inputDir, outputDir: path.join(root, 'output'), targetVersion: 16, guard: true };
}

test('seeded template is discoverable, uses safe default, and follows custom table name', async () => {
  assert.equal(VERSION, '0.5.0');
  const template = await getTemplate('seeded', { targetVersion: 18, tableName: 'demo_seed_renamed' });
  assert.match(template.content, /exists_drop\s*=\s*false/);
  assert.match(template.sql, /INSERT INTO "public"\."demo_seed_renamed"/);
  assert.doesNotMatch(template.sql, /DROP TABLE/);
  assert.equal(template.summary.seedRows, 2);
  assert.deepEqual(capabilities().unsupportedTemplateExtensions, []);
});

test('preview and conversion preserve seed count and destructive SQL summary', async (t) => {
  const options = await fixture(t);
  const preview = await previewDirectory(options);
  assert.equal(preview.ok, true, JSON.stringify(preview.diagnostics));
  assert.deepEqual(preview.files[0].summary, { seedRows: 1, destructive: true, creates: 1 });
  await assert.rejects(fs.stat(options.outputDir));
  const result = await convertDirectory(options);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const sql = await fs.readFile(path.join(options.outputDir, 'demo.sql'), 'utf8');
  assert.match(sql, /DROP TABLE IF EXISTS "public"\."permission"/);
  assert.match(sql, /INSERT INTO "public"\."permission"/);
  assert.match(sql, /CREATE SEQUENCE[^;]+START WITH 2;/);
  assert.doesNotMatch(sql, /setval\(/i);
});

test('unsupported data prevents the whole batch from writing', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.inputDir, 'bad.php'), source('getenv("NO_EXECUTION")'));
  const report = await convertDirectory(options);
  assert.equal(report.ok, false);
  assert.equal(report.written, 0);
  await assert.rejects(fs.stat(path.join(options.outputDir, 'demo.sql')));
});

for (const previousVersion of ['0.1.0', '0.2.0', '0.3.0']) test(`compiler ${previousVersion} baseline remains protected and regeneration backs it up`, async (t) => {
  const options = await fixture(t);
  assert.equal((await convertDirectory(options)).ok, true);
  const manifestPath = path.join(options.outputDir, '.migration-sql-manifest.json');
  const sqlPath = path.join(options.outputDir, 'demo.sql');
  const oldSql = '-- representative SQL generated with the old compiler\nCREATE TABLE old_version_example(id bigint);\n';
  await fs.writeFile(sqlPath, oldSql);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.compilerVersion = previousVersion;
  manifest.entries[0].outputHash = sha(oldSql);
  const oldManifest = JSON.stringify(manifest);
  await fs.writeFile(manifestPath, oldManifest);
  const blocked = await convertDirectory(options);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.diagnostics.some((item) => item.code === 'BASELINE_OPTIONS_CHANGED'));
  assert.equal(await fs.readFile(sqlPath, 'utf8'), oldSql);
  assert.equal(await fs.readFile(manifestPath, 'utf8'), oldManifest);
  const regenerated = await convertDirectory({ ...options, guard: false });
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.ok(regenerated.backupDir);
  assert.equal(await fs.readFile(path.join(regenerated.backupDir, 'demo.sql'), 'utf8'), oldSql);
  assert.equal(await fs.readFile(path.join(regenerated.backupDir, '.migration-sql-manifest.json'), 'utf8'), oldManifest);
  assert.match(await fs.readFile(sqlPath, 'utf8'), /INSERT INTO/);
});

test('MCP seeded template and direct validation expose supported extensions', async (t) => {
  const client = new Client({ name: 'extension-integration-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], stderr: 'pipe' }));
  t.after(() => client.close());
  const template = await client.callTool({ name: 'migration_template', arguments: { id: 'seeded', targetVersion: 16 } });
  assert.notEqual(template.isError, true);
  assert.match(JSON.parse(template.content[0].text).sql, /INSERT INTO/);
  const valid = await client.callTool({ name: 'migration_validate', arguments: { source: source(), targetVersion: 18 } });
  assert.notEqual(valid.isError, true);
  const converted = JSON.parse(valid.content[0].text);
  assert.equal(converted.summary.seedRows, 1);
  assert.equal(converted.summary.destructive, true);
  assert.ok(converted.warnings.some((item) => item.code === 'DESTRUCTIVE_OPERATION'));
});
