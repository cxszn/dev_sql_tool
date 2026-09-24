# 0.4.0 双向转换与七份 SQL 交付验证

日期：2026-09-24。本次用户明确要求：将指定7份PostgreSQL SQL各转换为一个PHP文件，保存至项目的 `sql/postgresql/migration`，并把SQL→PHP功能加入客户端。

## 实际交付

输出目录：`W:/Project/cxszn_xyyx/cxszn_xyyx_service/sql/postgresql/migration`。

| 文件 | 表 | 列 | 初始记录 |
| --- | ---: | ---: | ---: |
| mall-2026-04-18-传播违法.php | 49 | 863 | 0 |
| go-view.php | 1 | 12 | 3 |
| im-2026-06-20-传播违法.php | 17 | 248 | 1430 |
| member-2026-05-30-传播违法.php | 11 | 148 | 402 |
| pay-2026-04-18-传播违法.php | 14 | 255 | 1522 |
| quartz.php | 11 | 79 | 36 |
| ruoyi-vue-pro.php | 48 | 711 | 5588 |
| 合计 | **151** | **2316** | **8981** |

写入7份PHP、反向哈希清单、用途README和转换摘要报告。写回后逐份读取磁盘，确认内容与通过独立核验的暂存PHP一致；再次核对7份原SQL SHA-256均未变化。没有处理目录内额外的增量SQL文件，没有执行PHP或数据库SQL。

## 客户端与接口

- 新增独立「SQL → PHP」页面，原生多选或每行输入明确SQL路径，一份SQL对应同名PHP。
- 支持PG16/PG18、预览、生成、源与输出双哈希保护、备份、逐文件诊断、PHP复制、输出目录打开。
- 显示表/列/序列/索引/外键/数据行/DROP统计，只有完整统计及全部`semanticEqual=true`才显示往返校验通过。
- CLI增加reverse-validate / reverse-preview / reverse-convert；MCP增加3个reverse工具，共9工具。资源与提示词数量各2。
- 运行包携带目标版本WASM解析器；PG16使用libpg-query-pg16 16.7.3，实际parserVersion160001；PG18使用pgsql-parser18.2.8，实际parserVersion180004。无需用户安装Python或数据库。

## 核心保真扩展

保留140个原始序列的显式起点，其中80个不能仅按seed最大值加一还原；保留2处int4列配int8序列、无精度时间、2个部分唯一索引、3个DESC索引、8个索引注释、48个后置命名主键，以及22个静态decode十六进制bytea值。

新增声明式支持：startingValue、sequenceType、时间参数null、index方向、独立uniqueIndex及受控条件、indexComment、显式序列DROP、多表keyed data。生成方法含中文用途说明。这些是本工具支持的声明式语法，不代表任意Hyperf运行时已有这些扩展。

源已有193条DROP按原相互顺序保留；Quartz先删全部旧表再建表，避免每表重建导致外键阻断。mall原无DROP、无种子数据，均未添加。

## 验证证据

1. `npm run check`通过。
2. 最终自动化 **148/148通过，无跳过**，覆盖原正向回归、新DSL、反向AST模型、CLI/MCP、正反向锁/备份/恢复、编码及大小限制。
3. 7份真实SQL × PG16/PG18 **14次内置往返比较通过**，结构与初始化数据模型一致。
4. 独立Python实现使用pglast6.16的PG16 AST进行再次比较，**7/7通过**；校验器本身有**46/46正反自测**。
5. 独立比较覆盖151表、2316列、140序列、151主键、159索引、5外键、8981行、**137950个字段值哈希**、193条DROP、2385条注释（含8条索引注释），以及原数据与DROP顺序。
6. 7份回编SQL共**12170条语句**通过匹配主版本的PG16语法解析。

证据文件：

- `artifacts/reverse-release-0.4.0-2026-09-24T08-09-51-584Z/conversion-report.json`：暂存转换结果。
- 同目录 `final-delivery.json`：实际写入与原SQL未改变证据。
- `artifacts/reverse-fidelity-qa/report.json`：独立结构/逐值比对。
- `artifacts/reverse-fidelity-qa/self-tests.json`：独立校验器反例测试。
- `scripts/verify-reverse-fidelity.py`：可复跑独立比对工具，不作为客户端运行依赖。

报告只记录结构、计数和哈希，不打印真实种子数据。

## 允许的规范化

类型别名、默认public限定、默认ASC/NULL排序、主键和序列默认值并入建表、DDL/注释按依赖组织、bytea静态字面量及外层事务包装可以规范化，不宣称原文逐句一致。

唯一记录的会话范围差异：`ruoyi-vue-pro.sql` 原 `SET standard_conforming_strings=on` 为会话级，回编为事务内的 `SET LOCAL`。独立报告保留rawDifferences和sessionSettingScope normalization；结构数据一致，但不承诺事务结束后的会话设置相同。

## 界面验证与实际限制

外部Chrome新标签核对URL、标题和VERSION0.4.0。以两份虚构SQL完成选择路径、预览、统计、往返通过、实际生成2份同名PHP及状态验证；PHP预览正确保留固定起点、部分唯一索引、DESC和微秒时间。页面错误日志为空，DOM检查没有水平溢出。

本次截图接口两次超时，未取得新版像素截图；原生文件选择/另存对话框没有逐项自动化点击。这些限制不替代已完成的接口和文件读回验证。

独立审查发现的后置FK提前生效、自定义regclass、非法bytea/整数文本规范化、CLI损坏UTF8等问题均已拒绝或修复并回归。所有未知语句/不可保真的语法会阻断，不降级为原始SQL执行。

没有真实数据库导入测试，没有连接业务库，没有修改原SQL、全局客户端配置、Git提交或推送。

## 最终便携包

目录：`dist/2026-09-24T08-26-03-983Z/Migration SQL Studio-win32-x64/`。固定入口 `启动最新版.cmd` 已读回，指向此目录。

使用包内exe自带运行时实际验证CLI与MCP：版本0.4.0、9工具、正向种子/重建、PG16/PG18反向SQL解析与往返均通过。说明WASM解析器已随包分发，不依赖外部Node/Python。报告为 `artifacts/package-verification-0.4.0.json`。

请退出旧版本窗口后启动固定入口，并确认VERSION0.4.0。旧包完整保留；生成的PHP使用新增声明式扩展，旧版工具不应作为其验证或转换入口。
