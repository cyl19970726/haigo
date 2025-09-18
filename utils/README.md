# Utils Scripts

## check_story_links.py
- purpose: validate Source references. usage: `python utils/check_story_links.py`
- options: `--stories-dir`, `--repo-root`, etc.
- sample output: "All Source links validated successfully."

## fix_story_links.py
- purpose: apply rewrite mapping from `story_link_rewrites.json`.
- usage: `python utils/fix_story_links.py` or `--dry-run` to preview.
- mapping file: must contain list of objects `{ "old": "...", "new": "..." }`.

## workflow
1. run check_story_links to find broken anchors.
2. update story_link_rewrites.json with old/new pairs as needed.
3. run fix_story_links.py to rewrite stories.
4. rerun check_story_links.py to confirm clean output.
