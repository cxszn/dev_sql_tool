"""使用 PostgreSQL 16 的独立 AST 对比原 SQL 和 PHP 回编 SQL，不执行数据库操作。"""

from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import sys

import pglast
from pglast.parser import parse_sql_json


class UnsupportedAst(ValueError):
    """遇到未覆盖语法时中止该文件核验，避免默默忽略。"""


def digest(value):
    """对规范值计算稳定哈希，报告不包含初始化数据明文。"""
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def fields(value, allowed, path):
    """验证 AST 属性白名单，新增语法必须经过人工核对。"""
    extra = set(value) - set(allowed.split()) - {"location"}
    if extra:
        raise UnsupportedAst(f"{path}: unknown fields {sorted(extra)}")


def strings(nodes):
    """读取 PostgreSQL 标识符列表，保留大小写和顺序。"""
    result = []
    for node in nodes:
        if set(node) != {"String"}:
            raise UnsupportedAst("identifier: expected String")
        fields(node["String"], "sval", "String")
        result.append(node["String"].get("sval", ""))
    return result


def qualified(parts, count=2):
    """将未限定对象名称归一为 public，同时保留其它 schema。"""
    if len(parts) == count - 1:
        parts = ["public", *parts]
    if len(parts) != count:
        raise UnsupportedAst("identifier: unexpected qualification")
    return parts


def relation(value):
    """读取关系名称并核验临时表和继承等属性。"""
    fields(value, "schemaname relname inh relpersistence", "RangeVar")
    if value.get("relpersistence", "p") != "p" or not value.get("inh", True):
        raise UnsupportedAst("RangeVar: nonstandard persistence/inheritance")
    return qualified([value["schemaname"], value["relname"]] if "schemaname" in value else [value["relname"]])


def object_key(parts):
    """使用 JSON 键避免包含点号的带引号名称产生歧义。"""
    return json.dumps(parts, ensure_ascii=False, separators=(",", ":"))


def decimal_text(value):
    """无损归一整数和十进制数，避免浮点与 Decimal 上下文舍入。"""
    number = Decimal(str(value))
    if not number.is_finite():
        return str(number)
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if number == 0 else text


def type_name(value):
    """归一 PostgreSQL 内置类型别名并保留精度和长度。"""
    fields(value, "names typmods typemod", "TypeName")
    names = strings(value["names"])
    if len(names) == 2 and names[0] == "pg_catalog":
        names = names[1:]
    aliases = {"bigint": "int8", "integer": "int4", "smallint": "int2", "boolean": "bool", "decimal": "numeric"}
    if len(names) == 1:
        names[0] = aliases.get(names[0], names[0])
    if value.get("typemod", -1) != -1:
        raise UnsupportedAst("TypeName: non-default typemod")
    return {"name": names, "modifiers": [expression(x) for x in value.get("typmods", [])]}


def regclass_name(text):
    """解析 nextval 的 regclass 名称，正确处理引号内的点和双引号。"""
    parts = []
    offset = 0
    while offset < len(text):
        found = re.match(r'\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z_0-9$]*))\s*', text[offset:])
        if not found:
            raise UnsupportedAst("regclass: unknown identifier format")
        parts.append(found.group(1).replace('""', '"') if found.group(1) is not None else found.group(2).lower())
        offset += found.end()
        if offset < len(text):
            if text[offset] != ".":
                raise UnsupportedAst("regclass: invalid separator")
            offset += 1
    return qualified(parts)


