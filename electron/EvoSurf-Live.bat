@echo off
REM Lance la visionneuse en mode LIVE (evosurf.fr)
REM Pour tester le site en production

cd /d "%~dp0"
set CLIENT_URL=https://www.evosurf.fr/surf/client

echo [Live] Lancement via npm start : %CLIENT_URL%
npm start
pause
