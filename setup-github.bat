@echo off
echo ============================================
echo  Task-Manager - GitHub Setup Script
echo ============================================
echo.

cd /d "C:\Projects\tsk manager"

echo [1/5] Initializing git...
git init
git config user.email "yossib@tskeng-il.co.il"
git config user.name "YossiBuhnik"

echo.
echo [2/5] Staging all files...
git add .

echo.
echo [3/5] Creating first commit...
git commit -m "Initial commit: Task-Manager app"

echo.
echo [4/5] Renaming branch to main...
git branch -M main

echo.
echo [5/5] Opening GitHub to create the repo...
start https://github.com/new
echo.
echo -----------------------------------------------
echo ACTION NEEDED:
echo  1. GitHub just opened in your browser
echo  2. Set Repository name to:  task-manager
echo  3. Set it to PUBLIC
echo  4. Do NOT check any "Initialize" boxes
echo  5. Click "Create repository"
echo  6. Come back here and press any key
echo -----------------------------------------------
pause

echo.
echo Connecting to GitHub and pushing...
git remote add origin https://github.com/YossiBuhnik/task-manager.git
git push -u origin main

echo.
echo ============================================
echo  Done! Check https://github.com/YossiBuhnik/task-manager
echo ============================================
pause
