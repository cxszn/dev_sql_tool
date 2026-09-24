# Migration SQL Studio 0.4.1

本地 Windows 桌面双向转换工具。正向以 PHP Schema migration 的 up() 编写结构，用 data() 的静态字面量定义初始数据，可选 exists_drop 声明重建，生成 PostgreSQL 16 / 18 SQL；反向从选定 SQL 文件生成同名 PHP，并在落盘前完成 SQL → PHP → SQL 的语义比较。项目初建时为空目录、无 Git 仓库、无 Graphify 图谱。源 PHP/SQL 只读；输出写入用户指定范围。

## 能力与顺序

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| converter | 静态解析 PHP、校验支持范围、生成 PG SQL 与诊断 | php-parser |
| reverse / sql-model | 按目标主版本解析 SQL、生成 PHP、正向回编并比较结构和数据语义 | PG18 pgsql-parser 18.2.8；PG16 libpg-query-pg16 alias 16.7.3 |
| workspace | 扫描、预览、SHA-256 基线、批次输出与备份 | converter |
| reverse-workspace | 所选 SQL 清单、反向双哈希保护、全批事务输出 | reverse、共用文件事务能力 |
| desktop | Windows 文件夹选择、版本、配置、预览、转换结果、模板和 AI 接入 | workspace |
| automation | CLI、stdio MCP 工具/资源/提示词、项目技能 | workspace |

先验证两个转换方向及文件保护，再接入桌面和 AI，最后运行真实参考文件、保护回归、协议测试与打包。解析器随软件交付，不要求外部 Python 或数据库服务；后续依赖升级须回归两个目标主版本。

## 已确认的行为

