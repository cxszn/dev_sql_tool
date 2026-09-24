<?php

declare(strict_types=1);

namespace SqlStudio\Migrations;

/**
 * SQL 编写助手的静态迁移声明。客户端读取源码，不实例化本类或执行 PHP。
 * up() 必须为无参数 public 方法；所有 SQL 均由受支持的 Schema 调用生成。
 * down() 不参与转换，不必编写。禁止 PHP 变量计算、分支、循环和任意函数调用。
 */
abstract class Migration
{
    /**
     * 是否为单表 create 生成 DROP IF EXISTS；默认 false。
     * true 仅允许 up() 中一个 Schema::create，执行输出 SQL 将删除原表数据。
     * 多表初始化请显式声明 Schema::dropIfExists/dropSequenceIfExists。
     */
    public bool $exists_drop = false;

    /** 阻止误将仅供静态编写的文件当成 PHP 迁移程序运行。 */
    public function __construct()
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }

    /** 声明表、列、索引及注释；仅支持客户端能力列表列出的静态调用。 */
    abstract public function up(): void;

    /**
     * 提供初始化数据；仅允许一条 return 字面量数组，不允许函数调用或变量。
     * 行列表仅适用于单个 Schema::create；多表使用表名 => 行列表。
     * 保持表键和行顺序，不自动排序；自引用外键必须先提供被引用行。
     * 省略自增 ID 时由序列取号；显式 ID 保留原值。
     * @return list<array<string, scalar|null>>|array<string, list<array<string, scalar|null>>>
     */
    public function data(): array
    {
        throw new \LogicException('此文件仅提供 SqlStudio IDE 提示；请通过客户端、CLI 或 MCP 静态转换 PHP，不要执行迁移或 SDK。');
    }
}
