import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { type Entry, flatten, translateAll, type Translator, unflatten } from '../src/translate';
import { createClaudeTranslator, parseResult } from '../src/translate/claude';
import { createTranslator, keysPath, loadSavedKeys, resolveProvider, saveKey } from '../src/translate/providers';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserError } from '../src/utils/errors';

/** Faux traducteur : "Bonjour" → "[en] Bonjour", et garde la trace des appels. */
function fake() {
  const calls: { ids: string[]; to: string }[] = [];
  const translator: Translator = async (entries: Entry[], _from, to) => {
    calls.push({ ids: entries.map((e) => e.id), to });
    return Object.fromEntries(entries.map((e) => [e.id, `[${to}] ${e.text}`]));
  };
  return { translator, calls };
}

const source = { Home: { titre: 'Bonjour', bouton: 'Envoyer', double: 'Bonjour' }, Nav: { accueil: 'Accueil' } };
const base = { source, sourceLocale: 'fr', targetLocales: ['en', 'de'], existing: {}, cache: {} };

describe('translateAll', () => {
  it('traduit par lots, dédoublonne et respecte la structure', async () => {
    const { translator, calls } = fake();
    const out = await translateAll({ ...base, translator, batchSize: 2 });
    expect(out.messages.en).toEqual({
      Home: { titre: '[en] Bonjour', bouton: '[en] Envoyer', double: '[en] Bonjour' },
      Nav: { accueil: '[en] Accueil' },
    });
    expect(out.sent).toEqual({ en: 3, de: 3 });
    expect(calls.filter((c) => c.to === 'en').map((c) => c.ids)).toEqual([['Home.titre', 'Home.bouton'], ['Nav.accueil']]);
    expect(Object.keys(out.cache)).toHaveLength(3);
  });

  it('ne retraduit que ce qui a changé et garde les retouches manuelles', async () => {
    const first = await translateAll({ ...base, translator: fake().translator });
    const existing = { ...first.messages, en: { ...first.messages.en, Nav: { accueil: 'Home' } } };
    const changed = { ...source, Home: { ...source.Home, bouton: 'Valider' } };
    const { translator, calls } = fake();
    const out = await translateAll({ ...base, source: changed, existing, cache: first.cache, translator });
    expect(calls.map((c) => c.ids)).toEqual([['Home.bouton'], ['Home.bouton']]);
    expect(out.messages.en.Nav).toEqual({ accueil: 'Home' }); // retouche conservée
    expect(out.messages.en.Home.bouton).toBe('[en] Valider');
    expect(Object.values(out.cache).some((t) => t.en === '[en] Envoyer')).toBe(false); // élagué
  });

  it('relance identique → aucun appel, même résultat', async () => {
    const first = await translateAll({ ...base, translator: fake().translator });
    const { translator, calls } = fake();
    const again = await translateAll({ ...base, existing: first.messages, cache: first.cache, translator });
    expect(calls).toEqual([]);
    expect(again.messages).toEqual(first.messages);
    expect(again.cache).toEqual(first.cache);
  });

  it('force retraduit une seule locale', async () => {
    const first = await translateAll({ ...base, translator: fake().translator });
    const { translator, calls } = fake();
    await translateAll({ ...base, existing: first.messages, cache: first.cache, translator, force: ['de'] });
    expect(new Set(calls.map((c) => c.to))).toEqual(new Set(['de']));
  });

  it('dry-run : aucun appel, texte source en attendant', async () => {
    const out = await translateAll(base);
    expect(out.sent).toEqual({ en: 3, de: 3 });
    expect(out.messages.en.Home).toEqual(source.Home);
    expect(out.cache).toEqual({});
  });

  it('une erreur du traducteur rejette tout', async () => {
    const translator: Translator = async () => {
      throw new UserError('boom');
    };
    await expect(translateAll({ ...base, translator })).rejects.toThrow('boom');
  });

  it('flatten / unflatten', () => {
    const nested = { A: { b: 'x', c: { d: 'y' } }, E: { f: 'z' } };
    const flat = flatten(nested);
    expect([...flat]).toEqual([
      ['A.b', 'x'],
      ['A.c.d', 'y'],
      ['E.f', 'z'],
    ]);
    expect(unflatten([...flat])).toEqual(nested);
  });
});

