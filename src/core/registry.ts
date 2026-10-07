// Every module zaun knows about, in menu order. Adding a module = create
// modules/<id>/index.ts and add one import + one entry here.

import type { Group, Module } from './types.ts';
import { groupOrder } from './ui.ts';

import base from '../../modules/base/index.ts';
import docker from '../../modules/docker/index.ts';
import tailscale from '../../modules/tailscale/index.ts';
import gh from '../../modules/gh/index.ts';
import shell from '../../modules/shell/index.ts';
import neovim from '../../modules/neovim/index.ts';
import node from '../../modules/node/index.ts';
import python from '../../modules/python/index.ts';
import claudeCode from '../../modules/claude-code/index.ts';
import codex from '../../modules/codex/index.ts';
import herdr from '../../modules/herdr/index.ts';
import gitConfig from '../../modules/git-config/index.ts';
import claudeConfig from '../../modules/claude-config/index.ts';
import codexConfig from '../../modules/codex-config/index.ts';
import herdrConfig from '../../modules/herdr-config/index.ts';

export const modules: Module[] = [
  base,
  docker,
  tailscale,
  gh,
  shell,
  neovim,
  node,
  python,
  claudeCode,
  codex,
  herdr,
  gitConfig,
  claudeConfig,
  codexConfig,
  herdrConfig,
];

export function getModule(id: string): Module | undefined {
  return modules.find((m) => m.id === id);
}

export function byGroup<M extends { group: Group }>(list: M[]): [Group, M[]][] {
  return groupOrder
    .map((group): [Group, M[]] => [group, list.filter((m) => m.group === group)])
    .filter(([, items]) => items.length > 0);
}
