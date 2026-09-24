---
name: migration-sql
description: 使用 Migration SQL Studio 在 PostgreSQL 16/18 SQL 与 PHP migration 之间双向转换，编写 up、静态 data 和受支持扩展。适用于模板、已有 SQL 逆向、往返语义比较、预览与文件保护；不执行数据库迁移或任意 PHP 程序。
---

# PHP ↔ PostgreSQL SQL

新写或重新生成的 PHP 统一导入 `SqlStudio\Migrations\Migration`、`SqlStudio\Schema\Blueprint` 和 `SqlStudio\Schema\Schema`。IDE 提示接入先读取 `migration://ide-sdk`，再用 `migration_export_ide_sdk` 导出到迁移输入目录之外；SDK 只供索引，仍由客户端静态转换。

先读取 `migration_capabilities`，确认方向和目标版本；反向另核对其中 `reverse`。需要字段、扩展或比较边界时读取 `migration://guide`。新写 PHP 时通过 `migration://templates` 选择模板，再用 `migration_template` 取内容。能力、参数和错误以当前 MCP `tools/list` 返回的定义为准。

## PHP → SQL

1. 从用户目标确定目标版本 `16` 或 `18`、表名、字段契约、输入目录和输出目录。复用用户已给的选择。实际业务字段、NULL/default、金额单位、状态值、租户和逻辑删除契约不从示例推断。
2. 用适合的模板编写 `up()`；需要初始数据时选择 `seeded` 并阅读指南中的 `data()` 与序列规则。需要另存模板时使用 `migration_write_template`；它只创建新 PHP，遇到已存在路径就选新文件名。按当前模板能力处理表名替换；动态 rules 模板通过配置 JSON 指定表名。
3. 调用 `migration_validate` 检查 PHP，再用 `migration_preview` 检查整个输入目录，按下方基线规则设置 guard（默认 `true`）。逐个阅读文件、SQL、warnings 和 diagnostics；将错误定位到源文件和行号后修复，再预览。
4. 只有当前预览成功且警告已向用户说明，才在用户授权的本地输出范围调用 `migration_convert`。报告实际 written/skipped、种子数据行数、重建目标、输出目录、备份目录和仍存限制。生成 SQL 与真实 PostgreSQL 导入是不同证据。

## SQL → PHP

默认 `public` 的PHP结构引用使用不带前缀的表/序列名称，包含Schema调用、外键目标及data表名键；保留非默认schema。不要对业务数据或注释做全局字符串替换。这个简写在本工具中仍指向public，不改变数据库归属。

1. 复用用户指定的 SQL 文件清单、PG16/PG18 和 PHP 输出目录。每个 SQL 对应一个同名 PHP，保留中文文件名；没有用户另行要求时，不拆成逐表文件或增加 reset 文件。
2. 使用 `migration_reverse_validate({source, sourceName, targetVersion})` 检查单份文本，或 `migration_reverse_preview({sourceFiles, outputDir, targetVersion, guard:true})` 只读预览整个批次。sourceFiles 是 SQL 绝对路径数组；工具会按目标主版本解析、生成 PHP、正向回编并比较受支持语义。
3. 逐份检查 diagnostics、warnings、summary 和 verification，核对表/列/序列/索引/外键/数据行/DROP 统计与来源。显式 START、序列类型、时间精度、主键名、独立唯一索引/条件/方向、索引注释和数据都须保留。源 DROP 明确写入 up 并保留 DROP 顺序，不擅改为 exists_drop=true；源无 DROP/数据时不补造。
4. 所有文件解析、往返语义和预检测通过，且本地输出已获用户授权时，使用相同选项调用 `migration_reverse_convert`。报告实际输出与备份路径，逐一说明未完成项。失败时保留错误，不改用 raw SQL、不跳过语句、不手工写 PHP 绕过比较。

`verification.semanticEqual` 只证明当前支持范围内的结构和逐表数据语义；类型别名、缺省 public、空白、COMMENT 位置、DDL 重组和事务包裹允许规范化。不能称原文逐字或逐句顺序一致，也不能称已导入或无损升级业务库。实际 parserVersion 与 databaseExecuted:false 一并用于说明验证范围。

