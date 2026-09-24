<?php

declare(strict_types=1);

use SqlStudio\Migrations\Migration;
use SqlStudio\Schema\Blueprint;
use SqlStudio\Schema\Schema;

return new class extends Migration {
    /** 创建通用示例表；按实际需求保留字段。 */
    public function up(): void
    {
        Schema::create('demo_item', static function (Blueprint $table) {
            $table->comment('通用类型示例');
            $table->bigIncrements('id')->comment('主键编号');
            $table->string('name', 128)->comment('名称');
            $table->text('description')->nullable()->comment('说明');
            $table->integer('sort')->default(0)->comment('排序值');
            $table->boolean('enabled')->default(true)->comment('是否启用');
            $table->decimal('ratio', 6, 3)->default(0)->comment('比例示例，单位由业务定义');
            $table->jsonb('extra')->nullable()->comment('扩展数据，需应用支持 JSON 序列化');
            $table->timestamps();
            $table->index(['enabled', 'sort']);
        });
    }

    /** 框架回退入口；本工具不输出或执行此方法。 */
    public function down(): void
    {
        Schema::dropIfExists('demo_item');
    }
};
