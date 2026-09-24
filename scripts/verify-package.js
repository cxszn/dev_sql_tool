import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = path.resolve(process.argv[2] ?? '');
const executable = path.join(directory, 'Migration SQL Studio.exe');
const generator = path.join(directory, 'resources', 'app', 'scripts', 'write-mcp-config.js');
const generated = spawnSync(executable, [generator, '--package-dir', directory], {
  encoding: 'utf8', timeout: 20000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
assert.equal(generated.status, 0, generated.stderr);
const configuration = JSON.parse(await fs.readFile(path.join(directory, 'MCP配置.json'), 'utf8')).mcpServers['migration-sql'];
assert.equal(configuration.command, executable);
assert.deepEqual(configuration.args, [path.join(directory, 'resources', 'app', 'src', 'mcp.js')]);
const cli = path.join(directory, 'resources/app/src/cli.js');
const result = spawnSync(configuration.command, [cli, 'capabilities'], {
  encoding: 'utf8', timeout: 20000, windowsHide: true, env: { ...process.env, ...configuration.env },
});
assert.equal(result.status, 0, result.stderr);
const capability = JSON.parse(result.stdout);
assert.deepEqual(capability.targetVersions, [16, 18]);
assert.equal(capability.version, '0.5.0');
const client = new Client({ name: 'packaged-runtime-test', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ ...configuration, stderr: 'pipe' }));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 10);
  const sdkDirectory = path.join(directory, 'resources/app/php-sdk');
  for (const name of ['Migrations/Migration.php', 'Schema/Schema.php', 'Schema/Blueprint.php', 'Schema/ColumnDefinition.php', 'Schema/ForeignKeyDefinition.php', 'Schema/ForeignIdColumnDefinition.php']) {
    assert.match(await fs.readFile(path.join(sdkDirectory, 'src', name), 'utf8'), /namespace SqlStudio/);
  }
  assert.match((await client.readResource({ uri: 'migration://ide-sdk' })).contents[0].text, /SqlStudio/);
  const template = await client.callTool({ name: 'migration_template', arguments: { id: 'yudao', targetVersion: 18 } });
  assert.notEqual(template.isError, true);
  assert.match(JSON.parse(template.content[0].text).sql, /PostgreSQL 18/);
  assert.match(JSON.parse(template.content[0].text).content, /use SqlStudio\\Migrations\\Migration;/);
  for (const targetVersion of [16, 18]) {
    const imported = await client.callTool({ name: 'migration_reverse_validate', arguments: {
      source: "CREATE TABLE reverse_smoke (id bigint PRIMARY KEY, note varchar(12)); INSERT INTO reverse_smoke VALUES (1, 'portable');", sourceName: 'reverse-smoke.sql', targetVersion,
    } });
    assert.notEqual(imported.isError, true, imported.content?.[0]?.text);
    const reversed = JSON.parse(imported.content[0].text);
    assert.equal(reversed.summary.tables, 1);
    assert.equal(reversed.summary.seedRows, 1);
    assert.equal(reversed.verification.semanticEqual, true);
    assert.match(reversed.php, /Schema::create\('reverse_smoke',/);
    assert.doesNotMatch(reversed.php, /Schema::create\('public\./);
    const seeded = await client.callTool({ name: 'migration_template', arguments: { id: 'seeded', targetVersion } });
    assert.notEqual(seeded.isError, true);
    const data = JSON.parse(seeded.content[0].text);
    assert.equal(data.summary.seedRows, 2);
    assert.equal(data.summary.destructive, false);
    assert.match(data.sql, /INSERT INTO/);
    assert.equal(data.sql.match(/INSERT INTO/g)?.length, 2);
    assert.match(data.sql, /CREATE SEQUENCE[^;]+START WITH 3;/);
    assert.match(data.sql, /"id" int8 NOT NULL/);
    assert.match(data.sql, /\n\s+PRIMARY KEY \("id"\)/);
    assert.doesNotMatch(data.sql, /setval\(|CHECK \("id"|CONSTRAINT[^\n]+PRIMARY KEY/i);
    assert.ok(!data.warnings.some(w => w.code === 'UNSIGNED_BIGINT_RANGE'));
    assert.doesNotMatch(data.sql, /DROP TABLE/);
    const rebuild = await client.callTool({ name: 'migration_validate', arguments: {
      source: data.content.replace('public bool $exists_drop = false', 'public bool $exists_drop = true'), targetVersion,
    } });
    assert.notEqual(rebuild.isError, true);
    const rebuilt = JSON.parse(rebuild.content[0].text);
    assert.equal(rebuilt.summary.destructive, true);
    assert.match(rebuilt.sql, /DROP TABLE IF EXISTS/);
    assert.match(rebuilt.sql, /CREATE SEQUENCE[^;]+START WITH 3;/);
    assert.doesNotMatch(rebuilt.sql, /setval\(/i);
  }
  assert.equal((await client.listResources()).resources.length, 3);
  assert.equal((await client.listPrompts()).prompts.length, 2);
  const report = { version: capability.version, packagedDirectory: directory, generatedConfigMatchesDirectory: true, cli: 'passed', mcp: 'passed', reverse: 'passed-for-pg16-and-pg18', seedAndRebuild: 'passed-for-pg16-and-pg18', externalNodeRequired: false, desktopDialogs: 'not_automated' };
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile(`artifacts/package-verification-${capability.version}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
