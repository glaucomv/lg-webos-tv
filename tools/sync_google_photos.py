#!/usr/bin/env python3
"""
sync_google_photos.py - Sincronizacao de Fotos Pessoais (Google Fotos / Pendrive / TV)

Permite:
1. Baixar fotos de um album compartilhado do Google Fotos (com paginacao completa para 5.000+ fotos).
2. Salvar diretamente no pendrive conectado a TV (ex: /tmp/usb/sda/sda1/fotos) ou em pasta local.
3. Consultar contagem exata de fotos no album e no pendrive (--info).

Uso:
  # Consultar total de fotos no album e no pendrive:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/TuBoKZB529Lci4az7" --info

  # Baixar as 100 fotos mais recentes para o pendrive da TV:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/TuBoKZB529Lci4az7" --tv --limit 100

  # Baixar todas as fotos do album (5.000+):
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/TuBoKZB529Lci4az7" --tv --limit 0
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
import json
from pathlib import Path

# Add repo root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.tv_root import telnet_cmd, TV_IP

def fetch_google_photos_urls(album_url, limit=None):
    """
    Extrai as URLs de fotos de alta resolucao de um album compartilhado do Google Fotos
    suportando paginacao completa via RPC batchexecute para albuns gigantes (5000+ fotos).
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(album_url, headers=headers)
    
    print(f"[*] Acessando album compartilhado: {album_url} ...")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            final_url = resp.geturl()
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"[!] Erro ao acessar o link do Google Fotos: {e}")
        return []

    # Extrai IDs necessarios para paginacao
    m_url = re.search(r'/share/([A-Za-z0-9_-]+)\?key=([A-Za-z0-9_-]+)', final_url)
    album_id = m_url.group(1) if m_url else None
    auth_key = m_url.group(2) if m_url else None

    # Extrai o payload inicial ds:1
    target = "AF_initDataCallback({key: 'ds:1'"
    idx = html.find(target)
    all_bases = []
    token = None

    if idx != -1:
        end_idx = html.find("</script>", idx)
        chunk = html[idx:end_idx].strip()
        if chunk.endswith(");"): chunk = chunk[:-2]
        data_idx = chunk.find("data:") + 5
        side_idx = chunk.rfind(", sideChannel:")
        try:
            data = json.loads(chunk[data_idx:side_idx].strip())
            initial_items = data[1] if len(data) > 1 and isinstance(data[1], list) else []
            token = data[2] if len(data) > 2 and isinstance(data[2], str) else None
            for item in initial_items:
                if len(item) > 1 and item[1]:
                    all_bases.append(item[1][0])
        except Exception as e:
            print("[!] Aviso no parse do payload inicial:", e)

    # Fallback para regex simples caso ds:1 mude
    if not all_bases:
        raw_matches = re.findall(r'(https://lh3\.googleusercontent\.com/(?:pw/)?[A-Za-z0-9_-]{20,})', html)
        seen = set()
        for u in raw_matches:
            if u not in seen and '/a/' not in u and 'default-user' not in u and 'ogw/' not in u:
                seen.add(u)
                all_bases.append(u)

    print(f"[*] Pagina 1 carregada: {len(all_bases)} fotos encontradas.")

    # Se o usuario especificou um limite e a primeira pagina ja satisfaz, retorna
    if limit and limit > 0 and len(all_bases) >= limit:
        all_bases = all_bases[:limit]
        print(f"[*] Limite de {limit} fotos atingido na pagina 1.")
        return [f"{b}=w1920-h1080-no" for b in all_bases]

    # Paginacao para buscar mais fotos se o album tiver > 300 fotos
    rpc_url = "https://photos.google.com/_/PhotosUi/data/batchexecute"
    rpc_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Referer': final_url
    }

    page = 1
    while token:
        if limit and limit > 0 and len(all_bases) >= limit:
            break
        page += 1
        params = [album_id, token, None, auth_key]
        payload = [[["snAcKc", json.dumps(params), None, "generic"]]]
        post_data = urllib.parse.urlencode({'f.req': json.dumps(payload)}).encode('utf-8')
        try:
            rpc_req = urllib.request.Request(rpc_url, data=post_data, headers=rpc_headers)
            with urllib.request.urlopen(rpc_req, timeout=20) as rpc_resp:
                rpc_out = rpc_resp.read().decode('utf-8', errors='ignore')
            clean = re.sub(r"^\)\]\}'\s*", "", rpc_out).strip()
            parsed = json.loads(clean.splitlines()[0])
            inner_data = json.loads(parsed[0][2])
            page_items = inner_data[1] if len(inner_data) > 1 and isinstance(inner_data[1], list) else []
            token = inner_data[2] if len(inner_data) > 2 and isinstance(inner_data[2], str) else None
            for item in page_items:
                if len(item) > 1 and item[1]:
                    all_bases.append(item[1][0])
            print(f"[*] Pagina {page}: +{len(page_items)} fotos (total acumulado: {len(all_bases)})")
        except Exception as e:
            print(f"[!] Fim da paginacao na pagina {page}: {e}")
            break

    if limit and limit > 0 and len(all_bases) > limit:
        all_bases = all_bases[:limit]

    print(f"[*] Total selecionado para sincronizacao: {len(all_bases)} fotos.")
    # =w1920-h1080-no garante resolucao nativa Full HD sem distorcao
    return [f"{b}=w1920-h1080-no" for b in all_bases]