- Windows 桌面软件，提供 CLI 和 MCP。
- 目标必须是 PostgreSQL 16 或 18；默认界面选 16，核心不接受未指定版本。
- 转换静态 up() 和下述 data()/exists_drop 扩展，不执行 PHP、不连接数据库。未知语法必须报文件与行号，不能跳过。正常 down() 不转换、不执行且不产生未转换警告。
- 使用 varchar/char/timestamp/time/boolean，所有整数类型统一输出 int8/int4/int2；保留 public schema 限定、COMMENT ON、OWNED BY 和 BEGIN/COMMIT。
- 主键默认显式序列加 nextval；默认 id 序列名为表名加 _seq，方便应用 @KeySequence 对齐。普通默认主键输出 PRIMARY KEY(...)，由 PG 生成 <表名>_pkey；显式自定义主键名称照原声明保留。
- 普通 id/bigIncrements 映射 int8，increments/mediumIncrements 映射 int4，smallIncrements/tinyIncrements 映射 int2，使用对应 PG 完整 signed 范围，不隐含 unsigned、非负 CHECK 或范围缩减警告。显式 unsignedBigInteger 或 ->unsigned() 仍保留对应范围约束及警告。
- 标准文件名去除 .php 得到 .sql；可移除文件名开头唯一的 migrations. 前缀。递归扫描目录，保持子目录避免重名，Windows 大小写冲突中断。
- 反向显式多选 SQL，每个原文件名.sql 输出原文件名.php，保留中文，不按表拆分。重复源路径、同名输出或 Windows 大小写冲突中断。反向清单为 .migration-php-manifest.json；guard 开启时必须继续选择基线内的全部源文件。
- 界面可填写配置 JSON，例如 {"permission.database.table":"rules"}。不运行 config PHP 文件，不猜动态配置。
- 开启预检测时，已记录 PHP 和 SQL 均须与上次成功转换一致；修改、删除任意已记录文件都阻断整个批次。新文件允许追加。
- 首次遇到既有且未记录的 SQL：生成内容完全一致才接纳，否则中断。
- 关闭预检测允许重新生成，但所有被替换文件及旧清单必须备份，旧文件不能直接丢弃；不自动删除孤立 SQL。
- 版本、配置和转换器版本纳入基线；变更后可使用新输出目录保留旧结果比对。继续使用原输出目录且明确替换旧输出时，关闭预检测后重新预览、备份并生成。
- 全批次解析和预检成功后才写文件；失败回滚已写文件，崩溃通过持久事务日志恢复。
- data() 必须是唯一 public、非 static、无参数方法，方法体只有一个 return，返回静态字面量数据。单表无键行列表保留只允许 up() 唯一 Schema::create 的限制；新增按表名分组模式 ['table'=>[[字段=>值]]]，允许本文件多表，目标须唯一创建且最终存在，不允许任何 Schema::table/rename。先全部 DDL，再按映射键/行顺序 INSERT。t 与 public.t 归一，重复目标拒绝。值为受支持标量/null，JSON 值使用字符串，动态数据不求值。
- exists_drop 必须是唯一 public、非 static、显式 bool 类型属性且初始值为字面量 bool。缺省/false 不额外删表；true 仅用于单一 Schema::create，输出 DROP TABLE IF EXISTS 和由本工具声明的序列 DROP SEQUENCE IF EXISTS，无 CASCADE，并返回重建警告。
- data() 返回空数组使用原单表模式，不生成 INSERT。新序列缺省起点为 max(1, 最大显式自增 ID + 1)，无显式 ID 时为 1；显式 ->startingValue(n) 原样保留源 START，冲突时报错，不偷偷抬高。普通 signed 自增允许合法负显式 ID；省略 ID 按序列起点取号，保留大整数精度与下一次 nextval 空间，不用 setval。
- timestamp/time 各方法第二参数显式 null 表示不限制精度；省略仍为 0，避免反向把无精度列缩为 timestamp(0)。index 支持列名列表或列名=>asc/desc 方向映射；uniqueIndex(columns,name,predicate?) 表示独立唯一索引，可选结构化 AND 等值条件，null 对应 IS NULL，禁止原始 SQL。
- indexComment(indexName,comment) 保留当前表已知索引的正式 COMMENT；auto 列 sequenceType('int8'|'int4'|'int2') 保留显式源序列类型，默认仍跟随列，起点/种子后续空间同时受列和序列范围约束。
- Schema::dropSequenceIfExists/dropSequence 显式保留源序列 DROP，顺序与源意图一致且无 CASCADE。自动 id 与同一 id 的显式 primary(...,'名称') 组合保留源命名主键；其它冲突主键仍拒绝。
- 逐行 INSERT 的自引用外键只能引用此前已插入或当前行中的匹配值，前向/互相引用拒绝，不自动重排；复合外键任一成员为 NULL 按 MATCH SIMPLE 处理。
- SQL 包含可选 DROP、带起点的新序列、建表及约束/注释/索引和逐行种子 INSERT；仍由整个批次先完成解析和预检测后再输出文件，不推断现库状态。
- 应用与逆向转换器版本为 0.4.1，正向编译器保持0.4.0；逆向旧清单因版本变化触发保护。使用新的输出目录或经明确选择关闭 guard 备份后再生成，不代表自动迁移现库。
- 逆向PHP结构引用省略默认public前缀：建表、删表/序列、外键目标和data表名键统一使用简洁名称；非默认schema保留。仅改变PHP写法，注释、业务字符串和正向SQL对象归属不变。
- 正向扫描跳过工具自有备份/事务暂存目录；输入目录存在未完成发布或锁时拒绝读取，不把恢复副本或半完成批次当作迁移。
- generic/yudao/rules/seeded 四模板可预览、复制、另存为新 PHP 文件；不覆盖已有文件。seeded 默认 exists_drop=false。

## 反向范围与语义比较

