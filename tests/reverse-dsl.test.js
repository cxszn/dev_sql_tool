import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPhp, COMPILER_VERSION, CAPABILITIES } from '../src/core/converter.js';

const php = (up, data) => `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Schema;
return new class extends Migration {
 public function up() { ${up} }
 ${data === undefined ? '' : `public function data() { return ${data}; }`}
};`;
const create = (body, rows, name = 'demo') => php(`Schema::create('${name}', function ($t) { ${body} });`, rows);
const run = source => convertPhp(source, { targetVersion: 16, sourceName: 'reverse-dsl.php' });

test('0.4 startingValue preserves exact explicit starts with and without seed data', () => {
  assert.equal(COMPILER_VERSION, '0.4.0');
  assert.ok(CAPABILITIES.columnModifiers.includes('startingValue'));
  for (const [start, rows] of [['9007199254740997', undefined], ['1949', '[]'], ['100', "[['id' => 2], []]"]]) {
    const result = run(create(`$t->id()->startingValue('${start}');`, rows));
    assert.match(result.sql, new RegExp(`START WITH ${start};`));
  }
  assert.throws(() => run(create("$t->id()->startingValue(2);", "[['id'=>2]]")), e => e.code === 'SEED_SEQUENCE_COLLISION');
  assert.throws(() => run(create("$t->smallIncrements('id')->startingValue(32767);", '[[]]')), e => e.code === 'SEED_SEQUENCE_EXHAUSTED');
  for (const arg of ['0', '-1', '1.5', "'bad'", 'true', "config('start')"]) assert.throws(() => run(create(`$t->id()->startingValue(${arg});`)), e => ['INVALID_STARTING_VALUE', 'MISSING_CONFIG'].includes(e.code));
  assert.throws(() => run(create("$t->integer('id')->startingValue(2);")), e => e.code === 'INVALID_STARTING_VALUE');
});

test('explicit null time precision is unbounded syntax with six-digit seed validation', () => {
  const result = run(create("$t->timestamp('stamp', null); $t->time('clock', null); $t->timestamp('old'); $t->addColumn('timestamp','other',['precision'=>null]);", "[['stamp'=>'2026-01-01 01:02:03.123456','clock'=>'01:02:03.123456','old'=>'2026-01-01 01:02:03','other'=>'2026-01-01 01:02:03.123456']]"));
  assert.match(result.sql, /"stamp" timestamp NOT NULL/);
  assert.match(result.sql, /"clock" time NOT NULL/);
  assert.match(result.sql, /"other" timestamp NOT NULL/);
  assert.match(result.sql, /"old" timestamp\(0\) NOT NULL/);
  assert.throws(() => run(create("$t->timestamp('stamp', null);", "[['stamp'=>'2026-01-01 01:02:03.1234567']]")), e => e.code === 'SEED_INVALID_VALUE');
});

test('index direction maps preserve directions and reject expressions', () => {
  const result = run(create("$t->integer('owner'); $t->timestamp('time', null); $t->index(['owner'=>'asc','time'=>'DESC'],'idx_order');"));
  assert.match(result.sql, /CREATE INDEX "idx_order" ON "public"\."demo" \("owner" ASC, "time" DESC\);/);
  assert.throws(() => run(create("$t->integer('owner'); $t->index(['owner'=>'desc nulls first'],'bad');")), e => e.code === 'INVALID_INDEX_DIRECTION');
});

test('uniqueIndex retains independent index kind and scoped AND equality predicate', () => {
  const body = "$t->id(); $t->integer('tenant_id'); $t->integer('deleted')->default(0); $t->string('tag')->nullable(); $t->uniqueIndex(['tenant_id'], 'uk_active', ['deleted'=>0,'tag'=>null]);";
  const result = run(create(body, "[['id'=>1,'tenant_id'=>7,'deleted'=>1],['id'=>2,'tenant_id'=>7,'deleted'=>1],['id'=>3,'tenant_id'=>7,'deleted'=>0]]"));
  assert.match(result.sql, /CREATE UNIQUE INDEX "uk_active" ON "public"\."demo" \("tenant_id"\) WHERE "deleted" = 0 AND "tag" IS NULL;/);
  assert.doesNotMatch(result.sql, /CONSTRAINT "uk_active"/);
  assert.throws(() => run(create(body, "[['id'=>1,'tenant_id'=>7],['id'=>2,'tenant_id'=>7]]")), e => e.code === 'SEED_DUPLICATE_KEY');
  assert.throws(() => run(create("$t->integer('tenant_id'); $t->uniqueIndex(['tenant_id'],'uk',['unknown'=>0]);")), e => e.code === 'UNKNOWN_COLUMN');
  assert.throws(() => run(create("$t->integer('tenant_id'); $t->uniqueIndex(['tenant_id'],'uk',['tenant_id'=>['gt'=>0]]);")), e => e.code === 'INVALID_INDEX_PREDICATE');
});

