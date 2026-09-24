import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { validatePhp, getTemplate, VERSION } from '../src/api.js';

const source = `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Schema;
return new class extends Migration {
    public bool $exists_drop = true;
    public function up() {
        Schema::create('product_brand', function ($table) {
            $table->bigIncrements('id')->comment('品牌编号');
            $table->string('name')->comment('品牌名称');
            $table->integer('sort')->default(0);
            $table->smallInteger('status')->default(0);
            $table->comment('商品品牌');
        });
    }
    public function data() { return [
        ['id'=>1, 'name'=>'苹果', 'sort'=>1, 'status'=>0],
        ['id'=>2, 'name'=>'华为', 'sort'=>12, 'status'=>0],
        ['id'=>3, 'name'=>'索尼', 'sort'=>2, 'status'=>0],
    ]; }
};`;

function assertContract(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.match(result.sql, /CREATE SEQUENCE "public"\."product_brand_seq"[^;]*START WITH 4;/);
  assert.match(result.sql, /"id" int8 NOT NULL DEFAULT nextval/);
  assert.match(result.sql, /"sort" int4 NOT NULL DEFAULT 0/);
  assert.match(result.sql, /"status" int2 NOT NULL DEFAULT 0/);
  assert.match(result.sql, /\n\s+PRIMARY KEY \("id"\)/);
  assert.doesNotMatch(result.sql, /CONSTRAINT[^\n]+PRIMARY KEY|CHECK \("id"|setval\(/i);
  assert.equal(result.sql.match(/INSERT INTO "public"\."product_brand"/g)?.length, 3);
  assert.ok(result.sql.indexOf("'苹果'") < result.sql.indexOf("'华为'"));
  assert.ok(result.sql.indexOf("'华为'") < result.sql.indexOf("'索尼'"));
  assert.match(result.sql, /COMMENT ON COLUMN "public"\."product_brand"\."id" IS '品牌编号'/);
  assert.match(result.sql, /ALTER SEQUENCE[^\n]+OWNED BY "public"\."product_brand"\."id"/);
  assert.match(result.sql, /DROP TABLE IF EXISTS/);
  assert.ok(result.warnings.some((warning) => warning.code === 'DESTRUCTIVE_OPERATION'));
  assert.ok(!result.warnings.some((warning) => warning.code === 'UNSIGNED_BIGINT_RANGE'));
  assert.deepEqual(result.summary, { seedRows: 3, destructive: true, creates: 1 });
}

test('approved output style applies consistently to PG16/18 API', () => {
  assert.equal(VERSION, '0.5.0');
  for (const targetVersion of [16, 18]) assertContract(validatePhp({ source, targetVersion }));
});

test('CLI validates the approved product_brand output without modifying input', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'sql-output-contract-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const input = path.join(folder, 'brand.php');
  await fs.writeFile(input, source);
  const result = spawnSync(process.execPath, ['src/cli.js', 'validate', '--file', input, '--pg-version', '16', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertContract(JSON.parse(result.stdout));
  assert.equal(await fs.readFile(input, 'utf8'), source);
});

test('MCP uses identical native primary key and sequence semantics', async (t) => {
  const client = new Client({ name: 'output-contract-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('src/mcp.js')], stderr: 'pipe' }));
  t.after(() => client.close());
  const result = await client.callTool({ name: 'migration_validate', arguments: { source, targetVersion: 18 } });
  assert.notEqual(result.isError, true);
  assertContract(JSON.parse(result.content[0].text));
});

test('built-in seeded template previews one INSERT per row and START WITH 3', async () => {
  const template = await getTemplate('seeded');
  assert.match(template.sql, /CREATE SEQUENCE[^;]+START WITH 3;/);
  assert.equal(template.sql.match(/INSERT INTO/g)?.length, 2);
  assert.doesNotMatch(template.sql, /setval\(|CHECK \("id"/i);
  assert.ok(!template.warnings.some((warning) => warning.code === 'UNSIGNED_BIGINT_RANGE'));
});
