#!/usr/bin/env python3
"""
sync_google_photos.py - Sincronizacao de Fotos Pessoais (Google Fotos / Pendrive / TV)

Permite:
1. Baixar fotos de um album compartilhado do Google Fotos (com paginacao completa para 5.000+ fotos).
2. Salvar diretamente no pendrive conectado a TV (ex: /tmp/usb/sda/sda1/fotos) ou em pasta local.
3. Consultar contagem exata de fotos no album e no pendrive (--info).

Uso:
  # Consultar total de fotos no album e no pendrive:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/EXEMPLO" --info

  # Baixar as 100 fotos mais recentes para o pendrive da TV:
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/EXEMPLO" --tv --limit 100

  # Baixar todas as fotos do album (5.000+):
  python tools/sync_google_photos.py --album-url "https://photos.app.goo.gl/EXEMPLO" --tv --limit 0
"""

import io
import os
import sys
import re
import time
import tarfile
import argparse
import urllib.request
import urllib.parse
import urllib.error
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    from PIL import Image, ImageOps
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

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
        return [f"{b}=w1280-h720-no" for b in all_bases]

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
    # =w1280-h720-no garante excelente nitidez na TV com 55% menos consumo de RAM/VRAM por textura
    return [f"{b}=w1280-h720-no" for b in all_bases]

def optimize_image_bytes(raw_bytes, max_width=1280, max_height=720, quality=78):
    """
    Otimiza a imagem em memoria antes de gravar no disco/pendrive:
    - Corrige orientacao EXIF automaticamente
    - Redimensiona para ate 1280x720 (reduz consumo de RAM/VRAM em 55% na TV de 1.2GB)
    - Remove metadados EXIF/ICC desnecessarios
    - Aplica compressao JPEG progressiva otimizada
    """
    if not HAS_PILLOW or not raw_bytes:
        return raw_bytes
    try:
        with Image.open(io.BytesIO(raw_bytes)) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode != "RGB":
                im = im.convert("RGB")
            if im.width > max_width or im.height > max_height:
                im.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
            optimized = out.getvalue()
            return optimized if len(optimized) < len(raw_bytes) or im.width <= max_width else raw_bytes
    except Exception:
        return raw_bytes


def optimize_local_folder(folder_path, max_width=1280, max_height=720, quality=78):
    """
    Comprime e otimiza fotos ja existentes em uma pasta local ou pendrive.
    """
    if not HAS_PILLOW:
        print("[!] Pillow (PIL) nao encontrado. Instale com: pip install Pillow")
        return
    if not os.path.isdir(folder_path):
        print(f"[!] Pasta nao encontrada: {folder_path}")
        return
    valid_exts = ('.jpg', '.jpeg', '.png')
    files = [os.path.join(folder_path, f) for f in os.listdir(folder_path) if f.lower().endswith(valid_exts)]
    if not files:
        print("[!] Nenhuma imagem encontrada para otimizar.")
        return

    print(f"[*] Otimizando {len(files)} fotos em {folder_path} (max {max_width}x{max_height}, JPEG q={quality})...")
    saved_bytes = 0
    count = 0
    for fpath in files:
        try:
            orig_size = os.path.getsize(fpath)
            # Pula arquivos ja muito pequenos e otimizados (< 95 KB)
            if orig_size < 95 * 1024:
                continue
            with open(fpath, "rb") as f:
                raw = f.read()
            opt = optimize_image_bytes(raw, max_width=max_width, max_height=max_height, quality=quality)
            if len(opt) < orig_size:
                with open(fpath, "wb") as f:
                    f.write(opt)
                saved_bytes += (orig_size - len(opt))
                count += 1
        except Exception:
            pass
    print(f"[OK] {count} fotos recomprimidas! Economia total: {saved_bytes / (1024 * 1024):.1f} MB.")


