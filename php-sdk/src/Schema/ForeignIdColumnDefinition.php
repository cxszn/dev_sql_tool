<?php

declare(strict_types=1);

namespace SqlStudio\Schema;

/**
 * foreignId 字段；先设置 nullable/default 等列属性，再调用 constrained()。
 */
final class ForeignIdColumnDefinition extends ColumnDefinition
{
    /**
     * 仅位置参数，必须显式给出引用表；引用列默认为 id。
     * 返回外键定义后仅能继续添加外键动作，不能再调用 nullable/default 等字段修饰器。
     */
    public function constrained(string $table, string $column = 'id'): ForeignKeyDefinition
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }
}
