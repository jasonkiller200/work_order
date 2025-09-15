# Check and create virtual environment
if (-not (Test-Path ".\venv")) {
    Write-Host "Virtual environment not found, creating..."
    python -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment."
        exit 1
    }
    Write-Host "Virtual environment created successfully."
}

# Activate virtual environment
if ($IsWindows) {
    .\venv\Scripts\Activate.ps1
} else {
    . ./venv/bin/activate
}

# Check and install dependencies
Write-Host "Installing or updating dependencies..."
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install dependencies."
    exit 1
}
Write-Host "Dependencies installed/updated successfully."

# Run Flask application
Write-Host "Starting Flask application..."
python app.py
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start Flask application."
    exit 1
}
