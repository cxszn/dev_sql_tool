import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPhp, COMPILER_VERSION, CAPABILITIES } from '../src/core/converter.js';

const php = (columns, members = '', extraUp = '', name = 'permission') => `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Blueprint;
use Hyperf\\Database\\Schema\\Schema;
class DemoMigration extends Migration {
  public function up() { Schema::create('${name}', function (Blueprint $table) { ${columns} }); ${extraUp} }
  ${members}
  public function down() { Schema::dropIfExists('${name}'); }
}`;
const data = rows => `public function data(): array { return ${rows}; }`;
const convert = source => convertPhp(source, { targetVersion: 16, sourceName: 'seed.php' });
const columns = `$table->bigIncrements('id'); $table->string('name')->unique(); $table->string('path')->nullable(); $table->timestamps();`;

test('current compiler retains permission demo drops, inserts and sequence reservation', () => {
  const out = convert(php(columns, `${data("[['id' => 1, 'name' => 'permission', 'path' => '/permission', 'created_at' => '2020-07-22 21:32:02', 'updated_at' => '2020-07-22 21:32:02']]")} public bool $exists_drop = true;`));
  assert.equal(COMPILER_VERSION, '0.4.0');
  assert.ok(CAPABILITIES.seedData && CAPABILITIES.existsDrop);
  assert.deepEqual(out.summary, { seedRows: 1, destructive: true, creates: 1 });
  assert.match(out.sql, /DROP TABLE IF EXISTS "public"\."permission";/);
  assert.match(out.sql, /DROP SEQUENCE IF EXISTS "public"\."permission_seq";/);
  assert.ok(out.sql.indexOf('DROP TABLE') < out.sql.indexOf('DROP SEQUENCE'));
  assert.ok(out.sql.indexOf('DROP SEQUENCE') < out.sql.indexOf('CREATE SEQUENCE'));
  assert.match(out.sql, /CREATE SEQUENCE "public"\."permission_seq" AS int8 START WITH 2;/);
  assert.doesNotMatch(out.sql, /setval/);
  assert.ok(out.sql.indexOf('START WITH 2') < out.sql.indexOf('INSERT INTO'));
  assert.match(out.sql, /INSERT INTO "public"\."permission" \("id", "name", "path", "created_at", "updated_at"\) VALUES \(1, 'permission', '\/permission', '2020-07-22 21:32:02', '2020-07-22 21:32:02'\);/);
  assert.doesNotMatch(out.sql, /CASCADE|product_brand/);
  assert.ok(out.warnings.some(w => w.code === 'DESTRUCTIVE_OPERATION'));
  assert.ok(!out.warnings.some(w => w.code === 'UNSIGNED_BIGINT_RANGE'));
  assert.ok(!out.warnings.some(w => w.code === 'IGNORED_CLASS_MEMBER'));
});

test('exists_drop false and omitted keep create-only; true without sequence drops only table', () => {
  for (const property of ['', 'public bool $exists_drop = false;']) {
    const out = convert(php(`$table->string('name');`, property));
    assert.doesNotMatch(out.sql, /DROP /); assert.deepEqual(out.summary, { seedRows: 0, destructive: false, creates: 1 });
  }
  const out = convert(php(`$table->string('name');`, 'public bool $exists_drop = true;'));
  assert.match(out.sql, /DROP TABLE/); assert.doesNotMatch(out.sql, /DROP SEQUENCE/);
});

test('exists_drop requires one explicit public nonstatic bool literal property', () => {
  for (const property of [
    'public $exists_drop = true;', 'protected bool $exists_drop = true;', 'public static bool $exists_drop = true;',
    'public bool $exists_drop = 1;', 'public bool $exists_drop;', 'public ?bool $exists_drop = true;',
    'public bool $exists_drop = true; public bool $exists_drop = false;',
  ]) assert.throws(() => convert(php(columns, property)), e => e.code === 'INVALID_EXISTS_DROP');
});

test('data requires a public nonstatic no-argument method with a sole literal-array return', () => {
  for (const method of [
    'public function data() { return config("seed"); }', 'public function data() { system("whoami"); return []; }',
    'public function data() { if (true) return []; return []; }', 'private function data() { return []; }',
    'public static function data() { return []; }', 'public function data($a) { return []; }',
    'public function data() { return [["name" => strtoupper("x")]]; }',
    'public function data() { return [["name" => ["nested"]]]; }',
    'public function data() { return []; } public function data() { return []; }',
  ]) assert.throws(() => convert(php(columns, method)), e => e.code?.startsWith('INVALID_SEED') || e.code === 'UNSUPPORTED_SEED_VALUE');
});

test('multi-table or lifecycle ambiguity is rejected before destructive or seed SQL', () => {
  for (const extra of ["Schema::create('other', function ($t) { $t->id(); });", "Schema::table('permission', function ($t) { $t->string('extra'); });", "Schema::dropIfExists('old');", "Schema::rename('permission', 'renamed');"]) {
    assert.throws(() => convert(php(columns, data('[]'), extra)), e => e.code === 'AMBIGUOUS_SEED_TARGET');
    assert.throws(() => convert(php(columns, 'public bool $exists_drop = true;', extra)), e => e.code === 'AMBIGUOUS_EXISTS_DROP');
  }
});