test('dropSequence records actual AST target and preserves cleanup ordering', () => {
  const result = run(php("Schema::dropIfExists('demo'); Schema::dropSequenceIfExists('demo_seq'); Schema::create('demo',function($t){$t->id()->startingValue(12);});"));
  assert.ok(result.sql.indexOf('DROP TABLE') < result.sql.indexOf('DROP SEQUENCE'));
  assert.ok(result.sql.indexOf('DROP SEQUENCE') < result.sql.indexOf('CREATE SEQUENCE'));
  assert.match(result.sql, /DROP SEQUENCE IF EXISTS "public"\."demo_seq";/);
  assert.doesNotMatch(result.sql, /CASCADE/);
  assert.equal(result.summary.destructive, true);
  assert.throws(() => run(php("Schema::create('demo',function($t){$t->id();}); Schema::dropSequence('demo_seq');")), e => e.code === 'SEQUENCE_IN_USE');
  assert.throws(() => run(php("Schema::create('demo',function($t){$t->integer('id');}); Schema::dropSequence('demo');")), e => e.code === 'INVALID_SEQUENCE_TARGET');
});

test('keyed data supports multiple creates and emits all DDL before ordered per-table rows', () => {
  const result = run(php("Schema::dropIfExists('a'); Schema::dropSequenceIfExists('a_seq'); Schema::create('a',function($t){$t->id();}); Schema::create('b',function($t){$t->id()->startingValue(90);});", "['b'=>[['id'=>20],[]], 'a'=>[['id'=>5],[]]]"));
  assert.deepEqual(result.summary, { seedRows: 4, destructive: true, creates: 2 });
  assert.match(result.sql, /"a_seq" AS int8 START WITH 6;/);
  assert.match(result.sql, /"b_seq" AS int8 START WITH 90;/);
  assert.ok(result.sql.lastIndexOf('CREATE TABLE') < result.sql.indexOf('INSERT INTO'));
  assert.deepEqual(result.sql.split('\n').filter(line => line.startsWith('INSERT INTO')), [
    'INSERT INTO "public"."b" ("id") VALUES (20);', 'INSERT INTO "public"."b" DEFAULT VALUES;',
    'INSERT INTO "public"."a" ("id") VALUES (5);', 'INSERT INTO "public"."a" DEFAULT VALUES;',
  ]);
});

test('keyed data rejects ambiguous targets, dynamic maps and lost final tables', () => {
  const a = "Schema::create('a',function($t){$t->id();});";
  for (const [up, rows, code] of [
    [a, "['missing'=>[]]", 'INVALID_SEED_TARGET'],
    [a, "['a'=>[], 'public.a'=>[]]", 'DUPLICATE_SEED_TARGET'],
    [a + "Schema::drop('a');", "['a'=>[]]", 'INVALID_SEED_TARGET'],
    [a + "Schema::rename('a','b');", "['b'=>[]]", 'UNSUPPORTED_KEYED_SCHEMA'],
    [a + "Schema::table('a',function($t){$t->integer('x');});", "['a'=>[]]", 'UNSUPPORTED_KEYED_SCHEMA'],
    [a, "['a'=>config('rows')]", 'INVALID_SEED_ROWS'],
    [a, "['a'=>[], []]", 'INVALID_SEED_ROWS'],
  ]) assert.throws(() => run(php(up, rows)), e => e.code === code);
  assert.throws(() => run(php(a + "Schema::create('b',function($t){$t->id();});", '[]')), e => e.code === 'AMBIGUOUS_SEED_TARGET');
});

test('explicit single-column primary name replaces the auto implicit primary only for the same column', () => {
  const result = run(create("$t->id()->startingValue(7); $t->primary(['id'],'pk_demo');", "[['id'=>1]]"));
  assert.match(result.sql, /CONSTRAINT "pk_demo" PRIMARY KEY \("id"\)/);
  assert.equal(result.sql.match(/PRIMARY KEY/g).length, 1);
  assert.throws(() => run(create("$t->id(); $t->integer('x'); $t->primary(['x'],'pk_wrong');")), e => e.code === 'DUPLICATE_PRIMARY');
  assert.throws(() => run(create("$t->id(); $t->integer('x'); $t->primary(['id','x'],'pk_wrong');")), e => e.code === 'DUPLICATE_PRIMARY');
});

