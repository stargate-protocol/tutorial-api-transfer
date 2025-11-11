import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

const API = 'https://stargate.finance/api/v2';
const API_KEY = process.env.STARGATE_API_KEY!;
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY!;
const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'), 'confirmed');

type FeeTolerance = { type: 'PERCENT'; amount?: number };
type GetQuotesInput = {
  srcChainKey: string;
  dstChainKey: string;
  srcTokenAddress: string;
  dstTokenAddress: string;
  srcWalletAddress: string;
  dstWalletAddress: string;
  amount: string | bigint;
  options: {
    amountType?: 'EXACT_SRC_AMOUNT';
    feeTolerance?: FeeTolerance;
    dstNativeDropAmount?: number | bigint;
  };
};
type Quote = { id: string };
type GetQuotesResult = { quotes: Quote[] };
type SolanaTxEncoded = { encoding: 'base64'; data: string };
type UserTransactionStep = {
  type: 'TRANSACTION';
  transaction: { encoded: SolanaTxEncoded };
};
type BuildUserStepsResult = { body: { userSteps: UserTransactionStep[] } };

function assert<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null) throw new Error(msg);
  return v;
}

function parseSolanaSecretKey(raw: string): Uint8Array {
  const isHex = /^0x[0-9a-fA-F]+$/.test(raw) || /^[0-9a-fA-F]+$/.test(raw);
  if (isHex) {
    const hex = raw.replace(/^0x/, '');
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== 64) throw new Error(`Expected 64-byte hex key, got ${buf.length}`);
    return new Uint8Array(buf);
  }
  const decoded = bs58.decode(raw);
  if (decoded.length !== 64) throw new Error(`Expected 64-byte base58 key, got ${decoded.length}`);
  return decoded;
}

const keypair = web3.Keypair.fromSecretKey(parseSolanaSecretKey(PRIVATE_KEY));

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': assert(API_KEY, 'Missing STARGATE_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function fetchQuote(): Promise<Quote> {
  const payload: GetQuotesInput = {
    srcChainKey: 'solana',
    dstChainKey: 'optimism',
    srcTokenAddress: 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT',
    dstTokenAddress: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
    srcWalletAddress: keypair.publicKey.toBase58(),
    dstWalletAddress: '0x9F1473c484Ce6b227538765b1c996DDfEc853DAA',
    amount: '3308758007',
    options: { amountType: 'EXACT_SRC_AMOUNT', feeTolerance: { type: 'PERCENT', amount: 20 }, dstNativeDropAmount: 0 },
  };

  const result = await postJson<GetQuotesResult>('/quotes', payload);
  const quote = result.quotes?.[0];
  if (!quote) throw new Error('No quote');
  return quote;
}

async function buildUserSteps(quoteId: string) {
  return postJson<BuildUserStepsResult>('/build-user-steps', { quoteId });
}

async function executeSolanaSteps(steps: UserTransactionStep[]) {
  for (const step of steps) {
    if (step.type !== 'TRANSACTION') continue;

    const tx = step.transaction.encoded;
    if (tx.encoding !== 'base64') continue;

    const raw = Buffer.from(tx.data, 'base64');
    const msg = web3.VersionedMessage.deserialize(raw);
    const vtx = new web3.VersionedTransaction(msg);
    vtx.sign([keypair]);

    const signature = await connection.sendTransaction(vtx);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    });
  }
}

async function run() {
  const quote = await fetchQuote();
  const { body } = await buildUserSteps(quote.id);
  await executeSolanaSteps(body.userSteps);
}

void run();