def expression(node):
    """转换受支持表达式为与源码位置和整数拼写无关的 AST。"""
    if node is None:
        return None
    if len(node) != 1:
        raise UnsupportedAst("expression: invalid node wrapper")
    kind, value = next(iter(node.items()))
    if kind == "A_Const":
        fields(value, "ival fval sval boolval isnull", kind)
        if value.get("isnull"):
            return ["null"]
        if "ival" in value:
            return ["number", decimal_text(value["ival"].get("ival", 0))]
        if "fval" in value:
            return ["number", decimal_text(value["fval"]["fval"])]
        if "sval" in value:
            return ["string", value["sval"].get("sval", "")]
        if "boolval" in value:
            return ["bool", value["boolval"].get("boolval", False)]
        raise UnsupportedAst("A_Const: no value")
    if kind == "SQLValueFunction":
        fields(value, "op typmod", kind)
        if value["op"] != "SVFOP_CURRENT_TIMESTAMP":
            raise UnsupportedAst("SQLValueFunction: unhandled op")
        return ["current_timestamp", value.get("typmod", -1)]
    if kind == "TypeCast":
        fields(value, "arg typeName", kind)
        target = type_name(value["typeName"])
        inner = expression(value["arg"])
        if target == {"name": ["regclass"], "modifiers": []} and inner[0] == "string":
            return ["regclass", regclass_name(inner[1])]
        return ["cast", inner, target]
    if kind == "FuncCall":
        fields(value, "funcname args funcformat", kind)
        names = strings(value["funcname"])
        if names[:1] == ["pg_catalog"]:
            names = names[1:]
        if names not in (["nextval"], ["decode"], ["now"]):
            raise UnsupportedAst("FuncCall: unhandled function")
        args = [expression(x) for x in value.get("args", [])]
        if names == ["now"] and not args:
            return ["current_timestamp", -1]
        if names == ["nextval"] and len(args) == 1 and args[0][0] == "string":
            args = [["regclass", regclass_name(args[0][1])]]
        return ["function", names, args]
    if kind == "ColumnRef":
        fields(value, "fields", kind)
        return ["column", strings(value["fields"])]
    if kind == "A_Expr":
        fields(value, "kind name lexpr rexpr", kind)
        if value["kind"] != "AEXPR_OP":
            raise UnsupportedAst("A_Expr: unhandled operator kind")
        return ["operator", strings(value["name"]), expression(value.get("lexpr")), expression(value.get("rexpr"))]
    if kind == "SetToDefault":
        fields(value, "typeId typeMod", kind)
        return ["default"]
    raise UnsupportedAst(f"expression: unhandled {kind}")


def typed_value(node, coltype):
    """按列类型无损比较每个值，保留 NULL、缺省和字符串的区别。"""
    value = expression(node)
    name = coltype["name"]
    if value in (["null"], ["default"]):
        return value
    if name in (["int2"], ["int4"], ["int8"], ["numeric"], ["float4"], ["float8"]):
        if value[0] in ("number", "string"):
            return ["number", decimal_text(value[1])]
    if name == ["bool"] and value[0] in ("string", "number", "bool"):
        token = str(value[1]).lower()
        if token in ("true", "t", "1", "yes", "on"):
            return ["bool", True]
        if token in ("false", "f", "0", "no", "off"):
            return ["bool", False]
        raise UnsupportedAst("bool value: invalid scalar")
    if name == ["bytea"]:
        if value[0] == "string" and value[1].startswith("\\x"):
            return ["bytes", bytes.fromhex(value[1][2:]).hex()]
        if value[0] == "function" and value[1] == ["decode"] and len(value[2]) == 2 and value[2][1] == ["string", "hex"]:
            return ["bytes", bytes.fromhex(value[2][0][1]).hex()]
        raise UnsupportedAst("bytea value: unsupported representation")
    if "A_Const" in node and value[0] == "number":
        literal = node["A_Const"]
        if "fval" in literal:
            return ["numeric_to_other_type", "float", literal["fval"]["fval"]]
        return ["numeric_to_other_type", "integer", value[1]]
    return value


