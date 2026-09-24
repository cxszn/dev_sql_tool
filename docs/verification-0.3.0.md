# 0.3.0 简洁 PostgreSQL 输出验证

日期：2026-09-24。按用户已确认的五项规则更新生成器。原参考项目保持只读，SQL 仅写入本工程测试输出，未运行 PHP 或连接数据库。

## 已实现契约

1. 所有整数输出使用 `int8/int4/int2`。PHP 方法名称不变。
2. `CREATE SEQUENCE` 直接输出 `AS <字段最终整数类型> START WITH <起点>`，以精确整数计算 `max(1, 最大显式ID+1)`；没有种子、空种子或只有非正ID时从1开始。没有 `setval()`。
3. 默认主键输出 `PRIMARY KEY (...)`；显式自定义名称仍保留。跟踪 PostgreSQL 自动命名、已知重名、UTF-8截断及重命名后的实际约束名，供后续操作引用。
4. `data()` 按原数组顺序逐行 `INSERT`，省略字段遵守默认值；自引用外键须引用之前行或当前行，前向依赖会明确拒绝，不自动重排。
5. 普通自增使用 PG 原生有符号范围，没有隐含非负CHECK和unsigned范围提醒。显式unsigned声明仍保留对应范围和提示。

`COMMENT ON`、`OWNED BY`、`public` schema限定、事务和真实删除风险提示继续保留。既有数据库的实际对象状态不在离线工具可见范围，本工具不会自动升级旧库。

## 自动化与接口

`npm run check` 通过，最终 `npm test` **87/87 通过，无跳过**。测试包括转换语义、种子/重建、八项输出风格、四项用户风格API/CLI/MCP契约、模板集成和文件保护。

默认主键与同序UNIQUE重复声明的命名歧义也有独立回归，转换前明确拒绝；不会在后续DROP中猜错约束名。

`tests/output-contract.test.js` 使用三条品牌数据，分别经 PG16/PG18 API、CLI、MCP 核验：

- 序列起点4；ID/排序/状态为int8/int4/int2。
- 普通PRIMARY KEY，不自动命名CONSTRAINT；无id非负CHECK或unsigned范围提示。
- 三条独立INSERT，苹果、华为、索尼保留原顺序。
- 正式注释、序列归属、删除提示保留。

另覆盖：高于JS安全整数的大ID、负ID与默认ID混用、int2/int4/int8边界、显式unsigned、主键名截断与rename/drop、逐行自引用外键。0.1.0和0.2.0旧清单均被保护；明确关闭guard后旧SQL和清单均保留到备份目录。

## 真实输入与语法

原始demo输入：`W:/Project/sim_task/sim_task_service/databases/参考模板/migrations/2020_07_22_213202_create_demo_table.php`。

当前 `permission` 示例种子ID=1，因此输出 `START WITH 2`，字段为 `id int8`、普通 `PRIMARY KEY (id)`。数据已生成INSERT；只有exists_drop=true对应的DESTRUCTIVE_OPERATION，没有UNSIGNED_BIGINT_RANGE。

- demo + 四份内置模板：`artifacts/reference-validation-2026-09-24T07-24-39-626Z/report.json`。
- 原17份迁移 + 四份内置模板：`artifacts/reference-validation-2026-09-24T07-24-39-728Z/report.json`。

| 目标 | 实际解析器 | demo+模板 | 原迁移+模板 |
| --- | --- | --- | --- |
| PG16 | pglast6.16 / PostgreSQL16.1 | 5份、67语句通过 | 21份、638语句通过 |
| PG18 | pglast8.4 / PostgreSQL18.4 | 5份、67语句通过 | 21份、638语句通过 |

相应pg16/pg18子目录包含逐文件语法报告。语法解析器主版本由脚本强制核对。这是静态和目标版本语法验证，未进行PG16/PG18实际数据库导入。

## 外部 Chrome 与发布

外部Chrome新标签页核对URL、标题及界面VERSION0.3.0，直接读取用户原迁移目录预览，确认START WITH 2、int8、普通PRIMARY KEY，无setval或unsigned提示。点击生成成功，输出位于本工程 `artifacts/v0.3-browser-demo-pg16/`，未写入用户截图中的另一项目SQL目录。

独立只读审查核对精确序列、nativeauto、显式unsigned、主键生命周期和逐行自引用外键，未发现剩余本次范围内阻断。原生文件选择与另存对话框未逐项自动化点击；不以Chrome预览冒充原生窗口验收。

本次打包新增项目根目录固定入口 `启动最新版.cmd`，指向本次新包；保留所有旧包，不终止用户正在运行的旧程序。启动后应检查左下角版本。仍需用户自行配置外部客户端MCP/技能，未修改全局客户端配置。

## 最终便携包

路径：`dist/2026-09-24T07-29-23-129Z/Migration SQL Studio-win32-x64/`。

包内自带运行时已实际通过 CLI capabilities 和 MCP stdio 验证：0.3.0、六工具、资源/提示词、PG16/18 seeded模板均正确。核对两条独立INSERT、START WITH 3、id int8、普通PRIMARY KEY、无setval及隐含非负检查；true分支保留DROP。报告为 `artifacts/package-verification-0.3.0.json`。

固定启动入口已读回确认指向上述目录。最终源码重新生成的52份参考产物逐字节匹配已解析报告中的SQL；外部Chrome页面错误日志为空。
