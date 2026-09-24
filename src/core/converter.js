import PhpParser from 'php-parser';
import { isIP } from 'node:net';
import { ACCEPTED_PHP_CLASSES, PHP_CLASSES } from './php-contract.js';

export const COMPILER_VERSION = '0.4.0';

const integerKinds = {
  biginteger: { type: 'int8', min: '-9223372036854775808', max: '9223372036854775807', unsignedMax: null },
  integer: { type: 'int4', min: '-2147483648', max: '2147483647', unsignedMax: '4294967295', unsignedType: 'int8' },
  mediuminteger: { type: 'int4', min: '-8388608', max: '8388607', unsignedMax: '16777215', unsignedType: 'int4', checkSigned: true },
  smallinteger: { type: 'int2', min: '-32768', max: '32767', unsignedMax: '65535', unsignedType: 'int4' },
  tinyinteger: { type: 'int2', min: '-128', max: '127', unsignedMax: '255', unsignedType: 'int2', checkSigned: true },
};
const incrementKinds = { id: 'biginteger', bigincrements: 'biginteger', increments: 'integer', mediumincrements: 'mediuminteger', smallincrements: 'smallinteger', tinyincrements: 'tinyinteger' };
const simpleTypes = { text: 'text', mediumtext: 'text', longtext: 'text', boolean: 'boolean', date: 'date', json: 'json', jsonb: 'jsonb', binary: 'bytea', uuid: 'uuid', ipaddress: 'inet', macaddress: 'macaddr', real: 'real', year: 'int4' };
const temporalKinds = ['timestamp', 'timestamptz', 'datetime', 'datetimetz', 'time', 'timetz'];
const macroNames = ['timestamps', 'timestampsTz', 'nullableTimestamps', 'datetimes', 'softDeletes', 'softDeletesTz', 'rememberToken', 'authorBy', 'morphs', 'nullableMorphs', 'uuidMorphs', 'nullableUuidMorphs'];
const columnMethods = ['id', 'bigIncrements', 'increments', 'mediumIncrements', 'smallIncrements', 'tinyIncrements', 'bigInteger', 'integer', 'mediumInteger', 'smallInteger', 'tinyInteger', 'unsignedBigInteger', 'unsignedInteger', 'unsignedMediumInteger', 'unsignedSmallInteger', 'unsignedTinyInteger', 'foreignId', 'char', 'string', 'text', 'mediumText', 'longText', 'decimal', 'unsignedDecimal', 'float', 'double', 'real', 'boolean', 'date', 'timestamp', 'timestampTz', 'dateTime', 'dateTimeTz', 'time', 'timeTz', 'year', 'json', 'jsonb', 'binary', 'uuid', 'ipAddress', 'macAddress', 'enum'];
const columnModifierNames = ['nullable', 'default', 'comment', 'unsigned', 'autoIncrement', 'startingValue', 'sequenceType', 'index', 'unique', 'primary', 'useCurrent'];
const foreignModifierNames = ['references', 'on', 'onDelete', 'onUpdate', 'cascadeOnDelete', 'cascadeOnUpdate', 'restrictOnDelete', 'restrictOnUpdate', 'nullOnDelete', 'nullOnUpdate', 'noActionOnDelete', 'noActionOnUpdate'];
export const CAPABILITIES = Object.freeze({
  phpClasses: PHP_CLASSES,
  foreignIdModifiers: ['constrained'],
  targetVersions: [16, 18],
  schemaMethods: ['create', 'table', 'dropIfExists', 'drop', 'rename', 'dropSequenceIfExists', 'dropSequence'],
  columnMethods,
  macros: macroNames,
  columnModifiers: columnModifierNames,
  tableMethods: ['comment', 'index', 'uniqueIndex', 'indexComment', 'unique', 'primary', 'foreign', 'addColumn', 'dropColumn', 'renameColumn', 'dropIndex', 'dropUnique', 'dropPrimary', 'dropForeign'],
  foreignModifiers: foreignModifierNames,
  seedData: { method: 'public function data()', shape: '唯一 return 的字面量行数组（单个 Schema::create），或 table=>rows 有序映射（多表 create/drop 初始化）', scalarValues: ['string', 'number', 'boolean', 'null'], mixedExplicitIds: '默认 START WITH max(1,最大显式ID+1)；startingValue 明确保留起点并校验碰撞和剩余范围。所有 DDL 完成后按表键和行顺序逐条 INSERT', selfForeignKeys: '允许当前或此前种子行引用，拒绝前向或缺失引用；不自动重排' },
  reverseDsl: { startingValue: 'auto 列接受正十进制整数或字符串', sequenceType: 'auto 列可显式指定 int8/int4/int2 序列类型；同时验证序列与字段范围', timePrecision: '显式 null 输出不带精度的 timestamp/time；seed 保留六位小数秒', indexDirections: 'index/uniqueIndex 支持 column=>asc|desc 映射', uniqueIndex: '独立唯一索引；可选第三参数为字段=>scalar/null 的 AND 等值条件', indexComment: 'indexComment(indexName, commentString)，在当前表索引 DDL 后输出独立 COMMENT ON INDEX' },
  outputStyle: { integerTypes: ['int8', 'int4', 'int2'], nativeAuto: '普通自增采用 PostgreSQL 有符号完整范围；显式 unsigned 仍受约束', primaryKey: '默认 PRIMARY KEY(...)；仅显式自定义名称输出 CONSTRAINT', sequence: 'CREATE SEQUENCE 默认 AS 字段最终整数类型，sequenceType 可显式覆盖；START WITH 静态起点，不输出 setval', seedInsert: '每行一条 INSERT，保持 data() 行顺序' },
  existsDrop: { property: 'public bool $exists_drop = false;', default: false, scope: '仅单个 Schema::create；true 生成目标表和本次生成序列名称的 DROP IF EXISTS，无 CASCADE' },
  limitations: ['静态解析 up()、data() 和 exists_drop，不执行 PHP 或连接数据库', 'config() 仅接受显式 flat key 配置，data() 不允许函数调用', 'list data()/exists_drop=true 仅支持单个 Schema::create；keyed data 仅支持 create/drop表/drop序列的初始化，不能修改或重命名数据目标', '拒绝动态表达式、分支、循环、原始 SQL、未知方法及修饰符', '显式 unsigned bigint 使用非负 int8，最大值 9223372036854775807，并产生警告', 'Schema::table 仅支持添加、删除、重命名和索引约束操作；不支持 change()', 'foreignId()->constrained() 必须显式提供目标表名', '种子数据类型文本使用明确的 ISO 日期时间、标准 UUID/IP/MAC、有效 JSON 或十六进制 bytea；外部外键仍需数据库验证'],
});

const parser = new PhpParser.Engine({ parser: { suppressErrors: false, extractDoc: true, version: '8.3' }, ast: { withPositions: true, withSource: true } });
const numericTag = Symbol('decimal-literal');
const arrayKeysTag = Symbol('php-array-key-order');
const numeric = text => ({ numeric: text, [numericTag]: true });
const isNumeric = value => value !== null && typeof value === 'object' && value[numericTag] === true;
const q = identifier => `"${identifier.replaceAll('"', '""')}"`;
const qualified = parts => parts.map(q).join('.');
const quote = text => `'${String(text).replaceAll("'", "''")}'`;

export class ConversionError extends Error {
  constructor(code, message, node, sourceName) {
    const line = node?.loc?.start?.line;
    super(`${sourceName}${line ? `:${line}` : ''}: ${message}`);
    this.name = 'ConversionError'; this.code = code; this.line = line; this.sourceName = sourceName;
  }
}

