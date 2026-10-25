"""
Sync Wallpapers / Photos to LG Smart TV
Uploads local photos (from Google Photos, personal albums, etc.) directly to the TV.
"""
import os
import sys
import glob
import http.server
import socketserver
import threading
import time
from tv_root import telnet_cmd, get_env_var, TV_IP, TELNET_PORT

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_WALLPAPERS = os.path.join(ROOT_DIR, "free-my-tv", "web", "wallpapers")
TV_APP_WALLPAPERS = "/media/developer/apps/usr/palm/applications/io.freemytv/wallpapers"

HOST_IP = get_env_var("HOST_DEPLOY_IP", "192.168.1.50")
PORT = int(get_env_var("DEPLOY_HTTP_PORT", "8999"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=LOCAL_WALLPAPERS, **kwargs)

def sync_wallpapers(source_dir=None):
    if source_dir and os.path.isdir(source_dir):
        # Copy user files into local wallpapers folder
        import shutil
        for ext in ('*.jpg', '*.jpeg', '*.png', '*.webp'):
            for f in glob.glob(os.path.join(source_dir, ext)):
                shutil.copy2(f, LOCAL_WALLPAPERS)
        print(f"Copied new images from {source_dir} to {LOCAL_WALLPAPERS}")

    files = [f for f in os.listdir(LOCAL_WALLPAPERS) if not f.startswith('.')]
    if not files:
        print("No wallpapers found in", LOCAL_WALLPAPERS)
        return

    print(f"Syncing {len(files)} wallpaper(s) to LG TV ({TV_IP})...")
    telnet_cmd(f"mkdir -p {TV_APP_WALLPAPERS}")

    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("0.0.0.0", PORT), Handler)
    t = threading.Thread(target=server.serve_forever)
    t.daemon = True
    t.start()
    time.sleep(0.5)

    for fname in files:
        print(f"Transferring {fname}...")
        url = f"http://{HOST_IP}:{PORT}/{fname}"
        dest = f"{TV_APP_WALLPAPERS}/{fname}"
        res = telnet_cmd(f"curl -f -s -o '{dest}' '{url}' && ls -lh '{dest}'", timeout=8)
        print("  -> Result:", res)

    server.shutdown()
    print("All wallpapers synced successfully to TV!")
    print(telnet_cmd(f"ls -lh {TV_APP_WALLPAPERS}"))

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else None
    sync_wallpapers(src)
