import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPhp } from '../src/core/converter.js';

const php = body => `<?php
use Hyperf\\Database\\Migrations\\Migration;
use Hyperf\\Database\\Schema\\Blueprint;
use Hyperf\\Database\\Schema\\Schema;
return new class extends Migration {
  public function up(): void { ${body} }
  public function down(): void { Schema::dropIfExists('demo'); }
};`;
const create = body => php(`Schema::create('demo', static function (Blueprint $table) { ${body} });`);
const convert = (source, options = {}) => convertPhp(source, { targetVersion: 16, ...options });

test('explicit sequence, comments, index and nullable timestamp macros', () => {
  const { sql, tables } = convert(create(`
    $table->comment('示例表');
    $table->bigIncrements('id');
    $table->string('name', 80)->default('O\\'Reilly')->comment('名称')->index();
    $table->timestamps();
  `));
  assert.match(sql, /CREATE SEQUENCE "public"\."demo_seq" AS int8 START WITH 1/);
  assert.match(sql, /"id" int8 NOT NULL DEFAULT nextval\('"public"\."demo_seq"'::regclass\)/);
  assert.match(sql, /ALTER SEQUENCE "public"\."demo_seq" OWNED BY "public"\."demo"\."id"/);
  assert.match(sql, /"name" varchar\(80\) NOT NULL DEFAULT 'O''Reilly'/);
  assert.match(sql, /COMMENT ON TABLE "public"\."demo" IS '示例表'/);
  assert.match(sql, /CREATE INDEX "demo_name_index" ON "public"\."demo" \("name"\)/);
  assert.match(sql, /"created_at" timestamp\(0\)(?:,|\n)/);
  assert.deepEqual(tables, ['public.demo']);
  assert.ok(sql.startsWith('--'));
  assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;\n$/);
});

test('only explicit config keys resolve, with named migration support', () => {
  const source = php(`Schema::create(config('permission.database.table'), function (Blueprint $table) { $table->id(); });`).replace('return new class', 'class CreateRules').replace(/};$/, '}');
  assert.throws(() => convert(source), e => e.code === 'MISSING_CONFIG');
  assert.deepEqual(convert(source, { config: { 'permission.database.table': 'rules' } }).tables, ['public.rules']);
});

test('large numeric defaults retain exact source spelling; boolean accepts only boolean or 0/1', () => {
  const { sql } = convert(create(`$table->bigInteger('n')->default(9007199254740993); $table->decimal('price', 30, 12)->default(123456789012345678.123456789012); $table->boolean('yes')->default(1); $table->boolean('no')->default(false);`));
  assert.match(sql, /DEFAULT 9007199254740993/);
  assert.match(sql, /DEFAULT 123456789012345678\.123456789012/);
  assert.match(sql, /"yes" boolean NOT NULL DEFAULT TRUE/);
  assert.match(sql, /"no" boolean NOT NULL DEFAULT FALSE/);
  assert.throws(() => convert(create(`$table->boolean('bad')->default(2);`)), /boolean|布尔/);
});

test('reject unknown methods, modifiers, control flow and side effects with source line', () => {
  for (const body of [
    `$table->string('x')->mystery();`,
    `$table->string('x')->change();`,
    `if (true) { $table->id(); }`,
    `$table->string(file_get_contents('secret'));`,
    `$table->point('x');`,
    `system('whoami');`,
  ]) assert.throws(() => convert(create(`\n${body}`)), e => e.code && e.line >= 6);
  assert.throws(() => convert(php(`Other::create('demo', function ($table) { $table->id(); });`)), /Schema|类/);
});

test('comments and strings containing fake PHP statements never become executable syntax', () => {
  const { sql } = convert(create(`// $table->dropColumn('secret');\n$table->string('note')->default('Schema::drop(\"users\");')->comment('a; DROP TABLE x;');`));
  assert.match(sql, /DEFAULT 'Schema::drop\("users"\);'/);
  assert.match(sql, /IS 'a; DROP TABLE x;'/);
  assert.doesNotMatch(sql, /ALTER TABLE/);
});

test('duplicate columns, objects and multiple primary keys fail before returning SQL', () => {
  assert.throws(() => convert(create(`$table->id(); $table->integer('id');`)), e => e.code === 'DUPLICATE_COLUMN');
  assert.throws(() => convert(create(`$table->id(); $table->string('x')->primary();`)), e => e.code === 'DUPLICATE_PRIMARY');
  assert.throws(() => convert(create(`$table->string('x')->index('same'); $table->string('y')->index('same');`)), e => e.code === 'DUPLICATE_OBJECT');
});

