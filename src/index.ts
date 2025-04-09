import axios from 'axios';
import { createPublicClient, createWalletClient, http, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, polygon } from 'viem/chains';

// Replace with your actual private key - NEVER hardcode in production code
// Use environment variables or a secure vault
const PRIVATE_KEY = '0xprivKey';
const account = privateKeyToAccount(PRIVATE_KEY);

// Initialize clients
const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http()
});

const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http()
});

async function fetchStargateRoutes() {
  try {
    const response = await axios.get('https://stargate.finance/api/v1/routes', {
      params: {
        srcToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        dstToken: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        srcAddress: '0x0C0d18aa99B02946C70EAC6d47b8009b993c9BfF',
        dstAddress: '0x0C0d18aa99B02946C70EAC6d47b8009b993c9BfF',
        srcChainKey: 'ethereum',
        dstChainKey: 'polygon',
        srcAmount: '10000000',
        dstAmountMin: '9000000'
      }
    });
    
    console.log('Stargate routes data:', response.data);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Axios error:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  }
}

async function executeStargateTransaction() {
  try {
    // 1. Fetch routes data
    const routesData = await fetchStargateRoutes();
    
    // 2. Get the first route (or implement your own selection logic)
    const selectedRoute = routesData.routes[0];
    if (!selectedRoute) {
      throw new Error('No routes available');
    }
    
    console.log('Selected route:', selectedRoute);  

    // Execute all transactions in the route steps
    for (let i = 0; i < selectedRoute.steps.length; i++) {
      const executableTransaction = selectedRoute.steps[i].transaction;
      console.log(`Executing step ${i + 1}/${selectedRoute.steps.length}:`, executableTransaction);
      
      // Create transaction object, only include value if it exists and is not empty
      const txParams: any = {
        account,
        to: executableTransaction.to,
        data: executableTransaction.data,
      };
      
      // Only add value if it exists and is not empty
      if (executableTransaction.value && executableTransaction.value !== '0') {
        txParams.value = BigInt(executableTransaction.value);
      }
      
      // Execute the transaction
      const txHash = await walletClient.sendTransaction(txParams);
      console.log(`Step ${i + 1} transaction hash: ${txHash}`);
      
      // Wait for transaction to be mined
      const receipt = await ethereumClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`Step ${i + 1} transaction confirmed:`, receipt);
    }
    
    console.log('All steps executed successfully');
    return true;
  } catch (error) {
    console.error('Error executing Stargate transaction:', error);
    throw error;
  }
}

// Call the function to execute the transaction
executeStargateTransaction()
  .then(receipt => {
    console.log('Successfully executed Stargate transaction');
  })
  .catch(err => {
    console.error('Failed to execute Stargate transaction:', err);
  });