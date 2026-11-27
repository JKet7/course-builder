@echo off
chcp 866 >nul
setlocal EnableExtensions
title Конструктор курсов - запуск

rem Запускает API (порт 4000) и клиент Vite (порт 5173),
rem затем открывает страницу приложения в браузере.
cd /d "%~dp0"

set "APP_URL=http://localhost:5173"

echo ================================================================
echo    КОНСТРУКТОР КУРСОВ - запуск сервера
echo ================================================================
echo.

rem --- 1. Node.js -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo [1/4] Node.js: %NODE_VER%

rem --- 2. Зависимости ---------------------------------------------
call :ensure_deps
if errorlevel 1 goto npm_fail
call :ensure_prisma
if errorlevel 1 goto prisma_fail
echo [2/4] Зависимости на месте

rem --- 3. Настройки и база данных ---------------------------------
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul
if exist "server\prisma\dev.db" goto db_ready
echo       База данных не найдена - создаем...
pushd server
call npx prisma migrate deploy
if errorlevel 1 (popd & goto db_fail)
call npm run db:seed
if errorlevel 1 (popd & goto db_fail)
popd
echo       База данных создана
:db_ready
echo [3/4] База данных готова

rem --- 4. Запуск API и клиента ------------------------------------
call :port_busy 4000
if "%BUSY%"=="1" goto api_ready
echo       Запускаем API на http://localhost:4000
start "Конструктор курсов - API (4000)" /d "%~dp0server" cmd /k "npm run dev"
:api_ready

call :port_busy 5173
if "%BUSY%"=="1" goto ui_started
echo       Запускаем интерфейс на %APP_URL%
start "Конструктор курсов - интерфейс (5173)" /d "%~dp0client" cmd /k "npm run dev"
:ui_started

echo [4/4] Ждем, пока интерфейс ответит...
set /a WAIT_TRIES=0
:wait_ui
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } } catch { }; exit 1" >nul 2>nul
if not errorlevel 1 goto ui_ready
set /a WAIT_TRIES+=1
if %WAIT_TRIES% GEQ 30 goto ui_slow
timeout /t 2 /nobreak >nul
goto wait_ui

:ui_ready
echo       Интерфейс отвечает: %APP_URL%
start "" "%APP_URL%"
echo.
echo ================================================================
echo   Сервер запущен, страница открыта в браузере.
echo.
echo   Вход: кнопка "Войти, как читатель" - без пароля и логина.
echo   Полный доступ - логин и пароль редактирования (выдает администратор).
echo.
echo   Окна "Конструктор курсов - API (4000)" и
echo   "Конструктор курсов - интерфейс (5173)" не закрывайте:
echo   это и есть работающий сервер. Свернуть их можно кнопкой
echo   "Свернуть" в правом верхнем углу окна.
echo.
echo   Остановка: файл "Остановить сервер.bat" в этой папке.
echo ================================================================
echo.
pause
exit /b 0

:ui_slow
echo       За 60 секунд интерфейс не ответил.
echo       Откройте окно "интерфейс (5173)" и посмотрите текст ошибки,
echo       затем запустите этот файл снова.
start "" "%APP_URL%"
echo.
pause
exit /b 0

:no_node
echo   Node.js не найден.
echo.
echo   Установите Node.js LTS (версия 20 или новее) с https://nodejs.org,
echo   перезапустите компьютер и снова откройте этот файл.
echo.
pause
exit /b 1

:npm_fail
echo   Не удалось установить зависимости.
echo   Проверьте интернет и выполните вручную в папках client и server:
echo       npm install
echo.
pause
exit /b 1

:db_fail
echo   Не удалось подготовить базу данных.
echo   Выполните вручную в папке server:
echo       npx prisma migrate deploy
echo       npm run db:seed
echo.
pause
exit /b 1

rem --- Вспомогательные подпрограммы -------------------------------

:ensure_deps
if not exist "client\node_modules" goto deps_install
if not exist "server\node_modules" goto deps_install
exit /b 0
:deps_install
echo       Первый запуск: устанавливаем зависимости (это долго)...
pushd "%~dp0client"
if exist node_modules goto deps_server
call npm install
if errorlevel 1 (popd & exit /b 1)
:deps_server
popd
pushd "%~dp0server"
if exist node_modules goto deps_done
call npm install
if errorlevel 1 (popd & exit /b 1)
:deps_done
popd
exit /b 0

:port_busy
rem Без ключа "-p tcp": Vite слушает IPv6 ([::1]:5173), а "-p tcp" - только IPv4.
set "BUSY=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:"LISTENING" ^| findstr /C:":%~1 "') do set "BUSY=1"
exit /b 0

rem --- Prisma Client ----------------------------------------------

:ensure_prisma
rem Prisma Client генерируется на каждом компьютере отдельно, поэтому
rem перенесенная папка node_modules без npm install не работает
rem (ошибка "does not provide an export named 'PrismaClient'").
if exist "server\node_modules\.prisma\client\index.js" exit /b 0
echo       Готовим Prisma Client (первый запуск на этом компьютере)...
pushd "%~dp0server"
call npx prisma generate
if errorlevel 1 (popd & exit /b 1)
popd
exit /b 0

:prisma_fail
echo   Не удалось подготовить Prisma Client.
echo.
echo   Выполните вручную в папке server:
echo       rmdir /s /q node_modules
echo       npm install
echo       npx prisma generate
echo   Для этого нужен доступ в интернет.
echo.
pause
exit /b 1