/** 仅遍历受支持的 AST 节点，不载入、执行或求值 PHP 程序。 */
export function convertPhp(source, { targetVersion, config = {}, sourceName = 'migration.php' } = {}) {
  const fail = (code, message, node) => { throw new ConversionError(code, message, node, sourceName); };
  if (![16, 18].includes(targetVersion)) fail('UNSUPPORTED_VERSION', 'targetVersion 必须明确指定为数字 16 或 18');
  if (typeof source !== 'string' || !source.trim()) fail('INVALID_SOURCE', 'PHP 源码不能为空');
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('INVALID_CONFIG', 'config 必须是扁平 JSON 对象');
  if (!source.trimStart().startsWith('<?php')) fail('INVALID_SOURCE', '文件必须以 <?php 开始');
  let ast;
  try { ast = parser.parseCode(source, sourceName); }
  catch (error) {
    const node = { loc: { start: { line: error.lineNumber ?? error.loc?.start?.line } } };
    fail('PHP_SYNTAX_ERROR', error.message, node);
  }
  const warnings = [], sql = [], tables = new Set(), objects = new Map(), objectColumns = new Map(), objectKinds = new Map(), knownTables = new Map(), completeTables = new Set(), primaryTables = new Map();
  const warn = (code, message, node) => warnings.push({ code, message, ...(node?.loc?.start?.line ? { line: node.loc.start.line } : {}) });
  let aliases = new Map(), namespace = '', migration;
  const supportedClass = (node, suffix) => {
    if (node?.kind !== 'name') return false;
    let name = node.name.replace(/^\\/, '');
    const parts = name.split('\\');
    if (node.resolution !== 'fqn') {
      const alias = aliases.get(parts[0].toLowerCase());
      name = alias ? [alias, ...parts.slice(1)].join('\\') : (namespace ? `${namespace}\\${name}` : name);
    }
    return ACCEPTED_PHP_CLASSES[suffix].some(expected => expected.toLowerCase() === name.toLowerCase());
  };
  const discover = nodes => {
    for (const node of nodes) {
      if (node.kind === 'declare') {
        if (node.body || node.directives?.some(d => d.key?.name !== 'strict_types' || d.value?.kind !== 'number' || d.value.value !== '1')) fail('UNSUPPORTED_TOP_LEVEL', '仅支持 declare(strict_types=1)', node);
      } else if (node.kind === 'usegroup') {
        if (node.type) fail('UNSUPPORTED_IMPORT', '不支持 use function 或 use const', node);
        for (const item of node.items) {
          if (item.type) fail('UNSUPPORTED_IMPORT', '不支持 use function 或 use const', item);
          const full = `${node.name ? `${node.name}\\` : ''}${item.name}`.replace(/^\\/, '');
          const alias = (item.alias?.name ?? item.alias ?? full.split('\\').at(-1)).toLowerCase();
          if (aliases.has(alias)) fail('DUPLICATE_IMPORT', `重复别名 ${alias}`, item);
          aliases.set(alias, full);
        }
      } else if (node.kind === 'namespace') {
        if (migration || namespace) fail('UNSUPPORTED_NAMESPACE', '每文件只支持一个命名空间和一个 Migration', node);
        namespace = node.name ?? ''; discover(node.children);
      } else {
        const candidate = node.kind === 'class' ? node : node.kind === 'return' && node.expr?.kind === 'new' && node.expr.what?.kind === 'class' && node.expr.arguments.length === 0 ? node.expr.what : null;
        if (!candidate) fail('UNSUPPORTED_TOP_LEVEL', '仅支持导入、命名空间和单个 Migration 类；顶层可执行语句不受支持', node);
        if (migration) fail('MULTIPLE_MIGRATIONS', '每文件只支持一个 Migration 类', node);
        if (!supportedClass(candidate.extends, 'Migration')) fail('UNSUPPORTED_CLASS', 'Migration 必须继承 SqlStudio\\Migrations\\Migration（兼容原 Hyperf/Illuminate 类）', candidate);
        if (candidate.isAbstract || candidate.implements?.length || candidate.attrGroups?.length) fail('UNSUPPORTED_CLASS', '不支持抽象 Migration、接口或 PHP 属性', candidate);
        migration = candidate;
      }
    }
  };
  discover(ast.children);
  if (!migration) fail('MISSING_MIGRATION', '未找到 Migration 类');
  const methods = migration.body.filter(n => n.kind === 'method' && n.name?.name?.toLowerCase() === 'up');
  if (methods.length !== 1) fail('MISSING_UP', 'Migration 必须包含唯一的 up() 方法', migration);
  const up = methods[0];
  if (!up.body || up.arguments.length || up.isStatic || up.visibility !== 'public' || up.byref || up.attrGroups?.length) fail('UNSUPPORTED_UP', 'up() 必须为无参数 public 实例方法', up);
  const dataMethods = migration.body.filter(n => n.kind === 'method' && n.name?.name?.toLowerCase() === 'data');
  if (dataMethods.length > 1) fail('INVALID_SEED_METHOD', 'data() 只能定义一次', dataMethods[1]);
  const dataMethod = dataMethods[0];
  if (dataMethod && (!dataMethod.body || dataMethod.arguments.length || dataMethod.isStatic || dataMethod.visibility !== 'public' || dataMethod.byref || dataMethod.attrGroups?.length || dataMethod.type && (dataMethod.type.kind !== 'typereference' || dataMethod.type.name.toLowerCase() !== 'array') || dataMethod.nullable)) fail('INVALID_SEED_METHOD', 'data() 必须是无参数、非 static 的 public 方法，返回类型只能省略或为 array', dataMethod);
  const dropProperties = migration.body.flatMap(member => member.kind === 'propertystatement' ? member.properties.filter(property => property.name?.name === 'exists_drop').map(property => ({ member, property })) : []);
  if (dropProperties.length > 1) fail('INVALID_EXISTS_DROP', 'exists_drop 只能定义一次', dropProperties[1].property);
  const dropProperty = dropProperties[0];
  if (dropProperty && (dropProperty.member.visibility !== 'public' || dropProperty.member.isStatic || dropProperty.property.type?.kind !== 'typereference' || dropProperty.property.type.name.toLowerCase() !== 'bool' || dropProperty.property.nullable || dropProperty.property.readonly || dropProperty.property.hooks?.length || dropProperty.property.attrGroups?.length || dropProperty.property.value?.kind !== 'boolean')) fail('INVALID_EXISTS_DROP', 'exists_drop 必须为 public 非 static bool 属性，默认值必须是字面量 true/false', dropProperty.property);
  const existsDrop = dropProperty?.property.value.value ?? false;
  const singleCreate = up.body.children.length === 1 && up.body.children[0].kind === 'expressionstatement' && up.body.children[0].expression?.kind === 'call' && up.body.children[0].expression.what?.kind === 'staticlookup' && supportedClass(up.body.children[0].expression.what.what, 'Schema') && up.body.children[0].expression.what.offset?.name?.toLowerCase() === 'create';
  if (existsDrop && !singleCreate) fail('AMBIGUOUS_EXISTS_DROP', 'exists_drop=true 只允许 up() 中恰好一个 Schema::create；多表或复杂迁移请拆分文件', dropProperty.property);
  let dataOuter;
  if (dataMethod) {
    const statements = dataMethod.body.children;
    if (statements.length !== 1 || statements[0].kind !== 'return' || statements[0].expr?.kind !== 'array') fail('INVALID_SEED_METHOD', 'data() 必须只包含一条 return 字面量行数组或表名映射', dataMethod);
    dataOuter = statements[0].expr;
  }
  const keyedData = dataOuter?.items.some(entry => entry?.key) ?? false;
  if (dataMethod && !keyedData && !singleCreate) fail('AMBIGUOUS_SEED_TARGET', 'list data() 只允许 up() 中恰好一个 Schema::create；多表请使用表名=>行数组映射', dataMethod);
  for (const member of migration.body) {
    if (member === up || member === dataMethod || member.kind === 'method' && member.name?.name?.toLowerCase() === 'down') continue;
    if (member.kind === 'traituse') fail('UNSUPPORTED_CLASS', '不支持 trait，无法静态确认 up() 的完整行为', member);
    const properties = member.properties?.filter(p => p !== dropProperty?.property);
    if (properties && !properties.length) continue;
    const name = member.name?.name ?? properties?.map(p => p.name?.name ?? p.name).join(', ') ?? member.kind;
    warn('IGNORED_CLASS_MEMBER', `只转换受支持的 up()/data()/exists_drop；类成员 ${name} 未转换或执行`, member);
  }
  const createdContexts = [], finalCreated = new Map();

  const arity = (args, min, max, node, method) => {
    if (args.length < min || args.length > max) fail('INVALID_ARGUMENTS', `${method}() 需要 ${min === max ? min : `${min}–${max}`} 个位置参数`, node);
  };
  const value = node => {
    if (!node) fail('INVALID_ARGUMENTS', '缺少参数', node);
    if (node.kind === 'string') {
      if (node.value.includes('\0')) fail('INVALID_LITERAL', 'PostgreSQL 字符串不能含 NUL', node);
      return node.value;
    }
    if (node.kind === 'number') {
      const raw = String(node.value).replaceAll('_', '');
      if (!/^(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?$|^\.\d+(?:[eE][+-]?\d+)?$/.test(raw)) fail('UNSUPPORTED_NUMBER', '只支持十进制数值字面量（不支持八进制/十六进制）', node);
      return numeric(raw);
    }
    if (node.kind === 'boolean') return node.value;
    if (node.kind === 'nullkeyword') return null;
    if (node.kind === 'unary' && ['-', '+'].includes(node.type)) {
      const operand = value(node.what);
      if (!isNumeric(operand)) fail('INVALID_LITERAL', '正负号只支持数值字面量', node);
      return numeric(node.type === '-' ? `-${operand.numeric}` : operand.numeric);
    }
    if (node.kind === 'array') {
      const entries = node.items;
      if (entries.some(i => !i || i.kind !== 'entry' || i.byRef || i.unpack)) fail('UNSUPPORTED_ARRAY', '不支持数组解包或引用', node);
      if (entries.every(i => !i.key)) return entries.map(i => value(i.value));
      if (entries.some(i => !i.key)) fail('UNSUPPORTED_ARRAY', '不支持混合关联数组', node);
      const out = Object.create(null);
      out[arrayKeysTag] = [];
      for (const entry of entries) {
        const key = value(entry.key);
        if (typeof key !== 'string' || Object.hasOwn(out, key)) fail('INVALID_ARRAY', '选项数组的键必须是唯一字符串', entry);
        out[key] = value(entry.value);
        out[arrayKeysTag].push(key);
      }
      return out;
    }
    if (node.kind === 'call' && node.what?.kind === 'name' && node.what.name.replace(/^\\/, '').toLowerCase() === 'config') {
      arity(node.arguments, 1, 1, node, 'config');
      const key = value(node.arguments[0]);
      if (typeof key !== 'string') fail('INVALID_CONFIG', 'config() 的键必须是字符串', node);
      if (!Object.hasOwn(config, key)) fail('MISSING_CONFIG', `缺少显式配置键 ${key}；请提供 config JSON`, node);
      const resolved = config[key];
      if (typeof resolved === 'number') {
        if (!Number.isFinite(resolved) || !Number.isSafeInteger(resolved)) fail('INVALID_CONFIG', `配置 ${key} 的数值需使用字符串保留精度`, node);
        return numeric(String(resolved));
      }
      if (!['string', 'boolean'].includes(typeof resolved) && resolved !== null) fail('INVALID_CONFIG', `配置 ${key} 必须为字符串、布尔、null 或安全整数`, node);
      if (typeof resolved === 'string' && resolved.includes('\0')) fail('INVALID_CONFIG', `配置 ${key} 含 NUL`, node);
      return resolved;
    }
    fail('UNSUPPORTED_EXPRESSION', `不支持动态表达式或函数调用：${node.kind}`, node);
  };
  const string = (v, node, label = '值') => {
    if (typeof v !== 'string') fail('INVALID_ARGUMENTS', `${label}必须是字符串`, node);
    return v;
  };
  const identifier = (v, node) => {
    string(v, node, '标识符');
    if (!v || /[\u0000-\u001f\u007f]/.test(v) || Buffer.byteLength(v, 'utf8') > 63) fail('INVALID_IDENTIFIER', '标识符不能为空、含控制字符或超过 PostgreSQL 63 字节限制', node);
    return v;
  };
  const tableName = (v, node) => {
    const parts = string(v, node, '表名').split('.');
    if (parts.length === 1) parts.unshift('public');
    if (parts.length !== 2) fail('INVALID_IDENTIFIER', '表名只支持 table 或 schema.table', node);
    parts.forEach(p => identifier(p, node));
    return parts;
  };
  // 保留 PHP 的表键顺序，不能用普通对象的数字键排序替代。
  const seedGroups = new Map();
  if (keyedData) for (const entry of dataOuter.items) {
    if (!entry || entry.kind !== 'entry' || entry.byRef || entry.unpack || entry.key?.kind !== 'string' || entry.value?.kind !== 'array') fail('INVALID_SEED_ROWS', 'keyed data() 只接受静态表名字符串到字面量行数组的映射', entry ?? dataOuter);
    const parts = tableName(entry.key.value, entry.key), key = parts.join('\0');
    if (seedGroups.has(key)) fail('DUPLICATE_SEED_TARGET', `重复种子目标 ${parts.join('.')}`, entry);
    seedGroups.set(key, { parts, outer: entry.value, node: entry });
  }
  const int = (v, min, max, node, label) => {
    if (!isNumeric(v) || !/^\d+$/.test(v.numeric)) fail('INVALID_ARGUMENTS', `${label}必须是整数`, node);
    const n = Number(v.numeric);
    if (!Number.isSafeInteger(n) || n < min || n > max) fail('INVALID_ARGUMENTS', `${label}必须在 ${min}–${max} 之间`, node);
    return n;
  };
  const bool = (v, node, label) => { if (typeof v !== 'boolean') fail('INVALID_ARGUMENTS', `${label}必须是布尔值`, node); return v; };
  const list = (v, node) => {
    const values = Array.isArray(v) ? v : [v];
    if (!values.length) fail('INVALID_ARGUMENTS', '列列表不能为空', node);
    values.forEach(v => identifier(v, node));
    if (new Set(values).size !== values.length) fail('INVALID_ARGUMENTS', '列列表不能重复', node);
    return values;
  };
  const register = (schema, name, node, owner, columns = [], kind = 'table') => {
    identifier(name, node);
    const key = `${schema}\0${name}`;
    if (objects.has(key)) fail('DUPLICATE_OBJECT', `重复 SQL 对象 ${schema}.${name}`, node);
    objects.set(key, owner);
    objectColumns.set(key, [...columns]);
    objectKinds.set(key, kind);
  };
  const callArgs = (method, nodes, node) => {
    if (!nodes.some(n => n.kind === 'namedargument')) return nodes.map(value);
    const signature = integerKinds[method] ? ['column', 'autoIncrement', 'unsigned']
      : method.startsWith('unsigned') && integerKinds[method.slice(8)] ? ['column', 'autoIncrement']
        : incrementKinds[method] || Object.hasOwn(simpleTypes, method) || method === 'foreignid' ? ['column']
          : ['string', 'char'].includes(method) ? ['column', 'length']
            : ['decimal', 'unsigneddecimal', 'float', 'double'].includes(method) ? ['column', 'total', 'places']
              : temporalKinds.includes(method) ? ['column', 'precision']
                : method === 'enum' ? ['column', 'allowed'] : null;
    if (!signature) fail('INVALID_NAMED_ARGUMENT', `不支持 ${method}() 的命名参数`, node);
    const result = [], used = new Set(); let named = false;
    for (const argument of nodes) {
      if (argument.kind === 'namedargument') {
        named = true;
        const index = signature.indexOf(argument.name);
        if (index < 0 || used.has(index)) fail('INVALID_NAMED_ARGUMENT', `未知或重复命名参数 ${argument.name}`, argument);
        used.add(index); result[index] = value(argument.value);
      } else {
        if (named) fail('INVALID_NAMED_ARGUMENT', '位置参数不能出现在命名参数之后', argument);
        used.add(result.length); result.push(value(argument));
      }
    }
    return result;
  };
  const chain = (node, variable) => {
    const calls = [];
    let current = node;
    while (current?.kind === 'call' && current.what?.kind === 'propertylookup' && current.what.offset?.kind === 'identifier') {
      const method = current.what.offset.name.toLowerCase();
      calls.unshift({ method, display: current.what.offset.name, args: callArgs(method, current.arguments, current), node: current });
      current = current.what.what;
    }
    if (current?.kind !== 'variable' || current.name !== variable || !calls.length) fail('UNSUPPORTED_STATEMENT', `只支持 $${variable}->已支持方法(...)`, node);
    return calls;
  };
  const forbidChain = (calls, node) => { if (calls.length) fail('UNSUPPORTED_MODIFIER', '该 Blueprint 方法不返回可修改的单列定义，不能链式调用', node); };
  const indexName = (ctx, columns, kind, custom, node) => identifier(custom ?? `${ctx.parts[1]}_${columns.join('_')}_${kind}`, node);
  // 读取关联数组时沿用 PHP 的原始键顺序。
  const entries = object => (object[arrayKeysTag] ?? Object.keys(object)).map(key => [key, object[key]]);
  // 方向映射只接受列标识符与 ASC/DESC，不接受表达式或排序附加语法。
  const indexDefinition = (input, node) => {
    if (input && typeof input === 'object' && !Array.isArray(input) && !isNumeric(input)) {
      const pairs = entries(input);
      if (!pairs.length) fail('INVALID_INDEX_DIRECTION', '索引列方向映射不能为空', node);
      return { columns: pairs.map(([name]) => identifier(name, node)), directions: pairs.map(([, direction]) => {
        if (typeof direction !== 'string' || !['asc', 'desc'].includes(direction.toLowerCase())) fail('INVALID_INDEX_DIRECTION', '索引方向仅支持 asc 或 desc', node);
        return direction.toUpperCase();
      }) };
    }
    return { columns: list(input, node), directions: [] };
  };

  const primaryName = (ctx, node) => {
    for (let suffix = 0; ; suffix++) {
      const label = `pkey${suffix || ''}`, budget = 63 - Buffer.byteLength(label) - 1;
      let prefix = '', bytes = 0;
      for (const character of ctx.parts[1]) {
        const length = Buffer.byteLength(character);
        if (bytes + length > budget) break;
        prefix += character; bytes += length;
      }
      const name = `${prefix}_${label}`, objectKey = `${ctx.parts[0]}\0${name}`;
      if (!objects.has(objectKey)) return name;
      if (!ctx.preexistingObjects.has(objectKey)) fail('DUPLICATE_OBJECT', `本次操作中的对象 ${name} 与 PostgreSQL 自动主键名称冲突；请使用显式自定义名称`, node);
    }
  };
  const constraint = (ctx, kind, columns, custom, node, details = {}) => {
    columns = list(columns, node);
    if (kind === 'primary' && primaryTables.has(ctx.key)) fail('DUPLICATE_PRIMARY', `表 ${ctx.parts.join('.')} 存在多个主键`, node);
    const named = custom !== undefined && custom !== null;
    const name = kind === 'primary' && !named ? primaryName(ctx, node) : indexName(ctx, columns, kind, custom, node);
    if (ctx.constraints.some(c => c.name === name)) fail('DUPLICATE_OBJECT', `重复约束 ${name}`, node);
    if (kind === 'primary') {
      primaryTables.set(ctx.key, name);
    }
    if (kind !== 'foreign') register(ctx.parts[0], name, node, ctx.key, [...columns, ...Object.keys(details.predicate ?? {})], kind);
    const command = { kind, columns, name, named, node, ...details };
    ctx.constraints.push(command); ctx.commands.push(command);
  };

  const addColumn = (ctx, method, args, node) => {
    let unsigned = false, auto = false, base = method;
    const column = { name: null, type: null, nullable: false, node, checks: [], indexes: [], default: undefined, comment: undefined };
    if (incrementKinds[base]) {
      arity(args, base === 'id' ? 0 : 1, 1, node, method);
      column.name = identifier(args[0] ?? 'id', node); base = incrementKinds[base]; auto = true;
    } else if (base.startsWith('unsigned') && integerKinds[base.slice(8)]) { unsigned = true; base = base.slice(8); }
    if (base === 'foreignid') { base = 'biginteger'; unsigned = true; arity(args, 1, 1, node, method); }
    if (integerKinds[base]) {
      if (!auto) {
        arity(args, 1, method.startsWith('unsigned') ? 2 : method === 'foreignid' ? 1 : 3, node, method); column.name = identifier(args[0], node);
        if (args[1] !== undefined) auto = bool(args[1], node, 'autoIncrement');
        if (args[2] !== undefined) unsigned = bool(args[2], node, 'unsigned');
      }
      column.integer = base; column.type = integerKinds[base].type; column.unsigned = unsigned; column.auto = auto;
    } else if (base === 'string' || base === 'char') {
      arity(args, 1, 2, node, method); column.name = identifier(args[0], node);
      const length = args[1] === undefined || args[1] === null ? 255 : int(args[1], 1, 10485760, node, '长度');
      column.type = `${base === 'string' ? 'varchar' : 'char'}(${length})`; column.length = length;
    } else if (base === 'decimal' || base === 'unsigneddecimal') {
      arity(args, 1, 3, node, method); column.name = identifier(args[0], node);
      const precision = args[1] === undefined ? 8 : int(args[1], 1, 1000, node, '精度');
      const scale = args[2] === undefined ? 2 : int(args[2], 0, precision, node, '小数位数');
      if (scale > precision) fail('INVALID_ARGUMENTS', '小数位数不能大于精度', node);
      column.type = `numeric(${precision}, ${scale})`; column.numeric = true; column.precision = precision; column.scale = scale; column.unsigned = base === 'unsigneddecimal';
    } else if (['float', 'double'].includes(base)) {
      arity(args, 1, 3, node, method); column.name = identifier(args[0], node); column.type = 'double precision'; column.numeric = true;
      for (const precision of args.slice(1)) if (precision !== null && precision !== undefined) int(precision, 0, 1000, node, '浮点参数');
      if (args.length > 1) warn('FLOAT_PRECISION_NOT_ENFORCED', `${method} 的精度参数在 PostgreSQL 中不生效，使用 double precision`, node);
    } else if (temporalKinds.includes(base)) {
      arity(args, 1, 2, node, method); column.name = identifier(args[0], node);
      const precision = args[1] === null ? null : args[1] === undefined ? 0 : int(args[1], 0, 6, node, '时间精度');
      column.type = `${base.startsWith('time') && !base.startsWith('timestamp') ? 'time' : 'timestamp'}${precision === null ? '' : `(${precision})`}${base.endsWith('tz') ? ' with time zone' : ''}`; column.temporal = true;
    } else if (Object.hasOwn(simpleTypes, base)) {
      arity(args, 1, 1, node, method); column.name = identifier(args[0], node); column.type = simpleTypes[base];
      if (base === 'real') column.numeric = true;
      if (base === 'year') { column.integer = 'integer'; warn('YEAR_AS_INTEGER', 'year() 映射为 integer，不施加 MySQL 年份范围限制', node); }
    } else if (base === 'enum') {
      arity(args, 2, 2, node, method); column.name = identifier(args[0], node);
      if (!Array.isArray(args[1]) || !args[1].length || args[1].some(v => typeof v !== 'string') || new Set(args[1]).size !== args[1].length) fail('INVALID_ENUM', 'enum 必须提供非空且不重复的字符串数组', node);
      column.type = 'varchar(255)'; column.enum = args[1]; column.length = 255;
      if (column.enum.some(v => [...v].length > 255)) fail('INVALID_ENUM', 'enum 值不能超过 255 字符', node);
      column.checks.push(`${q(column.name)} IN (${args[1].map(quote).join(', ')})`);
    } else fail('UNSUPPORTED_COLUMN', `不支持字段类型 ${method}()`, node);
    if (ctx.columns.some(c => c.name === column.name) || knownTables.get(ctx.key)?.has(column.name)) fail('DUPLICATE_COLUMN', `重复字段 ${column.name}`, node);
    if (ctx.dropped.includes(column.name) || ctx.renamed.some(pair => pair.includes(column.name))) fail('CONFLICTING_OPERATION', `同一回调不能混合添加和删除/重命名字段 ${column.name}`, node);
    ctx.columns.push(column);
    return column;
  };

  const modifiers = (ctx, column, calls) => {
    const seen = new Set();
    for (const call of calls) {
      const { method, args, node } = call;
      if (seen.has(method)) fail('DUPLICATE_MODIFIER', `重复修饰符 ${call.display}()`, node);
      seen.add(method);
      if (['nullable', 'unsigned', 'autoincrement', 'usecurrent'].includes(method)) {
        arity(args, 0, 1, node, method);
        const enabled = args.length ? bool(args[0], node, method) : true;
        if (method === 'nullable') column.nullable = enabled;
        if (method === 'unsigned') {
          if (!column.integer && !column.numeric) fail('INVALID_MODIFIER', 'unsigned() 仅支持数值字段', node);
          column.unsigned = enabled;
        }
        if (method === 'autoincrement') {
          if (!column.integer) fail('INVALID_MODIFIER', 'autoIncrement() 仅支持整数字段', node);
          column.auto = enabled;
        }
        if (method === 'usecurrent') {
          if (!column.temporal) fail('INVALID_MODIFIER', 'useCurrent() 仅支持时间字段', node);
          column.current = enabled;
        }
      } else if (method === 'startingvalue') {
        arity(args, 1, 1, node, method);
        const literalNode = node.arguments[0], raw = isNumeric(args[0]) ? args[0].numeric : args[0];
        if (!['string', 'number'].includes(literalNode.kind) || typeof raw !== 'string' || !/^\+?\d+$/.test(raw) || BigInt(raw) < 1n) fail('INVALID_STARTING_VALUE', 'startingValue() 只接受正十进制整数字面量或字符串', node);
        column.explicitStart = BigInt(raw);
      } else if (method === 'sequencetype') {
        arity(args, 1, 1, node, method);
        if (node.arguments[0].kind !== 'string' || !['int8', 'int4', 'int2'].includes(args[0])) fail('INVALID_SEQUENCE_TYPE', 'sequenceType() 只接受 int8、int4 或 int2 字符串字面量', node);
        column.explicitSequenceType = args[0];
      } else if (method === 'default') { arity(args, 1, 1, node, method); column.default = args[0]; }
      else if (method === 'comment') { arity(args, 1, 1, node, method); column.comment = string(args[0], node, '注释'); }
      else if (['index', 'unique', 'primary'].includes(method)) {
        arity(args, 0, 1, node, method);
        if (args[0] === false) continue;
        const name = args[0] === undefined || args[0] === true || args[0] === null ? undefined : identifier(args[0], node);
        column.indexes.push({ kind: method, name, node });
      } else fail('UNSUPPORTED_MODIFIER', `不支持修饰符 ${call.display}()；不会忽略未知行为`, node);
    }
  };

  const foreign = (ctx, columns, custom, calls, node, initial = {}) => {
    const details = { ...initial };
    const seen = new Set();
    for (const call of calls) {
      const { method, args } = call;
      if (method === 'references') { arity(args, 1, 1, call.node, method); if (details.references) fail('DUPLICATE_MODIFIER', '重复 references()', call.node); details.references = list(args[0], call.node); }
      else if (method === 'on') { arity(args, 1, 1, call.node, method); if (details.on) fail('DUPLICATE_MODIFIER', '重复 on()', call.node); details.on = tableName(args[0], call.node); }
      else if (method === 'ondelete' || method === 'onupdate') {
        arity(args, 1, 1, call.node, method);
        if (seen.has(method)) fail('DUPLICATE_MODIFIER', `重复 ${method}()`, call.node);
        seen.add(method);
        const action = string(args[0], call.node).toUpperCase().replace(/\s+/g, ' ').trim();
        if (!['CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'NO ACTION'].includes(action)) fail('INVALID_FOREIGN_ACTION', `不支持外键动作 ${action}`, call.node);
        details[method] = action;
      } else {
        const match = /^(cascade|restrict|null|noaction)on(delete|update)$/.exec(method);
        if (!match) fail('UNSUPPORTED_MODIFIER', `不支持外键修饰符 ${call.display}()`, call.node);
        arity(args, 0, 0, call.node, method);
        const key = `on${match[2]}`;
        if (seen.has(key)) fail('DUPLICATE_MODIFIER', `重复外键 ${key}`, call.node);
        seen.add(key); details[key] = { cascade: 'CASCADE', restrict: 'RESTRICT', null: 'SET NULL', noaction: 'NO ACTION' }[match[1]];
      }
    }
    if (!details.on || !details.references) fail('INCOMPLETE_FOREIGN', 'foreign() 必须包含 references() 和 on()', node);
    if (list(columns, node).length !== details.references.length) fail('INVALID_FOREIGN', '外键字段数与引用字段数必须一致', node);
    constraint(ctx, 'foreign', columns, custom, node, details);
  };

  const macro = (ctx, first, rest) => {
    const { method, args, node } = first;
    const add = (type, name, extra = []) => addColumn(ctx, type, [name, ...extra], node);
    if (['timestamps', 'timestampstz', 'nullabletimestamps', 'datetimes'].includes(method)) {
      arity(args, 0, 1, node, method); forbidChain(rest, node);
      for (const name of ['created_at', 'updated_at']) add(method === 'timestampstz' ? 'timestamptz' : 'timestamp', name, args).nullable = true;
    } else if (['softdeletes', 'softdeletestz'].includes(method)) {
      arity(args, 0, 2, node, method); const col = add(method === 'softdeletestz' ? 'timestamptz' : 'timestamp', args[0] ?? 'deleted_at', args.length > 1 ? [args[1]] : []); col.nullable = true; modifiers(ctx, col, rest);
    } else if (method === 'remembertoken') {
      arity(args, 0, 0, node, method); const col = add('string', 'remember_token', [numeric('100')]); col.nullable = true; modifiers(ctx, col, rest);
    } else if (method === 'authorby') {
      arity(args, 0, 2, node, method); forbidChain(rest, node);
      for (const [i, name] of [args[0] ?? 'created_by', args[1] ?? 'updated_by'].entries()) {
        const col = add('biginteger', name); col.default = numeric('0'); col.comment = i === 0 ? '创建者' : '更新者';
      }
    } else if (['morphs', 'nullablemorphs', 'uuidmorphs', 'nullableuuidmorphs'].includes(method)) {
      arity(args, 1, 2, node, method); forbidChain(rest, node); const name = identifier(args[0], node), nullable = method.startsWith('nullable');
      add('string', `${name}_type`).nullable = nullable;
      add(method.includes('uuid') ? 'uuid' : 'unsignedbiginteger', `${name}_id`).nullable = nullable;
      constraint(ctx, 'index', [`${name}_type`, `${name}_id`], args[1], node);
    } else return false;
    return true;
  };

  const blueprintStatement = (ctx, statement, variable) => {
    if (statement.kind !== 'expressionstatement') fail('UNSUPPORTED_STATEMENT', `不支持 Blueprint 内的 ${statement.kind}；仅接受静态方法调用`, statement);
    const calls = chain(statement.expression, variable), first = calls.shift(), { method, args, node } = first;
    if (macro(ctx, first, calls)) return;
    if (method === 'comment') { arity(args, 1, 1, node, method); forbidChain(calls, node); if (ctx.comment !== undefined) fail('DUPLICATE_MODIFIER', '重复表注释', node); ctx.comment = string(args[0], node); }
    else if (method === 'indexcomment') {
      arity(args, 2, 2, node, method); forbidChain(calls, node);
      const name = identifier(args[0], node), comment = string(args[1], node, '索引注释');
      if (ctx.indexComments.some(item => item.name === name)) fail('DUPLICATE_MODIFIER', `重复索引注释 ${name}`, node);
      ctx.indexComments.push({ name, comment, node });
    }
    else if (method === 'index' || method === 'uniqueindex') {
      arity(args, method === 'uniqueindex' ? 2 : 1, method === 'uniqueindex' ? 3 : 2, node, method); forbidChain(calls, node);
      const definition = indexDefinition(args[0], node);
      let predicate;
      if (args.length > 2) {
        predicate = args[2];
        if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate) || isNumeric(predicate) || !Object.keys(predicate).length) fail('INVALID_INDEX_PREDICATE', '部分唯一索引条件必须是非空字段=>标量/null 映射', node);
        for (const [name, v] of entries(predicate)) {
          identifier(name, node);
          if (v !== null && !['string', 'boolean'].includes(typeof v) && !isNumeric(v)) fail('INVALID_INDEX_PREDICATE', '索引条件只支持 AND 等值或 IS NULL，不支持嵌套表达式', node);
        }
      }
      constraint(ctx, method, definition.columns, args[1], node, { directions: definition.directions, predicate });
    } else if (['unique', 'primary'].includes(method)) {
      arity(args, 1, 2, node, method); forbidChain(calls, node); constraint(ctx, method, args[0], args[1], node);
    } else if (method === 'foreign') { arity(args, 1, 2, node, method); foreign(ctx, args[0], args[1], calls, node); }
    else if (['dropcolumn', 'renamecolumn', 'dropindex', 'dropunique', 'dropprimary', 'dropforeign'].includes(method)) {
      if (ctx.create) fail('INVALID_OPERATION', `${method}() 只支持 Schema::table`, node);
      forbidChain(calls, node);
      if (method === 'dropcolumn') {
        arity(args, 1, 100, node, method);
        const columns = list(args.length > 1 ? args : args[0], node);
        ctx.commands.push({ kind: 'dropcolumns', columns, node });
        for (const c of columns) {
          if (ctx.columns.some(col => col.name === c) || ctx.renamed.some(pair => pair.includes(c)) || ctx.dropped.includes(c)) fail('CONFLICTING_OPERATION', `同一回调中的字段操作冲突：${c}`, node);
          ctx.dropped.push(c);
          for (const [object, owner] of objects) {
            if (owner === ctx.key && objectColumns.get(object)?.includes(c)) {
              if (object === `${ctx.parts[0]}\0${primaryTables.get(ctx.key)}`) primaryTables.delete(ctx.key);
              objects.delete(object); objectColumns.delete(object); objectKinds.delete(object);
            }
          }
          ctx.constraints = ctx.constraints.filter(existing => !existing.columns.includes(c) && !Object.hasOwn(existing.predicate ?? {}, c));
        }
      } else if (method === 'renamecolumn') {
        arity(args, 2, 2, node, method); const from = identifier(args[0], node), to = identifier(args[1], node);
        if (ctx.columns.some(c => c.name === from || c.name === to) || ctx.dropped.includes(from) || ctx.dropped.includes(to) || ctx.renamed.some(pair => pair.includes(from) || pair.includes(to))) fail('CONFLICTING_OPERATION', '同一回调中的字段重命名与其它字段操作冲突', node);
        if (from === to) fail('DUPLICATE_COLUMN', `重命名目标字段 ${to} 已存在`, node);
        ctx.renamed.push([from, to]);
        ctx.commands.push({ kind: 'renamecolumn', from, to, node });
      }
      else {
        arity(args, method === 'dropprimary' ? 0 : 1, 1, node, method);
        const kind = method.slice(4);
        if (Array.isArray(args[0])) list(args[0], node);
        const name = kind === 'primary' && (args[0] === undefined || Array.isArray(args[0]))
          ? primaryTables.get(ctx.key) ?? primaryName(ctx, node)
          : Array.isArray(args[0]) ? indexName(ctx, args[0], kind, undefined, node) : identifier(args[0], node);
        const existingKind = objectKinds.get(`${ctx.parts[0]}\0${name}`);
        if (existingKind && (kind === 'index' ? !['index', 'uniqueindex'].includes(existingKind) : kind === 'unique' && existingKind !== 'unique')) fail('INVALID_OPERATION', `${method}() 与已知对象 ${name} 的种类不匹配`, node);
        ctx.commands.push({ kind: 'dropconstraint', constraintKind: kind, name, node });
        ctx.constraints = ctx.constraints.filter(existing => existing.name !== name);
        if (kind !== 'foreign') { objects.delete(`${ctx.parts[0]}\0${name}`); objectColumns.delete(`${ctx.parts[0]}\0${name}`); objectKinds.delete(`${ctx.parts[0]}\0${name}`); }
        if (kind === 'primary') {
          if (primaryTables.has(ctx.key) && primaryTables.get(ctx.key) !== name) fail('UNKNOWN_CONSTRAINT', `主键约束 ${name} 不存在`, node);
          primaryTables.delete(ctx.key);
        }
      }
      warn('DESTRUCTIVE_OPERATION', `${method}() 会修改或删除现有数据库对象，请审查 SQL`, node);
    } else {
      let col;
      if (method === 'addcolumn') {
        arity(args, 2, 3, node, method);
        const type = string(args[0], node).toLowerCase(), options = args[2] ?? Object.create(null);
        if (!options || typeof options !== 'object' || Array.isArray(options) || isNumeric(options)) fail('INVALID_ARGUMENTS', 'addColumn options 必须是字符串键选项数组', node);
        const allowed = integerKinds[type] ? ['autoIncrement', 'unsigned'] : ['string', 'char'].includes(type) ? ['length'] : ['decimal', 'unsigneddecimal', 'float', 'double'].includes(type) ? ['total', 'places'] : temporalKinds.includes(type) ? ['precision'] : type === 'enum' ? ['allowed'] : [];
        const optionModifiers = ['comment', 'default', 'nullable', 'index', 'unique', 'primary', 'useCurrent'];
        for (const key of Object.keys(options)) if (!allowed.includes(key) && !optionModifiers.includes(key)) fail('UNSUPPORTED_OPTION', `addColumn ${type} 不支持选项 ${key}`, node);
        const extra = integerKinds[type] ? [options.autoIncrement ?? false, options.unsigned ?? false] : ['string', 'char'].includes(type) ? [options.length ?? numeric('255')] : ['decimal', 'unsigneddecimal', 'float', 'double'].includes(type) ? [options.total ?? numeric('8'), options.places ?? numeric('2')] : temporalKinds.includes(type) ? [Object.hasOwn(options, 'precision') ? options.precision : numeric('0')] : type === 'enum' ? [options.allowed] : [];
        col = addColumn(ctx, type, [args[1], ...extra], node);
        modifiers(ctx, col, Object.keys(options).filter(key => optionModifiers.includes(key)).map(key => ({ method: key.toLowerCase(), display: key, args: [options[key]], node })));
      } else col = addColumn(ctx, method, args, node);
      const foreignAt = calls.findIndex(c => c.method === 'constrained');
      if (foreignAt >= 0) {
        if (method !== 'foreignid') fail('INVALID_MODIFIER', 'constrained() 仅支持 foreignId()', calls[foreignAt].node);
        modifiers(ctx, col, calls.slice(0, foreignAt));
        const c = calls[foreignAt]; arity(c.args, 1, 2, c.node, 'constrained');
        foreign(ctx, [col.name], undefined, calls.slice(foreignAt + 1), c.node, { on: tableName(c.args[0], c.node), references: [identifier(c.args[1] ?? 'id', c.node)] });
      } else modifiers(ctx, col, calls);
    }
  };

  const defaultSql = (column, v) => {
    if (v === null) return 'NULL';
    if (column.type === 'boolean') {
      if (v === true || isNumeric(v) && v.numeric === '1' || v === '1') return 'TRUE';
      if (v === false || isNumeric(v) && v.numeric === '0' || v === '0') return 'FALSE';
      fail('INVALID_DEFAULT', 'boolean 布尔默认值只支持 true/false 或 0/1', column.node);
    }
    if (column.integer || column.numeric) {
      const raw = isNumeric(v) ? v.numeric : typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'string' ? v : '';
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || column.integer && !/^[+-]?\d+$/.test(raw)) fail('INVALID_DEFAULT', `字段 ${column.name} 默认值必须是有效数值`, column.node);
      const rawExponent = /[eE]([+-]?\d+)$/.exec(raw)?.[1];
      if (rawExponent && (!Number.isSafeInteger(Number(rawExponent)) || Math.abs(Number(rawExponent)) > 100000)) fail('DEFAULT_OUT_OF_RANGE', `字段 ${column.name} 默认值指数超出可验证范围`, column.node);
      if (column.numeric && !column.precision) {
        const n = Number(raw), zero = !/[1-9]/.test(raw.split(/[eE]/)[0]);
        if (!Number.isFinite(n) || !zero && n === 0 || column.type === 'real' && (!Number.isFinite(Math.fround(n)) || !zero && Math.fround(n) === 0)) fail('DEFAULT_OUT_OF_RANGE', `${column.type} 字段 ${column.name} 默认值上溢或下溢`, column.node);
      }
      if (column.integer) {
        const bounds = integerKinds[column.integer], n = BigInt(raw), min = column.unsigned ? 0n : BigInt(bounds.min), max = BigInt(column.unsigned ? bounds.unsignedMax ?? bounds.max : bounds.max);
        if (n < min || n > max) fail('DEFAULT_OUT_OF_RANGE', `字段 ${column.name} 默认值超出类型范围`, column.node);
      } else {
        const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
        const digits = `${match[2]}${match[3] ?? ''}`, first = digits.search(/[1-9]/);
        if (column.unsigned && match[1] === '-' && first >= 0) fail('DEFAULT_OUT_OF_RANGE', `无符号字段 ${column.name} 默认值不能为负数`, column.node);
        if (column.precision && first >= 0) {
          // 按十进制位数判断，不经 Number 舍入；末尾零不改变有效小数位。
          const exponent = Number(match[4] ?? 0), point = match[2].length + exponent;
          const last = digits.replace(/0+$/, '').length;
          if (!Number.isSafeInteger(exponent) || Math.max(0, point - first) > column.precision - column.scale || Math.max(0, last - point) > column.scale) fail('DEFAULT_OUT_OF_RANGE', `字段 ${column.name} 默认值超出 numeric(${column.precision}, ${column.scale})，会发生溢出或舍入`, column.node);
        }
      }
      return raw;
    }
    const text = typeof v === 'string' ? v : isNumeric(v) ? v.numeric : typeof v === 'boolean' ? (v ? '1' : '0') : null;
    if (text === null) fail('INVALID_DEFAULT', `字段 ${column.name} 默认值不支持数组或对象`, column.node);
    if (column.length && [...text].length > column.length) fail('DEFAULT_OUT_OF_RANGE', `字段 ${column.name} 默认值超过长度限制`, column.node);
    if (column.enum && !column.enum.includes(text)) fail('INVALID_DEFAULT', `字段 ${column.name} 默认值不在枚举中`, column.node);
    return quote(text);
  };

  const seedValueSql = (column, v, node) => {
    if (typeof v === 'string' && !v.isWellFormed()) fail('SEED_INVALID_VALUE', `种子数据字段 ${column.name} 含孤立 Unicode 代理项`, node);
    if (v === null && !column.nullable) fail('SEED_NULL_NOT_ALLOWED', `种子数据字段 ${column.name} 不允许 NULL`, node);
    let literal;
    try { literal = defaultSql({ ...column, node }, v); }
    catch (error) {
      if (!(error instanceof ConversionError)) throw error;
      fail(error.code === 'DEFAULT_OUT_OF_RANGE' ? 'SEED_OUT_OF_RANGE' : 'SEED_INVALID_VALUE', `种子数据字段 ${column.name} 校验失败：${error.message.replace(/默认值/g, '种子值')}`, node);
    }
    if (v === null) return literal;
    const invalid = reason => fail('SEED_INVALID_VALUE', `种子数据字段 ${column.name}：${reason}`, node);
    const typedText = column.temporal || ['date', 'json', 'jsonb', 'uuid', 'inet', 'macaddr', 'bytea'].includes(column.type);
    if (!typedText) return literal;
    if (typeof v !== 'string') invalid(`${column.type} 需要静态字符串字面量`);
    if (column.temporal || column.type === 'date') {
      const timestamp = column.type.startsWith('timestamp'), time = column.type.startsWith('time') && !timestamp;
      const datePart = '(\\d{4})-(\\d{2})-(\\d{2})', timePart = '(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}:\\d{2})?';
      const match = new RegExp(`^${timestamp ? `${datePart}[ T]${timePart}` : time ? timePart : datePart}$`).exec(v);
      if (!match) invalid('需要明确的 ISO 日期或日期时间（YYYY-MM-DD HH:mm:ss）');
      let offset = 0;
      if (!time) {
        const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
        const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) invalid('日期不存在或超出支持范围 0001–9999');
        offset = 3;
      }
      if (timestamp || time) {
        const hour = Number(match[offset + 1]), minute = Number(match[offset + 2]), second = Number(match[offset + 3]);
        const fraction = match[offset + 4] ?? '', zone = match[offset + 5];
        if (hour > 23 || minute > 59 || second > 59) invalid('时间范围不合法');
        const precision = Number(/\((\d)\)/.exec(column.type)?.[1] ?? 6);
        if (/[1-9]/.test(fraction.slice(precision))) invalid(`时间小数超过 ${precision} 位，会发生舍入`);
        const withZone = column.type.includes('with time zone');
        if (withZone && !zone) invalid('带时区类型必须显式给出 Z 或 ±HH:mm，避免依赖导入环境时区');
        if (!withZone && zone) invalid('无时区类型不能包含会被忽略的时区偏移');
        if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 15 || Number(zone.slice(4)) > 59)) invalid('时区偏移超出范围');
      }
    } else if (column.type === 'json' || column.type === 'jsonb') {
      try { JSON.parse(v); } catch { invalid('JSON 字符串不是有效 JSON'); }
      // 逐个原始 token 校验，不能让重复 JSON 键覆盖的值逃过检查，也不改写大数。
      for (const token of v.matchAll(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
        if (token[0].startsWith('"')) {
          const decoded = JSON.parse(token[0]);
          if (decoded.includes('\0') || !decoded.isWellFormed()) invalid('JSON 不能包含 NUL 或孤立 Unicode 代理项');
        } else {
          const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token[0]);
          const exponent = Number(match[3] ?? 0), digits = `${match[1]}${match[2] ?? ''}`, first = digits.search(/[1-9]/), point = match[1].length + exponent;
          if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 131072 || first >= 0 && (Math.max(0, point - first) > 131072 || Math.max(0, digits.replace(/0+$/, '').length - point) > 16383)) invalid('JSON 数值超出 PostgreSQL numeric 支持范围');
        }
      }
    } else if (column.type === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) invalid('需要标准 UUID 格式');
    else if (column.type === 'inet') {
      const parts = v.split('/'), family = isIP(parts[0]);
      if (!family || v.includes('%') || parts.length > 2 || parts[1] !== undefined && (!/^\d{1,3}$/.test(parts[1]) || Number(parts[1]) > (family === 4 ? 32 : 128))) invalid('需要有效 IPv4/IPv6 地址及可选 CIDR 前缀，不支持 zone-id');
    } else if (column.type === 'macaddr' && !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v)) invalid('需要 6 组十六进制字节的 MAC 地址');
    else if (column.type === 'bytea' && !/^\\x(?:[0-9a-fA-F]{2})*$/.test(v)) invalid('bytea 仅接受小写 \\x 开头的偶数位十六进制字符串');
    return literal;
  };

  // 将可静态比较的值规范化，供唯一约束和部分索引条件使用。
  const canonicalSeedSql = (column, input) => {
    let text = input;
    if (column.integer && text !== 'NULL') text = String(BigInt(text));
    else if (column.numeric && text !== 'NULL') {
      if (!column.precision) text = String(column.type === 'real' ? Math.fround(Number(text)) : Number(text));
      else {
        const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
        const digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+/, ''), significant = digits.replace(/0+$/, '');
        text = significant ? `${match[1] === '-' ? '-' : ''}${significant}e${Number(match[4] ?? 0) - (match[3]?.length ?? 0) + digits.length - significant.length}` : '0';
      }
    }
    if (column.type.startsWith('char(') && text !== 'NULL') text = text.replace(/ +(?='$)/, '');
    if (['uuid', 'bytea'].includes(column.type) && text !== 'NULL') text = text.toLowerCase();
    return text;
  };
  // 只标记能够离线规范化比较的字段类型。
  const valueFamily = column => column?.integer ? 'integer' : column?.numeric ? (column.precision ? 'numeric' : column.type) : column && /^(?:varchar\(|char\(|text$)/.test(column.type) ? 'text' : ['boolean', 'uuid', 'bytea'].includes(column?.type) ? column.type : null;

  // 按当前命令位置的列状态编译条件，避免重命名或删除后静默丢失 WHERE。
  const compilePredicate = (command, columns) => {
    if (!command.predicate) return;
    command.predicateVerified = true;
    command.predicateTerms = entries(command.predicate).map(([name, v]) => {
      const column = columns.get(name);
      if (!column) fail('UNKNOWN_COLUMN', `部分索引条件引用未知字段 ${name}`, command.node);
      const literal = v === null ? 'NULL' : seedValueSql(column, v, command.node);
      if (v !== null && !valueFamily(column)) command.predicateVerified = false;
      return { column: name, sql: v === null ? `${q(name)} IS NULL` : `${q(name)} = ${literal}`, canonical: canonicalSeedSql(column, literal) };
    });
    if (!command.predicateVerified) warn('PARTIAL_INDEX_SEED_UNVERIFIED', `部分唯一索引 ${command.name} 的条件含无法可靠静态比较的类型；已生成 SQL，但未模拟该索引对种子数据的唯一约束`, command.node);
  };

  // 每表独立规划序列与数据，不改变显式 startingValue，也不重排原始行。
  const planSeed = ctx => {
    const outer = keyedData ? seedGroups.get(ctx.key)?.outer : dataOuter;
    if (!outer) return { rowCount: 0, statements: [] };
    const columns = new Map(ctx.columns.map(column => [column.name, column]));
    for (const column of ctx.columns) if (column.default !== undefined && column.default !== null) seedValueSql(column, column.default, column.node);
    const rows = outer.items.map(entry => {
      if (!entry || entry.kind !== 'entry' || entry.key || entry.byRef || entry.unpack || entry.value?.kind !== 'array') fail('INVALID_SEED_ROWS', 'data() 必须返回无键行数组，每行都是字段名到字面量的数组', entry ?? outer);
      const cells = new Map();
      for (const cell of entry.value.items) {
        if (!cell || cell.kind !== 'entry' || cell.byRef || cell.unpack || cell.key?.kind !== 'string') fail('INVALID_SEED_ROW', '种子行字段必须使用字符串字面量键，不支持解包和引用', cell ?? entry);
        const name = cell.key.value;
        if (cells.has(name)) fail('SEED_DUPLICATE_COLUMN', `种子行重复字段 ${name}`, cell);
        const column = columns.get(name);
        if (!column) fail('SEED_UNKNOWN_COLUMN', `种子行包含未知字段 ${name}`, cell);
        const literalNode = cell.value;
        if (!['string', 'number', 'boolean', 'nullkeyword'].includes(literalNode?.kind) && !(literalNode?.kind === 'unary' && ['-', '+'].includes(literalNode.type) && literalNode.what?.kind === 'number')) fail('UNSUPPORTED_SEED_VALUE', '种子值仅支持静态字符串、数字、布尔或 null，不支持函数、表达式或嵌套数组', literalNode ?? cell);
        const v = value(literalNode);
        cells.set(name, { sql: seedValueSql(column, v, literalNode), value: v, node: literalNode });
      }
      for (const column of ctx.columns) {
        if (!cells.has(column.name) && !column.nullable && !column.auto && !column.current && (column.default === undefined || column.default === null)) fail('SEED_REQUIRED_COLUMN', `种子行缺少非空且没有可用默认值的字段 ${column.name}`, entry);
      }
      return { cells, node: entry };
    });
    const autoStates = new Map();
    for (const column of ctx.columns.filter(col => col.auto)) {
      const explicit = rows.filter(row => row.cells.has(column.name)).map(row => BigInt(row.cells.get(column.name).sql));
      const maximum = explicit.reduce((a, b) => a > b ? a : b, 0n);
      const omitted = BigInt(rows.length - explicit.length), limit = column.sequenceLimit;
      const start = column.explicitStart ?? maximum + 1n;
      if (column.explicitStart !== undefined && explicit.some(id => id >= start && id <= limit)) fail('SEED_SEQUENCE_COLLISION', `startingValue(${start}) 将在未来取号时与显式种子 ID 碰撞；请修正源起点，工具不会自动改写`, column.node);
      if (start + omitted > limit) fail('SEED_SEQUENCE_EXHAUSTED', `种子数据将耗尽 ${column.name} 的序列范围，必须为后续默认 ID 留出空间`, dataMethod);
      autoStates.set(column.name, start);
      column.sequenceStart = start;
    }
    if (!rows.length) return { rowCount: 0, statements: [] };
    const uniqueConstraints = ctx.constraints.filter(c => ['primary', 'unique', 'uniqueindex'].includes(c.kind));
    const seenKeys = new Map(uniqueConstraints.map(c => [c.name, new Set()]));
    for (const row of rows) {
      const effective = new Map();
      for (const column of ctx.columns) {
        const cell = row.cells.get(column.name);
        let text = cell?.sql;
        if (!cell && column.auto) { text = String(autoStates.get(column.name)); autoStates.set(column.name, autoStates.get(column.name) + 1n); }
        else if (!cell && column.current) text = 'CURRENT_TIMESTAMP';
        else if (!cell && column.default !== undefined) text = seedValueSql(column, column.default, row.node);
        else if (!cell) text = 'NULL';
        effective.set(column.name, canonicalSeedSql(column, text));
      }
      for (const constraint of uniqueConstraints) {
        if (constraint.predicateTerms && (!constraint.predicateVerified || !constraint.predicateTerms.every(term => effective.get(term.column) === term.canonical))) continue;
        const keyValues = constraint.columns.map(name => effective.get(name));
        if (keyValues.includes('NULL')) continue;
        const key = JSON.stringify(keyValues), seen = seenKeys.get(constraint.name);
        if (seen.has(key)) fail('SEED_DUPLICATE_KEY', `种子行违反主键或唯一约束 ${constraint.name}`, row.node);
        seen.add(key);
      }
      row.effective = effective;
    }
    if (ctx.constraints.some(c => c.kind === 'foreign' && c.on.join('\0') !== ctx.key)) warn('SEED_FOREIGN_KEY_UNVERIFIED', '种子数据包含外部表外键；生成前未连接数据库验证引用记录', dataMethod);
    const selfForeign = ctx.constraints.filter(c => c.kind === 'foreign' && c.on.join('\0') === ctx.key);
    const referencesSeen = new Map();
    for (const fk of selfForeign) {
      if (fk.references.some(name => !columns.has(name)) || !uniqueConstraints.some(c => !c.predicateTerms && c.columns.length === fk.references.length && fk.references.every(name => c.columns.includes(name)))) fail('SEED_SELF_FOREIGN_INVALID', `同表外键 ${fk.name} 必须引用已定义的非部分主键或唯一字段`, fk.node);
      if (fk.columns.some((name, index) => !valueFamily(columns.get(name)) || valueFamily(columns.get(name)) !== valueFamily(columns.get(fk.references[index])))) fail('SEED_SELF_FOREIGN_UNSUPPORTED', `同表外键 ${fk.name} 的字段类型无法可靠进行静态比较；支持相同类别的整数、numeric、浮点、布尔、文本、UUID 或 bytea`, fk.node);
      referencesSeen.set(fk.name, new Set());
    }
    for (const row of rows) {
      for (const fk of selfForeign) {
        const referencedValues = fk.references.map(name => row.effective.get(name));
        if (!referencedValues.includes('NULL')) referencesSeen.get(fk.name).add(JSON.stringify(referencedValues));
      }
      for (const fk of selfForeign) {
        const localValues = fk.columns.map(name => row.effective.get(name));
        if (localValues.includes('NULL')) continue;
        if (!referencesSeen.get(fk.name).has(JSON.stringify(localValues))) fail('SEED_FOREIGN_KEY_ORDER', `逐行 INSERT 时外键 ${fk.name} 引用了尚不存在的种子记录（前向或缺失引用）；请把被引用行提前，工具不会重排 data()`, row.node);
      }
    }
    const inserts = rows.map(row => {
      const names = [...row.cells.keys()];
      return names.length ? `INSERT INTO ${qualified(ctx.parts)} (${names.map(q).join(', ')}) VALUES (${names.map(name => row.cells.get(name).sql).join(', ')});` : `INSERT INTO ${qualified(ctx.parts)} DEFAULT VALUES;`;
    });
    return { rowCount: rows.length, statements: inserts };
  };

  const emit = ctx => {
    // 完成字段和约束 IR 后再规划种子数据，序列起点在任何 DDL 文本生成前确定。
    for (const col of ctx.columns) {
      if (col.auto && col.nullable) fail('INVALID_MODIFIER', '自增主键不能 nullable()', col.node);
      if (col.current && col.default !== undefined) fail('CONFLICTING_DEFAULT', 'default() 和 useCurrent() 不能同时启用', col.node);
      if (col.auto && (col.default !== undefined || col.current)) fail('CONFLICTING_DEFAULT', '自增字段不能同时指定默认值', col.node);
      if (col.explicitStart !== undefined && !col.auto) fail('INVALID_STARTING_VALUE', 'startingValue() 仅用于自增序列字段', col.node);
      if (col.explicitSequenceType !== undefined && !col.auto) fail('INVALID_SEQUENCE_TYPE', 'sequenceType() 仅用于自增序列字段', col.node);
      if (col.auto && !col.unsigned) col.integer = col.integer === 'mediuminteger' ? 'integer' : col.integer === 'tinyinteger' ? 'smallinteger' : col.integer;
      if (col.integer) {
        const bounds = integerKinds[col.integer];
        col.type = bounds.type;
        if (col.unsigned) {
          col.type = bounds.unsignedType ?? bounds.type;
          col.checks.push(`${q(col.name)} >= 0${bounds.unsignedMax ? ` AND ${q(col.name)} <= ${bounds.unsignedMax}` : ''}`);
          if (!bounds.unsignedMax) warn('UNSIGNED_BIGINT_RANGE', `${ctx.parts.join('.')}.${col.name} 使用非负 int8；最大值 9223372036854775807，小于 unsigned bigint 的 18446744073709551615`, col.node);
          else warn('UNSIGNED_MAPPING', `${ctx.parts.join('.')}.${col.name} 使用 ${col.type} 加 CHECK 保持无符号范围 0–${bounds.unsignedMax}`, col.node);
        } else if (bounds.checkSigned) col.checks.push(`${q(col.name)} BETWEEN ${bounds.min} AND ${bounds.max}`);
      } else if (col.numeric && col.unsigned) col.checks.push(`${q(col.name)} >= 0`);
      if (col.default !== undefined) col.defaultLiteral = defaultSql(col, col.default);
      for (const index of col.indexes.filter(index => index.kind === 'primary')) constraint(ctx, index.kind, [col.name], index.name, index.node);
      if (col.auto) {
        const sequence = `${ctx.parts[1]}${col.name === 'id' ? '' : `_${col.name}`}_seq`;
        register(ctx.parts[0], sequence, col.node, ctx.key, [col.name], 'sequence');
        col.sequence = [ctx.parts[0], sequence]; col.sequenceStart = col.explicitStart ?? 1n;
        col.sequenceType = col.explicitSequenceType ?? col.type;
        const bounds = integerKinds[col.integer], columnLimit = BigInt(col.unsigned ? bounds.unsignedMax ?? bounds.max : bounds.max);
        const sequenceLimit = BigInt({ int8: integerKinds.biginteger.max, int4: integerKinds.integer.max, int2: integerKinds.smallinteger.max }[col.sequenceType]);
        const limit = columnLimit < sequenceLimit ? columnLimit : sequenceLimit; col.sequenceLimit = limit;
        if (col.sequenceStart > limit) fail('INVALID_STARTING_VALUE', `startingValue() 超出 ${col.type} 或无符号字段范围`, col.node);
        const primary = ctx.constraints.find(c => c.kind === 'primary');
        if (primary) {
          if (!primary.named || primary.columns.length !== 1 || primary.columns[0] !== col.name) fail('DUPLICATE_PRIMARY', `自增字段 ${col.name} 只允许由同一单列的显式命名主键覆盖默认主键`, primary.node);
        } else constraint(ctx, 'primary', [col.name], undefined, col.node);
      }
      for (const index of col.indexes.filter(index => index.kind !== 'primary')) constraint(ctx, index.kind, [col.name], index.name, index.node);
    }
    if (ctx.create) {
      const primary = ctx.constraints.find(c => c.kind === 'primary' && !c.named);
      if (primary && ctx.constraints.some(c => c.kind === 'unique' && c.columns.length === primary.columns.length && c.columns.every((name, index) => name === primary.columns[index]))) fail('AMBIGUOUS_PRIMARY_NAME', '默认主键字段不能在同一 CREATE 中重复声明同序 UNIQUE；请移除冗余 UNIQUE 或为主键指定明确名称，以保持约束名称可预测', primary.node);
    }
    const predicateColumns = new Map([...(knownTables.get(ctx.key) ?? []), ...ctx.columns.map(col => [col.name, col])]);
    if (ctx.create) for (const command of ctx.commands) compilePredicate(command, predicateColumns);
    ctx.seedPlan = ctx.create ? planSeed(ctx) : { rowCount: 0, statements: [] };
    const definitions = [], before = [], after = [];
    for (const col of ctx.columns) {
      let def = `${q(col.name)} ${col.type}${col.nullable ? '' : ' NOT NULL'}`;
      if (col.auto) {
        const seqParts = col.sequence;
        before.push(`CREATE SEQUENCE ${qualified(seqParts)} AS ${col.sequenceType} START WITH ${col.sequenceStart};`);
        def += ` DEFAULT nextval(${quote(qualified(seqParts))}::regclass)`;
        after.push(`ALTER SEQUENCE ${qualified(seqParts)} OWNED BY ${qualified([...ctx.parts, col.name])};`);
      } else if (col.current) def += ' DEFAULT CURRENT_TIMESTAMP';
      else if (col.default !== undefined) def += ` DEFAULT ${col.defaultLiteral}`;
      for (const check of col.checks) def += ` CHECK (${check})`;
      definitions.push(def);
      if (col.comment !== undefined) after.push(`COMMENT ON COLUMN ${qualified([...ctx.parts, col.name])} IS ${quote(col.comment)};`);
    }
    const known = new Map([...(knownTables.get(ctx.key) ?? []), ...ctx.columns.map(c => [c.name, c])]);
    const commandSql = [], lateForeignSql = [];
    for (const c of ctx.commands) {
      if (c.kind === 'dropcolumns') {
        for (const name of c.columns) {
          if (completeTables.has(ctx.key) && !known.has(name)) fail('UNKNOWN_COLUMN', `删除了不存在的字段 ${name}`, c.node);
          commandSql.push(`ALTER TABLE ${qualified(ctx.parts)} DROP COLUMN ${q(name)};`);
          known.delete(name);
        }
        continue;
      }
      if (c.kind === 'renamecolumn') {
        if (completeTables.has(ctx.key) && !known.has(c.from)) fail('UNKNOWN_COLUMN', `重命名了不存在的字段 ${c.from}`, c.node);
        if (known.has(c.to)) fail('DUPLICATE_COLUMN', `重命名目标字段 ${c.to} 已存在`, c.node);
        commandSql.push(`ALTER TABLE ${qualified(ctx.parts)} RENAME COLUMN ${q(c.from)} TO ${q(c.to)};`);
        if (known.has(c.from)) { known.set(c.to, { ...known.get(c.from), name: c.to }); known.delete(c.from); }
        for (const [object, owner] of objects) if (owner === ctx.key) objectColumns.set(object, objectColumns.get(object).map(name => name === c.from ? c.to : name));
        continue;
      }
      if (c.kind === 'dropconstraint') {
        commandSql.push(c.constraintKind === 'index' ? `DROP INDEX ${qualified([ctx.parts[0], c.name])};` : `ALTER TABLE ${qualified(ctx.parts)} DROP CONSTRAINT ${q(c.name)};`);
        continue;
      }
      if (!ctx.create) compilePredicate(c, known);
      if (ctx.create || completeTables.has(ctx.key)) for (const name of c.columns) if (!known.has(name)) fail('UNKNOWN_COLUMN', `索引或约束引用了不存在的字段 ${name}`, c.node);
      if (c.kind === 'primary') for (const name of c.columns) if (known.get(name)?.nullable) fail('INVALID_PRIMARY', `主键字段 ${name} 不能 nullable()`, c.node);
      if (c.kind === 'foreign' && (c.ondelete === 'SET NULL' || c.onupdate === 'SET NULL')) for (const name of c.columns) if (known.has(name) && !known.get(name).nullable) fail('INVALID_FOREIGN', `SET NULL 外键字段 ${name} 必须 nullable()`, c.node);
      if (c.kind === 'index' || c.kind === 'uniqueindex') commandSql.push(`CREATE ${c.kind === 'uniqueindex' ? 'UNIQUE ' : ''}INDEX ${q(c.name)} ON ${qualified(ctx.parts)} (${c.columns.map((name, i) => `${q(name)}${c.directions?.[i] ? ` ${c.directions[i]}` : ''}`).join(', ')})${c.predicateTerms ? ` WHERE ${c.predicateTerms.map(term => term.sql).join(' AND ')}` : ''};`);
      else {
        let def = `${c.kind === 'primary' && !c.named ? '' : `CONSTRAINT ${q(c.name)} `}${c.kind === 'primary' ? 'PRIMARY KEY' : c.kind === 'unique' ? 'UNIQUE' : 'FOREIGN KEY'} (${c.columns.map(q).join(', ')})`;
        if (c.kind === 'foreign') def += ` REFERENCES ${qualified(c.on)} (${c.references.map(q).join(', ')})${c.ondelete ? ` ON DELETE ${c.ondelete}` : ''}${c.onupdate ? ` ON UPDATE ${c.onupdate}` : ''}`;
        const deferredSelfForeign = ctx.create && c.kind === 'foreign' && c.on.join('\0') === ctx.key
          && !ctx.constraints.some(target => ['primary', 'unique'].includes(target.kind) && target.columns.length === c.references.length && c.references.every(name => target.columns.includes(name)))
          && ctx.constraints.some(target => target.kind === 'uniqueindex' && !target.predicate && target.columns.length === c.references.length && c.references.every(name => target.columns.includes(name)));
        if (deferredSelfForeign) lateForeignSql.push(`ALTER TABLE ${qualified(ctx.parts)} ADD ${def};`);
        else if (ctx.create) definitions.push(def);
        else commandSql.push(`ALTER TABLE ${qualified(ctx.parts)} ADD ${def};`);
      }
    }
    if (ctx.create && existsDrop) {
      const sequences = ctx.columns.filter(col => col.auto).map(col => qualified(col.sequence));
      sql.push(`-- 危险操作：exists_drop=true，将删除目标表及数据和下列同名序列；不进行级联删除。\nDROP TABLE IF EXISTS ${qualified(ctx.parts)};`);
      sql.push(...sequences.map(sequence => `DROP SEQUENCE IF EXISTS ${sequence};`));
      warn('DESTRUCTIVE_OPERATION', `exists_drop=true：SQL 将删除表 ${qualified(ctx.parts)} 及其全部数据${sequences.length ? `，并删除本次生成名称对应的序列 ${sequences.join(', ')}` : ''}；未连接数据库核实旧对象所有权，请审查后执行`, dropProperty.property);
    }
    sql.push(...before);
    if (ctx.create) sql.push(`CREATE TABLE ${qualified(ctx.parts)} (\n  ${definitions.join(',\n  ')}\n);`);
    else {
      for (const def of definitions) sql.push(`ALTER TABLE ${qualified(ctx.parts)} ADD ${def.startsWith('CONSTRAINT ') ? '' : 'COLUMN '}${def};`);
    }
    if (ctx.comment !== undefined) after.push(`COMMENT ON TABLE ${qualified(ctx.parts)} IS ${quote(ctx.comment)};`);
    for (const item of ctx.indexComments) {
      const objectKey = `${ctx.parts[0]}\0${item.name}`, kind = objectKinds.get(objectKey);
      if ((ctx.create || kind) && (!['index', 'uniqueindex', 'primary', 'unique'].includes(kind) || objects.get(objectKey) !== ctx.key)) fail('INVALID_INDEX_COMMENT', `索引注释目标 ${item.name} 不是当前表已定义的索引`, item.node);
      after.push(`COMMENT ON INDEX ${qualified([ctx.parts[0], item.name])} IS ${quote(item.comment)};`);
    }
    sql.push(...commandSql, ...lateForeignSql, ...after);
    knownTables.set(ctx.key, known);
    if (ctx.create) completeTables.add(ctx.key);
  };

  for (const statement of up.body.children) {
    if (statement.kind !== 'expressionstatement') fail('UNSUPPORTED_STATEMENT', `up() 不支持 ${statement.kind}；仅接受静态 Schema 调用`, statement);
    const call = statement.expression;
    if (call?.kind !== 'call' || call.what?.kind !== 'staticlookup' || !supportedClass(call.what.what, 'Schema') || call.what.offset?.kind !== 'identifier') fail('UNSUPPORTED_SCHEMA', 'up() 只支持已导入 Schema 类的静态方法', statement);
    const method = call.what.offset.name.toLowerCase(), args = call.arguments;
    if (!CAPABILITIES.schemaMethods.some(m => m.toLowerCase() === method)) fail('UNSUPPORTED_SCHEMA', `不支持 Schema::${call.what.offset.name}()`, call);
    if (keyedData && !['create', 'drop', 'dropifexists', 'dropsequence', 'dropsequenceifexists'].includes(method)) fail('UNSUPPORTED_KEYED_SCHEMA', 'keyed data() 初始化仅支持 create、drop 表或序列；不能 ALTER 或重命名种子目标', call);
    arity(args, ['create', 'table', 'rename'].includes(method) ? 2 : 1, ['create', 'table', 'rename'].includes(method) ? 2 : 1, call, `Schema::${method}`);
    const parts = tableName(value(args[0]), args[0]), key = parts.join('\0');
    if (!method.startsWith('dropsequence')) tables.add(parts.join('.'));
    if (method === 'dropsequence' || method === 'dropsequenceifexists') {
      if (objectKinds.has(key) && objectKinds.get(key) !== 'sequence') fail('INVALID_SEQUENCE_TARGET', `已知对象 ${parts.join('.')} 不是序列`, call);
      if (objectKinds.get(key) === 'sequence' && knownTables.has(objects.get(key))) fail('SEQUENCE_IN_USE', `序列 ${parts.join('.')} 仍被存活表字段使用；请按源顺序先删除表或字段`, call);
      sql.push(`DROP SEQUENCE ${method === 'dropsequenceifexists' ? 'IF EXISTS ' : ''}${qualified(parts)};`);
      objects.delete(key); objectColumns.delete(key); objectKinds.delete(key);
      warn('DESTRUCTIVE_OPERATION', `Schema::${call.what.offset.name}() 会删除序列 ${parts.join('.')}`, call);
    } else if (method === 'drop' || method === 'dropifexists') {
      sql.push(`DROP TABLE ${method === 'dropifexists' ? 'IF EXISTS ' : ''}${qualified(parts)};`);
      for (const [object, owner] of objects) if (owner === key) { objects.delete(object); objectColumns.delete(object); objectKinds.delete(object); }
      knownTables.delete(key); completeTables.delete(key); primaryTables.delete(key); finalCreated.delete(key); warn('DESTRUCTIVE_OPERATION', `Schema::${call.what.offset.name}() 会删除表 ${parts.join('.')}`, call);
    } else if (method === 'rename') {
      const target = tableName(value(args[1]), args[1]);
      if (target[0] !== parts[0]) fail('UNSUPPORTED_RENAME', 'rename() 不支持跨 schema 迁移', call);
      if (knownTables.has(target.join('\0'))) fail('DUPLICATE_OBJECT', `目标表 ${target.join('.')} 已存在`, call);
      sql.push(`ALTER TABLE ${qualified(parts)} RENAME TO ${q(target[1])};`);
      if (knownTables.has(key)) { knownTables.set(target.join('\0'), knownTables.get(key)); knownTables.delete(key); }
      if (completeTables.has(key)) { completeTables.add(target.join('\0')); completeTables.delete(key); }
      if (primaryTables.has(key)) { primaryTables.set(target.join('\0'), primaryTables.get(key)); primaryTables.delete(key); }
      for (const [object, owner] of objects) if (owner === key) objects.set(object, target.join('\0'));
      objects.delete(`${parts[0]}\0${parts[1]}`); objectColumns.delete(`${parts[0]}\0${parts[1]}`); objectKinds.delete(`${parts[0]}\0${parts[1]}`); register(target[0], target[1], call, target.join('\0')); tables.add(target.join('.'));
      finalCreated.delete(key);
      warn('DESTRUCTIVE_OPERATION', `重命名表 ${parts.join('.')} 为 ${target.join('.')}`, call);
    } else {
      const closure = args[1];
      if (closure.kind !== 'closure' || closure.arguments.length !== 1 || closure.uses?.length || closure.byref || closure.attrGroups?.length || !closure.body) fail('UNSUPPORTED_CALLBACK', 'Schema 回调必须是只有一个 Blueprint 参数、无 use 捕获的闭包', closure);
      const param = closure.arguments[0];
      if (param.byref || param.variadic || param.value || param.type && !supportedClass(param.type, 'Blueprint')) fail('UNSUPPORTED_CALLBACK', '闭包参数只支持已导入 Blueprint 类型，不能默认赋值或引用', param);
      if (method === 'create') register(parts[0], parts[1], call, key);
      const ctx = { parts, key, create: method === 'create', columns: [], constraints: [], commands: [], renamed: [], dropped: [], indexComments: [], preexistingObjects: new Set(objects.keys()) };
      for (const child of closure.body.children) blueprintStatement(ctx, child, param.name.name);
      if (!ctx.create && !completeTables.has(key)) warn('EXISTING_TABLE_UNVERIFIED', `Schema::table(${parts.join('.')}) 依赖既有表，未连接数据库核对字段和约束`, call);
      emit(ctx);
      if (ctx.create) { createdContexts.push(ctx); finalCreated.set(key, ctx); }
    }
  }
  if (!sql.length) fail('EMPTY_MIGRATION', 'up() 没有可转换的操作', up);
  let seedRows = 0;
  if (keyedData) {
    for (const [key, group] of seedGroups) {
      const contexts = createdContexts.filter(ctx => ctx.key === key), ctx = finalCreated.get(key);
      if (!ctx || contexts.length !== 1 || contexts[0] !== ctx) fail('INVALID_SEED_TARGET', `种子目标 ${group.parts.join('.')} 必须对应本文件唯一创建且最终存在、未重命名的表`, group.node);
      sql.push(...ctx.seedPlan.statements); seedRows += ctx.seedPlan.rowCount;
    }
  } else {
    for (const ctx of createdContexts) { sql.push(...ctx.seedPlan.statements); seedRows += ctx.seedPlan.rowCount; }
  }
  const safeName = String(sourceName).replace(/[\r\n\u2028\u2029]/g, ' ');
  return { sql: `-- PostgreSQL ${targetVersion} | Migration SQL Studio ${COMPILER_VERSION}\n-- Source: ${safeName}\nBEGIN;\nSET LOCAL standard_conforming_strings = on;\n\n${sql.join('\n\n')}\n\nCOMMIT;\n`, warnings, tables: [...tables], summary: { seedRows, destructive: warnings.some(w => w.code === 'DESTRUCTIVE_OPERATION'), creates: createdContexts.length } };
}
