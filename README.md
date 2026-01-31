<p align="center">
  <img src="public/images/logo.png" alt="EvoSurf" width="120" />
</p>

# 🌊 EvoSurf

**Plateforme de Traffic Exchange** — Gagnez des crédits en surfant, diffusez votre site auprès de milliers de visiteurs, le tout dans une application moderne et sécurisée.

[![PHP](https://img.shields.io/badge/PHP-8.1+-777BB4?style=flat&logo=php&logoColor=white)](https://www.php.net/)
[![Laravel](https://img.shields.io/badge/Laravel-10-FF2D20?style=flat&logo=laravel&logoColor=white)](https://laravel.com/)
[![Electron](https://img.shields.io/badge/Electron-Desktop-2B2E2A?style=flat&logo=electron&logoColor=9FEAF9)](https://www.electronjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38B2AC?style=flat&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

---

## ✨ À quoi sert EvoSurf ?

EvoSurf est une **plateforme d’échange de trafic** qui met en relation :

| 👤 **Les surfeurs** | 🌐 **Les propriétaires de sites** |
|---------------------|-----------------------------------|
| Visitent des sites via une app dédiée et **gagnent des crédits** | **Achètent du trafic** pour faire connaître leur site |
| Utilisent ces crédits pour **promouvoir leurs propres sites** ou les dépenser en jeux / boutique | Définissent durée, budget et limites pour des visites ciblées |

L’administrateur gère utilisateurs, rangs, boutique, paiements (PayPal) et la modération des sites (Safe Browsing).

---

## 🎯 Ce qu’EvoSurf permet

### Pour les surfeurs
- 🌐 **Client Electron** — Application Windows dédiée pour le surf automatique (Local ou Live)
- 💰 **Crédits** — Gains en visitant des sites, bonus quotidien, parrainage avec commissions
- 🎰 **Mini-jeux** — Machine à sous, roue de la fortune (crédits en jeu)
- 📊 **Tableau de bord** — Statistiques, historique, gestion des sites à promouvoir

### Pour les propriétaires de sites
- 📈 **Tableau de bord** — Stats en temps réel, graphiques de visites
- ⚙️ **Configuration** — Durée de visite, coût en crédits, limites horaires/journalières
- 💳 **Budget** — Contrôle des dépenses et des plafonds

### Pour les administrateurs
- 👥 **Gestion des utilisateurs** — Comptes, rangs, avantages personnalisables
- 💳 **PayPal** — Boutique de crédits, abonnements VIP
- 🛡️ **Modération** — Intégration Google Safe Browsing pour les URLs
- 🎮 **Configuration** — Jeux (slots, roue), boutique, paramètres globaux

---

## 🛠 Stack technique

| Couche | Technologies |
|--------|--------------|
| **Backend** | Laravel 10, PHP 8.1+ |
| **Frontend** | Blade, Tailwind CSS, Alpine.js |
| **Client desktop** | Electron (visionneuse de surf) |
| **Base de données** | MySQL / MariaDB |
| **Paiements** | PayPal |
| **Cache** | File / Redis (configurable) |

---

## 🚀 Démarrage rapide

### Prérequis
- PHP 8.1+, Composer, Node.js & npm  
- MySQL ou MariaDB  

### Installation

```bash
git clone https://github.com/votre-org/evosurf.git
cd evosurf
cp .env.example .env
php artisan key:generate
```

Configurez `.env` (base de données, `APP_URL`, optionnel : `PAYPAL_*`), puis :

```bash
composer install
npm install && npm run build
php artisan migrate
php artisan storage:link
php artisan serve
```

📖 **Installation détaillée** (Laragon, production, Hostinger) : [INSTALL.md](INSTALL.md)

### Client Electron (visionneuse)

```bash
cd electron
npm install
# Définir l’URL du client dans .env (CLIENT_URL) ou config.json
npm start
```

Build de l’exécutable Windows : [electron/BUILD.md](electron/BUILD.md)

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [INSTALL.md](INSTALL.md) | Installation locale et production |
| [DEPLOY.md](DEPLOY.md) | Déploiement (Git, CI, Hostinger) |
| [docs/](docs/) | Backup, PayPal, Hostinger, visionneuse, tests |
| [electron/BUILD.md](electron/BUILD.md) | Build du client Electron (.exe) |

---

## 🛡 Sécurité

- Protection CSRF, rate limiting, validation des entrées  
- Mots de passe hashés (bcrypt), audit logging  
- Modération des sites (Google Safe Browsing)  
- CORS et transactions base de données pour la cohérence  

---

## 📝 Licence

[Précisez votre licence ici]

---

<p align="center">
  <strong>EvoSurf</strong> — Plateforme Traffic Exchange<br>
  Développé pour la communauté · <em>Version 2.0</em>
</p>
