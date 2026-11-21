import * as p from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { styleText } from "node:util";
import pkg from "../package.json";
import { HELP, type Options, parseCli } from "./args";
import { extract, type Messages, usedKeys } from "./extract";
import { askApiKey, askProvider, askSaveKey, getConfig } from "./prompts";
import { setupNextIntl } from "./setup";
import { transform } from "./transform";
import {
  type Cache,
  CACHE_PATH,
  flatten,
  translateAll,
  type Translator,
} from "./translate";
import {
  createTranslator,
  hasKey,
  keysPath,
  loadSavedKeys,
  PROVIDERS,
  resolveProvider,
  saveKey,
} from "./translate/providers";
import { type Config, saveConfig } from "./utils/config";
import { UserError } from "./utils/errors";
import { assertCleanGit } from "./utils/git";
import { detectProject, type Project } from "./utils/project";
import { VirtualFS } from "./utils/vfs";

export interface Deps {
  /** Remplace l'appel à l'IA (tests). */
  translator?: Translator;
}

/** Exécute une commande dans cwd. Rien n'est écrit sur le disque avant `finish()`. */
export async function run(
  argv: string[],
  cwd: string,
  deps: Deps = {},
): Promise<void> {
  const { command, options } = parseCli(argv);
  if (command === "help") return console.log(HELP);
  if (command === "version") return console.log(pkg.version);

  p.intro(`ye-xperience-i18n ${command}${options.dryRun ? " (dry-run)" : ""}`);
  const project = detectProject(cwd);
  // Le dry-run n'écrit rien : pas besoin d'un repo propre.
  if (!options.dryRun) assertCleanGit(cwd, options.force);
  p.log.info(
    `Next.js ${project.next.major}.${project.next.minor} · app/ dans ${project.srcDir || "la racine"} · ${project.packageManager}`,
  );

  const vfs = new VirtualFS(cwd);
  const config = await getConfig(command, project, options, vfs);
  // Pas d'appel à l'API en dry-run : rien ne serait conservé, donc pas besoin de clé.
  const ai = options.dryRun ? undefined : await getAi(options, deps);
  p.log.info(
    `${config.sourceLocale} → ${config.targetLocales.join(", ")} · dossiers : ${config.include.join(", ")}`,
  );

  let needsInstall = false;
  if (command === "init") {
    saveConfig(vfs, config);
    // Avant l'extraction : le layout devient async, donc reçoit getTranslations et non useTranslations.
    const setup = setupNextIntl(vfs, project, config);
    needsInstall = setup.needsInstall;
    for (const w of setup.warnings) p.log.warn(w);
  }

  const sourcePath = `messages/${config.sourceLocale}.json`;
  let source = vfs.readJson<Messages>(sourcePath, {});

  if (command === "translate") {
    if (!config.targetLocales.includes(options.locale!)) {
      throw new UserError(
        `"${options.locale}" n’est pas une langue cible (${config.targetLocales.join(", ")}).`,
      );
    }
  } else {
    const result = extract(vfs, config, source);
    const { items, skipped, sourceFiles } = result;
    p.log.step(
      `${items.length} texte(s) extrait(s) dans ${new Set(items.map((i) => i.file)).size}/${sourceFiles.length} fichier(s).`,
    );
    if (skipped.length) {
      p.log.warn(
        `${skipped.length} texte(s) laissé(s) tel(s) quel(s) (non géré par la V1) :\n` +
          skipped
            .map((s) => `${s.file}:${s.line}  « ${s.text} »  (${s.reason})`)
            .join("\n"),
      );
    }
    transform(result, vfs);
    source = result.messages;
    vfs.write(sourcePath, json(source));
    reportOrphans(source, result.sourceFiles, sourcePath);
  }

  await translate(vfs, config, source, options, ai);
  finish(vfs, options.dryRun);
  ai?.save?.();
  if (needsInstall)
    await install(
      project,
      options.dryRun,
      !options.yes && Boolean(process.stdin.isTTY),
    );
  else
    p.outro(
      options.dryRun
        ? "Dry-run terminé."
        : "Terminé. Relis le résultat avec `git diff`.",
    );
}