describe('createClaudeTranslator', () => {
  const entries = [
    { id: 'Home.titre', text: 'Bonjour' },
    { id: 'Home.code', text: 'Code : X10' },
  ];
  const reply = (text: string, stop_reason = 'end_turn', stop_details: unknown = null) => ({
    stop_reason,
    stop_details,
    content: [{ type: 'text', text }],
  });
  const client = (...responses: unknown[]) => {
    const create = vi.fn();
    for (const r of responses) create.mockImplementationOnce(async () => (r instanceof Error ? Promise.reject(r) : r));
    return { create, client: { beta: { messages: { create } } } as never };
  };

  it('envoie un schéma strict et renvoie la traduction', async () => {
    const { create, client: c } = client(reply('{"Home.titre":"Hello","Home.code":"Code: X10"}'));
    const result = await createClaudeTranslator('claude-opus-5-5', c)(entries, 'fr', 'en');
    expect(result).toEqual({ 'Home.titre': 'Hello', 'Home.code': 'Code: X10' });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.fallbacks).toBe('default');
    expect(params.output_config.format.schema).toEqual({
      type: 'object',
      properties: { 'Home.titre': { type: 'string' }, 'Home.code': { type: 'string' } },
      required: ['Home.titre', 'Home.code'],
      additionalProperties: false,
    });
    expect(params.messages[0].content).toContain('Target locale: en');
  });

  it('pas de fallbacks ni effort pour un modèle qui ne les gère pas', async () => {
    const { create, client: c } = client(reply('{"Home.titre":"Hi","Home.code":"Code: X10"}'));
    await createClaudeTranslator('claude-haiku-4-5', c)(entries, 'fr', 'en');
    expect(create.mock.calls[0][0]).not.toHaveProperty('fallbacks');
    expect(create.mock.calls[0][0].output_config).not.toHaveProperty('effort');
  });

  it('réessaie une fois sur réponse invalide, puis échoue', async () => {
    const ok = client(reply('pas du json'), reply('{"Home.titre":"Hi","Home.code":"Code"}'));
    await expect(createClaudeTranslator('claude-opus-5-5', ok.client)(entries, 'fr', 'en')).resolves.toBeDefined();
    const ko = client(reply('{"Home.titre":"Hi"}'), reply('{}'));
    await expect(createClaudeTranslator('claude-opus-5-5', ko.client)(entries, 'fr', 'en')).rejects.toThrow(/invalide/);
  });

  it('refus et erreurs API → UserError lisible', async () => {
    const refusal = client(reply('', 'refusal', { category: 'cyber' }));
    await expect(createClaudeTranslator('claude-opus-5-5', refusal.client)(entries, 'fr', 'en')).rejects.toThrow(
      /refusé.*cyber/,
    );
    const auth = client(new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers()));
    await expect(createClaudeTranslator('claude-opus-5-5', auth.client)(entries, 'fr', 'en')).rejects.toThrow(
      /Clé API refusée/,
    );
    const notFound = client(new Anthropic.NotFoundError(404, {}, 'model', new Headers()));
    await expect(createClaudeTranslator('claude-oups', notFound.client)(entries, 'fr', 'en')).rejects.toThrow(
      /Modèle introuvable : claude-oups/,
    );
  });

  it('sans identifiants → message clair', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    const noKey = client(new Error('Could not resolve authentication method.'));
    await expect(createClaudeTranslator('claude-opus-5-5', noKey.client)(entries, 'fr', 'en')).rejects.toThrow(
      /ANTHROPIC_API_KEY n’est pas défini/,
    );
    vi.unstubAllEnvs();
  });

  it('parseResult', () => {
    expect(parseResult('{"a":"x"}', ['a'])).toEqual({ a: 'x' });
    expect(parseResult('{"a":"x","b":"y"}', ['a'])).toBeUndefined();
    expect(parseResult('{"a":" "}', ['a'])).toBeUndefined();
    expect(parseResult('["x"]', ['0'])).toBeUndefined();
  });
});