def download_photo(url, dest_folder, index):
    """
    Baixa uma foto individual se ela ainda nao existir no destino,
    ja aplicando redimensionamento e compressao otimizada em memoria.
    """
    os.makedirs(dest_folder, exist_ok=True)
    # Preserva o hash compativel com o sufixo historico para nao duplicar fotos ja baixadas
    canonical_url = re.sub(r'=w\d+-h\d+-no$', '=w1920-h1080-no', url)
    url_hash = hashlib.md5(canonical_url.encode()).hexdigest()[:8]
    filename = f"foto_pessoal_{index:04d}_{url_hash}.jpg"
    filepath = os.path.join(dest_folder, filename)

    if os.path.exists(filepath):
        return filepath, False

    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw_bytes = resp.read()
        opt_bytes = optimize_image_bytes(raw_bytes)
        with open(filepath, 'wb') as f:
            f.write(opt_bytes)
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
    print(f"[*] Verificando, baixando e comprimindo fotos para: {dest_dir} ...")
    new_count = 0
    exist_count = 0

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(download_photo, u, dest_dir, idx): idx for idx, u in enumerate(urls, start=1)}
        for fut in as_completed(futures):
            idx = futures[fut]
            path, is_new = fut.result()
            if path:
                if is_new:
                    new_count += 1
                    if new_count <= 10 or new_count % 25 == 0:
                        print(f"    [{idx}/{len(urls)}] (NOVA OTIMIZADA) {os.path.basename(path)}")
                else:
                    exist_count += 1
                downloaded.append(path)

    print(f"[*] Sincronizacao local concluida: {new_count} fotos novas otimizadas, {exist_count} ja existentes.")
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
    cmd = "/bin/ls -1 /tmp/usb/sda/sda1/fotos 2>/dev/null | grep -iE '\\.(jpg|jpeg|png)$' | wc -l"
    res = telnet_cmd(cmd, timeout=10)
    try:
        return int(res.strip().splitlines()[-1])
    except Exception:
        return 0

def send_to_tv(local_dir):
    """
    Envia as fotos locais diretamente para a TV via rede local usando lotes TAR em streaming.
    Se a TV tiver um pendrive conectado, salva direto na pasta 'fotos' do pendrive!
    """
    os.makedirs(local_dir, exist_ok=True)
    valid_exts = ('.jpg', '.jpeg', '.png')
    files = sorted([f for f in os.listdir(local_dir) if f.lower().endswith(valid_exts)])
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

    # Obtem lista de arquivos ja existentes na TV sem overhead de stat() no FAT32
    existing_raw = telnet_cmd(f"/bin/ls -1 '{tv_target}/' 2>/dev/null", timeout=10)
    existing_on_tv = set(line.strip() for line in existing_raw.splitlines() if line.strip()) if existing_raw else set()

    to_transfer = [f for f in files if f not in existing_on_tv]
    print(f"[*] Fotos locais: {len(files)} | Ja no pendrive da TV: {len(existing_on_tv)} | Novas para transferir: {len(to_transfer)}")

    if not to_transfer:
        print("[OK] Todas as fotos locais ja estao presentes no pendrive da TV. Nada a transferir!")
        daemon_script = "/media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh"
        telnet_cmd(f"sh {daemon_script} 2>/dev/null || true", timeout=10)
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

    print(f"[*] Transferindo {len(to_transfer)} fotos novas para o pendrive da TV em lotes rapidos...")
    batch_name = ".sync_batch_tmp.tar"
    batch_path = os.path.join(local_dir, batch_name)
    batch_size = 50
    try:
        for i in range(0, len(to_transfer), batch_size):
            chunk = to_transfer[i:i + batch_size]
            with tarfile.open(batch_path, "w") as tar:
                for fname in chunk:
                    full_p = os.path.join(local_dir, fname)
                    if os.path.isfile(full_p):
                        tar.add(full_p, arcname=fname)
            cmd = f"curl -s -f 'http://{host_ip}:{port}/{batch_name}' | tar -xf - -C '{tv_target}'"
            telnet_cmd(cmd, timeout=25)
            sent = min(i + batch_size, len(to_transfer))
            print(f"    [{sent}/{len(to_transfer)}] fotos enviadas para o pendrive...")
    finally:
        if os.path.exists(batch_path):
            try:
                os.remove(batch_path)
            except Exception:
                pass
        httpd.shutdown()

    print("[*] Transferencia concluida com sucesso!")

    # Atualiza o catalogo e manifesto do Launcher na TV
    print("[*] Reconstruindo catalogo personal_manifest.json na TV...")
    daemon_script = "/media/developer/apps/usr/palm/applications/io.freemytv/daemon/15-sync-usb-photos.sh"
    telnet_cmd(f"sh {daemon_script} --rescan 2>/dev/null || true", timeout=20)

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
    parser.add_argument("--optimize-local", action="store_true", help="Re-comprime e otimiza as fotos ja existentes na pasta de destino")
    parser.add_argument("--info", action="store_true", help="Exibe informacoes de contagem de fotos no album e no pendrive sem baixar nada")

    args = parser.parse_args()

    if args.info:
        report_info(args.album_url)
        return

    dest_folder = os.path.abspath(args.dest)
    if args.optimize_local:
        optimize_local_folder(dest_folder)
        if args.tv:
            send_to_tv(dest_folder)
        return
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
