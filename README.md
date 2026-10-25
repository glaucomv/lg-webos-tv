# LG webOS Custom Launcher & System Automation

Repositório dedicado ao desenvolvimento, customização e automação da Smart TV LG (webOS 8 / `10.3.2-33`, arquitetura ARMv7l) com privilégios de root via Homebrew Channel.

---

## 📁 Estrutura do Projeto

```
lg-webos-tv-workspace/
├── .env.example              # Exemplo de configuração de IP e portas locais
├── .gitignore                # Proteção contra vazamento de chaves e builds
├── README.md                 # Este guia
├── backups/                  # Backups de arquivos originais da TV e manifesto de apps
├── daemon/
│   └── 10-home-intercept.sh  # Script de inicialização (init.d) para a TV
├── free-my-tv/               # Código-fonte completo do launcher Free My TV
│   ├── web/                  # Interface web (HTML/CSS/JS)
│   ├── webos/                # appinfo.json e script autônomo build.py
│   └── config.example.properties
└── tools/                    # Ferramentas Python de automação e deploy
    ├── tv_root.py            # Cliente de comando remoto via Telnet
    ├── backup_tv_configs.py  # Extrai configs originais e lista de apps da TV
    ├── deploy_to_tv.py       # Compila, transfere e instala o launcher na TV
    ├── sync_wallpapers.py    # Sincroniza fotos e wallpapers locais para a TV
    ├── verify_build.py       # Validacao de integridade e sintaxe pre-deploy
    ├── security_guard.py     # Auditoria de privacidade e seguranca (anti-leaks)
    ├── install_git_hooks.py  # Ativa githooks pre-commit e pre-push
    └── install_daemon.py     # Transfere e ativa o daemon na TV
```

---

## 🚀 Como Usar

### 1. Configurar o Ambiente Local
Copie o arquivo de exemplo e preencha com os IPs da sua rede:
```bash
cp .env.example .env
```
Edite o `.env` com:
- `TV_IP`: Endereço IP da TV na rede Wi-Fi/Ethernet.
- `HOST_DEPLOY_IP`: Endereço IP da sua máquina de desenvolvimento.

### 2. Ativar Proteção de Privacidade e Git Hooks
Para garantir que nenhuma credencial ou IP real seja enviado ao GitHub ao tornar o repositório público:
```bash
python tools/install_git_hooks.py
```
Esse comando ativa os hooks em `.githooks/` (`pre-push` e `pre-commit`). Todo `git push` executará automaticamente o `tools/security_guard.py`.

### 3. Executar Auditoria de Segurança Manualmente
```bash
python tools/security_guard.py
```

### 4. Compilar o Launcher
O script `webos/build.py` utiliza Python puro para gerar o `.ipk` (sem precisar instalar o LG webOS CLI):
```bash
cd free-my-tv
python webos/build.py
```
Isso gera o arquivo `FreeMyTV-webos.ipk`.

### 5. Fazer Deploy na TV
Na raiz do projeto, execute:
```bash
python tools/deploy_to_tv.py
```
Esse comando executa a validação pré-deploy (`verify_build.py`), inicia um servidor HTTP temporário na máquina de desenvolvimento, faz a TV baixar o `.ipk` via `curl` e aciona o serviço nativo `luna://com.webos.appInstallService/dev/install`.

### 6. Instalar ou Atualizar o Daemon de Boot / Home Intercept
O daemon gerencia a interceptação do botão Home e o app de inicialização rápida:
```bash
python tools/install_daemon.py
```

---

## 🛡️ Regras de Segurança e Repositório Público
- **Zero Vazamento de Dados Pessoais**: `.env`, chaves SSH/Telnet (`*.pem`, `id_rsa`), backups de contingência (`backup_local/`) e arquivos com tokens (`config.properties`) são estritamente ignorados pelo `.gitignore` e bloqueados pelo `security_guard.py`.
- **Pre-Push Guard**: Qualquer tentativa de `git push` com IPs locais reais, MACs de hardware, chaves privadas ou caminhos de diretorio de usuario local e imediatamente abortada pelo hook.
