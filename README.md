# Migration SQL Studio

在 Windows 上进行 PostgreSQL SQL ↔ PHP migration 双向转换。0.4.0 新增 SQL → PHP：每份 SQL 生成一份同名 PHP，并在写出前完成 SQL → PHP → SQL 的结构和数据语义比较。正向继续使用 `up()` 编写结构、静态 `data()` 定义初始数据，输出 PostgreSQL 16 / 18 SQL。提供桌面工作台、CLI、stdio MCP、迁移模板和可携带的 AI 技能。

0.4.1 默认在生成的 PHP 中省略 `public.`：例如 `Schema::create('product_brand', ...)`，并同步简写删除、外键和 data 的结构引用。非默认 schema 保留，实际生成 SQL 的对象归属不变。

## 启动

从 [GitHub Releases](https://github.com/cxszn/dev_sql_tool/releases) 下载 `Migration-SQL-Studio-0.5.0-win32-x64.zip`，解压后双击 `Migration SQL Studio.exe`。请完整解压整个目录，启动后核对左下角显示 `VERSION 0.5.0`。

软件自带运行时和 SQL 解析器，不需要另外安装 PHP、Node.js、Python 或 PostgreSQL。源码用户完成 `npm run package` 后，也可通过自动生成的 `启动最新版.cmd` 打开本次便携包；该启动器是本机生成文件，不包含在 Git 源码中。

源码开发要求 Node.js ≥ 22.12.0：

```powershell
npm ci
npm run setup:electron
npm start
```

`npm run package` 生成新的 Windows x64 便携目录，不覆盖之前的包。

## PHP → SQL

1. 在「转换工作台」选择 migrations 文件夹和独立的 SQL 输出文件夹。
2. 选择 PostgreSQL 16 或 18。默认开启文件变更预检测。
3. 如果迁移使用 `config('key')`，在「动态配置映射」中显式填写 JSON。
4. 点击「预览转换」，阅读 SQL、警告和错误。
5. 点击「生成 SQL」。全部文件检查通过后才写入，结果显示写入/跳过数量和备份位置。

迁移文件 `2020_07_22_213202_create_demo_table.php` 输出为 `2020_07_22_213202_create_demo_table.sql`。文件名若以 `migrations.` 开头会移除这个前缀。递归扫描保留子目录；Windows 大小写重名会中断。

输入和输出目录不能相同或互为父子目录；不要把 SQL 输出放到扫描范围内。输出需要支持硬链接的文件系统，本机 NTFS 已测试；不支持时会报错并保护旧文件。

### 你的 rules 迁移

原文件的表名来自 `config('permission.database.table')`，配置填写：

```json
{"permission.database.table":"rules"}
```

工具读取 PHP 内容并解析语法，不启动原项目、不执行配置 PHP，也不读取 `.env`。任何 `config('key')` 都需要对应字符串映射；当前参考 demo 已使用字面量表名 `permission`，不需要表名配置。

生成结果用显式序列 `public.rules_seq`、`nextval()` 和 `OWNED BY`，保留原 `timestamps()` 两列可空的语义。表名和字段名统一加双引号，并保留 `public` schema 限定；类型使用 `varchar`、`timestamp`、`int8/int4/int2` 等写法。默认主键输出 `PRIMARY KEY (...)`，由 PostgreSQL 命名为 `<表名>_pkey`；迁移中显式指定的主键名会保留。

## SQL → PHP

1. 进入「SQL → PHP」，多选 `.sql` 文件，或在路径列表中每行填写一个 SQL 绝对路径。
2. 选择 PHP 输出目录和源 SQL 的目标 PostgreSQL 主版本 `16` 或 `18`，保持预检测开启。
3. 预览转换，查看每份 PHP、表/列/序列/索引/数据行统计、警告及往返语义比较结果。
4. 全批文件解析、往返比较和预检测通过后，生成 PHP。任一文件失败都不进入正常写出阶段。

例如 `quartz.sql` 生成 `quartz.php`；中文原文件名保留。一次选择 7 份 SQL 就生成 7 份 PHP，不按表拆分，不额外生成 reset 文件。生成方法带中文用途注释。

反向转换保留显式序列起点与类型、命名主键、普通和独立唯一索引、受支持的部分索引、索引列方向与注释、外键及字面量种子数据。源 SQL 已有的 DROP 之间的顺序保留在 `up()`，不会改为 `exists_drop=true` 重排；源中没有 DROP 或数据时，不额外添加。其余 DDL 可按依赖重组，不声称逐句原次序完全相同。静态 `decode(hex, 'hex')` 可转换为 PHP bytea 十六进制字符串，过程不执行 SQL 函数。

PG16 使用随软件交付的 `libpg-query-pg16`（`libpg-query@16.7.3`），PG18 使用 `pgsql-parser@18.2.8`，按选定的实际主版本解析。引入这些解析器是为了读取 PostgreSQL AST 并验证往返语义，不依赖正则拼凑 SQL，也不要求外部 Python 或数据库服务；版本由锁文件固定，升级时需要两版本回归。

往返通过表示当前支持范围内的结构和数据语义一致，不表示 SQL 原文完全一致。空白、类型别名、默认 `public` 限定、COMMENT 排列和事务包裹可规范化；它也不证明脚本在现有数据库可无损执行。未知语法或无法保持语义的选项会阻止输出，不能跳过后宣称完整转换。

## 文件变更预检测

正向输出目录的 `.migration-sql-manifest.json` 记录原 PHP 与输出 SQL 的 SHA-256；反向使用 `.migration-php-manifest.json` 记录所选 SQL 与输出 PHP。清单同时记录目标版本和转换器版本，正向还记录配置映射。

| 情况 | 开启预检测 |
| --- | --- |
| 首次转换，SQL 不存在 | 生成并建立基线 |
| PHP / SQL 均未改变 | 跳过，保留 SQL 修改时间 |
| 新增 PHP 文件 | 追加生成 |
| 已记录 PHP 或 SQL 修改 / 删除 | 整批中断，指出具体文件 |
| 版本或配置与基线不同 | 中断，要求明确重新生成 |
| 已有未登记 SQL，与本次生成内容完全一致 | 接纳并登记 |
| 已有未登记 SQL，内容不同 | 中断 |

上表描述正向；反向对所选 SQL 和生成 PHP 实施同样的双哈希保护。保持 guard 时，还须继续选择该输出基线中已登记的全部 SQL，不能仅取消选中来移除旧记录。反向批次的重复路径、Windows 大小写冲突或同名 SQL 输出碰撞会中断。

需要有意替换旧输出并重新生成时，可关闭预检测。被替换文件和旧清单通过批次备份保留；结果返回实际备份路径。旧的孤立输出不会自动删除。已有库的结构升级应新增迁移，生成工具不会推断线上已执行到哪一步。

升级到 0.4.0 时，转换器版本变化会触发旧清单保护。建议选择新的输出目录审查新结果；若已明确要替换旧输出，再关闭预检测、先预览并通过工具备份后重新生成。这只是输出文件升级，不是自动升级现有数据库。

写入采用进程锁、临时完整文件、事务日志和最后提交清单。中断后下一次转换尝试恢复；如果发现事务之后有人修改文件，会保留日志和所有副本，返回冲突位置。不要自行删除 `.migration-sql-*` 锁和事务目录以绕过错误。预览始终不恢复、不写文件。

## 编写模板

0.5.0 新生成的 PHP 使用客户端自有 `SqlStudio` 命名空间。模板页的「IDE 代码提示」可把带中文说明、参数类型和链式返回类型的提示包导出到项目目录下的 `sql-studio-sdk`。它必须在 migration 输入目录之外；已有不同内容不会覆盖，相同内容可重复导出。旧 Hyperf / Illuminate 导入继续兼容静态读取。

IDE 请打开同时包含 migration 和 SDK 的项目目录。VS Code / Cursor 启用 PHP Intelephense；IntelliJ IDEA 需有 PHP 插件及相应功能许可。单独打开 migration 时需设置 includePaths；超过 1 MB 的 PHP 需提高 Intelephense files.maxSize。详细设置见 [IDE 提示包说明](php-sdk/README.md)。提示包不需要 Composer 安装，不提供数据库执行功能。

CLI：`node src/cli.js ide-sdk --output <项目绝对目录> --input <迁移绝对目录> --json`。MCP 提供 `migration_export_ide_sdk` 和 `migration://ide-sdk`，供 AI 使用相同说明。

「迁移模板」提供通用业务表、芋道租户审计、动态配置表名和初始数据四份模板，可阅读 PHP 和对应 SQL，复制或另存为新 PHP。另存不覆盖已有文件。`seeded` 模板包含两行显式 ID 数据，`exists_drop` 默认为 `false`。

- [完整编写指南](docs/migration-guide.md)
- [参考文件与框架语义审计](docs/reference-audit.md)
- [需求和接口约定](docs/spec.md)

当前支持静态 `Schema::create/table/dropIfExists/drop/rename`、序列 DROP、常用字段类型、默认值、nullable、注释、索引、主键、外键和常见宏。0.4.0 增加 `startingValue` / `sequenceType`、不限定时间精度的 `null` 参数、索引方向、结构化部分唯一索引和 `indexComment`。精确清单及反向限制以 `capabilities` / MCP `migration_capabilities` 为准。

未知方法、动态分支、循环、任意函数、原始 SQL、PostGIS 空间类型及 `change()` 会明确报错。正常 `down()` 不转换、不执行，也不作为警告；其他不支持的代码仍报告诊断。

### 初始数据与可选重建

工具可读取唯一的 `public function data()`：非 static、无参数，方法体只能有一个 `return`。旧的无键行列表仅对应 `up()` 中唯一 `Schema::create`；0.4.0 支持 `['表名' => [[字段 => 值], ...]]` 的多表映射。映射目标必须是本文件唯一创建且最终存在的表，不支持混合 `Schema::table` 或 rename；先输出全部 DDL，再按映射键和各表行顺序 INSERT。每行值保持标量或 `null`，JSON 数据使用字符串。

唯一的 `public`、非 static `exists_drop` 属性须显式声明 `bool` 类型，只接受字面量布尔值。省略或 `false` 不增加 DROP；`true` 要求单一 `Schema::create`，会在建表前输出 `DROP TABLE IF EXISTS` 及本工具创建的序列的 `DROP SEQUENCE IF EXISTS`，不加 `CASCADE`，并保留重建警告。它适用于已明确需要重建的脚本；仅生成文件不会删除数据库，实际执行这些 SQL 则会删除同名表中的数据。

未指定起点时，新序列在 CREATE 中设置 `START WITH max(1, 最大显式 ID + 1)`；没有显式 ID 时从 1 开始。`->startingValue(n)` 则精确保留显式起点，不偷偷取它与种子最大值的较大者；冲突或范围耗尽时报错。种子数据按声明顺序逐条 INSERT，保留精确大整数和上界检查，不输出 `setval`。具体限制见[数据与序列指南](docs/migration-guide.md)。工具不执行任何 PHP 或 SQL，生成含 INSERT / DROP 的脚本不代表已经插入或删表。

普通 `id` / `bigIncrements` / `increments` 等自增方法采用 PG 原生有符号整数语义，不自动添加非负 CHECK 或 unsigned 范围警告。显式 `unsignedBigInteger` 或 `->unsigned()` 仍保留对应约束和范围警告；其他显式无符号整数按需要提升类型。时间列的 `useCurrent()` 只提供插入默认值，不实现每次 UPDATE 自动刷新。

## CLI

源码目录下可直接使用 `node src/cli.js`，便携目录下可使用 `migration-sql.cmd`。

```powershell
node src/cli.js capabilities
node src/cli.js template --id generic --table demo_product --out "D:\migrations\2026_09_24_000001_create_demo_product.php"
node src/cli.js template --id seeded --table demo_seed --out "D:\migrations\2026_09_24_000002_create_demo_seed.php"
node src/cli.js preview --input "D:\migrations" --output "D:\sql\pg16" --pg-version 16 --json
node src/cli.js convert --input "D:\migrations" --output "D:\sql\pg16" --pg-version 16 --json
node src/cli.js validate --file "D:\migrations\2026_09_24_000001_create_demo_product.php" --pg-version 18 --json
node src/cli.js reverse-validate --file "D:\sql\quartz.sql" --pg-version 16 --json
node src/cli.js reverse-preview --files "D:\sql-files.json" --output "D:\migrations" --pg-version 16 --json
node src/cli.js reverse-convert --files "D:\sql-files.json" --output "D:\migrations" --pg-version 16 --json
```

反向 `--files` 指向 JSON 文件，内容是非空的 SQL 绝对路径数组，例如 `["D:\\sql\\quartz.sql", "D:\\sql\\go-view.sql"]`；不是目录，也不是 SQL 内容。每个源文件对应一个同名 PHP。

动态配置放入 JSON 文件，通过 `--config "D:\rules-config.json"` 传入。`--no-guard` 用于明确需要备份后重新生成的场景。退出码 0 表示成功，1 表示预检/转换失败，2 表示参数或文件错误。

## MCP 和 AI

「AI 接入」提供当前安装位置的连接配置。也可在便携目录运行 `生成MCP配置.cmd`，按解压位置生成 `MCP配置.json`。它是本地 stdio MCP，客户端启动子进程通信，不开放网络服务，不需要 API Key。

源码运行配置示例（路径换成实际位置；Node 可执行文件可使用完整路径）：

```json
{
  "mcpServers": {
    "migration-sql": {
      "command": "node",
      "args": ["D:\\Tools\\dev_sql_tool\\src\\mcp.js"]
    }
  }
}
```

便携 exe 的 Node 模式需要配置 `ELECTRON_RUN_AS_NODE=1`，界面和生成的配置已包含。移动软件目录后重新从界面复制配置，或备份并移走旧 JSON 后重新生成；生成器保留已有不同内容。

| 工具 | 行为 |
| --- | --- |
| migration_capabilities | 读取真实支持范围 |
| migration_template | 读取模板和指定版本 SQL 示例 |
| migration_validate | 校验一段 PHP 并返回 SQL |
| migration_preview | 只读预检目录 |
| migration_convert | 通过预检后写 SQL 和清单 |
| migration_write_template | 将内置模板写到新的 PHP 文件 |
| migration_reverse_validate | 将 SQL 文本转 PHP 并进行往返语义比较，不写文件 |
| migration_reverse_preview | 预览所选 SQL 文件批次，检查往返结果和文件基线 |
| migration_reverse_convert | 全批通过后生成同名 PHP 与反向清单 |
| migration_export_ide_sdk | 将中文 IDE 提示包导出到迁移目录之外，保留已有不同内容 |

共 10 个工具。资源为 `migration://guide`、`migration://templates` 与 `migration://ide-sdk`，提示词为 `author_migration` 与 `review_migration`。正向先编写 PHP、validate、preview，再生成；反向先读取 `capabilities.reverse`，reverse_validate/reverse_preview 检查语义，再 reverse_convert。反向批次参数为 `sourceFiles`（绝对路径数组）、`outputDir`、`targetVersion`、`guard`。写目录由用户指定，默认保持 `guard:true`。

- [项目自带技能](skills/migration-sql/SKILL.md)：可将整个 `skills/migration-sql` 文件夹加入客户端技能目录。
- [sql编写助手提示词](agents/migration-author.md)：可作为自定义 Agent 指令，引用本工具的 MCP。

这里只提供技能和提示词文件；未修改任何客户端的全局 MCP、技能或 Agent 配置。

## 验证与范围

```powershell
npm run check
npm test
```

测试范围包括静态 AST、SQL 语义、反向往返比较、目录保护/备份/故障恢复、CLI 和真实 MCP stdio 交互。本次简写调整见[0.4.1 验证记录](docs/verification-0.4.1.md)；双向转换基线见[0.4.0 验证记录](docs/verification-0.4.0.md)。[0.3.0 历史记录](docs/verification-0.3.0.md)、[0.2.0 历史记录](docs/verification-0.2.0.md) 与 [0.1.0 历史记录](docs/verification.md) 保留供对照，不能当作新版本的验证结果。

可额外执行只读参考转换（输出仅在当前工程 artifacts）：

```powershell
node scripts/verify-reference.js "D:\Project\example\databases\migrations"
```

`scripts/validate-pg-syntax.py <输出目录> --target-version 16|18` 是开发阶段可选的独立语法复核，要求 Python 环境安装与目标主版本匹配的 pglast，版本不匹配会拒绝。桌面、CLI 和 MCP 的反向转换使用内置主版本匹配解析器，不依赖这个脚本。语法解析、往返比较与文件生成成功不能证明数据库导入、现库升级或业务运行正确；本工具不提供数据库执行功能。

`npm run preview` 是开发时的外部 Chrome 验证入口，监听随机本机端口并使用会话令牌。正式使用请启动桌面软件，原生文件夹选择与另存对话框仅在桌面可用。
