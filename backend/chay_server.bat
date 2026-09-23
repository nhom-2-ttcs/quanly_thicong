@echo off
chcp 65001 > nul
echo ===================================================
echo   ĐANG KHỞI CHẠY SERVER QUẢN LÝ THI CÔNG (S-02)
echo ===================================================
"C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" server.js
pause
