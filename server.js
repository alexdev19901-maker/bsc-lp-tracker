import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// BSC RPC — free public endpoints with fallbacks
// ============================================================
const RPC_URLS = [
  "https://bsc-dataseed1.binance.org",
  "https://bsc-dataseed2.binance.org",
  "https://bsc-dataseed3.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
];

function getProvider() {
  const url = RPC_URLS[Math.floor(Math.random() * RPC_URLS.length)];
  return new ethers.JsonRpcProvider(url, 56);
}

// ============================================================
// Contract addresses on BSC
// ============================================================
const CONTRACTS = {
  // PancakeSwap V3 NonfungiblePositionManager
  PCS_V3_NFT: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  // PancakeSwap V3 Factory
  PCS_V3_FACTORY: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  // Uniswap V3 on BSC
  UNI_V3_NFT: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
  // Uniswap V3 on BSC (new deployment)
  UNI_V3_NFT2: "0x0927a5aBBd02eD73bA83fC93bd9900b1C2e52348",
};

// ============================================================
// ABIs (minimal — only what we need for read calls)
// ============================================================
const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
];

const POSITION_MANAGER_ABI = [
  ...ERC721_ABI,
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function factory() view returns (address)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

// ============================================================
// Token info cache (avoid repeated RPC calls)
// ============================================================
const tokenCache = {};

async function getTokenInfo(address, provider) {
  const key = address.toLowerCase();
  if (tokenCache[key]) return tokenCache[key];

  // WBNB / native
  if (key === "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c") {
    tokenCache[key] = { symbol: "WBNB", decimals: 18, address };
    return tokenCache[key];
  }

  try {
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      token.symbol().catch(() => "???"),
      token.decimals().catch(() => 18),
    ]);
    tokenCache[key] = { symbol, decimals: Number(decimals), address };
  } catch {
    tokenCache[key] = { symbol: "???", decimals: 18, address };
  }
  return tokenCache[key];
}

// ============================================================
// Math helpers for tick → price conversion & fee computation
// ============================================================
function tickToPrice(tick, decimals0, decimals1) {
  // price = 1.0001^tick * 10^(decimals0 - decimals1)
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

function sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1) {
  const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
  return sqrtPrice * sqrtPrice * Math.pow(10, decimals0 - decimals1);
}

// Compute token amounts from liquidity and tick range
function getTokenAmounts(liquidity, sqrtPriceX96, tickLower, tickUpper, decimals0, decimals1) {
  const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
  const sqrtPriceLower = Math.pow(1.0001, tickLower / 2);
  const sqrtPriceUpper = Math.pow(1.0001, tickUpper / 2);

  let amount0 = 0;
  let amount1 = 0;
  const liq = Number(liquidity);

  if (sqrtPrice <= sqrtPriceLower) {
    // current price below range — all token0
    amount0 = liq * (1 / sqrtPriceLower - 1 / sqrtPriceUpper);
  } else if (sqrtPrice >= sqrtPriceUpper) {
    // current price above range — all token1
    amount1 = liq * (sqrtPriceUpper - sqrtPriceLower);
  } else {
    // in range
    amount0 = liq * (1 / sqrtPrice - 1 / sqrtPriceUpper);
    amount1 = liq * (sqrtPrice - sqrtPriceLower);
  }

  return {
    amount0: amount0 / Math.pow(10, decimals0),
    amount1: amount1 / Math.pow(10, decimals1),
  };
}

// ============================================================
// Fetch uncollected fees for a position
// ============================================================
const Q128 = BigInt(2) ** BigInt(128);

