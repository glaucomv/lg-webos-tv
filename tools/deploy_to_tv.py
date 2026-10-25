import http.server
import socketserver
import threading
import time
import os
import sys
from tv_root import telnet_cmd, get_env_var

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FREE_MY_TV_DIR = os.path.join(ROOT_DIR, "free-my-tv")

TV_IP = get_env_var("TV_IP", "192.168.1.100")
HOST_IP = get_env_var("HOST_DEPLOY_IP", "192.168.1.50")
PORT = int(get_env_var("DEPLOY_HTTP_PORT", "8999"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FREE_MY_TV_DIR, **kwargs)

def deploy():
    ipk_path = os.path.join(FREE_MY_TV_DIR, "FreeMyTV-webos.ipk")
    if not os.path.exists(ipk_path):
        print(f"IPK not found at {ipk_path}. Building first...")
        os.system(f'python "{os.path.join(FREE_MY_TV_DIR, "webos", "build.py")}"')

    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("0.0.0.0", PORT), Handler)
    t = threading.Thread(target=server.serve_forever)
    t.daemon = True
    t.start()
    print(f"Local HTTP server serving IPK on port {PORT}...")

    time.sleep(0.5)

    print(f"TV ({TV_IP}) downloading IPK from http://{HOST_IP}:{PORT}/FreeMyTV-webos.ipk...")
    dl_res = telnet_cmd(f"curl -s -f -o /tmp/freemytv.ipk http://{HOST_IP}:{PORT}/FreeMyTV-webos.ipk && ls -lh /tmp/freemytv.ipk", timeout=10)
    print("TV download result:", dl_res)

    print("Installing on TV via Luna appInstallService...")
    inst_res = telnet_cmd("luna-send -n 1 luna://com.webos.appInstallService/dev/install '{\"id\":\"io.freemytv\",\"ipkUrl\":\"/tmp/freemytv.ipk\",\"subscribe\":false}'", timeout=15)
    print("TV install result:", inst_res)

    print("Launching Free My TV...")
    launch_res = telnet_cmd("luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"io.freemytv\"}'")
    print("TV launch result:", launch_res)

    server.shutdown()
    print("Deployment finished successfully!")

if __name__ == '__main__':
    deploy()