- 读取目标版本 AST，转换受支持的 CREATE TABLE/SEQUENCE、DROP TABLE/SEQUENCE、序列 OWNED BY、ALTER TABLE ADD PRIMARY KEY / ALTER COLUMN SET DEFAULT、索引、COMMENT 和字面量 INSERT。后置外键/UNIQUE/CHECK 不提前改写；CREATE 内的受支持外键可转换。静态 decode(hex,'hex') 映射为 bytea 十六进制 PHP 字符串，不执行函数。
- 生成匿名迁移类，up()/data() 有中文用途注释。源已有 DROP 明确写入 up()，不用 exists_drop=true 替换，避免多表和外键 DROP 顺序变化；源没有 DROP/数据就不增加。
- 每份生成 PHP 必须先正向回编 SQL，再由同一目标版本解析器读取，比较结构、列顺序/类型/可空/默认、主键/唯一/外键、序列起点/归属、索引/谓词、正式注释、DROP 顺序/选项及逐表数据行/值。任何语义差异中断。
- 允许空白、类型别名、缺省 public 限定、COMMENT 排列及事务包裹规范化。语义比较不要求文本逐字相同，也不证明原执行事务边界或现有数据库升级过程等同。
- 未知语法或无法保持语义的选项拒绝，不能跳过；SQL CHECK、任意查询/函数/触发器、表达式索引、自定义类型等不在当前反向承诺范围。精确限制以 capabilities.reverse 为准。
- 客户端提供 SQL 多选/每行路径、PHP 输出目录、PG16/18、guard，展示 PHP、统计和往返结果。全部文件解析、往返和基线通过后才批量写出，采用锁、备份、事务与恢复机制。

本次指定 7 份 SQL 的审计基准为 151 表、2316 列、140 序列、159 索引、5 外键、8981 数据行、193 DROP。输出到 `W:/Project/cxszn_xyyx/cxszn_xyyx_service/sql/postgresql/migration`，每原文件对应一个 PHP，共 7 个。特别核对 80 个高于 seedmax+1 的显式起点、2 个 WHERE deleted=0 部分唯一索引、3 个 DESC 索引、48 个命名主键、8 条索引注释、2 个 int4 列配 int8 序列、无精度时间及 Quartz 的 22 个静态 decode bytea。mall 原无 DROP、无种子数据，输出也不得添加。这里定义验收要求，实际结果记录在 0.4.0 验证报告。

## 共用接口

converter 模块 src/core/converter.js：

```js
convertPhp(source, { targetVersion: 16, config: {}, sourceName: 'example.php' })
// => { sql, warnings: [{code, message, line?}], tables: ['public.demo'],
//      summary: {seedRows: 0, destructive: false, creates: 1} }
// 异常需包含 message, code, line（如能定位）
```

summary.destructive 对所有已识别的危险结构操作为 true，包括 exists_drop、显式 DROP、删列或重命名，不仅指重建开关。

反向核心 src/core/reverse.js：

```js
await reverseSql(source, {targetVersion: 16, sourceName: 'source.sql'})
// => {php, warnings, summary: {tables, columns, sequences, indexes,
//      foreignKeys, seedRows, drops}, verification: {semanticEqual: true,
//      targetVersion, parserVersion, converterVersion, coverage,
//      canonicalSha256, databaseExecuted: false, ...summary}}
// 无法表示或往返不等时抛出带 code/message/可定位 line 的 ReverseError
```

workspace 模块 src/core/workspace.js：

```js
previewDirectory({inputDir, outputDir, targetVersion, guard: true, config: {}})
convertDirectory({inputDir, outputDir, targetVersion, guard: true, config: {}})
// Promise<{ok, files:[{sourceName,outputName,sql,status,warnings}],diagnostics:[{code,message,file?,line?}],written,skipped,backupDir?}>
```

反向批次 src/core/reverse-workspace.js：

```js
previewReverse({sourceFiles, outputDir, targetVersion, guard: true})
convertReverse({sourceFiles, outputDir, targetVersion, guard: true})
// sourceFiles 是非空 SQL 绝对路径数组；files 项包含 php、summary、verification。
```

