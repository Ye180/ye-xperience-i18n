import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../src/args';
import { detectHtmlLang, defaultInclude, getConfig, OTHER } from '../src/prompts';
import { CONFIG_PATH, loadConfig, saveConfig } from '../src/utils/config';
import { UserError } from '../src/utils/errors';
import { detectProject } from '../src/utils/project';
import { VirtualFS } from '../src/utils/vfs';

const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol('cancel') }));
vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  multiselect: vi.fn(),
  text: vi.fn(),
  isCancel: (v: unknown) => v === CANCEL,
}));
const clack = await import('@clack/prompts');

const project = detectProject(join(import.meta.dirname, 'fixtures/basic'));
const opts = (o: Partial<Options> = {}): Options => ({ dryRun: false, yes: false, force: false, ignore: [], ...o });
const saved = { sourceLocale: 'fr', targetLocales: ['en'], include: ['app'], ignore: ['app/legacy/**'] };
let vfs: VirtualFS;

beforeEach(() => {
  vi.mocked(clack.select).mockReset();
  vi.mocked(clack.multiselect).mockReset();
  vi.mocked(clack.text).mockReset();
  vfs = new VirtualFS(mkdtempSync(join(tmpdir(), 'ye-i18n-')));
});

describe('getConfig', () => {
  it('init interactif : langues connues + codes personnalisés', async () => {
    vi.mocked(clack.select).mockResolvedValueOnce('fr').mockResolvedValueOnce('bottom-left');
    vi.mocked(clack.multiselect).mockResolvedValue(['en', OTHER]);
    vi.mocked(clack.text).mockResolvedValueOnce('pt-BR, en, fr').mockResolvedValueOnce('app, components');
    const config = await getConfig('init', project, opts({ ignore: ['x/**'] }), vfs);
    expect(config).toEqual({
      sourceLocale: 'fr',
      targetLocales: ['en', 'pt-BR'],
      include: ['app', 'components'],
      ignore: ['x/**'],
      switcher: 'bottom-left',
    });
  });

  it('init interactif prérempli avec la config enregistrée', async () => {
    saveConfig(vfs, saved);
    vi.mocked(clack.select).mockResolvedValueOnce('fr').mockResolvedValueOnce('none');
    vi.mocked(clack.multiselect).mockResolvedValue(['en']);
    vi.mocked(clack.text).mockResolvedValue('app');
    await getConfig('init', project, opts(), vfs);
    expect(vi.mocked(clack.multiselect).mock.calls[0][0]).toMatchObject({ initialValues: ['en'] });
    expect(vi.mocked(clack.text).mock.calls[0][0]).toMatchObject({ initialValue: 'app' });
  });

  it('annulation → UserError', async () => {
    vi.mocked(clack.select).mockResolvedValue(CANCEL);
    await expect(getConfig('init', project, opts(), vfs)).rejects.toThrow('Annulé.');
  });

  it('--yes, sync et translate réutilisent la config sans question', async () => {
    await expect(getConfig('init', project, opts({ yes: true }), vfs)).rejects.toThrow(/sans --yes/);
    await expect(getConfig('sync', project, opts(), vfs)).rejects.toThrow(/lance d’abord/);
    saveConfig(vfs, saved);
    expect(await getConfig('sync', project, opts({ ignore: ['y/**'] }), vfs)).toEqual({
      ...saved,
      ignore: ['app/legacy/**', 'y/**'],
    });
    expect(await getConfig('init', project, opts({ yes: true }), vfs)).toEqual(saved);
    expect(clack.select).not.toHaveBeenCalled();
  });
});

describe('config', () => {
  it('rejette une config invalide', () => {
    vfs.write(CONFIG_PATH, '{oups');
    expect(() => loadConfig(vfs)).toThrow(/JSON valide/);
    for (const bad of [
      { ...saved, sourceLocale: 'Français' },
      { ...saved, targetLocales: [] },
      { ...saved, targetLocales: ['fr'] },
      { ...saved, include: ['../ailleurs'] },
    ]) {
      vfs.write(CONFIG_PATH, JSON.stringify(bad));
      expect(() => loadConfig(vfs)).toThrow(UserError);
    }
  });
});

describe('détection', () => {
  it('lit la langue du layout et les dossiers par défaut', () => {
    expect(detectHtmlLang(project)).toBe('fr');
    expect(defaultInclude(project)).toEqual(['app', 'components']);
  });
});
