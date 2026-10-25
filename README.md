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

### 2. Compilar o Launcher
O script `webos/build.py` utiliza Python puro para gerar o `.ipk` (sem precisar instalar o LG webOS CLI):
```bash
cd free-my-tv
python webos/build.py
```
Isso gera o arquivo `FreeMyTV-webos.ipk`.

### 3. Fazer Deploy na TV
Na raiz do projeto, execute:
```bash
python tools/deploy_to_tv.py
```
Esse comando inicia um servidor HTTP temporário na máquina de desenvolvimento, faz a TV baixar o `.ipk` via `curl` e aciona o serviço nativo `luna://com.webos.appInstallService/dev/install`.

### 4. Instalar ou Atualizar o Daemon de Boot / Home Intercept
O daemon gerencia a interceptação do botão Home e o app de inicialização rápida:
```bash
python tools/install_daemon.py
```

---

## 🛡️ Regras de Segurança
- **Nunca comite arquivos `.env`, chaves SSH (`*.pem`, `id_rsa`) ou o arquivo `config.properties` contendo tokens pessoais.**
- O arquivo `.gitignore` já está pré-configurado para bloquear binários `.ipk`, segredos e logs locais.
