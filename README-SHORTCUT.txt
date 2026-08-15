MATIN!* — Créer un raccourci sur le Bureau
===========================================

Le fichier Matin.bat (à la racine du projet) lance l'application directement
via "npm run dev", sans avoir à ouvrir un terminal manuellement.

Pour l'épingler sur le Bureau :

1. Ouvrez le dossier du projet dans l'Explorateur Windows :
   C:\Users\anteq\Desktop\matin-windows\matin-windows

2. Clic droit sur Matin.bat

3. Choisissez "Envoyer vers" > "Bureau (créer un raccourci)"
   Un raccourci "Matin.bat - Raccourci" apparaît sur votre Bureau.

4. (Optionnel) Renommez le raccourci en "Matin" :
   clic droit dessus > Renommer.

5. (Optionnel) Changez son icône :
   clic droit > Propriétés > Changer d'icône...
   Vous pouvez pointer vers un fichier .ico de votre choix, ou en garder un
   par défaut.

Épingler à la barre des tâches ou au menu Démarrer :
- Clic droit sur le raccourci du Bureau (ou directement sur Matin.bat)
  > "Épingler à la barre des tâches" ou "Épingler à Démarrer".

À savoir :
- Double-cliquer sur le raccourci ouvre une fenêtre de terminal (obligatoire
  car "npm run dev" tourne dedans) puis la fenêtre de l'application Matin!*.
- Fermer la fenêtre de terminal arrête l'application.
- Le raccourci fonctionne quel que soit l'endroit où vous le placez : le
  script se replace automatiquement dans le dossier du projet avant de
  lancer npm.
