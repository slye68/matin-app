# Session autonome — 6 nouveaux modules

**Statut : terminée.** Les 6 modules demandés ont été construits, câblés
(config/registre/CSS/scripts) et l'app relance sans erreur. Le contenu
ci-dessous a été fusionné dans `CONTEXT.md` (sections "Modules", "Décisions
techniques clés", "Roadmap restante") — ce fichier peut être supprimé une fois
relu, il ne contient rien qui ne soit pas déjà dans CONTEXT.md.

## À faire par vous (actions manuelles impossibles à automatiser)

1. **Colis** : créer un compte gratuit sur 17track.net, récupérer une clé API, la mettre dans `.env` → `TRACK17_API_KEY=...`. Activer le module "Colis" dans Paramètres, y ajouter vos numéros de suivi.
2. **Cinéma** : créer un compte gratuit sur themoviedb.org, récupérer une clé API, la mettre dans `.env` → `TMDB_API_KEY=...`. Activer le module "Cinéma" dans Paramètres.
3. **Philips Hue** : dans Paramètres → Philips Hue, cliquer "Découvrir" (trouve l'IP du pont automatiquement), puis appuyer physiquement sur le gros bouton rond du pont et cliquer "Appairer" dans les ~30 secondes qui suivent.
4. Pour les 3 modules ci-dessus, relancer l'app après avoir ajouté une clé/appairé (les clés sont lues au démarrage).
5. **Vérifier en priorité au premier essai réel** : la réponse `gettrackinfo` de 17TRACK n'a pas pu être testée sans clé — si le module Colis affiche "Statut inconnu" ou une couleur qui semble fausse une fois configuré, la structure de champs dans `parcelsNormalizeStatus` (`renderer/modules/parcels.js`) est probablement à ajuster à la vraie réponse (regarder la console DevTools, `console.warn` déjà en place pour afficher les erreurs).

Journal des décisions techniques ci-dessous (déjà repris dans CONTEXT.md, gardé
ici pour le détail complet de la recherche source).

Démarré : 2026-08-05

## Décisions issues de la recherche technique (agent de fond)

- **Jeux gratuits — Epic** : `discountSetting.discountPercentage === 0` (pas 100) signale un jeu gratuit maintenant, confirmé sur données réelles (2 jeux gratuits actuellement : OTXO, Sol Cesto). Résolution du lien boutique fragile — `offerMappings[0].pageSlug` peut être `null` (404 GraphQL interne même en HTTP 200) : chaîne de repli `offerMappings → catalogNs.mappings → productSlug → urlSlug → lien générique /fr/free-games`.
- **Jeux gratuits — Steam, changement de plan** : `category1=998`/`F2P=1` sur l'API de recherche Steam ne filtre PAS réellement (vérifié : résultats mélangent jeux payants). Remplacé par une petite liste maison de jeux F2P connus (Team Fortress 2, Dota 2, CS2, Warframe, Path of Exile, Apex Legends, Destiny 2, Fortnite), vérifiés un par un via `appdetails` (`is_free` réel, pas une supposition) plutôt qu'une vraie découverte dynamique — compromis assumé : liste éditoriale fixe, mais chaque entrée est confirmée par l'API à chaque rafraîchissement, pas inventée. Aucun "free weekend" actif au moment du test (normal, événement occasionnel) — la section spéciales Steam 100%-off peut donc être vide la plupart du temps, ce n'est pas un bug.
- **Colis — 17TRACK retenu, AfterShip écarté** : la page tarifs live d'AfterShip confirme que l'accès API est réservé au plan payant "Premium" (~59$/mois) — aucun accès API sur le palier gratuit, donc inutilisable ici. 17TRACK a un vrai quota gratuit (100 enregistrements/mois d'après leur centre d'aide — un changement vers un quota unique au lieu de mensuel a été évoqué en recherche web sans confirmation ferme sur la page actuelle, à vérifier à l'inscription), quota consommé uniquement à l'enregistrement d'un NOUVEAU numéro (pas à chaque consultation de statut, ce qui convient bien à un dashboard qui revérifie les mêmes colis en boucle). Codes transporteurs confirmés : Colissimo/La Poste=6051, Chronopost=100273, UPS=100002, FedEx=100003, DHL=100001.
- **Cinéma — TMDb `discover/movie` retenu plutôt que `now_playing`** : `now_playing` est documenté comme une fenêtre glissante large ("actuellement en salle"), pas les sorties de la semaine. `discover/movie?region=FR&with_release_type=3&release_date.gte=...&lte=...&sort_by=popularity.desc` donne précisément les sorties théâtrales FR sur une plage de dates choisie.
- **17TRACK et TMDb non testés en conditions réelles avant livraison** — les deux exigent une clé API que je n'ai pas (contrairement à Epic/Steam/Air Quality/data.economie.gouv.fr, testés en direct avec de vraies réponses). Implémentés au plus près de la documentation/recherche, à vérifier au premier usage réel.

