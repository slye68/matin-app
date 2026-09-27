# Prompt Claude Code : l'assistant ouvre une recherche dans Google Chrome

**Objectif :** quand on demande à l'assistant vocal de « faire une recherche sur Internet », « chercher X sur Google » ou « ouvrir Chrome et chercher X », il passe par **la barre de recherche du dashboard** (formulaire `#titlebarSearch`, moteur choisi dans Paramètres → Services via `window.SearchEngines`) et ouvre le résultat **dans Google Chrome**.

Fichiers : `renderer/dashboard.js` (`initTitlebarSearch`), `renderer/modules/assistant.js`, `main/preload.js`, `main/main.js`. Lis ces sections avant de modifier. Si le prompt « liens / silence / modèle » a déjà été appliqué, garde ses changements (outils, system prompt, `behavior: 'BLOCKING'`).

---

## 1. main.js : ouvrir une URL dans Chrome

Ajoute un handler `ipcMain.handle('shell:openInChrome', async (_e, url) => …)`, placé près de `shell:openExternal` :

- **Validation** : refuse tout ce qui n'est pas `http(s)://`. Renvoie `{ ok: false, reason: 'url' }`.
- **Recherche de `chrome.exe`**, résultat mis en cache en mémoire :
  1. registre `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe` (valeur par défaut), puis la même clé sous `HKCU`, via `execFile('reg', ['query', …, '/ve'])`. `execFile` est déjà utilisé dans le fichier (`isProtocolRegistered`) ;
  2. `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\…`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (`fs.existsSync`).
- **Lancement** : `spawn(chromePath, [url], { detached: true, stdio: 'ignore' }).unref()`. Si Chrome est déjà ouvert, l'URL s'ouvre dans un nouvel onglet de la fenêtre existante. Renvoie `{ ok: true, browser: 'chrome' }`.
- **Chrome introuvable ou échec du spawn** : repli sur `shell.openExternal(url)`. Renvoie `{ ok: true, browser: 'default' }` et logge `[Chrome] introuvable, navigateur par défaut`.
- Import : ligne 7, `const { execFile } = require('child_process');` devient `const { execFile, spawn } = require('child_process');`. `fs` est déjà importé.
- Pas de `exec` avec chaîne shell : l'URL est passée en argument, jamais concaténée dans une commande.

**preload.js**, dans `shell` : ajoute `openInChrome: (url) => ipcRenderer.invoke('shell:openInChrome', url),`.

## 2. dashboard.js : rendre la barre de recherche réutilisable

Extrait la logique du `submit` de `initTitlebarSearch` dans une fonction globale :

```js
// Utilisée par la barre de recherche ET par l'assistant vocal.
async function runTitlebarSearch(query, { browser = 'default' } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'empty' };
  const input = document.getElementById('titlebarSearchInput');
  if (input) input.value = q;                       // la recherche apparaît dans la barre
  const engineId = (await window.matin.store.get('app.searchEngine')) || window.SearchEngines.DEFAULT;
  const engine = window.SearchEngines.findById(engineId);
  const url = window.SearchEngines.buildSearchUrl(engine.id, q);
  const res = browser === 'chrome'
    ? await window.matin.shell.openInChrome(url)
    : (await window.matin.shell.openExternal(url), { ok: true, browser: 'default' });
  return { ...res, engine: engine.label, query: q };
}
window.runTitlebarSearch = runTitlebarSearch;
```

- Le `submit` du formulaire appelle `runTitlebarSearch(query)`. Son comportement ne change pas : navigateur par défaut.
- Quand l'assistant l'utilise, ajoute un bref retour visuel sur `#titlebarSearch` : une classe `is-assistant` pendant 1,2 s (léger halo cyan dans `style.css`). Vide ensuite le champ.

## 3. assistant.js : nouvel outil `open_web_search`

1. **Déclaration**, dans `function_declarations`, avec `behavior: 'BLOCKING'` si les autres déclarations l'ont :
   ```js
   {
     name: 'open_web_search',
     description: "Ouvre une recherche Internet dans Google Chrome via la barre de recherche du dashboard (moteur configuré par l'utilisateur). À utiliser quand l'utilisateur demande de faire/lancer/ouvrir une recherche, de chercher quelque chose sur Internet ou sur Google, ou d'ouvrir Chrome pour chercher.",
     parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Termes à rechercher, reformulés proprement' } }, required: ['query'] },
   },
   ```
2. **Fonction** :
   ```js
   async function assistantOpenWebSearch({ query }) {
     if (typeof window.runTitlebarSearch !== 'function') return { error: 'Barre de recherche indisponible.' };
     const r = await window.runTitlebarSearch(query, { browser: 'chrome' });
     if (!r.ok) return { error: r.reason === 'empty' ? 'Requête vide.' : "Impossible d'ouvrir la recherche." };
     return { result: `Recherche « ${r.query} » ouverte sur ${r.engine} dans ${r.browser === 'chrome' ? 'Google Chrome' : 'le navigateur par défaut (Chrome introuvable)'}.` };
   }
   ```
   Ajoute `case 'open_web_search': return await assistantOpenWebSearch(args || {});` dans `assistantRunToolRaw`.
3. **`ASSISTANT_SYSTEM_PROMPT`**, ajoute une ligne :
   « - open_web_search : ouvre une recherche dans Google Chrome via la barre de recherche du dashboard. À utiliser dès que l'utilisateur veut *voir* une recherche (« fais une recherche sur… », « cherche … sur Internet/Google », « ouvre Chrome et cherche … »). Après l'appel, dis seulement que c'est ouvert. Pour une question dont tu donnes toi-même la réponse à voix haute (« quel est le cours de l'or ? »), n'utilise pas cet outil. »
4. `open_web_search` ne doit **pas** passer dans `ASSISTANT_TOOL_MODULES`, car aucun module n'est à rafraîchir.

## Vérifications

1. Dis « Fais une recherche sur les horaires de la déchetterie de Villefranche ». Chrome s'ouvre avec la recherche sur le moteur choisi, la requête s'affiche un instant dans la barre du dashboard, et l'assistant confirme brièvement.
2. Chrome déjà ouvert : l'URL s'ouvre dans un nouvel onglet, sans nouvelle fenêtre vide.
3. Change le moteur (Paramètres → Services, par exemple Qwant) et redemande une recherche : c'est bien Qwant qui s'ouvre dans Chrome.
4. Renomme temporairement le chemin Chrome dans le code : repli sur le navigateur par défaut, sans erreur.
5. Tape une recherche à la main dans la barre : comportement inchangé.
6. « Quel est le cours de l'or ? » : réponse orale, pas d'ouverture de Chrome.

Commit : `feat(assistant): recherche Internet ouverte dans Chrome via la barre de recherche`.