def download_photo(url, dest_folder, index):
    """
    Baixa uma foto individual se ela ainda nao existir no destino.
    """
    os.makedirs(dest_folder, exist_ok=True)
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    filename = f"foto_pessoal_{index:04d}_{url_hash}.jpg"
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
        print(f"[!] Falha no download da foto {index}: {e}")
        return None, False

def sync_album(album_url, dest_dir, limit=100):
    urls = fetch_google_photos_urls(album_url, limit=limit)
    if not urls:
        print("[!] Nenhuma foto encontrada no album.")
        return []

    downloaded = []
    print(f"[*] Verificando e baixando fotos para pasta local: {dest_dir} ...")
    new_count = 0
    exist_count = 0
    for idx, u in enumerate(urls, start=1):
        path, is_new = download_photo(u, dest_dir, idx)
        if path:
            if is_new:
                new_count += 1
                if new_count <= 10 or new_count % 25 == 0:
                    print(f"    [{idx}/{len(urls)}] (NOVA) {os.path.basename(path)}")
            else:
                exist_count += 1
            downloaded.append(path)

    print(f"[*] Download concluido: {new_count} fotos novas baixadas, {exist_count} fotos ja existentes.")
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

def check_pendrive_photo_count():
    cmd = "ls -1 /tmp/usb/sda/sda1/fotos/*.jpg 2>/dev/null | wc -l"
    res = telnet_cmd(cmd)
    try:
        return int(res.strip())
    except:
        return 0

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
        print(f"     Destino das fotos: {tv_target}")
    else:
        tv_target = "/media/developer/apps/usr/palm/applications/io.freemytv/wallpapers/personal"
        print(f"[*] Pendrive nao detectado, salvando na memoria interna da TV: {tv_target}")

    # Garante pasta de destino na TV
    telnet_cmd(f"mkdir -p '{tv_target}'")

    # Obtem lista de arquivos ja existentes na TV para transferir apenas os novos
    existing_raw = telnet_cmd(f"ls -1 '{tv_target}' 2>/dev/null")
    existing_on_tv = set(existing_raw.splitlines()) if existing_raw else set()

    to_transfer = [f for f in files if f not in existing_on_tv]
    print(f"[*] Fotos locais: {len(files)} | Ja no pendrive da TV: {len(existing_on_tv)} | Novas para transferir: {len(to_transfer)}")

    if not to_transfer:
        print("[OK] Todas as fotos locais ja estao presentes no pendrive da TV. Nada a transferir!")
        # Atualiza manifesto para garantir integridade
        daemon_script = "/media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh"
        telnet_cmd(f"sh {daemon_script} 2>/dev/null || true")
        return

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

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((TV_IP, 80))
        host_ip = s.getsockname()[0]
    finally:
        s.close()

    print(f"[*] Transferindo {len(to_transfer)} fotos novas para o pendrive da TV...")
    for idx, f in enumerate(to_transfer, start=1):
        enc_name = urllib.parse.quote(f)
        cmd = f"curl -s -f 'http://{host_ip}:{port}/{enc_name}' -o '{tv_target}/{f}'"
        telnet_cmd(cmd)
        if idx % 20 == 0 or idx == len(to_transfer):
            print(f"    [{idx}/{len(to_transfer)}] fotos enviadas para o pendrive...")

    httpd.shutdown()
    print("[*] Transferencia concluida com sucesso!")
    
    # Atualiza o catalogo e manifesto do Launcher na TV
    print("[*] Reconstruindo catalogo personal_manifest.json na TV...")
    daemon_script = "/media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh"
    telnet_cmd(f"sh {daemon_script} 2>/dev/null || true")
    
    total_now = check_pendrive_photo_count()
    print(f"[SUCCESS] Concluido! Total atual de fotos no pendrive da TV: {total_now}")

