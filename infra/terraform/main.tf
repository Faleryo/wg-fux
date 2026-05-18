terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

variable "do_token" {}
variable "ssh_fingerprint" {}

provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_droplet" "wg_fux_prod" {
  image  = "ubuntu-22-04-x64"
  name   = "wg-fux-platinum"
  region = "fra1"
  size   = "s-1vcpu-2gb" # Platinum standard recommends 2GB RAM for WireGuard + AdGuard
  ssh_keys = [var.ssh_fingerprint]

  user_data = <<-EOF
              #!/bin/bash
              apt-get update
              apt-get install -y docker.io docker-compose wireguard
              mkdir -p /opt/wg-fux
              cd /opt/wg-fux
              # The rest would be handled by your CI/CD or a manual git clone
              EOF
}

output "ip_address" {
  value = digitalocean_droplet.wg_fux_prod.ipv4_address
}
