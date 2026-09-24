import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getTemplate, writeTemplate, validatePhp, TEMPLATES } from '../src/api.js';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-studio-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const run = (...args) => spawnSync(process.execPath, ['src/cli.js', ...args], { encoding: 'utf8', cwd: process.cwd() });

test('全部内置模板能生成 PG16/18；表名替换有效且不影响原模板', async () => {
  for (const template of TEMPLATES) for (const version of [16, 18]) {
    const result = await getTemplate(template.id, { targetVersion: version });
    assert.match(result.sql, /CREATE TABLE/i);
    assert.equal(result.targetVersion, version);
  }
  const renamed = await getTemplate('generic', { tableName: 'order_item' });
  assert.match(renamed.sql, /order_item/);
  assert.match(renamed.content, /dropIfExists\('order_item'\)/);
  assert.match((await getTemplate('generic')).content, /demo_item/);
  await assert.rejects(getTemplate('../secret'));
  await assert.rejects(getTemplate('generic', { tableName: "x'); unlink('bad" }));
});

test('模板只新建文件，拒绝覆盖、相对路径和非PHP路径', async (t) => {
  const dir = await temporary(t);
  const file = path.join(dir, 'create_orders.php');
  await writeTemplate({ id: 'generic', outputPath: file, tableName: 'orders' });
  const first = await fs.readFile(file, 'utf8');
  await assert.rejects(writeTemplate({ id: 'yudao', outputPath: file }));
  assert.equal(await fs.readFile(file, 'utf8'), first);
  await assert.rejects(writeTemplate({ id: 'generic', outputPath: 'relative.php' }));
  await assert.rejects(writeTemplate({ id: 'generic', outputPath: path.join(dir, 'a.txt') }));
  await assert.rejects(writeTemplate({ id: 'generic', outputPath: path.join(dir, 'nul.php') }));
});

test('CLI要求显式PG版本并对未知参数返回非零', () => {
  assert.equal(run('preview', '--input', 'a', '--output', 'b').status, 2);
  assert.equal(run('preview', '--pg-version', '17').status, 2);
  assert.equal(run('template', '--danger').status, 2);
  assert.equal(run('--help').status, 0);
});

test('CLI实际批次写出、再次跳过、篡改阻断及不覆盖模板', async (t) => {
  const dir = await temporary(t);
  const input = path.join(dir, 'input'); const output = path.join(dir, 'output');
  await fs.mkdir(input);
  const file = path.join(input, '2026_01_01_create_demo.php');
  assert.equal(run('template', '--id', 'generic', '--out', file, '--json').status, 0);
  assert.equal(run('template', '--id', 'generic', '--out', file, '--json').status, 2);
  const args = ['--input', input, '--output', output, '--pg-version', '16', '--json'];
  const preview = run('preview', ...args);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  await assert.rejects(fs.stat(output));
  const converted = run('convert', ...args);
  assert.equal(converted.status, 0, converted.stdout + converted.stderr);
  assert.equal(JSON.parse(converted.stdout).written, 1);
  assert.equal(JSON.parse(run('convert', ...args).stdout).skipped, 1);
  await fs.appendFile(file, '\n// 改过源文件');
  const rejected = run('convert', ...args);
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).ok, false);
});

test('校验包装保留诊断且不会执行任意PHP', () => {
  assert.equal(validatePhp({ source: '<?php system("not-executed");', targetVersion: 16 }).ok, false);
  assert.equal(validatePhp({ source: null, targetVersion: 16 }).ok, false);
});

test('MCP真实stdio握手、工具、资源、提示词和文件输出', async (t) => {
  const dir = await temporary(t);
  const input = path.join(dir, 'input'); await fs.mkdir(input);
  const output = path.join(dir, 'output');
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], stderr: 'pipe' });
  await client.connect(transport);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 10);
  assert.equal(tools.tools.find((item) => item.name === 'migration_convert').annotations.readOnlyHint, false);
  assert.equal((await client.listResources()).resources.length, 3);
  assert.match((await client.readResource({ uri: 'migration://ide-sdk' })).contents[0].text, /SqlStudio/);
  const sdk = await client.callTool({ name: 'migration_export_ide_sdk', arguments: { outputDir: dir, inputDir: input } });
  assert.notEqual(sdk.isError, true, sdk.content?.[0]?.text);
  assert.equal(JSON.parse(sdk.content[0].text).version, '0.5.0');
  assert.match((await client.readResource({ uri: 'migration://guide' })).contents[0].text, /PostgreSQL/);
  assert.equal((await client.listPrompts()).prompts.length, 2);
  assert.match((await client.getPrompt({ name: 'author_migration', arguments: { requirement: '商品表', targetVersion: '16' } })).messages[0].content.text, /商品表/);
  const template = await client.callTool({ name: 'migration_template', arguments: { id: 'generic', targetVersion: 16 } });
  assert.notEqual(template.isError, true);
  const php = JSON.parse(template.content[0].text).content;
  const validated = await client.callTool({ name: 'migration_validate', arguments: { source: php, targetVersion: 18 } });
  assert.equal(JSON.parse(validated.content[0].text).ok, true);
  const invalid = await client.callTool({ name: 'migration_validate', arguments: { source: php, targetVersion: 17 } });
  assert.equal(invalid.isError, true);
  const created = await client.callTool({ name: 'migration_write_template', arguments: { id: 'generic', outputPath: path.join(input, 'demo.php'), targetVersion: 16 } });
  assert.notEqual(created.isError, true);
  const overwrite = await client.callTool({ name: 'migration_write_template', arguments: { id: 'generic', outputPath: path.join(input, 'demo.php'), targetVersion: 16 } });
  assert.equal(overwrite.isError, true);
  const args = { inputDir: input, outputDir: output, targetVersion: 16 };
  const preview = await client.callTool({ name: 'migration_preview', arguments: args });
  assert.notEqual(preview.isError, true);
  await assert.rejects(fs.stat(output));
  const converted = await client.callTool({ name: 'migration_convert', arguments: args });
  assert.equal(JSON.parse(converted.content[0].text).written, 1);
  await fs.appendFile(path.join(input, 'demo.php'), '\n// changed');
  const blocked = await client.callTool({ name: 'migration_convert', arguments: args });
  assert.equal(blocked.isError, true);
});
