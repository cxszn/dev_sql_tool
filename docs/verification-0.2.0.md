# 0.2.0 验证记录

日期：2026-09-24。本次补齐用户参考模板的 `data()` 和 `exists_drop`，只生成本地 SQL 文件，没有执行 PHP 或数据库 SQL。

## 本次行为

- 唯一静态 `public function data()` 对应唯一 `Schema::create`，生成多行 INSERT。
- 显式 ID 在 INSERT 前预留序列范围，混合默认 ID 不与后续显式 ID 碰撞，并为下次默认取号留出范围。
- `public bool $exists_drop = true` 生成实际表名及本次声明序列名称的 DROP IF EXISTS；没有 CASCADE，且在界面和 SQL 中保留危险操作提醒。
- 缺省/false 不自动重建；正常 `down()` 不转换且不再产生提示噪声。
- UI/CLI/MCP 共用核心；界面显示初始数据条数和涉及删除/变更的文件数，新增 seeded 模板默认关闭重建。
- 应用/转换器/锁文件版本统一为0.2.0。旧基线仍受保护，不会自动覆盖0.1.0生成的SQL。

## 自动化

`npm run check` 通过；`npm test` **74/74 通过，无跳过**。

| 范围 | 数量 | 重点 |
| --- | --- | --- |
| 原有转换语义 | 20 | AST、类型、默认值、标识符、索引、ALTER顺序 |
| 新增种子与重建 | 13 | true/false/缺省、单表归属、静态边界、数据校验、精度、序列、唯一值 |
| 模板扩展集成 | 5 | summary透传、MCP、整批失败、0.1基线阻断及显式再生成备份 |
| 原有API/CLI/MCP | 6 | 模板、保存、状态码及真实stdio |
| 文件保护 | 30 | 双哈希、锁、路径、故障注入、回滚、恢复与并发修改 |

新增回归先在旧实现上失败，再通过实现验证。旧清单保护测试确认：开启guard时SQL及manifest字节保持不变；显式guard=false后旧SQL及manifest均保留到backupDir。

## 用户原始文件

输入只读：

`W:/Project/sim_task/sim_task_service/databases/参考模板/migrations/2020_07_22_213202_create_demo_table.php`

用户已把表名改为字面量 `permission`。其两版本转换均返回：

```json
{"seedRows":1,"destructive":true,"creates":1}
```

SQL 顺序为：DROP permission → DROP permission_seq → CREATE SEQUENCE/TABLE → 注释/归属 → setval(1,true) → INSERT 一行 → COMMIT。注释里的 product_brand 不会成为删除对象。剩余提示仅为真实的 unsigned bigint 范围区别及破坏性操作；没有 data/exists_drop 未转换提示。

最新参考报告：

- demo + 4份内置模板：`artifacts/reference-validation-2026-09-24T06-45-41-872Z/report.json`。
- 原17份migration + 4份内置模板：`artifacts/reference-validation-2026-09-24T06-45-41-985Z/report.json`。

两组均分别生成PG16/18输出，原17份共34次转换继续通过。

| 目标 | 实际解析器 | demo+模板 | 原迁移+模板 |
| --- | --- | --- | --- |
| PostgreSQL16 | pglast6.16 / PG16.1 | 5份、68语句通过 | 21份、638语句通过 |
| PostgreSQL18 | pglast8.4 / PG18.4 | 5份、68语句通过 | 21份、638语句通过 |

逐文件语句数保存在相应pg16/pg18子目录的syntax-report.json。解析器主版本由验证脚本校验。上述是语法和转换证据，**没有进行真实PG16/18数据库导入**。

## 外部 Chrome

在用户当前连接的外部Chrome新标签中核对URL及标题，确认界面版本0.2.0，并完成：

1. 输入原参考migrations路径、不填写config，预览成功。
2. 汇总显示1个文件、1条待插入数据、1个含删除/变更。
3. SQL预览出现真实permission表/序列DROP、setval和INSERT；提示中不再出现data/exists_drop被忽略。
4. 点击生成成功，写入本工程 `artifacts/v0.2-browser-demo-pg16/`，未写用户截图中的其他项目输出目录。
5. 模板入口显示4份，新seeded模板false；SQL示例含两行INSERT与setval(2,true)，没有DROP。

原生文件选择和另存对话框未逐项自动化点击，本次保留原接口。软件只生成SQL，成功提示不代表数据库已执行。

## 独立审查

审查发现并修复：种子值全部覆盖时的非法DDL默认值绕过、JSON重复键隐藏非法Unicode值、带zone-id的IPv6误接纳。额外复核等值ID重复、极大ID与默认ID范围、NOTNULL默认NULL遗漏、仅按AST确定删除对象、多表拒绝和基线保护，未发现剩余本次范围内阻断。

参考项目未修改，0.1.0软件包与历史验证资料保留。技能和Agent说明已更新，但没有修改全局客户端配置。

## 便携包验证

Windows x64 包：`dist/2026-09-24T06-47-26-154Z/Migration SQL Studio-win32-x64/`。

包内exe自带运行时通过实际CLI和MCP验证：版本0.2.0、6工具发现、资源和提示词发现，以及PG16/18两版本的seeded模板INSERT、默认false不删表、改true生成DROP和setval。无需外部Node启动该服务。报告位于 `artifacts/package-verification-0.2.0.json`。

使用时退出旧0.1.0程序，启动新目录中的exe，并在左下角核对0.2.0。首次升级建议选择新的SQL输出目录；原目录重生成须显式关闭预检测，工具会保留覆盖前备份。
