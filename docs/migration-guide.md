# PHP ↔ PostgreSQL SQL 编写与转换指南

Migration SQL Studio 0.5.0 支持 PHP → SQL 和 SQL → PHP。正向读取 `up()` 及静态 `data()` / `exists_drop` 扩展，生成 PostgreSQL 16 或 18 SQL；反向将每份 SQL 生成为一份同名 PHP，再正向回编 SQL 比较结构和数据语义，通过后才能写出。两个方向都不启动 PHP 项目，不执行 PHP 或 SQL，不连接数据库。

PHP 中默认 schema 使用简洁名称：`Schema::create('product_brand', ...)`、`Schema::dropIfExists('product_brand')`、序列名称、外键 `on('product_brand')` 和 `data()` 的表名键均省略 `public.`。非默认 schema（如 `sales.product_brand`）保留；字段值和注释中的同名字串不会被替换。正向编译仍将无 schema 的名称解释为 `public`，实际数据库归属不变。

第 1–7 节说明 PHP 写法，第 8 节列出 MCP，第 9 节区分验证证据，第 10 节说明 SQL → PHP 的操作和保真范围。

## 1. 从一个模板开始

0.5.0 起使用 `SqlStudio` 自有命名空间；三个入口为 `SqlStudio\Migrations\Migration`、`SqlStudio\Schema\Blueprint`、`SqlStudio\Schema\Schema`。旧 Hyperf / Illuminate 名称仍可静态读取，新生成文件统一使用 SqlStudio。客户端模板页可导出中文 PHP IDE 提示包，也可通过 CLI `ide-sdk` 或 MCP `migration_export_ide_sdk` 导出。选择迁移目录之外的项目目录；SDK 只供索引，无需在迁移文件中 require/autoload。具体 IDE 配置读取 `migration://ide-sdk` 或 `php-sdk/README.md`。

内置模板是四个独立起点。选择一个另存到自己的 migrations 文件夹，再按实际需求填写字段；不要把所有模板当作同一业务模块直接运行。

| 模板 ID | 示例表 | 用途 |
| --- | --- | --- |
| `generic` | `demo_item` | 字符串、文本、整数、布尔、精确小数、JSON、nullable、default、comment 和普通索引 |
| `yudao` | `demo_audit` | `tenant_id` 与 `creator/create_time/updater/update_time/deleted` 审计字段起点 |
| `rules` | 显式配置决定 | 对照原权限规则迁移，包含 `ptype`、`v0` 至 `v5` 和时间字段 |
| `seeded` | `demo_seed` | 两行显式 ID 初始数据、布尔与时间字段，`exists_drop` 默认 `false` |

模板在 `templates/` 目录。桌面支持查看和另存，MCP 可读取模板或保存为新的 PHP。另存不覆盖已有文件；修改已有迁移前，先考虑它是否已进入成功转换基线。

`generic`、`yudao` 和 `seeded` 支持自定义简单表名：小写字母开头，后接小写字母、数字或下划线，最多 40 个字符。`rules` 保留动态配置入口，通过配置 JSON 传表名。

一个最小迁移如下：

```php
<?php

declare(strict_types=1);

use SqlStudio\Migrations\Migration;
use SqlStudio\Schema\Blueprint;
use SqlStudio\Schema\Schema;

return new class extends Migration {
    /** 创建示例表。 */
    public function up(): void
    {
        Schema::create('demo_note', static function (Blueprint $table) {
            $table->comment('示例记录');
            $table->bigIncrements('id')->comment('主键编号');
            $table->string('name', 128)->comment('名称');
            $table->text('remark')->nullable()->comment('备注');
            $table->integer('sort')->default(0)->comment('排序值');
            $table->index('name');
        });
    }
};
```

使用内置完整模板时也会看到 `down()`。该方法用于 PHP 框架自己的回退流程，本工具不输出或执行它。正常 `down()` 不产生未转换警告；这不表示工具生成了回退 SQL。

## 2. PHP → SQL 的目录、版本和预检测

1. 选择输入 migrations 目录和输出 SQL 目录，二者必须分开且不能互相嵌套。工具递归查找 PHP，按文件名顺序处理，并保留相对子目录。
2. 选择 PostgreSQL `16` 或 `18`。核心接口要求显式目标版本，不能省略后自动猜测。
3. 填写需要的配置 JSON；纯字面量表名可使用 `{}`。
4. 保持“预检测 PHP 和 SQL 是否改变”开启，先预览。检查每个文件的 SQL、状态、警告和错误。
5. 预览通过后转换。只有整个批次解析和预检通过，工具才开始写出。

