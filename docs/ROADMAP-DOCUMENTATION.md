# Roadmap : la documentation

Objectif : un développeur qui découvre l'outil doit pouvoir **l'essayer en 5 minutes**, **l'adopter dans son vrai projet en 30 minutes** et **trouver seul la réponse** quand quelque chose coince.

## Les 4 types de documents

Une bonne documentation répond à 4 besoins différents. Chacun a sa place :

| Besoin | Question du lecteur | Document |
| --- | --- | --- |
| **Découvrir** | « C'est quoi, et est-ce pour moi ? » | README (vitrine) |
| **Apprendre** | « Comment je l'utilise pas à pas ? » | Guide de démarrage |
| **Résoudre** | « Comment je fais X ? Pourquoi j'ai cette erreur ? » | Guides pratiques + dépannage |
| **Consulter** | « Quelle option fait quoi ? » | Référence (commandes, config) |
| **Comprendre** | « Comment ça marche dedans ? » | [ARCHITECTURE.md](ARCHITECTURE.md) (déjà écrit) |

## Structure cible

```
README.md                  vitrine en anglais (lien vers README.fr.md)
README.fr.md               vitrine en français
CHANGELOG.md               nouveautés de chaque version
CONTRIBUTING.md            installer le projet, lancer les tests, proposer une PR
docs/
  getting-started.md       premier essai pas à pas
  guides/
    existing-project.md    adopter l'outil sur un vrai projet (dry-run, relecture, commit)
    ai-providers.md        choisir une IA, coûts, clés, Ollama en local
    language-switcher.md   personnaliser ou déplacer le sélecteur
    after-init.md          ajouter des pages et des textes, sync, corriger une traduction
    ci.md                  lancer sync dans GitHub Actions avec --yes
  reference/
    commands.md            init, sync, translate : toutes les options
    config.md              .ye-xperience-i18n/config.json champ par champ
    generated-files.md     chaque fichier créé ou modifié, et pourquoi
    environment.md         toutes les variables d'environnement
  troubleshooting.md       erreurs connues et solutions
  limitations.md           ce que la V1 ne fait pas encore, et comment contourner
  ARCHITECTURE.md          fonctionnement interne (fait)
```

## Contenu de chaque document

### README (vitrine, 1 page)

L'ordre compte : le lecteur décide en 10 secondes.

1. Une phrase : ce que fait l'outil.
2. Un GIF de 15 secondes : `init`, puis la page qui passe de `/fr` à `/en`.
3. **Démarrage rapide** en 3 commandes : `git commit`, `npx ye-xperience-i18n init`, `pnpm build`.
4. Installation avec npm, pnpm, yarn et bun (tableau).
5. Exemple avant/après d'un composant.
6. Liste courte des fonctionnalités.
7. Liens vers les guides, la référence et le dépannage.
8. Limites principales (3 lignes) et licence.

### Guide de démarrage (`getting-started.md`)

Un tutoriel qui marche du premier coup, sur un projet neuf :

1. `npx create-next-app@latest mon-site`, puis ajouter 2 ou 3 textes en français.
2. `git commit`.
3. `npx ye-xperience-i18n init --dry-run` : lire le diff ensemble.
4. `npx ye-xperience-i18n init` : réponses conseillées à chaque question, saisie de la clé.
5. `pnpm build && pnpm start` : visiter `/fr`, `/en`, utiliser le sélecteur.
6. Ajouter un texte, puis `ye-i18n sync`.
7. « Et maintenant ? » : liens vers les guides.

Chaque étape montre **ce que la personne doit voir à l'écran**.

### Guides pratiques

Un guide = une tâche, avec un titre qui commence par un verbe :
- « Adopter l'outil sur un projet existant » ;
- « Choisir son IA et maîtriser les coûts » ;
- « Personnaliser le sélecteur de langue » ;
- « Ajouter une langue » (relancer `init` et cocher la nouvelle langue) ;
- « Corriger une traduction à la main » (éditer `messages/en.json` : la retouche est gardée) ;
- « Exclure un texte ou un dossier » (`i18n-ignore`, `--ignore`) ;
- « Traduire automatiquement dans la CI ».

### Référence

Exhaustive et sèche, faite pour être consultée :
- chaque commande, chaque option, sa valeur par défaut et un exemple ;
- chaque champ de `config.json`, son type et sa valeur par défaut ;
- chaque variable d'environnement ;
- chaque fichier généré.

### Dépannage (`troubleshooting.md`)

Format fixe : **message exact → cause → solution**. Les cas déjà rencontrés en test :

| Message | Solution |
| --- | --- |
| `Le repo git n'est pas propre` | `git commit` ou `git stash`, ou `--force` |
| `ERR_PNPM_IGNORED_BUILDS` | `pnpm approve-builds '!@parcel/watcher' '!@swc/core'` |
| `next build` : `Cannot find module '../../../app/page.js'` dans `.next/dev/types` | `rm -rf .next` puis rebuild |
| `XXX_API_KEY n'est pas défini` | relancer sans `--yes` pour saisir la clé, ou `export XXX_API_KEY=...` |
| `Modèle introuvable` | `--model <id>` avec un modèle actuel du fournisseur |
| `Layout racine introuvable` | il faut un `app/layout.tsx` |
| `git diff` ne montre que des suppressions | `git add -A && git diff --staged -M` (les pages sont déplacées) |

### Limites (`limitations.md`)

Pour chaque limite : un exemple, ce que fait l'outil (texte laissé tel quel + avertissement) et comment le faire à la main avec next-intl (lien vers la doc next-intl : ICU, `t.rich`, metadata).

## Règles d'écriture

- **Une idée par phrase**, des phrases courtes.
- **Tout exemple doit marcher** tel quel en copier-coller.
- **Montrer le résultat attendu** après chaque commande.
- Le même mot pour la même chose : « langue source », « langues cibles », « clé API », « sélecteur de langue ».
- Pas de « simplement » ni de « il suffit de » : ce qui est simple pour l'auteur ne l'est pas pour le lecteur.
- Les captures et GIF sont refaits à chaque changement visible.

## Planning

| Étape | Contenu | Quand |
| --- | --- | --- |
| 1 | README anglais + `README.fr.md`, GIF, tableau d'installation | Avant la 1re publication |
| 2 | `getting-started.md`, `troubleshooting.md`, `reference/commands.md` | Avant la 1re publication |
| 3 | `CONTRIBUTING.md`, `CHANGELOG.md` | Avant la 1re publication |
| 4 | Guides pratiques, `reference/config.md`, `generated-files.md`, `limitations.md` | Version 0.2 |
| 5 | Dépôt d'exemple avant/après avec déploiement Vercel | Version 0.2 |
| 6 | Site de documentation (quand les docs dépassent ~10 pages) : [Nextra](https://nextra.site) ou [Starlight](https://starlight.astro.build), hébergé gratuitement sur GitHub Pages ou Vercel | Version 1.0 |

## Faire vivre la documentation

- Toute PR qui change un comportement met à jour la doc **dans la même PR**.
- Chaque question posée dans une issue devient une entrée du dépannage ou un guide.
- Un test vérifie que l'aide du CLI (`--help`) et `reference/commands.md` listent les mêmes options.
