import os
import socket
import time
import sys

def get_env_var(name, default=""):
    val = os.getenv(name)
    if val:
        return val
    # Try reading from .env in project root
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return default

TV_IP = get_env_var("TV_IP", "192.168.1.100")
TELNET_PORT = int(get_env_var("TV_TELNET_PORT", "23"))

def telnet_cmd(cmd, timeout=4, host=None, port=None):
    target_host = host or TV_IP
    target_port = port or TELNET_PORT
    s = socket.socket()
    s.settimeout(timeout)
    s.connect((target_host, target_port))
    time.sleep(0.2)
    try:
        s.recv(1024)
    except:
        pass
    
    start_marker = "__START_CMD_OUT__"
    end_marker = "__END_CMD_OUT__"
    # Break marker in shell command so terminal echo does not match end_marker early
    full_cmd = f"echo __START\"\"_CMD_OUT__; ({cmd}; echo ''); echo __END\"\"_CMD_OUT__\n".encode()
    s.send(full_cmd)
    
    out = b""
    start = time.time()
    while time.time() - start < timeout:
        try:
            chunk = s.recv(4096)
            if not chunk:
                break
            out += chunk
            if end_marker.encode() in out:
                # Give a tiny slice for shell prompt finish
                break
        except socket.timeout:
            break
    s.close()
    
    text = out.decode("utf-8", errors="replace")
    if start_marker in text and end_marker in text:
        content = text.split(start_marker)[-1].split(end_marker)[0]
        return content.strip()
    return text.strip()

if __name__ == '__main__':
    command = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "id"
    print(f"Connecting to TV ({TV_IP}:{TELNET_PORT})...")
    print(telnet_cmd(command))
