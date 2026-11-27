@echo off
chcp 866 >nul
setlocal EnableExtensions
title Конструктор курсов - остановка

rem Завершает процессы node.exe, слушающие порты 4000 (API) и 5173 (клиент),
rem и закрывает служебные окна, открытые файлом "Запустить сервер.bat".
cd /d "%~dp0"

echo Останавливаем сервер (порты 4000 и 5173)...
set "FOUND=0"
call :kill_port 4000
call :kill_port 5173
if "%FOUND%"=="0" echo   Работающий сервер не найден - он уже остановлен.

call :close_window "Конструктор курсов - API (4000)"
call :close_window "Конструктор курсов - интерфейс (5173)"

echo.
echo Готово. Чтобы запустить сервер снова, откройте
echo "Запустить сервер.bat".
timeout /t 3 /nobreak >nul
exit /b 0

rem --- Вспомогательные подпрограммы -------------------------------

:kill_port
rem Без ключа "-p tcp": Vite слушает IPv6 ([::1]:5173), а "-p tcp" - только IPv4.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:"LISTENING" ^| findstr /C:":%~1 "') do call :kill_pid %%P
exit /b 0

:kill_pid
tasklist /FI "PID eq %~1" /FI "IMAGENAME eq node.exe" 2>nul | findstr /I "node.exe" >nul
if errorlevel 1 exit /b 0
taskkill /F /T /PID %~1 >nul 2>nul
if errorlevel 1 exit /b 0
echo   Остановлен процесс node.exe (PID %~1)
set "FOUND=1"
exit /b 0

:close_window
taskkill /F /FI "WINDOWTITLE eq %~1" >nul 2>nul
exit /b 0
