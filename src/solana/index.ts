import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

// Setup: initialize wallet and client
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

type Status = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
type GetStatusResult = { status: Status; explorerUrl?: string };

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

// Helper functions for API requests
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'GET',
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

// Core API operations for Stargate cross-chain transfers.
// Here, we fetch quotes for sending OFT tokens (CAW) from Solana to Arbitrum.
// The options specify to use the exact source amount and include a fee tolerance of 2%.
async function fetchQuotes(): Promise<GetQuotesResult> {
  const payload: GetQuotesInput = {
    srcChainKey: 'solana',
    dstChainKey: 'arbitrum',
    srcTokenAddress: 'CAW777xcHVTQZ4CRwVQGB8CV1BVKPm5bNVxFJHWFKiH8',
    dstTokenAddress: '0x16f1967565aaD72DD77588a332CE445e7cEF752b',
    srcWalletAddress: keypair.publicKey.toBase58(),
    dstWalletAddress: '0x6d9798053f498451bec79c0397f7f95b079bdcd6',
    amount: '1000000000000',
    options: {
      amountType: 'EXACT_SRC_AMOUNT',
      feeTolerance: { type: 'PERCENT', amount: 2 },
      dstNativeDropAmount: 0,
    },
  };
  return postJson<GetQuotesResult>('/quotes', payload);
}

// Builds user-interactive steps required to complete the transaction.
// Useful for both signature requests (like EIP-712) and direct Solana transactions.
// Can be integrated into a UI to guide users through signing messages or submitting transactions.
async function buildUserSteps(quoteId: string) {
  return postJson<BuildUserStepsResult>('/build-user-steps', { quoteId });
}

// Checks the status of a transaction.
// Useful for monitoring the progress of a transaction.
// Can be integrated into a UI to display the status of a transaction.
async function getStatus(quoteId: string, txSig?: string) {
  const query = txSig ? `?txHash=${encodeURIComponent(txSig)}` : '';
  return getJson<GetStatusResult>(`/status/${encodeURIComponent(quoteId)}${query}`);
}

// Execution logic
async function pollStatus(quoteId: string, txSig?: string) {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const { status } = await getStatus(quoteId, txSig);
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'UNKNOWN') return status;
    if (Date.now() > deadline) return 'UNKNOWN';
    await new Promise((r) => setTimeout(r, 4_000));
  }
}

async function executeSolanaSteps(steps: UserTransactionStep[]) {
  let signature: string | undefined;
  for (const step of steps) {
    if (step.type !== 'TRANSACTION') continue;

    const tx = step.transaction.encoded;
    if (tx.encoding !== 'base64') continue;

    const raw = Buffer.from(tx.data, 'base64');
    const msg = web3.VersionedMessage.deserialize(raw);
    const vtx = new web3.VersionedTransaction(msg);
    vtx.sign([keypair]);

    signature = await connection.sendTransaction(vtx);

    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    });
  }

  return signature;
}

async function run() {
  const quotes = await fetchQuotes();
  const quote = quotes.quotes?.[0];
  if (!quote) throw new Error('No quote');

  const { body } = await buildUserSteps(quote.id); // Solana requires user steps to get tx
  const txSig = await executeSolanaSteps(body.userSteps);

  const status = await pollStatus(quote.id, txSig);
  console.log('Final status:', status);
}

void run();