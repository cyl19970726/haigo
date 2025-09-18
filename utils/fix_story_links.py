#!/usr/bin/env python3
"""Apply predefined Source link rewrites to story files."""

import argparse
import json
from pathlib import Path
from typing import Dict, List

DEFAULT_REWRITES = Path('utils/story_link_rewrites.json')


def load_rewrites(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f'Rewrite configuration not found: {path}')
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, list):
        raise ValueError('Rewrite configuration must be a list of {"old","new"} objects.')
    for index, item in enumerate(data):
        if not isinstance(item, dict) or 'old' not in item or 'new' not in item:
            raise ValueError(f'Malformed entry at index {index}: {item}')
    return data


def apply_rewrites(story_path: Path, rewrites: List[Dict[str, str]]) -> int:
    text = story_path.read_text(encoding='utf-8')
    new_text = text
    applied = 0
    for entry in rewrites:
        old = entry['old']
        new = entry['new']
        if old in new_text:
            new_text = new_text.replace(old, new)
            applied += 1
    if applied and new_text != text:
        story_path.write_text(new_text, encoding='utf-8')
    return applied


def main() -> None:
    parser = argparse.ArgumentParser(description='Apply predefined Source link rewrites to story markdown files.')
    parser.add_argument('--stories-dir', default='docs/stories', help='Directory containing story markdown files.')
    parser.add_argument('--repo-root', default='.', help='Repository root for resolving paths.')
    parser.add_argument('--rewrites-file', default=str(DEFAULT_REWRITES), help='JSON file describing link rewrites.')
    parser.add_argument('--dry-run', action='store_true', help='Show matches without modifying files.')
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    stories_dir = repo_root / Path(args.stories_dir)
    if not stories_dir.exists():
        raise SystemExit(f'Stories directory not found: {stories_dir}')

    rewrites = load_rewrites(Path(args.rewrites_file))

    total_applied = 0
    for story_path in sorted(stories_dir.glob('*.story.md')):
        text = story_path.read_text(encoding='utf-8')
        new_text = text
        applied = 0
        for entry in rewrites:
            old = entry['old']
            new = entry['new']
            if old in new_text:
                new_text = new_text.replace(old, new)
                applied += 1
        if applied:
            rel_path = story_path.relative_to(repo_root)
            if args.dry_run:
                print(f'[dry-run] {rel_path}: {applied} replacements')
            else:
                story_path.write_text(new_text, encoding='utf-8')
                print(f'{rel_path}: {applied} replacements applied')
            total_applied += applied

    if total_applied == 0:
        print('No replacements matched.')
    else:
        print(f'Total replacements applied: {total_applied}')

if __name__ == '__main__':
    main()
