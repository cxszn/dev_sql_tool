# SqlStudio PHP 编写提示 SDK

版本 **0.5.0**，PHP 语法要求 **8.0+**。本目录为 Migration SQL Studio 的静态 PHP 编写语言提供类、方法签名、链式补全与中文悬浮说明，不是数据库迁移执行器。

客户端、CLI 和 MCP 直接解析 PHP 源码，不加载本 SDK，不需要安装 PHP 或 Composer，也不会运行 `up()` / `data()`。SDK 的具体方法会抛出 `LogicException`，避免把声明误当成可运行程序。**请勿用 `php migration.php` 执行，也不需要向迁移中添加 require/autoload 语句。**

## 使用方式

迁移文件使用三个入口：

```php
use SqlStudio\Migrations\Migration;
use SqlStudio\Schema\Blueprint;
use SqlStudio\Schema\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('product_brand', static function (Blueprint $table) {
            $table->bigIncrements('id')->startingValue(4)->comment('品牌编号');
            $table->string('name', 255)->comment('品牌名称');
            $table->timestamp('create_time', null)->useCurrent();
        });
    }
};
```

让 IDE 同时索引迁移目录与本 SDK 的 `src`。客户端固定导出 `sql-studio-sdk` 子目录；当前工程放在 `sql` 下，与 `postgresql` 并列，打开两者共同的 `sql` 父目录：

```text
sql/
├─ postgresql/
│  └─ migration/
│     └─ mall-2026-04-18-传播违法.php
└─ sql-studio-sdk/
    ├─ composer.json
    ├─ README.md
    ├─ sql-studio.code-workspace
   └─ src/
      ├─ Migrations/Migration.php
      └─ Schema/...
```

迁移转换输入仍选择 `migration`。SDK 含 `.php` 声明文件，**不要将 SDK 放进转换输入目录**，否则递归扫描可能把声明误当迁移。也不要同时索引多个 SDK 副本，以免重复类。

## VS Code + Intelephense

推荐用 VS Code 或 Cursor 打开 SDK 内的 **`sql-studio.code-workspace`**（也可双击后选择对应编辑器）。这是一个单根工作区，打开 SDK 的父目录，因此会同时包含迁移与 SDK。已内置 PHP 8.0、32 MiB 文件索引上限和备份/事务目录排除，无需修改全局设置。需要编辑器中已有可用的 PHP 语言服务；交付工作区文件不等于已经安装或验收 IDE 插件。