class Model:
    """独立组装表结构、序列、索引和逐值哈希模型。"""

    def __init__(self, source):
        """解析 SQL 并完整遍历支持的语句。"""
        self.tables = {}
        self.sequences = {}
        self.indexes = {}
        self.comments = {}
        self.drops = []
        self.settings = []
        self.inserts = []
        self.lifecycle = {}
        self.data_order = []
        self.statement_types = Counter()
        self.statement_order = []
        self.transactions = []
        self.explicit_starts = 0
        tree = json.loads(parse_sql_json(source))
        self.parser_version = tree["version"]
        for wrapped in tree.get("stmts", []):
            fields(wrapped, "stmt stmt_location stmt_len", "RawStmt")
            self.statement(wrapped["stmt"])
        self.finish()

    def constraint(self, value, table, column=None):
        """合并列约束及 ALTER TABLE 约束，保留名称和外键动作。"""
        fields(value, "contype conname keys raw_expr fk_attrs pk_attrs pktable fk_del_action fk_matchtype fk_upd_action initially_valid deferrable initdeferred", "Constraint")
        kind = value["contype"]
        if kind in ("CONSTR_NOTNULL", "CONSTR_NULL", "CONSTR_DEFAULT"):
            if column is None:
                raise UnsupportedAst("Constraint: column required")
            if kind == "CONSTR_DEFAULT":
                column["default"] = typed_value(value["raw_expr"], column["type"])
            else:
                column["nullable"] = kind == "CONSTR_NULL"
            return
        result = {"kind": kind, "name": value.get("conname"), "deferrable": value.get("deferrable", False), "deferred": value.get("initdeferred", False)}
        if kind in ("CONSTR_PRIMARY", "CONSTR_UNIQUE"):
            result["columns"] = strings(value.get("keys", [])) or ([column["name"]] if column else [])
        elif kind == "CONSTR_FOREIGN":
            result.update(columns=strings(value["fk_attrs"]), target=relation(value["pktable"]), targetColumns=strings(value["pk_attrs"]), update=value.get("fk_upd_action", "a"), delete=value.get("fk_del_action", "a"), match=value.get("fk_matchtype", "s"), valid=value.get("initially_valid", False))
        elif kind == "CONSTR_CHECK":
            result["expression"] = expression(value["raw_expr"])
        else:
            raise UnsupportedAst(f"Constraint: unhandled {kind}")
        table["constraints"].append(result)

    def sequence_options(self, sequence, options):
        """合并 CREATE/ALTER SEQUENCE 选项并保留显式起点。"""
        for wrapped in options:
            value = wrapped["DefElem"]
            fields(value, "defname arg defaction", "DefElem")
            name = value["defname"]
            arg = value.get("arg")
            if name == "as":
                sequence["type"] = type_name(arg["TypeName"])
            elif name == "owned_by":
                sequence["ownedBy"] = qualified(strings(arg["List"]["items"]), 3)
            elif name in ("start", "increment", "cache", "minvalue", "maxvalue"):
                if arg is None:
                    sequence[name] = None
                elif set(arg) == {"Integer"}:
                    sequence[name] = int(arg["Integer"].get("ival", 0))
                elif set(arg) == {"Float"}:
                    sequence[name] = int(Decimal(arg["Float"]["fval"]))
                else:
                    raise UnsupportedAst("sequence option: unsupported numeric node")
                if name == "start":
                    self.explicit_starts += 1
            elif name == "cycle":
                sequence["cycle"] = arg["Boolean"].get("boolval", False)
            else:
                raise UnsupportedAst(f"sequence option: unhandled {name}")

    def statement(self, node):
        """逐类验证 SQL 语句，所有不支持节点显式报错。"""
        kind, value = next(iter(node.items()))
        self.statement_types[kind] += 1
        self.statement_order.append(kind)
        if kind == "TransactionStmt":
            fields(value, "kind", kind)
            if value["kind"] not in ("TRANS_STMT_BEGIN", "TRANS_STMT_COMMIT"):
                raise UnsupportedAst("TransactionStmt: unsupported transaction kind")
            self.transactions.append((len(self.statement_order) - 1, value["kind"]))
        elif kind == "VariableSetStmt":
            fields(value, "kind name args is_local", kind)
            if value["kind"] != "VAR_SET_VALUE" or value["name"] != "standard_conforming_strings":
                raise UnsupportedAst("VariableSetStmt: unsupported setting")
            self.settings.append({"kind": value["kind"], "name": value["name"], "args": [expression(x) for x in value.get("args", [])], "local": value.get("is_local", False)})
        elif kind == "DropStmt":
            fields(value, "objects removeType behavior missing_ok", kind)
            if value["removeType"] not in ("OBJECT_TABLE", "OBJECT_SEQUENCE"):
                raise UnsupportedAst("DropStmt: unsupported object type")
            self.drops.append({"kind": value["removeType"], "objects": [qualified(strings(x["List"]["items"])) for x in value["objects"]], "ifExists": value.get("missing_ok", False), "behavior": value.get("behavior", "DROP_RESTRICT")})
            for parts in self.drops[-1]["objects"]:
                self.lifecycle.setdefault(object_key([value["removeType"], *parts]), []).append("drop")
        elif kind == "CreateSeqStmt":
            fields(value, "sequence options", kind)
            key = object_key(relation(value["sequence"]))
            self.lifecycle.setdefault(object_key(["OBJECT_SEQUENCE", *relation(value["sequence"])]), []).append("create")
            if key in self.sequences:
                raise UnsupportedAst("CreateSeqStmt: duplicate sequence")
            sequence = {"type": {"name": ["int8"], "modifiers": []}, "increment": 1, "cache": 1, "cycle": False, "minvalue": None, "maxvalue": None, "start": None, "ownedBy": None}
            self.sequence_options(sequence, value.get("options", []))
            self.sequences[key] = sequence
        elif kind == "AlterSeqStmt":
            fields(value, "sequence options", kind)
            self.sequence_options(self.sequences[object_key(relation(value["sequence"]))], value.get("options", []))
        elif kind == "CreateStmt":
            fields(value, "relation tableElts oncommit", kind)
            if value.get("oncommit", "ONCOMMIT_NOOP") != "ONCOMMIT_NOOP":
                raise UnsupportedAst("CreateStmt: unsupported oncommit")
            key = object_key(relation(value["relation"]))
            self.lifecycle.setdefault(object_key(["OBJECT_TABLE", *relation(value["relation"])]), []).append("create")
            if key in self.tables:
                raise UnsupportedAst("CreateStmt: duplicate table")
            table = {"columnOrder": [], "columns": {}, "constraints": [], "rows": []}
            self.tables[key] = table
            for element in value.get("tableElts", []):
                if "ColumnDef" in element:
                    column = element["ColumnDef"]
                    fields(column, "colname typeName is_local constraints", "ColumnDef")
                    if not column.get("is_local", True):
                        raise UnsupportedAst("ColumnDef: nonlocal")
                    name = column["colname"]
                    if name in table["columns"]:
                        raise UnsupportedAst("ColumnDef: duplicate column")
                    dest = {"name": name, "type": type_name(column["typeName"]), "nullable": True, "default": ["missing"]}
                    table["columnOrder"].append(name)
                    table["columns"][name] = dest
                    for wrapped in column.get("constraints", []):
                        self.constraint(wrapped["Constraint"], table, dest)
                elif "Constraint" in element:
                    self.constraint(element["Constraint"], table)
                else:
                    raise UnsupportedAst("CreateStmt: unknown table element")
        elif kind == "AlterTableStmt":
            fields(value, "relation cmds objtype", kind)
            if value["objtype"] != "OBJECT_TABLE":
                raise UnsupportedAst("AlterTableStmt: wrong object type")
            table = self.tables[object_key(relation(value["relation"]))]
            for wrapped in value["cmds"]:
                cmd = wrapped["AlterTableCmd"]
                fields(cmd, "subtype def name behavior", "AlterTableCmd")
                if cmd["subtype"] == "AT_AddConstraint":
                    self.constraint(cmd["def"]["Constraint"], table)
                elif cmd["subtype"] == "AT_ColumnDefault":
                    col = table["columns"][cmd["name"]]
                    col["default"] = typed_value(cmd["def"], col["type"])
                else:
                    raise UnsupportedAst("AlterTableCmd: unsupported subtype")
        elif kind == "IndexStmt":
            fields(value, "accessMethod idxname indexParams relation unique whereClause", kind)
            table = relation(value["relation"])
            key = object_key([table[0], value["idxname"]])
            if key in self.indexes:
                raise UnsupportedAst("IndexStmt: duplicate index")
            cols = []
            for wrapped in value["indexParams"]:
                elem = wrapped["IndexElem"]
                fields(elem, "name ordering nulls_ordering", "IndexElem")
                direction = elem.get("ordering", "SORTBY_DEFAULT")
                direction = "SORTBY_ASC" if direction == "SORTBY_DEFAULT" else direction
                nulls = elem.get("nulls_ordering", "SORTBY_NULLS_DEFAULT")
                if nulls == "SORTBY_NULLS_DEFAULT":
                    nulls = "SORTBY_NULLS_FIRST" if direction == "SORTBY_DESC" else "SORTBY_NULLS_LAST"
                cols.append({"name": elem["name"], "direction": direction, "nulls": nulls})
            self.indexes[key] = {"table": table, "unique": value.get("unique", False), "method": value.get("accessMethod", "btree"), "columns": cols, "where": expression(value.get("whereClause"))}
        elif kind == "CommentStmt":
            fields(value, "comment object objtype", kind)
            if value["objtype"] not in ("OBJECT_TABLE", "OBJECT_COLUMN", "OBJECT_INDEX"):
                raise UnsupportedAst("CommentStmt: unhandled target")
            parts = qualified(strings(value["object"]["List"]["items"]), 3 if value["objtype"] == "OBJECT_COLUMN" else 2)
            key = object_key([value["objtype"], *parts])
            if key in self.comments:
                raise UnsupportedAst("CommentStmt: duplicate target")
            self.comments[key] = digest(value.get("comment"))
        elif kind == "InsertStmt":
            fields(value, "cols override relation selectStmt", kind)
            if value.get("override", "OVERRIDING_NOT_SET") != "OVERRIDING_NOT_SET":
                raise UnsupportedAst("InsertStmt: overriding")
            select = value["selectStmt"]["SelectStmt"]
            fields(select, "limitOption op valuesLists", "SelectStmt")
            if select.get("op", "SETOP_NONE") != "SETOP_NONE" or select.get("limitOption", "LIMIT_OPTION_DEFAULT") != "LIMIT_OPTION_DEFAULT":
                raise UnsupportedAst("InsertStmt: unsupported select modifiers")
            cols = []
            for wrapped in value.get("cols", []):
                fields(wrapped["ResTarget"], "name", "ResTarget")
                cols.append(wrapped["ResTarget"]["name"])
            key = object_key(relation(value["relation"]))
            defaults = {name: col["default"] for name, col in self.tables[key]["columns"].items()}
            self.inserts.append((key, cols, select["valuesLists"], defaults))
        else:
            raise UnsupportedAst(f"statement: unhandled {kind}")

    def finish(self):
        """完成默认序列属性和逐行逐值校验，保留每表插入顺序。"""
        ranges = {"int2": (-32768, 32767), "int4": (-2147483648, 2147483647), "int8": (-9223372036854775808, 9223372036854775807)}
        for seq in self.sequences.values():
            lower, upper = ranges[seq["type"]["name"][0]]
            ascending = seq["increment"] > 0
            if seq["minvalue"] is None:
                seq["minvalue"] = 1 if ascending else lower
            if seq["maxvalue"] is None:
                seq["maxvalue"] = upper if ascending else -1
            if seq["start"] is None:
                seq["start"] = seq["minvalue"] if ascending else seq["maxvalue"]
        for table in self.tables.values():
            for constraint in table["constraints"]:
                if constraint["kind"] == "CONSTR_PRIMARY":
                    for name in constraint["columns"]:
                        table["columns"][name]["nullable"] = False
            table["constraints"].sort(key=lambda x: json.dumps(x, sort_keys=True))
        for key, specified, rows, defaults in self.inserts:
            table = self.tables[key]
            cols = specified or table["columnOrder"]
            if len(set(cols)) != len(cols) or not set(cols) <= set(table["columns"]):
                raise UnsupportedAst("InsertStmt: invalid column list")
            for wrapped in rows:
                values = wrapped["List"]["items"]
                if len(cols) != len(values):
                    raise UnsupportedAst("InsertStmt: value arity mismatch")
                normalized = {name: digest(["missing", defaults[name]]) for name in table["columnOrder"]}
                for name, node in zip(cols, values):
                    scalar = typed_value(node, table["columns"][name]["type"])
                    if scalar == ["default"]:
                        scalar = ["default", defaults[name]]
                    normalized[name] = digest(scalar)
                self.data_order.append([key, len(table["rows"])])
                table["rows"].append(normalized)

    def canonical(self):
        """导出内存中的完整比对模型，初始化值仅以逐值哈希表示。"""
        return {"tables": self.tables, "sequences": self.sequences, "indexes": self.indexes, "comments": self.comments, "drops": self.drops, "settings": self.settings, "objectLifecycle": self.lifecycle, "dataOrder": self.data_order}

    def counts(self):
        """计算独立统计，辅助识别对象或数据整体丢失。"""
        constraints = [x for t in self.tables.values() for x in t["constraints"]]
        mismatched_width = 0
        for seq in self.sequences.values():
            if seq["ownedBy"]:
                schema, table, column = seq["ownedBy"]
                col = self.tables[object_key([schema, table])]["columns"][column]
                if col["type"]["name"] != seq["type"]["name"]:
                    mismatched_width += 1
        return {"tables": len(self.tables), "columns": sum(len(t["columns"]) for t in self.tables.values()), "sequences": len(self.sequences), "indexes": len(self.indexes), "foreignKeys": sum(x["kind"] == "CONSTR_FOREIGN" for x in constraints), "primaryKeys": sum(x["kind"] == "CONSTR_PRIMARY" for x in constraints), "rows": sum(len(t["rows"]) for t in self.tables.values()), "values": sum(len(t["rows"]) * len(t["columns"]) for t in self.tables.values()), "drops": len(self.drops), "comments": len(self.comments), "indexComments": sum(json.loads(k)[0] == "OBJECT_INDEX" for k in self.comments), "explicitSequenceStarts": self.explicit_starts, "sequenceStartsOtherThanOne": sum(seq["start"] != 1 for seq in self.sequences.values()), "sequenceColumnTypeDifferences": mismatched_width}

    def proof(self):
        """报告表级与有序行哈希，不公开任何种子数据或注释内容。"""
        return {key: {"columns": len(value["columns"]), "rows": len(value["rows"]), "schemaSha256": digest({k: v for k, v in value.items() if k != "rows"}), "orderedRowsSha256": digest(value["rows"]), "rowSha256": [digest(row) for row in value["rows"]]} for key, value in self.tables.items()}


