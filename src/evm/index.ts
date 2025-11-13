import { createWalletClient, createPublicClient, http, type TypedDataDefinition, getAddress, verifyTypedData, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import * as dotenv from 'dotenv';
dotenv.config();

// Setup: initialize wallet and client
const API = 'https://stargate.finance/api/v2';
const API_KEY = process.env.STARGATE_API_KEY!;
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as Hex;
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: base, transport: http() });
const client = createPublicClient({ chain: base, transport: http() });

type AmountType = 'EXACT_SRC_AMOUNT';
type FeeTolerance = { type: 'PERCENT'; amount?: number };

type GetQuotesInput = {
  srcTokenAddress: string;
  dstTokenAddress: string;
  srcChainKey: string;
  dstChainKey: string;
  amount: string | bigint;
  srcWalletAddress: string;
  dstWalletAddress: string;
  options: {
    amountType?: AmountType;
    feeTolerance?: FeeTolerance;
    dstNativeDropAmount?: number | bigint;
  };
};

type QuoteHead = { id: string };
type GetQuotesResult = { quotes: QuoteHead[] };

type EvmEncodedTx = {
  chainId: number;
  to: Hex;
  data?: Hex;
  value?: string | bigint;
  from?: Hex;
  gasLimit?: string | bigint;
};

type TransactionStep = {
  type: 'TRANSACTION';
  chainKey: string;
  chainType: 'EVM';
  description: string;
  signerAddress: Hex;
  transaction: { encoded: EvmEncodedTx };
};

type SignatureStep = {
  type: 'SIGNATURE';
  description: string;
  chainKey?: string;
  signerAddress: Hex;
  signature: { type: 'EIP712'; typedData: TypedDataDefinition };
};

type UserStep = TransactionStep | SignatureStep;
type BuildUserStepsResult = {
  userSteps: UserStep[];
};

type Status = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
type GetStatusResult = { status: Status; explorerUrl?: string };

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

// Core API calls
async function fetchQuotes(): Promise<GetQuotesResult> {
  const payload: GetQuotesInput = {
    srcTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    dstTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    srcChainKey: 'base',
    dstChainKey: 'optimism',
    amount: '100000000000000',
    srcWalletAddress: account.address,
    dstWalletAddress: account.address,
    options: {
      amountType: 'EXACT_SRC_AMOUNT',
      feeTolerance: { type: 'PERCENT', amount: 50 },
      dstNativeDropAmount: 0,
    },
  };
  return postJson<GetQuotesResult>('/quotes', payload);
}

async function buildUserSteps(quoteId: string) {
  return postJson<BuildUserStepsResult>('/build-user-steps', { quoteId });
}

async function submitSignature(quoteId: string, signatures: string[]) {
  await postJson<Record<string, never>>('/submit-signature', { quoteId, signatures });
}

async function getStatus(quoteId: string, txHash?: Hex) {
  const query = txHash ? `?txHash=${txHash}` : '';
  return getJson<GetStatusResult>(`/status/${encodeURIComponent(quoteId)}${query}`);
}

// Execution logic
async function pollStatus(quoteId: string, txHash?: Hex) {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const { status } = await getStatus(quoteId, txHash);
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'UNKNOWN') return status;
    if (Date.now() > deadline) return 'UNKNOWN';
    await new Promise((r) => setTimeout(r, 4_000));
  }
}

async function executeEvmTransaction(step: TransactionStep) {
  const tx = step.transaction.encoded;
  const hash = await wallet.sendTransaction({
    account,
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value ?? 0n),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

// Normalizes message fields for EIP-712 signing.
export function mapMessageTypes(
  message: any,
) {
  return {
    offerer: message.offerer,
    recipient: message.recipient,
    inputToken: message.inputToken,
    outputToken: message.outputToken,
    inputAmount: BigInt(message.inputAmount),
    outputAmount: BigInt(message.outputAmount),
    startTime: BigInt(message.startTime),
    endTime:  BigInt(message.endTime),
    srcEid: message.srcEid,
    dstEid: message.dstEid
  }
}

async function signEip712(step: SignatureStep) {
  const typed = step.signature.typedData;
  const signature = await wallet.signTypedData({
    account,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: mapMessageTypes(typed.message),
  });
  return signature;
}

async function run() {
  const quotes = await fetchQuotes();
  // You can implement a logic to choose the best quote here
  const quote = quotes.quotes?.[0];
  if (!quote) throw new Error('No quote');
  // NOTE: build user steps is not supported yet
  // const {userSteps} = await buildUserSteps(quote.id);
  let txHash: Hex | undefined;
  for (const step of (quote as unknown as {userSteps: UserStep[]}).userSteps) {
    if (step.type === 'SIGNATURE') {
      const signature = await signEip712(step);
      await submitSignature(quote.id, [signature]);
    } else if (step.type === 'TRANSACTION') {
      txHash = await executeEvmTransaction(step);
    }
  }

  const status = await pollStatus(quote.id, txHash);
  console.log('Final status:', status);
}

void run();