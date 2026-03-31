# 📊 API Specification: WG-FUX v3.1-Platinum

API endpoint: `http://<server-ip>:3000/api`

## Authentication
Most endpoints require a JWT token via `Authorization: Bearer <token>`.

## System Endpoints

### `GET /system/health`
**Description**: Full health check of the VPN system.
**Response**:
```json
{
  "status": "healthy",
  "service": "active",
  "interface": "up",
  "stats": {
    "cpu": "12.5",
    "memory": "45.2",
    "disk": "15.8"
  },
  "jobs": { ... },
  "version": "3.1.0-Platinum"
}
```

### `GET /system/stats`
**Description**: Get real-time traffic statistics.

### `POST /system/restart/:id`
**Description**: Restart a service (wireguard, dashboard, api).

## VPN Endpoints

### `GET /vpn/peers`
**Description**: Get all WireGuard peers and their statistics.

### `POST /vpn/peers`
**Description**: Create a new peer.

---
**Sentinel Watchdog** also uses these endpoints for Auto-Heal logic.