describe('resolveProvider', () => {
  it('prend --provider, sinon YE_XPERIENCE_I18N_PROVIDER, sinon la première clé trouvée, sinon Claude', () => {
    expect(resolveProvider('gemini', undefined, {})).toMatchObject({ name: 'gemini', model: 'gemini-flash-latest' });
    expect(resolveProvider(undefined, 'gpt-x', { YE_XPERIENCE_I18N_PROVIDER: 'openai' }).model).toBe('gpt-x');
    expect(resolveProvider(undefined, undefined, { DEEPSEEK_API_KEY: 'k', MISTRAL_API_KEY: 'k' }).name).toBe('deepseek');
    expect(resolveProvider(undefined, undefined, {}).name).toBe('anthropic');
    expect(() => resolveProvider('grok', undefined, {})).toThrow(/Fournisseur inconnu/);
  });
});

describe('createTranslator (API compatible OpenAI)', () => {
  const entries: Entry[] = [{ id: 'Home.titre', text: 'Bonjour' }];
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const ok = (content: string) => reply(200, { choices: [{ finish_reason: 'stop', message: { content } }] });

  it('envoie la requête et valide la réponse', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test');
    const fetcher = ok('{"Home.titre":"Hello"}');
    expect(await createTranslator('deepseek', 'deepseek-flash', fetcher)(entries, 'fr', 'en')).toEqual({ 'Home.titre': 'Hello' });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    vi.unstubAllEnvs();
  });

  it('respecte OPENAI_BASE_URL', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('OPENAI_BASE_URL', 'http://localhost:11434/v1/');
    const fetcher = ok('{"Home.titre":"Hello"}');
    await createTranslator('openai', 'llama3', fetcher)(entries, 'fr', 'en');
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    vi.unstubAllEnvs();
  });

  it('erreurs lisibles', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => createTranslator('gemini', 'm')).toThrow(/GEMINI_API_KEY n’est pas défini/);
    vi.stubEnv('GEMINI_API_KEY', 'k');
    await expect(createTranslator('gemini', 'm', reply(401, {}))(entries, 'fr', 'en')).rejects.toThrow(/vérifie GEMINI_API_KEY/);
    await expect(createTranslator('gemini', 'oups', reply(404, {}))(entries, 'fr', 'en')).rejects.toThrow(/Modèle introuvable.*oups/);
    await expect(createTranslator('gemini', 'm', ok('pas du json'))(entries, 'fr', 'en')).rejects.toThrow(/invalide/);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(createTranslator('gemini', 'm', down)(entries, 'fr', 'en')).rejects.toThrow(UserError);
    vi.unstubAllEnvs();
  });
});

describe('clés enregistrées', () => {
  it('saveKey écrit hors du projet en 600, loadSavedKeys complète l’environnement sans écraser', () => {
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'ye-keys-')), OPENAI_API_KEY: 'env' };
    const file = saveKey('gemini', 'g-key', env);
    saveKey('openai', 'saved', env);
    expect(file).toBe(keysPath(env));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    loadSavedKeys(env);
    expect(env.GEMINI_API_KEY).toBe('g-key');
    expect(env.OPENAI_API_KEY).toBe('env');
  });

  it('clé Claude absente → erreur avant tout appel', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    expect(() => createTranslator('anthropic', 'claude-opus-5-5')).toThrow(/ANTHROPIC_API_KEY n’est pas défini/);
    vi.unstubAllEnvs();
  });
});
