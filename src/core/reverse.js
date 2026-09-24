import { createHash } from 'node:crypto';
import { convertPhp } from './converter.js';
import { canonicalModel, parseSqlModel, ReverseError } from './sql-model.js';
import { PHP_IMPORTS } from './php-contract.js';

export const REVERSE_VERSION = '0.5.0';
export const REVERSE_CAPABILITIES = Object.freeze({
  targetVersions: [16, 18], format: '每份 SQL 输出一个匿名 SqlStudio Migration PHP 文件',
  objectNames: 'PHP省略默认public schema前缀；非默认schema保留显式限定，注释与数据字面量不变',
  statements: ['CREATE TABLE', 'CREATE SEQUENCE', 'DROP TABLE', 'DROP SEQUENCE', 'ALTER SEQUENCE OWNED BY', 'ALTER TABLE ADD PRIMARY KEY', 'ALTER TABLE ALTER COLUMN SET DEFAULT', 'CREATE INDEX', 'CREATE UNIQUE INDEX', 'COMMENT ON TABLE/COLUMN/INDEX', 'INSERT VALUES'],
  validation: '目标版本 PostgreSQL AST → PHP → PostgreSQL AST；比较结构、注释、索引、外键、序列、删除行为与逐表初始化数据',
  limitations: ['只静态解析，不执行 PHP、SQL 或连接数据库', '未知语法、动态查询、CHECK、表达式索引、自定义类型和不能无损表示的选项会阻止输出', '自增列必须为 id 单字段整数主键，使用归属本表的 table_seq 整数序列', 'data() 采用按表名分组的字面量数据，保持原 INSERT 表顺序及逐表数据顺序；交错回写先前表会明确拒绝'],
});

const phpString = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
// 仅简写结构引用；业务字符串和注释继续使用原值。
const phpObjectName = value => phpString(value.startsWith('public.') ? value.slice(7) : value);
const literal = value => {
  if (value.kind === 'null') return 'null';
  if (value.kind === 'number') return value.value;
  if (value.kind === 'boolean') return value.value ? 'true' : 'false';
  if (value.kind === 'string') return phpString(value.value);
  throw new ReverseError('UNSUPPORTED_SQL_VALUE', '该表达式不能作为 PHP 静态字面量');
};
const list = names => `[${names.map(phpString).join(', ')}]`;
const actions = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

