import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseSql } from '../src/core/reverse.js';
import { convertPhp } from '../src/core/converter.js';

const source = `
DROP TABLE IF EXISTS public.child;
DROP TABLE IF EXISTS public.parent;
DROP SEQUENCE IF EXISTS public.parent_seq;
CREATE SEQUENCE public.parent_seq START WITH 9;
CREATE TABLE public.parent (id bigint NOT NULL DEFAULT nextval('public.parent_seq'::regclass), label text, PRIMARY KEY(id));
ALTER SEQUENCE public.parent_seq OWNED BY public.parent.id;
COMMENT ON TABLE public.parent IS 'public.是业务注释内容';
CREATE TABLE public.child (id bigint PRIMARY KEY, parent_id bigint, CONSTRAINT child_parent_fk FOREIGN KEY(parent_id) REFERENCES public.parent(id));
INSERT INTO public.parent VALUES(1,'public.parent');
INSERT INTO public.child VALUES(2,1);`;

for (const targetVersion of [16, 18]) test(`reverse PG${targetVersion} omits default public only in PHP object references`, async () => {
  const result = await reverseSql(source, { targetVersion });
  assert.match(result.php, /Schema::create\('parent',/);
  assert.match(result.php, /Schema::dropIfExists\('parent'\)/);
  assert.match(result.php, /Schema::dropSequenceIfExists\('parent_seq'\)/);
  assert.match(result.php, /->on\('parent'\)/);
  assert.match(result.php, /'parent' => \[/);
  assert.match(result.php, /'child' => \[/);
  assert.match(result.php, /->comment\('public\.是业务注释内容'\)/);
  assert.match(result.php, /'label' => 'public\.parent'/);
  assert.doesNotMatch(result.php, /Schema::\w+\('public\./);
  assert.equal(result.verification.semanticEqual, true);
  const roundtrip = convertPhp(result.php, { targetVersion });
  assert.match(roundtrip.sql, /CREATE TABLE "public"\."parent"/);
  assert.match(roundtrip.sql, /REFERENCES "public"\."parent"/);
});

test('non-default, case-sensitive and public-like schemas retain their qualifiers', async () => {
  for (const schema of ['sales', 'Public', 'publicity']) {
    const result = await reverseSql(`CREATE TABLE "${schema}".demo(id bigint PRIMARY KEY); INSERT INTO "${schema}".demo VALUES(1);`, { targetVersion: 16 });
    assert.ok(result.php.includes(`Schema::create('${schema}.demo',`));
    assert.ok(result.php.includes(`'${schema}.demo' => [`));
    assert.equal(result.verification.semanticEqual, true);
  }
});