test('PG16 and PG18 accepted; missing and unsupported versions fail', () => {
  for (const targetVersion of [16, 18]) assert.match(convert(create('$table->id();'), { targetVersion }).sql, new RegExp(`PostgreSQL ${targetVersion}`));
  for (const targetVersion of [undefined, 17, '16', null]) assert.throws(() => convertPhp(create('$table->id();'), { targetVersion }), e => e.code === 'UNSUPPORTED_VERSION');
});

test('foreign keys, composite primary and enum produce constraints', () => {
  const { sql } = convert(create(`$table->bigInteger('user_id'); $table->integer('position'); $table->enum('state', ['active', 'archived']); $table->primary(['user_id','position']); $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');`));
  assert.match(sql, /PRIMARY KEY \("user_id", "position"\)/);
  assert.match(sql, /FOREIGN KEY \("user_id"\) REFERENCES "public"\."users" \("id"\) ON DELETE CASCADE/);
  assert.match(sql, /CHECK \("state" IN \('active', 'archived'\)\)/);
});

test('unsupported class members are reported while down is never converted', () => {
  const source = create('$table->id();').replace('public function down()', `public $custom_flag = true; public function helper() { system('whoami'); } public function down()`);
  const result = convert(source);
  assert.ok(result.warnings.some(w => w.code === 'IGNORED_CLASS_MEMBER' && /helper/.test(w.message)));
  assert.ok(result.warnings.some(w => /custom_flag/.test(w.message)));
  assert.ok(!result.warnings.some(w => /类成员 down /.test(w.message)));
  assert.doesNotMatch(result.sql, /DROP TABLE/);
});

test('unsigned types apply nonnegative check and explain reduced bigint range', () => {
  const result = convert(create(`$table->unsignedBigInteger('owner'); $table->unsignedInteger('count');`));
  assert.match(result.sql, /"owner" int8 NOT NULL CHECK \("owner" >= 0\)/);
  assert.match(result.sql, /"count" int8 NOT NULL CHECK \("count" >= 0 AND "count" <= 4294967295\)/);
  assert.ok(result.warnings.some(w => w.code === 'UNSIGNED_BIGINT_RANGE'));
});

test('addColumn parameters retain defaults and comments; named column argument resolves statically', () => {
  const result = convert(create(`$table->addColumn('string', 'name', ['length' => 20, 'comment' => '用户名'])->nullable(); $table->addColumn('smallInteger', 'status', ['default' => 1, 'comment' => '状态']); $table->unsignedInteger(column: 'version')->default(0);`));
  assert.match(result.sql, /"name" varchar\(20\)(?:,|\n)/);
  assert.match(result.sql, /COMMENT ON COLUMN "public"\."demo"\."name" IS '用户名'/);
  assert.match(result.sql, /"status" int2 NOT NULL DEFAULT 1/);
  assert.match(result.sql, /"version" int8 NOT NULL DEFAULT 0/);
  assert.throws(() => convert(create(`$table->string(unknown: 'name');`)), e => e.code === 'INVALID_NAMED_ARGUMENT');
});

test('separate alterations reject re-adding an existing column and preserve rename/drop knowledge', () => {
  assert.throws(() => convert(php(`Schema::create('demo', function ($t) { $t->integer('n'); }); Schema::table('demo', function ($t) { $t->integer('n'); });`)), e => e.code === 'DUPLICATE_COLUMN');
  const result = convert(php(`Schema::create('demo', function ($t) { $t->integer('n'); }); Schema::table('demo', function ($t) { $t->renameColumn('n', 'm'); }); Schema::table('demo', function ($t) { $t->index('m'); }); Schema::table('demo', function ($t) { $t->dropColumn('m'); }); Schema::table('demo', function ($t) { $t->integer('m'); });`));
  assert.match(result.sql, /RENAME COLUMN "n" TO "m"/);
  assert.match(result.sql, /DROP COLUMN "m"/);
});

