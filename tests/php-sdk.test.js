import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import PhpParser from 'php-parser';
import { CAPABILITIES } from '../src/core/converter.js';

const root = new URL('../php-sdk/', import.meta.url);
const parser = new PhpParser.Engine({ parser: { version: '8.0', extractDoc: true }, ast: { withPositions: true, withSource: true } });
const paths = ['Migrations/Migration', 'Schema/Schema', 'Schema/Blueprint', 'Schema/ColumnDefinition', 'Schema/ForeignIdColumnDefinition', 'Schema/ForeignKeyDefinition'];
const declarations = new Map();
for (const name of paths) {
  const source = await fs.readFile(new URL(`src/${name}.php`, root), 'utf8');
  const ast = parser.parseCode(source, `${name}.php`);
  const namespace = ast.children.find(node => node.kind === 'namespace');
  const definition = namespace.children.find(node => node.kind === 'class');
  declarations.set(name.split('/').at(-1), { source, ast, namespace, definition, methods: new Map(definition.body.filter(node => node.kind === 'method').map(node => [node.name.name, node])) });
}
const methodNames = name => [...declarations.get(name).methods.keys()].filter(name => !name.startsWith('__')).sort();
const normalize = names => [...new Set(names)].sort();
const method = (name, member) => declarations.get(name).methods.get(member);

test('SDK declares six PHP 8.0 types with PSR-4 and no framework or runtime dependencies', async () => {
  const composer = JSON.parse(await fs.readFile(new URL('composer.json', root), 'utf8'));
  assert.equal(composer.autoload['psr-4']['SqlStudio\\'], 'src/');
  assert.deepEqual(composer.require, { php: '>=8.0' });
  for (const [name, entry] of declarations) {
    assert.equal(`${entry.namespace.name}\\${name}`, `SqlStudio\\${paths.find(path => path.endsWith(`/${name}`)).replaceAll('/', '\\')}`);
    assert.doesNotMatch(entry.source, /Hyperf|Illuminate|__call(?:Static)?\s*\(/);
    assert.equal(entry.namespace.children.filter(node => node.kind !== 'class').length, 0, 'no executable top-level code or global helper');
    for (const member of entry.methods.values()) {
      if (member.isAbstract) continue;
      assert.equal(member.body.children.length, 1);
      assert.equal(member.body.children[0].kind, 'throw', `${name}::${member.name.name} must fail closed when executed`);
      assert.equal(member.body.children[0].what.what.name.replace(/^\\/, ''), 'LogicException');
    }
  }
});

test('SDK method inventory covers actual capabilities without magic fallbacks', () => {
  assert.deepEqual(methodNames('Schema'), normalize(CAPABILITIES.schemaMethods));
  assert.deepEqual(methodNames('Blueprint'), normalize([...CAPABILITIES.columnMethods, ...CAPABILITIES.macros, ...CAPABILITIES.tableMethods]));
  assert.deepEqual(methodNames('ColumnDefinition'), normalize(CAPABILITIES.columnModifiers));
  assert.deepEqual(methodNames('ForeignKeyDefinition'), normalize(CAPABILITIES.foreignModifiers));
  assert.deepEqual(methodNames('ForeignIdColumnDefinition'), ['constrained']);
  assert.deepEqual(methodNames('Migration'), ['data', 'up']);
});

test('SDK chain types distinguish column, constrained foreign key and void macros', () => {
  for (const name of CAPABILITIES.columnMethods) assert.equal(method('Blueprint', name).type.name, name === 'foreignId' ? 'ForeignIdColumnDefinition' : 'ColumnDefinition');
  assert.equal(method('Blueprint', 'foreign').type.name, 'ForeignKeyDefinition');
  assert.equal(method('Blueprint', 'addColumn').type.name, 'ColumnDefinition');
  assert.equal(method('ForeignIdColumnDefinition', 'constrained').type.name, 'ForeignKeyDefinition');
  for (const name of CAPABILITIES.columnModifiers) assert.equal(method('ColumnDefinition', name).type.name, 'static');
  for (const name of CAPABILITIES.foreignModifiers) assert.equal(method('ForeignKeyDefinition', name).type.name, 'static');
  for (const name of CAPABILITIES.macros) assert.equal(method('Blueprint', name).type.name, ['softDeletes', 'softDeletesTz', 'rememberToken'].includes(name) ? 'ColumnDefinition' : 'void');
});

test('SDK preserves meaningful precision, optional argument and bigint contracts', () => {
  const precision = method('Blueprint', 'timestamp').arguments[1];
  assert.equal(precision.name.name, 'precision');
  assert.equal(precision.nullable, true);
  assert.equal(precision.value.value, '0');
  assert.deepEqual(method('ColumnDefinition', 'startingValue').arguments[0].type.types.map(type => type.name), ['int', 'string']);
  assert.equal(method('Blueprint', 'uniqueIndex').arguments[1].value, null, 'index name is a required argument even though its value can be null');
  assert.match(declarations.get('Blueprint').source, /non-empty-array<string, 'asc'\|'desc'>/);
  assert.match(declarations.get('Blueprint').source, /non-empty-array<string, scalar\|null>/);
  assert.match(declarations.get('Migration').source, /list<array<string, scalar\|null>>\|array<string, list<array<string, scalar\|null>>>/);
  assert.match(declarations.get('Schema').source, /Closure\(Blueprint\): void/);
  assert.match(declarations.get('ColumnDefinition').source, /仅位置参数/);
  assert.match(declarations.get('Blueprint').source, /仅字段创建方法支持命名参数/);
});

test('portable IDE workspace indexes the common parent and permits large migration files', async () => {
  const workspace = JSON.parse(await fs.readFile(new URL('sql-studio.code-workspace', root), 'utf8'));
  assert.deepEqual(workspace.folders, [{ path: '..' }]);
  assert.equal(workspace.settings['intelephense.files.maxSize'], 33554432);
  assert.equal(workspace.settings['intelephense.environment.phpVersion'], '8.0.0');
  const exclude = workspace.settings['intelephense.files.exclude'];
  assert.ok(exclude.includes('**/.migration-sql-backups/**'));
  assert.ok(exclude.includes('**/.migration-sql-transactions/**'));
  assert.ok(exclude.includes('**/node_modules/**'));
  assert.equal(exclude.some(pattern => pattern.includes('sql-studio-sdk') || pattern.includes('src')), false);
});
