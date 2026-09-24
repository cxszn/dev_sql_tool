<?php

declare(strict_types=1);

use SqlStudio\Migrations\Migration;
use SqlStudio\Schema\Blueprint;
use SqlStudio\Schema\Schema;

return new class extends Migration {
    /** 创建芋道审计字段示例；业务列由实际需求决定。 */
    public function up(): void
    {
        Schema::create('demo_audit', static function (Blueprint $table) {
            $table->comment('芋道机构业务表审计字段示例');
            $table->bigIncrements('id')->comment('主键编号，序列名须与实体 KeySequence 一致');
            // 机构业务表需要租户上下文；全局共享表应另行设计。
            $table->bigInteger('tenant_id')->comment('所属机构租户编号，由授权上下文填写');
            $table->string('creator', 64)->default('')->comment('创建者标识');
            $table->timestamp('create_time')->useCurrent()->comment('创建时间');
            $table->string('updater', 64)->default('')->comment('更新者标识');
            // useCurrent 只提供插入默认值，更新时由应用显式维护。
            $table->timestamp('update_time')->useCurrent()->comment('更新时间');
            $table->smallInteger('deleted')->default(0)->comment('逻辑删除：0正常，1删除');
            $table->index(['tenant_id', 'create_time']);
        });
    }

    /** 框架回退入口；本工具不输出或执行此方法。 */
    public function down(): void
    {
        Schema::dropIfExists('demo_audit');
    }
};