test('alter commands preserve rename-before-unique and drop-before-recreate-index order', () => {
  const result = convert(php(`Schema::create('demo', function ($t) { $t->string('old')->index('reuse'); }); Schema::table('demo', function ($t) { $t->renameColumn('old', 'new'); $t->unique('new'); $t->dropIndex('reuse'); $t->index('new', 'reuse'); });`));
  assert.ok(result.sql.indexOf('RENAME COLUMN "old" TO "new"') < result.sql.indexOf('ADD CONSTRAINT "demo_new_unique"'));
  assert.ok(result.sql.indexOf('DROP INDEX "public"."reuse"') < result.sql.lastIndexOf('CREATE INDEX "reuse"'));
  for (const body of [`$t->dropColumn('x'); $t->string('x');`, `$t->string('x'); $t->dropColumn('x');`]) assert.throws(() => convert(php(`Schema::table('demo', function ($t) { ${body} });`)), e => e.code === 'CONFLICTING_OPERATION');
});

test('renaming then dropping a created table releases owned sequence names', () => {
  const result = convert(php(`Schema::create('demo', function ($t) { $t->id(); }); Schema::rename('demo', 'renamed'); Schema::drop('renamed'); Schema::create('demo', function ($t) { $t->id(); });`));
  assert.equal(result.sql.match(/CREATE SEQUENCE "public"\."demo_seq"/g).length, 2);
});

test('independent alterations of unknown pre-existing columns stay explicitly unverified', () => {
  const result = convert(php(`Schema::table('demo', function ($t) { $t->string('new'); }); Schema::table('demo', function ($t) { $t->index('existing'); });`));
  assert.equal(result.warnings.filter(w => w.code === 'EXISTING_TABLE_UNVERIFIED').length, 2);
});

test('decimal defaults must fit declared precision and scale without rounding', () => {
  for (const literal of ['1234.56', '1.234', '1e-20']) assert.throws(() => convert(create(`$table->decimal('price', 5, 2)->default(${literal});`)), e => e.code === 'DEFAULT_OUT_OF_RANGE');
  assert.match(convert(create(`$table->decimal('price', 5, 2)->default(1.2300);`)).sql, /DEFAULT 1\.2300/);
  assert.throws(() => convert(create(`$table->unsignedDecimal('price', 5, 2)->default(-1e-1000);`)), e => e.code === 'DEFAULT_OUT_OF_RANGE');
});

test('primary uniqueness is tracked across alteration blocks', () => {
  assert.throws(() => convert(php(`Schema::create('demo', function ($t) { $t->id(); $t->string('x'); }); Schema::table('demo', function ($t) { $t->primary('x'); });`)), e => e.code === 'DUPLICATE_PRIMARY');
  const result = convert(php(`Schema::create('demo', function ($t) { $t->id(); $t->string('x'); }); Schema::table('demo', function ($t) { $t->dropPrimary('demo_pkey'); $t->primary('x'); });`));
  assert.ok(result.sql.indexOf('DROP CONSTRAINT "demo_pkey"') < result.sql.indexOf('ADD PRIMARY KEY ("x")'));
});

test('drop column releases dependent indexes and ordered drop releases same-block constraints', () => {
  const result = convert(php(`Schema::create('demo', function ($t) { $t->string('x')->index(); }); Schema::table('demo', function ($t) { $t->dropColumn('x'); }); Schema::table('demo', function ($t) { $t->string('x')->index(); });`));
  assert.equal(result.sql.match(/CREATE INDEX "demo_x_index"/g).length, 2);
  const repeated = convert(php(`Schema::table('demo', function ($t) { $t->index('x'); $t->dropIndex(['x']); $t->index('x'); });`));
  assert.equal(repeated.sql.match(/CREATE INDEX "demo_x_index"/g).length, 2);
});

test('diagnostics retain the failing PHP line and source filename', () => {
  assert.throws(() => convert(create(`\n$table->string('ok');\n$table->unknown('bad');`), { sourceName: 'test-source.php' }), e => e.code === 'UNSUPPORTED_COLUMN' && e.line === 8 && e.message.startsWith('test-source.php:8:'));
  assert.throws(() => convert(create(`$table->string(;`)), e => e.code === 'PHP_SYNTAX_ERROR' && Number.isInteger(e.line));
});

test('identifier quotes and SQL-literal backslashes are escaped without executing strings', () => {
  const result = convert(php(`Schema::create('odd"table', function ($table) { $table->id(); $table->string('na"me')->default('C:\\\\work')->comment('O\\'Reilly'); });`));
  assert.match(result.sql, /CREATE TABLE "public"\."odd""table"/);
  assert.match(result.sql, /nextval\('"public"\."odd""table_seq"'::regclass\)/);
  assert.match(result.sql, /DEFAULT 'C:\\work'/);
  assert.match(result.sql, /IS 'O''Reilly'/);
});
