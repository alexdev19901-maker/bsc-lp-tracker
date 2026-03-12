# BSC LP Tracker — V3 & V4 Positions

Track concentrated liquidity positions on BSC (PancakeSwap V3/V4, Uniswap V3, etc.) via the DeBank Pro API.

## Deploy to Railway (recommended)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app), create a new project, connect your GitHub repo
3. Set environment variable: `DEBANK_API_KEY=your_key_here`
4. Railway auto-detects Node.js — it will run `npm run build` then `npm start`
5. Done. Your app is live.

## Deploy to Render

1. Push to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add env var: `DEBANK_API_KEY=your_key`

## Deploy to Fly.io

```bash
fly launch
fly secrets set DEBANK_API_KEY=your_key
fly deploy
```

## How it works

Single `server.js` process that:
- Serves the built React frontend (from `/dist`)
- Proxies `/api/*` requests to DeBank (no CORS issues)
- Keeps your API key server-side

You can also skip the env var and enter the API key in the UI at runtime.

## Local development

```bash
npm install
npm run dev
```

Opens frontend on :5173 with proxy to Express on :3001.
