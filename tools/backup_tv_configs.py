"""
Backup TV Configurations & Original Files
Pulls important original system files, device info, and installed app registry
from the LG Smart TV via Telnet.
"""
import os
import json
import re
from tv_root import telnet_cmd, get_env_var, TV_IP, TELNET_PORT

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(ROOT_DIR, "backups")

def run_backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    print(f"Connecting to TV at {TV_IP}:{TELNET_PORT}...")

    # 1. Device Info & OS release
    print("Backing up device & OS release info...")
    os_rel = telnet_cmd("cat /etc/os-release 2>/dev/null")
    uname = telnet_cmd("uname -a")
    device_info = f"=== OS Release ===\n{os_rel}\n\n=== Kernel / Architecture ===\n{uname}\n"
    with open(os.path.join(BACKUP_DIR, "device_info.txt"), "w", encoding="utf-8") as f:
        f.write(device_info)

    # 2. WebOSBrew Original Startup script
    print("Backing up /var/lib/webosbrew/startup.sh...")
    startup_sh = telnet_cmd("cat /var/lib/webosbrew/startup.sh 2>/dev/null", timeout=8)
    if startup_sh and "Startup script" in startup_sh:
        with open(os.path.join(BACKUP_DIR, "webosbrew_startup.sh"), "w", encoding="utf-8", newline="\n") as f:
            f.write(startup_sh + "\n")

    # 3. Power-On app config
    print("Backing up /var/lib/webosbrew/power_on_app...")
    power_on = telnet_cmd("cat /var/lib/webosbrew/power_on_app 2>/dev/null")
    with open(os.path.join(BACKUP_DIR, "power_on_app.txt"), "w", encoding="utf-8") as f:
        f.write(power_on.strip() + "\n")

    # 4. Installed Apps List
    print("Backing up installed apps list via Luna bus...")
    raw_apps = telnet_cmd("luna-send -n 1 luna://com.webos.applicationManager/listApps '{}'", timeout=12)
    try:
        data = None
        for line in raw_apps.splitlines():
            line = line.strip()
            if line.startswith("{") and '"apps":' in line:
                data = json.loads(line)
                break
        if data and "apps" in data:
            apps = data.get("apps", [])
            apps_sorted = sorted(apps, key=lambda x: x.get("id", ""))
            with open(os.path.join(BACKUP_DIR, "installed_apps.json"), "w", encoding="utf-8") as f:
                json.dump({"total": len(apps_sorted), "apps": apps_sorted}, f, indent=2, ensure_ascii=False)
            print(f"Successfully backed up {len(apps_sorted)} apps to backups/installed_apps.json")
        else:
            raise ValueError("No valid apps payload found")
    except Exception as e:
        print(f"Warning: Failed to parse apps JSON: {e}")
        with open(os.path.join(BACKUP_DIR, "installed_apps.raw.txt"), "w", encoding="utf-8") as f:
            f.write(raw_apps)

    print(f"Backup complete! Files saved in: {BACKUP_DIR}")

if __name__ == '__main__':
    run_backup()
