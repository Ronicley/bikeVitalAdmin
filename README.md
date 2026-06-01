# Bike Vital Admin

Painel administrativo React + Vite para o Bike Vital.

## Desenvolvimento local

```bash
npm install
cp .env.example .env
npm run dev
```

A app sobe em `http://localhost:9001`. Configure `VITE_API_BASE_URL` no `.env` para apontar à API (padrão: `http://localhost:9000`).

## Deploy na Hostinger (Docker + GitHub Actions)

O deploy usa a action oficial [Deploy on Hostinger VPS](https://github.com/marketplace/actions/deploy-on-hostinger-vps): push na branch `main` (ou execução manual) envia o `docker-compose.yml` para a VPS, faz build da imagem e sobe o Nginx na porta 80.

### Pré-requisitos na VPS

- Docker e Docker Compose instalados
- Porta 80 liberada no firewall
- (Opcional) DNS apontando para o IP da VPS e TLS no host (Certbot/reverse proxy)

### GitHub — Environment `production`

O workflow usa o environment **production** (`Settings → Environments → production`):

| Tipo | Nome | Descrição |
|------|------|-----------|
| Secret | `HOSTINGER_API_KEY` | API key do painel Hostinger |
| Variable | `HOSTINGER_VM_ID` | ID numérico da VPS (ex.: `srv123456.hstgr.cloud` → `123456`) |
| Variable | `VITE_API_BASE_URL` | URL pública da API em produção (HTTPS). Embutida no build do Vite. |

Exemplos de `VITE_API_BASE_URL` (API no mesmo ecossistema de domínio):

- `https://api.seudominio.com`
- `https://seudominio.com` (se a API estiver na raiz e o admin em outro host)

A API precisa permitir CORS a partir da origem onde o admin é servido.

### Branch `main`

O workflow dispara apenas em `main`. Se o repositório ainda usa `master`:

```bash
git branch -m master main
git push -u origin main
```

Defina `main` como default branch no GitHub.

### Teste local com Docker

```bash
docker compose build --build-arg VITE_API_BASE_URL=https://api.exemplo.com
docker compose up
```

Abra `http://localhost`.

### Redeploy manual

No GitHub: **Actions** → **Deploy to Hostinger** → **Run workflow**.