test('empty seed list is legal and default-only rows use DEFAULT VALUES', () => {
  const empty = convert(php(columns, data('[]')));
  assert.doesNotMatch(empty.sql, /INSERT INTO|setval/); assert.equal(empty.summary.seedRows, 0);
  const defaults = convert(php(`$table->id(); $table->string('name')->default('demo');`, data('[[]]')));
  assert.match(defaults.sql, /INSERT INTO "public"\."permission" DEFAULT VALUES;/);
});

test('seed row rejects duplicate keys, unknown columns, required omissions and invalid nulls', () => {
  for (const [rows, code] of [
    ["[['name' => 'a', 'name' => 'b']]", 'SEED_DUPLICATE_COLUMN'],
    ["[['name' => 'a', 'unknown' => 1]]", 'SEED_UNKNOWN_COLUMN'],
    ["[['id' => 1]]", 'SEED_REQUIRED_COLUMN'],
    ["[['name' => null]]", 'SEED_NULL_NOT_ALLOWED'],
  ]) assert.throws(() => convert(php(columns, data(rows))), e => e.code === code);
  assert.match(convert(php(columns, data("[['name' => 'a', 'path' => null]]"))).sql, /'a', NULL/);
});

test('seed values preserve large numbers, decimals, booleans, UTF-8 and backslashes exactly', () => {
  const out = convert(php(`$table->bigInteger('n'); $table->decimal('price', 30, 12); $table->boolean('enabled'); $table->string('name');`, data("[['n' => 9007199254740993, 'price' => 123456789012345678.123456789012, 'enabled' => false, 'name' => '中文 O\\'Reilly C:\\\\work']]")));
  assert.match(out.sql, /9007199254740993, 123456789012345678\.123456789012, FALSE, '中文 O''Reilly C:\\work'/);
  for (const [col, value] of [["$table->smallInteger('x');", '32768'], ["$table->decimal('x', 5, 2);", '1.234'], ["$table->boolean('x');", '2'], ["$table->string('x', 2);", "'中文三'"]]) assert.throws(() => convert(php(col, data(`[['x' => ${value}]]`))), e => e.code?.startsWith('SEED_'));
});

test('mixed explicit and omitted IDs reserve max explicit before all inserts', () => {
  const out = convert(php(columns, data("[['name' => 'first'], ['id' => 100, 'name' => 'explicit'], ['name' => 'last']]")));
  assert.match(out.sql, /CREATE SEQUENCE "public"\."permission_seq" AS int8 START WITH 101;/);
  assert.doesNotMatch(out.sql, /setval/);
  assert.ok(out.sql.indexOf('START WITH 101') < out.sql.indexOf('INSERT INTO'));
  assert.equal(out.summary.seedRows, 3);
  const zero = convert(php(columns, data("[['id' => 0, 'name' => 'zero']]")));
  assert.match(zero.sql, /CREATE SEQUENCE "public"\."permission_seq" AS int8 START WITH 1;/);
  assert.throws(() => convert(php(columns, data("[['id' => 9223372036854775807, 'name' => 'end']]"))), e => e.code === 'SEED_SEQUENCE_EXHAUSTED');
  assert.throws(() => convert(php(columns, data("[['id' => 1, 'name' => 'a'], ['id' => 1, 'name' => 'b']]"))), e => e.code === 'SEED_DUPLICATE_KEY');
});

test('seed typed text is validated before SQL is returned', () => {
  for (const [column, literal] of [["$table->date('x');", "'2026-02-30'"], ["$table->timestamp('x', 0);", "'2026-09-24 10:00:00.001'"], ["$table->jsonb('x');", "'{bad}'"], ["$table->uuid('x');", "'wrong'"], ["$table->ipAddress('x');", "'999.1.1.1'"]]) assert.throws(() => convert(php(column, data(`[['x' => ${literal}]]`))), e => e.code === 'SEED_INVALID_VALUE');
});

test('JSON tokens and network/binary inputs cannot bypass typed validation', () => {
  for (const [column, literal] of [
    ["$table->jsonb('x');", "'{\"x\":\"\\u0000\",\"x\":1}'"],
    ["$table->jsonb('x');", "'{\"x\":1e-1000000}'"],
    ["$table->ipAddress('x');", "'fe80::1%eth0'"],
    ["$table->binary('x');", "'\\XAB'"],
  ]) assert.throws(() => convert(php(column, data(`[['x' => ${literal}]]`))), e => e.code === 'SEED_INVALID_VALUE');
  assert.match(convert(php("$table->binary('x');", data("[['x' => '\\xAB']]"))).sql, /'\\xAB'/);
});

test('invalid DDL defaults fail even when seeds explicitly override them', () => {
  for (const column of ["$table->double('x')->default(1e309);", "$table->real('x')->default(1e-1000);", "$table->decimal('x')->default(0e999999999999999999999);", "$table->integer('x')->default(['numeric' => '1']);"]) assert.throws(() => convert(php(column, data("[['x' => 1]]"))), e => ['DEFAULT_OUT_OF_RANGE', 'INVALID_DEFAULT'].includes(e.code));
});

test('seed unique numeric keys compare stored values rather than literal spelling', () => {
  for (const [column, rows] of [["$table->decimal('x', 8, 2)->unique();", "[['x' => 1.0], ['x' => 1.00]]"], ["$table->real('x')->unique();", "[['x' => 16777216], ['x' => 16777217]]"]]) assert.throws(() => convert(php(column, data(rows))), e => e.code === 'SEED_DUPLICATE_KEY');
});
