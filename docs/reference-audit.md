# 参考迁移与 PG16 模板审计

初版审计日期：2026-09-24；本次补充 0.2.0 的 data()/exists_drop 范围及用户修改后的参考 demo。以下是本地文件的只读证据，工具开发没有改写参考文件，也没有执行迁移 PHP 或数据库 SQL。路径是本机参考来源，不是本工具的运行依赖。

## 1. 实际框架版本

| 组件 | 锁定版本 | 证据 |
| --- | --- | --- |
| `hyperf/database` | `v3.1.67` | [composer.lock](W:/Project/sim_task/sim_task_service/composer.lock:2211) |
| `hyperf/database-pgsql` | `v3.1.66` | [composer.lock](W:/Project/sim_task/sim_task_service/composer.lock:2287) |
| `hyperf/framework` | `v3.1.63` | [composer.lock](W:/Project/sim_task/sim_task_service/composer.lock:2933) |
| `mineadmin/core` | `v3.0.23` | [composer.lock](W:/Project/sim_task/sim_task_service/composer.lock:5519) |

因此参考语义以本地 Hyperf 3.1 / MineAdmin 3.0 源码为准，不能直接套用 Hyperf 3.2 文档中可能变化的类型定义。

## 2. 三种 PHP 输入的区别

### 真实 rules 迁移

文件：[2020_07_22_213202_create_rules_table.php](W:/Project/sim_task/sim_task_service/databases/migrations/2020_07_22_213202_create_rules_table.php:21)。

- 第 23 行使用 `config('permission.database.table')` 作为表名；第 24 行是 `bigIncrements('id')`。
- 第 25–31 行是 `ptype` 与 `v0` 至 `v5`，全部 nullable string；第 32 行是 `timestamps()`。
- 第 39–42 行属于 `down()`，不应混进 `up()` 的 SQL。
- 当前 [permission.php](W:/Project/sim_task/sim_task_service/config/autoload/permission.php:40) 的该键静态值是 `rules`。转换仍要求用户显式配置映射，不启动项目配置系统。

这份文件适合作为最小端到端样例，但一个样例通过不能证明目录内所有迁移都被支持。

### 参考 demo

文件：[2020_07_22_213202_create_demo_table.php](W:/Project/sim_task/sim_task_service/databases/参考模板/migrations/2020_07_22_213202_create_demo_table.php:12)。

- 第 14 行当前为 `Schema::create('permission', ...)`。初版审计时这里是 `config('permission')`，用户随后改为明确表名；当前文件无需表名配置。旧文件若仍使用该配置键，仍需显式字符串映射。
- 第 15–18 行包含主键、带注释和唯一约束的 name、可空 path 和 timestamps。
- 第 22 行开始的 `data()` 返回一行字面量种子数据。0.1.0 只报告未转换；0.2.0 增加受限静态扩展，当前这种唯一 public 无参数 data 返回字面量行数组的写法纳入支持范围。
- 第 35–41 行说明 `exists_drop` 先删表/序列的额外约定，实际属性为 `true`。0.1.0 不实现它；0.2.0 在单一建表模板中输出该表和转换器创建序列的 DROP，并保留重建警告，不带 CASCADE。
- 第 38–39 行注释里的 `product_brand` 是说明文字，不能成为输出目标。当前目标应从第 14 行推导为 `permission`，其默认自增序列为 `permission_seq`。
- 第 9 行类名仍为 `CreateRulesTable`。静态 AST 不实例化或 require 文件，避免把这一重复类名变成执行依赖。

### 数据库迁移说明

文件：[数据库迁移说明.php](W:/Project/sim_task/sim_task_service/.背包/数据库迁移说明.php:11)。

第 22、28、34、40、46 行依次声明同名 `id`，分别展示五种自增方法；后文还有多组重复列和互斥外键动作。因此该文件是方法速查，不是可以整文件执行的建表迁移。首版模板拆成独立示例，转换器需要拒绝重复列和重复主键。

第 328 行的 `point()`、342 行的 `polygon()` 和 372 行的 `geometry()` 等空间方法涉及额外语义。当前版本没有完整 PostGIS 扩展契约，遇到这类方法应报不支持，不能假定原生 PostgreSQL 环境已经安装对应能力。

## 3. 从本地 vendor 确认的语义