def differences(left, right, path="", limit=250):
    """仅返回差异路径，不把字段默认值或种子内容写到日志。"""
    result = []
    if type(left) is not type(right):
        return [path + ":type"]
    if isinstance(left, dict):
        for key in sorted(set(left) | set(right)):
            nested = path + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in left or key not in right:
                result.append(nested + ":missing")
            else:
                result.extend(differences(left[key], right[key], nested, limit - len(result)))
            if len(result) >= limit:
                break
    elif isinstance(left, list):
        if len(left) != len(right):
            result.append(path + ":length")
        for index, (a, b) in enumerate(zip(left, right)):
            result.extend(differences(a, b, path + "/" + str(index), limit - len(result)))
            if len(result) >= limit:
                break
    elif left != right:
        result.append(path + ":value")
    return result[:limit]


def compare_models(source, compiled):
    """只归一经明确约定的事务内 standard_conforming_strings 作用域变化。"""
    left, right = source.canonical(), compiled.canonical()
    raw = differences(left, right)
    normalizations = []
    outer_transaction = compiled.transactions == [(0, "TRANS_STMT_BEGIN"), (len(compiled.statement_order) - 1, "TRANS_STMT_COMMIT")]
    expected = {"kind": "VAR_SET_VALUE", "name": "standard_conforming_strings", "args": [["string", "on"]], "local": False}
    if outer_transaction and compiled.statement_order[1:2] == ["VariableSetStmt"] and source.settings == [expected] and compiled.settings == [{**expected, "local": True}]:
        normalizations.append({"kind": "sessionSettingScope", "path": "/settings/0/local", "source": "session", "roundtrip": "outer transaction", "note": "SET LOCAL is scoped to the generated transaction; session state after completion is not claimed identical"})
        left = {**left, "settings": [{**expected, "local": True}]}
    diff = differences(left, right)
    return left, right, raw, diff, normalizations


