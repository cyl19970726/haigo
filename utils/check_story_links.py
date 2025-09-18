#!/usr/bin/env python3
"""Utility to verify that story Source links in docs/stories remain valid."""

import argparse
import re
from pathlib import Path
from typing import Dict, List, Tuple

def slugify(title: str) -> str:
    """Approximate slugification similar to GitHub-style anchors."""
    text = title.strip().lower()
    replacements = {
        '—': ' ',
        '–': ' ',
        '−': ' ',
    }
    for src, dest in replacements.items():
        text = text.replace(src, dest)
    text = re.sub(r"[‘’“”]", '', text)
    text = re.sub(r'[\(\)\[\]\{\}]', '', text)
    text = re.sub(r'[^\w\s-]', ' ', text, flags=re.UNICODE)
    text = re.sub(r'\s+', '-', text, flags=re.UNICODE)
    text = re.sub(r'-{2,}', '-', text)
    return text.strip('-')

def build_anchor_index(markdown_path: Path) -> Dict[str, int]:
    headings = re.findall(r'^(#{1,6})\s+(.+)$', markdown_path.read_text(encoding='utf-8'), flags=re.MULTILINE)
    slug_counts: Dict[str, int] = {}
    anchors: Dict[str, int] = {}
    for _, title in headings:
        base_slug = slugify(title)
        if base_slug in slug_counts:
            slug_counts[base_slug] += 1
            slug = f"{base_slug}-{slug_counts[base_slug]}"
        else:
            slug_counts[base_slug] = 0
            slug = base_slug
        anchors[slug] = anchors.get(slug, 0) + 1
    return anchors

def find_story_links(story_path: Path) -> List[Tuple[str, str]]:
    text = story_path.read_text(encoding='utf-8')
    refs = re.findall(r'\[Source: ([^\]]+)\]', text)
    links: List[Tuple[str, str]] = []
    for ref in refs:
        if ref.startswith('move/'):
            continue
        if '#' in ref:
            file_part, anchor = ref.split('#', 1)
            links.append((file_part.strip(), anchor.strip()))
        else:
            links.append((ref.strip(), ''))
    return links

def validate_links(story_dir: Path, root: Path) -> List[Tuple[Path, str, str]]:
    cache: Dict[Path, Dict[str, int]] = {}
    issues: List[Tuple[Path, str, str]] = []
    for story_path in sorted(story_dir.glob('*.story.md')):
        for file_ref, anchor in find_story_links(story_path):
            target_path = root / file_ref
            if not target_path.exists():
                issues.append((story_path, file_ref, 'missing_file'))
                continue
            if anchor:
                if target_path not in cache:
                    cache[target_path] = build_anchor_index(target_path)
                anchors = cache[target_path]
                if anchor not in anchors:
                    issues.append((story_path, f"{file_ref}#{anchor}", 'missing_anchor'))
    return issues

def main() -> None:
    parser = argparse.ArgumentParser(description='Validate story Source links and anchors.')
    parser.add_argument('--stories-dir', default='docs/stories', help='Directory containing story markdown files.')
    parser.add_argument('--repo-root', default='.', help='Repository root for resolving relative paths.')
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    stories_dir = repo_root / Path(args.stories_dir)
    if not stories_dir.exists():
        raise SystemExit(f'Stories directory not found: {stories_dir}')

    issues = validate_links(stories_dir, repo_root)
    if not issues:
        print('All Source links validated successfully.')
        return

    print('Found potential issues:')
    for story_path, ref, issue_type in issues:
        print(f' - {story_path}: {issue_type}: {ref}')

if __name__ == '__main__':
    main()