文件名按以下规则映射：

| PHP 相对路径 | SQL 相对路径 |
| --- | --- |
| `2020_07_22_213202_create_demo_table.php` | `2020_07_22_213202_create_demo_table.sql` |
| `migrations.2020_07_22_213202_create_demo_table.php` | `2020_07_22_213202_create_demo_table.sql` |
| `module/2020_07_22_213202_create_demo_table.php` | `module/2020_07_22_213202_create_demo_table.sql` |

只去掉文件名开头一次 `migrations.` 和结尾 `.php`。两个源文件映射到同一个输出文件，或在 Windows 上仅大小写不同，都会中断。

### “一致”指与上次成功结果一致

PHP 和 SQL 内容本来就不同，工具不直接拿二者互相比较。每次成功转换会记录输入 PHP 与输出 SQL 各自的 SHA-256，以及版本、配置和转换器信息。

开启预检测时：

- 已记录 PHP 或 SQL 被修改、删除：整个批次中断，定位具体文件。
- 已记录文件保持一致，新增 PHP：原文件继续保留，新文件可以追加。
- 第一次碰到未记录的同名 SQL：只有它与本次生成内容完全一致才接纳；否则中断。
- 目标 PG 版本、配置或转换器版本变化：不能把新结果当旧基线继续，需明确重新生成。

明确选择重新生成并替换原输出时，可关闭预检测后重新预览，再转换。仅要求修改 PHP 不等于已决定替换旧 SQL。工具会先备份被替换的文件及旧清单，再写新结果；输出中不属于本次生成的 SQL 不会自动删除。关闭预检测是有意重新生成的选择，不是处理未知错误的快捷方式。保留备份和诊断，再核对新旧差异。

### 从旧版本升级到 0.4.0

转换器版本变化属于基线变化，即使源文件没改，旧版输出清单也会触发保护。推荐选择新的输出目录，保留旧结果进行比较。若明确需要替换原输出，可关闭预检测后重新预览，再转换；工具先保留备份。不要删除清单来跳过检查。

0.4.0 增加双向转换以及为保留源 SQL 所需的序列、索引、时间精度、多表数据等声明。输出目录升级不会识别或升级数据库里的旧结构和数据，也不会替换已有序列或约束；是否执行新脚本仍需按实际目标库独立判断。

## 3. 动态表名使用显式配置

原 rules 的表名表达式为：

```php
Schema::create(config('permission.database.table'), static function (Blueprint $table) {
    $table->bigIncrements('id');
});
```

在界面或 API 中提供：

```json
{"permission.database.table":"rules"}
```

这会把指定配置表达式解析成 `rules`。工具不加载 `config/autoload/*.php`，不读取环境变量，也不运行项目来得到配置。

早期参考 demo 使用过 `config('permission')`；当前用户文件已改成字面量表名 `permission`，无需配置映射。若遇到旧文件中的 `config('permission')`，仍须为那个完整键提供经过确认的字符串映射，或修改自己的迁移为明确表名。不能从文件名或注释猜表名；缺值或值不是字符串时应解决诊断。

## 4. 支持范围与错误边界

支持具名迁移类和匿名迁移类中的声明式 `up()`、受支持的 `Schema` 调用、`Blueprint` 闭包、常量参数、数组、链式字段修饰，以及显式 `config()` 映射和下述 `data()` / `exists_drop` 静态扩展。当前版本的准确方法列表由 `migration_capabilities` 提供。

常用能力包括建表、为已有表添加字段和索引、字段和表注释、主键/唯一/普通索引、外键声明、常见类型及时间/审计宏。已有表的 `Schema::table()` 输出依赖数据库当前结构，静态转换不能证明目标列、表或索引真实存在。

0.4.0 增加 `startingValue`、`sequenceType`、`uniqueIndex`、`indexComment`、序列 DROP 和多表数据等本工具的声明式扩展。生成的 PHP 供本工具静态读取；不能据此认定其他 Hyperf 项目运行时已注册相同扩展方法，更不能直接运行生成文件来替代本工具转换。

用户在 `up()` 中明确写出的受支持删除/重命名，以及符合约定的 `exists_drop=true`，会生成相应 SQL 并显示危险操作警告。转换不会自动执行这些 SQL。新建模板不默认删除同名表。

以下情形应中断并显示诊断：