/** 将一份 PostgreSQL SQL 编写为可编辑 PHP migration，并在输出前核对往返语义。 */
export async function reverseSql(source, { targetVersion, sourceName = 'source.sql' } = {}) {
  const { model, parserVersion } = await parseSqlModel(source, targetVersion);
  const lines = ['<?php', '', 'declare(strict_types=1);', '', ...PHP_IMPORTS, '', 'return new class extends Migration {', '    /** 创建原 SQL 中的表结构、索引和注释，保留明确声明的删除操作。 */', '    public function up(): void', '    {'];
  // 序列绑定合并到字段定义前，先按原始先后次序保留全部明确的删除操作。
  for (const drop of model.drops) lines.push(`        Schema::${drop.kind === 'table' ? 'drop' : 'dropSequence'}${drop.ifExists ? 'IfExists' : ''}(${phpObjectName(drop.name)});`);
  if (model.drops.length) lines.push('');
  for (const owner of model.tables) {
    lines.push(`        Schema::create(${phpObjectName(owner.name)}, static function (Blueprint $table) {`);
    if (owner.comment !== null) lines.push(`            $table->comment(${phpString(owner.comment)});`);
    for (const column of owner.columns) {
      const type = column.type, args = [phpString(column.name)], auto = column.default?.kind === 'nextval';
      let method = { int8: 'bigInteger', int4: 'integer', int2: 'smallInteger', varchar: 'string', bpchar: 'char', text: 'text', numeric: 'decimal', float4: 'real', float8: 'double', bool: 'boolean', timestamp: 'timestamp', timestamptz: 'timestampTz', time: 'time', timetz: 'timeTz', date: 'date', bytea: 'binary', json: 'json', jsonb: 'jsonb', uuid: 'uuid', inet: 'ipAddress', macaddr: 'macAddress' }[type.name];
      if (auto) method = { int8: 'bigIncrements', int4: 'increments', int2: 'smallIncrements' }[type.name];
      if (['varchar', 'bpchar', 'numeric'].includes(type.name)) args.push(...type.modifiers);
      if (['timestamp', 'timestamptz', 'time', 'timetz'].includes(type.name)) args.push(type.modifiers[0] ?? 'null');
      let call = `$table->${method}(${args.join(', ')})`;
      if (auto) {
        const sequence = model.sequences.find(sequence => sequence.name === column.default.value);
        if (sequence.type !== type.name) call += `->sequenceType(${phpString(sequence.type)})`;
        call += `->startingValue(${sequence.start})`;
      }
      if (column.nullable) call += '->nullable()';
      if (column.default?.kind === 'current_timestamp') call += '->useCurrent()';
      else if (column.default !== undefined && !auto) call += `->default(${literal(column.default)})`;
      if (column.comment !== null) call += `->comment(${phpString(column.comment)})`;
      lines.push(`            ${call};`);
    }
    for (const constraint of owner.constraints) {
      const autoPrimary = constraint.kind === 'primary' && !constraint.name && constraint.columns.length === 1 && owner.columns.some(column => column.name === constraint.columns[0] && column.default?.kind === 'nextval');
      if (autoPrimary) continue;
      const args = [list(constraint.columns)];
      if (constraint.name) args.push(phpString(constraint.name));
      let call = `$table->${constraint.kind}(${args.join(', ')})`;
      if (constraint.kind === 'foreign') {
        call += `->references(${list(constraint.references)})->on(${phpObjectName(constraint.table)})`;
        if (!actions[constraint.onDelete] || !actions[constraint.onUpdate]) throw new ReverseError('UNSUPPORTED_SQL_CONSTRAINT', '外键动作不受支持');
        if (constraint.onDelete !== 'a') call += `->onDelete(${phpString(actions[constraint.onDelete])})`;
        if (constraint.onUpdate !== 'a') call += `->onUpdate(${phpString(actions[constraint.onUpdate])})`;
      }
      lines.push(`            ${call};`);
    }
    for (const index of model.indexes.filter(index => index.table === owner.name)) {
      const columns = index.columns.some(column => column.direction === 'desc') ? `[${index.columns.map(column => `${phpString(column.name)} => ${phpString(column.direction)}`).join(', ')}]` : list(index.columns.map(column => column.name));
      const args = [columns, phpString(index.name)];
      if (index.where.length) args.push(`[${index.where.map(part => `${phpString(part.column)} => ${literal(part.value)}`).join(', ')}]`);
      lines.push(`            $table->${index.unique ? 'uniqueIndex' : 'index'}(${args.join(', ')});`);
      if (index.comment !== null) lines.push(`            $table->indexComment(${phpString(index.name)}, ${phpString(index.comment)});`);
    }
    lines.push('        });', '');
  }
  if (lines.at(-1) === '') lines.pop();
  lines.push('    }');
  if (model.tables.some(owner => owner.rows.length)) {
    lines.push('', '    /** 按表名提供原 SQL 的初始化记录，保留每张表的数据行顺序。 */', '    public function data(): array', '    {', '        return [');
    for (const owner of model.dataOrder.map(name => model.tables.find(owner => owner.name === name))) {
      lines.push(`            ${phpObjectName(owner.name)} => [`);
      for (const row of owner.rows) lines.push(`                [${row.map(field => `${phpString(field.column)} => ${literal(field.value)}`).join(', ')}],`);
      lines.push('            ],');
    }
    lines.push('        ];', '    }');
  }
  lines.push('};', '');
  const php = lines.join('\n');
  let forward;
  try { forward = convertPhp(php, { targetVersion, sourceName: `${sourceName}.php` }); }
  catch (error) { throw new ReverseError('REVERSE_FORWARD_VALIDATION_FAILED', `生成的 PHP${error.line ? ` 第 ${error.line} 行` : ''}未通过转换校验（${error.code ?? 'UNKNOWN'}）；未输出文件`); }
  const regenerated = await parseSqlModel(forward.sql, targetVersion);
  const originalCanonical = canonicalModel(model), generatedCanonical = canonicalModel(regenerated.model);
  const originalText = JSON.stringify(originalCanonical), generatedText = JSON.stringify(generatedCanonical);
  if (originalText !== generatedText) {
    const difference = firstDifference(originalCanonical, generatedCanonical);
    throw new ReverseError('REVERSE_SEMANTIC_MISMATCH', `往返语义校验不一致：${difference}；未输出文件`);
  }
  const summary = {
    tables: model.tables.length, columns: model.tables.reduce((total, owner) => total + owner.columns.length, 0), sequences: model.sequences.length,
    indexes: model.indexes.length, foreignKeys: model.tables.reduce((total, owner) => total + owner.constraints.filter(constraint => constraint.kind === 'foreign').length, 0),
    seedRows: model.tables.reduce((total, owner) => total + owner.rows.length, 0), drops: model.drops.length,
  };
  return {
    php, warnings: forward.warnings, summary,
    verification: { semanticEqual: true, targetVersion, parserVersion, converterVersion: REVERSE_VERSION, coverage: ['tables', 'ordered-columns', 'types', 'nullability', 'defaults', 'primary-unique-foreign-constraints', 'sequences-and-ownership', 'indexes-and-predicates', 'comments', 'drop-order-and-flags', 'ordered-seed-rows-and-values'], ...summary, canonicalSha256: createHash('sha256').update(originalText).digest('hex'), databaseExecuted: false },
  };
}

/** 仅报告差异的结构路径，不泄露原 SQL 中的业务数据。 */
function firstDifference(left, right, path = '$') {
  if (JSON.stringify(left) === JSON.stringify(right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return path;
  if (Array.isArray(left) !== Array.isArray(right)) return path;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const result = firstDifference(left[key], right[key], `${path}.${key}`);
    if (result) return result;
  }
  return path;
}
