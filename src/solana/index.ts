import axios from 'axios';
import * as web3 from '@solana/web3.js';
import * as dotenv from 'dotenv';
import * as bs58 from 'bs58';
dotenv.config();

// Initialize Solana connection and wallet
const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY as string;

// Convert private key from string to Uint8Array
let privateKeyBytes;
try {
  // Try to interpret as hex string (without 0x prefix)
  privateKeyBytes = Buffer.from(PRIVATE_KEY.replace(/^0x/, ''), 'hex');
  
  // Check if length is correct (should be 64 bytes for Ed25519)
  if (privateKeyBytes.length !== 64) {
    // Alternatively, try as base58 (Solana CLI format)
    privateKeyBytes = Buffer.from(bs58.default.decode(PRIVATE_KEY));
  }
} catch (error) {
  console.error('Error parsing private key:', error);
  throw new Error('Invalid private key format. Must be hex or base58 encoded.');
}

// Make sure the key has correct length
if (privateKeyBytes.length !== 64) {
  throw new Error(`Bad secret key size: ${privateKeyBytes.length}. Expected 64 bytes.`);
}

const keypair = web3.Keypair.fromSecretKey(privateKeyBytes);

// Initialize Solana connection
const connection = new web3.Connection(
  web3.clusterApiUrl('mainnet-beta'),
  'confirmed'
);

// For sending FROM Solana TO another chain (e.g., Ethereum)
async function sendFromSolanaToOtherChain() {
  try {
    // This would require fetching a quotes with Solana as the source chain
    
    // 1. First, we would fetch the appropriate route
    const response = await axios.get('https://stargate.finance/api/v1/quotes', {
      params: {
        srcToken: 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT', // Token on Solana
        dstToken: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', // Token on destination chain
        srcAddress: '9hWTHmE8T2fTeuog1K2ZzBtg8pfKhh3fcYAJUo54Vz37', // Source address
        dstAddress: '0x9F1473c484Ce6b227538765b1c996DDfEc853DAA', // Destination address
        srcChainKey: 'solana',
        dstChainKey: 'optimism',
        srcAmount: '3308758007', // Amount to send
        dstAmountMin: '3215670426000000000' // Minimum to receive after fees
      }
    });
    
    const quotesData = response.data;
    console.log('Quotes for sending from Solana:', quotesData);
    
    if (!quotesData.quotes || quotesData.quotes.length === 0) {
      throw new Error('No quotes available for sending from Solana');
    }
    
    const quote = quotesData.quotes[0]; 
    
    // 2. Execute each step in the quote
    for (let i = 0; i < quote.steps.length; i++) {
      const step = quote.steps[i];
      console.log(`Executing step ${i + 1}/${quote.steps.length}:`, step);
      
      // For Solana, the transaction would typically be provided as serialized data
      // We would deserialize, sign, and send it
      if (step.transaction && step.transaction.data) {
        // The format depends on Stargate's API response for Solana transactions
        // This is a simplified example - actual implementation would depend on the API response format
        
        // If data is provided as a serialized transaction
        const transactionBuffer = Buffer.from(step.transaction.data, 'base64');
        
        // Use VersionedMessage.deserialize instead of Transaction.from
        const versionedMessage = web3.VersionedMessage.deserialize(transactionBuffer);
        const transaction = new web3.VersionedTransaction(versionedMessage);
        
        // Sign and send the transaction
        transaction.sign([keypair]);
        const signature = await connection.sendTransaction(transaction);
        
        // Wait for confirmation
        const latestBlockHash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature,
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight
        });
        
        console.log(`Transaction signature: ${signature}`);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error sending from Solana:', error);
    throw error;
  }
}


void sendFromSolanaToOtherChain()
  .then(() => {
    console.log('Successfully sent tokens from Solana');
  })
  .catch((err) => {
    console.error('Failed to send tokens from Solana:', err);
  });

