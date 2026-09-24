# 0.5.0 自有 PHP 编写提示验收

日期：2026-09-24。新增 `SqlStudio` 自有命名空间；旧 Hyperf/Illuminate 静态读取兼容保留。正向 SQL 输出版本维持 0.4.0，因既有可转换输入的输出格式未变；应用、反向生成器、SDK 为 0.5.0。

## 已验证

- `npm test`：163/163 通过；包括自有 imports、别名、FQN、命名空间、旧 imports 的 SQL 等价，SDK 契约与链式类型、导出幂等/拒绝覆盖、CLI 与 MCP 集成。
- `npm run check`：JavaScript 语法检查通过。
- 本机已安装的 Intelephense 1.18.5 通过 stdio 运行：7/7 验证通过，包括 Schema/Blueprint 跳转、中文悬浮说明、foreignId→nullable→constrained→cascadeOnDelete 补全。隔离项目自行索引；没有安装插件或修改 IDE 设置。
- 外部 Google Chrome 的本地预览：确认 VERSION 0.5.0、模板中的 SqlStudio imports；IDE 卡片导出成功、重复导出成功、导出到已选择的 migration 输入目录报错。
- Windows x64 便携包真实 CLI/MCP 检查通过；10 个工具、3 个资源、2 个提示词，PG16/18 转换往返与初始化数据检查通过，六个声明类已包含在包内。
- 用户指定目录中的七份 PHP 仅变更三个 imports，修改前后回编 SQL 字节一致；原 SQL 哈希不变。保留 151 表、2315 列、140 序列、156 索引、5 外键、12460 数据行及 291 DROP。
- 七份旧 PHP 和反向清单已由现有事务发布器备份。更新后 guard=true 复检成功，七份均 unchanged。SDK 位于迁移输入范围外，正向扫描仍为七份文件。

## 证据

- `artifacts/tests-0.5.0.log`
- `.test-output/ide-lsp/2026-09-24T09-27-22.001Z/report.json`
- `artifacts/sqlstudio-imports-2026-09-24T09-29-31-208Z/report.json`
- `artifacts/package-verification-0.5.0.json`

## 验证边界

未执行 PHP、未连接数据库、未实际导入 SQL。Intelephense 验收是语言服务请求，不是 VS Code/Cursor 界面操作；IntelliJ IDEA 提示界面和 Electron 原生文件夹对话框未自动化验收。浏览器模式验证的是共享 renderer/API。

SDK 的 config() 不注册全局函数；旧动态 rules 模板仍可由转换器解析，在无框架的 IDE 中可能提示函数未定义，已在 SDK 说明中标明。当前七份迁移使用字面量表名，不受此限制影响。
