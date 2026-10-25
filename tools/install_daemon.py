import http.server
import socketserver
import threading
import time
import os
from tv_root import telnet_cmd, get_env_var

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAEMON_DIR = os.path.join(ROOT_DIR, "daemon")

TV_IP = get_env_var("TV_IP", "192.168.1.100")
HOST_IP = get_env_var("HOST_DEPLOY_IP", "192.168.1.50")
PORT = int(get_env_var("DEPLOY_HTTP_PORT", "8998"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DAEMON_DIR, **kwargs)

def install():
    server = socketserver.TCPServer(("0.0.0.0", PORT), Handler)
    t = threading.Thread(target=server.serve_forever)
    t.daemon = True
    t.start()
    print(f"HTTP server serving daemon from {DAEMON_DIR} on port {PORT}...")

    time.sleep(0.5)

    print("Stopping running instances on TV...")
    telnet_cmd("killall -9 10-home-intercept.sh 2>/dev/null; killall -9 luna-send 2>/dev/null; rm -f /tmp/tv_boot_pending /tmp/tv_is_standby")
    
    print(f"Downloading 10-home-intercept.sh to TV (/var/lib/webosbrew/init.d/)...")
    dl_res = telnet_cmd(f"curl -s -o /var/lib/webosbrew/init.d/10-home-intercept.sh http://{HOST_IP}:{PORT}/10-home-intercept.sh && chmod +x /var/lib/webosbrew/init.d/10-home-intercept.sh")
    print("Download result:", dl_res)

    server.shutdown()

    print("Starting daemon on TV...")
    telnet_cmd("/var/lib/webosbrew/init.d/10-home-intercept.sh")

    time.sleep(1.5)
    print("Processes running on TV:")
    print(telnet_cmd("pidof luna-send; ps w | grep 10-home-intercept.sh"))
    print("Log:")
    print(telnet_cmd("cat /tmp/home-intercept.log"))

if __name__ == '__main__':
    install()
