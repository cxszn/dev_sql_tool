# 0.4.1 默认 public 的 PHP 简写

日期：2026-09-24。用户要求把 `Schema::create('public.product_brand', ...)` 改为不带默认schema前缀的PHP写法。

## 实现

逆向生成器只在结构引用位置省略精确的小写 `public.`：Schema建表、删表、序列删除、外键on目标以及data表名键。非默认schema（sales、Public、publicity等）保留显式名称，注释和业务字符串不做全局替换。

在本工具中，PHP未写schema的名称仍明确映射到public。SQL中保留schema限定，数据库对象归属不变。这是PHP表示形式简化，不是PostgreSQL语法版本升级。

应用与逆向转换器版本为0.4.1；正向编译器继续使用0.4.0，其SQL输出没有改变。capabilities分别返回应用version、正向compilerVersion和reverse.version。

## 实际文件更新

目录：`W:/Project/cxszn_xyyx/cxszn_xyyx_service/sql/postgresql/migration`。

根据当前清单的7个来源重新生成，包括用户上次指定的 `.bak2026-9-23/mall-2026-04-18-传播违法.sql`，没有退回无演示数据的商城源。写入前确认所有源SQL与现有PHP都与基线一致；逐份对比旧PHP和新PHP的正向SQL，**7份全部逐字节相同**。随后备份并更新7个PHP和反向清单，读回核验。

当前范围仍为151张表、2315列、140个序列、156个索引、5个外键、12460条初始化记录和291条明确DROP声明；原SQL不变，字段/约束/注释/数据不变，未执行任何数据库操作。

旧PHP、清单及README/报告备份在：

`W:/Project/cxszn_xyyx/cxszn_xyyx_service/sql/postgresql/migration/.migration-sql-backups/0245bd71-27d8-45d4-8ab4-6fa5e067ceff/`

逐文件哈希与写出证据：`artifacts/compact-php-names-2026-09-24T09-08-07-098Z/report.json`。

## 验证

- 新增名称测试先在旧实现失败，再通过：PG16/PG18的默认引用简写、非默认及大小写schema保留、业务字符串/注释不变。
- 自动恢复副本不应作为迁移输入；正向扫描现在跳过工具自有备份/事务暂存目录，并阻断仍在生成或待恢复的PHP输入目录。两项新回归先失败后通过。
- `npm run check`通过，完整测试 **153/153通过，无跳过**。
- 实际目录更新后仍仅扫描7份PHP，历史备份不重复参与转换。
- 这次没有改动原生窗口组件；命令和MCP打包验证另记录在包验证报告。没有进行真实数据库导入。

## 软件包

`dist/2026-09-24T09-10-27-394Z/Migration SQL Studio-win32-x64/`已生成，固定入口`启动最新版.cmd`指向该包。

包内自带运行时实际通过CLI、9工具MCP及PG16/PG18双向用例，特别断言反向PHP的`Schema::create('reverse_smoke', ...)`不再包含默认前缀。报告：`artifacts/package-verification-0.4.1.json`。无需外部Node/Python运行客户端。
