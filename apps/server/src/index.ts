import { buildApp } from './app';
import { appConfig } from './config';

const app = await buildApp({ logger: true });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});

try {
  await app.listen({ port: appConfig.port, host: appConfig.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