- 动态流程分支、循环、任意函数调用、外部文件访问和表达式执行。
- 未支持的字段方法或修饰，例如依赖 MySQL 的布局/字符集语义；不识别就报错，不默默忽略。
- 重复列、重复主键或非法标识符。
- 原始 SQL 注入、无法推导的数据库表达式，以及需要未声明扩展的空间类型。

原 PHP 说明是“方法速查”，同一张表列了多个不同 `id`、多个 `votes` 和其他重名列。这些是备选写法，不能整文件复制成一个有效迁移。内置模板已拆成没有重复列的独立示例。

### `data()`：声明初始数据

`data()` 是本工具读取的模板扩展。它必须是唯一的 public、非 static、无参数方法，返回类型可省略或声明为 `array`；方法体只包含一个 `return`。可返回无键的单表行列表，或以表名为键的多表行映射。每行使用实际列名的字符串字面量为键，值为字符串、数值、布尔或 `null`。工具按建表列定义检查数据；JSON/JSONB 列值用 JSON 字符串，不用嵌套 PHP 数组。

例如，下面的方法可放入已有 `id/name/enabled` 列的迁移类：

```php
public function data(): array
{
    return [
        ['id' => 1, 'name' => '示例一', 'enabled' => true],
        ['id' => 2, 'name' => '示例二', 'enabled' => false],
    ];
}
```

上面的无键行列表沿用旧规则：只绑定 `up()` 唯一的 `Schema::create`，多次 create 或混合其他 Schema 操作时拒绝推断目标。

多表文件改用明确表名映射，例如在 `up()` 已声明对应表和字段后：

```php
/** 按表名返回示例初始数据，先父表再子表。 */
public function data(): array
{
    return [
        'demo_group' => [
            ['id' => 1, 'name' => '示例组'],
        ],
        'demo_item' => [
            ['id' => 10, 'group_id' => 1, 'name' => '示例项'],
        ],
    ];
}
```

映射键必须指向本文件恰好创建一次且最终仍存在的表。`demo_item` 和 `public.demo_item` 视为同一目标，重复声明会报错。空表可不出现在映射中。映射模式允许先按来源删除表/序列后再建表，但不允许本文件存在 `Schema::table` 或 rename；目标不能已经删除或更名。`return [];` 仍采用无键单表模式，不作为绕过目标校验的多表声明。

多表模式先输出全部 DDL，再按 data 映射键顺序和各表行顺序逐条 INSERT。工具保留 PHP AST 中的键顺序，不自动对表或行排序；有外键时应由声明体现父表在前的顺序。

动态日期函数、变量、循环、条件、外部数据读取、任意函数调用、原始 SQL 表达式都不求值。重复字段键、未知字段、缺少必填字段或值不符合当前支持的列校验时，应按错误文件与行号修正；不能删掉问题行后声称完整转换成功。

`return [];` 是合法的无初始数据声明，不生成 INSERT。省略列与显式 `null` 不同：前者按列默认值、自增或可空规则处理，后者只适用于可空列。不同种子行可有不同的可省略字段；必填且无默认的字段仍必须提供。

列值校验覆盖数字范围与小数精度、nullable、字符串长度、enum 允许值，以及受支持的 JSON、规范 UUID、ISO 日期时间、IP/MAC 和十六进制 bytea 字符串格式。日期和特殊类型使用工具支持的确定性格式，不把 PostgreSQL 可能接受的任意文本输入都当作本工具支持范围。静态检查不能验证目标库已存在的数据、外键目标、权限或业务规则。

每行数据按原数组顺序生成一条 INSERT，不再合并成多行 VALUES。省略字段继续使用列默认值，不重新排序种子行。工具不执行 PHP，也不向数据库插入。种子数据与正式业务写入不同：模板不能推断真实租户、用户、权限或已有数据，示例 ID 不代表这些记录在目标系统已经存在。

逐行执行会影响自引用外键：被引用的值必须来自此前已经插入的行，或本次 INSERT 的当前行。子行在前、父行在后的前向引用，以及两行互相引用会被拒绝；请在业务关系允许时自行调整 PHP 中的行顺序，工具不自动重排。复合外键有任一成员为 `null` 时按默认 `MATCH SIMPLE` 语义跳过引用匹配。只能可靠静态比较的类型纳入此检查；不支持的类型明确诊断，不猜值是否等价。跨表引用仍须结合批次诊断和实际数据库状态核实。

### `exists_drop`：明确生成重建 SQL

