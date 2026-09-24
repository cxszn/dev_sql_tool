import { parse as parse16 } from 'libpg-query-pg16';
import { parse as parse18 } from 'pgsql-parser';

export class ReverseError extends Error {
  constructor(code, message, line) {
    super(message); this.name = 'ReverseError'; this.code = code; if (line) this.line = line;
  }
}

const strings = nodes => (nodes ?? []).map(node => node.String?.sval);
const nullValue = () => ({ kind: 'null' });
const meaningful = value => value !== undefined && value !== null && value !== false && (!Array.isArray(value) || value.length > 0);
const integerTypes = new Set(['int2', 'int4', 'int8']);
const numericTypes = new Set([...integerTypes, 'numeric', 'float4', 'float8']);

/** 使用目标主版本 PostgreSQL 解析器构建可比较的结构和数据模型，不执行 SQL。 */
export async function parseSqlModel(source, targetVersion) {
  if (![16, 18].includes(targetVersion)) throw new ReverseError('UNSUPPORTED_VERSION', 'PostgreSQL 版本必须是 16 或 18');
  if (typeof source !== 'string' || !source.trim()) throw new ReverseError('INVALID_SOURCE', 'SQL 源码不能为空');
  let tree;
  try { tree = await (targetVersion === 16 ? parse16 : parse18)(source); }
  catch (error) {
    // 原解析器消息可能包含初始化数据，不将其返回客户端。
    const position = Number(error.cursorPosition ?? error.cursorpos ?? 0);
    throw new ReverseError('SQL_SYNTAX_ERROR', 'SQL 语法解析失败，请检查源 SQL 的语句及目标版本', position > 0 ? source.slice(0, position - 1).split('\n').length : undefined);
  }
  const model = { tables: [], sequences: [], indexes: [], drops: [], dataOrder: [] };
  const sourceBytes = Buffer.from(source), lineStarts = [0];
  for (let offset = 0; offset < sourceBytes.length; offset += 1) if (sourceBytes[offset] === 10) lineStarts.push(offset + 1);
  const lineAt = offset => {
    let low = 0, high = lineStarts.length;
    while (low < high) { const middle = (low + high) >>> 1; if (lineStarts[middle] <= offset) low = middle + 1; else high = middle; }
    return low;
  };
  const tables = new Map(), sequences = new Map(), created = new Set(), dropped = new Set();
  let currentLine = 1;
  const fail = (code, message) => { throw new ReverseError(code, message, currentLine); };
  const keys = (object, allowed, label) => {
    for (const key of Object.keys(object ?? {})) if (key !== 'location' && !allowed.includes(key) && meaningful(object[key])) fail('UNSUPPORTED_SQL_OPTION', `${label} 含不支持的选项 ${key}`);
  };
  const name = relation => {
    keys(relation, ['schemaname', 'relname', 'inh', 'relpersistence', 'location'], '对象名称');
    if (relation.relpersistence && relation.relpersistence !== 'p') fail('UNSUPPORTED_SQL_OPTION', '不支持临时或 UNLOGGED 对象');
    if (typeof relation.relname !== 'string') fail('UNSUPPORTED_SQL_NAME', '缺少对象名称');
    return `${relation.schemaname ?? 'public'}.${relation.relname}`;
  };
  const partsName = parts => {
    if (parts.length < 1 || parts.length > 2 || parts.some(part => typeof part !== 'string')) fail('UNSUPPORTED_SQL_NAME', '仅支持 schema.object 对象名称');
    return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
  };
  const regclass = text => {
    const pattern = /^(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z_0-9$]*)(?:\.(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z_0-9$]*))?$/;
    if (!pattern.test(text)) fail('UNSUPPORTED_SQL_NAME', '序列引用仅支持明确的 schema.sequence');
    const parts = text.match(/"(?:[^"]|"")+"|[^.]+/g).map(part => part.startsWith('"') ? part.slice(1, -1).replaceAll('""', '"') : part.toLowerCase());
    return partsName(parts);
  };
  const type = node => {
    keys(node, ['names', 'typemod', 'typmods', 'location'], '字段类型');
    const parts = strings(node.names);
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'pg_catalog')) fail('UNSUPPORTED_SQL_TYPE', '不支持自定义 schema 类型');
    const typeName = parts.at(-1);
    const supported = ['int2', 'int4', 'int8', 'varchar', 'bpchar', 'text', 'numeric', 'float4', 'float8', 'bool', 'timestamp', 'timestamptz', 'time', 'timetz', 'date', 'bytea', 'json', 'jsonb', 'uuid', 'inet', 'macaddr'];
    if (!supported.includes(typeName)) fail('UNSUPPORTED_SQL_TYPE', `不支持字段类型 ${typeName ?? '(unknown)'}`);
    const modifiers = (node.typmods ?? []).map(node => {
      const value = scalar(node);
      if (value.kind !== 'number' || !/^\d+$/.test(value.value)) fail('UNSUPPORTED_SQL_TYPE', '字段类型参数必须是非负整数');
      return value.value;
    });
    if ((['varchar', 'bpchar'].includes(typeName) && modifiers.length !== 1) || (typeName === 'numeric' && modifiers.length !== 2) || (['timestamp', 'timestamptz', 'time', 'timetz'].includes(typeName) && modifiers.length > 1) || (!['varchar', 'bpchar', 'numeric', 'timestamp', 'timestamptz', 'time', 'timetz'].includes(typeName) && modifiers.length)) fail('UNSUPPORTED_SQL_TYPE', `类型 ${typeName} 的参数不能无损转换`);
    return { name: typeName, modifiers };
  };
  const scalar = node => {
    if (node?.A_Const) {
      const value = node.A_Const;
      keys(value, ['isnull', 'ival', 'fval', 'sval', 'boolval', 'location'], '字面值');
      if (value.isnull) return nullValue();
      if (value.ival !== undefined) return { kind: 'number', value: String(value.ival.ival ?? 0) };
      if (value.fval !== undefined) {
        const text = value.fval.fval;
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) fail('UNSUPPORTED_SQL_VALUE', '数值必须为有限十进制字面量');
        return { kind: 'number', value: text };
      }
      if (value.sval !== undefined) return { kind: 'string', value: value.sval.sval ?? '' };
      if (value.boolval !== undefined) return { kind: 'boolean', value: value.boolval.boolval ?? false };
    }
    if (node?.TypeCast) {
      const cast = node.TypeCast;
      keys(cast, ['arg', 'typeName', 'location'], '字面值类型转换');
      const value = scalar(cast.arg), target = strings(cast.typeName.names).at(-1);
      const typeParts = strings(cast.typeName.names);
      keys(cast.typeName, ['names', 'typemod', 'location'], '序列引用类型');
      if (target === 'regclass' && value.kind === 'string' && (typeParts.length === 1 || (typeParts.length === 2 && typeParts[0] === 'pg_catalog')) && (cast.typeName.typemod === undefined || cast.typeName.typemod === -1)) return { kind: 'regclass', value: regclass(value.value) };
      fail('UNSUPPORTED_SQL_VALUE', '除明确序列 regclass 引用外，显式类型转换需要单独确认其求值语义');
    }
    if (node?.SQLValueFunction) {
      const fn = node.SQLValueFunction;
      if (fn.op === 'SVFOP_CURRENT_TIMESTAMP' && (fn.typmod === undefined || fn.typmod === -1)) return { kind: 'current_timestamp' };
    }
    if (node?.FuncCall) {
      const fn = node.FuncCall;
      keys(fn, ['funcname', 'args', 'funcformat', 'location'], '函数表达式');
      const parts = strings(fn.funcname), functionName = parts.at(-1);
      if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'pg_catalog')) fail('UNSUPPORTED_SQL_EXPRESSION', '不支持自定义函数');
      if (functionName === 'nextval' && fn.args?.length === 1) {
        const ref = scalar(fn.args[0]);
        if (ref.kind === 'regclass') return { kind: 'nextval', value: ref.value };
        if (ref.kind === 'string') return { kind: 'nextval', value: regclass(ref.value) };
      }
      if (functionName === 'decode' && fn.args?.length === 2) {
        const [hex, encoding] = fn.args.map(scalar);
        if (hex.kind === 'string' && encoding.kind === 'string' && encoding.value.toLowerCase() === 'hex' && /^(?:[\da-f]{2})*$/i.test(hex.value)) return { kind: 'string', value: `\\x${hex.value.toLowerCase()}` };
      }
    }
    fail('UNSUPPORTED_SQL_EXPRESSION', '仅支持静态字面值、nextval、CURRENT_TIMESTAMP 和 bytea 的 decode(hex, hex)');
  };
  const numericOption = node => {
    if (node?.Integer) return String(node.Integer.ival ?? 0);
    if (node?.Float) return node.Float.fval;
    fail('UNSUPPORTED_SQL_OPTION', '序列选项必须是十进制整数');
  };
  const table = key => {
    const result = tables.get(key);
    if (!result) fail('UNRESOLVED_SQL_TABLE', '语句引用了本文件尚未声明的表');
    return result;
  };
  const constraint = (node, owner, column) => {
    // PG18 在默认生效的 NOT NULL / 外键约束中增加该标记。
    if (Object.hasOwn(node, 'is_enforced')) {
      if (!node.is_enforced) fail('UNSUPPORTED_SQL_CONSTRAINT', '不支持 NOT ENFORCED 约束');
      node = { ...node }; delete node.is_enforced;
    }
    const constraintColumns = column ? [column.name] : strings(node.keys);
    if (node.contype === 'CONSTR_NOTNULL' || node.contype === 'CONSTR_NULL') {
      keys(node, ['contype', 'location', 'initially_valid'], '可空约束');
      if (node.initially_valid === false) fail('UNSUPPORTED_SQL_CONSTRAINT', '不支持 NOT VALID 可空约束');
      if (!column) fail('UNSUPPORTED_SQL_CONSTRAINT', '可空约束必须属于字段');
      column.nullable = node.contype === 'CONSTR_NULL'; return;
    }
    if (node.contype === 'CONSTR_DEFAULT') {
      keys(node, ['contype', 'location', 'raw_expr'], '默认值');
      if (!column || column.default !== undefined) fail('UNSUPPORTED_SQL_CONSTRAINT', '字段默认值重复或缺少字段');
      column.default = scalar(node.raw_expr); return;
    }
    if (node.contype === 'CONSTR_PRIMARY' || node.contype === 'CONSTR_UNIQUE') {
      keys(node, ['contype', 'conname', 'location', 'keys'], '主键或唯一约束');
      owner.constraints.push({ kind: node.contype === 'CONSTR_PRIMARY' ? 'primary' : 'unique', name: node.conname ?? null, columns: constraintColumns }); return;
    }
    if (node.contype === 'CONSTR_FOREIGN') {
      keys(node, ['contype', 'conname', 'location', 'pktable', 'fk_attrs', 'pk_attrs', 'fk_matchtype', 'fk_upd_action', 'fk_del_action', 'initially_valid'], '外键约束');
      if (node.fk_matchtype && node.fk_matchtype !== 's') fail('UNSUPPORTED_SQL_CONSTRAINT', '仅支持 MATCH SIMPLE 外键');
      if (node.initially_valid === false) fail('UNSUPPORTED_SQL_CONSTRAINT', '不支持 NOT VALID 外键');
      owner.constraints.push({ kind: 'foreign', name: node.conname ?? null, columns: column ? [column.name] : strings(node.fk_attrs), references: strings(node.pk_attrs), table: name(node.pktable), onDelete: node.fk_del_action ?? 'a', onUpdate: node.fk_upd_action ?? 'a' }); return;
    }
    fail('UNSUPPORTED_SQL_CONSTRAINT', `不支持约束 ${node.contype}`);
  };
  const predicate = node => {
    if (node?.BoolExpr?.boolop === 'AND_EXPR') return node.BoolExpr.args.flatMap(predicate);
    const expr = node?.A_Expr;
    if (!expr || expr.kind !== 'AEXPR_OP' || strings(expr.name).join('.') !== '=' || !expr.lexpr?.ColumnRef || expr.lexpr.ColumnRef.fields.length !== 1) fail('UNSUPPORTED_SQL_INDEX', '部分索引仅支持字段与静态值相等、使用 AND 连接');
    const value = scalar(expr.rexpr);
    if (!['string', 'number', 'boolean'].includes(value.kind)) fail('UNSUPPORTED_SQL_INDEX', '部分索引比较值不受支持');
    return [{ column: strings(expr.lexpr.ColumnRef.fields)[0], value }];
  };
  for (const entry of tree.stmts) {
    const location = entry.stmt_location ?? 0;
    currentLine = lineAt(location);
    const [[kind, node]] = Object.entries(entry.stmt);
    if (kind === 'TransactionStmt') {
      keys(node, ['kind', 'location'], '事务');
      if (!['TRANS_STMT_BEGIN', 'TRANS_STMT_COMMIT'].includes(node.kind)) fail('UNSUPPORTED_SQL_STATEMENT', '仅支持 BEGIN/COMMIT 事务边界');
    } else if (kind === 'VariableSetStmt') {
      keys(node, ['kind', 'name', 'args', 'is_local'], '会话设置');
      if (node.kind !== 'VAR_SET_VALUE' || node.name !== 'standard_conforming_strings' || node.args?.length !== 1 || scalar(node.args[0]).value !== 'on') fail('UNSUPPORTED_SQL_STATEMENT', '仅支持 SET standard_conforming_strings=on');
    } else if (kind === 'DropStmt') {
      keys(node, ['objects', 'removeType', 'behavior', 'missing_ok'], '删除语句');
      if (!['OBJECT_TABLE', 'OBJECT_SEQUENCE'].includes(node.removeType) || node.behavior !== 'DROP_RESTRICT') fail('UNSUPPORTED_SQL_STATEMENT', '仅支持无 CASCADE 的 DROP TABLE / SEQUENCE');
      for (const object of node.objects) {
        const key = partsName(strings(object.List?.items));
        if (created.has(key) || dropped.has(key)) fail('UNSUPPORTED_LIFECYCLE', '不支持创建后再删除或重复删除的对象生命周期');
        dropped.add(key); model.drops.push({ kind: node.removeType === 'OBJECT_TABLE' ? 'table' : 'sequence', name: key, ifExists: node.missing_ok ?? false });
      }
    } else if (kind === 'CreateSeqStmt') {
      keys(node, ['sequence', 'options'], '创建序列');
      const key = name(node.sequence);
      if (created.has(key)) fail('UNSUPPORTED_LIFECYCLE', '不支持重复创建对象');
      created.add(key);
      const sequence = { name: key, type: 'int8', start: '1', ownedBy: null };
      const seen = new Set();
      for (const wrapped of node.options ?? []) {
        const option = wrapped.DefElem;
        keys(option, ['defname', 'arg', 'defaction', 'location'], '序列选项');
        if (seen.has(option.defname)) fail('UNSUPPORTED_SQL_OPTION', '序列选项重复');
        seen.add(option.defname);
        if (option.defname === 'as') {
          const seqType = type(option.arg.TypeName);
          if (!integerTypes.has(seqType.name)) fail('UNSUPPORTED_SQL_TYPE', '序列只支持整数类型');
          sequence.type = seqType.name;
        } else if (option.defname === 'start') sequence.start = numericOption(option.arg);
        else if (['increment', 'cache'].includes(option.defname) && numericOption(option.arg) === '1') continue;
        else if (['minvalue', 'maxvalue'].includes(option.defname) && !option.arg) continue;
        else if (option.defname === 'cycle' && !option.arg?.Boolean?.boolval) continue;
        else fail('UNSUPPORTED_SQL_OPTION', `不支持序列选项 ${option.defname}`);
      }
      if (!/^[1-9]\d*$/.test(sequence.start)) fail('UNSUPPORTED_SQL_SEQUENCE', '仅支持正整数序列起点');
      sequences.set(key, sequence); model.sequences.push(sequence);
    } else if (kind === 'CreateStmt') {
      keys(node, ['relation', 'tableElts', 'oncommit'], '创建表');
      if (node.oncommit && node.oncommit !== 'ONCOMMIT_NOOP') fail('UNSUPPORTED_SQL_OPTION', '不支持 ON COMMIT 表选项');
      const key = name(node.relation);
      if (created.has(key)) fail('UNSUPPORTED_LIFECYCLE', '不支持重复创建对象');
      created.add(key);
      const owner = { name: key, columns: [], constraints: [], comment: null, rows: [] };
      tables.set(key, owner); model.tables.push(owner);
      for (const item of node.tableElts ?? []) {
        if (item.ColumnDef) {
          const def = item.ColumnDef;
          keys(def, ['colname', 'typeName', 'is_local', 'constraints', 'location'], '字段定义');
          if (owner.columns.some(column => column.name === def.colname)) fail('UNSUPPORTED_SQL_COLUMN', '字段名称重复');
          const column = { name: def.colname, type: type(def.typeName), nullable: true, default: undefined, comment: null };
          owner.columns.push(column);
          for (const wrapped of def.constraints ?? []) constraint(wrapped.Constraint, owner, column);
        } else if (item.Constraint) constraint(item.Constraint, owner);
        else fail('UNSUPPORTED_SQL_COLUMN', '不支持该表定义元素');
      }
    } else if (kind === 'AlterSeqStmt') {
      keys(node, ['sequence', 'options'], '修改序列');
      const sequence = sequences.get(name(node.sequence));
      if (!sequence || node.options?.length !== 1 || node.options[0].DefElem?.defname !== 'owned_by') fail('UNSUPPORTED_SQL_SEQUENCE', '仅支持为本文件已创建序列设置 OWNED BY');
      const parts = strings(node.options[0].DefElem.arg?.List?.items);
      if (parts.length < 2 || parts.length > 3 || sequence.ownedBy) fail('UNSUPPORTED_SQL_SEQUENCE', '序列所有权定义不受支持');
      sequence.ownedBy = { table: partsName(parts.slice(0, -1)), column: parts.at(-1) };
    } else if (kind === 'AlterTableStmt') {
      keys(node, ['relation', 'cmds', 'objtype'], '修改表');
      if (node.objtype !== 'OBJECT_TABLE') fail('UNSUPPORTED_SQL_STATEMENT', '仅支持 ALTER TABLE');
      const owner = table(name(node.relation));
      for (const wrapped of node.cmds ?? []) {
        const command = wrapped.AlterTableCmd;
        keys(command, ['subtype', 'name', 'def', 'behavior'], '修改表子句');
        if (command.subtype === 'AT_AddConstraint') {
          if (command.def?.Constraint?.contype !== 'CONSTR_PRIMARY') fail('UNSUPPORTED_SQL_CONSTRAINT', 'ALTER TABLE ADD 仅支持主键；后置外键或唯一约束的生效时点不能提前');
          constraint(command.def.Constraint, owner);
        }
        else if (command.subtype === 'AT_ColumnDefault' && command.def) {
          const column = owner.columns.find(column => column.name === command.name);
          if (!column) fail('UNSUPPORTED_SQL_COLUMN', '默认值引用不存在的字段');
          if (owner.rows.some(row => !row.some(field => field.column === column.name))) fail('UNSUPPORTED_LIFECYCLE', '初始化记录依赖旧默认值，不能将后续默认值修改合并到建表定义');
          column.default = scalar(command.def);
        } else fail('UNSUPPORTED_SQL_STATEMENT', `不支持 ALTER TABLE ${command.subtype}`);
      }
    } else if (kind === 'CommentStmt') {
      keys(node, ['objtype', 'object', 'comment'], '注释');
      const parts = strings(node.object?.List?.items);
      if (node.objtype === 'OBJECT_TABLE') table(partsName(parts)).comment = node.comment ?? null;
      else if (node.objtype === 'OBJECT_COLUMN') {
        const owner = table(partsName(parts.slice(0, -1))), column = owner.columns.find(column => column.name === parts.at(-1));
        if (!column) fail('UNSUPPORTED_SQL_COLUMN', '注释引用不存在的字段');
        column.comment = node.comment ?? null;
      } else if (node.objtype === 'OBJECT_INDEX') {
        const fullName = partsName(parts), index = model.indexes.find(index => `${index.table.split('.')[0]}.${index.name}` === fullName);
        if (!index) fail('UNSUPPORTED_SQL_INDEX', '注释引用尚未声明的索引');
        index.comment = node.comment ?? null;
      } else fail('UNSUPPORTED_SQL_STATEMENT', '仅支持表、字段和索引注释');
    } else if (kind === 'IndexStmt') {
      keys(node, ['idxname', 'relation', 'accessMethod', 'indexParams', 'whereClause', 'unique'], '索引');
      if (!node.idxname || node.accessMethod !== 'btree') fail('UNSUPPORTED_SQL_INDEX', '索引必须具名且使用 btree');
      const owner = table(name(node.relation));
      if (model.indexes.some(index => index.name === node.idxname && index.table.split('.')[0] === owner.name.split('.')[0])) fail('UNSUPPORTED_SQL_INDEX', '索引名称重复');
      const columns = (node.indexParams ?? []).map(wrapped => {
        const item = wrapped.IndexElem;
        keys(item, ['name', 'ordering', 'nulls_ordering'], '索引字段');
        if (!item.name || !['SORTBY_DEFAULT', 'SORTBY_ASC', 'SORTBY_DESC'].includes(item.ordering) || item.nulls_ordering !== 'SORTBY_NULLS_DEFAULT') fail('UNSUPPORTED_SQL_INDEX', '索引仅支持普通字段、ASC/DESC 和默认 NULL 排序');
        return { name: item.name, direction: item.ordering === 'SORTBY_DESC' ? 'desc' : 'asc' };
      });
      const where = node.whereClause ? predicate(node.whereClause) : [];
      if (new Set(where.map(part => part.column)).size !== where.length) fail('UNSUPPORTED_SQL_INDEX', '部分索引条件含重复字段');
      if (where.length && !node.unique) fail('UNSUPPORTED_SQL_INDEX', '当前仅支持唯一索引的部分条件');
      model.indexes.push({ name: node.idxname, table: owner.name, unique: node.unique ?? false, columns, where, comment: null });
    } else if (kind === 'InsertStmt') {
      keys(node, ['relation', 'cols', 'selectStmt', 'override'], '初始化数据');
      if (node.override && node.override !== 'OVERRIDING_NOT_SET') fail('UNSUPPORTED_SQL_STATEMENT', '不支持 INSERT OVERRIDING');
      const owner = table(name(node.relation)), select = node.selectStmt?.SelectStmt;
      if (model.dataOrder.at(-1) !== owner.name) {
        if (model.dataOrder.includes(owner.name)) fail('UNSUPPORTED_LIFECYCLE', '多表 INSERT 交错顺序无法用按表 data() 无损表示');
        model.dataOrder.push(owner.name);
      }
      if (!select?.valuesLists) fail('UNSUPPORTED_SQL_STATEMENT', '初始化数据仅支持 INSERT VALUES');
      keys(select, ['valuesLists', 'limitOption', 'op'], '初始化数据源');
      if (select.op !== 'SETOP_NONE' || select.limitOption !== 'LIMIT_OPTION_DEFAULT') fail('UNSUPPORTED_SQL_STATEMENT', '不支持带查询操作的 INSERT');
      const columns = node.cols ? node.cols.map(wrapped => {
        keys(wrapped.ResTarget, ['name', 'location'], '初始化数据字段'); return wrapped.ResTarget.name;
      }) : owner.columns.map(column => column.name);
      if (new Set(columns).size !== columns.length || columns.some(name => !owner.columns.some(column => column.name === name))) fail('UNSUPPORTED_SQL_COLUMN', '初始化数据字段缺失或重复');
      for (const wrapped of select.valuesLists) {
        const items = wrapped.List?.items;
        if (!items || items.length !== columns.length) fail('INVALID_SQL_ROW', '初始化数据的字段数与值数量不一致');
        owner.rows.push(columns.map((column, index) => ({ column, value: scalar(items[index]) })));
      }
    } else fail('UNSUPPORTED_SQL_STATEMENT', `不支持 SQL 语句 ${kind}`);
  }
  if (!model.tables.length) fail('NO_SQL_TABLES', 'SQL 中没有可转换的 CREATE TABLE');
  for (const owner of model.tables) {
    const primary = owner.constraints.filter(item => item.kind === 'primary');
    if (primary.length > 1) fail('UNSUPPORTED_SQL_CONSTRAINT', '一张表不能声明多个主键');
    for (const item of owner.constraints) {
      if (!item.columns.length || item.columns.some(name => !owner.columns.some(column => column.name === name))) fail('UNSUPPORTED_SQL_CONSTRAINT', '约束字段不存在');
      if (item.kind === 'primary') for (const name of item.columns) owner.columns.find(column => column.name === name).nullable = false;
    }
    for (const column of owner.columns) {
      if (column.default?.kind === 'nextval') {
        const sequence = sequences.get(column.default.value);
        if (!sequence || sequence.ownedBy?.table !== owner.name || sequence.ownedBy.column !== column.name || sequence.name !== `${owner.name}_seq` || !integerTypes.has(column.type.name) || column.name !== 'id' || primary.length !== 1 || primary[0].columns.length !== 1 || primary[0].columns[0] !== column.name) fail('UNSUPPORTED_SQL_SEQUENCE', `表 ${owner.name}：自增序列必须属于本表 id 单字段整数主键且名称为 table_seq`);
      }
      if (column.default !== undefined) column.default = normalizeValue(column.default, column.type);
    }
    for (const row of owner.rows) for (const field of row) field.value = normalizeValue(field.value, owner.columns.find(column => column.name === field.column).type);
  }
  for (const sequence of model.sequences) {
    if (!sequence.ownedBy || !tables.get(sequence.ownedBy.table)?.columns.some(column => column.name === sequence.ownedBy.column && column.default?.kind === 'nextval' && column.default.value === sequence.name)) fail('UNSUPPORTED_SQL_SEQUENCE', '孤立序列或序列与字段默认值不匹配');
  }
  return { model, parserVersion: tree.version };
}