桌面渲染端唯一宿主桥 window.studio：

```js
getInfo() // {version, appPath, templates, mcpConfig, defaults}
chooseDirectory(kind) // path|null
chooseSqlFiles() // SQL 绝对路径数组，原生多选
preview(options), convert(options)
previewReverse(options), convertReverse(options)
getTemplate(id) // {id,name,description,content}
writeClipboard(text) // 桌面文本复制；只向系统剪贴板写文本
saveTemplate({id,tableName?}) // {path}|null 原生保存对话框，不覆盖
openOutput(path) // 仅打开此前选择/转换的目录
```

templates 是 [{id,name,description}]；所有宿主调用返回 Promise。正常操作错误用 {ok:false,diagnostics:[...]}，模板及宿主异常由界面捕获显示。

MCP 共 9 个工具：原 6 个正向/模板工具与 migration_reverse_validate、migration_reverse_preview、migration_reverse_convert。反向 validate 接收 source/sourceName/targetVersion；反向批次接收 sourceFiles/outputDir/targetVersion/guard。资源仍为 migration://guide、migration://templates，提示词仍为 author_migration、review_migration。

## 验收

- rules 真实示例用显式配置产生正确表名、自增主键、6 个 v 字段、ptype 及时间字段。
- 当前参考 demo 使用字面量 permission 表名，data() 应生成一行种子 INSERT，exists_drop=true 应产生实际 permission 表及工具序列的 DROP；注释中的 product_brand 名称不得成为 SQL 目标。
- seeded 在 PG16/18 均输出两条 INSERT，序列 START WITH 3；默认不包含 DROP 或 setval。非法 data 返回结构、动态代码、类型不匹配、重复扩展声明和不唯一的目标表都明确报错。
- 全整数别名、无数据/混合 ID/负显式 ID/高精度 ID 的序列起点与上界、逐行顺序及自引用外键、默认及自定义主键名均有语义验证。
- exists_drop 的缺省/false/true 分支、无自增序列表、正常 down 无噪声均有语义验证；仅普通自增取消隐含 unsigned 警告，显式 unsigned 范围及重建警告保留。
- 新增 startingValue、显式 null 时间精度、方向索引、独立及部分唯一索引、序列 DROP、多表 data 和命名自增主键有正向验证；非法组合不可静默降级。
- 7 个实际源 SQL 对应恰好 7 个 PHP，语义比较和聚合统计符合审计基准；源文件不改变，已有输出不被无保护覆盖。
- PG16/PG18 反向实际调用各自版本解析器；错误语法、往返差异、输入/输出变更和批次任一失败时都保留已有文件。
- 字段/表注释、默认值、引号转义、nullable、索引、常见类型与宏有语义测试；不支持的分支和任意函数调用被拒绝。
- 修改 PHP、修改 SQL、删除、目录冲突、版本变化、批次中任一解析失败均不得损坏已存在输出。
- CLI 状态码与 JSON 输出可供脚本使用；MCP initialize/tools/list/tools/call/resources/prompts 通过真实 stdio 客户端验证。
- 桌面界面真实预览和转换，构建 Windows 可运行目录；Chrome 验证同源界面时明确区别于原生窗口验证。
- SQL 生成/解析证据与真实 PG16 / PG18 导入证据分开记录；无数据库运行环境时不得宣称已完成导入。

## 参考

- 用户共享会话《数据库编辑》 https://chatgpt.com/s/cx_6ab4b8e47114819184e59ad4c339947f （2026-09-24 外部 Chrome 已读）
- W:/Project/sim_task/sim_task_service/databases/migrations/2020_07_22_213202_create_rules_table.php
- W:/Project/sim_task/sim_task_service/.背包/数据库迁移说明.php
- W:/Project/cxszn_xyyx/cxszn_xyyx_service/.背包/pg16数据库模板.md