def report_info(album_url):
    print("=" * 60)
    print("RELATÓRIO DE SINCRONIZAÇÃO DE FOTOS (GOOGLE FOTOS & PENDRIVE)")
    print("=" * 60)
    
    # Pendrive count
    usb_mount = detect_tv_usb_mount()
    if usb_mount:
        pendrive_count = check_pendrive_photo_count()
        print(f"[TV] Pendrive detectado em: {usb_mount}")
        print(f"[TV] Total de fotos no pendrive da TV neste momento: {pendrive_count} fotos")
    else:
        print("[TV] Nenhum pendrive detectado na TV no momento.")

    # Album total
    if album_url:
        print(f"\n[GOOGLE FOTOS] Analisando album: {album_url} ...")
        urls = fetch_google_photos_urls(album_url, limit=0) # 0 para contar todas
        print(f"[GOOGLE FOTOS] Total exato de fotos no album compartilhado: {len(urls)} fotos")
        if usb_mount:
            pendrive_count = check_pendrive_photo_count()
            diff = max(0, len(urls) - pendrive_count)
            print(f"\n[INFO] {diff} fotos do album ainda nao foram sincronizadas para o pendrive.")
            print(f"       Para sincronizar mais fotos, execute:")
            print(f"       python tools/sync_google_photos.py --album-url \"{album_url}\" --tv --limit 200")
    print("=" * 60)

def main():
    parser = argparse.ArgumentParser(description="Sincronizador de Fotos Google Photos para TV / Pendrive")
    parser.add_argument("--album-url", help="URL do album compartilhado do Google Fotos (ex: https://photos.app.goo.gl/...)")
    parser.add_argument("--dest", default=os.path.join(REPO_ROOT, "free-my-tv", "web", "wallpapers", "personal"), help="Diretorio de destino das fotos")
    parser.add_argument("--source", help="Pasta local com fotos ja existentes para enviar para a TV")
    parser.add_argument("--limit", type=int, default=100, help="Limite de fotos para sincronizar (padrao: 100, use 0 para todas as fotos do album)")
    parser.add_argument("--tv", action="store_true", help="Envia automaticamente as fotos baixadas para o pendrive conectado na TV via rede")
    parser.add_argument("--info", action="store_true", help="Exibe informacoes de contagem de fotos no album e no pendrive sem baixar nada")

    args = parser.parse_args()

    if args.info:
        report_info(args.album_url)
        return

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