def self_tests(report_path):
    """使用内存样本证明规范化可接受等价写法且真实更改必被检出。"""
    prefix = "DROP TABLE IF EXISTS t; DROP SEQUENCE IF EXISTS s; CREATE SEQUENCE s AS bigint START WITH 4; "
    create = "CREATE TABLE t (id bigint NOT NULL DEFAULT nextval('s'::regclass), n numeric(30,18), payload bytea, flag boolean, note text DEFAULT NULL, CONSTRAINT custom_pk PRIMARY KEY(id)); "
    after = "ALTER SEQUENCE s OWNED BY t.id; CREATE UNIQUE INDEX ix ON t(n ASC) WHERE n > 0; COMMENT ON INDEX ix IS 'index comment'; COMMENT ON COLUMN t.note IS 'note comment'; COMMENT ON TABLE t IS 'table comment'; "
    inserts = "INSERT INTO t (id,n,payload,flag,note) VALUES (9007199254740993,123456789012.123456789123456789,'\\x00ff',false,'a\\b'); INSERT INTO t (id,n,payload,flag,note) VALUES (9007199254740994,0,'\\x',true,NULL);"
    base = prefix + create + after + inserts
    cases = []

    def check(label, original, candidate, equal):
        """记录预期是否等价及实际差异路径，不输出样本值。"""
        left, right = Model(original), Model(candidate)
        _, _, _, diff, norm = compare_models(left, right)
        cases.append({"name": label, "expectedEqual": equal, "actualEqual": not diff, "passed": (not diff) == equal, "differences": diff, "normalizations": norm})

    check("unchanged", base, base, True)
    check("integer aliases", base, base.replace("bigint", "int8"), True)
    check("default index ordering", base, base.replace("n ASC", "n"), True)
    check("schema qualification", base, base.replace("CREATE TABLE t", "CREATE TABLE public.t").replace("'s'::regclass", "'public.s'::regclass"), True)
    check("bytea hex decode", base, base.replace("'\\x00ff'", "decode('00ff','hex')"), True)
    check("exact numeric spelling", base, base.replace(",0,'\\x'", ",0.0000,'\\x'"), True)
    check("bool spelling", base, base.replace(",false,", ",'false',"), True)
    check("transaction packaging", base, "BEGIN; " + base + " COMMIT;", True)
    check("ALTER primary and default", base, prefix + create.replace(" DEFAULT nextval('s'::regclass)", "").replace(", CONSTRAINT custom_pk PRIMARY KEY(id)", "") + "ALTER TABLE t ADD CONSTRAINT custom_pk PRIMARY KEY(id); ALTER TABLE t ALTER COLUMN id SET DEFAULT nextval('s'::regclass); " + after + inserts, True)
    check("CURRENT_TIMESTAMP", "CREATE TABLE t (v timestamp DEFAULT CURRENT_TIMESTAMP);", "CREATE TABLE t (v timestamp DEFAULT now());", True)
    check("large integer last digit", base, base.replace("9007199254740993", "9007199254740992"), False)
    check("decimal last digit", base, base.replace("123456789012.123456789123456789", "123456789012.123456789123456788"), False)
    check("string escaping", base, base.replace("'a\\b'", "'a\\\\b'"), False)
    check("bytea content", base, base.replace("'\\x00ff'", "'\\x00fe'"), False)
    check("NULL versus omitted", base, base.replace("INSERT INTO t (id,n,payload,flag,note) VALUES (9007199254740994,0,'\\x',true,NULL)", "INSERT INTO t (id,n,payload,flag) VALUES (9007199254740994,0,'\\x',true)"), False)
    first, second = inserts.split("; ")
    check("row order", base, prefix + create + after + second + first + ";", False)
    check("column order", base, base.replace("flag boolean, note text DEFAULT NULL", "note text DEFAULT NULL, flag boolean"), False)
    check("column type", base, base.replace("n numeric(30,18)", "n numeric(30,17)"), False)
    check("column nullability", base, base.replace("n numeric(30,18)", "n numeric(30,18) NOT NULL"), False)
    check("default NULL versus absent", base, base.replace("note text DEFAULT NULL", "note text"), False)
    check("sequence start", base, base.replace("START WITH 4", "START WITH 5"), False)
    check("sequence type", base, base.replace("s AS bigint", "s AS int4"), False)
    check("sequence increment", base, base.replace("START WITH 4", "START WITH 4 INCREMENT BY 2"), False)
    check("sequence cache", base, base.replace("START WITH 4", "START WITH 4 CACHE 5"), False)
    check("sequence ownership", base, base.replace("OWNED BY t.id", "OWNED BY t.n"), False)
    check("drop order", base, base.replace("DROP TABLE IF EXISTS t; DROP SEQUENCE IF EXISTS s;", "DROP SEQUENCE IF EXISTS s; DROP TABLE IF EXISTS t;"), False)
    check("drop if exists", base, base.replace("DROP TABLE IF EXISTS", "DROP TABLE"), False)
    check("constraint name", base, base.replace("custom_pk", "renamed_pk"), False)
    check("index unique", base, base.replace("CREATE UNIQUE INDEX", "CREATE INDEX"), False)
    check("index direction", base, base.replace("n ASC", "n DESC"), False)
    check("index null sort", base, base.replace("n ASC", "n ASC NULLS FIRST"), False)
    check("index predicate", base, base.replace("WHERE n > 0", "WHERE n >= 0"), False)
    check("index comment", base, base.replace("'index comment'", "'changed'"), False)
    check("column comment", base, base.replace("'note comment'", "'changed'"), False)
    check("table comment", base, base.replace("'table comment'", "'changed'"), False)
    check("drop before versus after create", "DROP TABLE IF EXISTS t; CREATE TABLE t(a int);", "CREATE TABLE t(a int); DROP TABLE IF EXISTS t;", False)
    check("default state at insert", "CREATE TABLE t(a int DEFAULT 1); INSERT INTO t VALUES(DEFAULT); ALTER TABLE t ALTER a SET DEFAULT 2;", "CREATE TABLE t(a int DEFAULT 1); ALTER TABLE t ALTER a SET DEFAULT 2; INSERT INTO t VALUES(DEFAULT);", False)
    check("numeric literal into text", "CREATE TABLE t(a text); INSERT INTO t VALUES(1.00);", "CREATE TABLE t(a text); INSERT INTO t VALUES(1);", False)
    shared_sequence = "CREATE SEQUENCE s; CREATE TABLE a(id int DEFAULT nextval('s')); CREATE TABLE b(id int DEFAULT nextval('s')); "
    check("global insert order with shared sequence", shared_sequence + "INSERT INTO a VALUES(DEFAULT); INSERT INTO b VALUES(DEFAULT);", shared_sequence + "INSERT INTO b VALUES(DEFAULT); INSERT INTO a VALUES(DEFAULT);", False)
    foreign = "CREATE TABLE a(id int PRIMARY KEY); CREATE TABLE b(id int PRIMARY KEY, aid int, CONSTRAINT f FOREIGN KEY(aid) REFERENCES a(id) ON DELETE CASCADE);"
    check("foreign key action", foreign, foreign.replace("ON DELETE CASCADE", "ON DELETE RESTRICT"), False)
    setting = "SET standard_conforming_strings=on; "
    check("approved session setting normalization", setting + base, "BEGIN; SET LOCAL standard_conforming_strings=on; " + base + " COMMIT;", True)
    check("LOCAL without enclosing transaction", setting + base, "SET LOCAL standard_conforming_strings=on; " + base, False)
    check("different setting value", setting + base, "BEGIN; SET LOCAL standard_conforming_strings=off; " + base + " COMMIT;", False)
    for label, sql in [("unknown CREATE VIEW", "CREATE VIEW t AS SELECT 1;"), ("unknown array type", "CREATE TABLE t(v int[]);"), ("unknown default function", "CREATE TABLE t(v int DEFAULT abs(-1));")]:
        caught = False
        try:
            Model(sql)
        except UnsupportedAst:
            caught = True
        cases.append({"name": label, "unknownRejected": caught, "passed": caught})
    result = {"passed": all(case["passed"] for case in cases), "count": len(cases), "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "cases": cases}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"selfTestsPassed": result["passed"], "count": len(cases), "report": str(report_path)}, ensure_ascii=False))
    return 0 if result["passed"] else 1


def main():
    """核验指定清单中的真实源文件并将安全报告写入授权目录。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path)
    parser.add_argument("--roundtrip", type=Path)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--report", type=Path, default=Path("artifacts/reverse-fidelity-qa/report.json"))
    args = parser.parse_args()
    if args.self_test:
        return self_tests(args.report)
    if args.sources is None or args.roundtrip is None:
        parser.error("--sources and --roundtrip are required unless --self-test")
    files = json.loads(args.sources.read_text(encoding="utf-8-sig"))
    report = {"validator": "independent-pglast-pg16", "pglastVersion": pglast.__version__, "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "databaseExecuted": False, "files": [], "normalizations": ["unqualified relation names use public", "built-in type aliases and pg_catalog", "default ASC and NULL sort order", "ALTER PRIMARY KEY/default merged into table", "CURRENT_TIMESTAMP and now()", "typed exact Decimal/integer, bool, bytea values", "transaction BEGIN/COMMIT placement ignored", "comment statement placement ignored"], "limitations": ["static PostgreSQL AST comparison; no database execution", "transaction boundaries are not behaviorally compared", "unknown AST kinds/attributes fail the file; no silent pass"]}
    totals = Counter()
    for name in files:
        source_path = Path(name)
        target_path = args.roundtrip / source_path.name
        item = {"source": str(source_path), "roundtrip": str(target_path), "passed": False}
        try:
            original_bytes = source_path.read_bytes()
            roundtrip_bytes = target_path.read_bytes()
            item.update(sourceSha256=hashlib.sha256(original_bytes).hexdigest(), roundtripSha256=hashlib.sha256(roundtrip_bytes).hexdigest())
            source = Model(original_bytes.decode("utf-8-sig"))
            compiled = Model(roundtrip_bytes.decode("utf-8-sig"))
            left, right, raw_diff, diff, normalizations = compare_models(source, compiled)
            schema_data_equal = not differences({k: v for k, v in left.items() if k != "settings"}, {k: v for k, v in right.items() if k != "settings"})
            item.update(parserVersion=source.parser_version, sourceCounts=source.counts(), roundtripCounts=compiled.counts(), sourceSemanticSha256=digest(left), roundtripSemanticSha256=digest(right), rawDifferences=raw_diff, appliedNormalizations=normalizations, schemaAndDataEqual=schema_data_equal, differences=diff, passed=not diff, sourceTableProof=source.proof(), roundtripTableProof=compiled.proof(), sourceStatements=dict(source.statement_types), roundtripStatements=dict(compiled.statement_types))
            totals.update(source.counts())
        except (UnsupportedAst, KeyError, ValueError, InvalidOperation, OSError) as error:
            item["error"] = str(error) if isinstance(error, UnsupportedAst) else type(error).__name__
        report["files"].append(item)
        print(json.dumps({"file": source_path.name, "passed": item["passed"], "counts": item.get("sourceCounts"), "differenceCount": len(item.get("differences", [])), "error": item.get("error")}, ensure_ascii=False))
    report["totals"] = dict(totals)
    report["passed"] = bool(files) and all(x["passed"] for x in report["files"])
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "totals": report["totals"], "report": str(args.report)}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
