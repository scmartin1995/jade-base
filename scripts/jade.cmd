@echo off
rem Jade launcher for Windows: starts the server if it isn't running, then opens the app window.
rem   jade            start (if needed) and open the window
rem   jade --serve    start the server only
rem   jade --stop     stop the server
rem The server runs as jade.exe (a copy of node.exe), so Task Manager shows "jade.exe" and End task works by name.
setlocal
set "APP=%~dp0.."
set "PORT=%JADE_PORT%"
if "%PORT%"=="" set "PORT=4778"
set "URL=http://127.0.0.1:%PORT%"
set "BIN=%LOCALAPPDATA%\Jade"
if not exist "%BIN%" mkdir "%BIN%"
for /f "delims=" %%n in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%n"
if not defined NODE ( echo Node.js 20+ is needed: https://nodejs.org & exit /b 1 )
if not exist "%BIN%\jade.exe" copy /y "%NODE%" "%BIN%\jade.exe" >nul

if /i "%~1"=="--stop" goto stop

curl -s -m 1 -o nul "%URL%/api/engines" >nul 2>&1
if errorlevel 1 (
  start "" /b "%BIN%\jade.exe" "%APP%\jade.js" --no-open
  for /l %%i in (1,1,40) do ( curl -s -m 1 -o nul "%URL%/api/engines" >nul 2>&1 && goto up & timeout /t 1 /nobreak >nul )
)
:up
if /i "%~1"=="--serve" ( echo Jade is running at %URL% & exit /b 0 )
rem The start link carries the key (read from the owner-only key file). It goes into a small file in the data folder that the window opens,
rem never onto a command line, where other users on this computer could read it, and never into a log.
set "HOMEDIR=%JADE_HOME%"
if "%HOMEDIR%"=="" set "HOMEDIR=%USERPROFILE%\JadeBase"
set "KEY=%JADE_TOKEN%"
if not defined KEY if exist "%HOMEDIR%\.state\token" set /p KEY=<"%HOMEDIR%\.state\token"
if not defined KEY ( echo Jade's key file was not found in %HOMEDIR%\.state & exit /b 1 )
set "OPEN=%HOMEDIR%\.state\open.html"
> "%OPEN%" echo ^<!doctype html^>^<meta charset="utf-8"^>^<meta name="referrer" content="no-referrer"^>^<title^>Opening Jade^</title^>^<meta http-equiv="refresh" content="0;url=%URL%/?key=%KEY%"^>
icacls "%OPEN%" /inheritance:r /grant:r "%USERNAME%:F" >nul 2>&1
set "FILEURL=file:///%OPEN:\=/%"
for %%b in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if exist %%b ( start "" %%b "--app=%FILEURL%" & exit /b 0 )
)
start "" "%FILEURL%"
exit /b 0
:stop
rem only this Jade: the launcher writes its pid into its own data folder. Every path is quoted, so a home folder with a space ("C:\Users\me two")
rem works: an unquoted name after "in" is read by for /f as the text to split, not as a file, and nothing was stopped.
set "HOMEDIR=%JADE_HOME%"
if "%HOMEDIR%"=="" set "HOMEDIR=%USERPROFILE%\JadeBase"
set "PIDF=%HOMEDIR%\.state\jade.pid"
set "STOPPED="
if exist "%PIDF%" (
  for /f "usebackq delims=" %%p in ("%PIDF%") do (
    rem only a process that is Jade's launcher (jade.exe, or node.exe from npm start): a pid left in a stale file may belong to another program now
    tasklist /fi "PID eq %%p" 2>nul | findstr /i "jade.exe node.exe" >nul && ( taskkill /pid %%p /t /f >nul 2>&1 & set "STOPPED=1" )
  )
  rem taskkill ends the launcher without its clean-up, so the file is removed here
  del "%PIDF%" >nul 2>&1
)
if defined STOPPED ( echo Jade stopped ) else ( echo Jade is not running )
exit /b 0