迁移类可声明唯一的 public、非 static 属性，显式类型为 `bool`，初始值必须是布尔字面量：

```php
public bool $exists_drop = false;
```

省略属性或保持 `false` 时，不额外生成 DROP；脚本仍执行普通 CREATE TABLE，若目标表已存在会报错，不会变成向旧表追加种子数据。只有你明确要重建该表时才改为 `true`。启用后要求 `up()` 仅有一个 `Schema::create`，在创建对象前生成：

- 对声明表的 `DROP TABLE IF EXISTS`。
- 对本次转换器将创建的序列的 `DROP SEQUENCE IF EXISTS`；没有自增序列时不凭空添加序列 DROP。
- 可见的重建警告；不生成 `CASCADE`，不猜注释或其他表引用中的对象名。

表被删后再建，实际执行会丢失同名表的既有数据；原外部依赖也可能让 DROP 失败。转换器知道自己准备创建哪些序列，但不能核实旧数据库里同名序列是否属于该表。生成脚本不会实际删表，也不代表已确认目标库可安全重建。新 `seeded` 模板默认 `false`。

`exists_drop` 决定 SQL 内容，`guard` 决定本地输出文件的变更保护，二者互不替代。关闭 guard 不会启用重建，启用 exists_drop 也不会跳过文件预检测。

反向生成多表迁移时，已有 DROP 显式写入 `up()`。`Schema::dropSequenceIfExists('demo_item_seq')` 和 `Schema::dropSequence('demo_item_seq')` 分别保留有/无 IF EXISTS 的序列删除，允许带 schema 的名称，不添加 CASCADE。不会为了方便把原删除顺序替换成 `exists_drop=true`；源没有 DROP 时也不增加它。

## 5. PostgreSQL 类型和修饰映射

以下描述的是本工具当前采用的公共 PG16/PG18 写法。详细参数限制和诊断以实际能力接口及预览为准。

| PHP 方法 | PostgreSQL 输出或语义 |
| --- | --- |
| `bigInteger` / `integer` / `smallInteger` | `int8` / `int4` / `int2` |
| `mediumInteger` / `tinyInteger` | 按可容纳范围映射到 `int4` / `int2`，保留对应普通字段的范围校验 |
| `id` / `bigIncrements` | `int8` 自增主键，显式序列和 `nextval()` |
| `increments` / `mediumIncrements` | `int4` 自增主键，使用 PG 完整有符号范围 |
| `smallIncrements` / `tinyIncrements` | `int2` 自增主键，使用 PG 完整有符号范围 |
| `string('name', 128)` / `char('code', 2)` | `varchar(128)` / `char(2)` |
| `text` / `mediumText` / `longText` | `text`，不沿用 MySQL 容量分档 |
| `decimal('ratio', 6, 3)` | 精确十进制 `numeric(6,3)`，总共 6 位，其中 3 位小数 |
| `float` / `double` | `double precision`；需要固定小数精度用 `decimal` |
| `boolean` | 独立 `boolean` 类型，默认值使用 `TRUE` / `FALSE` |
| `date` / `time` / `timestamp` / `dateTime` | `date` / `time` / `timestamp` / `timestamp` |
| `timeTz` / `timestampTz` / `dateTimeTz` | 对应带时区类型 |
| `json` / `jsonb` / `binary` | `json` / `jsonb` / `bytea` |
| `uuid` / `ipAddress` / `macAddress` | `uuid` / `inet` / `macaddr` |
| `enum` | 字符类型及允许值 `CHECK` |
| `nullable()` | 允许 `NULL`；默认的普通字段通常为 `NOT NULL` |
| `default(...)` | 插入省略字段时的默认值，不替代业务校验 |
| `comment(...)` | `COMMENT ON TABLE` / `COMMENT ON COLUMN`，会进入数据库元数据 |

`int8/int4/int2` 分别与 `bigint/integer/smallint` 等价，SQL 输出统一使用这三个整数别名，PHP 方法名称无需改变。`public` schema 限定、正式 `COMMENT ON` 注释、序列 `OWNED BY` 和 `BEGIN/COMMIT` 继续保留。

普通自增方法按 PG 原生有符号语义处理，不隐含 unsigned。它们不再自动生成 `CHECK (id >= 0)` 或 unsigned 范围警告；`mediumIncrements` / `tinyIncrements` 也不额外套用 MySQL 的 24 位 / 8 位范围。允许手动给出对应 PG 类型范围内的负 ID，自动序列起点仍至少为 1。若业务确实要求非负值，请在 PHP 明确声明受支持的 unsigned 语义。

