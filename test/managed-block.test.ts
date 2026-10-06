import { describe, expect, it } from 'vitest';
import { upsertBlock } from '../src/core/files.ts';

const header = '# Managed by zaun: edits inside this block are overwritten on the next install.';

describe('upsertBlock', () => {
  it('creates the block in an empty file', () => {
    expect(upsertBlock('', 'source a')).toBe(`# >>> zaun >>>\n${header}\nsource a\n# <<< zaun <<<\n`);
  });

  it('appends after existing content with a blank line', () => {
    const out = upsertBlock('export A=1', 'source a');
    expect(out).toBe(`export A=1\n\n# >>> zaun >>>\n${header}\nsource a\n# <<< zaun <<<\n`);
  });

  it('replaces the block in place and keeps everything around it', () => {
    const before = upsertBlock('top\n', 'old line 1\nold line 2') + 'bottom\n';
    const after = upsertBlock(before, 'new');
    expect(after).toBe(`top\n\n# >>> zaun >>>\n${header}\nnew\n# <<< zaun <<<\nbottom\n`);
  });

  it('is idempotent', () => {
    const once = upsertBlock('alias ll="ls -l"\n', 'source "$ZAUN_DIR/config/zsh/zaun.zsh"');
    expect(upsertBlock(once, 'source "$ZAUN_DIR/config/zsh/zaun.zsh"')).toBe(once);
  });

  it('handles bodies containing $ and regex characters literally', () => {
    const body = 'export PATH="$HOME/.local/bin:$PATH" # (.*)$&';
    const once = upsertBlock('', body);
    expect(once).toContain(body);
    expect(upsertBlock(once, body)).toBe(once);
  });

  it('supports named blocks so several can coexist', () => {
    const two = upsertBlock(upsertBlock('', 'a'), 'b', 'zaun-node');
    expect(two).toContain('# >>> zaun >>>\n');
    expect(two).toContain('# >>> zaun-node >>>\n');
    expect(upsertBlock(two, 'b2', 'zaun-node')).toContain('b2\n# <<< zaun-node <<<');
    expect(upsertBlock(two, 'b2', 'zaun-node')).toContain('a\n# <<< zaun <<<');
  });
});