async function getUnclaimedFees(position, poolContract) {
  try {
    const slot0 = await poolContract.slot0();
    const currentTick = Number(slot0.tick);
    const tickLower = Number(position.tickLower);
    const tickUpper = Number(position.tickUpper);

    const [lowerTickData, upperTickData] = await Promise.all([
      poolContract.ticks(tickLower),
      poolContract.ticks(tickUpper),
    ]);

    const [feeGrowthGlobal0, feeGrowthGlobal1] = await Promise.all([
      poolContract.feeGrowthGlobal0X128(),
      poolContract.feeGrowthGlobal1X128(),
    ]);

    // Compute fee growth inside the range
    let feeGrowthBelow0, feeGrowthBelow1, feeGrowthAbove0, feeGrowthAbove1;

    if (currentTick >= tickLower) {
      feeGrowthBelow0 = lowerTickData.feeGrowthOutside0X128;
      feeGrowthBelow1 = lowerTickData.feeGrowthOutside1X128;
    } else {
      feeGrowthBelow0 = feeGrowthGlobal0 - lowerTickData.feeGrowthOutside0X128;
      feeGrowthBelow1 = feeGrowthGlobal1 - lowerTickData.feeGrowthOutside1X128;
    }

    if (currentTick < tickUpper) {
      feeGrowthAbove0 = upperTickData.feeGrowthOutside0X128;
      feeGrowthAbove1 = upperTickData.feeGrowthOutside1X128;
    } else {
      feeGrowthAbove0 = feeGrowthGlobal0 - upperTickData.feeGrowthOutside0X128;
      feeGrowthAbove1 = feeGrowthGlobal1 - upperTickData.feeGrowthOutside1X128;
    }

    const feeGrowthInside0 = feeGrowthGlobal0 - feeGrowthBelow0 - feeGrowthAbove0;
    const feeGrowthInside1 = feeGrowthGlobal1 - feeGrowthBelow1 - feeGrowthAbove1;

    const liquidity = BigInt(position.liquidity.toString());

    // Uncollected = (feeGrowthInside - feeGrowthInsideLast) * liquidity / 2^128 + tokensOwed
    const fees0 = Number(
      ((BigInt(feeGrowthInside0.toString()) - BigInt(position.feeGrowthInside0LastX128.toString())) * liquidity) / Q128
        + BigInt(position.tokensOwed0.toString())
    );
    const fees1 = Number(
      ((BigInt(feeGrowthInside1.toString()) - BigInt(position.feeGrowthInside1LastX128.toString())) * liquidity) / Q128
        + BigInt(position.tokensOwed1.toString())
    );

    return { fees0, fees1 };
  } catch (err) {
    // If fee calc fails (e.g. pool not found), return tokensOwed
    return {
      fees0: Number(position.tokensOwed0 || 0),
      fees1: Number(position.tokensOwed1 || 0),
    };
  }
}

// ============================================================
// Price cache using CoinGecko free API (or fallback)
// ============================================================
const priceCache = { data: {}, lastFetch: 0 };

async function getTokenPriceUSD(address) {
  const key = address.toLowerCase();
  const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

  // Refresh prices every 60s
  if (Date.now() - priceCache.lastFetch > 60000) {
    try {
      const resp = await fetch(
        "https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain?vs_currencies=usd&contract_addresses=" +
        WBNB + ",0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56,0x55d398326f99059fF775485246999027B3197955,0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d,0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82,0x2170Ed0880ac9A755fd29B2688956BD959F933F8"
      );
      if (resp.ok) {
        const data = await resp.json();
        for (const [addr, val] of Object.entries(data)) {
          priceCache.data[addr.toLowerCase()] = val.usd || 0;
        }
        priceCache.lastFetch = Date.now();
      }
    } catch (e) {
      console.error("CoinGecko price fetch failed:", e.message);
    }
  }

  // Known stablecoins
  const stables = [
    "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
    "0x55d398326f99059ff775485246999027b3197955", // USDT
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  ];
  if (stables.includes(key)) return 1;

  return priceCache.data[key] || 0;
}