显式 `unsignedBigInteger` 或 `->unsigned()` 仍需核对。PG 没有 MySQL 式无符号整数；工具对较小显式无符号类型按需要扩大存储类型并生成范围 `CHECK`，大无符号整数使用非负 `int8` 并显示范围缩减警告。需要完整 `0` 至 `18446744073709551615` 范围时，不能只忽略警告，应重新设计数值类型和应用映射；Java `Long` 也不能保存该完整范围。

在本工具中选择 PG18，仍使用兼容 PG16/PG18 的公共语法。它不自动启用 PG18 专属特性，也不证明所有第三方扩展或项目运行时已兼容 PG18。

### 普通索引、独立唯一索引和索引注释

普通列列表保持原写法；需要方向时用结构化映射，值只接受 `asc` / `desc`：

```php
$table->index(['user_id' => 'asc', 'start_time' => 'desc'], 'idx_demo_user_time');
$table->uniqueIndex(['tenant_id', 'code'], 'uk_demo_tenant_code');
$table->uniqueIndex(['tenant_id'], 'uk_demo_active', ['deleted' => 0]);
$table->indexComment('uk_demo_active', '每个机构仅一条未删除记录');
```

`uniqueIndex(columns, name, predicate?)` 生成独立 `CREATE UNIQUE INDEX`，不同于 `unique()` 生成的 UNIQUE 约束，后续对象删除方式也不同。索引名必须明确；条件省略表示全量唯一，给出条件时使用非空字段到标量/null 的映射，多条件按 AND 组合，null 输出 IS NULL。`columns` 也支持方向映射。任意原始 WHERE SQL、表达式索引或无法表示的索引选项会拒绝。

`indexComment(indexName, comment)` 生成正式 `COMMENT ON INDEX`。表/字段的 `comment()` 不会代替索引注释。部分唯一索引只约束满足条件的数据，不能当作完整表上外键引用所需的全量唯一键。

## 6. 序列和应用主键契约

自增 `id` 默认使用 `public.<表名>_seq`，设置 `DEFAULT nextval(...)` 并将序列 `OWNED BY` 对应列。其他名字的自增列使用 `<表名>_<列名>_seq`。schema、序列名及应用引用要一致。

普通默认主键输出 `PRIMARY KEY (...)`，由 PostgreSQL 按 `<表名>_pkey` 规则自动命名；迁移通过 `primary(..., '自定义名称')` 显式提供名称时，输出保留 `CONSTRAINT "自定义名称" PRIMARY KEY (...)`。默认名不再是旧版 `<表名>_<列名>_primary`；引用旧约束名的后续脚本需单独核对，工具不会重命名现库约束。

反向遇到命名自增主键时，可在 `bigIncrements('id')` 后使用 `$table->primary(['id'], 'pk_demo_id')` 为同一主键保留名称。这个组合不是第二个主键；其它冲突或不同列主键仍拒绝。

同一建表中，默认主键字段又重复声明相同顺序的 UNIQUE 时，会报 `AMBIGUOUS_PRIMARY_NAME`；请去掉冗余 UNIQUE，或明确主键名称。长表名、同名对象会影响 PostgreSQL 自动命名；工具仅跟踪当前迁移中可见的对象，现库约束名称仍需独立核对。

例如 `demo_audit.id` 的默认序列是 `public.demo_audit_seq`。如果 Java 实体使用 `@KeySequence("demo_audit_seq")`，应同时核对数据源 schema/search_path；不要未经确认把这个契约改成 identity。

未指定起点时，创建新序列仍使用 `START WITH max(1, 最大显式 ID + 1)`，不输出 `setval`。没有显式 ID、`data()` 为空或没有 `data()` 时，起点为 1；全部显式 ID 小于等于 0 时，起点也为 1。

要精确保留源 SQL 的 START，显式使用 `$table->bigIncrements('id')->startingValue(1949)`。参数是正十进制整数字面量或对应字符串，不能通过 config 或动态表达式求值。显式起点不与 seedmax+1 自动取最大值；已声明 ID 落在序列未来可取号范围内时会报冲突，该范围从显式起点到列与序列的较小上界。若本批自动取号后没有后续空间，也会报耗尽，要求处理源契约，不会默默改变起点。