[Intelephense 官方说明](https://intelephense.com/docs)要求打开包含 PHP 文件的目录才能进行项目符号索引。打开共同父目录后可索引 SDK；若只打开 migration 或采用多个工作区根目录，需要显式配置 includePaths，多个根目录不会自动互相索引。

以下为可合并到当前工作区设置的例子，SDK 路径应改成实际位置。这里没有自动修改任何用户或 IDE 设置：

```json
{
  "intelephense.environment.phpVersion": "8.0.0",
  "intelephense.environment.includePaths": [
    "D:/Project/example/sql/sql-studio-sdk/src"
  ],
  "intelephense.files.maxSize": 33554432,
  "intelephense.files.exclude": [
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",
    "**/CVS/**",
    "**/.DS_Store/**",
    "**/node_modules/**",
    "**/bower_components/**",
    "**/vendor/**/{Tests,tests}/**",
    "**/.history/**",
    "**/vendor/**/vendor/**",
    "**/.migration-sql-backups/**",
    "**/.migration-sql-transactions/**",
    "**/.bak*/**"
  ]
}
```

默认 `intelephense.files.maxSize` 是 1,000,000 字节；包含大量初始化数据的单份 PHP 可能超过该值。示例设为 32 MiB，仍需确认实际文件没有超出。合并 `files.exclude` 时保留你已有的排除项；不要将正在使用的 SDK 目录排除。无需为此安装 Hyperf。

## JetBrains IDE

在具备 PHP 支持的 IDE 中打开共同父目录，或将 SDK `src` 加为 PHP Include Path，然后把 PHP 语言级别设为 8.0 或更高。`composer.json` 提供标准 PSR-4 映射 `SqlStudio\` → `src/`，用于工具识别，不要求运行 Composer。

[IntelliJ IDEA 官方 PHP 说明](https://www.jetbrains.com/help/idea/php.html)将 PHP 功能标为 Ultimate，并说明 PHP 插件非内置；不能假设仅安装 IntelliJ IDEA 或只打开 Java 工程就已有 PHP 提示。检查 IDE 产品/版本与已启用 PHP 支持后再配置。SDK 文件生成成功不代表 IDE 已安装插件或实际提示已验收。

## 方法范围与重要区别

| 类型 | 编写能力 |
| --- | --- |
| `SqlStudio\Migrations\Migration` | `up()`、可选 `data()`、`public bool $exists_drop` |
| `SqlStudio\Schema\Schema` | 建表、改表、删表、重命名、删序列 |
| `SqlStudio\Schema\Blueprint` | 字段、宏、索引、约束与表注释 |
| `SqlStudio\Schema\ColumnDefinition` | 默认值、可空、注释、自增序列、单列索引等修饰 |
| `SqlStudio\Schema\ForeignIdColumnDefinition` | 列修饰后调用 `constrained(明确表名)` |
| `SqlStudio\Schema\ForeignKeyDefinition` | 引用列、引用表、删除/更新动作 |

- 只有字段创建方法支持命名参数，参数名与声明一致。Schema、宏、索引、外键与列修饰器使用位置参数。IDE 接受某段 PHP 语法不代表转换器接受动态表达式。
- Schema 回调使用一个 Blueprint 参数的普通闭包，不支持箭头函数、`use` 捕获、动态变量、分支、循环或原始 SQL。不要把 Blueprint 或列定义保存到变量后再调用。
- 时间字段的精度省略时为 `0`，显式 `null` 时不写精度，可写整数 `0–6`。`string/char` 长度省略或 null 均为 255。
- `startingValue()` 接受正十进制整数字面量或数字字符串；大整数建议字符串，不能传 `config()` 或计算表达式。省略时根据 data() 的最大显式 ID 规划起点，显式起点保留并校验冲突。
- `uniqueIndex()` 的第二个名称参数必须给出，可以为 null。第三个条件参数可省略；显式提供时必须是非空字段 => 标量/null 映射，只支持 AND 等值与 IS NULL。排序列支持 `['create_time' => 'desc', 'id' => 'asc']`。
- `addColumn()` 的 options、`dropPrimary()` 的名称、`uniqueIndex()` 的条件均有“省略与显式空值不同”的静态规则，详见方法 PHPDoc。SDK 中的可选参数默认值仅用于表达可省略，不会在转换时执行默认参数求值。
- `data()` 仅允许 `return` 字面量数组。单表可以直接返回行列表；多表使用 `'table' => 行列表`，保持原始表键与行顺序。不能用 `array_merge`、变量或函数生成数据。
- `exists_drop=true` 仅用于单个 create，执行输出 SQL 会删除原表数据；多表应显式声明所需 DROP。
- 普通整数自增保留 PostgreSQL 原生有符号范围；显式 unsigned 仍有范围限制。自增列可使用自定义列名；反向 SQL→PHP 对序列名称及主键形式有自己的更严格校验。
- 旧文件中的 `config('key')` 是转换器支持的特殊静态写法，由客户端的显式 flat JSON 解析，仅一个参数。无框架项目的 IDE 可能提示该函数 undefined；SDK 不注册全局 config 函数，也不引入新的 Config API，以免与已有框架或 PHP 工具重名。目前已转换的七份 PHP 使用字面量表名，不受此问题影响。纯静态新文件建议直接写表名。
- 此 SDK 只声明客户端实际支持的方法，不采用 `__call` / `__callStatic` 吞掉未知方法，也不引入框架依赖。转换前仍应使用客户端预览或 validate 检查实际静态语义。

## 验收与更新

仓库测试以 PHP 8.0 语法解析六个类，将方法清单与转换器能力列表核对，并检查链式返回和关键签名。人工 IDE 验收应另外确认：三个 imports 能跳转，`$table->` 可补全，`foreignId()->nullable()->constrained()` 保留类型，悬浮显示中文说明，大文件可正常索引且无重复类。

替换 SDK 时保留一个有效副本，SDK 版本与客户端版本一起更新。旧框架命名空间是否接受由客户端兼容层决定，不需要用本 SDK 覆盖框架自身的类。
