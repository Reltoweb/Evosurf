@echo off
REM =============================================================================
REM  EvoSurf - Mode LOCAL (Laragon / localhost)
REM  Utilise l'Apache Laragon local : http://localhost/evosurfv2/public/surf/client
REM
REM  MODE DEV  : npm start herite de CLIENT_URL.
REM  Ce script est fait pour tester le code source courant.
REM =============================================================================

cd /d "%~dp0"
set CLIENT_URL=http://localhost/evosurfv2/public/surf/client

echo [Local] Lancement via npm start : %CLIENT_URL%
npm start
pause
