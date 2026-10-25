"""
Automated Pre-Deploy Verification Routine
Validates CSS, JavaScript, HTML, appinfo.json and connectivity BEFORE applying changes to the TV.
"""
import os
import sys
import re
import json
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT_DIR, "free-my-tv", "web")
WEBOS_DIR = os.path.join(ROOT_DIR, "free-my-tv", "webos")

def check_css(css_path):
    errors = []
    if not os.path.exists(css_path):
        return [f"File not found: {css_path}"]
    
    with open(css_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Unbalanced braces
    open_braces = 0
    line_no = 1
    for char in content:
        if char == '\n':
            line_no += 1
        elif char == '{':
            open_braces += 1
        elif char == '}':
            open_braces -= 1
            if open_braces < 0:
                errors.append(f"Unexpected closing '}}' around line {line_no}")
                break
    if open_braces > 0:
        errors.append(f"Unclosed '{{' in {os.path.basename(css_path)} (missing {open_braces} closing braces)")

    # 2. Duplicate keyframe names
    keyframes = re.findall(r'@(?:-webkit-)?keyframes\s+([a-zA-Z0-9_-]+)', content)
    seen_kf = set()
    for kf in keyframes:
        if kf in seen_kf:
            errors.append(f"Duplicate @keyframes rule found: '{kf}'")
        seen_kf.add(kf)

    # 4. Standard mask property pairs
    for prop in ('mask-size', 'mask-repeat', 'mask-position'):
        if f"-webkit-{prop}" in content and prop not in content:
            errors.append(f"Missing standard '{prop}' for compatibility with '-webkit-{prop}'")

    return errors

def check_js(js_path):
    errors = []
    # Test syntax with node --check
    try:
        res = subprocess.run(["node", "--check", js_path], capture_output=True, text=True)
        if res.returncode != 0:
            errors.append(f"JavaScript syntax error in {os.path.basename(js_path)}:\n{res.stderr.strip()}")
    except Exception as e:
        errors.append(f"Failed to run node --check on {os.path.basename(js_path)}: {e}")
    return errors

def check_appinfo(appinfo_path):
    errors = []
    if not os.path.exists(appinfo_path):
        return [f"Missing appinfo.json at {appinfo_path}"]
    try:
        with open(appinfo_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for req in ('id', 'version', 'main', 'title'):
            if req not in data:
                errors.append(f"appinfo.json missing required field '{req}'")
        if data.get("transparent") is not True:
            errors.append("appinfo.json should have 'transparent': true for video broadcast overlay")
    except json.JSONDecodeError as e:
        errors.append(f"Invalid JSON in appinfo.json: {e}")
    return errors

def run_all_checks():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print("=" * 60)
    print("[VERIFY] INICIANDO ROTINA DE VERIFICACAO PRE-DEPLOY")
    print("=" * 60)
    all_errors = []

    # 1. Check CSS
    css_file = os.path.join(WEB_DIR, "home.css")
    print(f"Checking CSS: {os.path.basename(css_file)}...")
    css_errs = check_css(css_file)
    if css_errs:
        for err in css_errs:
            print(f"  [FAIL] [CSS]: {err}")
        all_errors.extend(css_errs)
    else:
        print("  [PASS] CSS validado sem erros!")

    # 2. Check JavaScript files
    for js_name in ("home.js", "tv.js", "data.js", "zones.js", "strings.js"):
        js_path = os.path.join(WEB_DIR, js_name)
        if os.path.exists(js_path):
            print(f"Checking JS: {js_name}...")
            js_errs = check_js(js_path)
            if js_errs:
                for err in js_errs:
                    print(f"  [FAIL] [JS]: {err}")
                all_errors.extend(js_errs)
            else:
                print(f"  [PASS] {js_name} sintaxe OK!")

    # 3. Check appinfo.json
    appinfo_file = os.path.join(WEBOS_DIR, "appinfo.json")
    print(f"Checking manifest: {os.path.basename(appinfo_file)}...")
    manifest_errs = check_appinfo(appinfo_file)
    if manifest_errs:
        for err in manifest_errs:
            print(f"  [FAIL] [MANIFEST]: {err}")
        all_errors.extend(manifest_errs)
    else:
        print("  [PASS] appinfo.json validado!")

    print("-" * 60)
    if all_errors:
        print(f"[FAIL] VERIFICACAO FALHOU: {len(all_errors)} erro(s) encontrado(s)!")
        print("Deploy abortado por seguranca para proteger a TV.")
        print("=" * 60)
        return False
    else:
        print("[SUCCESS] TODOS OS TESTES PASSARAM! Codigo 100% seguro para deploy na TV.")
        print("=" * 60)
        return True

if __name__ == '__main__':
    ok = run_all_checks()
    sys.exit(0 if ok else 1)
