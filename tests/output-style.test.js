import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPhp, COMPILER_VERSION } from '../src/core/converter.js';

const php = (body, members = '') => `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Schema;
return new class extends Migration {
  public function up() { ${body} }
  ${members}
};`;
const create = (columns, members = '', table = 'demo') => php(`Schema::create('${table}', function ($t) { ${columns} });`, members);
const seed = rows => `public function data() { return ${rows}; }`;
const run = source => convertPhp(source, { targetVersion: 16 });

test('current compiler retains integer and sequence PostgreSQL short aliases', () => {
  const result = run(create(`$t->id(); $t->bigInteger('big'); $t->integer('normal'); $t->smallInteger('small'); $t->mediumInteger('medium'); $t->tinyInteger('tiny'); $t->year('year');`));
  assert.equal(COMPILER_VERSION, '0.4.0');
  for (const [name, type] of [['id', 'int8'], ['big', 'int8'], ['normal', 'int4'], ['small', 'int2'], ['medium', 'int4'], ['tiny', 'int2'], ['year', 'int4']]) assert.match(result.sql, new RegExp(`"${name}" ${type} NOT NULL`));
  assert.match(result.sql, /CREATE SEQUENCE "public"\."demo_seq" AS int8 START WITH 1;/);
  assert.doesNotMatch(result.sql, /\b(?:bigint|integer|smallint|setval)\b/);
});

test('native auto columns use signed PG bounds and explicit unsigned remains enforced', () => {
  for (const [method, value, type] of [['id', '-9223372036854775808', 'int8'], ['bigIncrements', '-1', 'int8'], ['increments', '-2147483648', 'int4'], ['mediumIncrements', '-2147483648', 'int4'], ['smallIncrements', '-32768', 'int2'], ['tinyIncrements', '-32768', 'int2']]) {
    const out = run(create(`$t->${method}('id');`, seed(`[['id' => ${value}]]`)));
    assert.match(out.sql, new RegExp(`"id" ${type} NOT NULL`));
    assert.doesNotMatch(out.sql, /CHECK/);
    assert.ok(!out.warnings.some(w => w.code.startsWith('UNSIGNED_')));
    assert.match(out.sql, /START WITH 1;/);
  }
  const explicit = run(create(`$t->bigIncrements('id')->unsigned(); $t->unsignedBigInteger('owner');`));
  assert.match(explicit.sql, /CHECK \("id" >= 0\)/);
  assert.match(explicit.sql, /CHECK \("owner" >= 0\)/);
  assert.equal(explicit.warnings.filter(w => w.code === 'UNSIGNED_BIGINT_RANGE').length, 2);
  assert.throws(() => run(create(`$t->id()->unsigned();`, seed("[['id' => -1]]"))), e => e.code === 'SEED_OUT_OF_RANGE');
  for (const declaration of ["$t->mediumInteger('id', true);", "$t->tinyInteger('id')->autoIncrement();"]) {
    assert.doesNotMatch(run(create(declaration, seed("[['id' => 1000]]"))).sql, /CHECK/);
  }
  const unsignedAuto = run(create("$t->unsignedTinyInteger('id', true);", seed("[['id' => 200]]")));
  assert.match(unsignedAuto.sql, /AS int2 START WITH 201;/);
  assert.match(unsignedAuto.sql, /CHECK \("id" >= 0 AND "id" <= 255\)/);
});

test('static seed planning reserves exact start before independent ordered INSERT statements', () => {
  const out = run(create(`$t->id(); $t->string('name')->default('default');`, seed("[['name' => 'first'], ['id' => 9007199254740993, 'name' => 'second'], []]")));
  assert.match(out.sql, /AS int8 START WITH 9007199254740994;/);
  assert.doesNotMatch(out.sql, /setval/);
  const inserts = out.sql.split('\n').filter(line => line.startsWith('INSERT INTO'));
  assert.deepEqual(inserts, [
    `INSERT INTO "public"."demo" ("name") VALUES ('first');`,
    `INSERT INTO "public"."demo" ("id", "name") VALUES (9007199254740993, 'second');`,
    `INSERT INTO "public"."demo" DEFAULT VALUES;`,
  ]);
  for (const members of ['', seed('[]'), seed("[['id' => 0]]")]) assert.match(run(create('$t->id();', members)).sql, /START WITH 1;/);
});

