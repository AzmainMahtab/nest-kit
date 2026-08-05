import { Global, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { UnitOfWork } from '../../shared/application';
import { AppConfig } from '../config';
import { buildDataSourceOptions } from './data-source';
import { TransactionContext } from './transaction-context';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

/**
 * The DataSource is a plain value provider, so Nest cannot call a lifecycle
 * hook on it. This closes the pool on shutdown instead.
 */
@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseLifecycle.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
      this.logger.log('connection pool closed');
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      inject: [AppConfig],
      useFactory: async (config: AppConfig) => {
        const dataSource = new DataSource(
          buildDataSourceOptions({
            url: config.database.url,
            logging: !config.isProduction,
          }),
        );
        return dataSource.initialize();
      },
    },
    TransactionContext,
    { provide: UnitOfWork, useClass: TypeOrmUnitOfWork },
    DatabaseLifecycle,
  ],
  exports: [DataSource, TransactionContext, UnitOfWork],
})
export class DatabaseModule {}
