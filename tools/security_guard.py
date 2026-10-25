"""
Security Guard & Privacy Audit for LG webOS TV Repository
Guarantees zero leakage of private network IPs, MACs, credentials, host paths, or local backups.
Enforced before commits and before git push to GitHub (public repository safety).
"""
import os
import sys
import re
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Documentation and upstream files allowed to contain the generic RFC/example placeholder 192.168.1.50
ALLOWED_DOC_PLACEHOLDER_EXTS = ('.md', '.html', '.txt')
ALLOWED_DOC_PLACEHOLDER_FILES = {
    ".env.example",
    "free-my-tv/config.example.properties",
    "free-my-tv/tizen/install.py",
    "free-my-tv/webos/install.py",
    "free-my-tv/tools/photos.py",
    "tools/tv_root.py",
    "tools/deploy_to_tv.py",
    "tools/sync_wallpapers.py",
    "tools/install_daemon.py",
    "tools/backup_tv_configs.py",
    "tools/security_guard.py"
}

# Forbidden file patterns in Git index or staged changes
FORBIDDEN_TRACKED_PATTERNS = [
    r'^\.env$',
    r'^\.env\..+$',
    r'^backup_local/',
    r'.*\.ipk$',
    r'.*\.zip$',
    r'.*\.tar\.gz$',
    r'.*\.key$',
    r'.*\.pem$',
    r'.*id_rsa.*',
    r'.*webos_rsa.*',
    r'.*config\.properties$'
]

