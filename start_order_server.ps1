# 工單管理系統啟動腳本 (MVC 架構版本)
# 此腳本用於啟動工單管理系統的 Flask 應用程式

# 設定 Python 執行檔路徑
$pythonPath = "C:/Users/ralf/AppData/Local/Microsoft/WindowsApps/python3.13.exe"

# 設定應用程式目錄
$appDirectory = "C:\app\order"

# 設定啟動腳本
$startScript = "run.py"

# 切換到應用程式目錄
Set-Location -Path $appDirectory

# 顯示啟動訊息
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "正在啟動工單管理系統 (MVC 架構)" -ForegroundColor Green
Write-Host "應用程式目錄: $appDirectory" -ForegroundColor Yellow
Write-Host "Python 路徑: $pythonPath" -ForegroundColor Yellow
Write-Host "啟動腳本: $startScript" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 啟動應用程式
& $pythonPath $startScript

# 如果應用程式異常結束，暫停以便查看錯誤訊息
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "應用程式異常結束，錯誤代碼: $LASTEXITCODE" -ForegroundColor Red
    Write-Host "請檢查 app_errors.log 以獲取更多資訊" -ForegroundColor Yellow
    pause
}
