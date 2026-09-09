# Suivi local des comptes

## Tableau de bord web

La page affiche les opérations depuis une base SQLite locale de référence. Tout est calculé localement : aucune donnée bancaire n'est envoyée ailleurs.

```bash
cd /home/pboullet/Perso/comptes
python3 server.py
```

Puis ouvre : <http://localhost:8765/dashboard.html>

Le serveur local importe les nouveaux CSV déposés dans `data`, les déplace dans `imported_files`, puis sauvegarde les corrections dans `reference.sqlite3`.

La page accepte les exports avec des colonnes usuelles : `Date`, `Libellé`, `Montant`, ou bien `Débit` / `Crédit`. Si un CSV contient déjà `Catégorie` et `Source`, ces colonnes sont conservées.

Pour ajouter de nouvelles opérations plus tard :

1. Connecte-toi manuellement au site de ta banque ou à Linxo.
2. Télécharge l'export CSV des opérations.
3. Place le fichier CSV dans le répertoire `data`.
4. Clique sur `Importer les nouveaux CSV` dans la page.

## Récupération manuelle du CSV

Ce mode évite de stocker ou d'automatiser des identifiants bancaires. L'authentification reste faite dans le navigateur, directement auprès de la banque ou de Linxo.

Le dashboard ne relit pas les CSV archivés : il affiche la base de référence. Les fichiers `*.csv` déposés dans `data` sont importés une seule fois, puis déplacés dans `imported_files`. Les catégories et libellés modifiés restent donc indépendants des fichiers d'origine.

Formats attendus :

- colonnes `Date`, `Libellé`, `Montant` ;
- ou colonnes `Date`, `Libellé`, `Débit`, `Crédit` ;
- colonne optionnelle `Catégorie` si tu veux conserver tes propres catégories ;
- colonne optionnelle `Source` pour identifier l'origine du fichier.

Exemple minimal :

```csv
Date;Libellé;Montant
2026-09-01;CARTE LECLERC;-42,50
2026-09-02;VIREMENT SALAIRE;2500,00
```

Plus de détails : [docs/import-csv-manuel.md](docs/import-csv-manuel.md).

## CSV initial depuis Excel

Le fichier `data/financements_transactions.csv` est généré depuis `Financements.xlsx` avec cette commande :

```bash
. .venv/bin/activate
python scripts/export_financements_transactions.py
```

Ce CSV contient les colonnes : `Date`, `Libellé`, `Montant`, `Catégorie`, `Type`, `Source`, `Feuille`, `Ligne`.

Un fichier de test est fourni dans `exemples/export-banque-exemple.csv` pour valider l'affichage sans utiliser de vraie donnée bancaire.

Fonctions disponibles :

- Synthèse recettes, dépenses, solde et nombre d'opérations.
- Répartition des dépenses par catégorie.
- Evolution mensuelle recettes/dépenses.
- Filtres par mois, catégorie et libellé.
- Modification du libellé et de la catégorie directement dans le tableau des opérations.
- Export des opérations classées au format CSV.

Les modifications faites dans le tableau sont sauvegardées dans `reference.sqlite3`. Les CSV d'origine sont conservés dans `imported_files` comme archive.

Les règles de catégorisation sont dans `categories.json`. Elles suivent deux niveaux : `type` (`Recettes` ou `Dépenses`), puis `category` (`Courses`, `Salaires`, etc.).

## Automatisation de Financements.xlsx

Ce dossier contient un importeur CSV pour remplir le classeur `Financements.xlsx` sans casser les formules existantes.

## Installation

```bash
cd /home/pboullet/Perso/comptes
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Si ton environnement force un index PyPI d'entreprise, lance l'installation avec tes accès habituels ou force l'index public :

```bash
PIP_CONFIG_FILE=/dev/null pip install --index-url https://pypi.org/simple "openpyxl>=3.1.5"
```

## Utilisation

Prévisualiser un import sans modifier le classeur :

```bash
python scripts/import_bank_csv.py export-banque.csv --sheet "Septembre 2026" --month 2026-09 --dry-run
```

Importer réellement :

```bash
python scripts/import_bank_csv.py export-banque.csv --sheet "Septembre 2026" --month 2026-09
```

Le script cherche automatiquement les colonnes CSV usuelles : `Date`, `Libellé`, `Montant`, ou bien `Débit` / `Crédit`.

## Ce que le script remplit

- Dépenses variables : colonnes `G`, `H`, `I`, `K`, lignes `44` à `247`.
- Recettes additionnelles : colonnes `B`, `C`, lignes `8` à `35`.
- Les formules existantes, notamment les colonnes `J` et l'onglet `Budget`, sont conservées.

## Catégorisation

Les règles sont dans `categories.json`. Chaque règle associe un ou plusieurs mots-clés bancaires à un type et une catégorie.

Exemple :

```json
{ "match": ["leclerc", "lidl"], "type": "Dépenses", "category": "Courses" }
```

Une opération non reconnue est classée en `Divers` par défaut.