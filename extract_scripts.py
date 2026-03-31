import sys

def extract_blocks(file_path):
    with open(file_path, 'r') as f:
        lines = f.readlines()

    targets = [
        ("wg-apply-qos.sh", 837, "EOF"),
        ("wg-optimize.sh", 927, "EOF_SHELL"),
        ("wg-create-container.sh", 1311, "EOF_SHELL"),
        ("wg-remove-container.sh", 1331, "EOF_SHELL"),
        ("wg-create-client.sh", 1360, "EOF_SHELL"),
        ("wg-remove-client.sh", 1541, "EOF_SHELL"),
        ("wg-move-client.sh", 1568, "EOF"),
        ("wg-harden.sh", 1601, "EOF"),
        ("wg-backup.sh", 1610, "EOF"),
        ("wg-restore.sh", 1637, "EOF"),
        ("wg-check-expiry.sh", 1670, "EOF"),
        ("wg-enforcer.sh", 1688, "EOF"),
        ("wg-stats.sh", 1794, "EOF"),
        ("wg-toggle.sh", 1809, "EOF"),
        ("wg-monitor.sh", 1834, "EOF"),
        ("wg-health.sh", 1962, "EOF"),
        ("wg-users", 2007, "EOF"),
        ("wg-connection-history", 1990, "EOF"),
    ]

    for name, start_line, delimiter in targets:
        # start_line is 1-indexed in grep
        idx = start_line # This is the index of 'cat > ... <<'EOF''
        output_content = []
        found_end = False
        for i in range(idx, len(lines)):
            line = lines[i].strip()
            if line == delimiter:
                found_end = True
                break
            output_content.append(lines[i])
        
        if found_end:
            with open(f"core-vpn/scripts/{name}", "w") as out:
                out.writelines(output_content)
            print(f"Extracted {name}")
        else:
            print(f"Error: Could not find end of {name} starting at line {start_line}")

if __name__ == "__main__":
    extract_blocks("ai0.sh")
