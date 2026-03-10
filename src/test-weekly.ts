import { getPackDistributionService } from './services/packDistributionService.js';

const service = getPackDistributionService();

console.log('🧪 Testing weekly reward distribution...\n');

service.distributeRewards('weekly').then((result) => {
  console.log(`\n🧪 Result: ${result ? 'SUCCESS' : 'FAILED'}`);
  process.exit(0);
}).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
