/** 新编写统一使用 SqlStudio；旧命名空间仅保留静态转换兼容。 */
export const PHP_CLASSES = Object.freeze({
  Migration: 'SqlStudio\\Migrations\\Migration',
  Blueprint: 'SqlStudio\\Schema\\Blueprint',
  Schema: 'SqlStudio\\Schema\\Schema',
});
export const PHP_IMPORTS = Object.values(PHP_CLASSES).map(name => `use ${name};`);
export const ACCEPTED_PHP_CLASSES = {
  Migration: [PHP_CLASSES.Migration, 'Hyperf\\Database\\Migrations\\Migration', 'Illuminate\\Database\\Migrations\\Migration'],
  Blueprint: [PHP_CLASSES.Blueprint, 'Hyperf\\Database\\Schema\\Blueprint', 'Illuminate\\Database\\Schema\\Blueprint'],
  Schema: [PHP_CLASSES.Schema, 'Hyperf\\Database\\Schema\\Schema', 'Illuminate\\Support\\Facades\\Schema'],
};
