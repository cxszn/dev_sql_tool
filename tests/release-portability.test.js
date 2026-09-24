import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeMcpConfig } from '../scripts/write-mcp-config.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sql-studio-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'original');
  await fs.mkdir(path.join(directory, 'resources', 'app', 'src'), { recursive: true });
  await fs.writeFile(path.join(directory, 'Migration SQL Studio.exe'), 'fixture');
  await fs.writeFile(path.join(directory, 'resources', 'app', 'src', 'mcp.js'), 'fixture');
  await fs.writeFile(path.join(directory, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'migration-sql-studio', version: '0.5.0' }));
  return { root, directory };
}

test('portable MCP configuration derives executable and script from relocated directory', async t => {
  const { root, directory } = await fixture(t);
  const relocated = path.join(root, '其他位置 with spaces');
  await fs.rename(directory, relocated);
  const result = await writeMcpConfig(relocated);
  assert.equal(result.created, true);
  const content = await fs.readFile(result.path, 'utf8');
  const configuration = JSON.parse(content).mcpServers['migration-sql'];
  assert.equal(configuration.command, path.join(relocated, 'Migration SQL Studio.exe'));
  assert.deepEqual(configuration.args, [path.join(relocated, 'resources', 'app', 'src', 'mcp.js')]);
  assert.deepEqual(configuration.env, { ELECTRON_RUN_AS_NODE: '1' });
  assert.equal((await writeMcpConfig(relocated)).created, false);
  assert.equal(await fs.readFile(result.path, 'utf8'), content);
});

test('portable MCP configuration preserves an existing different file', async t => {
  const { directory } = await fixture(t);
  const output = path.join(directory, 'MCP配置.json');
  const original = '{"userConfiguration":true}\n';
  await fs.writeFile(output, original);
  await assert.rejects(writeMcpConfig(directory), /已存在且内容不同，未覆盖/);
  assert.equal(await fs.readFile(output, 'utf8'), original);
});

test('portable MCP generation requires an absolute complete application directory', async t => {
  const { root, directory } = await fixture(t);
  await assert.rejects(writeMcpConfig('.'), /绝对目录/);
  await assert.rejects(writeMcpConfig(root), /不是完整/);
  await fs.writeFile(path.join(directory, 'resources', 'app', 'package.json'), '{"name":"other-app"}');
  await assert.rejects(writeMcpConfig(directory), /应用名称不匹配/);
  await assert.rejects(fs.stat(path.join(directory, 'MCP配置.json')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, 'MCP配置.json')), { code: 'ENOENT' });
});
