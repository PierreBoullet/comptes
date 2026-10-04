# Agrégation bancaire

La piste Linxo Connect n'est pas retenue pour l'instant, car elle nécessite un accès API Linxo Connect et ses identifiants de domaine.

Un compte Linxo classique avec login/mot de passe ne fournit pas les informations nécessaires pour automatiser une récupération API : URL d'API, endpoint transactions et token d'accès API. Ces éléments existent seulement avec un accès API Linxo Connect.

Le flux retenu est désormais l'agrégation PSD2 via Powens :

1. autoriser le compte CMB dans la Webview Powens ;
2. exécuter `scripts/sync_powens.py` avec le domaine et le jeton utilisateur ;
3. laisser le dashboard importer le CSV généré.

Voir [powens.md](powens.md) pour la configuration et [import-csv-manuel.md](import-csv-manuel.md) pour le format CSV.