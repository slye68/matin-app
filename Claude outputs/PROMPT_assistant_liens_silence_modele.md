# Prompt Claude Code : assistant vocal (liens du bloc-notes, silence 1,5 s, modèle Gemini)

Fichiers concernés : `renderer/modules/assistant.js` et `main/main.js` (handler `assistant:webSearch`). Lis les deux sections avant de modifier. Ne touche ni à l'avatar ni au reste du module.

---

## 1. Liens du bloc-notes incorrects

**Causes constatées dans le code :**
- (a) Le modèle recopie lui-même l'URL dans `show_note.source_url` / `show_source.url`. Un modèle audio ne sait pas recopier une chaîne exacte : il tronque, déforme ou invente l'URL.
- (b) Dans `assistant:webSearch` (main.js), les annonces DuckDuckGo ont aussi la classe `result__a`. Leur href est `duckduckgo.com/y.js?ad_…`, sans `uddg`, donc on garde un lien publicitaire DuckDuckGo.

**Correctifs :**

1. **main.js, `assistant:webSearch`** : ignore tout résultat dont l'URL finale a pour hôte `duckduckgo.com` (annonces, liens internes). Ignore aussi les blocs `result--ad` si tu peux les repérer. Garde 5 résultats valides au maximum.
2. **assistant.js, registre des sources** : ajoute `let assistantLastSources = [];`.
   - Dans `assistantWebSearch`, remplis-le avec `[{ n, url, title }]` : les URLs réelles, numérotées à partir de 1.
   - Le résultat renvoyé au modèle **ne contient plus d'URL**, seulement `n. titre — extrait [source n]`.
3. **Outils `show_note` et `show_source`** : remplace les paramètres `source_url` / `url` par `source` (`INTEGER`, numéro de la source web).
   - `assistantShowNote` et `assistantShowSource` résolvent l'URL via `assistantLastSources.find(s => s.n === source)`. Le libellé est le titre du résultat, tronqué à 60 caractères.
   - Si le numéro est inconnu, renvoie `{ error: 'Source inconnue : relance web_search.' }`.
   - Une URL fournie par le modèle n'est plus jamais acceptée.
4. **Sources Google Search** (voir §3) : si `serverContent.groundingMetadata?.groundingChunks` est présent, ajoute ses `web.uri` / `web.title` à `assistantLastSources`, à la suite des numéros existants. Si un bloc-notes a été créé dans les 30 dernières secondes, attache-lui aussi ces sources (3 au maximum). Ces liens passent par une redirection Google, c'est normal.
5. **`ASSISTANT_SYSTEM_PROMPT`** : mets à jour les lignes `show_note` et `show_source` : « passe `source` = numéro [source n] du résultat web ; ne recopie jamais d'URL ».

## 2. Fin d'écoute après 1,5 s de silence

- `ASSISTANT_SILENCE_MS` passe de `2500` à `1500`. Mets aussi à jour le commentaire au-dessus (« fin après 1,5s »).
- Ne change **pas** `ASSISTANT_FIRST_SILENCE_MS` (5 s au démarrage de session, le temps de commencer à parler) ni `ASSISTANT_AWAIT_REPLY_MS`.

## 3. Meilleur modèle + Google Search (infos à jour : cours de l'or, prix, actus)

**Constat :**
- `assistantPickLiveModel` donne +1 aux noms contenant « flash ». Il préfère donc `gemini-3.1-flash-live-preview`, un aperçu remplacé qui ne gère pas Google Search, au modèle stable actuel `gemini-3.8-live` (septembre 2026 : recherche Google, appels de fonctions, réflexion intégrée).
- La seule recherche disponible est DuckDuckGo en HTML. Ses extraits contiennent rarement un cours en temps réel.

**Correctifs :**

1. **`assistantPickLiveModel`** :
   - Si `await window.matin.store.get('assistant_model')` est renseigné et présent dans la liste, utilise-le.
   - Sinon, prends le premier modèle présent dans cet ordre : `gemini-3.8-live`, `gemini-2.5-flash-native-audio-preview-12-2025`, `gemini-3.1-flash-live-preview`. Compare sur `m.name` sans le préfixe `models/`.
   - En dernier recours, garde un score sans bonus « flash », qui préfère « live »/« native-audio » et pénalise preview/exp.
   - Logge le modèle retenu, comme aujourd'hui.
2. **Setup WebSocket**, dans `tools` :
   - Ajoute `{ google_search: {} }` à côté de `{ function_declarations: [...] }`, uniquement si le modèle n'est pas `gemini-3.1-flash-live-preview`, qui ne le gère pas.
   - Garde `web_search` (DuckDuckGo) : c'est lui qui fournit les liens du bloc-notes.
3. **Appels de fonctions** : sur `gemini-3.8-live`, les appels sont asynchrones (`NON_BLOCKING`) par défaut. Pour conserver le comportement actuel, ajoute `behavior: 'BLOCKING'` à **chaque** entrée de `function_declarations`.
4. **N'envoie pas** `thinking_config`, `proactive_audio` ou `enable_affective_dialog`. Ils sont refusés ou supprimés sur 3.8.
5. **`ASSISTANT_SYSTEM_PROMPT`**, ligne `web_search` : remplace-la par :
   - « google_search : pour toute information à jour (cours de bourse, de l'or, des devises, prix, actualité, résultats sportifs, horaires). Donne le chiffre précis et l'heure si disponible. »
   - « web_search : uniquement si l'utilisateur veut une source ou un lien affiché dans le bloc-notes, ou si google_search n'a rien donné. »

## Vérifications

1. `npm start`. La console affiche `Modèle Live utilisé : models/gemini-3.8-live`, ou le repli choisi avec la raison.
2. « Quel est le cours de l'or ? » : réponse chiffrée récente, sans « je n'ai pas accès ».
3. « Affiche-moi une recette de crêpes avec la source » : bloc-notes créé, le lien ouvre la vraie page, jamais `duckduckgo.com`.
4. Après une réponse, reste silencieux : la session se ferme environ 1,5 s après la fin de la voix. Au démarrage, tu as toujours 5 s pour commencer à parler.
5. Les commandes (lumières, thème, modules, Spotify) fonctionnent comme avant, les réponses d'outil arrivent toujours.

Commit : `fix(assistant): liens du bloc-notes fiables, silence 1,5s, gemini-3.8-live + Google Search`.
