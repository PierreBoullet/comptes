# Linxo Connect

Cette piste n'est pas retenue pour l'instant.

Un compte Linxo classique avec login/mot de passe ne fournit pas les informations nécessaires pour automatiser une récupération API : URL d'API, endpoint transactions et token d'accès API. Ces éléments existent seulement avec un accès API Linxo Connect.

Le flux retenu pour ce projet est donc plus simple et plus sain :

1. se connecter manuellement à la banque ou à Linxo ;
2. télécharger l'export CSV des opérations ;
3. déposer le fichier dans `data` ;
4. cliquer sur `Actualiser les CSV` dans le dashboard.

Voir [import-csv-manuel.md](import-csv-manuel.md).