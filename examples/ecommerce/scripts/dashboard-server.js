/**
 * xcomponent-ai Dashboard Server - Distributed Mode
 *
 * Subscribes to Redis and aggregates instances from all connected runtimes.
 */

const fs = require('fs');
const yaml = require('yaml');

async function main() {
  const brokerUrl = process.env.BROKER_URL || 'redis://redis:6379';
  const port = parseInt(process.env.PORT || '4000', 10);
  const componentFile = process.env.COMPONENT_FILE || '/app/fsm/SportShopComponent.yaml';

  console.log('='.repeat(60));
  console.log('xcomponent-ai Dashboard - Distributed Mode');
  console.log('='.repeat(60));
  console.log(`Broker: ${brokerUrl}`);
  console.log(`Port: ${port}`);
  console.log(`Component: ${componentFile}`);
  console.log('='.repeat(60));

  // Load xcomponent-ai
  const { DashboardServer } = require('xcomponent-ai');

  // Load component schema (optional, for validation)
  let component = null;
  if (fs.existsSync(componentFile)) {
    component = yaml.parse(fs.readFileSync(componentFile, 'utf-8'));
    console.log(`Loaded component: ${component.name}`);
  }

  // Create dashboard in distributed mode
  // Args: brokerUrl, databaseUrl (null = no persistence), component (optional)
  const dashboard = new DashboardServer(brokerUrl, null, component);
  await dashboard.start(port);

  console.log('');
  console.log(`Dashboard ready at http://localhost:${port}/dashboard.html`);
  console.log('Waiting for runtimes to announce...');
  console.log('');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await dashboard.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await dashboard.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Failed to start dashboard:', err);
  process.exit(1);
});