/** 仅规范化数据库等价字面值；数值全程保留十进制字符串。 */
function normalizeValue(value, type) {
  if (integerTypes.has(type.name) && value.kind === 'string' && !/^[+-]?\d+$/.test(value.value)) throw new ReverseError('UNSUPPORTED_SQL_VALUE', '整数字段的字符串值必须使用整数输入格式');
  if (type.name === 'bytea' && value.kind === 'string' && !/^\\x(?:[\da-fA-F]{2})*$/.test(value.value)) throw new ReverseError('UNSUPPORTED_SQL_VALUE', 'bytea 字符串仅支持小写 \\x 前缀的十六进制格式');
  if (numericTypes.has(type.name) && ['number', 'string'].includes(value.kind) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.value)) {
    let [mantissa, exponent = '0'] = value.value.toLowerCase().split('e');
    const negative = mantissa.startsWith('-'); mantissa = mantissa.replace(/^[+-]/, '');
    let [whole, fraction = ''] = mantissa.split('.');
    const shift = Number(exponent);
    // 不展开任意巨大指数，避免不受信 SQL 触发大量内存分配。
    if (!Number.isSafeInteger(shift) || Math.abs(shift) > 10000) throw new ReverseError('UNSUPPORTED_SQL_VALUE', '数值指数超出可静态转换范围');
    const digits = `${whole}${fraction}`, position = whole.length + shift;
    let decimal = position < 0 ? `0.${'0'.repeat(-position)}${digits}` : position > digits.length ? `${digits}${'0'.repeat(position - digits.length)}` : `${digits.slice(0, position) || '0'}.${digits.slice(position)}`;
    decimal = decimal.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return { kind: 'number', value: `${negative && decimal !== '0' ? '-' : ''}${decimal}` };
  }
  if (type.name === 'bool' && value.kind === 'string' && /^(true|false|t|f)$/i.test(value.value)) return { kind: 'boolean', value: /^(true|t)$/i.test(value.value) };
  if (type.name === 'bytea' && value.kind === 'string') return { kind: 'string', value: value.value.toLowerCase() };
  return value;
}

/** 对 SQL 重组允许的差异排序，保留字段及逐表数据行的原始顺序。 */
export function canonicalModel(model) {
  const sorted = values => [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    tables: model.tables.map(owner => ({ ...owner, columns: owner.columns.map(column => ({ ...column, default: column.default ?? nullValue() })), constraints: sorted(owner.constraints), rows: owner.rows.map(row => [...row].sort((left, right) => owner.columns.findIndex(column => column.name === left.column) - owner.columns.findIndex(column => column.name === right.column))) })),
    sequences: sorted(model.sequences),
    indexes: sorted(model.indexes.map(index => ({ ...index, where: sorted(index.where) }))),
    drops: model.drops,
    dataOrder: model.dataOrder,
  };
}
