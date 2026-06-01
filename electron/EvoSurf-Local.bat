@echo off
REM =============================================================================
REM  EvoSurf - Mode LOCAL (Laragon / localhost)
REM  Utilise : http://127.0.0.1:8000/surf/client
REM
REM  MODE DEV  : npm start herite de CLIENT_URL.
REM  Ce script est fait pour tester le code source courant.
REM =============================================================================

cd /d "%~dp0"
set CLIENT_URL=http://127.0.0.1:8000/surf/client

echo [Local] Lancement via npm start : %CLIENT_URL%
npm start
pause