| 行为 | 当前源码证据 | 对本工具的影响 |
| --- | --- | --- |
| `timestamps($precision = 0)` | [Blueprint.php](W:/Project/sim_task/sim_task_service/vendor/hyperf/database/src/Schema/Blueprint.php:959) | 展开可空 `created_at`、`updated_at`，默认精度 0 |
| `datetimes($precision = 0)` | [Blueprint.php](W:/Project/sim_task/sim_task_service/vendor/hyperf/database/src/Schema/Blueprint.php:995) | 两个可空日期时间列 |
| Hyperf 3.1 的 `softDeletes()` | [Blueprint.php](W:/Project/sim_task/sim_task_service/vendor/hyperf/database/src/Schema/Blueprint.php:1009) | 使用可空 timestamp，不能直接换成其他版本的行为 |
| MineAdmin `authorBy()` | [RegisterBlueprintListener.php](W:/Project/sim_task/sim_task_service/vendor/mineadmin/support/Listener/RegisterBlueprintListener.php:30) | 默认 `created_by/updated_by`，bigint、默认 0、中文注释 |
| 框架默认自增类型 | [PostgresGrammar.php](W:/Project/sim_task/sim_task_service/vendor/hyperf/database-pgsql/src/Schema/Grammars/PostgresGrammar.php:707) | 默认 serial 系列；与本工具显式 `<table>_seq + nextval` 的目标不同，需要独立 SQL 生成器 |
| `float` / `double` | [PostgresGrammar.php](W:/Project/sim_task/sim_task_service/vendor/hyperf/database-pgsql/src/Schema/Grammars/PostgresGrammar.php:740) | 均为 `double precision`，不能把 float 固定写成 real |
| `enum` | [PostgresGrammar.php](W:/Project/sim_task/sim_task_service/vendor/hyperf/database-pgsql/src/Schema/Grammars/PostgresGrammar.php:790) | 字符类型加允许值 CHECK |

完整现有 migrations 目录还包含 `addColumn`、`authorBy`、`foreignId`、复合主键和一份文件建多表等模式。尤其 [department 迁移](W:/Project/sim_task/sim_task_service/databases/migrations/2025_02_24_195620_create_department_tables.php:14) 在 `up()` 开头就有真实 `Schema::dropIfExists`；处理它时须保留危险操作警告，不能把所有 DROP 都当作 `down()` 忽略。

## 4. PG16 模板对应用契约的要求

文件：[pg16数据库模板.md](W:/Project/cxszn_xyyx/cxszn_xyyx_service/.背包/pg16数据库模板.md:4)。

- 第 8 行：保留显式序列、`nextval()` 和应用 `@KeySequence` 的配合，不统一替换为 identity。
- 第 9–12 行：采用芋道审计字段，当前逻辑删除是 smallint 0/1，审计时间为不带时区 timestamp；这不等于所有新业务都机械增加相同字段。
- 第 14 行：默认当前时间只影响插入，不自动维护每次更新。
- 第 41 行和 101 行：机构业务表的 `tenant_id` 无默认，示例要求有效机构上下文，不能用默认 0 或 1 掩盖缺失值。
- 第 51–55 行：creator/updater 为 varchar(64)，时间默认 CURRENT_TIMESTAMP，deleted 为 smallint 默认 0。
- 第 57–62 行和 86–94 行：原 SQL 还有业务 CHECK 和部分索引；当前精简 PHP 模板没有自动复制这些工具尚未支持的任意 SQL 能力。
- 第 125–129 行：unsigned 的完整数值范围与 PG/Java 容量必须分别核对；主键保持有符号 bigint 的应用契约。

本工具的 `yudao` 模板据此只提供 `id`、租户和审计字段；具体业务字段、状态字典、金额单位、部分唯一性和关联约束要另按目标模型设计。

## 5. 实现与验收边界

实现路径为 `php-parser AST → 受支持 up 及静态扩展校验 → 表/字段/索引与种子结构 → PG SQL`。PHP 字符串、注释、链式调用和匿名类交给语法解析器处理，避免用正则截取方法造成静默误转换。未知动态代码中断。

0.2.0 的 `data()` 不运行 PHP：仅接受 public、非 static、无参数方法里的唯一字面量数组 return，并绑定唯一建表；复杂语句、多表及混合结构操作仍被拒绝。`exists_drop` 仅接受唯一 public、非 static、显式 bool 类型且初值为布尔字面量的属性，默认不重建。生成的显式 ID 种子数据包含自增序列预留与校准。正常 `down()` 不转换、不执行，也不再产生初版的未转换警告。

新增 `seeded` 模板使用 `demo_seed` 和两行示例数据，默认 `exists_drop=false`。0.2.0 转换器版本变化会触发 0.1.0 清单保护，建议新输出目录比对，或明确选择备份后重新生成。该操作不能代替已有库升级方案。

本审计仅证明参考文件与设计依据。软件测试、CLI/MCP 验证和桌面验收结果另见项目实际测试输出；SQL 静态生成、静态语法检查均不等于 PG16/PG18 实际导入或应用验收。