// ============================================================
// Main position fetcher for a single NFT contract
// ============================================================
async function fetchV3Positions(wallet, nftAddress, protocolName, provider) {
  const positions = [];

  try {
    const nft = new ethers.Contract(nftAddress, POSITION_MANAGER_ABI, provider);

    let balance;
    try {
      balance = Number(await nft.balanceOf(wallet));
    } catch {
      return []; // contract may not exist or wallet has no positions
    }

    if (balance === 0) return [];

    // Get factory for pool lookups
    let factoryAddress;
    try {
      factoryAddress = await nft.factory();
    } catch {
      factoryAddress = CONTRACTS.PCS_V3_FACTORY;
    }
    const factory = new ethers.Contract(factoryAddress, V3_FACTORY_ABI, provider);

    // Fetch all token IDs
    const tokenIdPromises = [];
    for (let i = 0; i < balance; i++) {
      tokenIdPromises.push(nft.tokenOfOwnerByIndex(wallet, i).catch(() => null));
    }
    const tokenIds = (await Promise.all(tokenIdPromises)).filter(Boolean);

    // Fetch all positions data
    const posDataPromises = tokenIds.map((id) => nft.positions(id).catch(() => null));
    const positionsData = await Promise.all(posDataPromises);

    for (let i = 0; i < positionsData.length; i++) {
      const pos = positionsData[i];
      if (!pos || pos.liquidity.toString() === "0") continue; // skip closed positions

      try {
        const [token0Info, token1Info] = await Promise.all([
          getTokenInfo(pos.token0, provider),
          getTokenInfo(pos.token1, provider),
        ]);

        // Get pool address
        let poolAddress;
        try {
          poolAddress = await factory.getPool(pos.token0, pos.token1, pos.fee);
        } catch {
          continue;
        }
        if (!poolAddress || poolAddress === ethers.ZeroAddress) continue;

        const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
        const slot0 = await poolContract.slot0();
        const currentTick = Number(slot0.tick);
        const sqrtPriceX96 = slot0.sqrtPriceX96;

        // Token amounts
        const amounts = getTokenAmounts(
          pos.liquidity,
          sqrtPriceX96,
          Number(pos.tickLower),
          Number(pos.tickUpper),
          token0Info.decimals,
          token1Info.decimals
        );

        // Prices
        const [price0, price1] = await Promise.all([
          getTokenPriceUSD(pos.token0),
          getTokenPriceUSD(pos.token1),
        ]);

        // Uncollected fees
        const { fees0, fees1 } = await getUnclaimedFees(pos, poolContract);
        const feeAmount0 = fees0 / Math.pow(10, token0Info.decimals);
        const feeAmount1 = fees1 / Math.pow(10, token1Info.decimals);

        // Prices from ticks
        const currentPrice = tickToPrice(currentTick, token0Info.decimals, token1Info.decimals);
        const lowerPrice = tickToPrice(Number(pos.tickLower), token0Info.decimals, token1Info.decimals);
        const upperPrice = tickToPrice(Number(pos.tickUpper), token0Info.decimals, token1Info.decimals);

        const inRange = currentTick >= Number(pos.tickLower) && currentTick < Number(pos.tickUpper);

        positions.push({
          tokenId: tokenIds[i].toString(),
          protocol: protocolName,
          version: protocolName.includes("Infinity") ? "v4" : "v3",
          pair: `${token0Info.symbol} / ${token1Info.symbol}`,
          fee: Number(pos.fee) / 10000 + "%",
          tokens: [
            {
              symbol: token0Info.symbol,
              amount: amounts.amount0,
              price: price0,
              value: amounts.amount0 * price0,
              address: pos.token0,
            },
            {
              symbol: token1Info.symbol,
              amount: amounts.amount1,
              price: price1,
              value: amounts.amount1 * price1,
              address: pos.token1,
            },
          ],
          totalValue: amounts.amount0 * price0 + amounts.amount1 * price1,
          fees: {
            token0: { symbol: token0Info.symbol, amount: feeAmount0, value: feeAmount0 * price0 },
            token1: { symbol: token1Info.symbol, amount: feeAmount1, value: feeAmount1 * price1 },
            totalUsd: feeAmount0 * price0 + feeAmount1 * price1,
          },
          range: {
            lowerPrice,
            upperPrice,
            currentPrice,
            inRange,
            tickLower: Number(pos.tickLower),
            tickUpper: Number(pos.tickUpper),
            currentTick,
          },
        });
      } catch (err) {
        console.error(`Error processing position ${tokenIds[i]}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`Error fetching from ${protocolName} (${nftAddress}):`, err.message);
  }

  return positions;
}

// ============================================================
// API Routes
// ============================================================

app.get("/api/positions/:wallet", async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: "Invalid BSC address" });
  }

  try {
    const provider = getProvider();

    // Fetch from all known V3 position managers in parallel
    const [pcsV3, uniV3a, uniV3b] = await Promise.all([
      fetchV3Positions(wallet, CONTRACTS.PCS_V3_NFT, "PancakeSwap V3", provider),
      fetchV3Positions(wallet, CONTRACTS.UNI_V3_NFT, "Uniswap V3", provider),
      fetchV3Positions(wallet, CONTRACTS.UNI_V3_NFT2, "Uniswap V3", provider),
    ]);

    const allPositions = [...pcsV3, ...uniV3a, ...uniV3b];

    res.json({
      wallet,
      totalPositions: allPositions.length,
      totalValue: allPositions.reduce((s, p) => s + p.totalValue, 0),
      totalFees: allPositions.reduce((s, p) => s + p.fees.totalUsd, 0),
      positions: allPositions,
    });
  } catch (err) {
    console.error("Position fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, mode: "on-chain", rpc: "BSC public nodes" });
});

// Serve built frontend
app.use(express.static(join(__dirname, "dist")));
app.get("/{*splat}", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  BSC LP Tracker (on-chain) running on port ${PORT}\n`);
});
