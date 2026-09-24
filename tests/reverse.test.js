import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseSql } from '../src/core/reverse.js';

const source = `DROP TABLE IF EXISTS demo;
DROP SEQUENCE IF EXISTS demo_seq;
CREATE SEQUENCE demo_seq AS bigint START WITH 4;
CREATE TABLE demo (id bigint NOT NULL DEFAULT nextval('demo_seq'::regclass), title varchar(80) NULL DEFAULT NULL, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id));
ALTER SEQUENCE demo_seq OWNED BY demo.id;
COMMENT ON COLUMN demo.title IS '标题';
COMMENT ON TABLE demo IS '示例';
CREATE UNIQUE INDEX demo_title_index ON demo(title DESC) WHERE id=0;
INSERT INTO demo (id,title,created_at) VALUES (1,'O''Reilly','2026-01-01 12:00:00'),(3,NULL,'2026-01-02 12:00:00');`;

for (const targetVersion of [16, 18]) test(`reverse preserves schema, initial data and target PG${targetVersion} semantics`, async () => {
  const result = await reverseSql(source, { targetVersion, sourceName: 'demo.sql' });
  assert.equal(result.verification.semanticEqual, true);
  assert.equal(result.summary.seedRows, 2);
  assert.match(result.php, /startingValue\(4\)/);
  assert.match(result.php, /timestamp\('created_at', null\)/);
  assert.match(result.php, /uniqueIndex/);
  assert.match(result.php, /O\\'Reilly/);
  assert.match(result.php, /public function data\(\)/);
  assert.equal(result.summary.drops, 2);
});

test('reverse retains each table and bigint/bytea values without precision loss', async () => {
  const result = await reverseSql(`CREATE TABLE first_table (id bigint NOT NULL PRIMARY KEY, payload bytea NULL); CREATE TABLE second_table (n int4); INSERT INTO first_table VALUES(9007199254740993,decode('00ff','hex')); INSERT INTO second_table VALUES(42);`, { targetVersion: 16 });
  assert.equal(result.summary.tables, 2);
  assert.equal(result.summary.seedRows, 2);
  assert.match(result.php, /9007199254740993/);
  assert.match(result.php, /\\\\x00ff/);
  assert.equal(result.verification.semanticEqual, true);
});

test('unknown SQL or unsupported options fail closed without leaking record contents', async () => {
  for (const sql of [
    'CREATE TABLE x (a int4 CHECK(a>0));',
    'CREATE TABLE x (a int4); UPDATE x SET a=1;',
    'CREATE TABLE x (a int4); INSERT INTO x VALUES(secret_function(123));',
    "CREATE TABLE x (a text); INSERT INTO x VALUES('SECRET'",
    'CREATE TABLE x (a int4); CREATE INDEX x_a ON x USING hash(a);',
    'CREATE SEQUENCE x_seq INCREMENT BY 2;',
  ]) await assert.rejects(() => reverseSql(sql, { targetVersion: 16 }), error => Boolean(error.code) && !error.message.includes('SECRET'));
});

test('rejects destructive lifecycle reordering and preserves drop flags', async () => {
  await assert.rejects(() => reverseSql('CREATE TABLE x(a int4); DROP TABLE x;', { targetVersion: 16 }), error => error.code === 'UNSUPPORTED_LIFECYCLE');
  const result = await reverseSql('DROP TABLE x; CREATE TABLE x(a int4);', { targetVersion: 16 });
  assert.match(result.php, /Schema::drop\('x'\)/);
  assert.equal(result.verification.semanticEqual, true);
});

test('retains independent unique indexes, index comments and wider sequence types', async () => {
  const result = await reverseSql(`CREATE SEQUENCE demo_seq START WITH 42; CREATE TABLE demo(id int4 NOT NULL DEFAULT nextval('demo_seq'::regclass), title varchar(10)); ALTER SEQUENCE demo_seq OWNED BY demo.id; ALTER TABLE demo ADD CONSTRAINT demo_pk PRIMARY KEY(id); CREATE UNIQUE INDEX demo_title ON demo(title); COMMENT ON INDEX demo_title IS '索引注释';`, { targetVersion: 16 });
  assert.match(result.php, /increments\('id'\)->sequenceType\('int8'\)->startingValue\(42\)/);
  assert.match(result.php, /primary\(\['id'\], 'demo_pk'\)/);
  assert.match(result.php, /indexComment\('demo_title', '索引注释'\)/);
  assert.equal(result.verification.semanticEqual, true);
});

test('late sequence default can merge when every prior seed row provides the id', async () => {
  const result = await reverseSql(`DROP TABLE IF EXISTS demo; CREATE TABLE demo(id int8 NOT NULL, title varchar(10)); ALTER TABLE demo ADD CONSTRAINT demo_pk PRIMARY KEY(id); INSERT INTO demo VALUES(1,'a'); DROP SEQUENCE IF EXISTS demo_seq; CREATE SEQUENCE demo_seq START WITH 2; ALTER SEQUENCE demo_seq OWNED BY demo.id; ALTER TABLE demo ALTER COLUMN id SET DEFAULT nextval('demo_seq'::regclass);`, { targetVersion: 18 });
  assert.equal(result.summary.seedRows, 1);
  assert.equal(result.verification.semanticEqual, true);
});

test('preserves first INSERT table order and rejects interleaved table groups', async () => {
  const definitions = 'CREATE TABLE a(id int4); CREATE TABLE b(id int4);';
  const result = await reverseSql(`${definitions} INSERT INTO b VALUES(2); INSERT INTO a VALUES(1);`, { targetVersion: 16 });
  const data = result.php.slice(result.php.indexOf('public function data'));
  assert.ok(data.indexOf("'b'") < data.indexOf("'a'"));
  await assert.rejects(() => reverseSql(`${definitions} INSERT INTO b VALUES(2); INSERT INTO a VALUES(1); INSERT INTO b VALUES(3);`, { targetVersion: 16 }), error => error.code === 'UNSUPPORTED_LIFECYCLE');
});

test('late defaults depending on old implicit values are rejected', async () => {
  await assert.rejects(() => reverseSql('CREATE TABLE demo(id int4, n int4 DEFAULT 1); INSERT INTO demo(id) VALUES(1); ALTER TABLE demo ALTER COLUMN n SET DEFAULT 2;', { targetVersion: 16 }), error => error.code === 'UNSUPPORTED_LIFECYCLE');
});

test('late foreign keys cannot be moved before referenced table creation or seed insertion', async () => {
  for (const source of [
    'CREATE TABLE child(id int4 NOT NULL PRIMARY KEY,parent_id int4); CREATE TABLE parent(id int4 NOT NULL PRIMARY KEY); ALTER TABLE child ADD CONSTRAINT child_parent FOREIGN KEY(parent_id) REFERENCES parent(id);',
    'CREATE TABLE parent(id int4 NOT NULL PRIMARY KEY); CREATE TABLE child(id int4 NOT NULL PRIMARY KEY,parent_id int4); INSERT INTO child VALUES(2,1); INSERT INTO parent VALUES(1); ALTER TABLE child ADD CONSTRAINT child_parent FOREIGN KEY(parent_id) REFERENCES parent(id);',
  ]) await assert.rejects(() => reverseSql(source, { targetVersion: 16 }), error => error.code === 'UNSUPPORTED_SQL_CONSTRAINT');
});

test('custom regclass and casts whose evaluation may change text are rejected', async () => {
  for (const source of [
    "CREATE SEQUENCE x_seq; CREATE TABLE x(id int8 NOT NULL DEFAULT nextval('x_seq'::public.regclass),PRIMARY KEY(id)); ALTER SEQUENCE x_seq OWNED BY x.id;",
    "CREATE TABLE x(a text); INSERT INTO x VALUES('001'::int4);",
  ]) await assert.rejects(() => reverseSql(source, { targetVersion: 16 }), error => error.code === 'UNSUPPORTED_SQL_VALUE');
});

test('composite foreign keys and actions survive the round trip', async () => {
  const result = await reverseSql('CREATE TABLE parent(a int4 NOT NULL,b varchar(20) NOT NULL,PRIMARY KEY(a,b)); CREATE TABLE child(id int4 NOT NULL PRIMARY KEY,a int4 NOT NULL,b varchar(20) NOT NULL,CONSTRAINT child_parent FOREIGN KEY(a,b) REFERENCES parent(a,b) ON DELETE RESTRICT ON UPDATE CASCADE);', { targetVersion: 18 });
  assert.equal(result.summary.foreignKeys, 1);
  assert.match(result.php, /references\(\['a', 'b'\]\)/);
  assert.match(result.php, /onDelete\('RESTRICT'\)->onUpdate\('CASCADE'\)/);
});

test('invalid integer text and bytea prefixes are not normalized into valid data', async () => {
  for (const source of [
    "CREATE TABLE x(a int4); INSERT INTO x VALUES('1.0');",
    "CREATE TABLE x(a int8); INSERT INTO x VALUES('1e2');",
    "CREATE TABLE x(a bytea); INSERT INTO x VALUES('\\XFF');",
  ]) await assert.rejects(() => reverseSql(source, { targetVersion: 16 }), error => error.code === 'UNSUPPORTED_SQL_VALUE');
  const result = await reverseSql("CREATE TABLE x(a bytea,n int8); INSERT INTO x VALUES('\\xFF','9007199254740993');", { targetVersion: 16 });
  assert.match(result.php, /\\\\xff/);
  assert.match(result.php, /9007199254740993/);
  assert.equal(result.verification.semanticEqual, true);
});