interface Ai {
  label: string;
  model: string;
  translator: Translator;
  /** Enregistre la clé saisie, après une traduction réussie. */
  save?: () => void;
}

/**
 * IA et clé : --provider, sinon variable d'env ou clé enregistrée. Aucune clé et terminal
 * interactif (sans --yes) → choix de l'IA, saisie de la clé, proposition de l'enregistrer.
 */
async function getAi(options: Options, deps: Deps): Promise<Ai> {
  loadSavedKeys();
  let provider = resolveProvider(options.provider, options.model);
  if (deps.translator) return { ...provider, translator: deps.translator };
  let save: (() => void) | undefined;
  if (!hasKey(provider.name) && !options.yes && process.stdin.isTTY) {
    provider = resolveProvider(
      options.provider ?? (await askProvider()),
      options.model,
    );
    const key = await askApiKey(PROVIDERS[provider.name]);
    process.env[PROVIDERS[provider.name].env] = key;
    if (await askSaveKey(keysPath()))
      save = () =>
        p.log.info(`Clé enregistrée dans ${saveKey(provider.name, key)}`);
  }
  return {
    ...provider,
    translator: createTranslator(provider.name, provider.model),
    save,
  };
}

async function translate(
  vfs: VirtualFS,
  config: Config,
  source: Messages,
  options: Options,
  ai?: Ai,
): Promise<void> {
  const label =
    ai?.label ?? resolveProvider(options.provider, options.model).label;
  const spinner = p.spinner();
  spinner.start(
    ai
      ? `Traduction avec ${ai.label} (${ai.model})…`
      : "Calcul des textes à traduire…",
  );
  let out;
  try {
    out = await translateAll({
      source,
      sourceLocale: config.sourceLocale,
      targetLocales: config.targetLocales,
      existing: Object.fromEntries(
        config.targetLocales.map((l) => [
          l,
          vfs.readJson<Messages>(`messages/${l}.json`, {}),
        ]),
      ),
      cache: vfs.readJson<Cache>(CACHE_PATH, {}),
      // Pas d'appel à l'API en dry-run : rien ne serait conservé.
      translator: ai?.translator,
      force: options.locale ? [options.locale] : undefined,
      onBatch: (locale, done, total) =>
        spinner.message(
          `Traduction ${config.sourceLocale} → ${locale} : lot ${done}/${total}`,
        ),
    });
  } catch (err) {
    spinner.error("Traduction interrompue : aucun fichier n’a été modifié.");
    throw err;
  }
  const detail = Object.entries(out.sent)
    .map(([l, n]) => `${l} : ${n}`)
    .join(", ");
  spinner.stop(
    options.dryRun
      ? `Textes qui seraient envoyés à ${label} (${detail}). Dans ce dry-run, ils gardent le texte source.`
      : `Textes traduits (${detail}).`,
  );
  for (const locale of config.targetLocales)
    vfs.write(`messages/${locale}.json`, json(out.messages[locale]));
  vfs.write(CACHE_PATH, json(out.cache));
}

/** Signale (sans supprimer) les clés source qu'aucun t('…') n'utilise plus. */
function reportOrphans(
  source: Messages,
  sourceFiles: Parameters<typeof usedKeys>[0],
  sourcePath: string,
): void {
  const { used, dynamic } = usedKeys(sourceFiles);
  const orphans = [...flatten(source).keys()].filter(
    (id) =>
      !used.has(id) && ![...dynamic].some((ns) => id.startsWith(`${ns}.`)),
  );
  if (orphans.length) {
    p.log.warn(
      `${orphans.length} clé(s) de ${sourcePath} ne semblent plus utilisées dans le code analysé.\n` +
        `Supprime-les à la main si c’est le cas (elles disparaîtront des traductions au prochain sync) :\n` +
        orphans.join("\n"),
    );
  }
}

const json = (data: unknown) => JSON.stringify(data, null, 2) + "\n";

