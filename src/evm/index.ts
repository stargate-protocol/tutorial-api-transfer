import { createWalletClient, createPublicClient, http, type TypedDataDefinition } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { optimism } from 'viem/chains';
import * as dotenv from 'dotenv';
dotenv.config();

const API = 'https://stargate.finance/api/unstable';
const API_KEY = process.env.STARGATE_API_KEY!;
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: optimism, transport: http() });
const client = createPublicClient({ chain: optimism, transport: http() });

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
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: string | bigint;
  from?: `0x${string}`;
  gasLimit?: string | bigint;
};

type TransactionStep = {
  type: 'TRANSACTION';
  chainKey: string;
  chainType: 'EVM';
  description: string;
  signerAddress: `0x${string}`;
  transaction: { encoded: EvmEncodedTx };
};

type SignatureStep = {
  type: 'SIGNATURE';
  description: string;
  chainKey?: string;
  signerAddress: `0x${string}`;
  signature: { type: 'EIP712'; typedData: TypedDataDefinition };
};

type UserStep = TransactionStep | SignatureStep;

type BuildUserStepsResult = {
  body: { userSteps: UserStep[] };
};

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

async function fetchQuotes(): Promise<GetQuotesResult> {
  const payload: GetQuotesInput = {
    srcTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    dstTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    srcChainKey: 'optimism',
    dstChainKey: 'arbitrum',
    amount: '1000000000000000',
    srcWalletAddress: account.address,
    dstWalletAddress: account.address,
    options: {
      amountType: 'EXACT_SRC_AMOUNT',
      feeTolerance: { type: 'PERCENT', amount: 20 },
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

function toBigIntOrUndefined(v: string | bigint | undefined): bigint | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? BigInt(v) : v;
}

async function executeEvmTransaction(step: TransactionStep) {
  const tx = step.transaction.encoded;

  const hash = await wallet.sendTransaction({
    account,
    to: tx.to,
    data: tx.data,
    value: toBigIntOrUndefined(tx.value) ?? 0n,
  });

  await client.waitForTransactionReceipt({ hash });
}

async function signEip712(step: SignatureStep) {
  const typed = step.signature.typedData;
  const signature = await wallet.signTypedData(typed);
  return signature;
}

async function run() {
  const quotes = await fetchQuotes();
  const quote = quotes.quotes?.[0];
  if (!quote) throw new Error('No quote');

  const { body } = await buildUserSteps(quote.id);
  for (const step of body.userSteps) {
    if (step.type === 'SIGNATURE') {
      const sig = await signEip712(step);
      await submitSignature(quote.id, [sig]);
    } else if (step.type === 'TRANSACTION') {
      await executeEvmTransaction(step);
    }
  }
}

void run();