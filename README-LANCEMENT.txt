Matin!* — Lancement sans Claude Code
=================================================

INSTALLATION (une seule fois)
------------------------------
1. Double-cliquez sur "create-shortcut.ps1".
   - Si Windows l'ouvre dans un editeur de texte au lieu de l'executer :
     faites un clic droit sur le fichier > "Executer avec PowerShell".
   - Si Windows affiche un avertissement de securite, cliquez sur
     "Executer quand meme" (le script vient d'un fichier local, pas d'internet).
2. Un raccourci "Matin" apparait alors sur votre Bureau.

UTILISATION (tous les matins)
------------------------------
Double-cliquez simplement sur le raccourci "Matin" du Bureau.
Une fenetre de console s'ouvre brievement puis l'application se lance
avec l'animation de lever de soleil, comme d'habitude.

Vous pouvez fermer la fenetre de console une fois l'application ouverte
si elle vous derange — cela ne ferme pas l'application elle-meme.

EN CAS DE PROBLEME
------------------------------
- Si le raccourci ne fonctionne plus (fichiers deplaces, etc.), relancez
  simplement "create-shortcut.ps1" pour le recreer.
- Le raccourci pointe vers "Matin.bat" a la racine du projet, qui execute
  "npm run dev" — verifiez que Node.js et les dependances du projet
  (npm install) sont bien installes sur cette machine.
