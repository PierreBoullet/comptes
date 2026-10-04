# Synchronisation CMB via Powens

Powens fournit une connexion PSD2 et expose les comptes et opérations via une API. Le consentement CMB est donné dans la Webview Powens ; le projet ne stocke pas les identifiants CMB.

## Préparer Powens

1. Crée un domaine et une application dans la [console Powens](https://console.powens.com/auth/register).
2. Configure la Webview Connect et son URL de retour selon la documentation Powens.
3. Ouvre la Webview, sélectionne le CMB et autorise le compte à partager.
4. Récupère le jeton utilisateur permanent fourni par Powens.

Le domaine et le jeton sont des secrets. Ne les écris pas dans un fichier suivi par Git.

## Synchroniser les opérations

Dans le terminal :

```bash
export POWENS_DOMAIN="ton-domaine"
export POWENS_USER_TOKEN="ton-jeton-utilisateur"
python scripts/sync_powens.py --days 90
```

Le script écrit les nouvelles opérations dans `data/powens_YYYY-MM-DD.csv`. Il mémorise les identifiants Powens déjà exportés dans `data/.powens-state.json`, ignoré par Git.

Recharge ensuite le dashboard ou ouvre `http://localhost:8765/dashboard.html` pour importer le CSV.

## Limites

- La disponibilité exacte du connecteur CMB doit être confirmée dans la console Powens.
- Le consentement PSD2 doit être renouvelé lorsque Powens signale un état SCA, généralement au plus tard après 180 jours.
- Le script ne lance pas la Webview et ne demande jamais de mot de passe bancaire.