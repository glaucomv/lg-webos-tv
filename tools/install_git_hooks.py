"""
Install Git Hooks for Security & Privacy Guard
Configures Git to enforce security checks before commit and before push.
"""
import os
import sys
import shutil
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GITHOOKS_DIR = os.path.join(ROOT_DIR, ".githooks")
GIT_DIR = os.path.join(ROOT_DIR, ".git", "hooks")

def install_hooks():
    print("[HOOKS] Configurando Git Hooks de Seguranca e Privacidade...")
    
    # 1. Config core.hooksPath
    try:
        subprocess.run(["git", "config", "core.hooksPath", ".githooks"], cwd=ROOT_DIR, check=True)
        print("  [PASS] git config core.hooksPath definido para .githooks")
    except Exception as e:
        print(f"  [WARN] Falha ao configurar core.hooksPath: {e}")

    # 2. Copy directly to .git/hooks as fallback
    if os.path.isdir(GIT_DIR) and os.path.isdir(GITHOOKS_DIR):
        for name in ("pre-commit", "pre-push"):
            src = os.path.join(GITHOOKS_DIR, name)
            dst = os.path.join(GIT_DIR, name)
            if os.path.exists(src):
                shutil.copy2(src, dst)
                print(f"  [PASS] Copiado hook {name} para .git/hooks/")

    print("[SUCCESS] Git Hooks instalados com sucesso! Push e commits agora estao blindados.")

if __name__ == '__main__':
    install_hooks()
