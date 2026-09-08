# Suivi local des comptes

## Tableau de bord web

La page charge automatiquement tous les fichiers CSV présents dans le répertoire `data`. Tout est calculé localement : aucune donnée bancaire n'est envoyée ailleurs.

```bash
cd /home/pboullet/Perso/comptes
python3 server.py
```

Puis ouvre : <http://localhost:8765/dashboard.html>

Le serveur local fournit seulement la page web et la liste des fichiers `data/*.csv`.

La page accepte les exports avec des colonnes usuelles : `Date`, `Libellé`, `Montant`, ou bien `Débit` / `Crédit`. Si un CSV contient déjà `Catégorie` et `Source`, ces colonnes sont conservées.

Pour ajouter de nouvelles opérations plus tard, dépose simplement les exports CSV de ta banque dans `data`, puis clique sur `Actualiser les CSV` dans la page.

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
- Export des opérations classées au format CSV.

Les règles de catégorisation de la page sont dans `dashboard.js` pour les CSV bancaires qui n'ont pas déjà de colonne `Catégorie`. Les mêmes catégories sont aussi présentes dans `categories.json` pour le script d'import Excel.

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

Les règles sont dans `categories.json`. Chaque règle associe un ou plusieurs mots-clés bancaires à une catégorie du fichier.

Exemple :

```json
{ "match": ["leclerc", "lidl"], "category": "Courses" }
```

Une opération non reconnue est classée en `Divers` par défaut.