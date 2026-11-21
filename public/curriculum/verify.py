#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
万卷 · 课标推荐背诵篇目数据校验脚本

校验 public/curriculum/ 下三份 JSON 数据文件：
  - primary.json  小学 1～6 年级   期望 75 篇
  - junior.json   初中 7～9 年级   期望 60 篇（段）【2022年版课标官方数字】
  - senior.json   高中             期望 72 篇（文言文32＋诗词曲40）

说明：2022年版《义务教育语文课程标准》附录1原文为"7～9年级60篇（段）"
（135 = 75 + 60）；部分资料沿用2011年版课标的"61篇（段）"，与2022年版不符，
本项目以教育部官方文件为准，故初中期望值为 60。

用法：python verify.py   （在 public/curriculum/ 目录下，或任意位置运行均可）
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

EXPECTED = {
    "primary": ("primary.json", "小学（1～6年级）", 75),
    "junior": ("junior.json", "初中（7～9年级）", 60),
    "senior": ("senior.json", "高中", 72),
}

REQUIRED_FIELDS = ("no", "title", "author", "dynasty", "form", "grade", "recitation", "note")


def verify(stage: str) -> list[str]:
    """校验单个学段文件，返回错误列表。"""
    filename, label, expected = EXPECTED[stage]
    errors: list[str] = []
    path = HERE / filename

    if not path.exists():
        return [f"文件缺失：{path}"]

    data = json.loads(path.read_text(encoding="utf-8"))

    # 1) 学段与声明条数
    if data.get("stage") != stage:
        errors.append(f"stage 字段应为 {stage}，实际为 {data.get('stage')!r}")
    declared = data.get("verified_count")
    if declared != expected:
        errors.append(f"verified_count 应为 {expected}，实际为 {declared}")

    # 2) items 数量（硬性要求：恰好等于期望值，不得多一篇少一篇）
    items = data.get("items", [])
    n = len(items)
    mark = "✓" if n == expected else "✗"
    print(f"[校验] {label}篇目 {n}/{expected} {mark}")

    # 3) 逐条检查：编号连续、必填字段齐全、篇名/作者非空、recitation 为真
    seen_titles_authors: set[tuple[str, str]] = set()
    for idx, item in enumerate(items, start=1):
        if item.get("no") != idx:
            errors.append(f"第 {idx} 条编号不连续：no={item.get('no')!r}")
        for field in REQUIRED_FIELDS:
            if field not in item:
                errors.append(f"第 {idx} 条缺少字段 {field!r}")
        title = (item.get("title") or "").strip()
        if not title:
            errors.append(f"第 {idx} 条 title 为空")
        # author 允许为 null（如"古代文论选段"为合集条目），但不能是空白字符串
        author = item.get("author")
        if author is not None and not str(author).strip():
            errors.append(f"第 {idx} 条 author 为空白字符串（不确定应置 null）")
        if item.get("recitation") is not True:
            errors.append(f"第 {idx} 条 recitation 应为 true")
        # 完全重复条目检查（篇名+作者+首句注释 三元组重复才视为可疑，同题异首句不算）
        key = (title, str(author), item.get("note") or "")
        if key in seen_titles_authors:
            errors.append(f"第 {idx} 条为完全重复条目：{title} / {author}")
        seen_titles_authors.add(key)

    # 4) 来源 URL 至少两个（双源交叉核对要求）
    urls = data.get("source_urls", [])
    if len(urls) < 2:
        errors.append(f"source_urls 少于 2 个（要求至少双来源）")

    return errors


def main() -> int:
    print("=" * 46)
    print("万卷 · 课标背诵篇目数据校验")
    print("标准：义务教育2022年版 / 高中2017年版2020年修订")
    print("=" * 46)

    all_errors: list[str] = []
    for stage in EXPECTED:
        all_errors.extend(verify(stage))

    total = sum(len(json.loads((HERE / f).read_text(encoding="utf-8"))["items"])
                for f, _, _ in EXPECTED.values())
    print(f"[校验] 三学段合计 {total} 篇（75+60+72）")

    if all_errors:
        print()
        print(f"发现 {len(all_errors)} 处问题：")
        for e in all_errors:
            print(f"  ✗ {e}")
        return 1

    print()
    print("全部校验通过：篇目数量、编号、字段、来源均符合要求。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