/** Dernière étape : rien n'est écrit sur le disque avant ce point. */
function finish(vfs: VirtualFS, dryRun: boolean): void {
  const files = vfs.changedFiles();
  if (!files.length) return p.log.success("Aucun changement.");
  if (dryRun) {
    console.log(colorDiff(vfs.diff()));
    return p.log.success(
      `Dry-run : ${files.length} fichier(s) seraient modifiés, rien n’a été écrit.`,
    );
  }
  vfs.commit();
  p.log.success(`${files.length} fichier(s) écrit(s) :\n${files.join("\n")}`);
}

/** Installe next-intl après l'écriture (package.json déjà mis à jour). */
async function install(
  project: Project,
  dryRun: boolean,
  interactive: boolean,
): Promise<void> {
  const pm = project.packageManager;
  const command = `${pm} install`;
  const build = `${pm} run build`;
  if (dryRun)
    return p.outro(
      `next-intl serait ajouté aux dépendances puis installé avec \`${command}\`.`,
    );
  p.log.step(`Installation de next-intl (${command})…`);
  const options = { cwd: project.root, shell: process.platform === "win32" };
  // pnpm ≥ 10 sort en erreur quand des scripts d'installation sont bloqués (@swc/core et
  // @parcel/watcher, dépendances de next-intl). On l'en dispense pour cette commande seulement.
  const args =
    pm === "pnpm"
      ? ["install", "--config.strict-dep-builds=false"]
      : ["install"];
  const result = spawnSync(pm, args, { ...options, stdio: "inherit" });
  if (result.status !== 0) {
    return p.outro(
      `L’installation a échoué : lance \`${command}\` à la main. Les fichiers sont déjà écrits.`,
    );
  }
  const done = `Terminé. Relis le résultat avec \`git diff\`, puis lance \`${build}\`.`;
  if (pm !== "pnpm") return p.outro(done);

  // Autoriser ou refuser ces scripts est un choix du développeur : on le lui demande, sinon on l'explique.
  const ignored = [
    ...(
      spawnSync("pnpm", ["ignored-builds"], { ...options, encoding: "utf8" })
        .stdout ?? ""
    ).matchAll(/^ {2}(\S+)$/gm),
  ].map((m) => m[1]);
  if (!ignored.length) return p.outro(done);
  const deny = ignored.map((n) => `!${n}`);
  if (interactive) {
    const choice = await p.select({
      message: `pnpm a bloqué les scripts d’installation de ${ignored.join(", ")}. next-intl n’en a pas besoin.`,
      options: [
        { value: "deny", label: "Les refuser", hint: "conseillé" },
        { value: "allow", label: "Les autoriser" },
        { value: "later", label: "Choisir plus tard" },
      ],
    });
    if (choice === "deny" || choice === "allow") {
      const status = spawnSync(
        "pnpm",
        ["approve-builds", ...(choice === "deny" ? deny : ignored)],
        {
          ...options,
          stdio: "inherit",
        },
      ).status;
      if (status === 0) {
        p.log.success(
          "Choix enregistré dans pnpm-workspace.yaml (à commiter).",
        );
        return p.outro(done);
      }
    }
  }
  p.log.warn(
    `pnpm a bloqué les scripts d’installation de : ${ignored.join(", ")}.\n` +
      `Tant que tu n’as pas choisi, \`pnpm install\` sort en erreur. next-intl n’en a pas besoin pour fonctionner :\n` +
      `  refuser  : pnpm approve-builds ${deny.map((n) => `'${n}'`).join(" ")}\n` +
      `  autoriser : pnpm approve-builds ${ignored.join(" ")}`,
  );
  p.outro(done);
}

function colorDiff(diff: string): string {
  return diff
    .split("\n")
    .map((l) =>
      l.startsWith("+")
        ? styleText("green", l)
        : l.startsWith("-")
          ? styleText("red", l)
          : l.startsWith("@@")
            ? styleText("cyan", l)
            : l,
    )
    .join("\n");
}
