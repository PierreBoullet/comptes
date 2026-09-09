# Import CSV manuel

Le dashboard utilise une base SQLite locale comme source de référence. Les nouveaux CSV sont déposés temporairement dans `data`, importés dans cette base, puis archivés dans `imported_files`.

## Utilisation

1. Connecte-toi manuellement au site du Crédit Mutuel de Bretagne, de ta banque ou de Linxo.
2. Télécharge l'export CSV des opérations.
3. Copie le fichier dans `data`.
4. Ouvre ou recharge `http://localhost:8765/dashboard.html`.
5. Clique sur `Importer les nouveaux CSV` si la page est déjà ouverte.

## Colonnes reconnues

Le CSV doit contenir un libellé et un montant.

Formats acceptés :

```csv
Date;Libellé;Montant
2026-09-01;CARTE LECLERC;-42,50
```

ou :

```csv
Date;Libellé;Débit;Crédit
2026-09-01;CARTE LECLERC;42,50;
2026-09-02;VIREMENT SALAIRE;;2500,00
```

Colonnes optionnelles :

- `Catégorie` : utilisée directement si elle existe ;
- `Source` : affichée dans le tableau pour identifier l'origine de l'opération.

Si `Catégorie` n'existe pas, le dashboard applique ses règles automatiques et classe le reste en `Divers`.

## Correction dans le dashboard

Tu peux modifier le libellé et la catégorie depuis le tableau. Les changements sont sauvegardés dans `reference.sqlite3`, et ne sont pas perdus lors d'un nouvel import.

Pour éviter les doublons, garde idéalement une convention de nommage simple, par exemple `cmb-2026-09.csv`, `cmb-2026-10.csv`.