<?php

declare(strict_types=1);

namespace SqlStudio\Schema;

/**
 * 外键声明；仅位置参数。references/on 必须完整，动作在每种事件上只能设置一次。
 */
final class ForeignKeyDefinition
{
    /**
     * 指定被引用列，列数应与本地外键列一致。
     * @param string|non-empty-list<string> $columns 列名或列名列表。
     */
    public function references(string|array $columns): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 指定引用表，支持 table 或 schema.table。
     */
    public function on(string $table): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置删除时的外键动作，SET NULL 要求本地字段允许 NULL。
     * @param 'CASCADE'|'RESTRICT'|'SET NULL'|'SET DEFAULT'|'NO ACTION' $action 外键动作。
     */
    public function onDelete(string $action): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置删除时级联；仅位置参数。
     */
    public function cascadeOnDelete(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置删除时限制；仅位置参数。
     */
    public function restrictOnDelete(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置删除时设 NULL；仅位置参数。
     */
    public function nullOnDelete(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置删除时不执行额外动作；仅位置参数。
     */
    public function noActionOnDelete(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置更新时的外键动作，SET NULL 要求本地字段允许 NULL。
     * @param 'CASCADE'|'RESTRICT'|'SET NULL'|'SET DEFAULT'|'NO ACTION' $action 外键动作。
     */
    public function onUpdate(string $action): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置更新时级联；仅位置参数。
     */
    public function cascadeOnUpdate(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置更新时限制；仅位置参数。
     */
    public function restrictOnUpdate(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置更新时设 NULL；仅位置参数。
     */
    public function nullOnUpdate(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /**
     * 设置更新时不执行额外动作；仅位置参数。
     */
    public function noActionOnUpdate(): static
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }
}
