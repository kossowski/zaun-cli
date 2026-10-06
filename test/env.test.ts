import { describe, expect, it } from 'vitest';
import { parseOsRelease } from '../src/core/env.ts';

describe('parseOsRelease', () => {
  it('reads Ubuntu', () => {
    const text = [
      'PRETTY_NAME="Ubuntu 24.04.1 LTS"',
      'NAME="Ubuntu"',
      'VERSION_ID="24.04"',
      'ID=ubuntu',
      'ID_LIKE=debian',
    ].join('\n');
    expect(parseOsRelease(text)).toEqual({
      id: 'ubuntu',
      versionId: '24.04',
      prettyName: 'Ubuntu 24.04.1 LTS',
      debianFamily: true,
    });
  });

  it('reads Debian (no ID_LIKE) and derivatives with several ID_LIKE entries', () => {
    expect(parseOsRelease('ID=debian\nVERSION_ID="12"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"')).toMatchObject({
      id: 'debian',
      versionId: '12',
      debianFamily: true,
    });
    expect(parseOsRelease('ID=linuxmint\nID_LIKE="ubuntu debian"').debianFamily).toBe(true);
  });

  it('flags non-apt systems and falls back when fields are missing', () => {
    expect(parseOsRelease('ID="fedora"\nID_LIKE="rhel centos"').debianFamily).toBe(false);
    expect(parseOsRelease('')).toEqual({ id: '', versionId: null, prettyName: 'Linux', debianFamily: false });
  });
});