test('partial unique indexes never qualify as self foreign key targets', () => {
  assert.throws(() => run(create("$t->integer('x'); $t->integer('parent')->nullable(); $t->integer('deleted')->default(0); $t->uniqueIndex(['x'],'uk',['deleted'=>0]); $t->foreign('parent')->references('x')->on('demo');", "[['x'=>1,'parent'=>1]]")), e => e.code === 'SEED_SELF_FOREIGN_INVALID');
});

test('indexComment preserves safe index comments after standalone and fluent index creation', () => {
  const result = run(create("$t->integer('x')->index('idx_x'); $t->indexComment('idx_x', '排序索引 O\\'Reilly');"));
  assert.match(result.sql, /COMMENT ON INDEX "public"\."idx_x" IS '排序索引 O''Reilly';/);
  assert.ok(result.sql.indexOf('CREATE INDEX') < result.sql.indexOf('COMMENT ON INDEX'));
  assert.throws(() => run(create("$t->integer('x'); $t->indexComment('missing','comment');")), e => e.code === 'INVALID_INDEX_COMMENT');
  assert.throws(() => run(create("$t->integer('x'); $t->indexComment('demo','comment');")), e => e.code === 'INVALID_INDEX_COMMENT');
});

test('sequenceType retains source sequence width while enforcing both column and sequence limits', () => {
  const result = run(create("$t->increments('id')->sequenceType('int8')->startingValue(700);", "[['id'=>1]]"));
  assert.match(result.sql, /CREATE SEQUENCE "public"\."demo_seq" AS int8 START WITH 700;/);
  assert.match(result.sql, /"id" int4 NOT NULL/);
  assert.throws(() => run(create("$t->id()->sequenceType('int2')->startingValue(32768);")), e => e.code === 'INVALID_STARTING_VALUE');
  assert.throws(() => run(create("$t->increments('id')->sequenceType('int8')->startingValue(2147483648);")), e => e.code === 'INVALID_STARTING_VALUE');
  assert.throws(() => run(create("$t->integer('id')->sequenceType('int8');")), e => e.code === 'INVALID_SEQUENCE_TYPE');
  assert.throws(() => run(create("$t->id()->sequenceType('serial');")), e => e.code === 'INVALID_SEQUENCE_TYPE');
});

test('partial index commands retain predicates through ordered rename and drop operations', () => {
  const setup = "Schema::create('demo',function($t){$t->integer('id');$t->integer('state');});";
  const renamed = run(php(setup + "Schema::table('demo',function($t){$t->renameColumn('state','new_state');$t->uniqueIndex(['id'],'uk',['new_state'=>0]);});"));
  assert.match(renamed.sql, /CREATE UNIQUE INDEX "uk" ON "public"\."demo" \("id"\) WHERE "new_state" = 0;/);
  for (const action of ["$t->renameColumn('state','new_state');", "$t->dropColumn('state');"]) assert.throws(() => run(php(setup + `Schema::table('demo',function($t){${action}$t->uniqueIndex(['id'],'uk',['state'=>0]);});`)), e => e.code === 'UNKNOWN_COLUMN');
  const dropped = run(php(setup + "Schema::table('demo',function($t){$t->uniqueIndex(['id'],'uk',['state'=>0]);$t->dropIndex('uk');});"));
  assert.match(dropped.sql, /CREATE UNIQUE INDEX "uk" ON "public"\."demo" \("id"\) WHERE "state" = 0;/);
  assert.ok(dropped.sql.indexOf('WHERE "state" = 0') < dropped.sql.indexOf('DROP INDEX'));
});

test('self foreign keys backed by standalone unique indexes are declared only after the index exists', () => {
  const result = run(create("$t->integer('x'); $t->integer('parent')->nullable(); $t->uniqueIndex(['x'],'uk_x'); $t->foreign('parent')->references('x')->on('demo');", "[['x'=>1,'parent'=>1]]"));
  assert.match(result.sql, /ALTER TABLE "public"\."demo" ADD CONSTRAINT "demo_parent_foreign" FOREIGN KEY/);
  assert.ok(result.sql.indexOf('CREATE UNIQUE INDEX') < result.sql.indexOf('ALTER TABLE "public"."demo" ADD CONSTRAINT'));
});
