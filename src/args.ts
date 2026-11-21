import { parseArgs } from 'node:util';
import { UserError } from './utils/errors';

export const COMMANDS = ['init', 'sync', 'translate'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Options {
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  ignore: string[];
  provider?: string;
  model?: string;
  locale?: string;
}

export const HELP = `Usage : ye-i18n <commande> [options]   (ou ye-xperience-i18n)

Commandes :
  init                    Setup complet : langues, next-intl, extraction, traduction
  sync                    Extrait les nouveaux textes et ne traduit que ce qui a changé
  translate --locale <l>  Retraduit entièrement une langue

Options :
  --dry-run               Affiche le diff sans rien écrire
  -y, --yes               Sans questions (réutilise la config enregistrée)
  --force                 Autorise un repo git non propre
  --ignore <glob>         Fichiers à exclure (répétable)
  --provider <nom>        IA de traduction : anthropic, openai, gemini, deepseek, mistral,
                          openrouter (défaut : la première clé trouvée, ou YE_XPERIENCE_I18N_PROVIDER)
  --model <id>            Modèle (défaut selon le fournisseur, ou YE_XPERIENCE_I18N_MODEL)
  -h, --help              Affiche cette aide
  -v, --version           Affiche la version

Sans clé, la commande demande l'IA et la clé, et peut l'enregistrer dans
~/.config/ye-xperience-i18n/keys.json (hors du projet).
Clés API aussi lues dans : ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
DEEPSEEK_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY.
OPENAI_BASE_URL : toute autre API compatible OpenAI (Groq, Ollama…) avec --provider openai.`;

export function parseCli(argv: string[]): { command: Command | 'help' | 'version'; options: Options } {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        force: { type: 'boolean', default: false },
        ignore: { type: 'string', multiple: true, default: [] },
        provider: { type: 'string' },
        model: { type: 'string' },
        locale: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (err) {
    throw new UserError(`${(err as Error).message}\n\n${HELP}`);
  }
  const { values, positionals } = parsed;
  const options: Options = {
    dryRun: values['dry-run'],
    yes: values.yes,
    force: values.force,
    ignore: values.ignore,
    provider: values.provider,
    model: values.model ?? process.env.YE_XPERIENCE_I18N_MODEL,
    locale: values.locale,
  };

  if (values.version) return { command: 'version', options };
  const [command, ...rest] = positionals;
  if (values.help || !command) return { command: 'help', options };
  if (!COMMANDS.includes(command as Command)) throw new UserError(`Commande inconnue : "${command}".\n\n${HELP}`);
  if (rest.length) throw new UserError(`Argument inattendu : "${rest[0]}".`);
  if (command === 'translate' && !options.locale) throw new UserError('`translate` exige --locale <langue>.');
  if (command !== 'translate' && options.locale) throw new UserError('--locale ne s’utilise qu’avec `translate`.');
  return { command: command as Command, options };
}
