-- Receipt Tracker Database Schema
-- Usage: mysql -u root -p < schema.sql
-- Or on VPS: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS receipt_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'receipt_user'@'localhost' IDENTIFIED BY 'strongpassword';
GRANT ALL PRIVILEGES ON receipt_db.* TO 'receipt_user'@'localhost';
FLUSH PRIVILEGES;

USE receipt_db;

CREATE TABLE IF NOT EXISTS links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(255) NULL,
  image_path VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  link_slug VARCHAR(64) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type ENUM('view','device','location') NOT NULL,
  ip VARCHAR(64) NULL,
  ip_asn VARCHAR(255) NULL,
  country VARCHAR(64) NULL,
  region VARCHAR(128) NULL,
  city VARCHAR(128) NULL,
  ua TEXT NULL,
  device_family VARCHAR(128) NULL,
  os_family VARCHAR(128) NULL,
  browser_family VARCHAR(128) NULL,
  referer VARCHAR(512) NULL,
  is_bot TINYINT(1) NOT NULL DEFAULT 0,
  latitude DOUBLE NULL,
  longitude DOUBLE NULL,
  accuracy_m DOUBLE NULL,
  accuracy_source VARCHAR(32) NULL,
  accuracy_radius_m DOUBLE NULL,
  payload JSON NULL,
  INDEX idx_events_link_slug (link_slug),
  INDEX idx_events_occurred_at (occurred_at),
  CONSTRAINT fk_events_link_slug FOREIGN KEY (link_slug) REFERENCES links(slug) ON DELETE CASCADE
) ENGINE=InnoDB;


