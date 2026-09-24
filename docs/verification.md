# 0.1.0 验证记录

日期：2026-09-24。所有参考项目只读，测试输出在本工程 artifacts 或系统临时目录，未操作业务数据库。

## 自动化

- `npm run check`：JavaScript 语法检查通过。
- `npm test`：56/56 测试通过，无失败、无跳过。
- 转换语义 20 项：AST 允许边界、配置映射、字符串/标识符转义、大数精度、默认值、范围、注释、nullable、外键、ALTER 顺序、索引/序列生命周期等。
- 文件保护 30 项：双侧修改与删除、版本/配置、追加、基线、路径逃逸/junction、锁、写入失败、并发编辑、崩溃恢复、提交和回滚清理中断。
- API / CLI / MCP 6 项：三模板与两版本、自定义表名 up/down 一致、模板不覆盖、CLI 状态码及真实输出、MCP stdio 协议与工具/资源/提示词调用。
- 技能 frontmatter：使用 skill-creator quick_validate.py，显式 UTF-8，验证通过。

文件事务已通过进程级故障注入；未模拟整机断电。安全发布依赖文件系统硬链接，本机 NTFS 上已验证。

## 真实迁移与 PostgreSQL 语法

命令：

```powershell
node scripts/verify-reference.js "W:\Project\sim_task\sim_task_service\databases\migrations"
```

17 份真实迁移 × PG16/18 = 34 次转换成功。加上三份内置模板 × 两版本，总计 40 份 SQL 产物。

最终产物与哈希报告：`artifacts/reference-validation-2026-09-24T06-08-56-311Z/report.json`。

| 目标 | 解析器 | 内嵌 PostgreSQL 解析版本 | 文件 | 语句 | 结果 |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL 16 | pglast 6.16 | 16.1 | 20 | 626 | 全部通过 |
| PostgreSQL 18 | pglast 8.4 | 18.4 | 20 | 626 | 全部通过 |

对应 `pg16/syntax-report.json` 与 `pg18/syntax-report.json` 记录每个文件。运行脚本会核对目标主版本与解析器主版本，不会拿 PG18 解析器冒充 PG16。

原 `.背包/数据库迁移说明.php` 因重复列 id 在第28行被拒绝，符合类型速查文件的实际性质。

**这部分证明静态转换和目标语法，不证明真实数据库导入。** 本机没有启动 PostgreSQL 测试实例，Docker 引擎未运行；没有执行 SQL、验证既有表和实际业务。

## 外部 Google Chrome

使用当前连接的外部 Chrome 新标签页，核对实际 URL 为本机预览服务、标题为 Migration SQL Studio。该预览服务直接调用共用转换核心，未使用假数据。

已经过界面动作验证：

1. 空态、目录输入、PG16/18 入口、保护开关可见。
2. rules 未提供配置时报 `MISSING_CONFIG`，显示原 PHP 文件及第23行。
3. 填写 `permission.database.table=rules` 后可预览真实 SQL。
4. 点击生成，显示写入1、跳过0；独立读取产物确认文件和基线落盘。
5. 对本工程测试输出追加人工注释，再次生成报 `OUTPUT_CHANGED`，保留人工内容。
6. 模板页显示3份模板，PHP/SQL切换显示真实转换输出。
7. AI页显示实际 Node/MCP入口、6个工具、技能和Agent文件路径。
8. 已查看页面截图并核对宽屏布局；按1360×850桌面工作区检查页面。
9. 切换 PostgreSQL 18 并通过界面生成，SQL 头部及界面版本均为18，结果标为已生成；页面错误日志为空。

原生 Electron 的选择文件夹和保存对话框不能用 Chrome 预览替代验收；本次未通过原生窗口自动化逐项点击。桌面版使用隔离 preload 桥接到 Electron dialog；复制使用窄的文本剪贴板桥，拒绝其他浏览器权限。

## Windows 便携包

`npm run package` 成功，Electron 44.4.5 / Windows x64。输出目录：

`dist/2026-09-24T06-11-04-865Z/Migration SQL Studio-win32-x64/`

使用该目录中的 exe 自带 Node 运行时，执行 `scripts/verify-package.js` 实际验证：

- CLI capabilities 成功返回 PG16/18。
- 读取包内 MCP配置.json 启动服务，完成 stdio 握手与6个工具发现。
- 通过包内 MCP 转换 yudao 模板到 PG18，读取2个资源和2个提示词。
- 测试进程未依赖外部 Node 运行服务；报告见 `artifacts/package-verification.json`。

当前便携包未签名，也未制作安装器；请保留整个目录。原生对话框仍需用户在桌面窗口中试用确认。

## 审查和交付边界

独立审查发现的 ALTER 显式命令顺序、删除后索引登记、重命名后序列归属均已修复并加入回归。独立文件发布故障注入确认人工文件不被覆盖。桌面锚点导航的 IPC 来源校验、剪贴板权限路径和 Windows 保留设备名也已修正。

MCP、skills 和 Agent 提示词随项目提供；未修改 Codex 或其他客户端的全局配置，未宣称已安装启用。

未初始化或更新 Graphify，未修改参考项目，未创建 Git 提交或推送。
