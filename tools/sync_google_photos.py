#!/usr/bin/env python3
"""
sync_google_photos.py - Sincronizacao de Fotos Pessoais (Google Fotos / Pendrive / TV)

Permite:
1. Baixar fotos de um album compartilhado do Google Fotos (URL publica) em alta resolucao.
2. Salvar diretamente no pendrive (ex: D:\\fotos) ou pasta local.
3. Enviar opcionalmente direto para a TV via rede local (--tv). Se a TV tiver um pendrive
   conectado (ex: /tmp/usb/sda/sda1), salva direto na pasta fotos do pendrive!

Uso:
  # Baixar do Google Fotos e enviar para o pendrive conectado na TV:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/TuBoKZB529Lci4az7" --tv

  # Baixar para o pendrive no computador (ex: E:\fotos):
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/TuBoKZB529Lci4az7" --dest "E:\\fotos"
"""

import os
import sys
import re
import time
import argparse
import urllib.request
import urllib.parse
import urllib.error
import hashlib
from pathlib import Path

# Add repo root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.tv_root import telnet_cmd, TV_IP

def fetch_google_photos_urls(album_url):
    """
    Extrai as URLs de fotos de alta resolucao de um album compartilhado do Google Fotos.
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(album_url, headers=headers)
    
    print(f"[*] Acessando album compartilhado: {album_url} ...")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"[!] Erro ao acessar o link do Google Fotos: {e}")
        return []

    # Extrai links de imagens base do Google Photos (lh3.googleusercontent.com/pw/...)
    raw_matches = re.findall(r'(https://lh3\.googleusercontent\.com/(?:pw/)?[A-Za-z0-9_-]{20,})', html)
    
    # Remove duplicatas e imagens de sistema (avatares)
    unique_base = []
    seen = set()
    for u in raw_matches:
        if u not in seen:
            if '/a/' not in u and 'default-user' not in u and 'ogw/' not in u:
                seen.add(u)
                unique_base.append(u)

    print(f"[*] Encontradas {len(unique_base)} fotos no album do Google Fotos.")
    
    # Converte para resolucao 1080p/4K otimizada para TV
    final_urls = []
    for base in unique_base:
        # =w1920-h1080-no garante qualidade Full HD na TV
        final_urls.append(f"{base}=w1920-h1080-no")
        
    return final_urls

def download_photo(url, dest_folder, index):
    """
    Baixa uma foto individual se ela ainda nao existir no destino.
    """
    os.makedirs(dest_folder, exist_ok=True)
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    filename = f"foto_pessoal_{index:03d}_{url_hash}.jpg"
    filepath = os.path.join(dest_folder, filename)

    if os.path.exists(filepath):
        return filepath, False

    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp, open(filepath, 'wb') as f:
            f.write(resp.read())
        return filepath, True
    except Exception as e:
        print(f"[!] Falha no download de {url}: {e}")
        return None, False

def sync_album(album_url, dest_dir, limit=50):
    urls = fetch_google_photos_urls(album_url)
    if not urls:
        print("[!] Nenhuma foto encontrada no album.")
        return []

    if limit and limit > 0 and len(urls) > limit:
        print(f"[*] Sincronizando as {limit} fotos mais recentes (use --limit 0 para todas as {len(urls)})...")
        urls = urls[:limit]

    downloaded = []
    print(f"[*] Baixando fotos para a pasta local: {dest_dir} ...")
    for idx, u in enumerate(urls, start=1):
        path, is_new = download_photo(u, dest_dir, idx)
        if path:
            status = "NOVA" if is_new else "EXISTENTE"
            print(f"    [{idx}/{len(urls)}] ({status}) {os.path.basename(path)}")
            downloaded.append(path)
    return downloaded

def detect_tv_usb_mount():
    """
    Verifica se ha pendrive conectado na TV via Telnet.
    """
    cmd = "ls -d /tmp/usb/*/* /media/multimedia/* 2>/dev/null"
    res = telnet_cmd(cmd)
    if res:
        for line in res.splitlines():
            line = line.strip()
            if line.startswith("/tmp/usb/") or line.startswith("/media/multimedia/"):
                return line
    return None

def send_to_tv(local_dir):
    """
    Envia as fotos locais diretamente para a TV via rede local.
    Se a TV tiver um pendrive conectado, salva direto na pasta 'fotos' do pendrive!
    """
    os.makedirs(local_dir, exist_ok=True)
    valid_exts = ('.jpg', '.jpeg', '.png')
    files = [f for f in os.listdir(local_dir) if f.lower().endswith(valid_exts)]
    if not files:
        print("[!] Nenhuma foto valida encontrada para envio.")
        return

    print(f"[*] Verificando armazenamento na TV ({TV_IP})...")
    usb_mount = detect_tv_usb_mount()
    if usb_mount:
        tv_target = f"{usb_mount}/fotos"
        print(f"[OK] PENDRIVE CONECTADO NA TV DETECTADO EM: {usb_mount}")
        print(f"     As fotos serao salvas diretamente no pendrive: {tv_target}")
    else:
        tv_target = "/media/developer/apps/usr/palm/applications/io.freemytv/wallpapers/personal"
        print(f"[*] Pendrive nao detectado, salvando na memoria interna da TV: {tv_target}")

    # Garante pasta de destino na TV
    telnet_cmd(f"mkdir -p '{tv_target}'")

    # Inicia servidor HTTP temporario local
    import http.server
    import threading
    import socket

    port = 8995

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=local_dir, **kwargs)
        def log_message(self, format, *args):
            pass

    httpd = http.server.HTTPServer(('0.0.0.0', port), QuietHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    # Descobre o IP do host visivel na rede da TV
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((TV_IP, 80))
        host_ip = s.getsockname()[0]
    finally:
        s.close()

    print(f"[*] Transferindo {len(files)} fotos para a TV via servidor de alta velocidade...")
    for idx, f in enumerate(files, start=1):
        enc_name = urllib.parse.quote(f)
        cmd = f"curl -s -f 'http://{host_ip}:{port}/{enc_name}' -o '{tv_target}/{f}'"
        telnet_cmd(cmd)
        if idx % 10 == 0 or idx == len(files):
            print(f"    [{idx}/{len(files)}] fotos transferidas para a TV...")

    httpd.shutdown()
    print("[*] Fotos transferidas com sucesso!")
    
    # Dispara o script de sincronizacao nativo na TV para atualizar links e personal_manifest.json
    print("[*] Atualizando catalogo e manifesto do Launcher na TV...")
    daemon_script = "/media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh"
    telnet_cmd(f"sh {daemon_script} 2>/dev/null || true")
    print("[SUCCESS] Fotos salvas no pendrive da TV e manifesto atualizado com sucesso!")

def main():
    parser = argparse.ArgumentParser(description="Sincronizador de Fotos Google Photos para TV / Pendrive")
    parser.add_argument("--album-url", help="URL do album compartilhado do Google Fotos (ex: https://photos.app.goo.gl/...)")
    parser.add_argument("--dest", default=os.path.join(REPO_ROOT, "free-my-tv", "web", "wallpapers", "personal"), help="Diretorio de destino das fotos (pendrive ou pasta local)")
    parser.add_argument("--source", help="Pasta local com fotos ja existentes para enviar para a TV")
    parser.add_argument("--limit", type=int, default=50, help="Limite de fotos para sincronizar (padrao: 50 mais recentes, 0 para todas)")
    parser.add_argument("--tv", action="store_true", help="Envia automaticamente as fotos baixadas para o pendrive conectado na TV via rede")

    args = parser.parse_args()

    dest_folder = os.path.abspath(args.dest)
    if args.album_url:
        sync_album(args.album_url, dest_folder, limit=args.limit)
        if args.tv:
            send_to_tv(dest_folder)
    elif args.source:
        src_folder = os.path.abspath(args.source)
        if args.tv:
            send_to_tv(src_folder)
        else:
            print(f"[!] Pasta informada: {src_folder}. Use --tv para enviar para a TV.")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
