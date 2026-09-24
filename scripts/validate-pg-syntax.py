"""通过指定虚拟环境中 pglast 的实际 PostgreSQL 版本验证产物，不代表导入。"""
import argparse
import json
from pathlib import Path
import pglast
from pglast import parse_sql
from pglast.parser import get_postgresql_version

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--target-version', type=int, required=True, choices=(16, 18))
args = parser.parse_args()
actual_version = get_postgresql_version()
if actual_version[0] != args.target_version:
    raise SystemExit(f'解析器版本不匹配：目标 {args.target_version}，实际 {actual_version}')
results = []
for file in sorted(args.directory.rglob('*.sql')):
    results.append({'file': str(file), 'statements': len(parse_sql(file.read_text(encoding='utf-8')))})
if not results:
    raise SystemExit('没有 SQL 文件')
report = {'parser': pglast.__version__, 'postgresqlVersion': actual_version, 'databaseImport': 'not_run', 'files': results}
destination = args.directory / 'syntax-report.json'
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'parser': pglast.__version__, 'postgresqlVersion': actual_version, 'files': len(results), 'statements': sum(item['statements'] for item in results), 'report': str(destination)}, ensure_ascii=False))
