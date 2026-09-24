<?php

declare(strict_types=1);

namespace SqlStudio\Schema;

/**
 * 单列定义的链式修饰器；仅位置参数，重复同一修饰器会被拒绝。
 * 返回 static 保留 foreignId 等子类的补全。具体字段适用性仍由转换器验证。
 */
class ColumnDefinition
{
    /**
     * 允许/禁止 NULL；自增主键不允许 nullable(true)。
     */
    public function nullable(bool $value = true): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 声明静态默认值；仅标量/null，不能使用 SQL 表达式或动态 PHP。
     * 数值、时间和其他类型的范围由转换器校验；CURRENT_TIMESTAMP 使用 useCurrent()。
     */
    public function default(string|int|float|bool|null $value): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 生成 COMMENT ON COLUMN；文字按原值保留。
     */
    public function comment(string $comment): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅数值字段；生成相应范围限制。非负 int8 仍受 PostgreSQL 有符号上限约束。
     */
    public function unsigned(bool $value = true): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅整数字段；启用原生整数序列和主键，允许自定义字段名。
     */
    public function autoIncrement(bool $value = true): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅自增字段；正十进制整数字面量或数字字符串，不接受 config() 或计算表达式。
     * 省略时根据 data() 最大显式 ID 加一规划；显式起点不自动改写并校验碰撞。
     * 字符串可保留大整数精度。
     */
    public function startingValue(int|string $value): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅自增字段；显式指定序列整数类型，仍校验字段与序列共同范围。
     * @param 'int8'|'int4'|'int2' $type 必须为字符串字面量。
     */
    public function sequenceType(string $type): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 建立本列普通索引；省略/null/true 自动命名，false 不创建。
     */
    public function index(string|bool|null $name = null): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 建立本列唯一约束；省略/null/true 自动命名，false 不创建。
     */
    public function unique(string|bool|null $name = null): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 将本列设为主键；省略/null/true 不指定自定义名，false 不创建。
     */
    public function primary(string|bool|null $name = null): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 仅 timestamp/time 系列字段；启用 CURRENT_TIMESTAMP 默认值。
     */
    public function useCurrent(bool $value = true): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }
}
