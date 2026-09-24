<?php

declare(strict_types=1);

use SqlStudio\Migrations\Migration;
use SqlStudio\Schema\Blueprint;
use SqlStudio\Schema\Schema;

return new class extends Migration {
    /** 转换时须显式提供 {"permission.database.table":"rules"} 配置。 */
    public function up(): void
    {
        Schema::create(config('permission.database.table'), static function (Blueprint $table) {
            $table->comment('权限规则');
            $table->bigIncrements('id')->comment('主键编号');
            $table->string('ptype')->nullable()->comment('规则类型');
            $table->string('v0')->nullable()->comment('规则参数0');
            $table->string('v1')->nullable()->comment('规则参数1');
            $table->string('v2')->nullable()->comment('规则参数2');
            $table->string('v3')->nullable()->comment('规则参数3');
            $table->string('v4')->nullable()->comment('规则参数4');
            $table->string('v5')->nullable()->comment('规则参数5');
            $table->timestamps();
        });
    }

    /** 框架回退入口；本工具不输出或执行此方法。 */
    public function down(): void
    {
        Schema::dropIfExists(config('permission.database.table'));
    }
};
