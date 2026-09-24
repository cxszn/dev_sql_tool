import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { convertPhp } from '../src/core/converter.js';
import { PHP_CLASSES, PHP_IMPORTS } from '../src/core/php-contract.js';
import { getTemplate, TEMPLATES, validateSql, exportIdeSdk, previewDirectory } from '../src/api.js';

test('SqlStudio imports, aliases, FQNs and namespace resolve to identical SQL for PG16/18', async () => {
  const { content } = await getTemplate('generic');
  const alias = content.replaceAll('use SqlStudio\\Migrations\\Migration;', 'use SqlStudio\\Migrations\\Migration as Base;')
    .replace('extends Migration', 'extends Base').replace('use SqlStudio\\Schema\\Blueprint;', 'use SqlStudio\\Schema\\Blueprint as Table;')
    .replaceAll('Blueprint $table', 'Table $table').replace('use SqlStudio\\Schema\\Schema;', 'use SqlStudio\\Schema\\Schema as Structure;')
    .replaceAll('Schema::', 'Structure::');
  let fqn = content;
  for (const line of PHP_IMPORTS) fqn = fqn.replace(line, '');
  fqn = fqn.replace('extends Migration', `extends \\${PHP_CLASSES.Migration}`)
    .replaceAll('Schema::', `\\${PHP_CLASSES.Schema}::`).replaceAll('Blueprint $table', `\\${PHP_CLASSES.Blueprint} $table`);
  const namespaced = content.replace('declare(strict_types=1);', 'declare(strict_types=1);\nnamespace Example;');
  const legacy = content.replaceAll('SqlStudio\\Migrations\\', 'Hyperf\\Database\\Migrations\\').replaceAll('SqlStudio\\Schema\\', 'Hyperf\\Database\\Schema\\');
  for (const targetVersion of [16, 18]) {
    const expected = convertPhp(content, { targetVersion }).sql;
    for (const source of [alias, fqn, namespaced, legacy]) assert.equal(convertPhp(source, { targetVersion }).sql, expected);
  }
  assert.throws(() => convertPhp(content.replace('SqlStudio\\Migrations\\Migration', 'Other\\Migration'), { targetVersion: 16 }), /SqlStudio/);
});

test('all new templates and reverse output import only the own namespace', async () => {
  for (const template of TEMPLATES) {
    const { content } = await getTemplate(template.id);
    for (const line of PHP_IMPORTS) assert.ok(content.includes(line));
    assert.doesNotMatch(content, /use (Hyperf|Illuminate)\\/);
  }
  for (const targetVersion of [16, 18]) {
    const reversed = await validateSql({ source: 'CREATE TABLE demo (id bigint PRIMARY KEY);', targetVersion });
    assert.equal(reversed.ok, true);
    assert.equal(reversed.verification.semanticEqual, true);
    for (const line of PHP_IMPORTS) assert.ok(reversed.php.includes(line));
  }
});

test('SDK floating point named parameters allow an omitted total and validate explicit values', () => {
  const source = column => `<?php ${PHP_IMPORTS.join('\n')} return new class extends Migration { public function up(): void { Schema::create('demo', static function(Blueprint $table) { ${column} }); } };`;
  for (const method of ['float', 'double']) {
    const result = convertPhp(source(`$table->${method}('score', places: 2);`), { targetVersion: 16 });
    assert.match(result.sql, /"score" double precision/);
    assert.ok(result.warnings.some(w => w.code === 'FLOAT_PRECISION_NOT_ENFORCED'));
    assert.throws(() => convertPhp(source(`$table->${method}('score', places: 'invalid');`), { targetVersion: 16 }), /浮点参数/);
  }
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sql-studio-own-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inputDir = path.join(directory, 'migration');
  await fs.mkdir(inputDir);
  await fs.writeFile(path.join(inputDir, 'demo.php'), (await getTemplate('generic')).content);
  return { directory, inputDir };
}

test('SDK export is outside input, repeatable, and never overwrites changed declarations', async t => {
  const { directory, inputDir } = await fixture(t);
  await assert.rejects(exportIdeSdk({ outputDir: inputDir, inputDir }), /输入目录之外/);
  await assert.rejects(exportIdeSdk({ outputDir: 'relative' }), /绝对目录/);
  const written = await exportIdeSdk({ outputDir: directory, inputDir });
  assert.equal(written.skipped, false);
  assert.equal((await exportIdeSdk({ outputDir: directory, inputDir })).skipped, true);
  const preview = await previewDirectory({ inputDir, outputDir: path.join(directory, 'sql'), targetVersion: 16, guard: true });
  assert.equal(preview.ok, true);
  assert.equal(preview.files.length, 1);
  const declaration = path.join(written.path, 'src', 'Schema', 'Blueprint.php');
  await fs.appendFile(declaration, '\n// local change');
  await assert.rejects(exportIdeSdk({ outputDir: directory, inputDir }), /已保留原文件/);
  assert.match(await fs.readFile(declaration, 'utf8'), /local change/);
});

test('SDK export rejects reverse migration folders and junctions; CLI exports without PG argument', async t => {
  const { directory, inputDir } = await fixture(t);
  await fs.writeFile(path.join(inputDir, '.migration-php-manifest.json'), '{}');
  await assert.rejects(exportIdeSdk({ outputDir: inputDir }), /不能放入/);
  const link = path.join(directory, 'linked');
  await fs.symlink(inputDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(exportIdeSdk({ outputDir: link }), /链接|junction/);
  const result = spawnSync(process.execPath, ['src/cli.js', 'ide-sdk', '--output', directory, '--input', inputDir, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