序列类型缺省跟随自增列。源中列为 int4 而序列为 int8 时，可用 `$table->increments('id')->sequenceType('int8')->startingValue(100)` 精确保留差异。`sequenceType` 只接受 `int8/int4/int2`，它改变序列类型而不扩大列本身可保存的 ID 范围。

缺省起点时，如果新表只有两行，一行给出 `id=10`、另一行省略 id，序列 `START WITH 11`，省略的 ID 取得 11，后续默认取号为 12。内置 `seeded` 的显式 ID 为 1 和 2，所以序列 `START WITH 3`；两行各自 INSERT 不会消费序列，下次默认取号为 3。即使省略 ID 的行排在显式 ID 前，起点也已经根据整个 data 数组确定，不会与后面的显式值冲突。

大整数按精确值计算起点，不通过近似小数丢失 ID 精度。起点与本批自动取号数量必须处于对应类型的序列范围内，并为下一次 `nextval` 留出空间；耗尽时会报错，不能隐藏该错误或重置序列绕过。

这些语句只针对本脚本定义的表和序列，不连接现有数据库读取高水位。实际执行、新增其他数据或迁移到已有库时，仍需独立核对数据库中的真实状态；不能以输出成功推断现库的序列已经同步。

## 7. 时间、审计和租户字段

`timestamps()`、`nullableTimestamps()` 默认展开成可空的 `created_at` 和 `updated_at`；`timestampsTz()` 使用带时区类型。工具以参考项目 Hyperf 3.1 的行为为依据，默认精度为 0。

反向保留未限定精度的源时间列时，显式传 `null`，例如 `timestamp('create_time', null)`、`time('open_time', null)`，输出不带 `(0)`。省略参数仍输出默认精度 0；明确数字精度继续按 0–6 校验。无精度括号不表示无限小数位，值仍按 PostgreSQL 可表示精度检查，避免把源的微秒能力缩成整秒。

`useCurrent()` 生成插入默认时间，只适用于时间类型。它不会在每次 UPDATE 时自动刷新 `updated_at` 或 `update_time`。由 ORM、应用更新语句或另行设计的触发器维护更新时间；本工具不隐式创建触发器。

`authorBy()` 对照本地 MineAdmin 宏展开为 `created_by` 和 `updated_by`，输出类型 `int8`、默认 `0`，附中文字段注释。它与芋道的字符串 `creator/updater` 不同，不要互换。

`yudao` 模板的 PHP 字段定义不变，输出 `deleted int2 DEFAULT 0`，与参考项目的 smallint 语义等价，由应用按 0/1 维护；没有替换成 boolean 或 `deleted_at`。`tenant_id` 输出 `int8` 且无默认值，要求调用方提供经过授权的机构编号。这个字段本身不会自动保证隔离。

这个精简模板只涵盖审计结构。业务 `CHECK`、部分索引和业务列不自动附加；例如当前 `deleted` 列并没有自动生成 `CHECK (deleted IN (0,1))`，`tenant_id` 也没有自动生成 `CHECK (tenant_id > 0)`。0.4.0 的部分唯一索引须用 `uniqueIndex` 明确声明，任意 CHECK 仍需核对工具能力，不能把字段注释当约束。

## 8. MCP、技能和 Agent

MCP 通过 stdio 提供以下入口；参数、必填字段及读写提示应从实际 `tools/list` 获取。

| 工具 | 作用 |
| --- | --- |
| `migration_capabilities` | 查询当前支持范围、版本和限制 |
| `migration_template` | 读取模板内容 |
| `migration_validate` | 静态校验 PHP 并取得 SQL 或诊断 |
| `migration_preview` | 预览目录批次并进行预检测，不写 SQL |
| `migration_convert` | 全批次通过后写出 SQL 和成功基线 |
| `migration_write_template` | 将模板保存为新 PHP，不覆盖同名文件 |
| `migration_reverse_validate` | 读取 SQL 文本、生成 PHP 并做往返语义比较，不写文件 |
| `migration_reverse_preview` | 只读预览所选 SQL 批次和反向文件基线 |
| `migration_reverse_convert` | 全批通过后写出同名 PHP 和反向清单 |

另有 `migration_export_ide_sdk({outputDir, inputDir})`，在项目 outputDir 下导出不覆盖修改的 IDE 声明包；inputDir 用于排除迁移扫描范围。共 10 个工具。资源 `migration://guide` 对应本指南；`migration://templates` 提供模板目录；`migration://ide-sdk` 提供 IDE 接入说明。提示词仍是面向编写的 `author_migration` 与面向审查的 `review_migration`。AI 先读取能力再选择转换方向，预览并修复诊断后在授权范围生成；默认保持 guard 开启。