## 约束

- 静态转换处理受支持的 `up()` 及静态模板扩展；动态分支、任意函数、`include/require/eval` 或缺少配置映射都应返回明确错误。修复为当前支持的声明式 PHP，或说明需要扩展能力；不能跳过未知语句来声称转换成功。
- `config('permission.database.table')` 需要用户明确提供 `{"permission.database.table":"rules"}` 等映射。任何其他配置键也须显式映射；不执行项目配置 PHP、不读取 `.env` 寻找替代值。
- `data()` 是唯一 public、非 static、无参数方法，方法体仅 return 静态字面量。单表无键行列表保留唯一 create 限制；多表用 `['表名'=>[[字段=>值]]]`，每个目标须在本文件唯一创建且最终存在，不能混入 Schema::table/rename。全部 DDL 后按映射键和行顺序 INSERT，不自动重排。列值为允许标量/null；错误不以删行掩盖。
- 缺省新序列起点为 `max(1, 最大显式 ID + 1)`；显式 `startingValue(n)` 精确保留 START，不偷偷取更大值，冲突/耗尽时报错。`sequenceType` 保留源序列类型，范围同时受列与序列约束；不输出 setval，不校准现库。时间参数显式 null 保留无精度类型，省略仍为 0。
- 索引方向使用结构化 asc/desc；独立唯一索引用 `uniqueIndex`，部分谓词只用受支持的 AND 等值映射；索引正式注释用 `indexComment`。自增 id 与同一 id 的显式命名 primary 可组合；任意 raw SQL 仍不允许。这些是工具 DSL 扩展，不表示其他 Hyperf 运行时可以直接执行生成 PHP。
- `public bool $exists_drop = false` 是默认模板写法；只有用户明确需要重建 SQL 时才设为 `true`。它仅支持单一建表，生成表及工具本次创建序列的 DROP，不带 CASCADE，并显示实际目标和警告。相同名字不证明旧库对象属于此迁移。正常 `down()` 不转换、不执行，也不因被排除而告警。
- 预检测是与上次成功转换的 PHP/SQL 双哈希基线比较。冲突时展示哪些文件改变、删除或未被记录；不得自动关闭 guard、清除清单或覆盖 SQL 来消除错误。用户已明确要求重新生成时，可设置 `guard: false` 重新预览，通过后以相同选项转换；由工具先备份被替换文件和旧清单，并报告备份路径。
- 0.4.0 会因转换器版本变化阻止直接沿用旧输出基线。正向使用 .migration-sql-manifest.json，反向使用 .migration-php-manifest.json。优先选新输出目录比对，或按上条有意备份后再生成；不要承诺自动无损升级已有数据库。`guard` 控制本地文件保护，`exists_drop` 控制生成的 SQL，二者独立。
- 工具只生成文件，不执行 PHP 或数据库 SQL；数据库连接、导入、删表与重置序列需要独立任务及授权。写模板的授权不等于执行数据库迁移。
- 整数输出统一 `int8/int4/int2`，保留 public schema、COMMENT ON、OWNED BY 和事务。默认主键输出无自定义名称的 `PRIMARY KEY (...)`，由 PG 自动命名 `<表名>_pkey`；显式主键名保留。普通 id/bigIncrements/increments 等自增使用 PG 完整有符号范围，不隐含非负 CHECK 或 unsigned 警告；显式 unsigned 声明仍保留相应约束和警告。
- 自增 `id` 使用显式 `<表名>_seq`；核对应用 `@KeySequence`。`useCurrent()` 不会自动维护每次更新的时间。

## 无 MCP 时

在 Migration SQL Studio 工程或解压目录中，先读取 `docs/migration-guide.md` 与当前 CLI `--help`，再走相同的模板、预览、修复、转换流程。未连接 MCP 时不要虚构工具调用结果。

本文件是随软件交付的可安装技能。放在仓库中不代表已在用户的 AI 客户端安装或启用；启用状态须通过该客户端的技能发现结果核实。独立安装后优先使用 MCP 资源取得指南和模板，不依赖本技能目录之外的相对路径。
