import axios from 'axios';
import * as web3 from '@solana/web3.js';
import * as bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY as string;
const FEE_PAYER_PRIVATE_KEY = process.env.SOLANA_FEE_PAYER_PRIVATE_KEY as string;
const keypair = web3.Keypair.fromSecretKey(bs58.default.decode(PRIVATE_KEY));
const feePayerKeypair = web3.Keypair.fromSecretKey(bs58.default.decode(FEE_PAYER_PRIVATE_KEY));

const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'), 'confirmed');

async function sendFromSolanaToOtherChain() {
  try {
    // Get quote from Stargate API
    const response = await axios.get('https://stargate.finance/api/v1/quotes', {
      params: {
        srcToken: '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv',
        dstToken: '0x6418c0dd099a9FDA397C766304CDd918233E8847',
        srcAddress: keypair.publicKey.toString(),
        dstAddress: '0x6d9F1a927CBcb5e2c28D13CA735bc6d6131406da',
        srcChainKey: 'solana',
        dstChainKey: 'ethereum',
        srcAmount: '2000000',
        dstAmountMin: '0',
        feePayer: feePayerKeypair.publicKey.toString(),
        _vercel_share: 'qQulgzRmvVtphIYdSVliBm2Q5f2ODoV0'
      },
      headers: {
        'Cookie': '_vercel_jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJieXBhc3MiOiJxUXVsZ3pSbXZWdHBoSVlkU1ZsaUJtMlE1ZjJPRG9WMCIsImF1ZCI6InN0YXJnYXRlLW1haW5uZXQtZ2l0LWZlYXQtZmVlLXBheWVyLXN0YXJnYXRlLWZvdW5kYXRpb24udmVyY2VsLmFwcCIsImlhdCI6MTc1MzM1MzU3Miwic3ViIjoicHJvdGVjdGlvbi1ieXBhc3MtdXJsIn0.GDDFL4u0eFEdiIXEb5VUMgVC0MCXJnmy9f2lUNQ3K_E'
      }
    });
    
    const quote = response.data.quotes[0];
    const step = quote.steps[0];
    
    console.log('Executing Stargate transaction...');
    
    // Decode and deserialize transaction
    const transactionBuffer = Buffer.from(step.transaction.data, 'base64');
    const versionedMessage = web3.VersionedMessage.deserialize(transactionBuffer);
    const transaction = new web3.VersionedTransaction(versionedMessage);
    
    // Sign with both keypairs
    const signers = [keypair, feePayerKeypair];
    transaction.sign(signers);
    
    // Send transaction
    const signature = await connection.sendTransaction(transaction);
    console.log('Transaction signature:', signature);
    
    // Wait for confirmation
    const blockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: blockHash.blockhash,
      lastValidBlockHeight: blockHash.lastValidBlockHeight
    });
    
    console.log('Transaction confirmed successfully!');
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

sendFromSolanaToOtherChain()
  .then(() => console.log('Success!'))
  .catch((error) => console.error('Failed:', error));

