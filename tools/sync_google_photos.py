#!/usr/bin/env python3
"""
sync_google_photos.py - Sincronizacao de Fotos Pessoais (Google Fotos / Pendrive / TV)

Permite:
1. Baixar fotos de um album compartilhado do Google Fotos (URL publica) em alta resolucao.
2. Salvar diretamente no pendrive (ex: D:\\fotos) ou pasta local.
3. Enviar opcionalmente direto para a TV via rede local (--tv).

Uso:
  # Baixar do Google Fotos para o Pendrive:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/EXEMPLO" --dest "E:\\fotos"

  # Baixar e enviar direto para a TV:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/EXEMPLO" --tv

  # Enviar pasta local de fotos para a TV:
  python tools/sync_google_photos.py --source "C:\\Users\\glauc\\Pictures\\TV_Wallpapers" --tv
"""

import os
import sys
import re
import time
import argparse
import urllib.request
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(album_url, headers=headers)
    
    print(f"[*] Acessando album compartilhado: {album_url} ...")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"[!] Erro ao acessar o link do Google Fotos: {e}")
        return []

    # Extrai links de imagens base do Google Photos (lh3.googleusercontent.com)
    # Formato: https://lh3.googleusercontent.com/pw/[A-Za-z0-9_-]+
    raw_matches = re.findall(r'(https://lh3\.googleusercontent\.com/[A-Za-z0-9_-]{20,})', html)
    
    # Remove duplicatas preservando a ordem
    unique_base = []
    seen = set()
    for u in raw_matches:
        if u not in seen:
            seen.add(u)
            unique_base.append(u)

    print(f"[*] Encontradas {len(unique_base)} imagens no album.")
    
    # Converte para resolucao 1080p/4K otimizada para TV
    final_urls = []
    for base in unique_base:
        # =w1920-h1080-no garante qualidade Full HD sem distorcao
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

    headers = {'User-Agent': 'Mozilla/5.0'}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp, open(filepath, 'wb') as f:
            f.write(resp.read())
        return filepath, True
    except Exception as e:
        print(f"[!] Falha no download de {url}: {e}")
        return None, False

def sync_album(album_url, dest_dir):
    urls = fetch_google_photos_urls(album_url)
    if not urls:
        print("[!] Nenhuma foto encontrada no album.")
        return []

    downloaded = []
    print(f"[*] Baixando fotos para: {dest_dir} ...")
    for idx, u in enumerate(urls, start=1):
        path, is_new = download_photo(u, dest_dir, idx)
        if path:
            status = "NOVA" if is_new else "EXISTENTE"
            print(f"    [{idx}/{len(urls)}] ({status}) {os.path.basename(path)}")
            downloaded.append(path)
    return downloaded

def send_to_tv(local_dir):
    """
    Envia as fotos locais diretamente para o diretorio de fotos pessoais da TV.
    """
    print(f"[*] Enviando fotos da pasta local para a TV ({TV_IP})...")
    tv_target = "/media/developer/apps/usr/palm/applications/io.freemytv/wallpapers/personal"
    
    # Garante diretorio na TV
    telnet_cmd(f"mkdir -p {tv_target}")
    
    # Lista arquivos .jpg e .png locais
    valid_exts = ('.jpg', '.jpeg', '.png')
    files = [f for f in os.listdir(local_dir) if f.lower().endswith(valid_exts)]
    if not files:
        print("[!] Nenhuma foto valida encontrada para envio.")
        return

    # Usamos o web server local para a TV baixar via wget/curl em alta velocidade
    import http.server
    import threading
    import socket

    port = 8995
    handler = http.server.SimpleHTTPRequestHandler
    httpd = None

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

    os.chdir(local_dir)
    httpd = http.server.HTTPServer(('0.0.0.0', port), QuietHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    # Descobre o IP do host visivel na rede
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((TV_IP, 80))
        host_ip = s.getsockname()[0]
    finally:
        s.close()

    print(f"[*] Servidor de transferencia temporario rodando em http://{host_ip}:{port}/")
    for f in files:
        print(f"    -> Enviando para TV: {f} ...")
        cmd = f"curl -s -f 'http://{host_ip}:{port}/{urllib.parse.quote(f)}' -o '{tv_target}/{f}'"
        telnet_cmd(cmd)

    httpd.shutdown()
    print("[*] Fotos transferidas com sucesso para a TV!")
    
    # Atualiza o manifesto de fotos na TV
    print("[*] Reconstruindo catálogo e manifesto na TV...")
    daemon_script = "/media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh"
    telnet_cmd(f"sh {daemon_script} 2>/dev/null || true")

def main():
    parser = argparse.ArgumentParser(description="Sincronizador de Fotos Google Photos para TV / Pendrive")
    parser.add_argument("--album-url", help="URL do album compartilhado do Google Fotos (ex: https://photos.app.goo.gl/...)")
    parser.add_argument("--dest", default=os.path.join(REPO_ROOT, "free-my-tv", "web", "wallpapers", "personal"), help="Diretorio de destino das fotos (pendrive ou pasta local)")
    parser.add_argument("--source", help="Pasta local com fotos ja existentes para enviar para a TV")
    parser.add_argument("--tv", action="store_true", help="Envia automaticamente as fotos baixadas para a TV via rede")

    args = parser.parse_args()

    dest_folder = os.path.abspath(args.dest)
    if args.album_url:
        sync_album(args.album_url, dest_folder)
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
