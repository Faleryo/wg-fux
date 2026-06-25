#!/bin/bash
# Dependency installation / readiness helpers.

check_and_install_deps() {
    log_info "Checking host dependencies…"

    local missing=()
    command -v docker &>/dev/null || missing+=("docker")
    command -v wg     &>/dev/null || missing+=("wireguard-tools")
    command -v openssl &>/dev/null || missing+=("openssl")
    command -v curl   &>/dev/null || missing+=("curl")
    command -v node   &>/dev/null || command -v python3 &>/dev/null || missing+=("python3-or-node")

    # docker compose v2 (sub-command, not docker-compose binary)
    if command -v docker &>/dev/null && ! docker compose version &>/dev/null; then
        missing+=("docker-compose-v2")
    fi

    if [ "${#missing[@]}" -eq 0 ]; then
        _maybe_apply_low_ram_docker_tuning
        return 0
    fi

    log_warn "Missing: ${missing[*]} — attempting install."
    install_deps
    _maybe_apply_low_ram_docker_tuning
}

install_deps() {
    if ! command -v apt-get &>/dev/null; then
        log_error "Auto-install only supported on apt-based distros (Debian/Ubuntu). Install manually: docker, docker-compose-plugin, wireguard-tools, openssl, curl, python3 (or nodejs)."
        exit 1
    fi
    sudo apt-get update
    sudo apt-get install -y \
        docker.io docker-compose-v2 \
        wireguard-tools openssl curl \
        python3 nodejs
    sudo systemctl enable --now docker
    ensure_docker_ready
}

_maybe_apply_low_ram_docker_tuning() {
    local ram_kb ram_mb
    ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    ram_mb=$((ram_kb / 1024))
    [ "$ram_mb" -ge 1024 ] && return 0

    if [ -f /etc/docker/daemon.json ] && \
       grep -q '"max-concurrent-downloads"' /etc/docker/daemon.json; then
        return 0  # already tuned
    fi

    log_warn "Low RAM (${ram_mb}MB) — applying conservative docker daemon config."
    sudo mkdir -p /etc/docker
    sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "max-concurrent-downloads": 1,
  "max-concurrent-uploads": 1,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "iptables": true,
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 1024, "Soft": 1024 }
  }
}
JSON
    sudo systemctl restart docker 2>/dev/null || true
}

ensure_docker_ready() {
    local max_attempts=40 attempt=1

    if sudo docker ps &>/dev/null; then
        return 0
    fi

    sudo systemctl unmask docker.service docker.socket 2>/dev/null || true
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl restart docker 2>/dev/null \
        || sudo service docker restart 2>/dev/null \
        || true

    while [ "$attempt" -le "$max_attempts" ]; do
        if { [ -S /run/docker.sock ] || [ -S /var/run/docker.sock ]; } && sudo docker ps &>/dev/null; then
            log_success "Docker daemon is up."
            return 0
        fi

        if [ "$attempt" -eq 20 ] && [ "${DOCKER_REPAIR_TRIED:-false}" != "true" ]; then
            log_warn "Docker still not responsive after ${attempt} attempts — re-running deps install."
            export DOCKER_REPAIR_TRIED=true
            install_deps
        fi
        sleep 3
        attempt=$((attempt + 1))
    done

    log_error "Docker daemon never came up. Check 'systemctl status docker'."
    return 1
}
