import http.server
import socket
import socketserver
import threading
import time
import os
import sys
from tv_root import telnet_cmd, get_env_var

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FREE_MY_TV_DIR = os.path.join(ROOT_DIR, "free-my-tv")

TV_IP = get_env_var("TV_IP", "192.168.1.100")


def detect_host_ip(target_ip):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect((target_ip, 23))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return get_env_var("HOST_DEPLOY_IP", "192.168.1.50")


HOST_IP = detect_host_ip(TV_IP)
PORT = int(get_env_var("DEPLOY_HTTP_PORT", "8999"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FREE_MY_TV_DIR, **kwargs)
    def log_message(self, format, *args):
        pass

def deploy():
    from verify_build import run_all_checks
    if not run_all_checks():
        sys.exit(1)

    print("Building fresh FreeMyTV-webos.ipk...")
    build_rc = os.system(f'python "{os.path.join(FREE_MY_TV_DIR, "webos", "build.py")}"')
    if build_rc != 0:
        print("Build failed!")
        sys.exit(1)

    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("0.0.0.0", PORT), Handler)
    t = threading.Thread(target=server.serve_forever)
    t.daemon = True
    t.start()
    print(f"Local HTTP server serving IPK on port {PORT}...")

    time.sleep(0.5)

    print("TV downloading IPK...")
    dl_res = telnet_cmd(f"rm -f /tmp/freemytv.ipk && curl -s -f -o /tmp/freemytv.ipk http://{HOST_IP}:{PORT}/FreeMyTV-webos.ipk && ls -lh /tmp/freemytv.ipk", timeout=12)
    print("TV download result:", dl_res)
    if "/tmp/freemytv.ipk" not in dl_res:
        server.shutdown()
        print("ERROR: TV failed to download IPK from host HTTP server!")
        sys.exit(1)

    print("Closing running instance if any...")
    telnet_cmd("luna-send -n 1 luna://com.webos.applicationManager/close '{\"id\":\"io.freemytv\"}'")
    time.sleep(1)

    print("Installing on TV via Luna appInstallService...")
    inst_res = telnet_cmd("luna-send -n 1 luna://com.webos.appInstallService/dev/install '{\"id\":\"io.freemytv\",\"ipkUrl\":\"/tmp/freemytv.ipk\",\"subscribe\":false}'", timeout=15)
    print("TV install result:", inst_res)

    print("Waiting for webOS package extraction to complete...")
    time.sleep(2.5)

    daemon_src = os.path.join(ROOT_DIR, "daemon", "15-sync-usb-photos.sh")
    if os.path.exists(daemon_src):
        with open(daemon_src, "r", encoding="utf-8") as f:
            d_content = f.read()
        print("Syncing USB photo manifest on TV...")
        telnet_cmd("mkdir -p /media/developer/apps/usr/palm/applications/io.freemytv/daemon")
        telnet_cmd(f"cat << 'EOF' > /media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh\n{d_content}\nEOF\nchmod +x /media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh", timeout=8)
        telnet_cmd("sh /media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh 2>/dev/null || true", timeout=20)

    print("Launching Free My TV...")
    for attempt in range(1, 7):
        launch_res = telnet_cmd("luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"io.freemytv\"}'")
        if '"returnValue":true' in launch_res or 'app is locked' not in launch_res:
            print(f"TV launch result (attempt {attempt}):", launch_res)
            break
        print(f"  App still unlocking (attempt {attempt})...")
        time.sleep(2)

    # Clean up temporary IPK from /tmp (RAM)
    telnet_cmd("rm -f /tmp/freemytv.ipk")

    server.shutdown()
    print("Deployment finished successfully!")

if __name__ == '__main__':
    deploy()