反向 validate 参数为 `{source, sourceName, targetVersion}`；批次参数为 `{sourceFiles, outputDir, targetVersion, guard}`，`sourceFiles` 是 SQL 绝对路径数组。成功返回的 `verification.semanticEqual` 表示受支持语义一致，`databaseExecuted` 为 false；还应查看 `summary` 中表、列、序列、索引、外键、数据行和 DROP 的统计，不能只看 PHP 文本存在。

`skills/migration-sql/SKILL.md` 是随软件交付的可安装技能，`agents/migration-author.md` 是配套 Agent 提示词。它们存在于工程中不等于已安装到 Codex 或其他客户端，更不等于客户端当前已启用；需按客户端流程安装并检查发现结果。工具本身不为用户更改全局 AI 配置。

## 9. 判断结果到了哪一步

- **静态转换成功**：当前 PHP 在支持子集内，工具生成了 SQL。
- **预检测通过**：源文件、输出及转换设置符合已保存基线。
- **文件写出成功**：转换返回成功并报告实际输出路径。
- **真实数据库验证**：在明确授权的 PG16 或 PG18 测试数据库中实际执行，再核对结构、约束、注释和应用行为。

前三项不会自动证明第四项。本工具不提供数据库执行入口；没有实际导入时，应在交付中明确写“未进行 PostgreSQL 实际导入”。

## 10. SQL → PHP 与往返语义校验

### 选择源文件和输出目录

在桌面选择「SQL → PHP」，可多选 `.sql`，也可每行输入一个绝对路径；再选择 PHP 输出目录、PG16/PG18 和 guard。反向输入是明确的文件列表，不扫描整个 SQL 目录。源文件须为有效 UTF-8，单份不超过 32 MiB，批次总计不超过 128 MiB。输出目录可以是源 SQL 所在目录下的 `migration` 子目录，因为只读取已经选中的 SQL，不把生成 PHP 再当作 SQL 输入。

预览会显示每个文件的 PHP、统计、警告、错误和往返结果。生成前必须全批解析、语义比较和文件预检测通过；其中一个失败就处理错误后重试，不能只写剩余成功文件并声称整个批次已完成。

每个 SQL 只对应一个 PHP：去掉最后的 `.sql` 再加 `.php`，保留中文原名。不按表拆分，不额外增加 reset 文件。来自不同路径但输出同名的 SQL、Windows 大小写冲突或重复选择应先解决诊断。

本次用户指定源目录 `W:/Project/cxszn_xyyx/cxszn_xyyx_service/sql/postgresql`，输出目录为其 `migration` 子目录。验收映射为：

| 源 SQL | 输出 PHP |
| --- | --- |
| `mall-2026-04-18-传播违法.sql` | `mall-2026-04-18-传播违法.php` |
| `go-view.sql` | `go-view.php` |
| `im-2026-06-20-传播违法.sql` | `im-2026-06-20-传播违法.php` |
| `member-2026-05-30-传播违法.sql` | `member-2026-05-30-传播违法.php` |
| `pay-2026-04-18-传播违法.sql` | `pay-2026-04-18-传播违法.php` |
| `quartz.sql` | `quartz.php` |
| `ruoyi-vue-pro.sql` | `ruoyi-vue-pro.php` |

源审计基准为 151 张表、2316 列、140 序列、159 个独立索引、5 个外键、8981 条初始数据和 193 条 DROP。它用于核对这批文件的覆盖范围，不代表任意 PostgreSQL dump 都可转换。实际生成及验收状态以 0.4.0 验证记录为准。

### 反向如何保留来源

| 源 SQL 特征 | PHP 表达与核对重点 |
| --- | --- |
| 显式序列 START | 自增列 `startingValue(...)`，即使空表也保留较高起点，不按种子最大值重置 |
| 序列类型与列类型不同 | 自增列 `sequenceType(...)`，同时保留列类型和序列范围 |
| `timestamp` / `time` 无精度括号 | 对应方法显式传 `null`，不缩为 `(0)` |
| 命名主键 | `primary([...], '原名称')`，保留源名称 |
| `CREATE UNIQUE INDEX` | `uniqueIndex`，不改成 UNIQUE 约束 |
| 部分唯一索引、ASC/DESC | 结构化等值谓词与列方向映射，保持对象种类和方向 |
| `COMMENT ON INDEX` | `indexComment`，与表和列注释分别保留 |
| `DROP TABLE` / `DROP SEQUENCE` | 显式写入 up，保留 DROP 之间的顺序与 IF EXISTS 标志，不启用 exists_drop 重排 |
| 多表字面量 INSERT | 按表名组织 data，保留各表行和值的顺序 |
| 静态 `decode(hex, 'hex')` | 校验 hex 后转为 PHP bytea 十六进制字符串，不执行函数 |

