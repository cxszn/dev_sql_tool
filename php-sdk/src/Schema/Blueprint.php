<?php

declare(strict_types=1);

namespace SqlStudio\Schema;

/**
 * 声明一张表的列、索引、约束和注释；客户端静态解析，不执行 PHP。
 * 仅字段创建方法支持命名参数，名称必须与声明一致；宏、索引和结构操作仅位置参数。
 * 参数必须是受支持的字面量；传统 config() 仅通过客户端显式 JSON 映射解析。
 * 普通列返回 ColumnDefinition，foreignId 保留外键链，返回 void 的方法不允许继续链式调用。
 */
final class Blueprint
{
    /**
     * 创建 int8 自增主键，默认列名 id；采用 PostgreSQL 有符号完整范围。
     */
    public function id(string $column = 'id'): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 int8 自增主键，采用 PostgreSQL 原生有符号范围，允许自定义列名。
     */
    public function bigIncrements(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 int4 自增主键，采用 PostgreSQL 原生有符号范围，允许自定义列名。
     */
    public function increments(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 int4 自增主键；原生自增不保留 MySQL 24 位限制，允许自定义列名。
     */
    public function mediumIncrements(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 int2 自增主键，采用 PostgreSQL 原生有符号范围，允许自定义列名。
     */
    public function smallIncrements(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 int2 自增主键；原生自增不保留 MySQL 8 位限制，允许自定义列名。
     */
    public function tinyIncrements(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 64 位 整数字段，基础类型 int8。
     * 显式 unsigned 按范围扩展 PostgreSQL 类型或附加 CHECK；未启用 unsigned 的自增采用 int8 完整范围。
     */
    public function bigInteger(string $column, bool $autoIncrement = false, bool $unsigned = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建非负 64 位 整数字段；根据范围扩展 PostgreSQL 类型或附加 CHECK。
     * unsignedBigInteger 最大值仍为 9223372036854775807，转换时提示范围差异。
     */
    public function unsignedBigInteger(string $column, bool $autoIncrement = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 32 位 整数字段，基础类型 int4。
     * 显式 unsigned 按范围扩展 PostgreSQL 类型或附加 CHECK；未启用 unsigned 的自增采用 int4 完整范围。
     */
    public function integer(string $column, bool $autoIncrement = false, bool $unsigned = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建非负 32 位 整数字段；根据范围扩展 PostgreSQL 类型或附加 CHECK。
     * unsignedBigInteger 最大值仍为 9223372036854775807，转换时提示范围差异。
     */
    public function unsignedInteger(string $column, bool $autoIncrement = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 限制为 24 位 整数字段，基础类型 int4。
     * 显式 unsigned 按范围扩展 PostgreSQL 类型或附加 CHECK；未启用 unsigned 的自增采用 int4 完整范围。
     */
    public function mediumInteger(string $column, bool $autoIncrement = false, bool $unsigned = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建非负 限制为 24 位 整数字段；根据范围扩展 PostgreSQL 类型或附加 CHECK。
     * unsignedBigInteger 最大值仍为 9223372036854775807，转换时提示范围差异。
     */
    public function unsignedMediumInteger(string $column, bool $autoIncrement = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 16 位 整数字段，基础类型 int2。
     * 显式 unsigned 按范围扩展 PostgreSQL 类型或附加 CHECK；未启用 unsigned 的自增采用 int2 完整范围。
     */
    public function smallInteger(string $column, bool $autoIncrement = false, bool $unsigned = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建非负 16 位 整数字段；根据范围扩展 PostgreSQL 类型或附加 CHECK。
     * unsignedBigInteger 最大值仍为 9223372036854775807，转换时提示范围差异。
     */
    public function unsignedSmallInteger(string $column, bool $autoIncrement = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 限制为 8 位 整数字段，基础类型 int2。
     * 显式 unsigned 按范围扩展 PostgreSQL 类型或附加 CHECK；未启用 unsigned 的自增采用 int2 完整范围。
     */
    public function tinyInteger(string $column, bool $autoIncrement = false, bool $unsigned = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建非负 限制为 8 位 整数字段；根据范围扩展 PostgreSQL 类型或附加 CHECK。
     * unsignedBigInteger 最大值仍为 9223372036854775807，转换时提示范围差异。
     */
    public function unsignedTinyInteger(string $column, bool $autoIncrement = false): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建非负 int8 外键字段；需 constrained() 或显式 foreign() 才声明外键。
     * 先 nullable() 等字段修饰，再 constrained(明确表名) 和外键动作。
     */
    public function foreignId(string $column): ForeignIdColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 定长 char 字段；省略长度或显式 null 均为 255。
     * 长度范围为 1–10485760，按字符而非字节计算。
     */
    public function char(string $column, ?int $length = 255): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 变长 varchar 字段；省略长度或显式 null 均为 255。
     * 长度范围为 1–10485760，按字符而非字节计算。
     */
    public function string(string $column, ?int $length = 255): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 text 字段：文本。
     */
    public function text(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 text 字段：文本，不设置 MySQL mediumText 长度上限。
     */
    public function mediumText(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 text 字段：文本，不设置 MySQL longText 长度上限。
     */
    public function longText(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 real 字段：单精度浮点数。
     */
    public function real(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 boolean 字段：布尔值。
     */
    public function boolean(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 date 字段：日期。
     */
    public function date(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 int4 字段：年份整数，不施加 MySQL 年份限制。
     */
    public function year(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 json 字段：JSON 原文本。
     */
    public function json(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 jsonb 字段：二进制 JSON。
     */
    public function jsonb(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 bytea 字段：二进制数据；初始化字面量使用十六进制 bytea 字符串。
     */
    public function binary(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 uuid 字段：UUID。
     */
    public function uuid(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 inet 字段：IP 地址。
     */
    public function ipAddress(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 macaddr 字段：MAC 地址。
     */
    public function macAddress(string $column): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 numeric(total, places)；默认精度 8、小数位 2。
     * total 为 1–1000，places 为 0–total；字面量超出范围或需要舍入时拒绝转换。
     */
    public function decimal(string $column, int $total = 8, int $places = 2): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 numeric(total, places)，附加非负限制；默认精度 8、小数位 2。
     * total 为 1–1000，places 为 0–total；字面量超出范围或需要舍入时拒绝转换。
     */
    public function unsignedDecimal(string $column, int $total = 8, int $places = 2): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 double precision；省略 total/places，不声明精度。
     * 若显式给出精度参数，将提示 PostgreSQL 不采用该参数；可用值为 null 或 0–1000。
     */
    public function float(string $column, ?int $total = null, ?int $places = null): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 double precision；省略 total/places，不声明精度。
     * 若显式给出精度参数，将提示 PostgreSQL 不采用该参数；可用值为 null 或 0–1000。
     */
    public function double(string $column, ?int $total = null, ?int $places = null): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 timestamp 字段。
     * 省略 precision 为 0；显式 null 输出不带精度，显式整数只能为 0–6。
     */
    public function timestamp(string $column, ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 timestamp with time zone 字段。
     * 省略 precision 为 0；显式 null 输出不带精度，显式整数只能为 0–6。
     */
    public function timestampTz(string $column, ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 timestamp 字段。
     * 省略 precision 为 0；显式 null 输出不带精度，显式整数只能为 0–6。
     */
    public function dateTime(string $column, ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 timestamp with time zone 字段。
     * 省略 precision 为 0；显式 null 输出不带精度，显式整数只能为 0–6。
     */
    public function dateTimeTz(string $column, ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 time 字段。
     * 省略 precision 为 0；显式 null 输出不带精度，显式整数只能为 0–6。
     */
    public function time(string $column, ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 time with time zone 字段。
     * 省略 precision 为 0；显式 null 输出不带精度，显式整数只能为 0–6。
     */
    public function timeTz(string $column, ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建 varchar(255) 并附加 CHECK IN，不创建 PostgreSQL 枚举类型。
     * @param non-empty-list<string> $allowed 不重复的字符串字面量，每项最多 255 字符。
     */
    public function enum(string $column, array $allowed): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的 created_at 和 updated_at 无时区时间字段。
     * 仅位置参数，返回 void；省略精度为 0，显式 null 不写精度。
     */
    public function timestamps(?int $precision = 0): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的 created_at 和 updated_at 带时区时间字段。
     * 仅位置参数，返回 void；省略精度为 0，显式 null 不写精度。
     */
    public function timestampsTz(?int $precision = 0): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的 created_at 和 updated_at 无时区时间字段。
     * 仅位置参数，返回 void；省略精度为 0，显式 null 不写精度。
     */
    public function nullableTimestamps(?int $precision = 0): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的 created_at 和 updated_at 无时区时间字段。
     * 仅位置参数，返回 void；省略精度为 0，显式 null 不写精度。
     */
    public function datetimes(?int $precision = 0): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的无时区软删除时间字段，可继续链式修饰。
     * 仅位置参数；省略精度为 0，显式 null 不写精度。
     */
    public function softDeletes(string $column = 'deleted_at', ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的带时区软删除时间字段，可继续链式修饰。
     * 仅位置参数；省略精度为 0，显式 null 不写精度。
     */
    public function softDeletesTz(string $column = 'deleted_at', ?int $precision = 0): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加允许 NULL 的 varchar(100) remember_token，可继续链式修饰。
     */
    public function rememberToken(): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加 int8 创建者/更新者字段，默认值 0 并添加中文注释。
     * 仅位置参数，返回 void。
     */
    public function authorBy(string $createdBy = 'created_by', string $updatedBy = 'updated_by'): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加 非空的 name_type 和 name_id 及二者组合索引。
     * name_id 使用 非负 int8；仅位置参数，返回 void。
     */
    public function morphs(string $name, ?string $indexName = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加 允许 NULL的 name_type 和 name_id 及二者组合索引。
     * name_id 使用 非负 int8；仅位置参数，返回 void。
     */
    public function nullableMorphs(string $name, ?string $indexName = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加 非空的 name_type 和 name_id 及二者组合索引。
     * name_id 使用 uuid；仅位置参数，返回 void。
     */
    public function uuidMorphs(string $name, ?string $indexName = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 添加 允许 NULL的 name_type 和 name_id 及二者组合索引。
     * name_id 使用 uuid；仅位置参数，返回 void。
     */
    public function nullableUuidMorphs(string $name, ?string $indexName = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 生成 COMMENT ON TABLE；仅位置参数。
     */
    public function comment(string $comment): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 建立独立普通索引；省略名称或 null 自动命名。仅位置参数。
     * @param string|non-empty-list<string>|non-empty-array<string, 'asc'|'desc'> $columns 列名、列列表或列到排序方向的有序映射。
     */
    public function index(string|array $columns, ?string $name = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 建立独立唯一索引；name 参数必须给出，null 表示自动命名。仅位置参数。
     * 省略 where 表示无谓词；显式条件必须非空，不能显式传 [] 或 null。
     * 只允许 AND 等值或 IS NULL，不接受表达式、嵌套条件或原始 SQL。
     * @param string|non-empty-list<string>|non-empty-array<string, 'asc'|'desc'> $columns 索引列及方向。
     * @param non-empty-array<string, scalar|null> $where 可省略；显式提供时为非空字段值映射。
     */
    public function uniqueIndex(string|array $columns, ?string $name, array $where = []): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 为当前表的已声明索引生成 COMMENT ON INDEX；仅位置参数。
     */
    public function indexComment(string $indexName, string $comment): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建唯一约束；省略名称自动命名。仅位置参数。
     * @param string|non-empty-list<string> $columns 列名或列名列表。
     */
    public function unique(string|array $columns, ?string $name = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 创建主键约束；省略名称采用普通 PRIMARY KEY。仅位置参数。
     * @param string|non-empty-list<string> $columns 列名或列名列表。
     */
    public function primary(string|array $columns, ?string $name = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 声明外键，必须继续调用 references() 和 on()；仅位置参数。
     * @param string|non-empty-list<string> $columns 本表外键列名或列名列表。
     */
    public function foreign(string|array $columns, ?string $name = null): ForeignKeyDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 按受支持字段类型名称添加列；仅位置参数。
     * 省略 options 使用默认值；显式 options 必须是字符串键映射，不能显式传 []。
     * 类型专属键：整数 autoIncrement/unsigned；char/string length；decimal/float/double total/places；时间 precision；enum allowed。
     * 其他支持键：comment/default/nullable/index/unique/primary/useCurrent；不接受未列出的选项。
     * @param array{autoIncrement?: bool, unsigned?: bool, length?: int|null, total?: int|null, places?: int|null, precision?: int|null, allowed?: non-empty-list<string>, comment?: string, default?: scalar|null, nullable?: bool, index?: string|bool|null, unique?: string|bool|null, primary?: string|bool|null, useCurrent?: bool} $options 各键仍受字段类型限制。
     */
    public function addColumn(string $type, string $column, array $options = []): ColumnDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 Schema::table：删除字段；仅位置参数。
     * 使用单个非空列列表，或 1–100 个列名字符串；不可将数组与额外参数混用。
     * @param string|non-empty-list<string> $columns 列名或列名列表。
     */
    public function dropColumn(string|array $columns, string ...$additionalColumns): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 Schema::table：重命名列；仅位置参数，不允许同回调与该列添加/删除冲突。
     */
    public function renameColumn(string $from, string $to): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 Schema::table：删除独立普通/唯一索引；仅位置参数。
     * @param string|non-empty-list<string> $index 对象名称，或用于推导默认名称的列名列表。
     */
    public function dropIndex(string|array $index): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 Schema::table：删除唯一约束；仅位置参数。
     * @param string|non-empty-list<string> $index 对象名称，或用于推导默认名称的列名列表。
     */
    public function dropUnique(string|array $index): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 Schema::table：删除外键约束；仅位置参数。
     * @param string|non-empty-list<string> $index 对象名称，或用于推导默认名称的列名列表。
     */
    public function dropForeign(string|array $index): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 Schema::table：删除主键。省略参数使用已知主键名或默认名；仅位置参数。
     * 显式参数只能为对象名或非空列列表，不能显式传 null 或 []。
     * @param string|non-empty-list<string>|null $index null 仅表示未传参，不是可写入源码的参数值。
     */
    public function dropPrimary(string|array|null $index = null): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }
}