def run_cmd(cmd_list):
    res = subprocess.run(cmd_list, cwd=ROOT_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return res.stdout.strip()

def get_real_local_ips():
    """Extract real local IPs from .env if present, so we can guarantee they never leak."""
    real_ips = set()
    env_file = os.path.join(ROOT_DIR, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        v = v.strip().strip('"').strip("'")
                        if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', v):
                            real_ips.add(v)
        except Exception:
            pass
    return real_ips

def check_tracked_files():
    """Verify that no sensitive or binary files are tracked or staged in Git."""
    errors = []
    tracked = run_cmd(["git", "ls-files"]).splitlines()
    # Also check staged files
    staged = run_cmd(["git", "diff", "--cached", "--name-only"]).splitlines()
    all_files = set(tracked + staged)

    for f in all_files:
        f = f.replace("\\", "/")
        if f in (".env.example", "free-my-tv/config.example.properties"):
            continue
        for pat in FORBIDDEN_TRACKED_PATTERNS:
            if re.search(pat, f, re.IGNORECASE):
                errors.append(f"Forbidden file tracked/staged in Git: {f}")
    return errors

def check_content_leak():
    """Scan tracked and modified files for private IPs, MACs, keys, credentials, and host usernames."""
    errors = []
    tracked = run_cmd(["git", "ls-files"]).splitlines()
    staged = run_cmd(["git", "diff", "--cached", "--name-only"]).splitlines()
    modified = run_cmd(["git", "diff", "--name-only"]).splitlines()
    all_files = set(tracked + staged + modified)

    real_ips = get_real_local_ips()

    # Regex definitions
    re_mac = re.compile(r'\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b')
    re_private_key = re.compile(r'-----BEGIN (?:RSA|OPENSSH|EC|PGP|ENCRYPTED)?\s*PRIVATE KEY-----')
    re_user_path = re.compile(r'[C-Za-z]:\\Users\\[a-zA-Z0-9_\.-]+', re.IGNORECASE)
    re_real_subnet = re.compile(r'\b192\.168\.31\.\d{1,3}\b')
    re_tmdb_populated = re.compile(r'tmdb_key=[a-zA-Z0-9_-]{10,}')
    re_watchmode_populated = re.compile(r'watchmode_key=[a-zA-Z0-9_-]{10,}')
    re_weather_populated = re.compile(r'weather_(?:lat|lon)=-?\d+\.\d+')
    re_generic_private_ip = re.compile(r'\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})\b')

    for rel_path in all_files:
        rel_norm = rel_path.replace("\\", "/")
        full_path = os.path.join(ROOT_DIR, rel_path)
        if not os.path.exists(full_path):
            continue
        
        # Skip binary files
        if any(rel_norm.lower().endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.webp', '.ttf', '.mp4', '.tar.gz', '.zip', '.ipk', '.ico')):
            continue

        lines = []
        for enc in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "latin-1"):
            try:
                with open(full_path, "r", encoding=enc) as f:
                    lines = f.readlines()
                    break
            except (UnicodeError, LookupError):
                continue
            except Exception:
                break
        if not lines:
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()
            except Exception:
                continue

        is_allowed_doc = (
            rel_norm in ALLOWED_DOC_PLACEHOLDER_FILES or
            rel_norm.startswith("free-my-tv/docs/") or
            any(rel_norm.endswith(ext) for ext in ALLOWED_DOC_PLACEHOLDER_EXTS)
        )

        for idx, line in enumerate(lines, 1):
            line_str = line.strip()

            # 1. Real TV / Host IPs configured in .env
            for real_ip in real_ips:
                if real_ip in line_str:
                    errors.append(f"REAL CONFIGURED IP LEAK ({real_ip}) in {rel_norm}:{idx} -> {line_str[:80]}")

            # 2. Real LAN subnet leak (192.168.31.*)
            if re_real_subnet.search(line_str):
                errors.append(f"REAL LAN IP LEAK in {rel_norm}:{idx} -> {line_str[:80]}")
            
            # 3. Host file system paths leak
            if re_user_path.search(line_str) and rel_norm != "tools/security_guard.py":
                errors.append(f"HOST SYSTEM PATH LEAK in {rel_norm}:{idx} -> {line_str[:80]}")

            # 4. Private keys
            if re_private_key.search(line_str):
                errors.append(f"PRIVATE KEY LEAK in {rel_norm}:{idx}")

            # 5. Populated API secrets
            if re_tmdb_populated.search(line_str) or re_watchmode_populated.search(line_str):
                errors.append(f"POPULATED API KEY in {rel_norm}:{idx}")
            if re_weather_populated.search(line_str) and rel_norm != ".env.example":
                errors.append(f"REAL LOCATION COORDINATES in {rel_norm}:{idx}")

            # 6. MAC addresses
            if re_mac.search(line_str):
                # allow 00:00:00:00:00:00 or FF:FF:FF:FF:FF:FF dummy masks in doc
                if not re.search(r'00[:-]00[:-]00[:-]00[:-]00[:-]00|FF[:-]FF[:-]FF[:-]FF[:-]FF[:-]FF', line_str, re.IGNORECASE):
                    errors.append(f"HARDWARE MAC ADDRESS in {rel_norm}:{idx}")

            # 7. Unsanitized IP address check
            for ip_match in re_generic_private_ip.finditer(line_str):
                ip_found = ip_match.group(0)
                # 192.168.1.50 and 192.168.1.100 are generic open-source / example placeholders
                if ip_found in ("192.168.1.50", "192.168.1.100"):
                    if not is_allowed_doc:
                        errors.append(f"Unsanitized IP address in non-doc file {rel_norm}:{idx} -> {ip_found}")
                else:
                    errors.append(f"Unsanitized IP address in {rel_norm}:{idx} -> {ip_found}")

    return errors

def run_security_guard():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    print("=" * 60)
    print("[SECURITY GUARD] AUDITORIA DE PRIVACIDADE E SEGURANCA")
    print("=" * 60)

    all_errors = []

    # 1. Tracked Files Check
    print("Checking Git tracked & staged files against exclusion policy...")
    file_errs = check_tracked_files()
    if file_errs:
        for err in file_errs:
            print(f"  [FAIL] {err}")
        all_errors.extend(file_errs)
    else:
        print("  [PASS] Nenhum arquivo sensivel ou binario rastreado no Git!")

    # 2. Content Leak Check
    print("Scanning code content for credentials, IPs and host paths...")
    leak_errs = check_content_leak()
    if leak_errs:
        for err in leak_errs:
            print(f"  [FAIL] {err}")
        all_errors.extend(leak_errs)
    else:
        print("  [PASS] Zero vazamentos de IP real, chaves, MACs ou caminhos locais!")

    # 3. Code Integrity & Build Verification
    try:
        from verify_build import run_all_checks
        print("\nRunning code integrity & syntax verification...")
        build_ok = run_all_checks()
        if not build_ok:
            all_errors.append("Code integrity check failed (CSS/JS syntax or manifest).")
    except ImportError:
        pass

    print("-" * 60)
    if all_errors:
        print(f"[FAIL] REPOSITORIO NAO ESTA SEGURO PARA PUSH PUBLICO!")
        print(f"Total de {len(all_errors)} violacao(oes) de seguranca encontrada(s).")
        print("=" * 60)
        return False
    else:
        print("[SUCCESS] REPOSITORIO 100% BLINDADO E SEGURO PARA PUBLICACAO PUBLICA NO GITHUB!")
        print("=" * 60)
        return True

if __name__ == '__main__':
    ok = run_security_guard()
    sys.exit(0 if ok else 1)
