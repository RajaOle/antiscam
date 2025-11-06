#!/bin/bash
# VPS Deployment Script for Receipt Tracker
# Run this on your VPS after cloning from GitHub

set -e

echo "🚀 Deploying Receipt Tracker..."

# Check if MySQL is installed
if ! command -v mysql &> /dev/null; then
    echo "❌ MySQL not found. Installing..."
    sudo apt update
    sudo apt install -y mysql-server
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --omit=dev

# Setup database
echo "🗄️  Setting up database..."
if [ -f .env ]; then
    source .env
    MYSQL_PASSWORD=${MYSQL_ROOT_PASSWORD:-""}
else
    echo "⚠️  .env file not found. Using default MySQL root (no password)"
    MYSQL_PASSWORD=""
fi

mysql -u root ${MYSQL_PASSWORD:+-p$MYSQL_PASSWORD} < schema.sql || {
    echo "⚠️  Database setup failed. You may need to run manually:"
    echo "   mysql -u root -p < schema.sql"
}

# Create directories
mkdir -p uploads static

# Setup systemd service (optional)
if [ ! -f /etc/systemd/system/receipt-tracker.service ]; then
    echo "📝 Creating systemd service..."
    sudo tee /etc/systemd/system/receipt-tracker.service > /dev/null <<EOF
[Unit]
Description=Receipt Tracker
After=network.target mysql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env
ExecStart=/usr/bin/node $(pwd)/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable receipt-tracker
    echo "✅ Service created. Start with: sudo systemctl start receipt-tracker"
else
    echo "✅ Service already exists. Restarting..."
    sudo systemctl restart receipt-tracker
fi

echo "✅ Deployment complete!"
echo "🌐 Visit http://$(hostname -I | awk '{print $1}'):3000/admin"

