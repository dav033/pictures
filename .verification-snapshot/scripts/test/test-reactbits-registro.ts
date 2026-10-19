import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { reactBitsShortlist } from '../../src/components/ui/reactbits/shortlist';
import { subscribeToMotionPreference } from '../../src/components/ui/reactbits/useReducedMotionPreference';

const projectRoot = process.cwd();

async function readComponentSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readComponentSources(path);
      if (!entry.isFile() || !/\.(tsx?|jsx?)$/.test(entry.name)) return [];
      return [await readFile(path, 'utf8')];
    }),
  );

  return contents.flat();
}

test('React Bits registry and ui alias are configured', async () => {
  const components = JSON.parse(
    await readFile(`${projectRoot}/components.json`, 'utf8'),
  ) as {
    aliases?: { ui?: string };
    registries?: Record<string, string>;
  };

  assert.equal(components.registries?.['@react-bits'], 'https://reactbits.dev/r/{name}.json');
  assert.equal(components.aliases?.ui, '@/components/ui/reactbits');
  assert.deepEqual(
    reactBitsShortlist.map(({ registryName }) => registryName),
    ['BlurText-TS-TW', 'RotatingText-TS-TW', 'SpotlightCard-TS-TW', 'ShinyText-TS-TW'],
  );
});

test('React Bits uses one Motion 13 install and no GSAP or Hugeicons', async () => {
  const packageJson = JSON.parse(await readFile(`${projectRoot}/package.json`, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const lock = JSON.parse(await readFile(`${projectRoot}/package-lock.json`, 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };
  const motionInstalls = Object.entries(lock.packages).filter(([path]) =>
    /(?:^|\/)node_modules\/motion$/.test(path),
  );

  assert.match(packageJson.dependencies?.motion ?? '', /^\^13\./);
  assert.equal(motionInstalls.length, 1);
  assert.match(motionInstalls[0]?.[1].version ?? '', /^13\./);
  assert.deepEqual(
    Object.keys(lock.packages).filter((path) => /(?:^|\/)node_modules\/gsap$/.test(path)),
    [],
  );
  assert.deepEqual(
    Object.keys(lock.packages).filter((path) => path.toLowerCase().includes('hugeicons')),
    [],
  );

  const componentSources = (await readComponentSources(
    `${projectRoot}/src/components/ui/reactbits`,
  )).join('\n');
  assert.doesNotMatch(componentSources, /from\s+['"](?:gsap|@hugeicons\/)/);
  assert.doesNotMatch(componentSources, /from\s+['"]framer-motion['"]/);
});

test('React Bits license notice is included', async () => {
  const license = await readFile(
    `${projectRoot}/src/components/ui/reactbits/LICENSE.md`,
    'utf8',
  );

  assert.match(license, /MIT \+ Commons Clause/);
  assert.match(license, /do not sell, sublicense, or redistribute the components themselves/i);
  assert.match(license, /Copyright \(c\) 2026 David Haz/);
});

test('reduced-motion subscriptions react to changes and can be removed', () => {
  const listeners = new Set<() => void>();
  const query: Parameters<typeof subscribeToMotionPreference>[0] = {
    matches: false,
    addEventListener(_type: 'change', listener: () => void): void {
      listeners.add(listener);
    },
    removeEventListener(_type: 'change', listener: () => void): void {
      listeners.delete(listener);
    },
  };
  let currentPreference = query.matches;
  const unsubscribe = subscribeToMotionPreference(query, () => {
    currentPreference = query.matches;
  });

  query.matches = true;
  for (const listener of listeners) listener();
  assert.equal(currentPreference, true);
  unsubscribe();
  assert.equal(listeners.size, 0);
});
