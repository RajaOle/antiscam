# Receipt Tracker (MySQL)

Consent-based tracker to generate unique links that display an image, ask for browser location permission, and log visit details (IP/provider, country/region/city, device, referrer, bot flag, and—when granted—GPS latitude/longitude/accuracy). Includes a minimal admin UI to create links, upload images, and view events on a map.

## Features

- Generate random links
- Upload and attach an image to each link
- Viewer page shows the image and requests location consent
- Logs: timestamp, IP/ASN (provider), country/region/city, full UA, device/OS/browser families, referrer, bot flag, latitude/longitude, accuracy and source
- Admin page to list events and plot locations with Leaflet

## Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Database
```bash
mysql -u root -p < schema.sql
```

### 3. Create .env File
```bash
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=receipt_user
MYSQL_PASSWORD=strongpassword
MYSQL_DATABASE=receipt_db
# Optional: IP geolocation enrichment
# IPINFO_TOKEN=your_ipinfo_token
```

### 4. Run
```bash
npm start
```

Visit http://localhost:3000/admin

## VPS Deployment (via GitHub)

### Quick Deploy
```bash
# Clone repository
git clone <your-repo-url> receipt-tracker
cd receipt-tracker

# Make deploy script executable
chmod +x deploy.sh

# Run deployment (installs MySQL, Node.js, sets up DB, creates service)
./deploy.sh
```

### Manual Deploy
```bash
# 1. Install MySQL (if not installed)
sudo apt update
sudo apt install -y mysql-server

# 2. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Clone and setup
git clone <your-repo-url> receipt-tracker
cd receipt-tracker
npm ci --omit=dev

# 4. Setup database
mysql -u root -p < schema.sql

# 5. Create .env file
nano .env
# Add your environment variables (see Local Development section)

# 6. Create systemd service
sudo nano /etc/systemd/system/receipt-tracker.service
# Copy content from deploy.sh or create manually

# 7. Start service
sudo systemctl daemon-reload
sudo systemctl enable receipt-tracker
sudo systemctl start receipt-tracker
```

### Environment Variables (.env)
```bash
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=receipt_user
MYSQL_PASSWORD=strongpassword
MYSQL_DATABASE=receipt_db
IPINFO_TOKEN=your_ipinfo_token  # Optional
```

## Usage

1. Visit `/admin` to create a link
2. Upload an image for the link
3. Share the generated URL (e.g., `http://yourdomain.com/abc123`)
4. When someone opens the link, they see the image and can consent to share location
5. View events in `/admin` by entering the slug

## Database Schema

The `schema.sql` file contains:
- Database creation (`receipt_db`)
- User creation (`receipt_user`)
- Two tables: `links` (tracking links) and `events` (visit data)

To apply schema:
```bash
mysql -u root -p < schema.sql
```

## Notes

- GPS-level location requires explicit browser permission by the visitor
- Without permission, only approximate IP geolocation is logged
- Do not use for covert tracking; provide a clear notice on the viewer page
- The schema.sql file is ready to deploy to any VPS with MySQL