这批源中有 80 个起点高于 seedmax+1 的序列、2 个部分唯一索引、3 个 DESC 索引、48 个命名主键、8 条索引注释，以及 2 个 int4 自增列配 int8 序列。Quartz 有 22 个静态 decode 值和 5 个外键，源 DROP 顺序需要保留。mall 没有 DROP、没有初始数据，因此对应 PHP 不应增加这两项。

生成 PHP 的 `up()`、`data()` 带中文用途注释。SQL 脚本中的自然语言行注释与原排版不逐字迁移；数据库对象上的正式 COMMENT 是比较的一部分。

### 比较的内容与规范化

工具按目标 PG16 或 PG18 解析 SQL AST，生成 PHP，使用正向转换器重新生成 SQL，再由同版本解析器解析和比较。PG16 使用随软件交付的 `libpg-query-pg16`（alias `libpg-query@16.7.3`），PG18 使用 `pgsql-parser@18.2.8`。用户不需要另装 Python、PHP 或数据库，也没有发生 SQL 导入。

比较覆盖表和有序列定义、类型、NULL/default、主键/唯一/外键、序列起点/类型/归属、索引方向/谓词、正式注释、DROP 顺序/标志，以及逐表数据行和值。`verification.semanticEqual: true` 表示这一支持范围内比较一致，报告同时包含实际 `parserVersion`、计数和 `databaseExecuted: false`。

空白、等价类型别名、缺省 public 限定、COMMENT 排列及事务包裹会规范化。DDL 可按依赖重组，全部 DDL 先于 data；原 ALTER COLUMN DEFAULT、命名主键等也可合并进表声明。原 DROP 之间的顺序保留，但不声称所有语句与原文保持相同位置或执行事务边界。往返校验不是逐字文本比较，也不是现有库的无损升级证明。

精确支持范围读取 `migration_capabilities.reverse`。ALTER TABLE 的后置约束目前只支持 ADD PRIMARY KEY，以及 ALTER COLUMN SET DEFAULT；后置 FOREIGN KEY/UNIQUE/CHECK 拒绝，CREATE TABLE 内的受支持外键仍可转换。除 nextval 内建 regclass 引用外，其它显式 CAST 当前拒绝。自增列须为整数 id 单字段主键，使用归属本表的 table_seq 整数序列。源 INSERT 按表连续排列；先写表 A、再 B、又回写 A 的交错模式会拒绝，不通过重新分组假装保留了执行顺序。

未知语法、动态查询、函数/触发器定义、CHECK、表达式索引、自定义类型及无法表达的选项都会中断；静态 decode 是针对确定字面量模式的解析规则，不是任意函数执行入口。反向不会把无法表示的 SQL 塞进 raw SQL 来绕过检查。

### 反向预检测与 CLI

`.migration-php-manifest.json` 记录所选 SQL、对应 PHP 的双哈希、目标版本和转换器版本。开启 guard 时，已记录源或输出的修改、删除、版本变化都会中断；还须继续选择全部已登记 SQL，遗漏选择会返回 SOURCE_NOT_SELECTED。新增文件可追加。未登记的已有同名 PHP 只有与本次生成内容一致才能接纳。明确要求替换旧输出时，先按相同选项预览，再由工具备份后生成；不要手动清理清单绕过错误。备份路径以批次结果为准。

CLI 的路径清单文件例如：

```json
["D:\\sql\\quartz.sql", "D:\\sql\\go-view.sql"]
```

```powershell
node src/cli.js reverse-validate --file "D:\sql\quartz.sql" --pg-version 16 --json
node src/cli.js reverse-preview --files "D:\sql-files.json" --output "D:\migration" --pg-version 16 --json
node src/cli.js reverse-convert --files "D:\sql-files.json" --output "D:\migration" --pg-version 16 --json
```

`--files` 接收 JSON 文件路径；`--no-guard` 仅用于已明确选择备份后重新生成的场景。两个方向都会遵守本地输出范围，均不更新真实业务数据库。
