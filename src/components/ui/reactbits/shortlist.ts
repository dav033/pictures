import type { LucideIcon } from 'lucide-react';
import { AudioLines, Focus, Sparkles, Type } from 'lucide-react';

export type ReactBitsShortlistEntry = {
  registryName: string;
  title: string;
  icon: LucideIcon;
  animationRuntime: 'motion@13' | 'css';
};

export const reactBitsShortlist = [
  {
    registryName: 'BlurText-TS-TW',
    title: 'BlurText',
    icon: Type,
    animationRuntime: 'motion@13',
  },
  {
    registryName: 'RotatingText-TS-TW',
    title: 'RotatingText',
    icon: AudioLines,
    animationRuntime: 'motion@13',
  },
  {
    registryName: 'SpotlightCard-TS-TW',
    title: 'SpotlightCard',
    icon: Focus,
    animationRuntime: 'css',
  },
  {
    registryName: 'ShinyText-TS-TW',
    title: 'ShinyText',
    icon: Sparkles,
    animationRuntime: 'css',
  },
] as const satisfies readonly ReactBitsShortlistEntry[];