test('sequence planning preserves one future default value at every native integer boundary', () => {
  for (const [method, last] of [['id', 9223372036854775807n], ['increments', 2147483647n], ['mediumIncrements', 2147483647n], ['smallIncrements', 32767n], ['tinyIncrements', 32767n]]) {
    const valid = run(create(`$t->${method}('id');`, seed(`[['id' => ${last - 2n}], []]`)));
    assert.match(valid.sql, new RegExp(`START WITH ${last - 1n};`));
    assert.throws(() => run(create(`$t->${method}('id');`, seed(`[['id' => ${last - 1n}], []]`))), e => e.code === 'SEED_SEQUENCE_EXHAUSTED');
    assert.throws(() => run(create(`$t->${method}('id');`, seed(`[['id' => ${last + 1n}]]`))), e => e.code === 'SEED_OUT_OF_RANGE');
  }
});

test('default primary SQL is unnamed while explicit names and drop lifecycle remain exact', () => {
  const implicit = run(php(`Schema::create('demo', function ($t) { $t->id(); $t->string('x'); }); Schema::rename('demo', 'renamed'); Schema::table('renamed', function ($t) { $t->dropPrimary(['id']); $t->primary('x', 'custom_pk'); });`));
  assert.match(implicit.sql, /PRIMARY KEY \("id"\)/);
  assert.doesNotMatch(implicit.sql, /CONSTRAINT "demo_(?:id_primary|pkey)" PRIMARY KEY/);
  assert.match(implicit.sql, /ALTER TABLE "public"\."renamed" DROP CONSTRAINT "demo_pkey";/);
  assert.match(implicit.sql, /ADD CONSTRAINT "custom_pk" PRIMARY KEY \("x"\)/);
  assert.throws(() => run(create(`$t->id(); $t->string('x')->primary();`)), e => e.code === 'DUPLICATE_PRIMARY');
});

test('PG automatic primary name clips UTF-8 safely and handles known relation collisions', () => {
  const table = '表'.repeat(20);
  const clipped = '表'.repeat(19) + '_pkey';
  const long = run(php(`Schema::create('${table}', function ($t) { $t->integer('id')->primary(); }); Schema::table('${table}', function ($t) { $t->dropPrimary(); });`));
  assert.match(long.sql, new RegExp(`DROP CONSTRAINT "${clipped}"`));
  const collision = run(php(`Schema::create('demo_pkey', function ($t) { $t->string('x'); }); Schema::create('demo', function ($t) { $t->id(); }); Schema::table('demo', function ($t) { $t->dropPrimary(); });`));
  assert.match(collision.sql, /DROP CONSTRAINT "demo_pkey1"/);
  for (const declaration of ["$t->id()->unique('custom_unique');", "$t->integer('id'); $t->unique('id', 'custom_unique'); $t->primary('id');"]) assert.throws(() => run(create(declaration)), e => e.code === 'AMBIGUOUS_PRIMARY_NAME');
  assert.throws(() => run(create("$t->id(); $t->string('x')->index('demo_pkey');")), e => e.code === 'DUPLICATE_OBJECT');
});

test('row-wise self foreign keys accept earlier/current rows and reject forward references clearly', () => {
  const columns = `$t->id(); $t->bigInteger('parent_id')->nullable(); $t->foreign('parent_id')->references('id')->on('demo');`;
  const valid = run(create(columns, seed("[['id' => 1, 'parent_id' => 1], ['id' => 2, 'parent_id' => 1], ['id' => 3, 'parent_id' => null]]")));
  assert.equal(valid.sql.match(/INSERT INTO/g).length, 3);
  for (const rows of ["[['id' => 1, 'parent_id' => 2], ['id' => 2, 'parent_id' => 1]]", "[['id' => 1, 'parent_id' => 2], ['id' => 2, 'parent_id' => null]]"]) assert.throws(() => run(create(columns, seed(rows))), e => e.code === 'SEED_FOREIGN_KEY_ORDER');
});

test('invalid auto modifiers retain structured diagnostics before seed planning', () => {
  assert.throws(() => run(create("$t->id()->nullable();", seed("[['id' => null]]"))), e => e.code === 'INVALID_MODIFIER' && Number.isInteger(e.line));
  assert.throws(() => run(create("$t->id()->default(1);", seed('[[]]'))), e => e.code === 'CONFLICTING_DEFAULT' && Number.isInteger(e.line));
});
