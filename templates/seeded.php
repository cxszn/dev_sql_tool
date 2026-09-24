<?php

declare(strict_types=1);

use SqlStudio\Migrations\Migration;
use SqlStudio\Schema\Blueprint;
use SqlStudio\Schema\Schema;

return new class extends Migration {
    // 仅在明确需要重建时改为 true；生成的 SQL 一旦执行会删除同名表。
    public bool $exists_drop = false;

    /** 创建带初始数据的示例表。 */
    public function up(): void
    {
        Schema::create('demo_seed', static function (Blueprint $table) {
            $table->comment('静态初始数据示例');
            $table->bigIncrements('id')->comment('主键编号');
            $table->string('name', 128)->comment('名称');
            $table->boolean('enabled')->default(true)->comment('是否启用');
            $table->timestamps();
        });
    }

    /** 使用字面量返回初始数据，转换器根据显式 ID 设置新序列起点。 */
    public function data(): array
    {
        return [
            [
                'id' => 1,
                'name' => '示例一',
                'enabled' => true,
                'created_at' => '2026-01-01 00:00:00',
                'updated_at' => '2026-01-01 00:00:00',
            ],
            [
                'id' => 2,
                'name' => '示例二',
                'enabled' => false,
                'created_at' => '2026-01-01 00:00:00',
                'updated_at' => '2026-01-01 00:00:00',
            ],
        ];
    }

    /** 框架回退入口；本工具不输出或执行此方法。 */
    public function down(): void
    {
        Schema::dropIfExists('demo_seed');
    }
};
