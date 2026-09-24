<?php

declare(strict_types=1);

namespace SqlStudio\Schema;

/**
 * 静态 SQL 结构入口；仅位置参数，不连接数据库、不执行回调。
 * table 支持表名或 schema.table；省略 schema 时编译为 public。
 * create/table 只接受一个 Blueprint 参数的普通闭包；不支持箭头函数或 use 捕获。
 */
final class Schema
{
    /**
     * 创建表；表已存在时执行 SQL 会报错，请按需要显式声明删除。
     * @param \Closure(Blueprint): void $callback 单个 Blueprint 参数的普通闭包。
     */
    public static function create(string $table, \Closure $callback): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 修改既有表；支持增删/重命名列及索引约束，不支持 change()。
     * @param \Closure(Blueprint): void $callback 单个 Blueprint 参数的普通闭包。
     */
    public static function table(string $table, \Closure $callback): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 生成 DROP TABLE IF EXISTS；执行 SQL 会删除表和数据，不加 CASCADE。
     */
    public static function dropIfExists(string $table): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 生成 DROP TABLE；执行 SQL 会删除表和数据，不加 CASCADE。
     */
    public static function drop(string $table): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 重命名同一 schema 内的表；不支持跨 schema 移动。
     */
    public static function rename(string $from, string $to): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 生成 DROP SEQUENCE IF EXISTS；应先删除使用此序列的表或列。
     */
    public static function dropSequenceIfExists(string $sequence): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 生成 DROP SEQUENCE；应先删除使用此序列的表或列。
     */
    public static function dropSequence(string $sequence): void
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }
}
