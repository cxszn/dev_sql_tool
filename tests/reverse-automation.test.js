import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { validateSql, validatePhp, VERSION, capabilities } from '../src/api.js';

const sql = `BEGIN;
SET LOCAL standard_conforming_strings=on;
DROP TABLE IF EXISTS rb_child;
DROP TABLE IF EXISTS rb_parent;
DROP SEQUENCE IF EXISTS rb_parent_seq;
CREATE SEQUENCE rb_parent_seq START WITH 12;
CREATE TABLE rb_parent (id bigint NOT NULL DEFAULT nextval('rb_parent_seq'::regclass), created_at timestamp NOT NULL, deleted smallint NOT NULL DEFAULT 0, CONSTRAINT rb_parent_custom_pk PRIMARY KEY(id));
ALTER SEQUENCE rb_parent_seq OWNED BY rb_parent.id;
COMMENT ON TABLE rb_parent IS '逆向测试';
CREATE UNIQUE INDEX rb_parent_active ON rb_parent(id) WHERE deleted=0;
CREATE INDEX rb_parent_recent ON rb_parent(created_at DESC);
CREATE TABLE rb_child (id bigint NOT NULL PRIMARY KEY, parent_id bigint, CONSTRAINT rb_fk FOREIGN KEY(parent_id) REFERENCES rb_parent(id) ON DELETE RESTRICT ON UPDATE RESTRICT);
INSERT INTO rb_parent(id,created_at,deleted) VALUES(7,'2026-01-01 00:00:00.123456',0);
INSERT INTO rb_child(id,parent_id) VALUES(1,7);
COMMIT;`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reverse-automation-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('reverse-automation-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const input = path.join(directory, '测试.sql');
  await fs.writeFile(input, sql);
  const list = path.join(directory, 'sources.json');
  await fs.writeFile(list, JSON.stringify([input]));
  return { directory, input, list, output: path.join(directory, 'migration') };
}
const cli = (...args) => spawnSync(process.execPath, ['src/cli.js', ...args], { encoding: 'utf8' });

test('SQL API retains multi-table structure and values across both PostgreSQL versions', async () => {
  assert.equal(VERSION, '0.5.0');
  assert.ok(capabilities().reverse);
  for (const targetVersion of [16, 18]) {
    const result = await validateSql({ source: sql, sourceName: 'fixture.sql', targetVersion });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.verification.semanticEqual, true);
    assert.equal(result.summary.tables, 2);
    assert.equal(result.summary.seedRows, 2);
    assert.match(result.php, /startingValue/);
    assert.match(result.php, /uniqueIndex/);
    const back = validatePhp({ source: result.php, targetVersion });
    assert.equal(back.ok, true, JSON.stringify(back.diagnostics));
    assert.match(back.sql, /START WITH 12/);
    assert.match(back.sql, /123456/);
    assert.match(back.sql, /CREATE UNIQUE INDEX/);
    assert.match(back.sql, /DESC/);
  }
  const unsupported = await validateSql({ source: 'DELETE FROM private_table;', sourceName: 'unsupported.sql', targetVersion: 16 });
  assert.equal(unsupported.ok, false);
});

test('reverse CLI requires explicit files, previews without writes and preserves edited PHP', async (t) => {
  const item = await fixture(t);
  const args = ['--files', item.list, '--output', item.output, '--pg-version', '16', '--json'];
  assert.equal(cli('reverse-preview', '--files', item.list).status, 2);
  const preview = cli('reverse-preview', ...args);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  await assert.rejects(fs.stat(item.output));
  const generated = cli('reverse-convert', ...args);
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  assert.equal(JSON.parse(generated.stdout).written, 1);
  const output = path.join(item.output, '测试.php');
  await fs.appendFile(output, '\n// manual edit');
  const before = await fs.readFile(output, 'utf8');
  const blocked = cli('reverse-convert', ...args);
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).ok, false);
  assert.equal(await fs.readFile(output, 'utf8'), before);
  assert.equal(await fs.readFile(item.input, 'utf8'), sql);
});

test('MCP reverse tools validate, preview and write PHP through the shared guard', async (t) => {
  const item = await fixture(t);
  const client = new Client({ name: 'reverse-automation', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], stderr: 'pipe' }));
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 10);
  const validated = await client.callTool({ name: 'migration_reverse_validate', arguments: { source: sql, targetVersion: 18 } });
  assert.notEqual(validated.isError, true, validated.content?.[0]?.text);
  assert.equal(JSON.parse(validated.content[0].text).verification.semanticEqual, true);
  const args = { sourceFiles: [item.input], outputDir: item.output, targetVersion: 16 };
  const preview = await client.callTool({ name: 'migration_reverse_preview', arguments: args });
  assert.notEqual(preview.isError, true, preview.content?.[0]?.text);
  await assert.rejects(fs.stat(item.output));
  const written = await client.callTool({ name: 'migration_reverse_convert', arguments: args });
  assert.notEqual(written.isError, true, written.content?.[0]?.text);
  assert.equal(JSON.parse(written.content[0].text).written, 1);
  assert.match(await fs.readFile(path.join(item.output, '测试.php'), 'utf8'), /function up/);
  assert.equal(await fs.readFile(item.input, 'utf8'), sql);
});

test('reverse-validate CLI rejects invalid UTF-8 and oversized SQL before parsing', async (t) => {
  const item = await fixture(t);
  await fs.writeFile(item.input, Buffer.concat([Buffer.from("CREATE TABLE t (v text); INSERT INTO t VALUES ('"), Buffer.from([0xff]), Buffer.from("');")]));
  const invalid = cli('reverse-validate', '--file', item.input, '--pg-version', '16', '--json');
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).ok, false);
  const handle = await fs.open(item.input, 'w');
  try { await handle.truncate(32 * 1024 * 1024 + 1); } finally { await handle.close(); }
  const oversized = cli('reverse-validate', '--file', item.input, '--pg-version', '16', '--json');
  assert.equal(oversized.status, 2);
  assert.equal(JSON.parse(oversized.stdout).ok, false);
});
